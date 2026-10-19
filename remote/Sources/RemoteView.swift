import SwiftUI
import UIKit

struct RemoteView: View {
    @EnvironmentObject private var tv: TVClient
    @State private var showSettings = false
    @State private var showKeyboard = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                StatusLabel(status: tv.status, notice: tv.notice)
                Spacer()
                Button { tap(); tv.power() } label: {
                    Image(systemName: "power").font(.title3.weight(.semibold)).foregroundStyle(.red.opacity(0.9))
                        .frame(width: 40, height: 40).background(Circle().fill(Color(white: 0.15)))
                }
                .accessibilityLabel("Power")
                .padding(.trailing, 8)
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape.fill").font(.title3).foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)

            Spacer(minLength: 24)
            DPad()
            Spacer(minLength: 32)

            HStack(spacing: 28) {
                RoundKey(symbol: "chevron.backward", label: "Back") { tv.press("KEY_RETURN") }
                RoundKey(symbol: "house.fill", label: "Home") { tv.home() }
                RoundKey(symbol: "keyboard", label: "Keyboard") { showKeyboard = true }
            }
            HStack(spacing: 14) {
                // channel up: the launcher shows the next wallpaper
                RoundKey(symbol: "photo.on.rectangle", label: "Next wallpaper", size: 64) { tv.press("KEY_CHUP") }
                VolumeRocker()
                RoundKey(symbol: "speaker.slash.fill", label: "Mute", size: 64) { tv.press("KEY_MUTE") }
            }
            .padding(.top, 22)
            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showKeyboard) { KeyboardSheet().presentationDetents([.height(220)]) }
        // the TV opened its own keyboard (a text box that takes typing): bring up the phone's
        .onChange(of: tv.typing) { _, typing in if typing && !showSettings { showKeyboard = true } }
        .onAppear { if tv.host.isEmpty { showSettings = true } }
    }
}

// MARK: D-pad

/// Edges send arrows, the middle sends OK. Holding an arrow repeats it.
private struct DPad: View {
    @EnvironmentObject private var tv: TVClient
    @State private var pressed: Zone?
    @State private var repeater: Repeater?

    enum Zone { case up, down, left, right, ok
        var key: String {
            switch self {
            case .up: "KEY_UP"
            case .down: "KEY_DOWN"
            case .left: "KEY_LEFT"
            case .right: "KEY_RIGHT"
            case .ok: "KEY_ENTER"
            }
        }
    }

    private let size: CGFloat = 300
    private let centerSize: CGFloat = 116

    var body: some View {
        ZStack {
            Circle().fill(Color(white: 0.11))
            Circle().fill(Color(white: pressed == .ok ? 0.26 : 0.17)).frame(width: centerSize, height: centerSize)
            Text("OK").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
            arrow("chevron.up", .up).offset(y: -size * 0.37)
            arrow("chevron.down", .down).offset(y: size * 0.37)
            arrow("chevron.left", .left).offset(x: -size * 0.37)
            arrow("chevron.right", .right).offset(x: size * 0.37)
        }
        .frame(width: size, height: size)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    guard pressed == nil, let zone = zone(at: value.startLocation) else { return }
                    pressed = zone
                    tap()
                    tv.press(zone.key)
                    if zone != .ok { repeater = Repeater { tv.press(zone.key) } }
                }
                .onEnded { _ in
                    pressed = nil
                    repeater = nil
                }
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Direction pad")
        .accessibilityAction(named: "Up") { tv.press("KEY_UP") }
        .accessibilityAction(named: "Down") { tv.press("KEY_DOWN") }
        .accessibilityAction(named: "Left") { tv.press("KEY_LEFT") }
        .accessibilityAction(named: "Right") { tv.press("KEY_RIGHT") }
        .accessibilityAction(named: "OK") { tv.press("KEY_ENTER") }
    }

    private func arrow(_ symbol: String, _ zone: Zone) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 26, weight: .semibold))
            .foregroundStyle(.white.opacity(pressed == zone ? 1 : 0.55))
            .scaleEffect(pressed == zone ? 1.15 : 1)
            .animation(.easeOut(duration: 0.12), value: pressed)
    }

    private func zone(at point: CGPoint) -> Zone? {
        let dx = point.x - size / 2, dy = point.y - size / 2
        let distance = (dx * dx + dy * dy).squareRoot()
        if distance > size / 2 { return nil }
        if distance < centerSize / 2 { return .ok }
        return abs(dx) > abs(dy) ? (dx < 0 ? .left : .right) : (dy < 0 ? .up : .down)
    }
}

// MARK: Buttons

private struct RoundKey: View {
    let symbol: String
    let label: String
    var size: CGFloat = 76
    let action: () -> Void

    var body: some View {
        Button { tap(); action() } label: {
            Image(systemName: symbol)
                .font(.system(size: size * 0.31, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .frame(width: size, height: size)
                .background(Circle().fill(Color(white: 0.15)))
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(label)
    }
}

/// Volume down / up, repeating while held.
private struct VolumeRocker: View {
    @EnvironmentObject private var tv: TVClient

    var body: some View {
        HStack(spacing: 0) {
            HoldKey(symbol: "minus", label: "Volume down") { tv.press("KEY_VOLDOWN") }
            Image(systemName: "speaker.wave.2.fill").font(.system(size: 15)).foregroundStyle(.secondary)
            HoldKey(symbol: "plus", label: "Volume up") { tv.press("KEY_VOLUP") }
        }
        .frame(width: 196, height: 64)
        .background(Capsule().fill(Color(white: 0.15)))
    }
}

private struct HoldKey: View {
    let symbol: String
    let label: String
    let action: () -> Void
    @State private var repeater: Repeater?

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(.white.opacity(repeater == nil ? 0.85 : 1))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard repeater == nil else { return }
                        tap()
                        action()
                        repeater = Repeater(action: action)
                    }
                    .onEnded { _ in repeater = nil }
            )
            .accessibilityElement()
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { action() }
    }
}

private struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .brightness(configuration.isPressed ? 0.08 : 0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// After a short hold, repeats an action until released (dropped).
private final class Repeater {
    private var timer: Timer?

    init(action: @escaping () -> Void) {
        timer = Timer.scheduledTimer(withTimeInterval: 0.45, repeats: false) { [weak self] _ in
            self?.timer = Timer.scheduledTimer(withTimeInterval: 0.13, repeats: true) { _ in action() }
        }
    }

    deinit { timer?.invalidate() }
}

@MainActor private let haptics = UIImpactFeedbackGenerator(style: .light)
@MainActor private func tap() { haptics.impactOccurred() }

// MARK: Keyboard

/// Text for the box the TV has open. Works where the TV uses its own keyboard (sign-in boxes,
/// passwords, the browser); apps like YouTube draw their own, so use the arrows there.
private struct KeyboardSheet: View {
    @EnvironmentObject private var tv: TVClient
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Type for the TV", text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.send)
                .focused($focused)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color(white: 0.15)))
                .onSubmit {
                    if !text.isEmpty { tv.type(text) }
                    dismiss()
                }
            Text(tv.typing ? "Press Send to put this in the TV's text box."
                           : "Select a text box on the TV first. Apps with their own keyboard, like YouTube, need the arrows instead.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(20)
        .onAppear { focused = true }
    }
}

// MARK: Status and settings

private struct StatusLabel: View {
    let status: TVClient.Status
    let notice: String?

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(notice == nil ? color : .orange).frame(width: 8, height: 8)
            Text(notice ?? text).font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var text: String {
        switch status {
        case .idle: "Not connected"
        case .connecting: "Connecting…"
        case .waitingForAllow: "Press Allow on your TV"
        case .tvOff: "TV is off"
        case .connected: "Connected"
        case .failed(let reason): reason
        }
    }

    private var color: Color {
        switch status {
        case .connected: .green
        case .connecting, .waitingForAllow: .yellow
        case .idle, .tvOff: .gray
        case .failed: .red
        }
    }
}

private struct SettingsView: View {
    @EnvironmentObject private var tv: TVClient
    @Environment(\.dismiss) private var dismiss
    @State private var host = ""
    @State private var homeApp = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("192.168.1.20", text: $host)
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: { Text("TV address") } footer: {
                    Text("On the TV: Settings → General & Privacy → Network → Network Status → IP Settings. The phone must be on the same Wi-Fi.")
                }
                Section {
                    TextField("TVLauncher.Launcher", text: $homeApp)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: { Text("Home opens") } footer: {
                    Text("The app id the Home button launches.")
                }
                Section {
                    Button("Forget this TV", role: .destructive) { tv.forget() }
                } footer: {
                    Text("Clears the pairing. The TV asks to Allow this remote again.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        let app = homeApp.trimmingCharacters(in: .whitespaces)
                        tv.homeApp = app.isEmpty ? "TVLauncher.Launcher" : app
                        tv.host = host.trimmingCharacters(in: .whitespaces)
                        dismiss()
                    }
                }
            }
            .onAppear {
                host = tv.host
                homeApp = tv.homeApp
            }
        }
    }
}
