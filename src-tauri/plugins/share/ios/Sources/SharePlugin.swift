// The system's share sheet for a file the app downloaded
// (src-tauri/src/ios_downloads.rs): saved to Files, opened in another app,
// sent by AirDrop, printed. As Moodle's view does with Moodle's files
// (plugins/moodle).
//
// The file is alone in a folder of the app's temporary folder, so it keeps
// its name. That folder goes once the sheet is closed; what a closed app
// left there goes when it starts again.

import SwiftRs
import Tauri
import UIKit
import WebKit

struct ShareArgs: Decodable {
  let path: String
}

class SharePlugin: Plugin {
  private weak var webview: WKWebView?

  override func load(webview: WKWebView) {
    self.webview = webview
  }

  @objc public func share(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareArgs.self)
    let file = URL(fileURLWithPath: args.path)
    let folder = file.deletingLastPathComponent()
    // The app waits for this answer, not for the sheet.
    invoke.resolve()
    DispatchQueue.main.async {
      guard let page = self.webview, var controller = self.manager.viewController,
        FileManager.default.fileExists(atPath: file.path)
      else {
        try? FileManager.default.removeItem(at: folder)
        return
      }
      // Over what is already over the app (the browser sheet).
      while let shown = controller.presentedViewController, !shown.isBeingDismissed {
        controller = shown
      }
      let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
      // Also called when one of its actions is cancelled (Files' picker
      // closed) while the sheet stays: the file stays with it.
      sheet.completionWithItemsHandler = { activity, completed, _, _ in
        if completed || activity == nil {
          try? FileManager.default.removeItem(at: folder)
        }
      }
      // An iPad shows it as a bubble, which wants a place to point at.
      sheet.popoverPresentationController?.sourceView = page
      sheet.popoverPresentationController?.sourceRect = CGRect(x: page.bounds.midX, y: page.bounds.midY, width: 1, height: 1)
      sheet.popoverPresentationController?.permittedArrowDirections = []
      controller.present(sheet, animated: true)
    }
  }
}

@_cdecl("init_plugin_share")
func initPlugin() -> Plugin {
  return SharePlugin()
}
