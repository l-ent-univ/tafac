// Moodle's web view: a WKWebView of the app's own over the page's
// « Moodle » (src/components/MoodlePage.jsx), the phone's counterpart of the
// desktop's (src-tauri/src/moodle.rs, moodle_native.rs).
//
// The app drives it (src-tauri/src/moodle_ios.rs) and decides everything
// that can wait: how to sign in, where to go next, what the page's toolbar
// says. What WebKit wants answered at once is answered here, by the same
// rules:
// - the view's page only loads the university's addresses (`rules`: Moodle,
//   the hosts and domains the server lists) and what a page makes itself
//   (about:, blob:, data:). Any other address is not loaded and told to the
//   app (`asked`), which opens it over the app or refuses it. Frames inside
//   a page load as in a browser;
// - what the server sends as a file (Content-Disposition: attachment), or
//   what the view can't show, is downloaded and handed to the share sheet.
//
// Apart from the app: a configuration of its own, without the app's scheme
// (nothing in a course page can ask the app's server anything), and a data
// store in memory only, which goes with the view.

import SwiftRs
import Tauri
import UIKit
import WebKit

struct Rules: Decodable {
  // Moodle's host.
  let home: String
  let hosts: [String]
  let domains: [String]
}

struct CreateArgs: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let start: String
  // Run before each page's own scripts, in the top frame: Moodle in the
  // app's look (src-tauri/src/moodle_style.rs).
  let script: String
  let rules: Rules
  let channel: Channel
}

struct BoundsArgs: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct AddressArgs: Decodable {
  let url: String
}

struct ScriptArgs: Decodable {
  let script: String
}

struct GoArgs: Decodable {
  // back, forward, stop
  let to: String
}

class MoodlePlugin: Plugin, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  // The app's own page: the view lies over it.
  private weak var page: WKWebView?
  private var view: WKWebView?
  private var rules: Rules?
  private var channel: Channel?
  private var observations: [NSKeyValueObservation] = []
  // Where each download goes.
  private var files: [ObjectIdentifier: URL] = [:]

  override func load(webview: WKWebView) {
    page = webview
  }

  // MARK: What the app asks

  @objc public func create(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CreateArgs.self)
    guard let start = URL(string: args.start) else {
      invoke.reject("bad address")
      return
    }
    DispatchQueue.main.async {
      guard let page = self.page, let holder = page.superview else {
        invoke.reject("no window")
        return
      }
      self.discard()

      let configuration = WKWebViewConfiguration()
      // Nothing of Moodle's is written to disk, and it all goes with the view.
      configuration.websiteDataStore = .nonPersistent()
      configuration.userContentController.addUserScript(
        WKUserScript(source: args.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
      // Safari's name: without it some of what Moodle embeds (players,
      // editors) takes the view for a browser it doesn't know.
      let system = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
      configuration.applicationNameForUserAgent = "Version/\(system >= 26 ? system : system + 3).0 Mobile/15E148 Safari/604.1"
      configuration.allowsInlineMediaPlayback = true

      let view = WKWebView(frame: self.frame(page, args.x, args.y, args.width, args.height), configuration: configuration)
      // Off screen until Moodle's page is there.
      view.isHidden = true
      view.navigationDelegate = self
      view.uiDelegate = self
      // A swipe from the edge goes back, as in Safari.
      view.allowsBackForwardNavigationGestures = true
      // Its bottom margin is set here (clearTabBar), not by the system.
      view.scrollView.contentInsetAdjustmentBehavior = .never
      // Just above the page: under the tab bar and anything else over it.
      holder.insertSubview(view, aboveSubview: page)

      let changed: (WKWebView, Any) -> Void = { [weak self] _, _ in self?.tell(["type": "changed"]) }
      self.observations = [
        view.observe(\.title, changeHandler: changed),
        view.observe(\.isLoading, changeHandler: changed),
        view.observe(\.canGoBack, changeHandler: changed),
        view.observe(\.canGoForward, changeHandler: changed),
      ]
      self.view = view
      self.rules = args.rules
      self.channel = args.channel
      self.clearTabBar()
      view.load(URLRequest(url: start))
      invoke.resolve()
    }
  }

  @objc public func navigate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AddressArgs.self)
    guard let url = URL(string: args.url) else {
      invoke.reject("bad address")
      return
    }
    DispatchQueue.main.async { self.view?.load(URLRequest(url: url)) }
    invoke.resolve()
  }

  @objc public func eval(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ScriptArgs.self)
    DispatchQueue.main.async { self.view?.evaluateJavaScript(args.script, completionHandler: nil) }
    invoke.resolve()
  }

  @objc public func show(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.clearTabBar()
      self.view?.isHidden = false
    }
    invoke.resolve()
  }

  @objc public func hide(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.view?.isHidden = true
      // The keyboard goes with what it was typing in.
      self.view?.endEditing(true)
    }
    invoke.resolve()
  }

  @objc public func bounds(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(BoundsArgs.self)
    DispatchQueue.main.async {
      guard let page = self.page else { return }
      self.view?.frame = self.frame(page, args.x, args.y, args.width, args.height)
      self.clearTabBar()
    }
    invoke.resolve()
  }

  @objc public func reload(_ invoke: Invoke) {
    DispatchQueue.main.async { self.view?.reload() }
    invoke.resolve()
  }

  @objc public func go(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(GoArgs.self)
    DispatchQueue.main.async {
      switch args.to {
      case "back": self.view?.goBack()
      case "forward": self.view?.goForward()
      default: self.view?.stopLoading()
      }
    }
    invoke.resolve()
  }

  // What the page's toolbar shows of the view, and where it is.
  @objc public func read(_ invoke: Invoke) {
    DispatchQueue.main.async {
      let view = self.view
      invoke.resolve([
        "url": view?.url?.absoluteString ?? "",
        "loading": view?.isLoading ?? false,
        "back": view?.canGoBack ?? false,
        "forward": view?.canGoForward ?? false,
        "title": view?.title ?? "",
      ])
    }
  }

  @objc public func close(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.discard()
      invoke.resolve()
    }
  }

  // MARK: The view

  private func discard() {
    observations.forEach { $0.invalidate() }
    observations = []
    view?.stopLoading()
    view?.navigationDelegate = nil
    view?.uiDelegate = nil
    view?.removeFromSuperview()
    view = nil
    channel = nil
  }

  // The slot's place in the app's page (points, from the page's corner), in
  // the view that holds both.
  private func frame(_ page: WKWebView, _ x: Double, _ y: Double, _ width: Double, _ height: Double) -> CGRect {
    return CGRect(x: page.frame.minX + x, y: page.frame.minY + y, width: width, height: height)
  }

  // The view runs down to the screen's edge, behind the system's tab bar
  // (plugins/tabbar) and the home indicator: Moodle's page shows through
  // the bar, and scrolls clear of it. The margin is what lies over the
  // view's bottom; WebKit keeps what a page pins to its bottom above it.
  private func clearTabBar() {
    guard let view = view, let holder = view.superview else { return }
    var top = holder.bounds.maxY - holder.safeAreaInsets.bottom
    if let bar = holder.subviews.first(where: { $0 is UITabBar && !$0.isHidden && $0.frame.height > 0 }) {
      top = min(top, bar.frame.minY)
    }
    let margin = max(0, view.frame.maxY - top)
    view.scrollView.contentInset.bottom = margin
    view.scrollView.verticalScrollIndicatorInsets.bottom = margin
  }

  private func tell(_ event: JsonObject) {
    channel?.send(event)
  }

  private func under(_ host: String, _ domain: String) -> Bool {
    return host == domain || host.hasSuffix("." + domain)
  }

  // Whether the view's page may load `url`: the university's own, or what a
  // page makes itself. src-tauri/src/moodle.rs' `classify`, as far as
  // « stays in the view ».
  private func stays(_ url: URL) -> Bool {
    switch url.scheme?.lowercased() {
    case "about", "blob", "data":
      return true
    case "https":
      guard let rules = rules, let host = url.host?.lowercased() else { return false }
      return host == rules.home || rules.hosts.contains(host) || rules.domains.contains { under(host, $0) }
    default:
      return false
    }
  }

  // MARK: WebKit asks

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url else {
      decisionHandler(.cancel)
      return
    }
    // Frames inside a page load as in a browser.
    if let frame = action.targetFrame, !frame.isMainFrame {
      decisionHandler(.allow)
      return
    }
    // A new tab: in the view itself when it is the university's.
    if action.targetFrame == nil {
      if stays(url) {
        webView.load(action.request)
      } else {
        tell(["type": "asked", "url": url.absoluteString])
      }
      decisionHandler(.cancel)
      return
    }
    guard stays(url) else {
      tell(["type": "asked", "url": url.absoluteString])
      decisionHandler(.cancel)
      return
    }
    // A download link (a blob the page made, « Télécharger »).
    if action.shouldPerformDownload {
      decisionHandler(.download)
      return
    }
    if url.scheme?.lowercased() == "https" {
      tell(["type": "going", "url": url.absoluteString])
    }
    decisionHandler(.allow)
  }

  // window.open: as a new tab.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url {
      if stays(url) {
        webView.load(action.request)
      } else {
        tell(["type": "asked", "url": url.absoluteString])
      }
    }
    return nil
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    guard response.isForMainFrame else {
      decisionHandler(.allow)
      return
    }
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    let isAttachment = disposition.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("attachment")
    if isAttachment || !response.canShowMIMEType {
      decisionHandler(.download)
      return
    }
    // What the page now shows: a file (a PDF, a picture) or a web page.
    let mime = response.response.mimeType?.lowercased() ?? ""
    tell(["type": "shown", "file": !["", "text/html", "application/xhtml+xml"].contains(mime)])
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    tell(["type": "started", "url": webView.url?.absoluteString ?? ""])
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    tell(["type": "finished", "url": webView.url?.absoluteString ?? ""])
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  private func failed(_ error: Error) {
    let error = error as NSError
    // Not failures: a load another one replaced (-999), one that became a
    // download (102), one a plug-in took over (204).
    let isOurs =
      (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled)
      || (error.domain == "WebKitErrorDomain" && [102, 204].contains(error.code))
    if isOurs {
      tell(["type": "changed"])
      return
    }
    tell(["type": "failed", "url": error.userInfo[NSURLErrorFailingURLStringErrorKey] as? String ?? ""])
  }

  // MARK: Downloads

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  // A folder of its own for each file, so it keeps its name.
  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let folder = FileManager.default.temporaryDirectory
      .appendingPathComponent("moodle", isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      completionHandler(nil)
      return
    }
    let name = (suggestedFilename as NSString).lastPathComponent
    let file = folder.appendingPathComponent(name.isEmpty ? "Moodle" : name)
    files[ObjectIdentifier(download)] = file
    completionHandler(file)
  }

  // The file, to the share sheet: saved to Files, opened in another app,
  // printed. Its copy goes once the sheet is closed.
  func downloadDidFinish(_ download: WKDownload) {
    tell(["type": "changed"])
    guard let file = files.removeValue(forKey: ObjectIdentifier(download)), let view = view,
      let controller = manager.viewController
    else { return }
    let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    sheet.completionWithItemsHandler = { _, _, _, _ in
      try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }
    // An iPad shows it as a bubble, which wants a place to point at.
    sheet.popoverPresentationController?.sourceView = view
    sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.minY, width: 1, height: 1)
    controller.present(sheet, animated: true)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    if let file = files.removeValue(forKey: ObjectIdentifier(download)) {
      try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }
    tell(["type": "changed"])
  }
}

@_cdecl("init_plugin_moodle")
func initPlugin() -> Plugin {
  return MoodlePlugin()
}
