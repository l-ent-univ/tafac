// The events kept, sent on to PostHog, behind the page's answer.
//
// Node hands them to posthog-node, which queues them and sends them in
// batches to `<POSTHOG_HOST>/batch/` (server/analytics.js: its settings).
// The page never waits for PostHog and never hears of it: an event is
// queued and the route has answered. A PostHog that is slow or down costs
// the events, nothing else:
//
//   patience     5 s for an attempt (requestTimeout), then one more attempt
//                3 s later (fetchRetryCount: 1, posthog-node's retry delay)
//                when the first failed for a reason worth trying again: no
//                answer, 408, 429 or 5xx. Then the events are dropped, and
//                the log says so, in one line a minute at most
//   at most      MAX_IN_FLIGHT batches on their way at once; the batches
//                that come while PostHog keeps that many waiting are
//                dropped (posthog-node drops the oldest of a full queue)
//
// What differs: each of the page's requests is sent as one batch at once,
// rather than queued with others for up to 10 s. Nothing waits in this
// process to be lost when it stops, and a batch is never larger than the
// page's (20 events).
//
// The batch is what posthog-node posts: `{ api_key, batch: [{ event,
// distinct_id, properties, timestamp, uuid }], sent_at }`, each event with
// `$geoip_disable` (PostHog doesn't place the server's address either) and
// `$lib`, uncompressed. tonAPI's own client sends it (tonapi-http): the one
// this crate already has, in the apps as on tafac.fr.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, SecondsFormat, Utc};
use http::header::CONTENT_TYPE;
use http::{HeaderMap, HeaderValue, Method};
use serde_json::{json, Map, Value};
use tokio::sync::Semaphore;
use tonapi_http::{Browser, BrowserOptions, CookieJar, HttpError};
use url::Url;

// posthog-node's settings, as Node's server/analytics.js gave them.
const ATTEMPT: Duration = Duration::from_millis(5000);
const ATTEMPTS: usize = 2;
const BETWEEN_ATTEMPTS: Duration = Duration::from_millis(3000);
// 1000 events, posthog-node's queue (maxQueueSize), in the page's batches.
const MAX_IN_FLIGHT: usize = 50;
// How often the log says that events were dropped, while PostHog is down.
const LOG_EVERY: Duration = Duration::from_secs(60);

// What PostHog is told sent the events, and under which name it is asked.
const LIBRARY: &str = "tafac-gateway";
const LIBRARY_VERSION: &str = env!("CARGO_PKG_VERSION");
const USER_AGENT: &str = concat!("tafac-gateway/", env!("CARGO_PKG_VERSION"));

pub(crate) struct PostHog {
    key: String,
    // `<host>/batch/`; None: a host that isn't an address, where nothing is
    // ever sent (Node's fetch fails the same way).
    batch: Option<Url>,
    in_flight: Arc<Semaphore>,
    patience: Patience,
    dropped: Arc<Mutex<Dropped>>,
}

// The events dropped since the log last said so, and when it did.
#[derive(Default)]
struct Dropped {
    said_at: Option<Instant>,
    since: usize,
}

fn dropped(log: &Mutex<Dropped>, count: usize, why: &str) {
    let Ok(mut log) = log.lock() else { return };
    log.since += count;
    if log.said_at.is_some_and(|said_at| said_at.elapsed() < LOG_EVERY) {
        return;
    }
    eprintln!("[tafac] statistics: {} events not sent to PostHog ({why})", log.since);
    *log = Dropped { said_at: Some(Instant::now()), since: 0 };
}

#[derive(Clone, Copy)]
pub(crate) struct Patience {
    pub attempt: Duration,
    pub between: Duration,
}

impl Default for Patience {
    fn default() -> Self {
        Self { attempt: ATTEMPT, between: BETWEEN_ATTEMPTS }
    }
}

// One event, as posthog-node writes it from a capture: its properties
// with what posthog-node adds to every one, a time and an id of its own.
pub(crate) fn event(name: &str, distinct_id: &str, mut properties: Map<String, Value>, now: DateTime<Utc>) -> Option<Value> {
    properties.insert("$lib".to_string(), LIBRARY.into());
    properties.insert("$lib_version".to_string(), LIBRARY_VERSION.into());
    properties.insert("$geoip_disable".to_string(), true.into());
    Some(json!({
        "event": name,
        "distinct_id": distinct_id,
        "properties": properties,
        "timestamp": iso(now),
        "uuid": uuid_v7(now)?,
    }))
}

// posthog-node's times: ISO 8601 in UTC, to the millisecond.
fn iso(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn hex_uuid(bytes: [u8; 16]) -> String {
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

pub(crate) fn random_bytes<const N: usize>() -> Option<[u8; N]> {
    use aes_gcm::aead::Generate;
    <[u8; N]>::try_generate().ok()
}

// A random id that says nothing (randomUUID: a version 4 UUID).
pub(crate) fn uuid_v4() -> Option<String> {
    let mut bytes = random_bytes::<16>()?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Some(hex_uuid(bytes))
}

// An event's id as posthog-node makes it (a version 7 UUID: the time, then
// random bits), by which PostHog takes an event sent twice once.
fn uuid_v7(now: DateTime<Utc>) -> Option<String> {
    let mut bytes = random_bytes::<16>()?;
    let millis = u64::try_from(now.timestamp_millis()).unwrap_or(0).to_be_bytes();
    bytes[..6].copy_from_slice(&millis[2..]);
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Some(hex_uuid(bytes))
}

// Why an attempt failed, and whether another is worth it.
enum Failed {
    Again(String),
    Done(String),
}

impl PostHog {
    // `key`: PostHog's project key, without the spaces around it. `host`:
    // POSTHOG_HOST as Node reads it, its slashes at the end taken off.
    pub(crate) fn new(key: &str, host: &str) -> Self {
        let batch = Url::parse(&format!("{}/batch/", host.trim_end_matches('/'))).ok().filter(|url| matches!(url.scheme(), "http" | "https"));
        Self { key: key.to_string(), batch, in_flight: Arc::new(Semaphore::new(MAX_IN_FLIGHT)), patience: Patience::default(), dropped: Default::default() }
    }

    #[cfg(test)]
    pub(crate) fn hurried(&mut self, patience: Patience, in_flight: usize) {
        self.patience = patience;
        self.in_flight = Arc::new(Semaphore::new(in_flight));
    }

    // The events of one request, sent behind its answer. Nothing to wait
    // for, nothing said back: what becomes of them is PostHog's.
    pub(crate) fn send(&self, events: Vec<Value>, now: DateTime<Utc>) {
        let Some(batch) = self.batch.clone() else { return };
        let Ok(runtime) = tokio::runtime::Handle::try_current() else { return };
        let Ok(turn) = self.in_flight.clone().try_acquire_owned() else {
            dropped(&self.dropped, events.len(), &format!("{MAX_IN_FLIGHT} batches on their way already"));
            return;
        };
        let count = events.len();
        let body = json!({ "api_key": self.key, "batch": events, "sent_at": iso(now) }).to_string();
        let (patience, log) = (self.patience, self.dropped.clone());
        runtime.spawn(async move {
            let _turn = turn;
            if let Err(why) = post(&batch, body, patience).await {
                dropped(&log, count, &why);
            }
        });
    }
}

async fn post(batch: &Url, body: String, patience: Patience) -> Result<(), String> {
    let options = BrowserOptions { extra_ca: Vec::new(), https_only: false, timeout: patience.attempt, user_agent: Some(USER_AGENT) };
    let mut browser = Browser::new(&options, CookieJar::default()).map_err(|error| error.to_string())?;
    let mut why = String::new();
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(patience.between).await;
        }
        match once(&mut browser, batch, &body, patience).await {
            Ok(()) => return Ok(()),
            Err(Failed::Again(said)) => why = said,
            Err(Failed::Done(said)) => return Err(said),
        }
    }
    Err(why)
}

async fn once(browser: &mut Browser, batch: &Url, body: &str, patience: Patience) -> Result<(), Failed> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let sent = tokio::time::timeout(patience.attempt, browser.send_bytes(Method::POST, batch.clone(), headers, Some(body.to_string()), Some(patience.attempt))).await;
    match sent {
        Err(_) => Err(Failed::Again("no answer in time".to_string())),
        Ok(Err(HttpError::Network(said))) => Err(Failed::Again(said)),
        Ok(Err(error)) => Err(Failed::Done(error.to_string())),
        Ok(Ok((status, _, _))) if status.is_success() => Ok(()),
        Ok(Ok((status, _, _))) if matches!(status.as_u16(), 408 | 429 | 500..) => Err(Failed::Again(format!("HTTP {}", status.as_u16()))),
        Ok(Ok((status, _, _))) => Err(Failed::Done(format!("HTTP {}", status.as_u16()))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_event_is_written_as_posthog_node_writes_it() {
        let now = DateTime::parse_from_rfc3339("2026-10-08T10:00:00.123Z").unwrap().with_timezone(&Utc);
        let mut properties = Map::new();
        properties.insert("device".to_string(), "mobile".into());
        let event = event("dashboard_viewed", "a1b2", properties, now).unwrap();
        assert_eq!(event["event"], "dashboard_viewed");
        assert_eq!(event["distinct_id"], "a1b2");
        assert_eq!(event["timestamp"], "2026-10-08T10:00:00.123Z");
        assert_eq!(event["properties"], json!({ "device": "mobile", "$lib": "tafac-gateway", "$lib_version": LIBRARY_VERSION, "$geoip_disable": true }));
        // A version 7 UUID, which starts with the time.
        let uuid = event["uuid"].as_str().unwrap();
        assert_eq!(uuid.len(), 36);
        assert_eq!(&uuid[14..15], "7");
        assert!(matches!(&uuid[19..20], "8" | "9" | "a" | "b"), "{uuid}");
        assert_eq!(u64::from_str_radix(&uuid[..13].replace('-', ""), 16).unwrap(), now.timestamp_millis() as u64);
    }

    #[test]
    fn a_random_id_is_a_version_4_uuid_and_never_the_same() {
        let (one, two) = (uuid_v4().unwrap(), uuid_v4().unwrap());
        assert_ne!(one, two);
        assert_eq!(one.len(), 36);
        assert_eq!(&one[14..15], "4");
        assert!(one.bytes().all(|byte| byte == b'-' || byte.is_ascii_hexdigit()));
    }

    #[test]
    fn the_log_says_the_events_dropped_once_a_minute_at_most() {
        let log = Mutex::new(Dropped::default());
        dropped(&log, 3, "down");
        assert_eq!(log.lock().unwrap().since, 0);
        dropped(&log, 2, "down");
        dropped(&log, 4, "down");
        // Said on the next line, a minute later.
        assert_eq!(log.lock().unwrap().since, 6);
        log.lock().unwrap().said_at = Instant::now().checked_sub(LOG_EVERY);
        dropped(&log, 1, "down");
        assert_eq!(log.lock().unwrap().since, 0);
    }

    #[test]
    fn the_batch_goes_to_the_hosts_own_batch_path() {
        assert_eq!(PostHog::new("k", "https://eu.i.posthog.com").batch.unwrap().as_str(), "https://eu.i.posthog.com/batch/");
        assert_eq!(PostHog::new("k", "https://ph.exemple.test/ingest//").batch.unwrap().as_str(), "https://ph.exemple.test/ingest/batch/");
        assert!(PostHog::new("k", "not an address").batch.is_none());
        assert!(PostHog::new("k", "ftp://ph.exemple.test").batch.is_none());
    }
}
