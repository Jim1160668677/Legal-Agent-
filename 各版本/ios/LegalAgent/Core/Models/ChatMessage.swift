import Foundation

// MARK: - Chat Message Model
struct ChatMessage: Codable, Identifiable, Equatable {
    let id: String
    let sessionId: String
    let role: MessageRole
    let content: String
    let type: MessageType
    let metadata: [String: AnyCodable]?
    let createdAt: String
    let references: [LawCitation]?

    enum CodingKeys: String, CodingKey {
        case id, sessionId, role, content, type, metadata, createdAt, references
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        sessionId = try container.decode(String.self, forKey: .sessionId)

        let roleString = try container.decode(String.self, forKey: .role)
        self.role = MessageRole(rawValue: roleString) ?? .user

        content = try container.decode(String.self, forKey: .content)

        let typeString = try? container.decode(String.self, forKey: .type)
        self.type = typeString.flatMap { MessageType(rawValue: $0) } ?? .text

        metadata = try? container.decode([String: AnyCodable].self, forKey: .metadata)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        references = try? container.decode([LawCitation].self, forKey: .references)
    }

    init(id: String = UUID().uuidString, sessionId: String, role: MessageRole, content: String, type: MessageType = .text, references: [LawCitation]? = nil) {
        self.id = id
        self.sessionId = sessionId
        self.role = role
        self.content = content
        self.type = type
        self.metadata = nil
        self.createdAt = ISO8601DateFormatter().string(from: Date())
        self.references = references
    }
}

enum MessageRole: String, Codable, Equatable {
    case user, assistant, system

    var displayName: String {
        switch self {
        case .user: return "用户"
        case .assistant: return "法律智能体"
        case .system: return "系统"
        }
    }
}

enum MessageType: String, Codable {
    case text, thinking, result, error
}

struct LawCitation: Codable, Identifiable, Equatable {
    let id: String
    let lawName: String
    let article: String
    let content: String
    let relevance: Double?
}

struct SendMessageRequest: Encodable {
    let content: String
    let messageType: String

    init(content: String) {
        self.content = content
        self.messageType = "text"
    }
}

struct StreamChunk: Decodable {
    let id: String?
    let role: String?
    let content: String
    let type: String?
    let done: Bool?
    let references: [LawCitation]?
}

extension ChatMessage {
    var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: createdAt)
    }

    var timeAgo: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: createdAt, relativeTo: Date())
    }
}
