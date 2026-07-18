import SwiftUI

@main
struct BrowserMCPApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

  var body: some Scene {
    MenuBarExtra {
      MenuBarContent(service: appDelegate.service, showDashboard: appDelegate.showDashboard)
    } label: {
      MenuBarLabel(service: appDelegate.service)
    }
    .menuBarExtraStyle(.menu)
  }
}
