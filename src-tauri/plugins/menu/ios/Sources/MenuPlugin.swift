// The system's menu in place of the page's own context menu
// (src/components/ContextMenu.jsx): what iOS draws for a menu, its material,
// its haptics, its place next to the finger, VoiceOver.
//
// UIKit opens a menu from a control, not at a point: a button with nothing
// to see is put where the page says (one point wide and high for a context
// menu, the size of the page's own button for a dropdown, which the menu
// then hangs from) and opens its menu (performPrimaryAction, iOS 17.4). The page says what is in it (`show`,
// through the app: src-tauri/src/ios_chrome.rs) and hears what is picked: a
// `tafac:menu` event on window, detail { token, id }, id null when the menu
// closed without a pick.

import SwiftRs
import Tauri
import UIKit
import WebKit

struct MenuItem: Decodable {
  // A line between two groups: nothing else is read.
  let separator: Bool?
  let id: String?
  let label: String?
  // A second, smaller line under the label.
  let subtitle: String?
  // The page's own icon, as it draws it: PNG in base64, three pixels to the
  // point. `template`: black on nothing, which the menu colours; else a
  // picture shown as it is (a colour's dot).
  let image: String?
  let template: Bool?
  let destructive: Bool?
  let disabled: Bool?
  // Ticked.
  let checked: Bool?
}

struct ShowArgs: Decodable {
  // The page's name for this menu, given back with the answer.
  let token: String
  // Where it opens, in the page's coordinates: a point, or with a width
  // and a height the box of the button it hangs from.
  let x: Double
  let y: Double
  let width: Double?
  let height: Double?
  let title: String?
  let items: [MenuItem]
}

struct CloseArgs: Decodable {
  let token: String
}

// The button the menu opens from. It says when its menu has gone. A finger
// never finds it (it lies over the page's own button): the app opens its
// menu. It stays a working control all along: UIKit sends the item picked
// through it, after the menu has closed.
class MenuAnchor: UIButton {
  var onEnd: (() -> Void)?

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    return false
  }

  override func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
    let end = onEnd
    if let animator = animator {
      animator.addCompletion { end?() }
    } else {
      end?()
    }
  }
}

class MenuPlugin: Plugin {
  private weak var webview: WKWebView?
  private var anchor: MenuAnchor?
  // The menu shown, until the page has its answer.
  private var token: String?

  override func load(webview: WKWebView) {
    self.webview = webview
  }

  @objc public func show(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShowArgs.self)
    DispatchQueue.main.async {
      invoke.resolve(["shown": self.present(args)])
    }
  }

  @objc public func close(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CloseArgs.self)
    DispatchQueue.main.async {
      if self.token == args.token {
        // The page took it back: it waits for no answer.
        self.token = nil
        self.anchor?.contextMenuInteraction?.dismissMenu()
        self.removeAnchor()
      }
    }
    invoke.resolve()
  }

  private func present(_ args: ShowArgs) -> Bool {
    guard #available(iOS 17.4, *), let page = webview, let holder = page.superview else { return false }
    // One menu at a time: the one before closed without a pick.
    if let before = token {
      answer(before, nil)
      anchor?.contextMenuInteraction?.dismissMenu()
      removeAnchor()
    }

    let button = MenuAnchor(
      frame: CGRect(
        x: page.frame.minX + args.x, y: page.frame.minY + args.y, width: max(1, args.width ?? 1),
        height: max(1, args.height ?? 1)))
    button.menu = menu(args)
    button.showsMenuAsPrimaryAction = true
    button.onEnd = { [weak self, weak button] in
      // After the pick's own handler, when there was a pick.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
        guard let self = self else { return }
        if self.token == args.token {
          self.answer(args.token, nil)
        }
        if self.anchor === button {
          self.removeAnchor()
        } else {
          button?.removeFromSuperview()
        }
      }
    }
    holder.addSubview(button)
    anchor = button
    token = args.token
    button.performPrimaryAction()
    return true
  }

  private func removeAnchor() {
    anchor?.removeFromSuperview()
    anchor = nil
  }

  // The items in groups, a line between two (the page's separators).
  private func menu(_ args: ShowArgs) -> UIMenu {
    var groups: [[UIMenuElement]] = [[]]
    for item in args.items {
      if item.separator == true {
        groups.append([])
        continue
      }
      guard let id = item.id, let label = item.label else { continue }
      var attributes: UIMenuElement.Attributes = []
      if item.destructive == true { attributes.insert(.destructive) }
      if item.disabled == true { attributes.insert(.disabled) }
      let action = UIAction(
        title: label, image: picture(item), attributes: attributes, state: item.checked == true ? .on : .off
      ) { [weak self] _ in
        self?.answer(args.token, id)
      }
      if #available(iOS 16.0, *) {
        action.subtitle = item.subtitle
      }
      groups[groups.count - 1].append(action)
    }
    let filled = groups.filter { !$0.isEmpty }
    let children: [UIMenuElement] =
      filled.count == 1 ? filled[0] : filled.map { UIMenu(title: "", options: .displayInline, children: $0) }
    return UIMenu(title: args.title ?? "", children: children)
  }

  private func picture(_ item: MenuItem) -> UIImage? {
    guard let base64 = item.image, let data = Data(base64Encoded: base64),
      let image = UIImage(data: data, scale: 3)
    else { return nil }
    return image.withRenderingMode(item.template == false ? .alwaysOriginal : .alwaysTemplate)
  }

  // Once per menu: the pick, or nothing.
  private func answer(_ answered: String, _ id: String?) {
    guard token == answered else { return }
    token = nil
    guard let data = try? JSONEncoder().encode(["token": answered, "id": id]),
      let detail = String(data: data, encoding: .utf8)
    else { return }
    webview?.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('tafac:menu', { detail: \(detail) }))", completionHandler: nil)
  }
}

@_cdecl("init_plugin_menu")
func initPlugin() -> Plugin {
  return MenuPlugin()
}
