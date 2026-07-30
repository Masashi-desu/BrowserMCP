import AppKit
import SwiftUI

struct DashboardView: View {
  @ObservedObject private var service: BridgeService
  @ObservedObject private var settings: BridgeSettings
  @State private var revealMCPToken = false
  @State private var revealAdminToken = false
  @State private var pairingOrigin = ""
  @State private var pairingError: String?
  @State private var issuingPairingToken = false
  @State private var approvalError: String?
  @State private var decidingApprovalId: String?

  init(service: BridgeService) {
    self.service = service
    settings = service.settings
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        header
        if case .failed(let message) = service.state {
          Label(message, systemImage: "exclamationmark.triangle.fill")
            .foregroundStyle(.red)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }
        runtimeSummary
        endpointsSection
        pairingSection
        configurationSection
        diagnosticsSection
      }
      .padding(24)
    }
    .frame(minWidth: 720, minHeight: 600)
    .background(Color(nsColor: .windowBackgroundColor))
    .onChange(of: service.endpoints?.mcpToken) { _, _ in revealMCPToken = false }
    .onChange(of: service.endpoints?.adminToken) { _, _ in revealAdminToken = false }
  }

  private var header: some View {
    HStack(spacing: 14) {
      Image(systemName: "point.3.connected.trianglepath.dotted")
        .font(.system(size: 30, weight: .semibold))
        .foregroundStyle(.tint)
        .frame(width: 48, height: 48)
        .background(.tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
      VStack(alignment: .leading, spacing: 3) {
        Text("BrowserMCP Bridge")
          .font(.title2.weight(.semibold))
        Label(service.state.title, systemImage: service.state.symbolName)
          .foregroundStyle(service.state.tint)
      }
      Spacer()
      Button("Start", systemImage: "play.fill") { service.start() }
        .disabled(!service.canStart)
      Button("Restart", systemImage: "arrow.clockwise") { service.restart() }
        .disabled(service.state != .running)
      Button("Stop", systemImage: "stop.fill") { service.stop() }
        .disabled(!service.canStop)
    }
  }

  private var runtimeSummary: some View {
    GroupBox("Runtime") {
      VStack(alignment: .leading, spacing: 14) {
        HStack {
          Label(service.runtimeDescription, systemImage: "shippingbox")
            .font(.callout)
            .lineLimit(1)
            .truncationMode(.middle)
          Spacer()
          if service.state == .running {
            Button("Open status UI", systemImage: "safari") { service.openStatusUI() }
          }
        }
        Divider()
        HStack(spacing: 0) {
          MetricView(title: "Apps", value: service.metrics.apps)
          MetricView(title: "Browser", value: service.metrics.browserSessions)
          MetricView(title: "Subscriptions", value: service.metrics.mcpSubscriptions)
          MetricView(title: "Tools", value: service.metrics.tools)
          MetricView(title: "Resources", value: service.metrics.resources)
          MetricView(title: "Prompts", value: service.metrics.prompts)
        }
      }
      .padding(8)
    }
  }

  @ViewBuilder
  private var endpointsSection: some View {
    GroupBox("Endpoints and startup credentials") {
      if let endpoints = service.endpoints {
        VStack(spacing: 0) {
          ValueRow(label: "MCP", value: endpoints.mcpEndpoint) {
            service.copyToPasteboard(endpoints.mcpEndpoint)
          }
          Divider()
          ValueRow(label: "Browser", value: endpoints.browserEndpoint) {
            service.copyToPasteboard(endpoints.browserEndpoint)
          }
          Divider()
          ValueRow(label: "Status", value: endpoints.statusEndpoint) {
            service.copyToPasteboard(endpoints.statusEndpoint)
          }
          Divider()
          SecretRow(
            label: "MCP bearer",
            value: endpoints.mcpToken,
            revealed: $revealMCPToken,
            copy: { service.copyCredentialToPasteboard(endpoints.mcpToken) }
          )
          Divider()
          SecretRow(
            label: "Admin bearer",
            value: endpoints.adminToken,
            revealed: $revealAdminToken,
            copy: { service.copyCredentialToPasteboard(endpoints.adminToken) }
          )
        }
        .padding(6)
      } else {
        ContentUnavailableView(
          "Bridge is not running",
          systemImage: "network.slash",
          description: Text("Start the Bridge to obtain loopback endpoints and fresh credentials.")
        )
        .frame(maxWidth: .infinity, minHeight: 130)
      }
    }
  }

  @ViewBuilder
  private var pairingSection: some View {
    GroupBox("Pending Origin approvals") {
      VStack(alignment: .leading, spacing: 12) {
        Text(
          "Approve only an exact Origin you recognize. App and runtime labels are self-declared metadata. No credential is returned to the web page."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
        if let approvalError {
          Label(approvalError, systemImage: "exclamationmark.circle")
            .font(.caption)
            .foregroundStyle(.red)
        }
        if service.metrics.pairingRequests.isEmpty {
          Text("No pending approval requests. Request access from the BrowserMCP web page.")
            .font(.caption)
            .foregroundStyle(.secondary)
        } else {
          ForEach(service.metrics.pairingRequests) { request in
            ApprovalRow(
              request: request,
              busy: decidingApprovalId == request.id,
              approve: { decidePairingRequest(request, decision: .approve) },
              reject: { decidePairingRequest(request, decision: .reject) }
            )
          }
        }

        DisclosureGroup("Legacy one-time token compatibility") {
          VStack(alignment: .leading, spacing: 12) {
            Text("Use only for clients that cannot wait for operator approval.")
              .font(.caption)
              .foregroundStyle(.secondary)
            HStack {
              TextField("Exact Origin, for example https://example.github.io", text: $pairingOrigin)
                .textFieldStyle(.roundedBorder)
              Button("Issue token") { issuePairingToken() }
                .disabled(
                  service.state != .running || pairingOrigin.isEmpty || issuingPairingToken
                )
            }
            if let pairingError {
              Label(pairingError, systemImage: "exclamationmark.circle")
                .font(.caption)
                .foregroundStyle(.red)
            }
            if let pairings = service.endpoints?.pairingCredentials, !pairings.isEmpty {
              ForEach(pairings) { pairing in
                PairingRow(pairing: pairing) {
                  service.copyCredentialToPasteboard(pairing.token)
                }
              }
            } else {
              Text("Legacy tokens are short-lived, shown only here, and never saved.")
                .font(.caption)
                .foregroundStyle(.secondary)
            }
          }
          .padding(.top, 8)
        }
      }
      .padding(8)
    }
  }

  private var configurationSection: some View {
    GroupBox("Launch configuration") {
      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
        GridRow {
          Text("Port")
          TextField("8789", text: $settings.port)
            .frame(width: 100)
          Toggle("Start Bridge when app launches", isOn: $settings.startWhenAppLaunches)
            .gridCellColumns(2)
        }
        GridRow {
          Text("Allowed Origins")
          TextEditor(text: $settings.allowedOrigins)
            .font(.system(.body, design: .monospaced))
            .frame(height: 52)
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(.separator))
            .gridCellColumns(3)
        }
        GridRow {
          Text("Legacy token on start")
          TextEditor(text: $settings.pairingOrigins)
            .font(.system(.body, design: .monospaced))
            .frame(height: 52)
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(.separator))
            .gridCellColumns(3)
        }
        pathRow("Node executable", value: settings.nodePath, action: chooseNode) {
          settings.nodePath = ""
        }
        pathRow("Bridge CLI override", value: settings.bridgeScriptPath, action: chooseBridgeScript)
        {
          settings.bridgeScriptPath = ""
        }
        pathRow("TLS certificate", value: settings.tlsCertificatePath, action: chooseCertificate) {
          settings.tlsCertificatePath = ""
        }
        pathRow("TLS private key", value: settings.tlsKeyPath, action: choosePrivateKey) {
          settings.tlsKeyPath = ""
        }
      }
      .padding(8)
      .disabled(!service.canStart)
    }
  }

  private var diagnosticsSection: some View {
    GroupBox("Bridge diagnostics") {
      VStack(alignment: .leading, spacing: 8) {
        if service.metrics.recentErrors.isEmpty && service.diagnosticLines.isEmpty {
          Text("No diagnostics yet.")
            .foregroundStyle(.secondary)
        } else {
          ForEach(Array(service.metrics.recentErrors.enumerated()), id: \.offset) { _, error in
            Label(error, systemImage: "exclamationmark.circle")
              .foregroundStyle(.orange)
          }
          ScrollView {
            Text(service.diagnosticLines.suffix(80).joined(separator: "\n"))
              .font(.system(size: 11, design: .monospaced))
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .frame(height: 120)
        }
      }
      .padding(8)
    }
  }

  private func pathRow(
    _ label: String,
    value: String,
    action: @escaping () -> Void,
    clear: @escaping () -> Void
  ) -> some View {
    GridRow {
      Text(label)
      Text(value.isEmpty ? "Automatic" : value)
        .foregroundStyle(value.isEmpty ? .secondary : .primary)
        .lineLimit(1)
        .truncationMode(.middle)
        .textSelection(.enabled)
        .gridCellColumns(2)
      HStack {
        if !value.isEmpty {
          Button("Clear", action: clear)
        }
        Button("Choose…", action: action)
      }
    }
  }

  private func issuePairingToken() {
    issuingPairingToken = true
    pairingError = nil
    Task {
      do {
        try await service.issuePairingToken(origin: pairingOrigin)
        pairingOrigin = ""
      } catch {
        pairingError = error.localizedDescription
      }
      issuingPairingToken = false
    }
  }

  private func decidePairingRequest(
    _ request: PairingApprovalRequest,
    decision: PairingDecision
  ) {
    decidingApprovalId = request.id
    approvalError = nil
    Task {
      do {
        try await service.decidePairingRequest(requestId: request.id, decision: decision)
      } catch {
        approvalError = error.localizedDescription
      }
      decidingApprovalId = nil
    }
  }

  private func chooseNode() {
    chooseFile(prompt: "Choose Node") { settings.nodePath = $0 }
  }

  private func chooseBridgeScript() {
    chooseFile(prompt: "Choose Bridge CLI") { settings.bridgeScriptPath = $0 }
  }

  private func chooseCertificate() {
    chooseFile(prompt: "Choose Certificate") { settings.tlsCertificatePath = $0 }
  }

  private func choosePrivateKey() {
    chooseFile(prompt: "Choose Private Key") { settings.tlsKeyPath = $0 }
  }

  private func chooseFile(prompt: String, assign: (String) -> Void) {
    let panel = NSOpenPanel()
    panel.prompt = prompt
    panel.canChooseFiles = true
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    if panel.runModal() == .OK, let url = panel.url {
      assign(url.path)
    }
  }
}

private struct MetricView: View {
  let title: String
  let value: Int

  var body: some View {
    VStack(spacing: 2) {
      Text(value, format: .number).font(.title3.monospacedDigit().weight(.semibold))
      Text(title).font(.caption).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
  }
}

private struct ValueRow: View {
  let label: String
  let value: String
  let copy: () -> Void

  var body: some View {
    HStack {
      Text(label).frame(width: 90, alignment: .leading)
      Text(value)
        .font(.system(.body, design: .monospaced))
        .textSelection(.enabled)
      Spacer()
      Button("Copy", systemImage: "doc.on.doc", action: copy).labelStyle(.iconOnly)
    }
    .padding(.vertical, 7)
  }
}

private struct SecretRow: View {
  let label: String
  let value: String
  @Binding var revealed: Bool
  let copy: () -> Void

  var body: some View {
    HStack {
      Text(label).frame(width: 90, alignment: .leading)
      Group {
        if revealed {
          Text(value).textSelection(.enabled)
        } else {
          Text(String(repeating: "•", count: 28))
        }
      }
      .font(.system(.body, design: .monospaced))
      .lineLimit(1)
      Spacer()
      Button(revealed ? "Hide" : "Reveal", systemImage: revealed ? "eye.slash" : "eye") {
        revealed.toggle()
      }
      .labelStyle(.iconOnly)
      Button("Copy", systemImage: "doc.on.doc", action: copy).labelStyle(.iconOnly)
    }
    .padding(.vertical, 7)
  }
}

private struct PairingRow: View {
  let pairing: PairingCredential
  let copy: () -> Void
  @State private var revealed = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(pairing.origin).font(.callout.weight(.medium))
        Spacer()
        Text("expires \(pairing.expiresAt, style: .relative)")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      HStack {
        Group {
          if revealed {
            Text(pairing.token).textSelection(.enabled)
          } else {
            Text(String(repeating: "•", count: 28))
          }
        }
        .font(.system(.caption, design: .monospaced))
        .lineLimit(1)
        Spacer()
        Button(revealed ? "Hide" : "Reveal") { revealed.toggle() }
        Button("Copy", action: copy)
      }
    }
    .padding(10)
    .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
  }
}

private struct ApprovalRow: View {
  let request: PairingApprovalRequest
  let busy: Bool
  let approve: () -> Void
  let reject: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack {
        Text(request.origin)
          .font(.system(.callout, design: .monospaced).weight(.semibold))
          .textSelection(.enabled)
        Spacer()
        Text("expires \(request.expiresAt, style: .relative)")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Text("\(request.appName) · \(request.appId) · \(request.appVersion)")
        .font(.callout)
      Text("runtime \(request.runtimeId) / instance \(request.instanceId)")
        .font(.system(.caption, design: .monospaced))
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
      HStack {
        Spacer()
        Button("Reject", role: .destructive, action: reject).disabled(busy)
        Button("Approve", action: approve)
          .buttonStyle(.borderedProminent)
          .disabled(busy)
      }
    }
    .padding(10)
    .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
  }
}

extension BridgeRunState {
  var symbolName: String {
    switch self {
    case .stopped: "stop.circle"
    case .starting, .stopping: "arrow.trianglehead.2.clockwise.rotate.90"
    case .running: "checkmark.circle.fill"
    case .failed: "exclamationmark.triangle.fill"
    }
  }

  var tint: Color {
    switch self {
    case .stopped: .secondary
    case .starting, .stopping: .orange
    case .running: .green
    case .failed: .red
    }
  }
}
