// Tafac's own statistics (own/analytics.rs): what the route answers, what
// reaches PostHog, and what is left to Node. PostHog is made up here, on
// this computer (POSTHOG_HOST): it says what it was sent, and answers, late,
// or not at all, as a test asks.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use http::header::{CONTENT_TYPE, SET_COOKIE};
use http::{HeaderMap, Method};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::{asked, never, LOGOUT, POST};
use crate::routes::{self, Backend, Moved};
use crate::session::cookie::seal;
use crate::testing::*;
use crate::{Gateway, Statistics, ANSWERED_BY};

const ANALYTICS: &str = "/__ent_auth/analytics";
const KEY: &str = "phc_made_up";

// What the made-up PostHog answers, one request after the other: 200 once
// the list is through.
#[derive(Clone, Copy)]
enum Reply {
    Status(u16),
    // 204, as Node's route says it.
    NoContent,
    // Nothing, ever: the connection held open.
    Silent,
}

#[derive(Clone)]
struct PostHog {
    address: String,
    // Each request's head and body.
    got: Arc<Mutex<Vec<(String, Vec<u8>)>>>,
    replies: Arc<Mutex<VecDeque<Reply>>>,
}

fn posthog(replies: &[Reply]) -> PostHog {
    let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
    let made = PostHog { address: listener.local_addr().unwrap().to_string(), got: Default::default(), replies: Arc::new(Mutex::new(replies.iter().copied().collect())) };
    let posthog = made.clone();
    spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let posthog = posthog.clone();
            spawn(async move {
                let Some((head, mut body)) = read_request(&mut stream).await else { return };
                let length: usize = header_of(&head, "content-length").parse().unwrap_or(0);
                let mut chunk = [0_u8; 4096];
                while body.len() < length {
                    match stream.read(&mut chunk).await {
                        Ok(read) if read > 0 => body.extend_from_slice(&chunk[..read]),
                        _ => break,
                    }
                }
                posthog.got.lock().unwrap().push((head, body));
                let reply = posthog.replies.lock().unwrap().pop_front().unwrap_or(Reply::Status(200));
                match reply {
                    Reply::Silent => tokio::time::sleep(Duration::from_secs(30)).await,
                    Reply::NoContent => {
                        let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\ncache-control: no-store\r\nconnection: close\r\n\r\n").await;
                        let _ = stream.shutdown().await;
                    }
                    Reply::Status(status) => {
                        let said = r#"{"status":1}"#;
                        let answer = format!("HTTP/1.1 {status} Said\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{said}", said.len());
                        let _ = stream.write_all(answer.as_bytes()).await;
                        let _ = stream.shutdown().await;
                    }
                }
            });
        }
    });
    made
}

impl PostHog {
    fn host(&self) -> String {
        format!("http://{}", self.address)
    }

    fn count(&self) -> usize {
        self.got.lock().unwrap().len()
    }

    // The batches it was sent, once there are `count` of them (a few
    // seconds at most: they are sent behind the answer).
    fn batches(&self, count: usize) -> Vec<Value> {
        let since = Instant::now();
        while self.count() < count && since.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(10));
        }
        let got = self.got.lock().unwrap().clone();
        assert_eq!(got.len(), count, "PostHog was sent {} batches", got.len());
        for (head, _) in &got {
            assert!(head.starts_with("POST /batch/ HTTP/1.1"), "{head}");
            assert_eq!(header_of(head, "content-type"), "application/json");
        }
        got.iter().map(|(_, body)| serde_json::from_slice(body).unwrap()).collect()
    }

    // The one batch it was sent, its events.
    fn events(&self) -> Vec<Value> {
        let batch = self.batches(1).remove(0);
        assert_eq!(batch["api_key"], KEY);
        assert!(batch["sent_at"].as_str().unwrap().ends_with('Z'));
        batch["batch"].as_array().unwrap().clone()
    }

    // Nothing was sent, a moment after the answer.
    fn sent_nothing(&self) {
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(self.count(), 0);
    }
}

fn settings(pairs: &[(&str, String)]) -> impl Fn(&str) -> Option<String> {
    let pairs: Vec<(String, String)> = pairs.iter().map(|(name, value)| (name.to_string(), value.clone())).collect();
    move |name| pairs.iter().find(|(found, _)| found == name).map(|(_, value)| value.clone())
}

// The gateway, with the statistics on and PostHog where `posthog` is.
fn gateway_with(posthog: &PostHog, more: &[(&str, &str)]) -> Gateway {
    let mut pairs = vec![("POSTHOG_HOST", posthog.host())];
    pairs.extend(more.iter().map(|(name, value)| (*name, value.to_string())));
    let statistics = Statistics::read(Some(KEY), settings(&pairs)).hurried(Duration::from_millis(400), Duration::from_millis(100), 50);
    Gateway::for_tests(Vec::new(), SECRET, COOKIE_NAME).with_statistics(Some(KEY)).sending_statistics(statistics)
}

fn gateway(posthog: &PostHog) -> Gateway {
    gateway_with(posthog, &[])
}

// The page's beacon: its body as text, and the length said.
fn beacon(body: &[u8], more: &[(&'static str, &str)]) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, "text/plain;charset=UTF-8".parse().unwrap());
    headers.insert("content-length", body.len().to_string().parse().unwrap());
    headers.insert("host", "tafac.fr".parse().unwrap());
    for (name, value) in more {
        headers.append(*name, value.parse().unwrap());
    }
    headers
}

fn post_with(gateway: &Gateway, headers: &HeaderMap, body: &[u8], cookie: Option<&str>) -> Option<http::Response<Vec<u8>>> {
    block_on(gateway.answer(&asked(&POST, ANALYTICS, headers, body), || cookie.map(str::to_string), never))
}

fn post(gateway: &Gateway, body: &Value, cookie: Option<&str>) -> Option<http::Response<Vec<u8>>> {
    let body = body.to_string();
    post_with(gateway, &beacon(body.as_bytes(), &[]), body.as_bytes(), cookie)
}

// Node's answer: the status, no-store, nothing else.
fn said(response: Option<http::Response<Vec<u8>>>) -> u16 {
    let response = response.expect("an answer made here");
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert!(response.headers().get(CONTENT_TYPE).is_none() && response.headers().get(SET_COOKIE).is_none() && response.headers().get("x-tafac-session").is_none());
    assert!(response.body().is_empty());
    response.status().as_u16()
}

// A student's session cookie, at a university.
fn session(id: &str, university: &str, user: &str) -> String {
    seal(SECRET, &json!({ "id": id, "uni": university, "user": user, "mode": null, "demoState": null, "createdAt": crate::gateway::now_ms(), "jar": [] }))
}

fn events(list: &[Value]) -> Value {
    json!({ "events": list })
}

fn dashboard() -> Value {
    json!({ "event": "dashboard_viewed", "properties": { "device": "mobile" } })
}

fn login_failed() -> Value {
    json!({ "event": "login_result", "properties": { "result": "failure", "demo": false } })
}

fn is_hex_id(id: &Value) -> bool {
    id.as_str().is_some_and(|id| id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn is_random_id(id: &Value) -> bool {
    id.as_str().is_some_and(|id| id.len() == 36 && &id[14..15] == "4")
}

// What PostHog is told of every event, besides the event's own.
fn sent_with(mut properties: Value, extra: Value) -> Value {
    let all = properties.as_object_mut().unwrap();
    all.extend(extra.as_object().unwrap().clone());
    all.insert("$process_person_profile".to_string(), false.into());
    all.insert("$geoip_disable".to_string(), true.into());
    all.insert("$lib".to_string(), "tafac-gateway".into());
    all.insert("$lib_version".to_string(), env!("CARGO_PKG_VERSION").into());
    properties
}

#[test]
fn the_statistics_route_is_answered_here() {
    assert_eq!(routes::backend(&Method::POST, ANALYTICS), Backend::TonApi(Moved::Analytics));
    assert_eq!(routes::backend(&Method::GET, ANALYTICS), Backend::Node);
    assert_eq!(routes::backend(&Method::POST, "/__ent_auth/analytics/"), Backend::Node);
    assert!(Gateway::reads_body(&Method::POST, ANALYTICS));
    assert!(!Gateway::reads_body(&Method::GET, ANALYTICS));
}

#[test]
fn without_being_told_where_posthog_is_the_route_stays_nodes() {
    // As in the apps: the statistics on, nothing said of where they go.
    let gateway = Gateway::for_tests(Vec::new(), SECRET, COOKIE_NAME).with_statistics(Some(KEY));
    assert!(post(&gateway, &events(&[login_failed()]), None).is_none());
    assert!(post(&gateway, &events(&[dashboard()]), Some(&session("session-1", UNIVERSITY, "jdoe"))).is_none());
}

#[test]
fn with_the_statistics_off_every_request_is_answered_and_nothing_is_sent() {
    let posthog = posthog(&[]);
    let statistics = Statistics::read(None, settings(&[("POSTHOG_HOST", posthog.host())]));
    let gateway = Gateway::for_tests(Vec::new(), SECRET, COOKIE_NAME).with_statistics(None).sending_statistics(statistics);
    let body = events(&[login_failed()]).to_string();
    let cases = [
        beacon(body.as_bytes(), &[]),
        beacon(body.as_bytes(), &[("sec-fetch-site", "cross-site")]),
        // Too long, compressed, or in another charset: not even read.
        beacon(&[b' '; 9000], &[]),
        beacon(body.as_bytes(), &[("content-encoding", "gzip")]),
    ];
    for headers in cases {
        assert_eq!(said(post_with(&gateway, &headers, body.as_bytes(), Some(&session("session-1", UNIVERSITY, "jdoe")))), 204);
        assert_eq!(said(post_with(&gateway, &headers, body.as_bytes(), None)), 204);
    }
    posthog.sent_nothing();
}

#[test]
fn a_sessions_events_go_to_posthog_under_an_id_of_the_day_with_the_gateways_own_properties() {
    let posthog = posthog(&[]);
    let gateway = gateway(&posthog);
    let cookie = session("session-123", "univ-rennes-2", "jdoe");
    let leaky = json!({ "event": "widget_loaded", "properties": { "widget": "mail", "status": "ok", "subject": "Convocation", "university": "evil", "demo": true, "$ip": "1.2.3.4" } });
    let sent = events(&[dashboard(), leaky, json!({ "event": "login_result", "properties": { "result": "success", "demo": true } }), json!({ "event": "$pageview" })]);
    let asked_at = Instant::now();
    assert_eq!(said(post(&gateway, &sent, Some(&cookie))), 204);
    assert!(asked_at.elapsed() < Duration::from_millis(500), "{:?}", asked_at.elapsed());

    let events = posthog.events();
    let names: Vec<&str> = events.iter().map(|event| event["event"].as_str().unwrap()).collect();
    assert_eq!(names, ["dashboard_viewed", "widget_loaded", "login_result"]);
    // The university and `demo` are the gateway's, never the page's.
    let theirs = json!({ "demo": false, "university": "univ-rennes-2" });
    assert_eq!(events[0]["properties"], sent_with(json!({ "device": "mobile" }), theirs.clone()));
    assert_eq!(events[1]["properties"], sent_with(json!({ "widget": "mail", "status": "ok" }), theirs.clone()));
    assert_eq!(events[2]["properties"], sent_with(json!({ "result": "success" }), theirs));
    // One id for the session's events, which says nothing of the session.
    let id = &events[0]["distinct_id"];
    assert!(is_hex_id(id), "{id}");
    assert!(events.iter().all(|event| &event["distinct_id"] == id));
    assert!(!id.as_str().unwrap().contains("session-123"));
    // Each event has its own uuid and time.
    assert_ne!(events[0]["uuid"], events[1]["uuid"]);
    assert!(events.iter().all(|event| event["timestamp"].as_str().unwrap().ends_with('Z')));

    // The same session the same day: the same id; another: another.
    // (One at a time: two batches sent at once may come in either order.)
    assert_eq!(said(post(&gateway, &crate::tests::analytics::events(&[dashboard()]), Some(&cookie))), 204);
    assert_eq!(&posthog.batches(2)[1]["batch"][0]["distinct_id"], id);
    assert_eq!(said(post(&gateway, &crate::tests::analytics::events(&[dashboard()]), Some(&session("session-456", "univ-rennes-2", "jdoe")))), 204);
    let other = posthog.batches(3)[2]["batch"][0]["distinct_id"].clone();
    assert!(is_hex_id(&other) && &other != id, "{other}");
}

#[test]
fn without_a_session_only_the_events_safe_for_anybody_go_each_request_under_an_id_of_its_own() {
    let posthog = posthog(&[]);
    let gateway = gateway(&posthog);
    let sent = events(&[dashboard(), login_failed(), json!({ "event": "settings_imported", "properties": { "has_settings": true } })]);
    assert_eq!(said(post(&gateway, &sent, None)), 204);
    posthog.batches(1);
    assert_eq!(said(post(&gateway, &events(&[login_failed()]), None)), 204);
    let batches = posthog.batches(2);
    let events = batches[0]["batch"].as_array().unwrap();
    let names: Vec<&str> = events.iter().map(|event| event["event"].as_str().unwrap()).collect();
    assert_eq!(names, ["login_result", "settings_imported"]);
    // The page's own `demo` stays: there is no session to say it.
    assert_eq!(events[0]["properties"], sent_with(json!({ "result": "failure", "demo": false }), json!({ "university": "univ-rennes" })));
    assert_eq!(events[1]["properties"], sent_with(json!({ "has_settings": true }), json!({ "university": "univ-rennes" })));
    assert!(is_random_id(&events[0]["distinct_id"]));
    assert_eq!(events[0]["distinct_id"], events[1]["distinct_id"]);
    assert!(is_random_id(&batches[1]["batch"][0]["distinct_id"]));
    assert_ne!(batches[1]["batch"][0]["distinct_id"], events[0]["distinct_id"]);
    // Nothing a visitor may not send: nothing sent at all.
    assert_eq!(said(post(&gateway, &crate::tests::analytics::events(&[dashboard()]), None)), 204);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(posthog.count(), 2);
}

#[test]
fn a_visitors_events_are_the_university_node_sends_the_request_to() {
    let body = events(&[login_failed()]).to_string();
    let university_of = |gateway: &Gateway, posthog: &PostHog, more: &[(&'static str, &str)]| {
        let before = posthog.count();
        assert_eq!(said(post_with(gateway, &beacon(body.as_bytes(), more), body.as_bytes(), None)), 204);
        let batches = posthog.batches(before + 1);
        batches[before]["batch"][0]["properties"]["university"].as_str().unwrap().to_string()
    };
    let posthog_every = posthog(&[]);
    let every = gateway(&posthog_every);
    assert_eq!(university_of(&every, &posthog_every, &[]), "univ-rennes");
    // An old address of one university's.
    assert_eq!(university_of(&every, &posthog_every, &[("x-forwarded-host", "univrennes2.exemple.test")]), "univ-rennes-2");
    // Another default.
    let posthog_listed = posthog(&[]);
    let listed = gateway_with(&posthog_listed, &[("UNIVERSITY", "univ-sorbonne-nouvelle"), ("MULTI_UNIVERSITY", "1")]);
    assert_eq!(university_of(&listed, &posthog_listed, &[]), "univ-sorbonne-nouvelle");
    // One university only: that one, whatever the address.
    let posthog_one = posthog(&[]);
    let one = gateway_with(&posthog_one, &[("UNIVERSITY", "univ-rennes-2")]);
    assert_eq!(university_of(&one, &posthog_one, &[("x-forwarded-host", "univrennes.exemple.test")]), "univ-rennes-2");
    // A request that names its university (the login page's choice): that
    // one, before its address'.
    assert_eq!(university_of(&every, &posthog_every, &[("x-forwarded-host", "univsorbonnenouvelle.exemple.test"), ("x-tafac-university", "rennes2")]), "univ-rennes-2");
}

#[test]
fn a_session_node_doesnt_read_as_one_is_a_visitors() {
    let body = events(&[dashboard(), login_failed()]);
    // Its university isn't one Node serves: Node sends the request to the
    // default one, which finds no session of its own.
    let posthog = posthog(&[]);
    let gateway = gateway_with(&posthog, &[("UNIVERSITIES", "univ-rennes-2")]);
    assert_eq!(said(post(&gateway, &body, Some(&session("session-1", "univ-sorbonne-nouvelle", "jdoe")))), 204);
    let events = posthog.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["event"], "login_result");
    assert_eq!(events[0]["properties"]["university"], "univ-rennes");
    assert!(is_random_id(&events[0]["distinct_id"]));

    // One university only, another session's.
    let posthog = crate::tests::analytics::posthog(&[]);
    let gateway = gateway_with(&posthog, &[("UNIVERSITY", "univ-rennes-2")]);
    assert_eq!(said(post(&gateway, &body, Some(&session("session-1", "univ-rennes", "jdoe")))), 204);
    let events = posthog.events();
    assert_eq!((events.len(), &events[0]["properties"]["university"]), (1, &json!("univ-rennes-2")));
}

#[test]
fn a_session_signed_out_a_moment_ago_is_a_visitors_of_its_university() {
    let posthog = posthog(&[]);
    let gateway = gateway(&posthog);
    let cookie = session("session-1", "univ-rennes-2", "jdoe");
    // Its sign-out on its way to Node, the cookie still on a request.
    gateway.saw_request(&Method::POST, LOGOUT, Some(&cookie));
    assert_eq!(said(post(&gateway, &events(&[dashboard(), login_failed()]), Some(&cookie))), 204);
    let events = posthog.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["properties"], sent_with(json!({ "result": "failure", "demo": false }), json!({ "university": "univ-rennes-2" })));
    assert!(is_random_id(&events[0]["distinct_id"]));
}

#[test]
fn an_excluded_accounts_events_are_never_sent() {
    let posthog = posthog(&[]);
    let gateway = gateway_with(&posthog, &[("ANALYTICS_EXCLUDED_USERS", "dev0, Dev1")]);
    assert_eq!(said(post(&gateway, &events(&[dashboard(), login_failed()]), Some(&session("session-a", UNIVERSITY, " DEV1 ")))), 204);
    posthog.sent_nothing();
    // Anyone else's go, and a visitor's.
    assert_eq!(said(post(&gateway, &events(&[dashboard()]), Some(&session("session-b", UNIVERSITY, "student")))), 204);
    assert_eq!(said(post(&gateway, &events(&[login_failed()]), None)), 204);
    let batches = posthog.batches(2);
    assert!(batches.iter().all(|batch| !batch.to_string().contains("student") && !batch.to_string().contains("\"user\"")));
}

#[test]
fn a_request_from_another_site_is_answered_and_nothing_is_sent() {
    let posthog = posthog(&[]);
    let gateway = gateway(&posthog);
    let body = events(&[login_failed()]).to_string();
    for site in [&["cross-site"][..], &["same-site"], &["none"], &["same-origin", "same-origin"]] {
        let more: Vec<(&'static str, &str)> = site.iter().map(|site| ("sec-fetch-site", *site)).collect();
        assert_eq!(said(post_with(&gateway, &beacon(body.as_bytes(), &more), body.as_bytes(), None)), 204, "{site:?}");
    }
    posthog.sent_nothing();
    assert_eq!(said(post_with(&gateway, &beacon(body.as_bytes(), &[("sec-fetch-site", "same-origin")]), body.as_bytes(), None)), 204);
    assert_eq!(posthog.batches(1).len(), 1);
}

#[test]
fn a_body_longer_than_8_kb_is_refused_and_one_of_8_kb_is_read() {
    let posthog = posthog(&[]);
    let gateway = gateway(&posthog);
    let long = vec![b' '; 8 * 1024 + 1];
    assert_eq!(said(post_with(&gateway, &beacon(&long, &[]), &long, Some(&session("session-1", UNIVERSITY, "jdoe")))), 413);
    // Said to be that long, and not read here: refused all the same.
    assert_eq!(said(post_with(&gateway, &beacon(&long, &[]), &[], None)), 413);
    posthog.sent_nothing();
    let mut body = events(&[login_failed()]).to_string().into_bytes();
    body.resize(8 * 1024, b' ');
    assert_eq!(said(post_with(&gateway, &beacon(&body, &[]), &body, None)), 204);
    assert_eq!(posthog.events().len(), 1);
}

#[test]
fn a_body_is_read_as_express_reads_text() {
    let posthog = posthog(&[]);
    let gateway = gateway(&posthog);
    let body = events(&[login_failed()]).to_string();
    let with_mark = format!("\u{feff}{body}");
    let cases: [(&[u8], &[(&'static str, &str)]); 4] = [
        // The byte order mark taken off; JSON's own type; a charset said in
        // other words; no type.
        (with_mark.as_bytes(), &[]),
        (body.as_bytes(), &[("content-type", "application/json")]),
        (body.as_bytes(), &[("content-type", "text/plain; charset=\"UTF8\"")]),
        (body.as_bytes(), &[("content-encoding", "identity")]),
    ];
    for (sent, more) in cases {
        let mut headers = beacon(sent, &[]);
        for (name, value) in more {
            headers.insert(*name, value.parse().unwrap());
        }
        assert_eq!(said(post_with(&gateway, &headers, sent, None)), 204);
    }
    assert_eq!(posthog.batches(4).len(), 4);
    // Nothing but spaces, or nothing: no events.
    for empty in [&b""[..], b"  \n"] {
        assert_eq!(said(post_with(&gateway, &beacon(empty, &[]), empty, None)), 204);
    }
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(posthog.count(), 4);
}

#[test]
fn what_node_would_read_another_way_is_left_to_it() {
    let posthog = posthog(&[]);
    let gateway = gateway(&posthog);
    let body = events(&[login_failed()]).to_string();
    let left = |headers: HeaderMap, sent: &[u8], cookie: Option<&str>| {
        assert!(post_with(&gateway, &headers, sent, cookie).is_none());
    };
    // A body whose length isn't said, or isn't all here (not read).
    let mut unsaid = beacon(body.as_bytes(), &[]);
    unsaid.remove("content-length");
    left(unsaid, body.as_bytes(), None);
    left(beacon(body.as_bytes(), &[]), &[], None);
    // Compressed, in another charset.
    left(beacon(body.as_bytes(), &[("content-encoding", "gzip")]), body.as_bytes(), None);
    let mut latin = beacon(body.as_bytes(), &[]);
    latin.insert(CONTENT_TYPE, "text/plain; charset=latin1".parse().unwrap());
    left(latin, body.as_bytes(), None);
    // JSON that JSON.parse takes and serde doesn't (a lone surrogate), and
    // what neither takes.
    let lone = body.replace("failure\"", "failure\",\"x\":\"\\ud800\"");
    left(beacon(lone.as_bytes(), &[]), lone.as_bytes(), None);
    left(beacon(b"not json", &[]), b"not json", None);
    // A cookie the gateway doesn't read: another secret's (SESSION_SECRET_PREVIOUS),
    // from before sessions named their university, the demo's, not one.
    let previous = seal("an older secret of the tests, long enough", &json!({ "id": "s", "uni": UNIVERSITY, "user": "jdoe", "createdAt": crate::gateway::now_ms(), "jar": [] }));
    let without_university = seal(SECRET, &json!({ "id": "s", "user": "jdoe", "createdAt": crate::gateway::now_ms(), "jar": [] }));
    let demo = seal(SECRET, &json!({ "id": "s", "uni": UNIVERSITY, "user": "demo", "mode": "demo", "createdAt": crate::gateway::now_ms(), "jar": [] }));
    for cookie in [previous.as_str(), &without_university, &demo, "v1.not.one"] {
        left(beacon(body.as_bytes(), &[]), body.as_bytes(), Some(cookie));
    }
    posthog.sent_nothing();
}

#[test]
fn a_posthog_that_is_down_costs_the_events_and_nothing_else() {
    let down = PostHog { address: "127.0.0.1:1".to_string(), got: Default::default(), replies: Default::default() };
    let gateway = gateway(&down);
    let asked_at = Instant::now();
    assert_eq!(said(post(&gateway, &events(&[login_failed()]), None)), 204);
    assert_eq!(said(post(&gateway, &events(&[dashboard()]), Some(&session("session-1", UNIVERSITY, "jdoe")))), 204);
    assert!(asked_at.elapsed() < Duration::from_millis(500), "{:?}", asked_at.elapsed());
}

#[test]
fn a_slow_posthog_is_never_waited_for_and_is_tried_once_more() {
    let posthog = posthog(&[Reply::Silent, Reply::Silent]);
    let gateway = gateway(&posthog);
    let asked_at = Instant::now();
    assert_eq!(said(post(&gateway, &events(&[login_failed()]), None)), 204);
    assert!(asked_at.elapsed() < Duration::from_millis(300), "{:?}", asked_at.elapsed());
    // Its first attempt waited for (400 ms here), the next one 100 ms
    // after, the same batch; then no more.
    let batches = posthog.batches(2);
    assert!(asked_at.elapsed() >= Duration::from_millis(500), "{:?}", asked_at.elapsed());
    assert_eq!(batches[0], batches[1]);
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(posthog.count(), 2);
}

#[test]
fn a_posthog_that_fails_for_a_while_is_tried_once_more_and_one_that_refuses_is_not() {
    for status in [500, 503, 429, 408] {
        let posthog = posthog(&[Reply::Status(status)]);
        assert_eq!(said(post(&gateway(&posthog), &events(&[login_failed()]), None)), 204);
        let batches = posthog.batches(2);
        assert_eq!(batches[0], batches[1], "{status}");
    }
    for status in [400, 401, 413] {
        let posthog = posthog(&[Reply::Status(status), Reply::Status(status)]);
        assert_eq!(said(post(&gateway(&posthog), &events(&[login_failed()]), None)), 204);
        assert_eq!(posthog.batches(1).len(), 1);
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(posthog.count(), 1, "{status}");
    }
}

#[test]
fn while_posthog_keeps_batches_waiting_the_ones_beyond_are_dropped() {
    let posthog = posthog(&[Reply::Silent; 8]);
    let statistics = Statistics::read(Some(KEY), settings(&[("POSTHOG_HOST", posthog.host())])).hurried(Duration::from_secs(3), Duration::from_secs(3), 2);
    let gateway = Gateway::for_tests(Vec::new(), SECRET, COOKIE_NAME).with_statistics(Some(KEY)).sending_statistics(statistics);
    for _ in 0..4 {
        assert_eq!(said(post(&gateway, &events(&[login_failed()]), None)), 204);
    }
    assert_eq!(posthog.batches(2).len(), 2);
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(posthog.count(), 2);
}

// tafac.fr: the body read by the server in front of Node, Node asked
// nothing; and what is Node's reaches it whole.
#[cfg(feature = "server")]
#[test]
fn through_the_server_the_statistics_are_answered_here_and_what_is_nodes_reaches_it() {
    use crate::proxy::{serve, Proxy};

    let posthog = posthog(&[]);
    // Node: it says what it got, and answers as its route does.
    let node = crate::tests::analytics::posthog(&[Reply::NoContent]);
    let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
    let address = listener.local_addr().unwrap().to_string();
    let proxy = Arc::new(Proxy::new(Some(gateway(&posthog)), &node.address));
    spawn(async move {
        let _ = serve(listener, proxy).await;
    });
    let send = |content_type: &str, body: &str| {
        block_on(async {
            let mut stream = tokio::net::TcpStream::connect(&address).await.unwrap();
            let request = format!("POST {ANALYTICS} HTTP/1.1\r\nhost: tafac.fr\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut answer = Vec::new();
            stream.read_to_end(&mut answer).await.unwrap();
            String::from_utf8_lossy(&answer).to_string()
        })
    };
    let body = events(&[login_failed()]).to_string();
    let answer = send("text/plain;charset=UTF-8", &body);
    assert!(answer.starts_with("HTTP/1.1 204"), "{answer}");
    assert_eq!(header_of(&answer, "cache-control"), "no-store");
    assert_eq!(posthog.events().len(), 1);
    assert_eq!(node.count(), 0);
    // Another charset: Node's, with the body it was sent.
    let answer = send("text/plain; charset=latin1", &body);
    assert!(answer.starts_with("HTTP/1.1 204"), "{answer}");
    let got = node.got.lock().unwrap().clone();
    assert_eq!(got.len(), 1);
    assert!(got[0].0.starts_with("POST /__ent_auth/analytics HTTP/1.1"), "{}", got[0].0);
    assert_eq!(got[0].1, body.as_bytes());
}
