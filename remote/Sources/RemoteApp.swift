import SwiftUI

@main
struct RemoteApp: App {
    @StateObject private var tv = TVClient()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RemoteView()
                .environmentObject(tv)
                .preferredColorScheme(.dark)
        }
        .onChange(of: scenePhase) { _, phase in
            // keep the socket only while the remote is on screen
            if phase == .active { tv.connect() } else if phase == .background { tv.disconnect() }
        }
    }
}
