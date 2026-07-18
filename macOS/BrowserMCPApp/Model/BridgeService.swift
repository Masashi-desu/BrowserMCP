import AppKit
import Combine
import Darwin
import Foundation

@MainActor
final class BridgeService: ObservableObject {
  @Published private(set) var state: BridgeRunState = .stopped
  @Published private(set) var endpoints: BridgeEndpointSnapshot?
  @Published private(set) var metrics = BridgeMetrics()
  @Published private(set) var diagnosticLines: [String] = []
  @Published private(set) var runtimeDescription = "Node.js 24+ is required"
  @Published private(set) var lastStateRefresh: Date?

  let settings: BridgeSettings

  private var process: Process?
  private var stdoutRemainder = ""
  private var stderrRemainder = ""
  private var generation = 0
  private var restartAfterStop = false
  private var pollingTask: Task<Void, Never>?
  private var startupDeadlineTask: Task<Void, Never>?
  private var credentialClipboardTask: Task<Void, Never>?
  private var copiedCredential: String?
  private let startupTimeout: Duration
  private let urlSession: URLSession

  init(settings: BridgeSettings, startupTimeout: Duration = .seconds(10)) {
    self.settings = settings
    self.startupTimeout = startupTimeout
    let configuration = URLSessionConfiguration.ephemeral
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    configuration.timeoutIntervalForRequest = 3
    configuration.timeoutIntervalForResource = 5
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    urlSession = URLSession(configuration: configuration)
  }

  var canStart: Bool { process == nil && (state == .stopped || isFailed) }
  var canStop: Bool { state == .starting || state == .running }
  var hasPendingStartupDeadline: Bool { startupDeadlineTask != nil }

  func start() {
    guard canStart else { return }
    guard let port = settings.normalizedPort else {
      fail("Port must be an integer from 1 to 65535.")
      return
    }
    let certificate = settings.tlsCertificatePath.trimmingCharacters(in: .whitespacesAndNewlines)
    let key = settings.tlsKeyPath.trimmingCharacters(in: .whitespacesAndNewlines)
    guard certificate.isEmpty == key.isEmpty else {
      fail("TLS certificate and key must be selected together.")
      return
    }

    state = .starting
    endpoints = nil
    metrics = BridgeMetrics()
    lastStateRefresh = nil
    stdoutRemainder = ""
    stderrRemainder = ""
    generation += 1
    let launchGeneration = generation
    let preferredNode = settings.nodePath

    Task { [weak self] in
      guard let self else { return }
      do {
        async let runtime = NodeRuntimeResolver.resolve(preferredPath: preferredNode)
        let script = try BridgeScriptResolver.resolve(
          preferredPath: self.settings.bridgeScriptPath
        )
        let resolvedRuntime = try await runtime
        guard self.generation == launchGeneration, self.state == .starting else { return }
        self.launch(
          runtime: resolvedRuntime,
          script: script,
          port: port,
          generation: launchGeneration
        )
      } catch {
        guard self.generation == launchGeneration else { return }
        self.fail(error.localizedDescription)
      }
    }
  }

  func stop() {
    restartAfterStop = false
    stopPreservingRestartIntent()
  }

  func restart() {
    if process == nil {
      start()
      return
    }
    restartAfterStop = true
    stopPreservingRestartIntent()
  }

  func openStatusUI() {
    guard let raw = endpoints?.statusEndpoint, let url = URL(string: raw) else { return }
    NSWorkspace.shared.open(url)
  }

  func copyToPasteboard(_ value: String) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(value, forType: .string)
  }

  func copyCredentialToPasteboard(_ value: String) {
    credentialClipboardTask?.cancel()
    copyToPasteboard(value)
    copiedCredential = value
    credentialClipboardTask = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(60))
      guard !Task.isCancelled, let self else { return }
      let pasteboard = NSPasteboard.general
      if pasteboard.string(forType: .string) == value {
        pasteboard.clearContents()
      }
      self.copiedCredential = nil
      self.credentialClipboardTask = nil
    }
  }

  func issuePairingToken(origin: String) async throws {
    guard let endpoints else { throw ServiceError.notRunning }
    let requestGeneration = generation
    let requestAdminToken = endpoints.adminToken
    let trimmed = origin.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
      let originURL = URL(string: trimmed),
      let scheme = originURL.scheme?.lowercased(),
      originURL.host != nil,
      originURL.user == nil,
      originURL.password == nil,
      scheme == "https" || (scheme == "http" && Self.isLoopbackHost(originURL.host)),
      originURL.path.isEmpty || originURL.path == "/",
      originURL.query == nil,
      originURL.fragment == nil
    else { throw ServiceError.invalidOrigin }

    guard
      let url = URL(string: "api/pairing-tokens", relativeTo: URL(string: endpoints.statusEndpoint))
    else {
      throw ServiceError.invalidEndpoint
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(endpoints.adminToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["origin": trimmed])

    let (data, response) = try await urlSession.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 201 else {
      throw ServiceError.requestFailed(Self.apiError(from: data))
    }
    guard
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let token = object["token"] as? String,
      let responseOrigin = object["origin"] as? String,
      let milliseconds = object["expiresAt"] as? NSNumber
    else { throw ServiceError.invalidResponse }

    let credential = PairingCredential(
      origin: responseOrigin,
      token: token,
      expiresAt: Date(timeIntervalSince1970: milliseconds.doubleValue / 1_000)
    )
    guard
      generation == requestGeneration,
      state == .running,
      let currentEndpoints = self.endpoints,
      currentEndpoints.adminToken == requestAdminToken
    else { throw ServiceError.staleRequest }

    var pairings = currentEndpoints.pairingCredentials.filter { $0.origin != credential.origin }
    pairings.append(credential)
    self.endpoints = BridgeEndpointSnapshot(
      mcpEndpoint: currentEndpoints.mcpEndpoint,
      mcpToken: currentEndpoints.mcpToken,
      browserEndpoint: currentEndpoints.browserEndpoint,
      statusEndpoint: currentEndpoints.statusEndpoint,
      adminToken: currentEndpoints.adminToken,
      pairingCredentials: pairings
    )
  }

  func decidePairingRequest(requestId: String, decision: PairingDecision) async throws {
    guard let endpoints else { throw ServiceError.notRunning }
    guard
      requestId.range(of: #"^[A-Za-z0-9-]{1,128}$"#, options: .regularExpression) != nil
    else { throw ServiceError.invalidRequestId }
    guard
      let url = URL(
        string: "api/pairing-requests/\(requestId)",
        relativeTo: URL(string: endpoints.statusEndpoint)
      )
    else { throw ServiceError.invalidEndpoint }

    let requestGeneration = generation
    let requestAdminToken = endpoints.adminToken
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(requestAdminToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["decision": decision.rawValue])

    let (data, response) = try await urlSession.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 204 else {
      throw ServiceError.requestFailed(Self.apiError(from: data))
    }
    guard
      generation == requestGeneration,
      state == .running,
      self.endpoints?.adminToken == requestAdminToken
    else { throw ServiceError.staleRequest }
    await refreshState()
  }

  func shutdownSynchronously() {
    pollingTask?.cancel()
    pollingTask = nil
    startupDeadlineTask?.cancel()
    startupDeadlineTask = nil
    restartAfterStop = false
    guard let process, process.isRunning else {
      generation += 1
      clearRuntimeState()
      state = .stopped
      return
    }
    Darwin.kill(process.processIdentifier, SIGTERM)
    let deadline = Date().addingTimeInterval(3)
    while process.isRunning && Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    if process.isRunning {
      Darwin.kill(process.processIdentifier, SIGKILL)
      process.waitUntilExit()
    }
    clearRuntimeState()
  }

  private var isFailed: Bool {
    if case .failed = state { return true }
    return false
  }

  private func launch(runtime: NodeRuntime, script: URL, port: Int, generation: Int) {
    let child = Process()
    let stdout = Pipe()
    let stderr = Pipe()
    child.executableURL = runtime.executableURL
    child.arguments = launchArguments(script: script, port: port)
    child.currentDirectoryURL = script.deletingLastPathComponent()
    var environment = ProcessInfo.processInfo.environment
    let nodeDirectory = runtime.executableURL.deletingLastPathComponent().path
    environment["PATH"] = "\(nodeDirectory):\(environment["PATH"] ?? "/usr/bin:/bin")"
    child.environment = environment
    child.standardOutput = stdout
    child.standardError = stderr

    stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty else { return }
      let chunk = String(decoding: data, as: UTF8.self)
      Task { @MainActor [weak self] in
        self?.consumeStdout(chunk, generation: generation)
      }
    }
    stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty else { return }
      let chunk = String(decoding: data, as: UTF8.self)
      Task { @MainActor [weak self] in
        self?.consumeStderr(chunk, generation: generation)
      }
    }
    child.terminationHandler = { [weak self] terminated in
      let status = terminated.terminationStatus
      Task { @MainActor [weak self] in
        self?.processTerminated(status: status, generation: generation)
      }
    }

    do {
      try child.run()
      process = child
      runtimeDescription = "\(runtime.version.display) · \(runtime.executableURL.path)"
      appendDiagnostic("Launching Bridge with \(runtime.version.display).")
      beginStartupDeadline(generation: generation)
    } catch {
      stdout.fileHandleForReading.readabilityHandler = nil
      stderr.fileHandleForReading.readabilityHandler = nil
      fail("Could not launch Bridge: \(error.localizedDescription)")
    }
  }

  private func launchArguments(script: URL, port: Int) -> [String] {
    var arguments = [script.path, "--json", "--port", String(port)]
    for origin in settings.normalizedAllowedOrigins {
      arguments += ["--allow-origin", origin]
    }
    for origin in settings.normalizedPairingOrigins {
      arguments += ["--pair-origin", origin]
    }
    let certificate = settings.tlsCertificatePath.trimmingCharacters(in: .whitespacesAndNewlines)
    let key = settings.tlsKeyPath.trimmingCharacters(in: .whitespacesAndNewlines)
    if !certificate.isEmpty, !key.isEmpty {
      arguments += ["--tls-cert", certificate, "--tls-key", key]
    }
    return arguments
  }

  private func stopPreservingRestartIntent() {
    pollingTask?.cancel()
    pollingTask = nil
    startupDeadlineTask?.cancel()
    startupDeadlineTask = nil
    guard let process, process.isRunning else {
      generation += 1
      clearRuntimeState()
      let shouldRestart = restartAfterStop
      restartAfterStop = false
      state = .stopped
      if shouldRestart { start() }
      return
    }
    state = .stopping
    clearSensitiveRuntimeState()
    Darwin.kill(process.processIdentifier, SIGTERM)
    let stoppedGeneration = generation
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(4))
      guard
        let self,
        self.generation == stoppedGeneration,
        let process = self.process,
        process.isRunning
      else { return }
      self.appendDiagnostic("Bridge did not stop within 4 seconds; terminating it.")
      Darwin.kill(process.processIdentifier, SIGKILL)
    }
  }

  private func consumeStdout(_ chunk: String, generation: Int) {
    guard self.generation == generation else { return }
    stdoutRemainder += chunk
    for line in extractCompleteLines(from: &stdoutRemainder) {
      if let ready = BridgeReadyPayloadParser.parse(line) {
        handleReady(ready)
      }
      // stdout can contain one-time credentials. It is parsed and immediately discarded,
      // never copied into the diagnostic buffer.
    }
  }

  private func consumeStderr(_ chunk: String, generation: Int) {
    guard self.generation == generation else { return }
    stderrRemainder += chunk
    for line in extractCompleteLines(from: &stderrRemainder) where !line.isEmpty {
      appendDiagnostic(line)
    }
  }

  private func handleReady(_ ready: BridgeEndpointSnapshot) {
    startupDeadlineTask?.cancel()
    startupDeadlineTask = nil
    endpoints = ready
    state = .running
    appendDiagnostic("Bridge is ready on IPv4 loopback.")
    beginPolling()
  }

  private func processTerminated(status: Int32, generation: Int) {
    guard self.generation == generation else { return }
    pollingTask?.cancel()
    pollingTask = nil
    startupDeadlineTask?.cancel()
    startupDeadlineTask = nil
    if !stderrRemainder.isEmpty {
      appendDiagnostic(stderrRemainder)
    }
    let wasStopping = state == .stopping
    let existingFailure: String? = if case .failed(let message) = state { message } else { nil }
    let shouldRestart = restartAfterStop
    restartAfterStop = false
    clearRuntimeState()
    if shouldRestart {
      start()
    } else if let existingFailure {
      state = .failed(existingFailure)
    } else if wasStopping || status == 0 {
      state = .stopped
    } else {
      state = .failed("Bridge exited with status \(status).")
    }
  }

  private func beginPolling() {
    pollingTask?.cancel()
    pollingTask = Task { [weak self] in
      while !Task.isCancelled {
        await self?.refreshState()
        try? await Task.sleep(for: .seconds(2))
      }
    }
  }

  private func beginStartupDeadline(generation: Int) {
    startupDeadlineTask?.cancel()
    startupDeadlineTask = Task { [weak self, startupTimeout] in
      try? await Task.sleep(for: startupTimeout)
      guard
        !Task.isCancelled,
        let self,
        self.generation == generation,
        self.state == .starting,
        let process = self.process,
        process.isRunning
      else { return }
      self.fail("Bridge did not report ready state before the startup deadline.")
      Darwin.kill(process.processIdentifier, SIGTERM)
      Task { [weak self] in
        try? await Task.sleep(for: .seconds(2))
        guard
          let self,
          self.generation == generation,
          let process = self.process,
          process.isRunning
        else { return }
        Darwin.kill(process.processIdentifier, SIGKILL)
      }
    }
  }

  private func refreshState() async {
    guard let endpoints,
      let url = URL(string: "api/state", relativeTo: URL(string: endpoints.statusEndpoint))
    else {
      return
    }
    var request = URLRequest(url: url)
    request.setValue("Bearer \(endpoints.adminToken)", forHTTPHeaderField: "Authorization")
    do {
      let (data, response) = try await urlSession.data(for: request)
      guard (response as? HTTPURLResponse)?.statusCode == 200,
        let latest = BridgeMetrics.parse(data)
      else { return }
      metrics = latest
      lastStateRefresh = Date()
    } catch {
      // A transient polling failure does not change process state. The next poll retries.
    }
  }

  private func clearRuntimeState() {
    startupDeadlineTask?.cancel()
    startupDeadlineTask = nil
    process = nil
    clearSensitiveRuntimeState()
    stdoutRemainder = ""
    stderrRemainder = ""
    runtimeDescription = "Node.js 24+ is required"
  }

  private func fail(_ message: String) {
    startupDeadlineTask?.cancel()
    startupDeadlineTask = nil
    state = .failed(message)
    appendDiagnostic(message)
  }

  private func appendDiagnostic(_ line: String) {
    let redacted = line.replacingOccurrences(
      of: #"bmp_(?:admin|mcp|pair|resume|ui)_[A-Za-z0-9_-]+"#,
      with: "[REDACTED]",
      options: .regularExpression
    )
    let bounded = String(redacted.prefix(2_000))
    guard !Self.containsCredentialMarker(bounded) else { return }
    diagnosticLines.append(bounded)
    if diagnosticLines.count > 200 {
      diagnosticLines.removeFirst(diagnosticLines.count - 200)
    }
  }

  private func clearSensitiveRuntimeState() {
    endpoints = nil
    metrics = BridgeMetrics()
    lastStateRefresh = nil
    credentialClipboardTask?.cancel()
    credentialClipboardTask = nil
    if let copiedCredential {
      let pasteboard = NSPasteboard.general
      if pasteboard.string(forType: .string) == copiedCredential {
        pasteboard.clearContents()
      }
    }
    copiedCredential = nil
  }

  private func extractCompleteLines(from remainder: inout String) -> [String] {
    let parts = remainder.split(separator: "\n", omittingEmptySubsequences: false)
    guard parts.count > 1 else { return [] }
    remainder = String(parts.last ?? "")
    return parts.dropLast().map { String($0).trimmingCharacters(in: .newlines) }
  }

  private static func apiError(from data: Data) -> String {
    guard
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let error = object["error"] as? String
    else { return "Bridge request failed." }
    return String(error.prefix(300))
  }

  private static func isLoopbackHost(_ host: String?) -> Bool {
    host == "localhost" || host == "127.0.0.1"
  }

  private static func containsCredentialMarker(_ line: String) -> Bool {
    line.contains("MCP bearer token (shown once):")
      || line.contains("Admin token (shown once):")
      || line.contains("Pairing token for ")
      || line.contains("\"mcpToken\"")
      || line.contains("\"adminToken\"")
      || line.contains("\"pairingTokens\"")
  }
}

private enum ServiceError: LocalizedError {
  case invalidEndpoint
  case invalidOrigin
  case invalidRequestId
  case invalidResponse
  case notRunning
  case requestFailed(String)
  case staleRequest

  var errorDescription: String? {
    switch self {
    case .invalidEndpoint: "The Bridge status endpoint is invalid."
    case .invalidOrigin: "Use an exact HTTPS Origin, or HTTP only for localhost development."
    case .invalidRequestId: "The pending approval request identifier is invalid."
    case .invalidResponse: "The Bridge returned an invalid response."
    case .notRunning: "Start the Bridge before changing browser access."
    case .requestFailed(let message): message
    case .staleRequest: "The Bridge changed while the request was in flight. Try again."
    }
  }
}

enum PairingDecision: String, Sendable {
  case approve
  case reject
}
