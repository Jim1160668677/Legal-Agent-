import Foundation

// MARK: - API Response Wrapper
struct ApiResponse<T: Decodable>: Decodable {
    let success: Bool
    let data: T
    let error: ApiErrorResponse?
    let meta: ResponseMeta
}

struct ApiErrorResponse: Decodable {
    let code: String
    let message: String
    let details: AnyCodable?
}

struct ResponseMeta: Decodable {
    let traceId: String
    let timestamp: String
    let requestId: String?
}

// MARK: - AnyCodable
struct AnyCodable: Decodable {
    let value: Any

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array
        } else {
            value = NSNull()
        }
    }
}

// MARK: - API Error
enum APIError: Error, LocalizedError {
    case unauthenticated
    case networkError
    case authenticationFailed
    case invalidResponse
    case decodingError(Error)
    case httpError(statusCode: Int, message: String)
    case general(String)
    case timeout
    case cancelled

    var errorDescription: String? {
        switch self {
        case .unauthenticated: return "未登录，请重新登录"
        case .networkError: return "网络连接失败，请检查网络设置"
        case .authenticationFailed: return "登录已过期，请重新登录"
        case .invalidResponse: return "服务器响应无效"
        case .decodingError(let error): return "数据解析错误: \(error.localizedDescription)"
        case .httpError(let statusCode, let message): return "请求失败 (\(statusCode)): \(message)"
        case .general(let msg): return msg
        case .timeout: return "请求超时，请重试"
        case .cancelled: return "请求已取消"
        }
    }

    var isAuthError: Bool {
        switch self {
        case .unauthenticated, .authenticationFailed: return true
        default: return false
        }
    }
}
