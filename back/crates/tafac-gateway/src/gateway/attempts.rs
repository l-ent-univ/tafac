// The sign-in's limits: failed attempts counted per address and per login,
// each over a window, with a short block past the limit.
//
// Node's own (server/loginRateLimit/), with its numbers: the page gets the
// same 429 and the same wait whichever side answers its login. The counts
// are in this process: starting again forgets them.
//
// A good sign-in clears the student's own count, and takes their own
// earlier mistakes off the address's count: students behind one campus
// address who mistype then get it right don't add up against each other.
// It never clears the address's other failures.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use http::HeaderMap;

// LOGIN_RATE_LIMIT_*: failed sign-ins within the window before a short
// block. More per address than per login: students on the campus Wi-Fi
// share an address.
const WINDOW: Duration = Duration::from_secs(15 * 60);
const BLOCK: Duration = Duration::from_secs(5 * 60);
const MAX_PER_ADDRESS: u32 = 30;
const MAX_PER_LOGIN: u32 = 8;
// Whose failure it was, kept no longer than this (MAX_TAG_LENGTH).
const MAX_TAG_BYTES: usize = 256;
// Addresses and logins counted at once: past it the oldest counts go first.
const COUNTED: usize = 50_000;

struct Entry {
    first_failure: Instant,
    blocked_until: Option<Instant>,
    count: u32,
    // How many of the failures were whose (for an address: by login).
    by_tag: HashMap<String, u32>,
}

// Failures counted per key over a window (failureWindow.ts).
struct FailureWindow {
    max_failures: u32,
    entries: HashMap<String, Entry>,
}

fn bounded(tag: &str) -> &str {
    let mut end = tag.len().min(MAX_TAG_BYTES);
    while !tag.is_char_boundary(end) {
        end -= 1;
    }
    &tag[..end]
}

// How long a block still lasts, in whole seconds rounded up (Retry-After).
fn seconds_left(until: Instant, now: Instant) -> Option<u64> {
    let left = until.checked_duration_since(now).filter(|left| !left.is_zero())?;
    Some(u64::try_from(left.as_millis().div_ceil(1000)).unwrap_or(u64::MAX).max(1))
}

impl FailureWindow {
    fn new(max_failures: u32) -> Self {
        Self { max_failures, entries: HashMap::new() }
    }

    fn prune(&mut self, now: Instant) {
        self.entries.retain(|_, entry| entry.blocked_until.is_some_and(|until| until > now) || now.duration_since(entry.first_failure) <= WINDOW);
        if self.entries.len() >= COUNTED {
            self.entries.clear();
        }
    }

    // The key's block, if it is waiting: the seconds left.
    fn status(&mut self, key: &str, now: Instant) -> Option<u64> {
        if key.is_empty() {
            return None;
        }
        self.prune(now);
        let until = self.entries.get(key)?.blocked_until?;
        let left = seconds_left(until, now);
        if left.is_none() {
            self.entries.remove(key);
        }
        left
    }

    // One more failure; the block it brought, if any.
    fn record(&mut self, key: &str, tag: &str, now: Instant) -> Option<u64> {
        if key.is_empty() {
            return None;
        }
        self.prune(now);
        let fresh = || Entry { first_failure: now, blocked_until: None, count: 0, by_tag: HashMap::new() };
        let entry = self.entries.entry(key.to_string()).or_insert_with(fresh);
        if now.duration_since(entry.first_failure) > WINDOW {
            *entry = fresh();
        }
        entry.count += 1;
        *entry.by_tag.entry(bounded(tag).to_string()).or_default() += 1;
        if entry.count >= self.max_failures {
            entry.blocked_until = Some(now + BLOCK);
        }
        self.status(key, now)
    }

    // Takes back the failures recorded with that tag.
    fn forgive(&mut self, key: &str, tag: &str, now: Instant) {
        let Some(entry) = self.entries.get_mut(key) else { return };
        let Some(forgiven) = entry.by_tag.remove(bounded(tag)) else { return };
        entry.count = entry.count.saturating_sub(forgiven);
        if entry.count == 0 && !entry.blocked_until.is_some_and(|until| until > now) {
            self.entries.remove(key);
        }
    }

    fn clear(&mut self, key: &str) {
        self.entries.remove(key);
    }
}

struct Windows {
    by_address: FailureWindow,
    by_login: FailureWindow,
}

pub(crate) struct Attempts {
    windows: Mutex<Windows>,
}

impl Default for Attempts {
    fn default() -> Self {
        Self { windows: Mutex::new(Windows { by_address: FailureWindow::new(MAX_PER_ADDRESS), by_login: FailureWindow::new(MAX_PER_LOGIN) }) }
    }
}

// Who signs in: the address the request came from, and the login as typed,
// trimmed and in lower case (normalizeLoginIdentifier).
pub(crate) struct Who {
    pub address: String,
    pub login: String,
}

impl Who {
    pub(crate) fn new(address: String, username: &str) -> Self {
        Self { address, login: username.trim().to_lowercase() }
    }
}

impl Attempts {
    // The block in force for this address or this login, the longer of the
    // two: the seconds to wait.
    pub(crate) fn blocked(&self, who: &Who) -> Option<u64> {
        self.blocked_at(who, Instant::now())
    }

    // A failed attempt; the block it brought, if any.
    pub(crate) fn failed(&self, who: &Who) -> Option<u64> {
        self.failed_at(who, Instant::now())
    }

    pub(crate) fn signed_in(&self, who: &Who) {
        let mut windows = self.windows.lock().unwrap();
        windows.by_login.clear(&who.login);
        windows.by_address.forgive(&who.address, &who.login, Instant::now());
    }

    fn blocked_at(&self, who: &Who, now: Instant) -> Option<u64> {
        let mut windows = self.windows.lock().unwrap();
        let (address, login) = (windows.by_address.status(&who.address, now), windows.by_login.status(&who.login, now));
        address.max(login)
    }

    fn failed_at(&self, who: &Who, now: Instant) -> Option<u64> {
        let mut windows = self.windows.lock().unwrap();
        let (address, login) = (windows.by_address.record(&who.address, &who.login, now), windows.by_login.record(&who.login, "", now));
        address.max(login)
    }
}

// Whose word is taken for where a request came from: on tafac.fr every
// request comes from the server in front (Caddy), which says the student's
// address in X-Forwarded-For. Node's `trust proxy`, read from the same
// TRUST_PROXY (server/entAuthApp.js: resolveTrustProxy).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrustedProxies {
    // Node's default: this machine and private networks (loopback,
    // link-local, unique local).
    Private,
    // Every hop: the first address of the header.
    All,
    // None: the address the connection came from.
    Nobody,
    // That many hops, from the connection back.
    Hops(usize),
}

impl TrustedProxies {
    // TRUST_PROXY as Node reads it. A list of addresses, which Express
    // takes too, is not read here: None.
    pub fn from_setting(setting: &str) -> Option<Self> {
        match setting.trim() {
            "" => Some(Self::Private),
            "true" => Some(Self::All),
            "false" => Some(Self::Nobody),
            hops => hops.parse().ok().map(Self::Hops),
        }
    }
}

fn is_private(address: &str) -> bool {
    let Ok(address) = address.parse::<IpAddr>() else { return false };
    let address = match address {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(address, IpAddr::V4),
        v4 => v4,
    };
    match address {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_link_local() || v4.is_private(),
        IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xffc0) == 0xfe80 || (v6.segments()[0] & 0xfe00) == 0xfc00,
    }
}

// The address a request came from, as Express's `req.ip` says it: the
// connection's, or the furthest one back in X-Forwarded-For that only
// trusted hops vouch for. « unknown » where there is no connection to
// name (the apps: one student, one process).
pub(crate) fn requester(peer: Option<IpAddr>, headers: &HeaderMap, trusted: TrustedProxies) -> String {
    let Some(peer) = peer else { return "unknown".to_string() };
    let forwarded: Vec<String> = headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|address| address.trim().to_string())
        .filter(|address| !address.is_empty())
        .collect();
    // From the connection back to the first address of the header.
    let mut chain = vec![peer.to_string()];
    chain.extend(forwarded.into_iter().rev());
    let vouched = |index: usize, address: &str| match trusted {
        TrustedProxies::Private => is_private(address),
        TrustedProxies::All => true,
        TrustedProxies::Nobody => false,
        TrustedProxies::Hops(hops) => index < hops,
    };
    let first_unvouched = chain.iter().enumerate().position(|(index, address)| !vouched(index, address));
    let at = first_unvouched.unwrap_or(chain.len() - 1);
    chain.swap_remove(at)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn who(address: &str, login: &str) -> Who {
        Who::new(address.to_string(), login)
    }

    #[test]
    fn a_login_waits_after_eight_failures_and_an_address_after_thirty() {
        let attempts = Attempts::default();
        let now = Instant::now();
        let student = who("203.0.113.7", " JDoe ");
        assert_eq!(student.login, "jdoe");
        for _ in 0..7 {
            assert_eq!(attempts.failed_at(&student, now), None);
        }
        assert_eq!(attempts.blocked_at(&student, now), None);
        // The eighth brings the block: five minutes.
        assert_eq!(attempts.failed_at(&student, now), Some(300));
        assert_eq!(attempts.blocked_at(&student, now + Duration::from_secs(10)), Some(290));
        assert_eq!(attempts.blocked_at(&student, now + Duration::from_millis(299_500)), Some(1));
        // The same login from elsewhere waits too; another login from the
        // same address doesn't.
        assert_eq!(attempts.blocked_at(&who("198.51.100.1", "jdoe"), now), Some(300));
        assert_eq!(attempts.blocked_at(&who("203.0.113.7", "asmith"), now), None);
        assert_eq!(attempts.blocked_at(&student, now + BLOCK + Duration::from_secs(1)), None);

        // Thirty failures from one address, whoever they are for.
        let attempts = Attempts::default();
        for index in 0..29 {
            assert_eq!(attempts.failed_at(&who("203.0.113.7", &format!("student{index}")), now), None);
        }
        assert_eq!(attempts.failed_at(&who("203.0.113.7", "one-more"), now), Some(300));
        assert_eq!(attempts.blocked_at(&who("203.0.113.7", "anyone"), now), Some(300));
        assert_eq!(attempts.blocked_at(&who("198.51.100.1", "anyone"), now), None);
    }

    #[test]
    fn failures_older_than_the_window_start_a_new_count() {
        let attempts = Attempts::default();
        let now = Instant::now();
        let student = who("203.0.113.7", "jdoe");
        for _ in 0..7 {
            attempts.failed_at(&student, now);
        }
        let later = now + WINDOW + Duration::from_secs(1);
        for _ in 0..7 {
            assert_eq!(attempts.failed_at(&student, later), None);
        }
    }

    #[test]
    fn a_good_sign_in_clears_the_students_own_failures_only() {
        let attempts = Attempts::default();
        let now = Instant::now();
        let (student, other) = (who("203.0.113.7", "jdoe"), who("203.0.113.7", "asmith"));
        for _ in 0..7 {
            attempts.failed_at(&student, now);
            attempts.failed_at(&other, now);
        }
        attempts.signed_in(&student);
        // Their own count starts over, and their seven failures are off the
        // address's count: the other student's seven stay.
        assert_eq!(attempts.windows.lock().unwrap().by_address.entries["203.0.113.7"].count, 7);
        for _ in 0..7 {
            assert_eq!(attempts.failed_at(&student, now), None);
        }
        assert_eq!(attempts.windows.lock().unwrap().by_address.entries["203.0.113.7"].count, 14);
        // One valid account doesn't reset the address between two rounds of
        // guesses at everyone else's passwords.
        attempts.signed_in(&who("203.0.113.7", "a-valid-account"));
        assert_eq!(attempts.windows.lock().unwrap().by_address.entries["203.0.113.7"].count, 14);
    }

    fn headers(forwarded: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for value in forwarded {
            headers.append("x-forwarded-for", value.parse().unwrap());
        }
        headers
    }

    #[test]
    fn the_address_is_the_one_express_would_say() {
        let caddy: IpAddr = "172.18.0.2".parse().unwrap();
        let private = TrustedProxies::Private;
        // Behind the server in front: the student's address, which it says.
        assert_eq!(requester(Some(caddy), &headers(&["203.0.113.7"]), private), "203.0.113.7");
        // What a student writes in the header themself is before it, and
        // not believed.
        assert_eq!(requester(Some(caddy), &headers(&["10.0.0.1, 198.51.100.9, 203.0.113.7"]), private), "203.0.113.7");
        assert_eq!(requester(Some(caddy), &headers(&["198.51.100.9", "203.0.113.7, 127.0.0.1"]), private), "203.0.113.7");
        // Nothing said, or only private addresses: the furthest back.
        assert_eq!(requester(Some(caddy), &headers(&[]), private), "172.18.0.2");
        assert_eq!(requester(Some(caddy), &headers(&["192.168.1.20, ::1"]), private), "192.168.1.20");
        // A connection from outside is its own word.
        assert_eq!(requester(Some("203.0.113.50".parse().unwrap()), &headers(&["198.51.100.9"]), private), "203.0.113.50");
        assert_eq!(requester(Some("::ffff:127.0.0.1".parse().unwrap()), &headers(&["203.0.113.7"]), private), "203.0.113.7");

        assert_eq!(requester(Some(caddy), &headers(&["198.51.100.9, 203.0.113.7"]), TrustedProxies::All), "198.51.100.9");
        assert_eq!(requester(Some(caddy), &headers(&["203.0.113.7"]), TrustedProxies::Nobody), "172.18.0.2");
        assert_eq!(requester(Some(caddy), &headers(&["198.51.100.9, 203.0.113.7"]), TrustedProxies::Hops(1)), "203.0.113.7");
        assert_eq!(requester(Some(caddy), &headers(&["198.51.100.9, 203.0.113.7"]), TrustedProxies::Hops(2)), "198.51.100.9");
        // The apps: no connection to name.
        assert_eq!(requester(None, &headers(&["203.0.113.7"]), private), "unknown");
    }

    #[test]
    fn trust_proxy_is_read_as_node_reads_it() {
        assert_eq!(TrustedProxies::from_setting(""), Some(TrustedProxies::Private));
        assert_eq!(TrustedProxies::from_setting(" true "), Some(TrustedProxies::All));
        assert_eq!(TrustedProxies::from_setting("false"), Some(TrustedProxies::Nobody));
        assert_eq!(TrustedProxies::from_setting("2"), Some(TrustedProxies::Hops(2)));
        assert_eq!(TrustedProxies::from_setting("loopback, 10.0.0.0/8"), None);
    }
}
