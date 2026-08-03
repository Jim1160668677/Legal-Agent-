import Foundation

// MARK: - Analysis Result Model
struct AnalysisResult: Codable, Equatable {
    let analysisId: String
    let caseType: String
    let irac: IRACAnalysis
    let riskAssessment: RiskAssessment
    let recommendations: [Recommendation]
    let summary: String?
    let confidence: Double?

    enum CodingKeys: String, CodingKey {
        case analysisId, caseType, irac, riskAssessment, recommendations, summary, confidence
    }
}

// MARK: - IRAC Analysis
struct IRACAnalysis: Codable, Equatable {
    let issue: [String]
    let rule: [LegalRule]
    let analysis: [AnalysisPoint]
    let conclusion: String

    enum CodingKeys: String, CodingKey {
        case issue, rule, analysis, conclusion
    }
}

// MARK: - Legal Rule
struct LegalRule: Codable, Identifiable, Equatable {
    let id: String?
    let law: String
    let article: String
    let content: String

    var displayText: String {
        return "\(law) 第\(article)条"
    }

    enum CodingKeys: String, CodingKey {
        case id, law, article, content
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try? container.decode(String?.self, forKey: .id)
        law = try container.decode(String.self, forKey: .law)
        article = try container.decode(String.self, forKey: .article)
        content = try container.decode(String.self, forKey: .content)
    }
}

// MARK: - Analysis Point
struct AnalysisPoint: Codable, Equatable {
    let fact: String
    let rule: String
    let reasoning: String

    enum CodingKeys: String, CodingKey {
        case fact, rule, reasoning
    }
}

// MARK: - Risk Assessment
struct RiskAssessment: Codable, Equatable {
    let level: RiskLevel
    let factors: [RiskFactor]
    let suggestions: [String]

    enum CodingKeys: String, CodingKey {
        case level, factors, suggestions
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let levelString = try container.decode(String.self, forKey: .level)
        self.level = RiskLevel(rawValue: levelString) ?? .unknown
        factors = try container.decode([RiskFactor].self, forKey: .factors)
        suggestions = try container.decode([String].self, forKey: .suggestions)
    }
}

// MARK: - Risk Level
enum RiskLevel: String, Codable, Equatable {
    case low, medium, high, critical, unknown

    var color: String {
        switch self {
        case .low: return "green"
        case .medium: return "orange"
        case .high: return "red"
        case .critical: return "red"
        case .unknown: return "gray"
        }
    }

    var displayName: String {
        switch self {
        case .low: return "低风险"
        case .medium: return "中风险"
        case .high: return "高风险"
        case .critical: return "极高风险"
        case .unknown: return "未知"
        }
    }
}

// MARK: - Risk Factor
struct RiskFactor: Codable, Equatable {
    let name: String
    let score: Double
    let description: String

    enum CodingKeys: String, CodingKey {
        case name, score, description
    }
}

// MARK: - Recommendation
struct Recommendation: Codable, Equatable, Identifiable {
    let id: String?
    let type: RecommendationType
    let content: String
    let priority: PriorityLevel

    enum CodingKeys: String, CodingKey {
        case id, type, content, priority
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try? container.decode(String?.self, forKey: .id)
        let typeString = try container.decode(String.self, forKey: .type)
        self.type = RecommendationType(rawValue: typeString) ?? .general
        content = try container.decode(String.self, forKey: .content)
        let priorityString = try container.decode(String.self, forKey: .priority)
        self.priority = PriorityLevel(rawValue: priorityString) ?? .medium
    }
}

// MARK: - Recommendation Type
enum RecommendationType: String, Codable, Equatable {
    case action, warning, suggestion, general

    var icon: String {
        switch self {
        case .action: return "checkmark.circle.fill"
        case .warning: return "exclamation.triangle.fill"
        case .suggestion: return "lightbulb.fill"
        case .general: return "info.circle.fill"
        }
    }

    var displayName: String {
        switch self {
        case .action: return "行动建议"
        case .warning: return "风险提示"
        case .suggestion: return "专业建议"
        case .general: return "建议"
        }
    }
}

// MARK: - Priority Level
enum PriorityLevel: String, Codable, Equatable {
    case low, medium, high

    var color: String {
        switch self {
        case .low: return "blue"
        case .medium: return "orange"
        case .high: return "red"
        }
    }

    var displayName: String {
        switch self {
        case .low: return "低"
        case .medium: return "中"
        case .high: return "高"
        }
    }
}

// MARK: - Analysis Request
struct AnalysisRequest: Encodable {
    let caseType: String
    let facts: String
    let requirements: String?

    init(caseType: String, facts: String, requirements: String? = nil) {
        self.caseType = caseType
        self.facts = facts
        self.requirements = requirements
    }
}
