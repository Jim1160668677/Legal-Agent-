// ContentView.swift
// LegalAgent
//
// Created for Legal Agent iOS App

import SwiftUI

// MARK: - Content View
struct ContentView: View {
    @EnvironmentObject var authManager: AuthViewModel
    @State private var selectedTab = 0

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
            }
        }
    }
}

// MARK: - Preview
struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
            .environmentObject(AuthViewModel())
    }
}
