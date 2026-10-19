// 07-06 print harness — WebKit leg.
// Prints a local HTML file to PDF through WKWebView.printOperation (the same
// engine family as iPhone Safari, which produced the UAT PDF). WebKit lays a
// printed page out at 1 CSS px = 1 pt; WK_MARGIN_PT (default 49.7, the margin
// measured on the operator's iOS PDF) sets the page margins in points.
// Usage: WK_MARGIN_PT=49.7 ./wkprint in.html out.pdf
import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 3 else { FileHandle.standardError.write("usage: wkprint in.html out.pdf\n".data(using: .utf8)!); exit(2) }
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let pageW: CGFloat = 595.28, pageH: CGFloat = 841.89
let m: CGFloat = CGFloat(Double(ProcessInfo.processInfo.environment["WK_MARGIN_PT"] ?? "49.7") ?? 49.7)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: pageW - 2 * m, height: pageH - 2 * m))
let window = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = web

final class Delegate: NSObject, WKNavigationDelegate {
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
      let info = NSPrintInfo()
      info.paperSize = NSSize(width: pageW, height: pageH)
      info.topMargin = m; info.bottomMargin = m; info.leftMargin = m; info.rightMargin = m
      info.horizontalPagination = .clip
      info.verticalPagination = .automatic
      info.isHorizontallyCentered = false
      info.isVerticallyCentered = false
      info.jobDisposition = .save
      info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = outURL
      let op = webView.printOperation(with: info)
      op.showsPrintPanel = false
      op.showsProgressPanel = false
      op.view?.frame = NSRect(x: 0, y: 0, width: pageW - 2 * m, height: pageH - 2 * m)
      op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { exit(0) }
    }
  }
}
let delegate = Delegate()
web.navigationDelegate = delegate
web.loadFileURL(inURL, allowingReadAccessTo: inURL.deletingLastPathComponent())
app.run()
