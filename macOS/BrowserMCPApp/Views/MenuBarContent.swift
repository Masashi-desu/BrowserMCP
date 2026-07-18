import AppKit
import SwiftUI

struct MenuBarLabel: View {
  @ObservedObject var service: BridgeService

  var body: some View {
    Label("BrowserMCP — \(service.state.title)", systemImage: service.state.symbolName)
  }
}

struct MenuBarContent: View {
  @ObservedObject var service: BridgeService
  let showDashboard: () -> Void

  var body: some View {
    Button("Open BrowserMCP…", systemImage: "macwindow", action: showDashboard)
    Divider()
    Label(service.state.title, systemImage: service.state.symbolName)
    if let endpoints = service.endpoints {
      Button("Copy MCP endpoint", systemImage: "doc.on.doc") {
        service.copyToPasteboard(endpoints.mcpEndpoint)
      }
      Button("Copy Browser endpoint", systemImage: "doc.on.doc") {
        service.copyToPasteboard(endpoints.browserEndpoint)
      }
      Button("Open status UI", systemImage: "safari") { service.openStatusUI() }
    }
    Divider()
    Button("Start Bridge", systemImage: "play.fill") { service.start() }
      .disabled(!service.canStart)
    Button("Restart Bridge", systemImage: "arrow.clockwise") { service.restart() }
      .disabled(service.state != .running)
    Button("Stop Bridge", systemImage: "stop.fill") { service.stop() }
      .disabled(!service.canStop)
    Divider()
    Button("Quit BrowserMCP", systemImage: "power") {
      NSApplication.shared.terminate(nil)
    }
    .keyboardShortcut("q")
  }
}
