import CryptoKit
import Foundation
import Network
import Security

/// Talks to a Samsung TV on the same Wi-Fi.
/// Keys go over the TV's remote WebSocket (wss, port 8002, one Allow prompt on first use).
/// Home is a direct launch of the launcher app (http, port 8001), so Samsung's home never shows.
@MainActor
final class TVClient: NSObject, ObservableObject {
    enum Status: Equatable { case idle, connecting, waitingForAllow, tvOff, connected, failed(String) }

    @Published private(set) var status: Status = .idle
    @Published private(set) var notice: String?   // brief message that doesn't change the connection status
    @Published private(set) var typing = false     // the TV has its own keyboard open, waiting for text
    @Published var host: String { didSet { if host != oldValue { hostChanged() } } }
    @Published var homeApp: String { didSet { UserDefaults.standard.set(homeApp, forKey: "homeApp") } }

    private static let clientName = Data("TVLauncherRemote".utf8).base64EncodedString()
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var ready = false
    private var pending: [[String: Any]] = []
    private var allowTimer: Timer?
    private var noticeTimer: Timer?
    private var retried = false

    override init() {
        host = UserDefaults.standard.string(forKey: "host") ?? ""
        homeApp = UserDefaults.standard.string(forKey: "homeApp") ?? "TVLauncher.Launcher"
        super.init()
        session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: .main)
    }

    // MARK: Keys

    /// Sends a remote key, e.g. KEY_LEFT. Connects first if needed.
    func press(_ key: String) {
        send(["Cmd": "Click", "DataOfCmd": key, "Option": "false", "TypeOfRemote": "SendRemoteKey"])
    }

    /// Types into the text box the TV has open (only boxes that use the TV's own keyboard).
    func type(_ text: String) {
        send(["Cmd": Data(text.utf8).base64EncodedString(), "DataOfCmd": "base64", "TypeOfRemote": "SendInputString"])
        send(["Cmd": "", "DataOfCmd": "", "TypeOfRemote": "SendInputEnd"])
    }

    /// Turns the TV off, or on: a key while it's in standby, Wake-on-LAN once it's fully asleep.
    func power() {
        guard !host.isEmpty, let url = URL(string: "http://\(host):8001/api/v2/") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 3
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            let device = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])?["device"] as? [String: Any]
            let asleep = (error as? URLError).map { [.cannotConnectToHost, .timedOut, .networkConnectionLost, .notConnectedToInternet].contains($0.code) } ?? false
            Task { @MainActor in
                guard let self else { return }
                if let mac = device?["wifiMac"] as? String ?? device?["mac"] as? String {
                    UserDefaults.standard.set(mac, forKey: "mac:" + self.host)
                }
                if device != nil {
                    // answering: on (key turns it off) or in standby (key turns it on)
                    let waking = device?["PowerState"] as? String == "standby"
                    self.press("KEY_POWER")
                    if waking { self.openLauncherOnceAwake() }
                } else if asleep {
                    self.wake()
                } else {
                    self.show("Can't reach the TV")
                }
            }
        }.resume()
    }

    private func wake() {
        guard let mac = UserDefaults.standard.string(forKey: "mac:" + host),
              case let bytes = mac.split(separator: ":").compactMap({ UInt8($0, radix: 16) }), bytes.count == 6
        else { return show("Turn the TV on once with its remote first") }
        let packet = Data(repeating: 0xff, count: 6) + Data((0..<16).flatMap { _ in bytes })
        // sent straight to the TV's address (broadcast needs an Apple entitlement)
        let connection = NWConnection(host: NWEndpoint.Host(host), port: 9, using: .udp)
        connection.stateUpdateHandler = { state in
            guard case .ready = state else { return }
            // a few packets over ~3 s, in case the first ones go out before the TV's Wi-Fi answers
            for i in 0..<6 {
                DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.5) {
                    connection.send(content: packet, completion: .idempotent)
                }
            }
        }
        connection.start(queue: .main)
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { connection.cancel() }
        openLauncherOnceAwake()
    }

    /// The TV wakes on its last input (often an empty "Connected Devices" screen), so once it
    /// reports being on, open the launcher. Gives up after ~25 s.
    private func openLauncherOnceAwake(attempt: Int = 0) {
        if attempt == 0 { show("Turning on…") }
        guard attempt < 25, let url = URL(string: "http://\(host):8001/api/v2/") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            let device = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])?["device"] as? [String: Any]
            Task { @MainActor in
                guard let self else { return }
                if device?["PowerState"] as? String == "on" {
                    self.connect()   // refresh the status line
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.home() }   // let it finish booting
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.openLauncherOnceAwake(attempt: attempt + 1) }
                }
            }
        }.resume()
    }

    private func send(_ params: [String: Any]) {
        if ready, let task {
            send(params, on: task)
        } else {
            pending = Array((pending + [params]).suffix(3))   // don't replay a long burst after a reconnect
            connect()
        }
    }

    /// Opens the launcher directly instead of pressing Home, so Samsung's home screen is skipped.
    func home() {
        guard !host.isEmpty, let url = URL(string: "http://\(host):8001/api/v2/applications/\(homeApp)") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 4
        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard error != nil || !(200..<300).contains(code) else { return }
            Task { @MainActor in self?.show(code == 404 ? "Launcher not found on the TV" : "Can't reach the TV") }
        }.resume()
    }

    // MARK: Connection

    func connect() {
        guard task == nil, !host.isEmpty else { return }
        var parts = URLComponents()
        parts.scheme = "wss"
        parts.host = host
        parts.port = 8002
        parts.path = "/api/v2/channels/samsung.remote.control"
        parts.queryItems = [URLQueryItem(name: "name", value: Self.clientName)]
        let token = Keychain.get(host)
        if let token { parts.queryItems?.append(URLQueryItem(name: "token", value: token)) }
        guard let url = parts.url else { status = .failed("Check the TV address"); return }

        let task = session.webSocketTask(with: url)
        self.task = task
        ready = false
        status = .connecting
        task.resume()
        listen(task)
        // a new (or forgotten) remote gets an Allow prompt on the TV, which waits for it
        allowTimer?.invalidate()
        allowTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.task === task, !self.ready else { return }
                // a socket that hangs is either an Allow prompt on the TV, or the TV being off
                self.powerState { state in
                    guard self.task === task, !self.ready else { return }
                    self.status = state == "on" ? .waitingForAllow : .tvOff
                }
            }
        }
    }

    /// The TV's PowerState ("on", "standby"), or nil when it doesn't answer (fully asleep).
    private func powerState(_ done: @escaping @MainActor (String?) -> Void) {
        guard let url = URL(string: "http://\(host):8001/api/v2/") else { return done(nil) }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let device = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])?["device"] as? [String: Any]
            let state = device.map { $0["PowerState"] as? String ?? "on" }   // older TVs don't report it
            Task { @MainActor in done(state) }
        }.resume()
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        reset(to: .idle)
    }

    /// Forgets this TV's pairing token and certificate, e.g. after replacing the TV.
    func forget() {
        disconnect()
        Keychain.set(nil, for: host)
        UserDefaults.standard.removeObject(forKey: "pin:" + host)
        connect()
    }

    private func show(_ message: String) {
        notice = message
        noticeTimer?.invalidate()
        noticeTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.notice = nil }
        }
    }

    private func hostChanged() {
        UserDefaults.standard.set(host, forKey: "host")
        disconnect()
        connect()
    }

    private func reset(to newStatus: Status) {
        task = nil
        ready = false
        typing = false
        pending = []   // never replay old presses (e.g. two Power taps) on a later connection
        allowTimer?.invalidate()
        status = newStatus
    }

    private func listen(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === task else { return }
                switch result {
                case .failure(let error):
                    // a refused certificate shows up as a cancelled request
                    if (error as? URLError)?.code == .cancelled {
                        return self.reset(to: .failed("Couldn't verify the TV. Replaced it? Forget it in Settings."))
                    }
                    let wasAllow = self.status == .waitingForAllow
                    self.reset(to: .connecting)
                    self.powerState { state in
                        guard self.task == nil else { return }
                        self.status = state != "on" ? .tvOff
                            : wasAllow ? .failed("Allow wasn't pressed on the TV") : .failed("Can't reach the TV")
                    }
                case .success(let message):
                    if case .string(let text) = message { self.handle(text, from: task) }
                    if self.task === task { self.listen(task) }
                }
            }
        }
    }

    private func handle(_ text: String, from task: URLSessionWebSocketTask) {
        guard let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let event = json["event"] as? String else { return }
        switch event {
        case "ms.channel.connect":
            let data = json["data"] as? [String: Any]
            if let token = data?["token"] as? String ?? (data?["token"] as? Int).map(String.init), !token.isEmpty {
                Keychain.set(token, for: host)
            }
            ready = true
            retried = false
            allowTimer?.invalidate()
            status = .connected
            pending.forEach { send($0, on: task) }
            pending = []
        case "ms.remote.imeStart":
            typing = true
        case "ms.remote.imeEnd":
            typing = false
        case "ms.channel.unauthorized":
            task.cancel(with: .normalClosure, reason: nil)
            reset(to: .failed("The TV declined this remote"))
        case "ms.channel.timeOut":
            task.cancel(with: .normalClosure, reason: nil)
            reset(to: .failed("Allow wasn't pressed on the TV"))
        default:
            break
        }
    }

    private func send(_ params: [String: Any], on task: URLSessionWebSocketTask) {
        let message: [String: Any] = ["method": "ms.remote.control", "params": params]
        guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
        task.send(.string(String(decoding: data, as: UTF8.self))) { [weak self] error in
            guard error != nil else { return }
            Task { @MainActor in
                guard let self, self.task === task else { return }
                task.cancel(with: .goingAway, reason: nil)
                self.reset(to: .idle)
                // the TV drops idle sockets; reconnect and resend, but only once in a row
                if !self.retried { self.retried = true; self.send(params) }
            }
        }
    }
}

// MARK: Certificate

extension TVClient: URLSessionWebSocketDelegate {
    /// The TV uses a self-signed Samsung certificate. Accept it only from the TV address set in
    /// the app, and remember its fingerprint the first time so a different device can't stand in.
    nonisolated func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                                completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
            return completionHandler(.performDefaultHandling, nil)
        }
        let host = UserDefaults.standard.string(forKey: "host") ?? ""
        guard space.host == host, space.port == 8002, let trust = space.serverTrust,
              let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first,
              (SecCertificateCopySubjectSummary(leaf) as String?)?.hasPrefix("Samsung SmartViewSDK") == true
        else { return completionHandler(.cancelAuthenticationChallenge, nil) }

        let fingerprint = SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02x", $0) }.joined()
        let key = "pin:" + host
        if let pinned = UserDefaults.standard.string(forKey: key), pinned != fingerprint {
            return completionHandler(.cancelAuthenticationChallenge, nil)
        }
        UserDefaults.standard.set(fingerprint, forKey: key)
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
}

// MARK: Keychain

/// Stores the TV's pairing token, one per TV address.
enum Keychain {
    static func get(_ account: String) -> String? {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ value: String?, for account: String) {
        SecItemDelete(base(account) as CFDictionary)
        guard let value else { return }
        var query = base(account)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    private static func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "tv-token", kSecAttrAccount as String: account]
    }
}
