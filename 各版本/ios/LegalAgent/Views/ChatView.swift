import SwiftUI
import Combine

// MARK: - Chat View
struct ChatView: View {
    @StateObject private var viewModel = ChatViewModel()
    @State private var inputText = ""
    @State private var showSessionPanel = false
    @State private var showNewChatConfirm = false

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 消息列表
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if viewModel.messages.isEmpty && !viewModel.isLoading {
                            EmptyChatView()
                        } else {
                            ForEach(viewModel.messages) { message in
                                MessageBubble(message)
                                    .id(message.id)
                            }
                        }

                        if viewModel.isTyping {
                            TypingIndicator()
                        }
                    }
                    .padding(.vertical)
                }
                .id(viewModel.messages.count)
                .onChange(of: viewModel.messages.count) {
                    // Scroll to bottom when new message arrives
                }

                // 输入框
                InputBar(
                    text: $inputText,
                    isLoading: viewModel.isLoading,
                    onSend: sendMessage
                )
            }
            .navigationTitle("法律智能体")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showSessionPanel = true }) {
                        Image(systemName: "square.and.arrow.down")
                    }
                }
            }
            .sheet(isPresented: $showSessionPanel) {
                SessionPanelView(
                    sessions: viewModel.sessions,
                    currentSession: viewModel.currentSession,
                    onSelect: viewModel.selectSession,
                    onCreateNew: createNewSession,
                    onDelete: viewModel.deleteSession
                )
            }
            .alert("新对话", isPresented: $showNewChatConfirm) {
                Button("取消", role: .cancel) {}
                Button("删除当前会话", role: .destructive) {
                    if let session = viewModel.currentSession {
                        Task { await viewModel.deleteSession(session) }
                    }
                }
                Button("新建", role: .none) {
                    Task {
                        do {
                            _ = try await viewModel.createSession()
                            showSessionPanel = false
                        } catch {
                            print("Create session failed: \(error)")
                        }
                    }
                }
            } message: {
                Text("选择操作方式")
            }
            .task {
                await viewModel.loadSessions()
            }
        }
    }

    private func sendMessage() {
        let content = inputText.trimmingCharacters(in: .whitespaces)
        guard !content.isEmpty else { return }
        inputText = ""

        Task {
            if viewModel.currentSession == nil {
                do {
                    _ = try await viewModel.createSession()
                } catch {
                    viewModel.errorMessage = "创建会话失败: \(error.localizedDescription)"
                    return
                }
            }
            viewModel.sendMessage(content)
        }
    }

    private func createNewSession() {
        showNewChatConfirm = true
    }
}

// MARK: - Empty Chat View
struct EmptyChatView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "robot.fill")
                .font(.system(size: 50))
                .foregroundColor(.blue)
            Text("法律智能体")
                .font(.title2)
                .fontWeight(.bold)
            Text("您好！我是您的法律智能助手，可以帮您解答法律问题、分析案件、检索法律法规。")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Session Panel
struct SessionPanelView: View {
    let sessions: [ChatSession]
    let currentSession: ChatSession?
    let onSelect: (ChatSession) -> Void
    let onCreateNew: () -> Void
    let onDelete: (ChatSession) -> Void

    var body: some View {
        NavigationView {
            List {
                Section("历史对话") {
                    ForEach(sessions) { session in
                        SessionCard(
                            session: session,
                            isSelected: session.id == currentSession?.id
                        ) {
                            onDelete(session)
                        }
                        .onTapGesture {
                            onSelect(session)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("对话列表")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: onCreateNew) {
                        Image(systemName: "plus")
                    }
                }
            }
        }
    }
}

// MARK: - Preview
struct ChatView_Previews: PreviewProvider {
    static var previews: some View {
        ChatView()
    }
}
