import XCTest

@testable import BrowserMCP

final class BrowserMCPAppTests: XCTestCase {
  func testSemanticVersionParsesNodeOutput() {
    XCTAssertEqual(SemanticVersion("v24.10.0\n"), SemanticVersion("24.10.0"))
    XCTAssertEqual(SemanticVersion("v24.10.0")?.major, 24)
    XCTAssertNil(SemanticVersion("not a version"))
    XCTAssertLessThan(SemanticVersion("v24.9.0")!, SemanticVersion("v24.10.0")!)
  }

  func testNodeCandidatesPreferExplicitSelectionAndDeduplicate() {
    let candidates = NodeRuntimeResolver.candidateURLs(
      preferredPath: "/custom/node",
      environment: ["PATH": "/custom:/usr/bin"],
      homeDirectory: URL(fileURLWithPath: "/Users/example")
    )
    XCTAssertEqual(candidates.first?.path, "/custom/node")
    XCTAssertEqual(candidates.filter { $0.path == "/custom/node" }.count, 1)
  }

  func testNodeVersionProbeTimesOutForHangingExecutable() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("BrowserMCPNodeProbe-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let executable = directory.appendingPathComponent("node")
    try "#!/bin/sh\nexec /bin/sleep 5\n".write(to: executable, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)

    let startedAt = Date()
    XCTAssertThrowsError(try NodeRuntimeResolver.version(at: executable, timeout: 0.1)) { error in
      XCTAssertTrue(error.localizedDescription.contains("Timed out"))
    }
    XCTAssertLessThan(Date().timeIntervalSince(startedAt), 2)
  }

  func testReadyPayloadParsesAndRequiresLoopbackEndpoints() throws {
    let line = try readyPayload()
    let payload = try XCTUnwrap(BridgeReadyPayloadParser.parse(line))
    XCTAssertEqual(payload.mcpEndpoint, "http://127.0.0.1:8789/mcp")
    XCTAssertEqual(payload.pairingCredentials.first?.origin, "https://example.github.io")
    XCTAssertEqual(payload.pairingCredentials.count, 1)

    let remote = line.replacingOccurrences(of: "127.0.0.1", with: "192.168.1.4")
    XCTAssertNil(BridgeReadyPayloadParser.parse(remote))
  }

  func testReadyPayloadRejectsContractDriftAndMalformedCredentials() throws {
    let valid = try readyPayload()
    XCTAssertNil(
      BridgeReadyPayloadParser.parse(
        try readyPayload(browserScheme: "wss")
      )
    )
    XCTAssertNil(
      BridgeReadyPayloadParser.parse(
        valid.replacingOccurrences(
          of: "bmp_mcp_\(String(repeating: "m", count: 43))", with: "short")
      )
    )
    XCTAssertNil(
      BridgeReadyPayloadParser.parse(
        #"{"event":"ready","address":{"mcpEndpoint":"http://127.0.0.1:8789/mcp"}}"#
      )
    )
  }

  func testMetricsParsesCountsAndBoundedErrors() throws {
    let data = try JSONSerialization.data(withJSONObject: [
      "apps": [["id": "docs"]],
      "capabilities": ["tools": ["one", "two"], "resources": ["r"], "prompts": []],
      "sessions": ["browser": 1],
      "mcp": [
        "protocolVersion": "2026-07-28",
        "stateless": true,
        "subscriptions": 2,
      ],
      "pairingRequests": [
        [
          "requestId": "approval-123",
          "origin": "https://example.github.io",
          "requestedAt": 1_800_000_000_000,
          "expiresAt": 1_800_000_120_000,
          "app": ["id": "docs", "name": "Docs", "version": "1.0.0"],
          "runtime": ["id": "runtime-1", "instanceId": "instance-1"],
        ]
      ],
      "recentRequests": [
        ["outcome": "error", "error": ["code": "FAILED", "message": "safe"]],
        ["outcome": "success"],
      ],
    ])
    let metrics = try XCTUnwrap(BridgeMetrics.parse(data))
    XCTAssertEqual(metrics.apps, 1)
    XCTAssertEqual(metrics.browserSessions, 1)
    XCTAssertEqual(metrics.mcpSubscriptions, 2)
    XCTAssertEqual(metrics.tools, 2)
    XCTAssertEqual(metrics.resources, 1)
    XCTAssertEqual(metrics.pairingRequests.count, 1)
    XCTAssertEqual(metrics.pairingRequests.first?.origin, "https://example.github.io")
    XCTAssertEqual(metrics.pairingRequests.first?.appName, "Docs")
    XCTAssertEqual(metrics.recentErrors, ["FAILED: safe"])
  }

  func testMetricsRejectsMalformedApprovalRequests() throws {
    let data = try JSONSerialization.data(withJSONObject: [
      "apps": [],
      "capabilities": ["tools": [], "resources": [], "prompts": []],
      "sessions": ["browser": 0],
      "mcp": ["protocolVersion": "2026-07-28", "stateless": true, "subscriptions": 0],
      "pairingRequests": [
        [
          "requestId": "../unsafe",
          "origin": "https://example.github.io",
          "requestedAt": 1_800_000_000_000,
          "expiresAt": 1_800_000_120_000,
          "app": ["id": "docs", "name": "Docs", "version": "1.0.0"],
          "runtime": ["id": "runtime-1", "instanceId": "instance-1"],
        ]
      ],
    ])
    XCTAssertNil(BridgeMetrics.parse(data))
  }

  @MainActor
  func testSettingsPersistOnlyNonSecretLaunchConfiguration() throws {
    let suite = "BrowserMCPAppTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let settings = BridgeSettings(defaults: defaults)
    settings.port = "9000"
    settings.nodePath = "/custom/node"
    settings.allowedOrigins = "https://example.com"
    XCTAssertEqual(BridgeSettings(defaults: defaults).port, "9000")
    XCTAssertEqual(BridgeSettings(defaults: defaults).nodePath, "/custom/node")
    XCTAssertFalse(
      defaults.dictionaryRepresentation().keys.contains { $0.lowercased().contains("token") })
  }

  @MainActor
  func testStartupDeadlineFailsAndStopsSilentChild() async throws {
    let fixture = try await makeServiceFixture(
      script: "setInterval(() => {}, 1_000);\n",
      startupTimeout: .milliseconds(120)
    )
    defer { fixture.cleanup() }
    fixture.service.start()

    let failed = await waitUntil(timeout: .seconds(3)) {
      if case .failed = fixture.service.state { return true }
      return false
    }
    XCTAssertTrue(failed)
    XCTAssertFalse(fixture.service.hasPendingStartupDeadline)
    fixture.service.shutdownSynchronously()
  }

  @MainActor
  func testReadyPayloadCancelsStartupDeadline() async throws {
    let payload = try readyPayload(port: 61_234, pairings: [])
    let encodedPayload = Data(payload.utf8).base64EncodedString()
    let fixture = try await makeServiceFixture(
      script:
        "process.stdout.write(Buffer.from('\(encodedPayload)', 'base64').toString() + '\\n'); setInterval(() => {}, 1_000);\n",
      startupTimeout: .seconds(1)
    )
    defer { fixture.cleanup() }
    fixture.service.start()

    let running = await waitUntil(timeout: .seconds(3)) { fixture.service.state == .running }
    XCTAssertTrue(
      running,
      "state=\(fixture.service.state), diagnostics=\(fixture.service.diagnosticLines)"
    )
    XCTAssertFalse(fixture.service.hasPendingStartupDeadline)
    XCTAssertFalse(fixture.service.diagnosticLines.contains { $0.contains("bmp_mcp_") })
    fixture.service.stop()
    XCTAssertFalse(fixture.service.hasPendingStartupDeadline)
    fixture.service.shutdownSynchronously()
  }

  @MainActor
  private func makeServiceFixture(
    script: String,
    startupTimeout: Duration
  ) async throws -> (service: BridgeService, cleanup: @MainActor () -> Void) {
    let node = try await NodeRuntimeResolver.resolve(preferredPath: "")
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("BrowserMCPAppTests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let scriptURL = directory.appendingPathComponent("fixture.mjs")
    try script.write(to: scriptURL, atomically: true, encoding: .utf8)
    let suite = "BrowserMCPAppTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    let settings = BridgeSettings(defaults: defaults)
    settings.nodePath = node.executableURL.path
    settings.bridgeScriptPath = scriptURL.path
    settings.startWhenAppLaunches = false
    let service = BridgeService(settings: settings, startupTimeout: startupTimeout)
    return (
      service,
      {
        service.shutdownSynchronously()
        defaults.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: directory)
      }
    )
  }

  private func readyPayload(
    port: Int = 8_789,
    browserScheme: String = "ws",
    pairings: [[String: Any]]? = nil
  ) throws -> String {
    let payload: [String: Any] = [
      "type": "ready",
      "mcpEndpoint": "http://127.0.0.1:\(port)/mcp",
      "mcpToken": "bmp_mcp_\(String(repeating: "m", count: 43))",
      "browserEndpoint": "\(browserScheme)://127.0.0.1:\(port)/browser",
      "statusEndpoint": "http://127.0.0.1:\(port)/",
      "adminToken": "bmp_admin_\(String(repeating: "a", count: 43))",
      "pairingTokens": pairings ?? [
        [
          "origin": "https://example.github.io",
          "token": "bmp_pair_\(String(repeating: "p", count: 43))",
          "expiresAt": 1_800_000_000_000,
        ]
      ],
    ]
    let data = try JSONSerialization.data(withJSONObject: payload)
    return try XCTUnwrap(String(data: data, encoding: .utf8))
  }

  @MainActor
  private func waitUntil(
    timeout: Duration,
    condition: @MainActor () -> Bool
  ) async -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      if condition() { return true }
      try? await Task.sleep(for: .milliseconds(25))
    }
    return condition()
  }
}
