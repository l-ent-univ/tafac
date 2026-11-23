// window.open and target="_blank" on iOS.
//
// Tauri's web view only tells an app about a new window on the desktop: on
// iOS nothing answers WebKit when a page asks for one, and WebKit drops the
// request. An app tile (the launch relay), a link in a mail, « Moodle »:
// nothing would open.
//
// WebKit asks the web view's UI delegate, with
// webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:.
// Tauri's delegate has no such method on iOS. It is given one here, which
// hands the address to the app's own rule (ios.rs) and makes no window:
// what opens, opens over the app.

use std::ffi::{c_char, CStr};

use objc2::ffi::{class_addMethod, object_getClass};
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{msg_send, sel};
use tauri::Url;

// The address WebKit wants a window for; no window is made (nil).
unsafe extern "C-unwind" fn create_web_view(
    _delegate: *mut AnyObject,
    _selector: Sel,
    _web_view: *mut AnyObject,
    _configuration: *mut AnyObject,
    action: *mut AnyObject,
    _features: *mut AnyObject,
) -> *mut AnyObject {
    if let Some(url) = address(action) {
        crate::ios::open_new_window(url);
    }
    std::ptr::null_mut()
}

// A WKNavigationAction's address.
unsafe fn address(action: *mut AnyObject) -> Option<Url> {
    if action.is_null() {
        return None;
    }
    let request: *mut AnyObject = msg_send![action, request];
    if request.is_null() {
        return None;
    }
    let url: *mut AnyObject = msg_send![request, URL];
    if url.is_null() {
        return None;
    }
    let text: *mut AnyObject = msg_send![url, absoluteString];
    if text.is_null() {
        return None;
    }
    let utf8: *const c_char = msg_send![text, UTF8String];
    if utf8.is_null() {
        return None;
    }
    Url::parse(CStr::from_ptr(utf8).to_str().ok()?).ok()
}

// `view`: the WKWebView. Once, after the window is built.
pub unsafe fn install(view: *mut AnyObject) {
    let delegate: *mut AnyObject = msg_send![view, UIDelegate];
    if delegate.is_null() {
        return;
    }
    let class = object_getClass(delegate) as *mut AnyClass;
    let selector = sel!(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:);
    // The method's types, as Objective-C writes them: an object back, the
    // receiver, the selector, four objects.
    let types = c"@@:@@@@";
    type Method = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, *mut AnyObject, *mut AnyObject) -> *mut AnyObject;
    let method: Imp = std::mem::transmute::<Method, Imp>(create_web_view);
    // Not added when the delegate already has one (a later Tauri's own).
    if !class_addMethod(class, selector, method, types.as_ptr()).as_bool() {
        return;
    }
    // WebKit notes what a delegate answers when it is set: set again, it
    // sees the new method. (The web view doesn't own its delegate, Tauri
    // does: it lives through this.)
    let _: () = msg_send![view, setUIDelegate: std::ptr::null_mut::<AnyObject>()];
    let _: () = msg_send![view, setUIDelegate: delegate];
}
