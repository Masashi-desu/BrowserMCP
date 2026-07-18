import Combine
import Foundation

@MainActor
final class BridgeSettings: ObservableObject {
  private enum Key {
    static let port = "bridge.port"
    static let allowedOrigins = "bridge.allowedOrigins"
    static let pairingOrigins = "bridge.pairingOrigins"
    static let tlsCertificatePath = "bridge.tlsCertificatePath"
    static let tlsKeyPath = "bridge.tlsKeyPath"
    static let nodePath = "bridge.nodePath"
    static let bridgeScriptPath = "bridge.scriptPath"
    static let startAtLogin = "bridge.startWhenAppLaunches"
  }

  private let defaults: UserDefaults

  @Published var port: String { didSet { defaults.set(port, forKey: Key.port) } }
  @Published var allowedOrigins: String {
    didSet { defaults.set(allowedOrigins, forKey: Key.allowedOrigins) }
  }
  @Published var pairingOrigins: String {
    didSet { defaults.set(pairingOrigins, forKey: Key.pairingOrigins) }
  }
  @Published var tlsCertificatePath: String {
    didSet { defaults.set(tlsCertificatePath, forKey: Key.tlsCertificatePath) }
  }
  @Published var tlsKeyPath: String {
    didSet { defaults.set(tlsKeyPath, forKey: Key.tlsKeyPath) }
  }
  @Published var nodePath: String { didSet { defaults.set(nodePath, forKey: Key.nodePath) } }
  @Published var bridgeScriptPath: String {
    didSet { defaults.set(bridgeScriptPath, forKey: Key.bridgeScriptPath) }
  }
  @Published var startWhenAppLaunches: Bool {
    didSet { defaults.set(startWhenAppLaunches, forKey: Key.startAtLogin) }
  }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    port = defaults.string(forKey: Key.port) ?? "8789"
    allowedOrigins = defaults.string(forKey: Key.allowedOrigins) ?? ""
    pairingOrigins = defaults.string(forKey: Key.pairingOrigins) ?? ""
    tlsCertificatePath = defaults.string(forKey: Key.tlsCertificatePath) ?? ""
    tlsKeyPath = defaults.string(forKey: Key.tlsKeyPath) ?? ""
    nodePath = defaults.string(forKey: Key.nodePath) ?? ""
    bridgeScriptPath = defaults.string(forKey: Key.bridgeScriptPath) ?? ""
    startWhenAppLaunches = defaults.object(forKey: Key.startAtLogin) as? Bool ?? true
  }

  var normalizedPort: Int? {
    guard let value = Int(port), (1...65_535).contains(value) else { return nil }
    return value
  }

  var normalizedAllowedOrigins: [String] { normalizedLines(allowedOrigins) }
  var normalizedPairingOrigins: [String] { normalizedLines(pairingOrigins) }

  private func normalizedLines(_ value: String) -> [String] {
    var seen = Set<String>()
    return
      value
      .components(separatedBy: .newlines)
      .flatMap { $0.split(separator: ",").map(String.init) }
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && seen.insert($0).inserted }
  }
}
