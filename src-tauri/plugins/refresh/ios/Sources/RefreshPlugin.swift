// The system's pull to refresh on the page: UIRefreshControl on the web
// view's own scroll view, so the pull, the spinner and the haptic are what
// iOS gives every list.
//
// The page says whether there is something to refresh and when a refresh
// has ended (`update`, through the app: src-tauri/src/ios_chrome.rs;
// src/iosRefresh.js). A pull reaches it as a `tafac:refresh` event on
// window.

import SwiftRs
import Tauri
import UIKit
import WebKit

struct RefreshArgs: Decodable {
  let enabled: Bool?
  let done: Bool?
}

class RefreshPlugin: Plugin {
  private weak var webview: WKWebView?
  private var control: UIRefreshControl?
  // A page that never answers doesn't leave the spinner turning.
  private var giveUp: DispatchWorkItem?
  private static let longest: TimeInterval = 12

  override func load(webview: WKWebView) {
    self.webview = webview
  }

  @objc public func update(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(RefreshArgs.self)
    DispatchQueue.main.async {
      if let enabled = args.enabled {
        if enabled { self.attach() } else { self.detach() }
      }
      if args.done == true {
        self.end()
      }
    }
    invoke.resolve()
  }

  private func attach() {
    guard control == nil, let page = webview else { return }
    let control = UIRefreshControl()
    control.addAction(
      UIAction { [weak self] _ in
        self?.pulled()
      }, for: .valueChanged)
    page.scrollView.refreshControl = control
    self.control = control
    place()
  }

  private func detach() {
    end()
    webview?.scrollView.refreshControl = nil
    control = nil
  }

  // The page runs behind the status bar, and its scroll view starts at the
  // screen's edge: the spinner is brought down below the bar, where the
  // system would have put it under a navigation bar.
  private func place() {
    guard let page = webview, let control = control else { return }
    let top = page.safeAreaInsets.top
    control.bounds = CGRect(x: 0, y: -top, width: control.bounds.width, height: control.bounds.height)
  }

  private func pulled() {
    place()
    giveUp?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.end() }
    giveUp = work
    DispatchQueue.main.asyncAfter(deadline: .now() + RefreshPlugin.longest, execute: work)
    webview?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('tafac:refresh'))", completionHandler: nil)
  }

  private func end() {
    giveUp?.cancel()
    giveUp = nil
    control?.endRefreshing()
  }
}

@_cdecl("init_plugin_refresh")
func initPlugin() -> Plugin {
  return RefreshPlugin()
}
