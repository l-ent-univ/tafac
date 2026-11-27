// The mail routes' limits, with Node's numbers (server/entAuthApp.js,
// server/mailSend.js, server/mailUpload.js): the page gets the same 429
// and the same wait whichever side answers.
//
//   MailBucket     every mail route but the upload: a token bucket per
//                  session, 60 at once, 5 more a second
//   UploadLimiter  the uploads: 20 a minute, 300 MiB declared an hour,
//                  3 at once
//   SendLimiter    sends (5 a minute, 100 and 500 recipients a day),
//                  drafts (20 a minute, 1000 a day), the signature's
//                  writes (10 a minute, 100 a day)
//   SendOnce       a send asked twice with the same uid: the first one's
//                  outcome, not a second mail
//   ByteCounter    an upload's bytes as they pass, never more than declared
//
// Each check and what it counts happen under one lock: two requests at once
// can't both pass the last place. Counted in this process: a restart
// forgets them. The sends', the drafts' and the uploads' limits are kept
// per session and per user (limit_keys): signing in again doesn't start a
// new count.
//
// Time is a parameter of each `…_at` method, for the tests.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use tokio::sync::watch;

const MINUTE: Duration = Duration::from_secs(60);
const HOUR: Duration = Duration::from_secs(60 * 60);
const DAY: Duration = Duration::from_secs(24 * 60 * 60);
// How often the idle entries are looked over, at most.
const PRUNE_EVERY: Duration = MINUTE;

// A lock whose holder panicked is still the same counts.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

// Whole seconds until `until`, rounded up, 1 at least (Retry-After).
fn seconds_until(until: Instant, now: Instant) -> u64 {
    let nanos = until.saturating_duration_since(now).as_nanos();
    u64::try_from(nanos.div_ceil(1_000_000_000)).unwrap_or(u64::MAX).max(1)
}

fn due(pruned_at: Option<Instant>, now: Instant) -> bool {
    pruned_at.is_none_or(|at| now.saturating_duration_since(at) > PRUNE_EVERY)
}

// The keys a session's sends, drafts and uploads are counted under: its own
// and its user's (the login, lowercased), when it has one.
pub(crate) fn limit_keys(session_id: &str, user: Option<&str>) -> Vec<String> {
    let mut keys = vec![session_key(session_id)];
    keys.extend(user.filter(|user| !user.is_empty()).map(|user| format!("user:{}", user.to_lowercase())));
    keys
}

fn session_key(session_id: &str) -> String {
    format!("session:{session_id}")
}

// ── The mail routes' bucket ─────────────────────────────────────────────────

pub(crate) const BUCKET_BURST: f64 = 60.0;
pub(crate) const BUCKET_PER_SECOND: f64 = 5.0;

struct Bucket {
    tokens: f64,
    updated: Instant,
}

#[derive(Default)]
struct BucketState {
    buckets: HashMap<String, Bucket>,
    pruned_at: Option<Instant>,
}

// takeMailRateLimitToken: keyed by the session cookie's id, even for a
// session otherwise refused; a request without one isn't counted (it gets
// its 401). A send or a draft takes its token before its body is read, and
// only then.
#[derive(Default)]
pub(crate) struct MailBucket {
    state: Mutex<BucketState>,
}

impl MailBucket {
    // One mail request for this session: None when it may go, else the
    // seconds until a token is back (Retry-After).
    pub(crate) fn take(&self, session_id: &str) -> Option<u64> {
        self.take_at(session_id, Instant::now())
    }

    pub(crate) fn forget_session(&self, session_id: &str) {
        lock(&self.state).buckets.remove(session_id);
    }

    fn take_at(&self, session_id: &str, now: Instant) -> Option<u64> {
        if session_id.is_empty() {
            return None;
        }
        let mut state = lock(&self.state);
        // A bucket refills to full in BURST / PER_SECOND seconds: one idle
        // longer is the same as none.
        if due(state.pruned_at, now) {
            state.pruned_at = Some(now);
            let full_after = Duration::from_secs_f64(BUCKET_BURST / BUCKET_PER_SECOND);
            state.buckets.retain(|_, bucket| now.saturating_duration_since(bucket.updated) <= full_after);
        }
        let tokens = state.buckets.get(session_id).map_or(BUCKET_BURST, |bucket| (bucket.tokens + now.saturating_duration_since(bucket.updated).as_secs_f64() * BUCKET_PER_SECOND).min(BUCKET_BURST));
        if tokens < 1.0 {
            state.buckets.insert(session_id.to_string(), Bucket { tokens, updated: now });
            // Math.max(1, Math.ceil((1 - tokens) / PER_SECOND)).
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let wait = ((1.0 - tokens) / BUCKET_PER_SECOND).ceil().max(1.0) as u64;
            return Some(wait);
        }
        state.buckets.insert(session_id.to_string(), Bucket { tokens: tokens - 1.0, updated: now });
        None
    }
}

// ── The uploads ─────────────────────────────────────────────────────────────

pub(crate) const UPLOADS_PER_MINUTE: usize = 20;
pub(crate) const UPLOAD_BYTES_PER_HOUR: u64 = 300 * 1024 * 1024;
pub(crate) const UPLOADS_AT_ONCE: u32 = 3;
// The wait said while too many are under way.
const AT_ONCE_WAIT: u64 = 5;

struct UploadEvent {
    id: u64,
    at: Instant,
    bytes: u64,
}

#[derive(Default)]
struct UploadKey {
    events: Vec<UploadEvent>,
    active: u32,
}

#[derive(Default)]
struct UploadState {
    keys: HashMap<String, UploadKey>,
    pruned_at: Option<Instant>,
    next_id: u64,
}

// createUploadLimiter: uploads begun in any minute, bytes declared in any
// hour, and uploads under way, per key. The declared length is counted
// when one begins, then settled once to what came (min(declared,
// received)): a cancelled upload counts what it sent.
pub(crate) struct UploadLimiter {
    state: Arc<Mutex<UploadState>>,
    per_minute: usize,
    bytes_per_hour: u64,
    at_once: u32,
}

impl Default for UploadLimiter {
    fn default() -> Self {
        Self::new(UPLOADS_PER_MINUTE, UPLOAD_BYTES_PER_HOUR, UPLOADS_AT_ONCE)
    }
}

// An upload under way. Settled once (settle), or when dropped: then as if
// all it declared came.
pub(crate) struct UploadSlot {
    state: Arc<Mutex<UploadState>>,
    keys: Vec<String>,
    id: u64,
    declared: u64,
    settled: bool,
}

impl UploadSlot {
    // The upload is over (done, refused, cancelled): `received` bytes came.
    // Only the first call counts.
    pub(crate) fn settle(&mut self, received: u64) {
        if std::mem::replace(&mut self.settled, true) {
            return;
        }
        let bytes = received.min(self.declared);
        let mut state = lock(&self.state);
        for key in &self.keys {
            let Some(entry) = state.keys.get_mut(key) else { continue };
            entry.active = entry.active.saturating_sub(1);
            if let Some(event) = entry.events.iter_mut().find(|event| event.id == self.id) {
                event.bytes = bytes;
            }
        }
    }
}

impl Drop for UploadSlot {
    fn drop(&mut self) {
        self.settle(self.declared);
    }
}

impl UploadLimiter {
    pub(crate) fn new(per_minute: usize, bytes_per_hour: u64, at_once: u32) -> Self {
        Self { state: Arc::default(), per_minute, bytes_per_hour, at_once }
    }

    // An upload of `declared` bytes for these keys (limit_keys): its slot,
    // or the seconds to wait (the longest of the keys').
    pub(crate) fn take(&self, keys: &[String], declared: u64) -> Result<UploadSlot, u64> {
        self.take_at(keys, declared, Instant::now())
    }

    pub(crate) fn forget_session(&self, session_id: &str) {
        lock(&self.state).keys.remove(&session_key(session_id));
    }

    fn take_at(&self, keys: &[String], declared: u64, now: Instant) -> Result<UploadSlot, u64> {
        let mut state = lock(&self.state);
        if due(state.pruned_at, now) {
            state.pruned_at = Some(now);
            state.keys.retain(|_, entry| {
                entry.events.retain(|event| now.saturating_duration_since(event.at) < HOUR);
                !entry.events.is_empty() || entry.active > 0
            });
        }
        let mut wait = 0;
        for key in keys {
            let entry = state.keys.entry(key.clone()).or_default();
            entry.events.retain(|event| now.saturating_duration_since(event.at) < HOUR);
            wait = wait.max(self.wait(entry, declared, now));
        }
        if wait > 0 {
            return Err(wait);
        }
        state.next_id += 1;
        let id = state.next_id;
        for key in keys {
            let entry = state.keys.entry(key.clone()).or_default();
            entry.events.push(UploadEvent { id, at: now, bytes: declared });
            entry.active += 1;
        }
        Ok(UploadSlot { state: Arc::clone(&self.state), keys: keys.to_vec(), id, declared, settled: false })
    }

    // The first limit a key is at, in Node's order: at once, per minute,
    // bytes per hour. 0 when none.
    fn wait(&self, entry: &UploadKey, declared: u64, now: Instant) -> u64 {
        if entry.active >= self.at_once {
            return AT_ONCE_WAIT;
        }
        let last_minute: Vec<&UploadEvent> = entry.events.iter().filter(|event| now.saturating_duration_since(event.at) < MINUTE).collect();
        if last_minute.len() >= self.per_minute {
            return seconds_until(last_minute[0].at + MINUTE, now);
        }
        let hour_bytes: u64 = entry.events.iter().map(|event| event.bytes).sum();
        if hour_bytes + declared > self.bytes_per_hour {
            // When enough of the hour's bytes have aged out.
            let mut freed = 0;
            let mut until = now + HOUR;
            for event in &entry.events {
                freed += event.bytes;
                if hour_bytes - freed + declared <= self.bytes_per_hour {
                    until = event.at + HOUR;
                    break;
                }
            }
            return seconds_until(until, now);
        }
        0
    }
}

// ── Sends, drafts, the signature's writes ───────────────────────────────────

struct SendEvent {
    id: u64,
    at: Instant,
    recipients: u64,
}

#[derive(Default)]
struct SendState {
    keys: HashMap<String, Vec<SendEvent>>,
    pruned_at: Option<Instant>,
    next_id: u64,
}

// createSendLimiter: sends (or saves) per key over sliding windows, a
// minute and a day, and recipients a day where there is such a limit. A
// send counts one for every key, when all of them allow it.
pub(crate) struct SendLimiter {
    state: Arc<Mutex<SendState>>,
    per_minute: usize,
    per_day: usize,
    recipients_per_day: Option<u64>,
}

// A send counted. Released when the server itself refuses it before
// anything went (an identity not the account's, an upload gone): its count
// is given back. Dropped, it stays counted.
pub(crate) struct SendSlot {
    state: Arc<Mutex<SendState>>,
    keys: Vec<String>,
    id: u64,
}

impl SendSlot {
    pub(crate) fn release(self) {
        let mut state = lock(&self.state);
        for key in &self.keys {
            if let Some(events) = state.keys.get_mut(key) {
                events.retain(|event| event.id != self.id);
            }
        }
    }
}

impl SendLimiter {
    pub(crate) fn new(per_minute: usize, per_day: usize, recipients_per_day: Option<u64>) -> Self {
        Self { state: Arc::default(), per_minute, per_day, recipients_per_day }
    }

    // MAIL_SEND_*: keyed `session:<id>` and `user:<login>` (limit_keys).
    pub(crate) fn sends() -> Self {
        Self::new(5, 100, Some(500))
    }

    // MAIL_DRAFT_*: per session and per user too (Node: per session only).
    pub(crate) fn drafts() -> Self {
        Self::new(20, 1000, None)
    }

    // MAIL_SIGNATURE_*: the custom signature's writes, per session;
    // released when Zimbra refuses it (TOO_MANY_SIGNATURES, TOO_LONG).
    pub(crate) fn signatures() -> Self {
        Self::new(10, 100, None)
    }

    // One more for every key, `recipients` of them (0 where not counted):
    // its slot, or the seconds to wait (the longest of the keys').
    pub(crate) fn take(&self, keys: &[String], recipients: u64) -> Result<SendSlot, u64> {
        self.take_at(keys, recipients, Instant::now())
    }

    pub(crate) fn forget_session(&self, session_id: &str) {
        lock(&self.state).keys.remove(&session_key(session_id));
    }

    fn take_at(&self, keys: &[String], recipients: u64, now: Instant) -> Result<SendSlot, u64> {
        let mut state = lock(&self.state);
        // Keys idle for a day are forgotten.
        if due(state.pruned_at, now) {
            state.pruned_at = Some(now);
            state.keys.retain(|_, events| {
                events.retain(|event| now.saturating_duration_since(event.at) < DAY);
                !events.is_empty()
            });
        }
        let mut wait = 0;
        for key in keys {
            let events = state.keys.entry(key.clone()).or_default();
            events.retain(|event| now.saturating_duration_since(event.at) < DAY);
            wait = wait.max(self.wait(events, recipients, now));
        }
        if wait > 0 {
            return Err(wait);
        }
        state.next_id += 1;
        let id = state.next_id;
        for key in keys {
            state.keys.entry(key.clone()).or_default().push(SendEvent { id, at: now, recipients });
        }
        Ok(SendSlot { state: Arc::clone(&self.state), keys: keys.to_vec(), id })
    }

    // When the key may send again, as seconds from now; 0 now.
    fn wait(&self, events: &[SendEvent], recipients: u64, now: Instant) -> u64 {
        let mut until: Option<Instant> = None;
        let mut later = |at: Instant| until = Some(until.map_or(at, |until| until.max(at)));
        let minute: Vec<&SendEvent> = events.iter().filter(|event| now.saturating_duration_since(event.at) < MINUTE).collect();
        if self.per_minute > 0 && minute.len() >= self.per_minute {
            later(minute[minute.len() - self.per_minute].at + MINUTE);
        }
        if self.per_day > 0 && events.len() >= self.per_day {
            later(events[events.len() - self.per_day].at + DAY);
        }
        if let Some(cap) = self.recipients_per_day {
            // The oldest sends to age out before these recipients fit.
            let mut total = events.iter().map(|event| event.recipients).sum::<u64>() + recipients;
            for event in events {
                if total <= cap {
                    break;
                }
                total -= event.recipients;
                later(event.at + DAY);
            }
            if recipients > cap {
                later(now + DAY);
            }
        }
        until.filter(|until| *until > now).map_or(0, |until| seconds_until(until, now))
    }
}

// ── A send asked twice ──────────────────────────────────────────────────────

pub(crate) const SEND_ONCE_TTL: Duration = Duration::from_secs(10 * 60);
pub(crate) const SEND_ONCE_PER_SESSION: usize = 20;

// The outcome a send shares; None while it goes.
type Shared<T, E> = Option<Result<T, E>>;

struct OnceEntry<T, E> {
    uid: String,
    id: u64,
    at: Instant,
    outcome: watch::Receiver<Shared<T, E>>,
}

struct OnceState<T, E> {
    sessions: HashMap<String, Vec<OnceEntry<T, E>>>,
    pruned_at: Option<Instant>,
    next_id: u64,
}

// createSendOnce: the sends a session asked for, by the page's send uid.
// The page tries a send once more, with the same uid, when its answer never
// came: the first one may have gone through all the same, its uploads used
// and forgotten since. So a uid seen shares the first one's outcome: its
// answer once sent, the same wait while it goes. A send that failed is
// forgotten, for a later try to go (Zimbra's suid covers one that went
// through all the same). 10 minutes, 20 uids a session.
//
// `begin` is not async: the entry exists before the first send's first
// await, so two requests at once can't both send.
pub(crate) struct SendOnce<T, E> {
    state: Arc<Mutex<OnceState<T, E>>>,
    ttl: Duration,
    per_session: usize,
}

impl<T: Clone, E: Clone> Default for SendOnce<T, E> {
    fn default() -> Self {
        Self::new(SEND_ONCE_TTL, SEND_ONCE_PER_SESSION)
    }
}

pub(crate) enum Begun<T, E> {
    // This request sends: it finishes the ticket with its outcome.
    First(SendTicket<T, E>),
    // Asked already: the first one's outcome, to wait for.
    Repeat(SendWait<T, E>),
}

// The send this request makes. Finished with its outcome; dropped without
// one (the request gone before it ended), the uid is forgotten and those
// waiting are told (SendWait::outcome gives None).
pub(crate) struct SendTicket<T, E> {
    state: Arc<Mutex<OnceState<T, E>>>,
    session: String,
    uid: String,
    id: u64,
    sender: Option<watch::Sender<Shared<T, E>>>,
}

pub(crate) struct SendWait<T, E> {
    outcome: watch::Receiver<Shared<T, E>>,
}

impl<T: Clone, E: Clone> SendWait<T, E> {
    // The first send's outcome, once it has one; None if it was abandoned
    // (nothing known: the request may begin again).
    pub(crate) async fn outcome(mut self) -> Option<Result<T, E>> {
        self.outcome.wait_for(Option::is_some).await.ok().and_then(|outcome| outcome.clone())
    }
}

impl<T, E> SendTicket<T, E> {
    // The send's outcome, shared with every request that asked the same.
    // A failure is forgotten: the next one with this uid sends.
    pub(crate) fn finish(mut self, outcome: Result<T, E>) {
        let failed = outcome.is_err();
        if failed {
            self.forget();
        }
        if let Some(sender) = self.sender.take() {
            sender.send_replace(Some(outcome));
        }
    }

    // Its entry, if it is still this one's.
    fn forget(&self) {
        let mut state = lock(&self.state);
        if let Some(sends) = state.sessions.get_mut(&self.session) {
            sends.retain(|entry| !(entry.uid == self.uid && entry.id == self.id));
            if sends.is_empty() {
                state.sessions.remove(&self.session);
            }
        }
    }
}

impl<T, E> Drop for SendTicket<T, E> {
    fn drop(&mut self) {
        if self.sender.is_some() {
            self.forget();
        }
    }
}

impl<T: Clone, E: Clone> SendOnce<T, E> {
    pub(crate) fn new(ttl: Duration, per_session: usize) -> Self {
        Self { state: Arc::new(Mutex::new(OnceState { sessions: HashMap::new(), pruned_at: None, next_id: 0 })), ttl, per_session }
    }

    // This request's send of `uid`: the first, or a repeat of one under way
    // or done.
    pub(crate) fn begin(&self, session_id: &str, uid: &str) -> Begun<T, E> {
        self.begin_at(session_id, uid, Instant::now())
    }

    pub(crate) fn forget_session(&self, session_id: &str) {
        lock(&self.state).sessions.remove(session_id);
    }

    fn prune(&self, state: &mut OnceState<T, E>, now: Instant) {
        if !due(state.pruned_at, now) {
            return;
        }
        state.pruned_at = Some(now);
        state.sessions.retain(|_, sends| {
            sends.retain(|entry| now.saturating_duration_since(entry.at) < self.ttl);
            !sends.is_empty()
        });
    }

    // Whether `uid` was asked for already (the tests': the send asks begin).
    #[cfg(test)]
    fn has_at(&self, session_id: &str, uid: &str, now: Instant) -> bool {
        let mut state = lock(&self.state);
        self.prune(&mut state, now);
        self.find(&state, session_id, uid, now).is_some()
    }

    fn find<'a>(&self, state: &'a OnceState<T, E>, session_id: &str, uid: &str, now: Instant) -> Option<&'a OnceEntry<T, E>> {
        state.sessions.get(session_id)?.iter().find(|entry| entry.uid == uid && now.saturating_duration_since(entry.at) < self.ttl)
    }

    fn begin_at(&self, session_id: &str, uid: &str, now: Instant) -> Begun<T, E> {
        let mut state = lock(&self.state);
        self.prune(&mut state, now);
        if let Some(entry) = self.find(&state, session_id, uid, now) {
            return Begun::Repeat(SendWait { outcome: entry.outcome.clone() });
        }
        state.next_id += 1;
        let id = state.next_id;
        let (sender, outcome) = watch::channel(None);
        let sends = state.sessions.entry(session_id.to_string()).or_default();
        // An expired one of the same uid goes; then the oldest past the cap.
        sends.retain(|entry| entry.uid != uid);
        sends.push(OnceEntry { uid: uid.to_string(), id, at: now, outcome });
        let excess = sends.len().saturating_sub(self.per_session);
        sends.drain(..excess);
        Begun::First(SendTicket { state: Arc::clone(&self.state), session: session_id.to_string(), uid: uid.to_string(), id, sender: Some(sender) })
    }
}

// ── An upload's bytes ───────────────────────────────────────────────────────

// More bytes than the upload declared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct UploadTooLarge;

// createUploadByteCounter: the bytes of an upload as they pass. Past
// `max`, the chunk that went over is refused, and every one after it.
pub(crate) struct ByteCounter {
    max: u64,
    total: u64,
    over: bool,
}

impl ByteCounter {
    pub(crate) fn new(max: u64) -> Self {
        Self { max, total: 0, over: false }
    }

    // One more chunk: the total so far, when it may go on.
    pub(crate) fn add(&mut self, chunk: usize) -> Result<u64, UploadTooLarge> {
        if self.over {
            return Err(UploadTooLarge);
        }
        self.total = self.total.saturating_add(chunk as u64);
        if self.total > self.max {
            self.over = true;
            return Err(UploadTooLarge);
        }
        Ok(self.total)
    }

    // What came, the refused chunk included.
    pub(crate) fn total(&self) -> u64 {
        self.total
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn keys(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn ms(millis: u64) -> Duration {
        Duration::from_millis(millis)
    }

    #[test]
    fn the_mail_routes_are_limited_per_session_with_retry_after() {
        let bucket = MailBucket::default();
        let start = Instant::now();
        for _ in 0..60 {
            assert_eq!(bucket.take_at("a", start), None);
        }
        assert_eq!(bucket.take_at("a", start), Some(1));
        // A token back every 200 ms.
        assert_eq!(bucket.take_at("a", start + ms(250)), None);
        assert_eq!(bucket.take_at("a", start + ms(260)), Some(1));
        // Another session has its own bucket; a request without one isn't
        // counted.
        assert_eq!(bucket.take_at("b", start), None);
        for _ in 0..100 {
            assert_eq!(bucket.take_at("", start), None);
        }
        // Full again after 12 s idle; looked over once a minute, a bucket idle
        // past a full refill is forgotten.
        for _ in 0..60 {
            assert_eq!(bucket.take_at("a", start + Duration::from_secs(13)), None);
        }
        assert!(lock(&bucket.state).buckets.contains_key("b"));
        assert_eq!(bucket.take_at("c", start + Duration::from_secs(61)), None);
        assert!(!lock(&bucket.state).buckets.contains_key("b"));
        bucket.forget_session("c");
        assert!(!lock(&bucket.state).buckets.contains_key("c"));
    }

    #[test]
    fn the_buckets_wait_is_the_time_to_one_token() {
        let bucket = MailBucket::default();
        let start = Instant::now();
        // Drained far below zero can't happen (a refusal takes nothing), so
        // the wait is a second at most at 5 a second: max(1, ceil(…)).
        for _ in 0..60 {
            bucket.take_at("a", start);
        }
        for _ in 0..10 {
            assert_eq!(bucket.take_at("a", start), Some(1));
        }
        assert_eq!(bucket.take_at("a", start + ms(150)), Some(1));
        assert_eq!(bucket.take_at("a", start + ms(250)), None);
    }

    #[test]
    fn the_bucket_under_concurrency_lets_exactly_its_burst_through() {
        let bucket = Arc::new(MailBucket::default());
        let start = Instant::now();
        let allowed = Arc::new(AtomicUsize::new(0));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let (bucket, allowed) = (Arc::clone(&bucket), Arc::clone(&allowed));
                std::thread::spawn(move || {
                    for _ in 0..50 {
                        if bucket.take_at("a", start).is_none() {
                            allowed.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                })
            })
            .collect();
        threads.into_iter().for_each(|thread| thread.join().unwrap());
        assert_eq!(allowed.load(Ordering::SeqCst), 60);
    }

    #[test]
    fn the_upload_limiter_per_minute_bytes_per_hour_at_once_per_key() {
        let limiter = UploadLimiter::new(3, 100, 2);
        let start = Instant::now();
        let mut first = limiter.take_at(&keys(&["a"]), 10, start).unwrap();
        let mut second = limiter.take_at(&keys(&["a"]), 10, start).unwrap();
        assert_eq!(limiter.take_at(&keys(&["a"]), 10, start).err(), Some(5));
        // Another key has its own.
        assert!(limiter.take_at(&keys(&["b"]), 10, start).is_ok());
        first.settle(10);
        second.settle(10);
        let _third = limiter.take_at(&keys(&["a"]), 10, start + ms(1000)).unwrap();
        assert_eq!(limiter.take_at(&keys(&["a"]), 10, start + ms(2000)).err(), Some(58));
        // Past the minute, the bytes of the hour still count.
        let big = limiter.take_at(&keys(&["a"]), 75, start + ms(61_000)).err().unwrap();
        assert!(big > 3000 && big <= 3600, "{big}");
        // A cancelled upload counts what came, not what was declared; only
        // its first settling counts.
        let mut cancelled = limiter.take_at(&keys(&["c"]), 90, start).unwrap();
        cancelled.settle(5);
        cancelled.settle(90);
        drop(cancelled);
        assert!(limiter.take_at(&keys(&["c"]), 90, start + ms(1)).is_ok());
    }

    #[test]
    fn an_upload_dropped_unsettled_counts_what_it_declared_and_frees_its_place() {
        let limiter = UploadLimiter::new(20, 100, 1);
        let start = Instant::now();
        let slot = limiter.take_at(&keys(&["a"]), 60, start).unwrap();
        assert_eq!(limiter.take_at(&keys(&["a"]), 10, start).err(), Some(5));
        drop(slot);
        assert!(limiter.take_at(&keys(&["a"]), 40, start).is_ok());
        // 100 of the hour's bytes now: 60 and 40.
        assert!(limiter.take_at(&keys(&["a"]), 1, start + ms(10)).is_err());
    }

    #[test]
    fn an_upload_counts_for_the_session_and_the_user() {
        let limiter = UploadLimiter::default();
        let start = Instant::now();
        let mut slots = Vec::new();
        for _ in 0..3 {
            slots.push(limiter.take_at(&limit_keys("s1", Some("JDoe")), 1024, start).unwrap());
        }
        // The same user, signed in again: three are under way already.
        assert_eq!(limiter.take_at(&limit_keys("s2", Some("jdoe")), 1024, start).err(), Some(AT_ONCE_WAIT));
        assert!(limiter.take_at(&limit_keys("s3", Some("other")), 1024, start).is_ok());
        // 300 MiB declared an hour.
        let limiter = UploadLimiter::default();
        let mut slot = limiter.take_at(&keys(&["a"]), UPLOAD_BYTES_PER_HOUR, start).unwrap();
        slot.settle(UPLOAD_BYTES_PER_HOUR);
        assert_eq!(limiter.take_at(&keys(&["a"]), 1, start + Duration::from_secs(60)).err(), Some(3540));
        // Forgotten with the session: its own count, never the user's.
        let limiter = UploadLimiter::new(1, 100, 3);
        drop(limiter.take_at(&limit_keys("s1", Some("jdoe")), 1, start).unwrap());
        limiter.forget_session("s1");
        assert!(limiter.take_at(&limit_keys("s1", None), 1, start).is_ok());
        assert!(limiter.take_at(&limit_keys("s4", Some("jdoe")), 1, start).is_err());
    }

    #[test]
    fn the_send_limiter_per_minute_per_day_recipients_every_key() {
        let limiter = SendLimiter::sends();
        let start = Instant::now();
        let both = keys(&["session:a", "user:x"]);
        for index in 0..5 {
            assert!(limiter.take_at(&both, 1, start + ms(index)).is_ok());
        }
        let blocked = limiter.take_at(&both, 1, start + ms(10)).err().unwrap();
        assert!(blocked > 0 && blocked <= 60);
        // The same user from another session: the user's own count holds.
        assert!(limiter.take_at(&keys(&["session:b", "user:x"]), 1, start + ms(20)).is_err());
        assert!(limiter.take_at(&keys(&["session:b", "user:y"]), 1, start + ms(20)).is_ok());
        // A minute later, again.
        assert!(limiter.take_at(&both, 1, start + ms(61_000)).is_ok());
        // Recipients per day.
        let recipients = SendLimiter::new(100, 100, Some(500));
        assert!(recipients.take_at(&keys(&["k"]), 400, start).is_ok());
        assert!(recipients.take_at(&keys(&["k"]), 101, start + ms(1)).is_err());
        assert!(recipients.take_at(&keys(&["k"]), 100, start + ms(2)).is_ok());
        assert_eq!(SendLimiter::new(100, 100, Some(500)).take_at(&keys(&["k"]), 501, start).err(), Some(DAY.as_secs()));
        // Per day.
        let daily = SendLimiter::new(1000, 3, None);
        for index in 0..3 {
            assert!(daily.take_at(&keys(&["k"]), 0, start + ms(index * 120_000)).is_ok());
        }
        let day = daily.take_at(&keys(&["k"]), 0, start + ms(400_000)).err().unwrap();
        assert!(day > 80_000);
    }

    #[test]
    fn a_send_the_server_refused_gives_its_count_back() {
        let limiter = SendLimiter::sends();
        let start = Instant::now();
        let both = limit_keys("a", Some("X"));
        assert_eq!(both, keys(&["session:a", "user:x"]));
        for _ in 0..4 {
            limiter.take_at(&both, 1, start).unwrap();
        }
        limiter.take_at(&both, 1, start).unwrap().release();
        // Given back on both keys: one more goes, then the limit.
        assert!(limiter.take_at(&both, 1, start).is_ok());
        assert!(limiter.take_at(&both, 1, start).is_err());
        assert!(limiter.take_at(&limit_keys("b", Some("x")), 1, start).is_err());
        // The drafts' and the signature's numbers.
        let drafts = SendLimiter::drafts();
        for _ in 0..20 {
            drafts.take_at(&keys(&["k"]), 0, start).unwrap();
        }
        assert!(drafts.take_at(&keys(&["k"]), 0, start).is_err());
        let signatures = SendLimiter::signatures();
        for _ in 0..10 {
            signatures.take_at(&keys(&["k"]), 0, start).unwrap();
        }
        assert!(signatures.take_at(&keys(&["k"]), 0, start).is_err());
    }

    #[test]
    fn a_burst_of_sends_at_once_gets_exactly_the_limit() {
        let limiter = Arc::new(SendLimiter::sends());
        let start = Instant::now();
        let allowed = Arc::new(AtomicUsize::new(0));
        let threads: Vec<_> = (0..16)
            .map(|index| {
                let (limiter, allowed) = (Arc::clone(&limiter), Arc::clone(&allowed));
                // Several sessions of one user.
                std::thread::spawn(move || {
                    for _ in 0..10 {
                        if limiter.take_at(&limit_keys(&format!("s{}", index % 4), Some("jdoe")), 1, start).is_ok() {
                            allowed.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                })
            })
            .collect();
        threads.into_iter().for_each(|thread| thread.join().unwrap());
        assert_eq!(allowed.load(Ordering::SeqCst), 5);
    }

    type Once = SendOnce<&'static str, &'static str>;

    #[tokio::test]
    async fn a_send_asked_twice_the_first_ones_outcome_failures_forgotten() {
        let once = Once::new(Duration::from_secs(1), 2);
        let start = Instant::now();
        let Begun::First(first) = once.begin_at("s1", "uid-1", start) else { panic!("the first sends") };
        assert!(once.has_at("s1", "uid-1", start + ms(10)));
        assert!(!once.has_at("s2", "uid-1", start + ms(10)));
        // While the first goes: the same wait.
        let Begun::Repeat(second) = once.begin_at("s1", "uid-1", start + ms(10)) else { panic!("a repeat waits") };
        let waiting = tokio::spawn(second.outcome());
        tokio::task::yield_now().await;
        first.finish(Ok("sent"));
        assert_eq!(waiting.await.unwrap(), Some(Ok("sent")));
        // Once sent: its outcome, nothing sent again.
        let Begun::Repeat(again) = once.begin_at("s1", "uid-1", start + ms(20)) else { panic!("a repeat") };
        assert_eq!(again.outcome().await, Some(Ok("sent")));
        // A failure is forgotten: a later try sends; those waiting get it.
        let Begun::First(failing) = once.begin_at("s1", "uid-2", start + ms(30)) else { panic!() };
        let Begun::Repeat(waiter) = once.begin_at("s1", "uid-2", start + ms(30)) else { panic!() };
        failing.finish(Err("refused"));
        assert_eq!(waiter.outcome().await, Some(Err("refused")));
        assert!(!once.has_at("s1", "uid-2", start + ms(40)));
        let Begun::First(retry) = once.begin_at("s1", "uid-2", start + ms(50)) else { panic!("a failure doesn't stay") };
        retry.finish(Ok("sent"));
        // Bounded: past the ttl, or past the cap of uids, the oldest go.
        assert!(!once.has_at("s1", "uid-1", start + ms(1000)));
        let Begun::First(third) = once.begin_at("s1", "uid-3", start + ms(60)) else { panic!() };
        third.finish(Ok("sent"));
        assert!(!once.has_at("s1", "uid-1", start + ms(70)));
        assert!(once.has_at("s1", "uid-3", start + ms(70)));
        once.forget_session("s1");
        assert!(!once.has_at("s1", "uid-3", start + ms(70)));
    }

    #[tokio::test]
    async fn a_send_abandoned_is_forgotten_and_its_waiters_told() {
        let once = Once::default();
        let start = Instant::now();
        let Begun::First(first) = once.begin_at("s1", "uid-1", start) else { panic!() };
        let Begun::Repeat(waiter) = once.begin_at("s1", "uid-1", start) else { panic!() };
        drop(first);
        assert_eq!(waiter.outcome().await, None);
        assert!(!once.has_at("s1", "uid-1", start));
        // A ticket whose entry was replaced meanwhile leaves the new one.
        let Begun::First(old) = once.begin_at("s1", "uid-2", start) else { panic!() };
        once.forget_session("s1");
        let Begun::First(new) = once.begin_at("s1", "uid-2", start) else { panic!() };
        old.finish(Err("late"));
        assert!(once.has_at("s1", "uid-2", start));
        new.finish(Ok("sent"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn the_same_send_uid_at_once_sends_once() {
        let once = Arc::new(Once::default());
        let sent = Arc::new(AtomicUsize::new(0));
        let tasks: Vec<_> = (0..32)
            .map(|_| {
                let (once, sent) = (Arc::clone(&once), Arc::clone(&sent));
                tokio::spawn(async move {
                    match once.begin("s1", "uid-same") {
                        Begun::First(ticket) => {
                            sent.fetch_add(1, Ordering::SeqCst);
                            tokio::time::sleep(Duration::from_millis(20)).await;
                            ticket.finish(Ok("sent"));
                            Some(Ok("sent"))
                        }
                        Begun::Repeat(wait) => wait.outcome().await,
                    }
                })
            })
            .collect();
        for task in tasks {
            assert_eq!(task.await.unwrap(), Some(Ok("sent")));
        }
        assert_eq!(sent.load(Ordering::SeqCst), 1);
        // Another session's same uid is its own.
        assert!(matches!(once.begin("s2", "uid-same"), Begun::First(_)));
    }

    #[test]
    fn the_byte_counter_fails_past_its_limit() {
        let mut counter = ByteCounter::new(8);
        assert_eq!(counter.add(5), Ok(5));
        assert_eq!(counter.add(5), Err(UploadTooLarge));
        assert_eq!(counter.add(0), Err(UploadTooLarge));
        assert_eq!(counter.total(), 10);
        let mut exact = ByteCounter::new(8);
        assert_eq!(exact.add(8), Ok(8));
        assert_eq!(exact.add(1), Err(UploadTooLarge));
    }
}
