import Foundation

// MARK: - Chat Session Model
struct ChatSession: Codable, Identifiable, Equatable {
    let id: String
    let intent: String?
    let title: String?
    let messages: [ChatMessage]?
    let createdAt: String
    let updatedAt: String
    let messageCount: Int?

    enum CodingKeys: String, CodingKey {
        case id, intent, title, messages, createdAt, updatedAt, messageCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        intent = try? container.decode(String?.self, forKey: .intent)
        title = try? container.decode(String?.self, forKey: .title)
        messages = try? container.decode([ChatMessage]?.self, forKey: .messages)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decode(String.self, forKey: .updatedAt)
        messageCount = try? container.decode(Int?.self, forKey: .messageCount)
    }

    var previewMessage: String? {
        return messages?.last?.content
    }

    var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: updatedAt)
    }

    var timeAgo: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: updatedAt, relativeTo: Date())
    }
}

// MARK: - Create Session Request
struct CreateSessionRequest: Encodable {
    let intent: String?
    let title: String?

    init(intent: String? = nil, title: String? = nil) {
        self.intent = intent
        self.title = title
    }
}

// MARK: - Session List Response
struct SessionListResponse: Decodable {
    let sessions: [ChatSession]
    let total: Int
    let page: Int
    let pageSize: Int

    enum CodingKeys: String, CodingKey {
        case sessions, total, page, pageSize
    }
}
