import Foundation
import Combine

// MARK: - Profile ViewModel
class ProfileViewModel: ObservableObject {
    @Published var user: User?
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient = ApiClient.shared
    private var cancellables = Set<AnyCancellable>()

    func loadUserProfile() {
        user = AuthViewModel().user
    }

    func updateProfile(name: String, phone: String?, email: String?) {
    }

    var displayName: String {
        return user?.profile?.name ?? user?.username ?? "用户"
    }

    var userRole: String {
        return user?.role ?? "普通用户"
    }
}
