import Foundation
import Combine

// MARK: - Auth ViewModel
class AuthViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var user: User?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var loginError: String?

    private let apiClient = ApiClient.shared
    private var cancellables = Set<AnyCancellable>()

    init() {
        loadSavedCredentials()
    }

    func loadSavedCredentials() {
        apiClient.loadCredentials()
        isAuthenticated = apiClient.isAuthenticated
    }

    func login(username: String, password: String) async throws {
        guard !username.trimmingCharacters(in: .whitespaces).isEmpty,
              !password.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw APIError.general("用户名和密码不能为空")
        }

        isLoading = true
        errorMessage = nil
        loginError = nil

        do {
            let response = try await apiClient.login(username: username.trimmingCharacters(in: .whitespaces), password: password)
            self.user = response.user
            self.isAuthenticated = true
        } catch let error as APIError {
            self.errorMessage = error.errorDescription
            self.loginError = error.errorDescription
            throw error
        } catch {
            self.errorMessage = "登录失败: \(error.localizedDescription)"
            self.loginError = "用户名或密码错误"
            throw APIError.general("登录失败")
        } finally {
            isLoading = false
        }
    }

    func logout() async {
        do { try await apiClient.logout() } catch { print("Logout error: \(error)") }
        self.user = nil
        self.isAuthenticated = false
    }

    func refreshTokenIfNeeded() async {
        guard apiClient.isAuthenticated, let refreshToken = apiClient.refreshToken else { return }
        do { try await apiClient.refreshAndSave() } catch { print("Token refresh failed: \(error)") }
    }
}
