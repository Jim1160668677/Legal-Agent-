import Foundation

// MARK: - API Client
class ApiClient {
    static let shared = ApiClient()

    private let baseURL: String
    private var token: String?
    private var refreshToken: String?
    private var session: URLSession

    init(baseURL: String? = nil) {
        let configuredURL = baseURL ?? UserDefaults.standard.string(forKey: "api_base_url")
            ?? ProcessInfo.processInfo.environment["API_BASE_URL"]
            ?? "https://api.legal-agent.com"
        self.baseURL = configuredURL

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)
    }

    // MARK: - Auth
    func login(username: String, password: String) async throws -> LoginResponse {
        let data = try await postData(path: "/v1/auth/login", body: ["username": username, "password": password])
        let response = try JSONDecoder().decode(ApiResponse<LoginResponse>.self, from: data)
        guard response.success else { throw APIError.general(response.error?.message ?? "登录失败") }
        self.token = response.data.accessToken
        self.refreshToken = response.data.refreshToken
        saveCredentials()
        return response.data
    }

    func logout() async throws {
        if let token = token {
            _ = try? await postData(path: "/v1/auth/logout", body: [:], token: token)
        }
        self.token = nil
        self.refreshToken = nil
        clearCredentials()
    }

    func refreshAndSave() async throws {
        guard let refreshToken = refreshToken else { throw APIError.unauthenticated }
        let data = try await postData(path: "/v1/auth/refresh", body: ["refreshToken": refreshToken])
        let response = try JSONDecoder().decode(ApiResponse<LoginResponse>.self, from: data)
        guard response.success else { throw APIError.authenticationFailed }
        self.token = response.data.accessToken
        self.refreshToken = response.data.refreshToken
        saveCredentials()
    }

    // MARK: - Chat
    func createSession(intent: String? = nil) async throws -> ChatSession {
        let body: [String: Any] = intent != nil ? ["intent": intent!] : [:]
        let data = try await postData(path: "/v1/chat/sessions", body: body)
        let response = try JSONDecoder().decode(ApiResponse<ChatSession>.self, from: data)
        guard response.success else { throw APIError.general(response.error?.message ?? "创建会话失败") }
        return response.data
    }

    func sendMessage(sessionId: String, content: String) async throws -> ChatMessage {
        let data = try await postData(path: "/v1/chat/sessions/\(sessionId)/messages", body: ["content": content, "messageType": "text"])
        let response = try JSONDecoder().decode(ApiResponse<ChatMessage>.self, from: data)
        guard response.success else { throw APIError.general(response.error?.message ?? "发送消息失败") }
        return response.data
    }

    func getMessages(sessionId: String, page: Int = 1, pageSize: Int = 20) async throws -> SessionListResponse {
        let url = URL(string: "\(baseURL)/v1/chat/sessions/\(sessionId)/messages?page=\(page)&pageSize=\(pageSize)")!
        let data = try await fetchData(url: url)
        let response = try JSONDecoder().decode(ApiResponse<[ChatMessage]>.self, from: data)
        guard response.success else { throw APIError.general(response.error?.message ?? "获取消息失败") }
        return SessionListResponse(sessions: [], total: response.data.count, page: page, pageSize: pageSize)
    }

    func getSessionList(page: Int = 1, pageSize: Int = 20) async throws -> SessionListResponse {
        let url = URL(string: "\(baseURL)/v1/chat/sessions?page=\(page)&pageSize=\(pageSize)")!
        let data = try await fetchData(url: url)
        let response = try JSONDecoder().decode(ApiResponse<SessionListResponse>.self, from: data)
        guard response.success else { throw APIError.general(response.error?.message ?? "获取会话列表失败") }
        return response.data
    }

    func deleteSession(sessionId: String) async throws {
        let url = URL(string: "\(baseURL)/v1/chat/sessions/\(sessionId)")!
        try await deleteData(url: url)
    }

    // MARK: - Knowledge
    func searchKnowledge(query: String, topK: Int = 10, category: String? = nil) async throws -> [KnowledgeResult] {
        var body: [String: Any] = ["query": query, "topK": topK]
        if let category = category { body["category"] = category }
        let data = try await postData(path: "/v1/knowledge/retrieve", body: body)
        let response = try JSONDecoder().decode(ApiResponse<[KnowledgeResult]>.self, from: data)
        guard response.success else { throw APIError.general(response.error?.message ?? "知识检索失败") }
        return response.data
    }

    // MARK: - Analysis
    func analyzeCase(caseType: String, facts: String, requirements: String? = nil) async throws -> AnalysisResult {
        var body: [String: Any] = ["caseType": caseType, "facts": facts]
        if let req = requirements, !req.isEmpty { body["requirements"] = req }
        let data = try await postData(path: "/v1/cases/analyze", body: body)
        let response = try JSONDecoder().decode(ApiResponse<AnalysisResult>.self, from: data)
        guard response.success else { throw APIError.general(response.error?.message ?? "案件分析失败") }
        return response.data
    }

    // MARK: - SSE Stream
    func streamMessages(sessionId: String, content: String) async throws -> AsyncThrowingStream<StreamChunk, Error> {
        return AsyncThrowingStream { continuation yieldd in
            Task {
                do {
                    try await streamData(path: "/v1/chat/sessions/\(sessionId)/messages/stream", body: ["content": content, "messageType": "text"]) { line in
                        guard let data = line.data(using: .utf8),
                              let chunk = try? JSONDecoder().decode(StreamChunk.self, from: data) else { return }
                        continuation.yield(chunk)
                        if chunk.done == true {
                            continuation.finish()
                        }
                    }
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    // MARK: - Private HTTP methods
    private func buildRequest(url: URL, method: String, body: Data?, token: String? = nil) throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = token ?? self.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        return request
    }

    private func withAuth<T>(_ action: () async throws -> T) async throws -> T {
        do {
            return try await action()
        } catch APIError.unauthenticated, APIError.authenticationFailed {
            if let refreshToken = refreshToken {
                try await refreshAndSave()
                return try await action()
            }
            throw APIError.unauthenticated
        } catch let error as APIError where error.isAuthError {
            if let refreshToken = refreshToken {
                try? await refreshAndSave()
                return try await action()
            }
            throw error
        }
    }

    private func fetchData(url: URL) async throws -> Data {
        return try await withAuth {
            let (data, response) = try await session.data(for: try buildRequest(url: url, method: "GET", body: nil))
            guard let httpResponse = response as? HTTPURLResponse else { throw APIError.invalidResponse }
            guard (200...299).contains(httpResponse.statusCode) else {
                let msg = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
                throw APIError.httpError(statusCode: httpResponse.statusCode, message: msg)
            }
            return data
        }
    }

    private func postData(path: String, body: [String: Any], token: String? = nil) async throws -> Data {
        let url = URL(string: "\(baseURL)\(path)")!
        return try await withAuth {
            let jsonData = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await session.data(for: try buildRequest(url: url, method: "POST", body: jsonData))
            guard let httpResponse = response as? HTTPURLResponse else { throw APIError.invalidResponse }
            guard (200...299).contains(httpResponse.statusCode) else {
                let msg = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
                throw APIError.httpError(statusCode: httpResponse.statusCode, message: msg)
            }
            return data
        }
    }

    private func deleteData(url: URL) async throws {
        try await withAuth {
            let (_, response) = try await session.data(for: try buildRequest(url: url, method: "DELETE", body: nil))
            guard let httpResponse = response as? HTTPURLResponse else { throw APIError.invalidResponse }
            guard (200...299).contains(httpResponse.statusCode) else {
                throw APIError.httpError(statusCode: httpResponse.statusCode, message: "HTTP \(httpResponse.statusCode)")
            }
        }
    }

    private func streamData(path: String, body: [String: Any], handler: (String) -> Void) async throws {
        let url = URL(string: "\(baseURL)\(path)")!
        var request = try buildRequest(url: url, method: "POST", body: try JSONSerialization.data(withJSONObject: body))
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("keep-alive", forHTTPHeaderField: "Connection")

        let (data, response) = try await session.bytes(for: request)
        guard let httpResponse = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(statusCode: httpResponse.statusCode, message: "HTTP \(httpResponse.statusCode)")
        }

        for try await line in data.lines {
            if !line.isEmpty {
                handler(line)
            }
        }
    }

    // MARK: - Credentials
    private func saveCredentials() {
        if let token = token { UserDefaults.standard.set(token, forKey: "auth_token") }
        if let refreshToken = refreshToken { UserDefaults.standard.set(refreshToken, forKey: "refresh_token") }
    }

    private func clearCredentials() {
        UserDefaults.standard.removeObject(forKey: "auth_token")
        UserDefaults.standard.removeObject(forKey: "refresh_token")
    }

    func loadCredentials() {
        self.token = UserDefaults.standard.string(forKey: "auth_token")
        self.refreshToken = UserDefaults.standard.string(forKey: "refresh_token")
    }

    var isAuthenticated: Bool { return token != nil }
}
