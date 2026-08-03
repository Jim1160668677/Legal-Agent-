import Foundation

// MARK: - User Model
struct User: Codable, Identifiable, Equatable {
    let id: String
    let username: String
    let role: String
    let profile: UserProfile?

    enum CodingKeys: String, CodingKey {
        case id, username, role, profile
    }
}

struct UserProfile: Codable, Equatable {
    let name: String?
    let avatar: String?
    let phone: String?
    let email: String?

    enum CodingKeys: String, CodingKey {
        case name, avatar, phone, email
    }
}

// MARK: - Login Request/Response
struct LoginRequest: Encodable {
    let username: String
    let password: String
}

struct LoginResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let user: User
    let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken, refreshToken, user, expiresIn
    }
}

// MARK: - Refresh Token Request
struct RefreshTokenRequest: Encodable {
    let refreshToken: String
}

// MARK: - Logout Request
struct LogoutRequest: Encodable {}
