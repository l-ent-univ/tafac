// The system's glass for the controls of the page's own chrome (the pills
// and round buttons of a page's header, of a bar floating over it):
// UIGlassEffect, which bends and lights what passes behind it, and gives
// under a finger.
//
// The page says which controls there are (`update`, through the app:
// src-tauri/src/ios_chrome.rs; src/iosGlass.js): each one's box and
// corners, how it moves with the scroll, and a picture of what it shows
// (the page paints its own text and icons). The plugin lays a glass view
// for each inside the web view, in the view that holds the page's content:
// - there it scrolls with the page by itself, to the pixel, bounce
//   included. What the page holds to the screen or sticks to its top is put
//   back in its place at each step of the scroll, in the same frame
//   (`place`: the rules of src/iosGlassModel.js, controlTop);
// - a finger on the glass is a finger on the page too (WebKit's gesture
//   recognizers are that view's): the glass gives under it, and the page
//   does what a press, a long press or a scroll started there does. The
//   glass has no action of its own, and VoiceOver reads the page's element.
//
// What passes under the status bar fades as the page's own veil covers it
// (`veilMask`). A control comes in as the page says: with what animates
// its page in, started when the page's started, or in a short fade.

import SwiftRs
import Tauri
import UIKit
import WebKit

// An icon that turns for good (« Actualiser » at work): its own picture,
// its box in the control, a turn's time (ms) and curve.
struct GlassSpin: Decodable {
  let image: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let period: Double
  let easing: [Double]
}

// The app's spinner, as the system's: its box in the control, its colour.
struct GlassBusy: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let color: String
}

// How a control comes in: from its box moved by (dx, dy) and scaled by
// (sx, sy) to its own; `start` on the device's clock (ms since 1970: when
// the page's own animation started), `duration` in ms, `easing` a cubic
// curve's four numbers.
struct GlassMove: Decodable {
  let dx: Double
  let dy: Double
  let sx: Double
  let sy: Double
  let start: Double
  let duration: Double
  let easing: [Double]
}

// And from how much of its opacity. Without a `start`: from when it shows
// (over the page's own drawing, which goes after).
struct GlassFade: Decodable {
  let from: Double
  let start: Double?
  let duration: Double
  let easing: [Double]
}

struct GlassControl: Decodable {
  let id: String
  // "page": in the page; "fixed": held to the screen; "sticky": in the page
  // down to `stick` (its top on the screen), there from then on, until
  // `limit` (its lowest top in the page) takes it up.
  let anchor: String
  // Its box: in the page, on the screen for "fixed".
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let radius: Double
  let stick: Double?
  let limit: Double?
  // "#rrggbb": the app's primary button.
  let tint: String?
  // What it shows: the key of a picture (`images`, or one sent before).
  let image: String?
  let spins: [GlassSpin]?
  let busy: [GlassBusy]?
  let move: GlassMove?
  let fade: GlassFade?
}

// The page's veil over the status bar (.ios-status-veil): `height` tall,
// whole down to `solid` of it then fading; there from the scroll position
// `from` on, at full strength at `to`.
struct GlassVeil: Decodable {
  let height: Double
  let solid: Double
  let from: Double
  let to: Double
}

struct UpdateArgs: Decodable {
  let controls: [GlassControl]
  // key → PNG in base64, three pixels to the point: the pictures the
  // plugin doesn't hold (it holds those of the controls it was last sent).
  let images: [String: String]?
  let dark: Bool?
  let veil: GlassVeil?
  // The controls that go in a fade (the page's own drawing is back under
  // them); the others go at once, with their page.
  let fade: [String]?
  // "#rrggbb": the mark of the page's frame this was read from (the theme
  // colour it gave that frame). The controls change when that frame shows.
  let after: String?
}

// Lets through every touch that isn't on one of its controls.
class PassThroughView: UIView {
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }
}

// One control on screen: its glass, in a view of its own that places it
// and fades it. (Faded itself, a glass view keeps blurring what is behind
// it at full strength: the page's own drawing under it was gone at once.)
private final class Shown {
  let view = PassThroughView()
  let glass = UIVisualEffectView(effect: nil)
  let picture = UIImageView()
  var control: GlassControl
  // Its turning icons and spinners.
  var extras: [UIView] = []
  var look = ""
  var material = ""
  var radius = -1.0
  init(_ control: GlassControl) {
    self.control = control
  }
}

class GlassPlugin: Plugin {
  private weak var webview: WKWebView?
  private var shown: [String: Shown] = [:]
  // The views of the controls that left, for the next ones: a glass view
  // takes a few milliseconds to make, on the thread the scroll runs on.
  private var spare: [Shown] = []
  private var pictures: [String: UIImage] = [:]
  private var root: PassThroughView?
  private var veil: GlassVeil?
  private let mask = CAGradientLayer()
  private var masked = false
  private var warmed = false
  private var scrolling: NSKeyValueObservation?
  private var loading: NSKeyValueObservation?
  private var waking: NSObjectProtocol?
  // The marks of the page's last frames (its theme colour, as each frame
  // arrived), and what waits for one.
  private var marks: [String] = []
  private var waiting: (mark: String, show: () -> Void)?
  private var marking: NSKeyValueObservation?

  override func load(webview: WKWebView) {
    self.webview = webview
    // WebKit says the page's theme colour as it shows the frame that
    // changed it: a mark the page puts on a frame (src/iosGlass.js).
    marking = webview.observe(\.themeColor) { [weak self] page, _ in
      guard let self = self, let mark = self.hex(page.themeColor) else { return }
      self.marks.append(mark)
      if self.marks.count > 16 { self.marks.removeFirst() }
      if mark == self.waiting?.mark { self.showWaiting() }
    }
  }

  private func showWaiting() {
    let show = waiting?.show
    waiting = nil
    show?()
  }

  @objc public func update(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateArgs.self)
    // Read here, off the main thread: the scroll runs on it.
    var arrived: [String: UIImage] = [:]
    for (key, text) in args.images ?? [:] {
      guard let data = Data(base64Encoded: text), let image = UIImage(data: data, scale: 3) else { continue }
      arrived[key] = image.preparingForDisplay() ?? image
    }
    DispatchQueue.main.async {
      // One still waiting: its frame has had its time.
      self.showWaiting()
      let show = { invoke.resolve(["shown": self.apply(args, arrived)]) }
      // Shown when the page's frame is: at once if it is there already, or
      // when nothing says it came (a quarter of a second).
      guard let mark = args.after, self.root != nil, !self.marks.contains(mark), self.hex(self.webview?.themeColor) != mark
      else {
        show()
        return
      }
      self.waiting = (mark, show)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
        if self?.waiting?.mark == mark { self?.showWaiting() }
      }
    }
  }

  // The view that holds the controls, made the first time there is one: in
  // the view that holds the page's content (WebKit's own, in the web view's
  // scroll view, told by its name), over all of it.
  private func layer(_ page: WKWebView) -> PassThroughView? {
    if let root = root, let holder = root.superview {
      if holder.subviews.last !== root { holder.bringSubviewToFront(root) }
      return root
    }
    guard let content = page.scrollView.subviews.first(where: { NSStringFromClass(type(of: $0)).hasPrefix("WKContent") })
    else { return nil }
    let root = self.root ?? PassThroughView()
    // VoiceOver reads the page's own elements, under the glass.
    root.accessibilityElementsHidden = true
    content.addSubview(root)
    self.root = root
    scrolling = page.scrollView.observe(\.contentOffset) { [weak self] _, _ in
      self?.follow()
    }
    // The page loads again: its controls are gone before it says so.
    loading = page.observe(\.isLoading) { [weak self] page, _ in
      if page.isLoading { self?.clear() }
    }
    // Back from the background, where iOS stops what turns.
    waking = NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self = self else { return }
      for entry in self.shown.values where !entry.extras.isEmpty { self.fill(entry) }
    }
    return root
  }

  // The controls where the page's scroll puts them.
  private func follow() {
    guard let page = webview, let root = root else { return }
    let scroller = page.scrollView
    let offset = scroller.contentOffset
    // The page's own scroll position.
    let inset = scroller.adjustedContentInset
    let scroll = CGPoint(x: offset.x + inset.left, y: offset.y + inset.top)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    // Over what shows of the page, in the page's coordinates.
    root.frame = CGRect(origin: offset, size: scroller.bounds.size)
    root.bounds.origin = offset
    var under = false
    for entry in shown.values {
      place(entry, scroll)
      if let veil = veil, entry.view.frame.minY - scroll.y < veil.height, entry.view.frame.maxY > offset.y {
        under = true
      }
    }
    veilMask(scroll, under)
    CATransaction.commit()
  }

  // A control where the page's own element is at this scroll position
  // (src/iosGlassModel.js, controlTop: keep the two in step).
  private func place(_ entry: Shown, _ scroll: CGPoint) {
    let control = entry.control
    var x = control.x
    var y = control.y
    switch control.anchor {
    case "fixed":
      x += scroll.x
      y += scroll.y
    case "sticky":
      y = min(max(y, scroll.y + (control.stick ?? 0)), max(control.limit ?? .greatestFiniteMagnitude, y))
    default:
      break
    }
    let center = CGPoint(x: x + control.width / 2, y: y + control.height / 2)
    if entry.view.center != center { entry.view.center = center }
  }

  // What passes under the status bar fades as the page's veil covers it
  // (src/iosGlassModel.js, shownUnderVeil). Only while a control is there:
  // a mask has every control drawn apart from the page first.
  private func veilMask(_ scroll: CGPoint, _ under: Bool) {
    guard let root = root else { return }
    var strength = 0.0
    if let veil = veil, under {
      strength = veil.to > veil.from ? min(1, max(0, (scroll.y - veil.from) / (veil.to - veil.from))) : (scroll.y >= veil.from ? 1 : 0)
    }
    guard let veil = veil, strength > 0, root.bounds.height > 0 else {
      if masked {
        root.layer.mask = nil
        masked = false
      }
      return
    }
    let top = scroll.y - root.bounds.origin.y
    let through = UIColor(white: 0, alpha: 1 - strength).cgColor
    mask.frame = root.bounds
    mask.colors = [through, through, UIColor.black.cgColor, UIColor.black.cgColor]
    mask.locations = [
      0, NSNumber(value: (top + veil.height * veil.solid) / root.bounds.height),
      NSNumber(value: (top + veil.height) / root.bounds.height), 1,
    ]
    if !masked {
      root.layer.mask = mask
      masked = true
    }
  }

  // Whether the system has the glass, and the controls are shown. Not on a
  // tablet: the page's layout there isn't made for it.
  private func apply(_ args: UpdateArgs, _ arrived: [String: UIImage]) -> Bool {
    guard #available(iOS 26.0, *), UIDevice.current.userInterfaceIdiom == .phone, let page = webview,
      let root = layer(page)
    else { return false }
    veil = args.veil
    let dark = args.dark == true
    if !warmed {
      warmed = true
      warm(root)
    }

    // The pictures of the controls there are, and no other.
    var kept: [String: UIImage] = [:]
    for control in args.controls {
      for key in [control.image].compactMap({ $0 }) + (control.spins ?? []).map({ $0.image }) {
        if let image = arrived[key] ?? pictures[key] { kept[key] = image }
      }
    }
    pictures = kept

    let wanted = Set(args.controls.map { $0.id })
    for (id, gone) in shown where !wanted.contains(id) {
      shown[id] = nil
      if args.fade?.contains(id) == true { leave(gone) } else { put(gone) }
    }
    let now = Date().timeIntervalSince1970 * 1000
    for control in args.controls {
      if let entry = shown[control.id] {
        entry.control = control
        dress(entry, dark)
      } else {
        let entry = take(control, dark, root)
        dress(entry, dark)
        shown[control.id] = entry
        arrive(entry, now)
      }
    }
    follow()
    return true
  }

  // A view for a new control: one a control left, of the same material if
  // there is one, else a new one.
  @available(iOS 26.0, *)
  private func take(_ control: GlassControl, _ dark: Bool, _ root: UIView) -> Shown {
    let material = "\(control.tint ?? "")|\(dark)"
    if let index = spare.firstIndex(where: { $0.material == material }) ?? spare.indices.first {
      let entry = spare.remove(at: index)
      entry.control = control
      entry.view.isHidden = false
      entry.view.isUserInteractionEnabled = true
      root.bringSubviewToFront(entry.view)
      return entry
    }
    let entry = Shown(control)
    entry.glass.frame = entry.view.bounds
    entry.glass.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    entry.view.addSubview(entry.glass)
    entry.picture.frame = entry.glass.contentView.bounds
    entry.picture.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    entry.glass.contentView.addSubview(entry.picture)
    root.addSubview(entry.view)
    return entry
  }

  // A view no control has any more, kept for the next one.
  private func put(_ entry: Shown) {
    for extra in entry.extras { extra.removeFromSuperview() }
    entry.extras = []
    entry.look = ""
    entry.picture.image = nil
    entry.view.layer.removeAllAnimations()
    guard spare.count < 8 else {
      entry.view.removeFromSuperview()
      return
    }
    entry.view.isHidden = true
    entry.view.alpha = 1
    spare.append(entry)
  }

  // Before the first control shows: a few views made ahead, as the app
  // starts, so that a page's first controls don't wait for theirs.
  @available(iOS 26.0, *)
  private func warm(_ root: UIView) {
    let control = GlassControl(
      id: "", anchor: "page", x: 0, y: 0, width: 44, height: 44, radius: 22, stick: nil, limit: nil, tint: nil,
      image: nil, spins: nil, busy: nil, move: nil, fade: nil)
    let made = (0..<4).map { _ -> Shown in
      let entry = take(control, false, root)
      dress(entry, false)
      return entry
    }
    for entry in made { put(entry) }
  }

  // A control's size, corners, material and content, as the page has them.
  @available(iOS 26.0, *)
  private func dress(_ entry: Shown, _ dark: Bool) {
    let control = entry.control
    let size = CGSize(width: control.width, height: control.height)
    UIView.performWithoutAnimation {
      if entry.view.bounds.size != size { entry.view.bounds.size = size }
      if entry.radius != control.radius {
        entry.radius = control.radius
        entry.glass.cornerConfiguration = .corners(radius: .fixed(control.radius))
      }
    }
    let material = "\(control.tint ?? "")|\(dark)"
    if material != entry.material {
      entry.material = material
      let glass = UIGlassEffect(style: .regular)
      glass.isInteractive = true
      glass.tintColor = control.tint.flatMap(color)
      entry.glass.effect = glass
      // The page's theme, whatever is behind: its ink reads on it.
      entry.glass.overrideUserInterfaceStyle = dark ? .dark : .light
    }
    let spins = (control.spins ?? []).map { "\($0.image),\($0.x),\($0.y),\($0.width),\($0.height),\($0.period)" }
    let busy = (control.busy ?? []).map { "\($0.x),\($0.y),\($0.width),\($0.height),\($0.color)" }
    let look = ([control.image ?? ""] + spins + busy).joined(separator: "|")
    if look != entry.look {
      entry.look = look
      fill(entry)
    }
  }

  // What a control shows: its picture, and over it what turns. Changed at
  // once, as the page changes it (with the frame that has it).
  private func fill(_ entry: Shown) {
    let control = entry.control
    entry.picture.image = control.image.flatMap { pictures[$0] }
    for extra in entry.extras { extra.removeFromSuperview() }
    entry.extras = []
    for spin in control.spins ?? [] {
      let icon = UIImageView(image: pictures[spin.image])
      icon.frame = CGRect(x: spin.x, y: spin.y, width: spin.width, height: spin.height)
      let turn = CABasicAnimation(keyPath: "transform.rotation.z")
      turn.fromValue = 0
      turn.toValue = 2 * Double.pi
      turn.duration = max(0.1, spin.period / 1000)
      turn.repeatCount = .infinity
      turn.timingFunction = curve(spin.easing)
      icon.layer.add(turn, forKey: "glass.spin")
      entry.glass.contentView.addSubview(icon)
      entry.extras.append(icon)
    }
    for busy in control.busy ?? [] {
      let spinner = UIActivityIndicatorView(style: .medium)
      spinner.color = color(busy.color)
      spinner.center = CGPoint(x: busy.x + busy.width / 2, y: busy.y + busy.height / 2)
      let scale = min(busy.width, busy.height) / max(spinner.bounds.width, 1)
      spinner.transform = CGAffineTransform(scaleX: scale, y: scale)
      spinner.startAnimating()
      entry.glass.contentView.addSubview(spinner)
      entry.extras.append(spinner)
    }
  }

  // A new control comes in as the page says: with what animates its page
  // in, from where that is by now, or in a fade over the page's own
  // drawing; else at once.
  private func arrive(_ entry: Shown, _ now: Double) {
    let control = entry.control
    let layer = entry.view.layer
    entry.view.alpha = 1
    if let move = control.move, let animation = entrance("transform", move.start, move.duration, move.easing, now, layer) {
      animation.fromValue = CATransform3DConcat(
        CATransform3DMakeScale(move.sx, move.sy, 1), CATransform3DMakeTranslation(move.dx, move.dy, 0))
      animation.toValue = CATransform3DIdentity
      layer.add(animation, forKey: "glass.move")
    }
    if let fade = control.fade, let animation = entrance("opacity", fade.start ?? now, fade.duration, fade.easing, now, layer) {
      animation.fromValue = fade.from
      animation.toValue = 1
      layer.add(animation, forKey: "glass.fade")
    }
  }

  // An animation the page started at `start`: nil once it is over.
  private func entrance(
    _ keyPath: String, _ start: Double, _ duration: Double, _ easing: [Double], _ now: Double, _ layer: CALayer
  ) -> CABasicAnimation? {
    // Not started yet (its delay): it waits. A clock set since: from now.
    let elapsed = max(-1, (now - start) / 1000)
    let length = duration / 1000
    guard length > 0, elapsed < length else { return nil }
    let animation = CABasicAnimation(keyPath: keyPath)
    animation.duration = length
    animation.timingFunction = curve(easing)
    animation.beginTime = layer.convertTime(CACurrentMediaTime(), from: nil) - elapsed
    animation.fillMode = .backwards
    return animation
  }

  private func curve(_ easing: [Double]) -> CAMediaTimingFunction {
    guard easing.count == 4 else { return CAMediaTimingFunction(name: .linear) }
    return CAMediaTimingFunction(controlPoints: Float(easing[0]), Float(easing[1]), Float(easing[2]), Float(easing[3]))
  }

  // A control goes: the page's own drawing is under it, or its page is gone.
  private func leave(_ entry: Shown) {
    let view = entry.view
    view.isUserInteractionEnabled = false
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = view.layer.presentation()?.opacity ?? view.layer.opacity
    fade.toValue = 0
    fade.duration = 0.12
    fade.timingFunction = CAMediaTimingFunction(name: .easeIn)
    CATransaction.begin()
    CATransaction.setCompletionBlock { [weak self] in self?.put(entry) }
    view.alpha = 0
    view.layer.add(fade, forKey: "glass.fade")
    CATransaction.commit()
  }

  private func clear() {
    showWaiting()
    for entry in shown.values { put(entry) }
    shown = [:]
    pictures = [:]
    marks = []
    veil = nil
    veilMask(.zero, false)
  }

  private func hex(_ color: UIColor?) -> String? {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard let color = color, color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return nil }
    return String(format: "#%02x%02x%02x", Int((red * 255).rounded()), Int((green * 255).rounded()), Int((blue * 255).rounded()))
  }

  private func color(_ hex: String) -> UIColor? {
    guard hex.hasPrefix("#"), hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1)
  }
}

@_cdecl("init_plugin_glass")
func initPlugin() -> Plugin {
  return GlassPlugin()
}
