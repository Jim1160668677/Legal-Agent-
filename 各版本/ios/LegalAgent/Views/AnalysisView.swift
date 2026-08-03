import SwiftUI
import Combine

// MARK: - Analysis View
struct AnalysisView: View {
    @StateObject private var viewModel = AnalysisViewModel()
    @State private var caseType = "contract"
    @State private var factsText = ""
    @State private var requirementsText = ""
    @State private var showSavedAnalysis = false

    let caseTypes = [
        ("合同纠纷", "contract"),
        ("劳动争议", "labor"),
        ("房产纠纷", "property"),
        ("婚姻家庭", "marriage"),
        ("侵权纠纷", "tort"),
        ("刑事案件", "criminal"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // 案件类型选择
                VStack(alignment: .leading, spacing: 12) {
                    Text("案件类型")
                        .font(.headline)
                    Picker("选择案件类型", selection: $caseType) {
                        ForEach(caseTypes, id: \.1) { type in
                            Text(type.0).tag(type.1)
                        }
                    }
                    .pickerStyle(SegmentedPickerStyle())
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(radius: 2)

                // 案件事实输入
                VStack(alignment: .leading, spacing: 8) {
                    Text("案件事实")
                        .font(.headline)
                    TextEditor(text: $factsText)
                        .frame(minHeight: 160)
                        .padding(12)
                        .background(Color(.systemGray6))
                        .cornerRadius(8)
                    HStack {
                        Text("\(factsText.count) 字")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Spacer()
                        if factsText.count < 50 {
                            Text("建议至少50字")
                                .font(.caption)
                                .foregroundColor(factsText.count > 20 ? .orange : .red)
                        }
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(radius: 2)

                // 诉求
                VStack(alignment: .leading, spacing: 8) {
                    Text("您的诉求")
                        .font(.headline)
                    TextEditor(text: $requirementsText)
                        .frame(minHeight: 100)
                        .padding(12)
                        .background(Color(.systemGray6))
                        .cornerRadius(8)
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(radius: 2)

                // 分析按钮
                Button(action: analyzeCase) {
                    HStack {
                        if viewModel.isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Image(systemName: "magnifyingglass")
                        }
                        Text(viewModel.isLoading ? "分析中..." : "开始分析")
                            .fontWeight(.semibold)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(
                        factsText.count >= 50 ? Color.blue : Color.gray
                    )
                    .cornerRadius(12)
                }
                .disabled(factsText.count < 50 || viewModel.isLoading)
                .padding(.horizontal)

                // 错误提示
                if let error = viewModel.errorMessage {
                    HStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundColor(.red)
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                        Spacer()
                    }
                    .padding()
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(8)
                    .padding(.horizontal)
                }

                // 进度条
                if viewModel.isLoading {
                    ProgressView(value: viewModel.progress)
                        .progressViewStyle(LinearProgressViewStyle())
                        .padding(.horizontal)
                }

                // 分析结果
                if let result = viewModel.result {
                    AnalysisResultView(result: result)
                        .padding()
                        .background(Color(.systemBackground))
                        .cornerRadius(12)
                        .shadow(radius: 2)
                        .padding(.horizontal)
                }

                Spacer(minLength: 20)
            }
            .padding(.top)
        }
        .navigationTitle("案件分析")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if viewModel.result != nil {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { viewModel.clearResult() }) {
                        Text("重置")
                    }
                }
            }
        }
    }

    private func analyzeCase() {
        viewModel.analyze(
            caseType: caseType,
            facts: factsText,
            requirements: requirementsText
        )
    }
}

// MARK: - Analysis Result View
struct AnalysisResultView: View {
    let result: AnalysisResult

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // 概览
            if let summary = result.summary {
                SummaryView(summary: summary, confidence: result.confidence)
            }

            // IRAC分析
            SectionView(title: "IRAC法律分析") {
                VStack(alignment: .leading, spacing: 12) {
                    ResultSection(title: "争议焦点", items: result.irac.issue)
                    ResultSection(title: "法律依据", items: result.irac.rule.map { $0.displayText })
                    ResultSection(title: "分析要点", items: result.irac.analysis.map { $0.reasoning })

                    Divider()
                    Text("结论")
                        .font(.headline)
                        .foregroundColor(.blue)
                    Text(result.irac.conclusion)
                        .font(.body)
                }
            }

            // 风险评估
            SectionView(title: "风险评估") {
                RiskAssessmentView(assessment: result.riskAssessment)
            }

            // 建议
            SectionView(title: "专业建议") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(result.recommendations, id: \.id) { rec in
                        RecommendationRow(rec: rec)
                    }
                }
            }
        }
    }
}

// MARK: - Summary View
struct SummaryView: View {
    let summary: String
    let confidence: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("分析摘要")
                    .font(.headline)
                if let confidence = confidence {
                    Text("\(Int(confidence * 100))% 置信度")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            Text(summary)
                .font(.body)
                .foregroundColor(.primary)
        }
    }
}

// MARK: - Section View
struct SectionView<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
                .foregroundColor(.blue)
            content()
        }
    }
}

// MARK: - Result Section
struct ResultSection: View {
    let title: String
    let items: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.medium)
            VStack(alignment: .leading, spacing: 4) {
                ForEach(items, id: \.self) { item in
                    Text("• \(item)")
                        .font(.body)
                        .foregroundColor(.primary)
                }
            }
        }
    }
}

// MARK: - Risk Assessment View
struct RiskAssessmentView: View {
    let assessment: RiskAssessment

    var riskColor: Color {
        switch assessment.level {
        case .high, .critical: return .red
        case .medium: return .orange
        case .low: return .green
        case .unknown, .low: return .gray
        }
    }

    var body: some View {
        HStack {
            Circle()
                .fill(riskColor)
                .frame(width: 10, height: 10)
            Text(assessment.level.displayName)
                .font(.headline)
                .foregroundColor(riskColor)
            Spacer()
        }
        .padding(.bottom, 8)

        if !assessment.factors.isEmpty {
            List(assessment.factors, id: \.name) { factor in
                HStack {
                    VStack(alignment: .leading) {
                        Text(factor.name)
                        Text(factor.description)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                    Text("\(Int(factor.score * 100))%")
                        .font(.monospacedDigit)
                        .foregroundColor(.secondary)
                }
            }
            .listStyle(.plain)
        }

        if !assessment.suggestions.isEmpty {
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                Text("建议措施")
                    .font(.subheadline)
                    .fontWeight(.medium)
                ForEach(assessment.suggestions, id: \.self) { suggestion in
                    Text("• \(suggestion)")
                        .font(.caption)
                }
            }
        }
    }
}

// MARK: - Recommendation Row
struct RecommendationRow: View {
    let rec: Recommendation

    var recColor: Color {
        switch rec.priority {
        case .high: return .red
        case .medium: return .orange
        case .low: return .blue
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: rec.type.icon)
                .foregroundColor(recColor)
                .font(.title2)
            VStack(alignment: .leading, spacing: 4) {
                Text(rec.content)
                    .font(.body)
                HStack {
                    Text(rec.type.displayName)
                        .font(.caption)
                        .foregroundColor(recColor)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(recColor.opacity(0.1))
                        .cornerRadius(4)
                    Spacer()
                    Text("优先级: \(rec.priority.displayName)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Preview
struct AnalysisView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            AnalysisView()
        }
    }
}
