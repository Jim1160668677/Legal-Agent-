import Foundation
import Combine

// MARK: - Analysis ViewModel
class AnalysisViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var result: AnalysisResult?
    @Published var errorMessage: String?
    @Published var progress: Double = 0

    private let apiClient = ApiClient.shared
    private var cancellables = Set<AnyCancellable>()

    func analyze(caseType: String, facts: String, requirements: String? = nil) {
        guard !facts.trimmingCharacters(in: .whitespaces).isEmpty else {
            errorMessage = "请输入案件事实"
            return
        }
        guard facts.count >= 50 else {
            errorMessage = "案件事实描述过短，请提供更多详细信息（至少50字）"
            return
        }

        isLoading = true
        result = nil
        errorMessage = nil
        progress = 0

        Task {
            do {
                progress = 0.3
                let analysisResult = try await apiClient.analyzeCase(
                    caseType: caseType,
                    facts: facts.trimmingCharacters(in: .whitespaces),
                    requirements: requirements
                )
                progress = 0.8
                self.result = analysisResult
                progress = 1.0
            } catch {
                self.errorMessage = "分析失败: \(error.localizedDescription)"
            } finally {
                self.isLoading = false
            }
        }
    }

    func clearResult() {
        result = nil
        errorMessage = nil
        progress = 0
    }
}
