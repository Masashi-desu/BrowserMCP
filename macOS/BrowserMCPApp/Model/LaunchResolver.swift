import Darwin
import Foundation

struct SemanticVersion: Comparable, Equatable, Sendable {
  let major: Int
  let minor: Int
  let patch: Int

  init?(_ output: String) {
    let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
    let value = trimmed.hasPrefix("v") ? String(trimmed.dropFirst()) : trimmed
    let parts = value.split(separator: ".", omittingEmptySubsequences: false)
    guard
      parts.count >= 3,
      let major = Int(parts[0]),
      let minor = Int(parts[1]),
      let patch = Int(parts[2].prefix { $0.isNumber })
    else { return nil }
    self.major = major
    self.minor = minor
    self.patch = patch
  }

  static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
    (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
  }

  var display: String { "v\(major).\(minor).\(patch)" }
}

struct NodeRuntime: Equatable, Sendable {
  let executableURL: URL
  let version: SemanticVersion
}

enum LaunchResolverError: LocalizedError {
  case bridgeNotFound
  case invalidBridgeScript(String)
  case nodeNotFound([String])

  var errorDescription: String? {
    switch self {
    case .bridgeNotFound:
      "The bundled Bridge is missing. Rebuild the app, or choose bridge/dist/cli.js."
    case .invalidBridgeScript(let path):
      "The selected Bridge CLI is not a readable .js, .mjs, or .cjs file: \(path)"
    case .nodeNotFound(let details):
      "Node.js 24 or later was not found. Choose a Node executable.\n\(details.joined(separator: "\n"))"
    }
  }
}

private struct NodeProbeTimeoutError: LocalizedError {
  let path: String

  var errorDescription: String? {
    "Timed out while checking \(path) with --version."
  }
}

enum NodeRuntimeResolver {
  static func resolve(
    preferredPath: String, environment: [String: String] = ProcessInfo.processInfo.environment
  ) async throws -> NodeRuntime {
    let candidates = candidateURLs(preferredPath: preferredPath, environment: environment)
    return try await Task.detached(priority: .userInitiated) {
      var diagnostics: [String] = []
      for url in candidates {
        guard FileManager.default.isExecutableFile(atPath: url.path) else { continue }
        do {
          let version = try version(at: url)
          guard version.major >= 24 else {
            diagnostics.append("\(url.path): \(version.display) is older than v24")
            continue
          }
          return NodeRuntime(executableURL: url, version: version)
        } catch {
          diagnostics.append("\(url.path): \(error.localizedDescription)")
        }
      }
      throw LaunchResolverError.nodeNotFound(diagnostics)
    }.value
  }

  static func candidateURLs(
    preferredPath: String,
    environment: [String: String],
    homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> [URL] {
    var paths: [String] = []
    if !preferredPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      paths.append(preferredPath)
    }
    paths += (environment["PATH"] ?? "")
      .split(separator: ":")
      .map { String($0) + "/node" }
    paths += [
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
      homeDirectory.appendingPathComponent(".volta/bin/node").path,
      homeDirectory.appendingPathComponent(".asdf/shims/node").path,
      homeDirectory.appendingPathComponent(".local/bin/node").path,
      homeDirectory.appendingPathComponent(".fnm/current/bin/node").path,
    ]
    paths += versionManagerCandidates(homeDirectory: homeDirectory)

    var seen = Set<String>()
    return paths.compactMap { path in
      let normalized = NSString(string: path).expandingTildeInPath
      guard seen.insert(normalized).inserted else { return nil }
      return URL(fileURLWithPath: normalized)
    }
  }

  static func version(at executableURL: URL, timeout: TimeInterval = 3) throws -> SemanticVersion {
    let process = Process()
    let output = Pipe()
    process.executableURL = executableURL
    process.arguments = ["--version"]
    process.standardOutput = output
    process.standardError = output
    try process.run()
    let deadline = Date().addingTimeInterval(timeout)
    while process.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.02)
    }
    if process.isRunning {
      process.terminate()
      let terminationDeadline = Date().addingTimeInterval(0.5)
      while process.isRunning && Date() < terminationDeadline {
        Thread.sleep(forTimeInterval: 0.02)
      }
      if process.isRunning {
        Darwin.kill(process.processIdentifier, SIGKILL)
      }
      process.waitUntilExit()
      throw NodeProbeTimeoutError(path: executableURL.path)
    }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    let text = String(decoding: data, as: UTF8.self)
    guard process.terminationStatus == 0, let version = SemanticVersion(text) else {
      throw CocoaError(.executableRuntimeMismatch)
    }
    return version
  }

  private static func versionManagerCandidates(homeDirectory: URL) -> [String] {
    let managerRoots = [
      homeDirectory.appendingPathComponent(".nvm/versions/node"),
      homeDirectory.appendingPathComponent(".nodenv/versions"),
    ]
    return managerRoots.flatMap { root -> [String] in
      guard
        let directories = try? FileManager.default.contentsOfDirectory(
          at: root,
          includingPropertiesForKeys: nil,
          options: [.skipsHiddenFiles]
        )
      else { return [] }
      return
        directories
        .sorted { ($0.lastPathComponent) > ($1.lastPathComponent) }
        .map { $0.appendingPathComponent("bin/node").path }
    }
  }
}

enum BridgeScriptResolver {
  static func resolve(
    preferredPath: String,
    bundle: Bundle = .main,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws -> URL {
    let trimmedPreferredPath = preferredPath.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedPreferredPath.isEmpty {
      let selected = URL(
        fileURLWithPath: NSString(string: trimmedPreferredPath).expandingTildeInPath
      ).standardizedFileURL
      guard isValidScript(selected) else {
        throw LaunchResolverError.invalidBridgeScript(selected.path)
      }
      return selected
    }

    var candidates: [URL] = []
    if let resource = bundle.url(forResource: "browsermcp-bridge", withExtension: "mjs") {
      candidates.append(resource)
    }

    let roots = [
      environment["BROWSERMCP_REPOSITORY_ROOT"],
      FileManager.default.currentDirectoryPath,
    ].compactMap { $0 }
    for root in roots {
      let rootURL = URL(fileURLWithPath: NSString(string: root).expandingTildeInPath)
      candidates.append(rootURL.appendingPathComponent("bridge/dist/cli.js"))
    }

    var seen = Set<String>()
    for candidate in candidates {
      let path = candidate.standardizedFileURL.path
      guard seen.insert(path).inserted else { continue }
      if isValidScript(candidate) {
        return URL(fileURLWithPath: path)
      }
    }
    throw LaunchResolverError.bridgeNotFound
  }

  private static func isValidScript(_ candidate: URL) -> Bool {
    guard ["js", "mjs", "cjs"].contains(candidate.pathExtension.lowercased()) else { return false }
    var isDirectory: ObjCBool = false
    return FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory)
      && !isDirectory.boolValue
      && FileManager.default.isReadableFile(atPath: candidate.path)
  }
}
