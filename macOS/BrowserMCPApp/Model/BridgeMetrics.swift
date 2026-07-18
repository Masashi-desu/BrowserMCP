import Foundation

struct PairingApprovalRequest: Equatable, Identifiable, Sendable {
  let requestId: String
  let origin: String
  let requestedAt: Date
  let expiresAt: Date
  let appId: String
  let appName: String
  let appVersion: String
  let runtimeId: String
  let instanceId: String

  var id: String { requestId }
}

struct BridgeMetrics: Equatable, Sendable {
  var apps = 0
  var browserSessions = 0
  var mcpSessions = 0
  var tools = 0
  var resources = 0
  var prompts = 0
  var pairingRequests: [PairingApprovalRequest] = []
  var recentErrors: [String] = []

  static func parse(_ data: Data) -> BridgeMetrics? {
    guard
      let object = try? JSONSerialization.jsonObject(with: data),
      let root = object as? [String: Any],
      let capabilities = root["capabilities"] as? [String: Any],
      let sessions = root["sessions"] as? [String: Any],
      let pairingRequests = pairingRequests(root["pairingRequests"])
    else { return nil }

    let requests = root["recentRequests"] as? [[String: Any]] ?? []
    let errors = requests.compactMap { request -> String? in
      guard
        request["outcome"] as? String == "error" || request["outcome"] as? String == "timeout",
        let error = request["error"] as? [String: Any]
      else { return nil }
      let code = error["code"] as? String ?? "ERROR"
      let message = error["message"] as? String ?? "Request failed"
      return "\(code): \(message)"
    }

    return BridgeMetrics(
      apps: (root["apps"] as? [Any])?.count ?? 0,
      browserSessions: sessions["browser"] as? Int ?? 0,
      mcpSessions: sessions["mcp"] as? Int ?? 0,
      tools: (capabilities["tools"] as? [Any])?.count ?? 0,
      resources: (capabilities["resources"] as? [Any])?.count ?? 0,
      prompts: (capabilities["prompts"] as? [Any])?.count ?? 0,
      pairingRequests: pairingRequests,
      recentErrors: Array(errors.prefix(5))
    )
  }

  private static func pairingRequests(_ value: Any?) -> [PairingApprovalRequest]? {
    guard value != nil else { return [] }
    guard let rawRequests = value as? [[String: Any]] else { return nil }
    var requestIds = Set<String>()
    var requests: [PairingApprovalRequest] = []
    for item in rawRequests {
      guard
        let requestId = string(item["requestId"]),
        requestId.range(of: #"^[A-Za-z0-9-]{1,128}$"#, options: .regularExpression) != nil,
        requestIds.insert(requestId).inserted,
        let origin = webOrigin(item["origin"]),
        let requestedAt = milliseconds(item["requestedAt"]),
        let expiresAt = milliseconds(item["expiresAt"]),
        expiresAt > requestedAt,
        let app = item["app"] as? [String: Any],
        let appId = string(app["id"]),
        let appName = string(app["name"]),
        let appVersion = string(app["version"]),
        let runtime = item["runtime"] as? [String: Any],
        let runtimeId = string(runtime["id"]),
        let instanceId = string(runtime["instanceId"])
      else { return nil }
      requests.append(
        PairingApprovalRequest(
          requestId: requestId,
          origin: origin,
          requestedAt: Date(timeIntervalSince1970: requestedAt / 1_000),
          expiresAt: Date(timeIntervalSince1970: expiresAt / 1_000),
          appId: appId,
          appName: appName,
          appVersion: appVersion,
          runtimeId: runtimeId,
          instanceId: instanceId
        )
      )
    }
    return requests
  }

  private static func string(_ value: Any?) -> String? {
    guard let value = value as? String else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= 512 else { return nil }
    return trimmed
  }

  private static func milliseconds(_ value: Any?) -> TimeInterval? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
      return nil
    }
    let result = number.doubleValue
    guard result.isFinite, result > 0, result.rounded() == result else { return nil }
    return result
  }

  private static func webOrigin(_ value: Any?) -> String? {
    guard
      let raw = string(value),
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

  private static func isLoopback(_ host: String?) -> Bool {
    host == "localhost" || host == "127.0.0.1"
  }
}
