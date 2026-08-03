import Foundation
import Combine

// MARK: - Chat ViewModel
class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var currentSession: ChatSession?
    @Published var sessions: [ChatSession] = []
    @Published var isLoading = false
    @Published var isTyping = false
    @Published var errorMessage: String?
    @Published var sessionTitle: String = "法律智能体"

    private let apiClient = ApiClient.shared
    private var streamTask: Task<Void, Never>?
    private var cancellables = Set<AnyCancellable>()

    init() {
        loadSessions()
    }

    func loadSessions() {
        Task {
            do {
                let response = try await apiClient.getSessionList()
                self.sessions = response.sessions
            } catch {
                self.errorMessage = "加载会话失败: \(error.localizedDescription)"
            }
        }
    }

    func createSession(intent: String? = nil) async throws -> ChatSession {
        let session = try await apiClient.createSession(intent: intent)
        self.currentSession = session
        self.messages = []
        self.sessionTitle = session.title ?? "新对话"
        await loadSessions()
        return session
    }

    func selectSession(_ session: ChatSession) {
        self.currentSession = session
        self.sessionTitle = session.title ?? "对话"
        Task {
            do {
                let response = try await apiClient.getMessages(sessionId: session.id)
                self.messages = []
            } catch {
                self.errorMessage = "加载消息失败: \(error.localizedDescription)"
            }
        }
    }

    func deleteSession(_ session: ChatSession) async {
        do {
            try await apiClient.deleteSession(sessionId: session.id)
            if currentSession?.id == session.id {
                currentSession = nil
                messages = []
            }
            await loadSessions()
        } catch {
            errorMessage = "删除会话失败: \(error.localizedDescription)"
        }
    }

    func sendMessage(_ content: String) {
        guard !content.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        guard let sessionId = currentSession?.id else { return }

        let userMessage = ChatMessage(id: UUID().uuidString, sessionId: sessionId, role: .user, content: content)
        messages.append(userMessage)
        isTyping = true
        isLoading = true

        streamTask?.cancel()
        streamTask = Task {
            await streamResponse(sessionId: sessionId, content: content)
        }
    }

    private func streamResponse(sessionId: String, content: String) async {
        var assistantContent = ""
        var assistantId: String? = nil

        do {
            let stream = try await apiClient.streamMessages(sessionId: sessionId, content: content)
            for try await chunk in stream {
                if !chunk.done {
                    assistantContent += chunk.content
                    if let id = assistantId {
                        updateAssistantMessage(id: id, content: assistantContent)
                    }
                } else {
                    if let id = assistantId {
                        updateAssistantMessage(id: id, content: assistantContent)
                    }
                    isTyping = false
                    isLoading = false
                    break
                }
            }
        } catch {
            isTyping = false
            isLoading = false
            errorMessage = "发送失败: \(error.localizedDescription)"
        }
    }

    private func updateAssistantMessage(id: String, content: String) {
        if let index = messages.firstIndex(where: { $0.id == id }) {
            var message = messages[index]
            message.content = content
            messages[index] = message
        }
    }

    func cancelStreaming() {
        streamTask?.cancel()
        isTyping = false
        isLoading = false
    }

    deinit { streamTask?.cancel() }
}
