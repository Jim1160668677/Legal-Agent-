import Foundation
import Combine

// MARK: - Knowledge ViewModel
class KnowledgeViewModel: ObservableObject {
    @Published var results: [KnowledgeResult] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var selectedCategory: String = "all"
    @Published var searchQuery: String = ""
    @Published var hasNextPage = false
    @Published var currentPage = 1

    private let apiClient = ApiClient.shared
    private var cancellables = Set<AnyCancellable>()

    func search(query: String, category: String? = nil, page: Int = 1) async {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            results = []
            return
        }

        isLoading = true
        errorMessage = nil
        self.searchQuery = query
        self.selectedCategory = category ?? "all"
        self.currentPage = page

        do {
            let categoryFilter = (category == "all" || category == nil) ? nil : category
            let searchResults = try await apiClient.searchKnowledge(query: query, topK: 20, category: categoryFilter)
            self.results = searchResults
            self.hasNextPage = searchResults.count >= 20
        } catch {
            self.errorMessage = "搜索失败: \(error.localizedDescription)"
        } finally {
            self.isLoading = false
        }
    }

    func searchAsync(query: String) {
        Task { await search(query: query) }
    }

    func loadMore() async {
        guard !isLoading, hasNextPage else { return }
        let nextPage = currentPage + 1
        hasNextPage = false
    }
}
