import Foundation

enum BridgeRunState: Equatable {
  case stopped
  case starting
  case running
  case stopping
  case failed(String)

  var title: String {
    switch self {
    case .stopped: "Stopped"
    case .starting: "Starting"
    case .running: "Running"
    case .stopping: "Stopping"
    case .failed: "Needs attention"
    }
  }

  var isBusy: Bool {
    self == .starting || self == .stopping
  }
}

struct PairingCredential: Equatable, Identifiable, Sendable {
  let origin: String
  let token: String
  let expiresAt: Date

  var id: String { "\(origin)|\(expiresAt.timeIntervalSince1970)" }
}

struct BridgeEndpointSnapshot: Equatable, Sendable {
  let mcpEndpoint: String
  let mcpToken: String
  let browserEndpoint: String
  let statusEndpoint: String
  let adminToken: String
  let pairingCredentials: [PairingCredential]
}

enum BridgeReadyPayloadParser {
  static func parse(_ line: String) -> BridgeEndpointSnapshot? {
    guard
      let data = line.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data),
      let root = object as? [String: Any]
    else { return nil }

    guard
      root["type"] as? String == "ready",
      let mcp = endpoint(root["mcpEndpoint"], schemes: ["http", "https"], path: "/mcp"),
      let browser = endpoint(root["browserEndpoint"], schemes: ["ws", "wss"], path: "/browser"),
      let status = endpoint(root["statusEndpoint"], schemes: ["http", "https"], path: "/"),
      mcp.components.scheme == status.components.scheme,
      browser.components.scheme == (mcp.components.scheme == "https" ? "wss" : "ws"),
      mcp.components.host == browser.components.host,
      mcp.components.host == status.components.host,
      mcp.components.port == browser.components.port,
      mcp.components.port == status.components.port,
      let mcpToken = token(root["mcpToken"], kind: "mcp"),
      let adminToken = token(root["adminToken"], kind: "admin"),
      let rawPairings = root["pairingTokens"] as? [[String: Any]]
    else { return nil }

    var pairings: [PairingCredential] = []
    var origins = Set<String>()
    for item in rawPairings {
      guard
        let origin = webOrigin(item["origin"]),
        origins.insert(origin).inserted,
        let pairingToken = token(item["token"], kind: "pair"),
        let expiresAt = milliseconds(item["expiresAt"])
      else { return nil }
      pairings.append(
        PairingCredential(
          origin: origin,
          token: pairingToken,
          expiresAt: Date(timeIntervalSince1970: expiresAt / 1_000)
        )
      )
    }

    return BridgeEndpointSnapshot(
      mcpEndpoint: mcp.raw,
      mcpToken: mcpToken,
      browserEndpoint: browser.raw,
      statusEndpoint: status.raw,
      adminToken: adminToken,
      pairingCredentials: pairings
    )
  }

  private static func endpoint(
    _ value: Any?, schemes: Set<String>, path: String
  ) -> (raw: String, components: URLComponents)? {
    guard
      let raw = nonempty(value),
      let components = URLComponents(string: raw),
      let scheme = components.scheme?.lowercased(),
      schemes.contains(scheme),
      components.host == "127.0.0.1" || components.host == "localhost",
      let port = components.port,
      (1...65_535).contains(port),
      components.user == nil,
      components.password == nil,
      components.percentEncodedPath == path,
      components.query == nil,
      components.fragment == nil
    else { return nil }
    return (raw, components)
  }

  private static func webOrigin(_ value: Any?) -> String? {
    guard
      let raw = nonempty(value),
      let components = URLComponents(string: raw),
      let scheme = components.scheme?.lowercased(),
      scheme == "https" || (scheme == "http" && isLoopback(components.host)),
      components.host != nil,
      components.user == nil,
      components.password == nil,
      components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/",
      components.query == nil,
      components.fragment == nil
    else { return nil }
    var normalized = components
    normalized.path = ""
    return normalized.string
  }

  private static func token(_ value: Any?, kind: String) -> String? {
    guard let candidate = nonempty(value) else { return nil }
    let pattern = "^bmp_\(kind)_[A-Za-z0-9_-]{43}$"
    return candidate.range(of: pattern, options: .regularExpression) == nil ? nil : candidate
  }

  private static func nonempty(_ value: Any?) -> String? {
    guard let string = value as? String else { return nil }
    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private static func milliseconds(_ value: Any?) -> TimeInterval? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
      return nil
    }
    let result = number.doubleValue
    guard result.isFinite, result > 0, result.rounded() == result else { return nil }
    return result
  }

  private static func isLoopback(_ host: String?) -> Bool {
    host == "localhost" || host == "127.0.0.1"
  }
}
