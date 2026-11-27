// The mail page's routes on the made-up campus (its webmail: testing/
// webmail.rs): the webmail signed in to with the CAS ticket, once, and
// again when it forgets the session; Node's JSON and statuses; the checks
// before a route (another site, no session, the body); the part's headers;
// an upload; a sign-out that ends the webmail's session too.

use http::header::{CONTENT_LENGTH, CONTENT_TYPE, TRANSFER_ENCODING};
use http::{HeaderMap, HeaderValue, Method};
use serde_json::json;

use super::{asked, body_of, never, Node, GET, LOGOUT, NO_HEADERS, POST};
use crate::testing::*;
use crate::{Gateway, ANSWERED_BY};

const RECENT: &str = "/__ent_auth/mail/recent";
const WEBMAIL_SIGN_IN: &str = "/webmail/sso";
const SEARCH: &str = "/service/soap/SearchRequest";

fn answer(gateway: &Gateway, method: &Method, target: &str, headers: &HeaderMap, body: &[u8], cookie: Option<&str>) -> http::Response<Vec<u8>> {
    block_on(gateway.answer(&asked(method, target, headers, body), || cookie.map(str::to_string), never)).expect("every mail path is answered here")
}

fn get(gateway: &Gateway, target: &str, cookie: Option<&str>) -> http::Response<Vec<u8>> {
    answer(gateway, &GET, target, &NO_HEADERS, &[], cookie)
}

fn json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers
}

fn post(gateway: &Gateway, target: &str, body: &serde_json::Value, cookie: Option<&str>) -> http::Response<Vec<u8>> {
    let body = body.to_string().into_bytes();
    let mut headers = json_headers();
    headers.insert(CONTENT_LENGTH, HeaderValue::from(body.len()));
    answer(gateway, &POST, target, &headers, &body, cookie)
}

fn ok_json(response: &http::Response<Vec<u8>>) -> serde_json::Value {
    assert_eq!(response.status(), 200, "{}", String::from_utf8_lossy(response.body()));
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["x-robots-tag"], "noindex, nofollow, noarchive");
    body_of(response)
}

#[test]
fn the_inbox_is_read_with_one_sign_in_and_its_first_page_kept() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let said = ok_json(&get(&gateway, RECENT, Some(&cookie)));
    assert_eq!(said["authenticated"], true);
    assert_eq!(said["sessionMode"], serde_json::Value::Null);
    let mail = &said["mail"];
    assert_eq!(mail["unreadCount"], 3);
    assert_eq!(mail["webmailHref"], "/__ent_auth/mail/open");
    assert_eq!(mail["hasMore"], false);
    let ids: Vec<&str> = mail["messages"].as_array().unwrap().iter().map(|row| row["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["300", "-301"]);
    // The webmail was signed in to with the CAS ticket.
    let seen = campus.seen.lock().unwrap().clone();
    assert!(seen.iter().any(|(path, cookies)| path.starts_with("/cas/login") && cookies.contains("TGC=the-ticket")));
    assert_eq!(campus.asked(WEBMAIL_SIGN_IN), 1);

    // The first page again: kept. `fresh=1`: asked again, no new sign-in.
    ok_json(&get(&gateway, RECENT, Some(&cookie)));
    assert_eq!(campus.posted_to(SEARCH), 1);
    ok_json(&get(&gateway, &format!("{RECENT}?fresh=1"), Some(&cookie)));
    assert_eq!((campus.posted_to(SEARCH), campus.asked(WEBMAIL_SIGN_IN)), (2, 1));

    // The webmail forgot the session: signed in again once, and answered.
    campus.webmail_forgets();
    ok_json(&get(&gateway, &format!("{RECENT}?fresh=1"), Some(&cookie)));
    assert_eq!(campus.asked(WEBMAIL_SIGN_IN), 2);
}

#[test]
fn without_a_session_each_route_says_so_in_its_own_words() {
    let campus = campus();
    let gateway = campus.gateway();
    let recent = get(&gateway, RECENT, None);
    assert_eq!(ok_json(&recent), json!({ "authenticated": false, "mail": null }));
    assert_eq!(recent.headers()["x-tafac-session"], "expired");
    let part = get(&gateway, "/__ent_auth/mail/part?id=x&part=y", None);
    assert_eq!((part.status().as_u16(), part.body().len()), (404, 0));
    assert_eq!(part.headers()["cache-control"], "no-store");
    let folders = get(&gateway, "/__ent_auth/mail/folders", None);
    assert_eq!((folders.status().as_u16(), body_of(&folders)), (401, json!({ "error": "Authentication required." })));
    // Nothing was asked of the campus.
    assert!(campus.paths().is_empty());
}

#[test]
fn every_mail_path_is_answered_here_in_any_case() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    assert_eq!(ok_json(&get(&gateway, "/__ent_auth/MAIL/Recent/", Some(&cookie)))["authenticated"], true);
    let unknown = get(&gateway, "/__ent_auth/mail/nothing", Some(&cookie));
    assert_eq!(unknown.status(), 404);
}

#[test]
fn folders_and_what_is_done_to_messages() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let folders = ok_json(&get(&gateway, "/__ent_auth/mail/folders", Some(&cookie)));
    let ids: Vec<&str> = folders["folders"].as_array().unwrap().iter().map(|folder| folder["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&"2") && ids.contains(&"257"));

    let action = "/__ent_auth/mail/action";
    assert_eq!(ok_json(&post(&gateway, action, &json!({ "ids": ["300", 301], "action": "move", "folder": "257" }), Some(&cookie))), json!({ "ok": true }));
    assert_eq!(campus.posted_to("/service/soap/MsgActionRequest"), 1);
    for (body, said) in [
        (json!({ "ids": ["300"], "action": "move", "folder": "999" }), "Invalid folder."),
        (json!({ "ids": ["300"], "action": "__proto__" }), "Invalid action."),
        (json!({ "ids": ["٣٠٠"], "action": "read" }), "Invalid message ids."),
        (json!({ "ids": [], "action": "read" }), "Invalid message ids."),
    ] {
        let refused = post(&gateway, action, &body, Some(&cookie));
        assert_eq!((refused.status().as_u16(), body_of(&refused)), (400, json!({ "error": said })), "{body}");
    }
    // Only the move asked the webmail.
    assert_eq!(campus.posted_to("/service/soap/MsgActionRequest"), 1);

    // A form or text from another site: no body read, nothing done.
    let mut text = HeaderMap::new();
    text.insert(CONTENT_TYPE, HeaderValue::from_static("text/plain"));
    text.insert(CONTENT_LENGTH, HeaderValue::from_static("40"));
    let refused = answer(&gateway, &POST, action, &text, br#"{"ids":["300"],"action":"read"}"#, Some(&cookie));
    assert_eq!((refused.status().as_u16(), body_of(&refused)), (400, json!({ "error": "Invalid message ids." })));

    let folder_action = "/__ent_auth/mail/folder-action";
    assert_eq!(ok_json(&post(&gateway, folder_action, &json!({ "folder": "3", "action": "empty" }), Some(&cookie))), json!({ "ok": true }));
    for body in [json!({ "folder": "2", "action": "empty" }), json!({ "folder": "1", "action": "read" }), json!({ "folder": "999", "action": "read" })] {
        assert_eq!(post(&gateway, folder_action, &body, Some(&cookie)).status(), 400, "{body}");
    }
}

#[test]
fn another_site_is_refused_before_anything_is_read() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    for site in ["cross-site", "same-site", "none", "Same-Origin"] {
        let mut headers = json_headers();
        headers.insert("sec-fetch-site", HeaderValue::from_static(site));
        for (method, target) in [
            (&POST, "/__ent_auth/mail/action"),
            (&POST, "/__ent_auth/mail/folder-action"),
            (&POST, "/__ent_auth/mail/send"),
            (&POST, "/__ent_auth/mail/draft"),
            (&POST, "/__ent_auth/mail/signature"),
            (&POST, "/__ent_auth/mail/upload"),
            (&GET, "/__ent_auth/mail/autocomplete?q=alex"),
            (&GET, "/__ent_auth/mail/signatures"),
        ] {
            let refused = answer(&gateway, method, target, &headers, b"{}", Some(&cookie));
            assert_eq!((refused.status().as_u16(), body_of(&refused)), (403, json!({ "error": "Cross-site request." })), "{site} {target}");
        }
        // The open link from another site: the webmail's own link, signed out (W9).
        let open = answer(&gateway, &GET, "/__ent_auth/mail/open", &headers, &[], Some(&cookie));
        assert_eq!(open.status(), 302);
        assert!(open.headers()["location"].to_str().unwrap().starts_with("/__ent_auth/launch?url="));
    }
    assert!(campus.paths().is_empty());
    // The same header given twice is refused too.
    let mut twice = json_headers();
    twice.append("sec-fetch-site", HeaderValue::from_static("same-origin"));
    twice.append("sec-fetch-site", HeaderValue::from_static("same-origin"));
    assert_eq!(answer(&gateway, &POST, "/__ent_auth/mail/action", &twice, b"{}", Some(&cookie)).status(), 403);
}

#[test]
fn a_part_is_inert_wherever_it_is_opened() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let image = get(&gateway, "/__ent_auth/mail/part?id=300&part=2", Some(&cookie));
    assert_eq!(image.status(), 200);
    assert_eq!(image.body(), b"PNGDATA");
    assert_eq!(image.headers()["content-type"], "image/png");
    assert!(image.headers()["content-disposition"].to_str().unwrap().starts_with("inline"));
    assert_eq!(image.headers()["cache-control"], "no-store");
    assert_eq!(image.headers()["referrer-policy"], "no-referrer");
    assert_eq!(image.headers().get_all("content-security-policy").iter().count(), 1);
    assert!(image.headers()["content-security-policy"].to_str().unwrap().starts_with("default-src 'none'; sandbox"));

    // HTML downloads, never shown.
    let page = get(&gateway, "/__ent_auth/mail/part?id=300&part=3&download=1", Some(&cookie));
    assert!(page.headers()["content-disposition"].to_str().unwrap().starts_with("attachment"));

    for target in ["/__ent_auth/mail/part?id=300&part=a", "/__ent_auth/mail/part?id=300&id=301&part=2", "/__ent_auth/mail/part?id=３００&part=2"] {
        let refused = get(&gateway, target, Some(&cookie));
        assert_eq!((refused.status().as_u16(), refused.body().len()), (400, 0), "{target}");
    }
    let missing = get(&gateway, "/__ent_auth/mail/part?id=300&part=9", Some(&cookie));
    assert_eq!(missing.status(), 404);
}

#[test]
fn prefs_and_suggestions() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let prefs = ok_json(&get(&gateway, "/__ent_auth/mail/prefs", Some(&cookie)));
    assert_eq!(prefs["markRead"], 0);
    assert!(prefs["attachments"]["maxFileBytes"].as_u64().unwrap() < 10_485_760);
    assert_eq!(prefs["identities"], json!([{ "id": "default-id", "name": "Camille Demo", "email": "camille.demo@exemple.test" }]));

    let suggestions = ok_json(&get(&gateway, "/__ent_auth/mail/autocomplete?q=alex", Some(&cookie)));
    assert_eq!(suggestions["suggestions"][0]["email"], "alex.martin@exemple.test");
    // Too short: nothing asked.
    let before = campus.posted_to("/service/soap/AutoCompleteRequest");
    assert_eq!(ok_json(&get(&gateway, "/__ent_auth/mail/autocomplete?q=a", Some(&cookie))), json!({ "suggestions": [] }));
    assert_eq!(campus.posted_to("/service/soap/AutoCompleteRequest"), before);
}

#[test]
fn an_upload_is_refused_before_its_body_and_remembered_once_sent() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let upload = "/__ent_auth/mail/upload";
    let file = b"%PDF-1.7 de test";
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/pdf"));
    headers.insert("content-disposition", HeaderValue::from_static("attachment; filename*=UTF-8''rapport%20final.pdf"));
    headers.insert(CONTENT_LENGTH, HeaderValue::from(file.len()));
    let sent = answer(&gateway, &POST, upload, &headers, file, Some(&cookie));
    let said = ok_json(&sent);
    assert_eq!(said["attachment"]["name"], "rapport final.pdf");
    assert_eq!(said["attachment"]["size"], file.len());
    assert_eq!(said["attachment"]["contentType"], "application/pdf");

    let mut chunked = headers.clone();
    chunked.insert(TRANSFER_ENCODING, HeaderValue::from_static("chunked"));
    let refused = answer(&gateway, &POST, upload, &chunked, file, Some(&cookie));
    assert_eq!((refused.status().as_u16(), refused.headers()["connection"].to_str().unwrap()), (411, "close"));
    let mut empty = headers.clone();
    empty.insert(CONTENT_LENGTH, HeaderValue::from_static("0"));
    assert_eq!(answer(&gateway, &POST, upload, &empty, &[], Some(&cookie)).status(), 400);
    let mut huge = headers.clone();
    huge.insert(CONTENT_LENGTH, HeaderValue::from_static("60000000"));
    let too_large = answer(&gateway, &POST, upload, &huge, &[], Some(&cookie));
    assert_eq!((too_large.status().as_u16(), body_of(&too_large)["maxBytes"].as_u64()), (413, Some(50 * 1024 * 1024)));
    // More than declared: cut, never passed on whole.
    let mut short = headers.clone();
    short.insert(CONTENT_LENGTH, HeaderValue::from_static("4"));
    assert_eq!(answer(&gateway, &POST, upload, &short, file, Some(&cookie)).status(), 413);
    assert_eq!(answer(&gateway, &POST, upload, &headers, file, None).status(), 401);
}

#[test]
fn a_sign_out_ends_the_webmails_session_too() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    ok_json(&get(&gateway, RECENT, Some(&cookie)));
    let out = block_on(gateway.answer(&asked(&POST, LOGOUT, &NO_HEADERS, &[]), || Some(cookie.clone()), |request| node.ask(request))).unwrap();
    assert_eq!(out.status(), 200);
    assert_eq!(campus.posted_to("/service/soap/EndSessionRequest"), 1);
    // The old cookie gets nothing of the mail: nobody is signed in.
    let after = get(&gateway, RECENT, Some(&cookie));
    assert_eq!(ok_json(&after), json!({ "authenticated": false, "mail": null }));
    assert_eq!(campus.posted_to(SEARCH), 1);
}

#[test]
fn a_message_is_cleaned_for_the_reader() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let mut headers = HeaderMap::new();
    headers.insert("host", HeaderValue::from_static("127.0.0.1"));
    let said = ok_json(&answer(&gateway, &GET, "/__ent_auth/mail/message?id=300", &headers, &[], Some(&cookie)));
    let message = &said["message"];
    let html = message["html"].as_str().unwrap();
    assert!(!html.contains("<script"), "{html}");
    // A link to Tafac's own host is dropped (W6), another site's kept.
    assert!(!html.contains("__ent_auth/launch"), "{html}");
    assert!(html.contains("https://exemple.test/"), "{html}");
    // The remote image is held back, the inline one by Tafac's own route.
    assert_eq!(message["remoteImages"], 1);
    assert!(html.contains("/__ent_auth/mail/part?id=300&amp;part=2") || html.contains("/__ent_auth/mail/part?id=300&part=2"), "{html}");
    let attachments = message["attachments"].as_array().unwrap();
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments[0]["name"], "rapport.pdf");
    assert!(attachments[0]["href"].as_str().unwrap().starts_with("/__ent_auth/mail/part?"));
    assert_eq!(message["from"]["email"], "scolarite@exemple.test");

    let missing = get(&gateway, "/__ent_auth/mail/message?id=999", Some(&cookie));
    assert_eq!((missing.status().as_u16(), body_of(&missing)), (404, json!({ "error": "No such message." })));
    let invalid = get(&gateway, "/__ent_auth/mail/message?id=abc", Some(&cookie));
    assert_eq!(invalid.status(), 400);
}

#[test]
fn a_mail_is_sent_once_from_the_accounts_own_address() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let body = json!({
        "to": [{ "name": "Alex Martin", "email": "alex.martin@exemple.test" }],
        "subject": "Bonjour",
        "html": "<p>Salut <b>Alex</b></p><script>alert(1)</script>",
        "sendUid": "uid-0000000001",
        "from": "boss@exemple.test",
        "signature": { "include": true, "mode": "auto", "html": "<script>x</script>" },
    });
    assert_eq!(ok_json(&post(&gateway, "/__ent_auth/mail/send", &body, Some(&cookie))), json!({ "ok": true }));
    // The same uid again: the first answer, not a second send.
    assert_eq!(ok_json(&post(&gateway, "/__ent_auth/mail/send", &body, Some(&cookie))), json!({ "ok": true }));
    let sent = campus.soap_sent("SendMsgRequest");
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["suid"], "uid-0000000001");
    let message = &sent[0]["m"];
    let from: Vec<&serde_json::Value> = message["e"].as_array().unwrap().iter().filter(|entry| entry["t"] == "f").collect();
    assert_eq!(from[0]["a"], "camille.demo@exemple.test");
    let written = message.to_string();
    assert!(!written.contains("boss@exemple.test") && !written.contains("<script"), "{written}");
    // The signature the university's settings make, its name the identity's.
    assert!(written.contains("Camille Demo"), "{written}");

    let refused = post(&gateway, "/__ent_auth/mail/send", &json!({ "to": [], "sendUid": "uid-0000000002" }), Some(&cookie));
    assert_eq!(refused.status(), 422);
    let unknown = post(&gateway, "/__ent_auth/mail/send", &json!({ "to": [{ "email": "a@exemple.test" }], "sendUid": "uid-0000000003", "attachments": [{ "source": "upload", "aid": "someone-elses-aid" }] }), Some(&cookie));
    assert_eq!((unknown.status().as_u16(), body_of(&unknown)["error"].as_str()), (409, Some("mail_send_upload_expired")));
    assert_eq!(campus.soap_sent("SendMsgRequest").len(), 1);
}

#[test]
fn a_draft_is_saved_and_read_back_cleaned() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let saved = ok_json(&post(&gateway, "/__ent_auth/mail/draft", &json!({ "to": [{ "email": "pas-encore" }], "subject": "Brouillon", "html": "<p>Presque</p>" }), Some(&cookie)));
    assert_eq!(saved["draft"]["id"], "401");
    let draft = ok_json(&get(&gateway, "/__ent_auth/mail/draft?id=400", Some(&cookie)));
    let html = draft["draft"]["html"].as_str().unwrap();
    assert!(html.contains("Presque fini") && !html.contains("script"), "{html}");
    assert_eq!(draft["draft"]["to"][0]["email"], "alex.martin@exemple.test");
    // Not a draft (an inbox mail), a negative id: refused.
    assert_eq!(get(&gateway, "/__ent_auth/mail/draft?id=300", Some(&cookie)).status(), 404);
    assert_eq!(get(&gateway, "/__ent_auth/mail/draft?id=-400", Some(&cookie)).status(), 400);
}

#[test]
fn the_signatures_and_the_custom_one_written() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let said = ok_json(&get(&gateway, "/__ent_auth/mail/signatures", Some(&cookie)));
    assert_eq!(said["signatures"][0]["id"], "sig-partage");
    assert_eq!(said["signatures"][0]["hasImages"], true);
    assert!(!said["signatures"][0]["html"].as_str().unwrap().contains("<img"));
    assert_eq!(said["customId"], serde_json::Value::Null);

    let written = ok_json(&post(&gateway, "/__ent_auth/mail/signature", &json!({ "text": "Camille" }), Some(&cookie)));
    assert_eq!(written["customId"], "sig-tafac");
    let created = campus.soap_sent("CreateSignatureRequest");
    assert_eq!(created[0]["signature"]["name"], "Tafac");
    let too_long = post(&gateway, "/__ent_auth/mail/signature", &json!({ "text": "x".repeat(2001) }), Some(&cookie));
    assert_eq!((too_long.status().as_u16(), body_of(&too_long)), (413, json!({ "error": "mail_signature_too_long" })));
    let invalid = post(&gateway, "/__ent_auth/mail/signature", &json!({ "text": 3 }), Some(&cookie));
    assert_eq!(invalid.status(), 400);
}

// A cookie that is nobody's (not readable here, the demo account's from
// before): answered here as no session, never handed to Node (whose mail
// routes the gateway's checks would be skipped by).
#[test]
fn a_cookie_that_is_nobodys_is_answered_here_as_no_session() {
    let campus = campus();
    let gateway = campus.gateway();
    for cookie in ["garbage", "v1.AAAA"] {
        let recent = get(&gateway, "/__ent_auth/MAIL/recent", Some(cookie));
        assert_eq!(recent.status(), 200);
        assert_eq!(body_of(&recent), json!({ "authenticated": false, "mail": null }));
        let part = get(&gateway, "/__ent_auth/mail/part?id=300&part=2", Some(cookie));
        assert_eq!(part.status(), 404);
        let action = post(&gateway, "/__ent_auth/mail/action", &json!({ "ids": ["300"], "action": "read" }), Some(cookie));
        assert_eq!(action.status(), 401);
        assert_eq!(action.headers()["connection"], "close");
    }
}
