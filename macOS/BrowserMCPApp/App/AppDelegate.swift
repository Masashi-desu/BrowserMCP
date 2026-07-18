import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let settings: BridgeSettings
  let service: BridgeService
  private var managementWindow: NSWindow?

  override init() {
    let settings = BridgeSettings()
    self.settings = settings
    service = BridgeService(settings: settings)
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApplication.shared.setActivationPolicy(.accessory)
    let environment = ProcessInfo.processInfo.environment
    let autostartDisabled =
      environment["BROWSERMCP_DISABLE_AUTOSTART"] == "1"
      || environment["XCTestConfigurationFilePath"] != nil
    if settings.startWhenAppLaunches, !autostartDisabled { service.start() }
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    service.shutdownSynchronously()
    return .terminateNow
  }

  func showDashboard() {
    let window: NSWindow
    if let managementWindow {
      window = managementWindow
    } else {
      let controller = NSHostingController(rootView: DashboardView(service: service))
      window = NSWindow(contentViewController: controller)
      window.title = "BrowserMCP"
      window.setContentSize(NSSize(width: 780, height: 680))
      window.minSize = NSSize(width: 720, height: 600)
      window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
      window.isReleasedWhenClosed = false
      window.center()
      managementWindow = window
    }
    NSApplication.shared.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
  }
}
