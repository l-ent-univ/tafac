// The system's tab bar under the page, in place of the page's own
// (src/components/MobileTabBar.jsx): what iOS draws for a tab bar, its
// material, its selection, its haptics, VoiceOver.
//
// The bar lies over the web view, along the screen's bottom edge. The page
// says what it shows (`update`, through the app: src-tauri/src/ios_chrome.rs)
// and hears what is pressed: a `tafac:tab` event on window, detail { id }.

import SwiftRs
import Tauri
import UIKit
import WebKit

struct TabItem: Decodable {
  let id: String
  let label: String
  // The page's own icons, as it draws them: PNG in base64, three pixels to
  // the point, black on nothing (the bar colours them).
  let image: String?
  let selectedImage: String?
  // SF Symbols' names, for a tab whose icon the page couldn't draw.
  let symbol: String
  let selectedSymbol: String?
  // Opens something else (Moodle, over the app): pressed, never selected.
  let link: Bool?
  // Just launched: a dot on the icon.
  let badge: Bool?
}

struct UpdateArgs: Decodable {
  let items: [TabItem]
  let selected: String?
  let visible: Bool
  // "#rrggbb": the selected tab's colour.
  let tint: String?
}

struct PressArgs: Decodable {
  let id: String
}

class TabBarPlugin: Plugin, UITabBarDelegate {
  private weak var webview: WKWebView?
  private var bar: UITabBar?
  private var items: [TabItem] = []
  private var selected: String?

  override func load(webview: WKWebView) {
    self.webview = webview
  }

  @objc public func update(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateArgs.self)
    DispatchQueue.main.async {
      self.apply(args)
    }
    invoke.resolve()
  }

  // Development: a tab pressed without a finger (the app's TAFAC_PRESS_TAB),
  // by the same way as one.
  @objc public func press(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PressArgs.self)
    DispatchQueue.main.async {
      guard let bar = self.bar, let index = self.items.firstIndex(where: { $0.id == args.id }),
        let item = bar.items?[index]
      else { return }
      bar.selectedItem = item
      self.tabBar(bar, didSelect: item)
    }
    invoke.resolve()
  }

  // The bar, made the first time there is something to show: over the web
  // view, on its holder's bottom edge. UIKit adds the home indicator's room
  // below the tabs itself.
  private func makeBar() -> UITabBar? {
    if let bar = bar { return bar }
    guard let webview = webview, let holder = webview.superview else { return nil }
    let bar = UITabBar()
    bar.delegate = self
    bar.isHidden = true
    bar.translatesAutoresizingMaskIntoConstraints = false
    holder.addSubview(bar)
    NSLayoutConstraint.activate([
      bar.leadingAnchor.constraint(equalTo: holder.leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: holder.trailingAnchor),
      bar.bottomAnchor.constraint(equalTo: holder.bottomAnchor),
    ])
    self.bar = bar
    return bar
  }

  private func apply(_ args: UpdateArgs) {
    guard let bar = makeBar() else { return }

    if args.items.map(look) != items.map(look) {
      bar.setItems(
        args.items.enumerated().map { index, item in
          let image = icon(item.image) ?? UIImage(systemName: item.symbol)
          let selectedImage = icon(item.selectedImage) ?? item.selectedSymbol.flatMap { UIImage(systemName: $0) }
          let barItem = UITabBarItem(title: item.label, image: image, selectedImage: selectedImage)
          barItem.tag = index
          return barItem
        }, animated: false)
    }
    items = args.items
    selected = args.selected

    for (index, item) in args.items.enumerated() {
      guard let barItem = bar.items?[index] else { continue }
      barItem.badgeValue = item.badge == true ? "" : nil
      barItem.badgeColor = .systemBlue
    }
    select(args.selected)
    if let tint = args.tint.flatMap(color) {
      bar.tintColor = tint
    }
    bar.isHidden = !args.visible || args.items.isEmpty
  }

  // What a tab looks like: the bar's items are made again when it changes.
  private func look(_ item: TabItem) -> String {
    return [item.id, item.label, item.symbol, item.image ?? "", item.selectedImage ?? ""].joined(separator: "|")
  }

  // A template image: the bar draws it in its own colours.
  private func icon(_ base64: String?) -> UIImage? {
    guard let base64 = base64, let data = Data(base64Encoded: base64),
      let image = UIImage(data: data, scale: 3)
    else { return nil }
    return image.withRenderingMode(.alwaysTemplate)
  }

  private func select(_ id: String?) {
    guard let bar = bar else { return }
    let index = items.firstIndex { $0.id == id }
    bar.selectedItem = index.flatMap { bar.items?[$0] }
  }

  private func color(_ hex: String) -> UIColor? {
    guard hex.hasPrefix("#"), hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1)
  }

  // A tab pressed, the selected one too (the page goes back to its top).
  // The page says what is selected after that; a link never is.
  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard items.indices.contains(item.tag) else { return }
    let pressed = items[item.tag]
    if pressed.link == true {
      select(selected)
    }
    guard let data = try? JSONEncoder().encode(["id": pressed.id]),
      let detail = String(data: data, encoding: .utf8)
    else { return }
    webview?.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('tafac:tab', { detail: \(detail) }))", completionHandler: nil)
  }
}

@_cdecl("init_plugin_tabbar")
func initPlugin() -> Plugin {
  return TabBarPlugin()
}
