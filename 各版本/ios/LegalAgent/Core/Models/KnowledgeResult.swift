import Foundation

// MARK: - Knowledge Result Model
struct KnowledgeResult: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let content: String
    let source: String
    let relevance: Double
    let citation: String
    let category: String?
    let tags: [String]?

    enum CodingKeys: String, CodingKey {
        case id, title, content, source, relevance, citation, category, tags
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        content = try container.decode(String.self, forKey: .content)
        source = try container.decode(String.self, forKey: .source)
        relevance = try container.decode(Double.self, forKey: .relevance)
        citation = try container.decode(String.self, forKey: .citation)
        category = try? container.decode(String?.self, forKey: .category)
        tags = try? container.decode([String]?.self, forKey: .tags)
    }

    var relevancePercentage: Int {
        return Int(relevance * 100)
    }
}

// MARK: - Knowledge Search Request
struct KnowledgeSearchRequest: Encodable {
    let query: String
    let topK: Int
    let category: String?

    init(query: String, topK: Int = 10, category: String? = nil) {
        self.query = query
        self.topK = topK
        self.category = category
    }
}

// MARK: - Knowledge Categories
struct KnowledgeCategory: Identifiable {
    let id = UUID()
    let name: String
    let icon: String
    let count: Int
}

let knowledgeCategories: [KnowledgeCategory] = [
    KnowledgeCategory(name: "全部", icon: "list.bullet", count: 0),
    KnowledgeCategory(name: "合同法", icon: "doc.text", count: 0),
    KnowledgeCategory(name: "劳动法", icon: "briefcase", count: 0),
    KnowledgeCategory(name: "房产法", icon: "house", count: 0),
    KnowledgeCategory(name: "婚姻法", icon: "heart", count: 0),
    KnowledgeCategory(name: "侵权法", icon: "exclamationmark.triangle", count: 0),
    KnowledgeCategory(name: "刑法", icon: "gavel", count: 0),
    KnowledgeCategory(name: "公司法", icon: "building.2", count: 0),
]

// MARK: - Knowledge Result Detail
struct KnowledgeDetail: Codable {
    let result: KnowledgeResult
    let relatedResults: [KnowledgeResult]
}
