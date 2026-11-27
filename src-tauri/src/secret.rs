// SESSION_SECRET: made once per install. It encrypts the session cookie,
// which jar.rs saves in the app's data folder.
//
// A packaged app keeps it in the system's credential store (macOS Keychain,
// Windows Credential Manager, the Secret Service on Linux), not next to the
// cookie it encrypts: whatever can read the data folder (a backup, a synced
// copy, another program) then holds a cookie it cannot open.
//
// The store is never in the way of the app starting: when it is missing,
// refuses or fails, the secret stays in (or goes to) the `session-secret`
// file of the data folder, as before. A secret already in that file moves to
// the store the first time the store takes it, so nobody is signed out by
// the change. Development builds keep the file: an unsigned build would have
// macOS ask for the keychain at each rebuild.

use std::path::{Path, PathBuf};

// What random_hex(32) gives; anything shorter isn't one of ours.
const SECRET_LENGTH: usize = 64;

// The system's credential store, as far as the secret needs it.
pub trait SecretStore {
    // Ok(None): the store works and holds nothing.
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, secret: &str) -> Result<(), String>;
}

#[derive(Debug, PartialEq)]
pub enum StoreState {
    // No store on this system or in this build, or it refused or failed.
    Unavailable,
    Empty,
    Holds(String),
}

#[derive(Debug, PartialEq)]
pub struct Plan {
    pub secret: String,
    // The store already holds it: the file, if any, is a leftover.
    pub in_store: bool,
    // The store is there and doesn't hold it yet: to be offered to it.
    pub offer_to_store: bool,
}

fn is_secret(value: &str) -> bool {
    value.len() >= SECRET_LENGTH
}

// Which secret this run uses and where it should live, from what the store
// and the file hold. No effect: session_secret_with() carries it out.
pub fn plan(store: StoreState, file: Option<String>, generate: impl FnOnce() -> String) -> Plan {
    let file = file.filter(|secret| is_secret(secret));
    match store {
        StoreState::Holds(secret) if is_secret(&secret) => Plan { secret, in_store: true, offer_to_store: false },
        // Empty, or holding something that isn't a secret of ours: the
        // file's moves in (existing sessions stay), else a new one.
        StoreState::Holds(_) | StoreState::Empty => {
            Plan { secret: file.unwrap_or_else(generate), in_store: false, offer_to_store: true }
        }
        StoreState::Unavailable => Plan { secret: file.unwrap_or_else(generate), in_store: false, offer_to_store: false },
    }
}

fn read_state(store: Option<&dyn SecretStore>) -> StoreState {
    match store.map(|store| store.read()) {
        Some(Ok(Some(secret))) => StoreState::Holds(secret.trim().to_string()),
        Some(Ok(None)) => StoreState::Empty,
        Some(Err(error)) => {
            eprintln!("[tafac] credential store unavailable, the secret stays in its file: {error}");
            StoreState::Unavailable
        }
        None => StoreState::Unavailable,
    }
}

// Written, then read back: a store that takes a secret without keeping it
// must not be trusted with the only copy.
fn store_keeps(store: &dyn SecretStore, secret: &str) -> bool {
    match store.write(secret).and_then(|()| store.read()) {
        Ok(Some(kept)) => kept.trim() == secret,
        Ok(None) => false,
        Err(error) => {
            eprintln!("[tafac] credential store refused the secret, it stays in its file: {error}");
            false
        }
    }
}

pub fn session_secret_with(path: &Path, store: Option<&dyn SecretStore>, generate: impl FnOnce() -> String) -> std::io::Result<String> {
    let file = std::fs::read_to_string(path).ok().map(|secret| secret.trim().to_string());
    let plan = plan(read_state(store), file.clone(), generate);

    let stored = plan.in_store || (plan.offer_to_store && store.is_some_and(|store| store_keeps(store, &plan.secret)));
    if stored {
        // The store has it: no copy beside the cookie.
        let _ = std::fs::remove_file(path);
    } else if file.as_deref() != Some(plan.secret.as_str()) {
        crate::jar::write_private(&PathBuf::from(path), plan.secret.as_bytes())?;
    }
    Ok(plan.secret)
}

pub fn session_secret(data_dir: &Path) -> std::io::Result<String> {
    let store = system_store();
    session_secret_with(&data_dir.join("session-secret"), store.as_deref(), || random_hex(32))
}

fn random_hex(bytes: usize) -> String {
    (0..bytes).map(|_| format!("{:02x}", rand::random::<u8>())).collect()
}

// Packaged builds, on the systems with a credential store.
#[cfg(all(not(debug_assertions), any(target_os = "macos", target_os = "ios", target_os = "linux", windows)))]
fn system_store() -> Option<Box<dyn SecretStore>> {
    Some(Box::new(system::Keychain))
}

#[cfg(not(all(not(debug_assertions), any(target_os = "macos", target_os = "ios", target_os = "linux", windows))))]
fn system_store() -> Option<Box<dyn SecretStore>> {
    None
}

#[cfg(all(not(debug_assertions), any(target_os = "macos", target_os = "ios", target_os = "linux", windows)))]
mod system {
    use super::SecretStore;

    // The entry's name in the store: the app's identifier (tauri.conf.json)
    // and what it holds.
    const SERVICE: &str = "fr.tafac.desktop";
    const ACCOUNT: &str = "session-secret";

    pub struct Keychain;

    // A new entry each time: what is read is what the store holds, not what
    // this process remembers having written.
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|error| error.to_string())
    }

    impl SecretStore for Keychain {
        fn read(&self) -> Result<Option<String>, String> {
            match entry()?.get_password() {
                Ok(secret) => Ok(Some(secret)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(error.to_string()),
            }
        }

        fn write(&self, secret: &str) -> Result<(), String> {
            entry()?.set_password(secret).map_err(|error| error.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    const OLD: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const NEW: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    fn new_secret() -> String {
        NEW.to_string()
    }

    #[test]
    fn the_store_wins_when_it_holds_the_secret() {
        let plan = plan(StoreState::Holds(OLD.into()), Some(NEW.into()), || unreachable!());
        assert_eq!(plan, Plan { secret: OLD.into(), in_store: true, offer_to_store: false });
    }

    #[test]
    fn the_file_moves_to_an_empty_store() {
        let plan = plan(StoreState::Empty, Some(OLD.into()), || unreachable!());
        assert_eq!(plan, Plan { secret: OLD.into(), in_store: false, offer_to_store: true });
    }

    #[test]
    fn a_first_run_makes_a_secret_for_the_store() {
        assert_eq!(plan(StoreState::Empty, None, new_secret), Plan { secret: NEW.into(), in_store: false, offer_to_store: true });
        // A file or a store entry that isn't a secret counts for nothing.
        assert_eq!(plan(StoreState::Empty, Some("short".into()), new_secret).secret, NEW);
        assert_eq!(
            plan(StoreState::Holds("short".into()), Some(OLD.into()), || unreachable!()),
            Plan { secret: OLD.into(), in_store: false, offer_to_store: true }
        );
    }

    #[test]
    fn without_a_store_the_file_is_kept() {
        assert_eq!(
            plan(StoreState::Unavailable, Some(OLD.into()), || unreachable!()),
            Plan { secret: OLD.into(), in_store: false, offer_to_store: false }
        );
        assert_eq!(plan(StoreState::Unavailable, None, new_secret), Plan { secret: NEW.into(), in_store: false, offer_to_store: false });
    }

    // A store for the tests: `kept` is what it holds; it can refuse to read,
    // refuse to write, or take a secret without keeping it.
    #[derive(Default)]
    struct FakeStore {
        kept: RefCell<Option<String>>,
        read_fails: bool,
        write_fails: bool,
        forgets: bool,
    }

    impl SecretStore for FakeStore {
        fn read(&self) -> Result<Option<String>, String> {
            if self.read_fails {
                return Err("locked".into());
            }
            Ok(self.kept.borrow().clone())
        }

        fn write(&self, secret: &str) -> Result<(), String> {
            if self.write_fails {
                return Err("denied".into());
            }
            if !self.forgets {
                *self.kept.borrow_mut() = Some(secret.to_string());
            }
            Ok(())
        }
    }

    fn scratch_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tafac-secret-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("session-secret")
    }

    fn file_holds(path: &Path) -> Option<String> {
        std::fs::read_to_string(path).ok()
    }

    #[test]
    fn an_existing_file_moves_into_the_store_and_goes() {
        let path = scratch_file("migrate");
        std::fs::write(&path, format!("{OLD}\n")).unwrap();
        let store = FakeStore::default();

        assert_eq!(session_secret_with(&path, Some(&store), || unreachable!()).unwrap(), OLD);
        assert_eq!(store.kept.borrow().as_deref(), Some(OLD));
        assert_eq!(file_holds(&path), None);

        // The next start reads it from the store alone.
        assert_eq!(session_secret_with(&path, Some(&store), || unreachable!()).unwrap(), OLD);
        assert_eq!(file_holds(&path), None);
    }

    #[test]
    fn a_first_run_keeps_the_secret_in_the_store_only() {
        let path = scratch_file("first-run");
        let store = FakeStore::default();
        assert_eq!(session_secret_with(&path, Some(&store), new_secret).unwrap(), NEW);
        assert_eq!(store.kept.borrow().as_deref(), Some(NEW));
        assert_eq!(file_holds(&path), None);
    }

    #[test]
    fn a_leftover_file_goes_once_the_store_holds_the_secret() {
        let path = scratch_file("leftover");
        std::fs::write(&path, NEW).unwrap();
        let store = FakeStore { kept: RefCell::new(Some(OLD.into())), ..Default::default() };
        assert_eq!(session_secret_with(&path, Some(&store), || unreachable!()).unwrap(), OLD);
        assert_eq!(file_holds(&path), None);
    }

    #[test]
    fn a_store_that_fails_leaves_everything_in_the_file() {
        for store in [
            FakeStore { read_fails: true, ..Default::default() },
            FakeStore { write_fails: true, ..Default::default() },
            FakeStore { forgets: true, ..Default::default() },
        ] {
            // An existing install: same secret, the file stays.
            let path = scratch_file("failing-existing");
            std::fs::write(&path, OLD).unwrap();
            assert_eq!(session_secret_with(&path, Some(&store), || unreachable!()).unwrap(), OLD);
            assert_eq!(file_holds(&path).as_deref(), Some(OLD));

            // A new one: the secret is made and written to the file.
            let path = scratch_file("failing-new");
            assert_eq!(session_secret_with(&path, Some(&store), new_secret).unwrap(), NEW);
            assert_eq!(file_holds(&path).as_deref(), Some(NEW));
            assert_eq!(session_secret_with(&path, Some(&store), || unreachable!()).unwrap(), NEW);
        }
    }

    #[test]
    fn without_a_store_it_is_the_file_as_before() {
        let path = scratch_file("no-store");
        assert_eq!(session_secret_with(&path, None, new_secret).unwrap(), NEW);
        assert_eq!(file_holds(&path).as_deref(), Some(NEW));
        assert_eq!(session_secret_with(&path, None, || unreachable!()).unwrap(), NEW);
    }
}
