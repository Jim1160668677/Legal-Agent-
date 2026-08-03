import SwiftUI

@main
struct LegalAgentApp: App {
    @StateObject private var authManager = AuthViewModel()
    @StateObject private var apiClient = ApiClient.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authManager)
                .onAppear {
                    authManager.loadSavedCredentials()
                }
        }
    }
}

// MARK: - Content View
struct ContentView: View {
    @EnvironmentObject var authManager: AuthViewModel
    @State private var selectedTab = 0
    @State private var showingLogin = false

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                TabView(selection: $selectedTab) {
                    NavigationView {
                        ChatView()
                    }
                    .tabItem {
                        Label("对话", systemImage: "message")
                    }
                    .tag(0)

                    NavigationView {
                        AnalysisView()
                    }
                    .tabItem {
                        Label("分析", systemImage: "doc.text")
                    }
                    .tag(1)

                    NavigationView {
                        KnowledgeView()
                    }
                    .tabItem {
                        Label("知识", systemImage: "book")
                    }
                    .tag(2)

                    NavigationView {
                        ProfileView()
                    }
                    .tabItem {
                        Label("我的", systemImage: "person")
                    }
                    .tag(3)
                }
            } else {
                LoginView()
                    .presentationDetents([])
            }
        }
        .onChange(of: authManager.isAuthenticated) { newValue in
            if !newValue {
                showingLogin = true
            }
        }
    }
}

// MARK: - Preview
struct LegalAgentApp_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
            .environmentObject(AuthViewModel())
    }
}
