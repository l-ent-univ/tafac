// Saved passwords (macOS): the ones the student saved for tafac.fr on the web
// (Passwords, iCloud Keychain) offered on the app's login page, and an
// accepted login offered to be saved for tafac.fr the same way.
//
// Apple only lets the app reach tafac.fr's passwords when both sides vouch for
// each other: the app's signed entitlement lists webcredentials:tafac.fr
// (src-tauri/entitlements.signed.plist), and tafac.fr serves
// /.well-known/apple-app-site-association naming the app (server.js,
// APPLE_APP_IDS). Without that (an unsigned build, other systems) there is
// simply nothing to offer.
//
// The page asks through the tafac:// scheme (desktop.rs), never through a
// command any script could call.

pub const WEB_CREDENTIALS_DOMAIN: &str = "tafac.fr";

pub struct Credential {
    pub username: String,
    pub password: String,
}

#[cfg(target_os = "macos")]
pub use macos::{pick, save};

#[cfg(not(target_os = "macos"))]
pub async fn pick(_app: &tauri::AppHandle, _window_label: &str) -> Option<Credential> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn save(_credential: Credential) {}

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::{Cell, RefCell};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_authentication_services::{
        ASAuthorization, ASAuthorizationController, ASAuthorizationControllerDelegate,
        ASAuthorizationControllerPresentationContextProviding, ASAuthorizationPasswordProvider,
        ASAuthorizationRequest, ASPasswordCredential, ASPresentationAnchor,
    };
    use objc2_foundation::{NSArray, NSError, NSString};
    use tauri::{AppHandle, Manager};
    use tokio::sync::oneshot;

    use super::{Credential, WEB_CREDENTIALS_DOMAIN};

    pub struct PickerIvars {
        anchor: Retained<NSObject>,
        reply: Cell<Option<oneshot::Sender<Option<Credential>>>>,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; Picker has no Drop.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "TafacPasswordPicker"]
        #[ivars = PickerIvars]
        pub struct Picker;

        unsafe impl NSObjectProtocol for Picker {}

        unsafe impl ASAuthorizationControllerDelegate for Picker {
            #[unsafe(method(authorizationController:didCompleteWithAuthorization:))]
            fn did_complete(&self, _controller: &ASAuthorizationController, authorization: &ASAuthorization) {
                let credential = unsafe { authorization.credential() };
                let object: &AnyObject = (*credential).as_ref();
                let picked = object.downcast_ref::<ASPasswordCredential>().map(|credential| unsafe {
                    Credential {
                        username: credential.user().to_string(),
                        password: credential.password().to_string(),
                    }
                });
                self.finish(picked);
            }

            #[unsafe(method(authorizationController:didCompleteWithError:))]
            fn did_fail(&self, _controller: &ASAuthorizationController, _error: &NSError) {
                // Cancelled, or nothing saved for tafac.fr.
                self.finish(None);
            }
        }

        unsafe impl ASAuthorizationControllerPresentationContextProviding for Picker {
            #[unsafe(method_id(presentationAnchorForAuthorizationController:))]
            fn anchor(&self, _controller: &ASAuthorizationController) -> Retained<ASPresentationAnchor> {
                self.ivars().anchor.clone()
            }
        }
    );

    impl Picker {
        fn finish(&self, picked: Option<Credential>) {
            if let Some(reply) = self.ivars().reply.take() {
                let _ = reply.send(picked);
            }
            // The controller and its delegate can go now.
            IN_FLIGHT.with(|slot| slot.borrow_mut().take());
            BUSY.store(false, Ordering::SeqCst);
        }
    }

    thread_local! {
        // The controller only holds its delegate weakly: both are kept here
        // until it answers.
        static IN_FLIGHT: RefCell<Option<(Retained<ASAuthorizationController>, Retained<Picker>)>> =
            const { RefCell::new(None) };
    }

    // One sheet at a time.
    static BUSY: AtomicBool = AtomicBool::new(false);

    // The system's sheet of passwords saved for tafac.fr, over the window that
    // asked. None: cancelled, nothing saved, or the app isn't entitled.
    pub async fn pick(app: &AppHandle, window_label: &str) -> Option<Credential> {
        if BUSY.swap(true, Ordering::SeqCst) {
            return None;
        }
        let window = app.get_window(window_label).or_else(|| app.get_window("main"));
        let Some(ns_window) = window.and_then(|window| window.ns_window().ok()) else {
            BUSY.store(false, Ordering::SeqCst);
            return None;
        };
        let ns_window = ns_window as usize;
        let (reply, answer) = oneshot::channel();

        let started = app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else { return };
            // SAFETY: Tauri's NSWindow, alive while its window is.
            let Some(anchor) = (unsafe { Retained::retain(ns_window as *mut NSObject) }) else { return };

            let picker: Retained<Picker> = {
                let this = Picker::alloc(mtm).set_ivars(PickerIvars { anchor, reply: Cell::new(Some(reply)) });
                unsafe { msg_send![super(this), init] }
            };
            unsafe {
                let request = ASAuthorizationPasswordProvider::new().createRequest();
                let requests = NSArray::from_retained_slice(&[Retained::into_super(request)]);
                let controller = ASAuthorizationController::initWithAuthorizationRequests(
                    ASAuthorizationController::alloc(),
                    &requests as &NSArray<ASAuthorizationRequest>,
                );
                controller.setDelegate(Some(ProtocolObject::from_ref(&*picker)));
                controller.setPresentationContextProvider(Some(ProtocolObject::from_ref(&*picker)));
                controller.performRequests();
                IN_FLIGHT.with(|slot| *slot.borrow_mut() = Some((controller, picker)));
            }
        });

        if started.is_err() {
            BUSY.store(false, Ordering::SeqCst);
            return None;
        }
        // A dropped sender (the sheet never started) reads as nothing picked.
        let picked = answer.await.ok().flatten();
        BUSY.store(false, Ordering::SeqCst);
        picked
    }

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        // CFStringRef arguments: NSString is toll-free bridged.
        fn SecAddSharedWebCredential(
            fqdn: *const NSString,
            account: *const NSString,
            password: *const NSString,
            completion: *const block2::Block<dyn Fn(*mut c_void)>,
        );
    }

    // Offers the accepted login to be saved for tafac.fr; the system asks the
    // student first.
    pub fn save(credential: super::Credential) {
        let domain = NSString::from_str(WEB_CREDENTIALS_DOMAIN);
        let account = NSString::from_str(&credential.username);
        let password = NSString::from_str(&credential.password);
        let completion = RcBlock::new(|error: *mut c_void| {
            if !error.is_null() {
                eprintln!("[tafac] password not saved for {WEB_CREDENTIALS_DOMAIN}");
            }
        });
        unsafe {
            SecAddSharedWebCredential(&*domain, &*account, &*password, &*completion);
        }
    }
}
