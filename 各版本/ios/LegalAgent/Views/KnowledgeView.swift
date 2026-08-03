import SwiftUI

// MARK: - Knowledge View
struct KnowledgeView: View {
    @StateObject private var viewModel = KnowledgeViewModel()
    @State private var searchText = ""
    @State private var selectedCategory = "all"
    @State private var showSearchBar = false

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                TextField("搜索法律法规、案例...", text: $searchText, onCommit: performSearch)
                    .textFieldStyle(.plain)
                if !searchText.isEmpty {
                    Button(action: { searchText = ""; viewModel.results = [] }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding(12)
            .background(Color(.systemGray6))
            .cornerRadius(10)
            .padding(.horizontal)
            .padding(.top, 12)

            // Category chips
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(knowledgeCategories) { category in
                        Button(action: { selectedCategory = category.name; performSearch() }) {
                            HStack {
                                Image(systemName: category.icon)
                                    .font(.caption)
                                Text(category.name)
                                    .font(.caption)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(selectedCategory == category.name ? Color.blue : Color(.systemGray5))
                            .foregroundColor(selectedCategory == category.name ? .white : .primary)
                            .cornerRadius(16)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.top, 12)
            }

            // Results
            if viewModel.isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .blue))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = viewModel.errorMessage {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 40))
                        .foregroundColor(.orange)
                    Text("搜索失败")
                        .font(.headline)
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Button("重试") { performSearch() }
                        .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.results.isEmpty && !searchText.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 40))
                        .foregroundColor(.secondary)
                    Text("未找到相关法规")
                        .font(.headline)
                    Text("请尝试其他关键词")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.results.isEmpty {
                EmptyKnowledgeView()
            } else {
                List(viewModel.results) { result in
                    KnowledgeResultRow(result: result)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("法律知识")
        .navigationBarTitleDisplayMode(.large)
    }

    private func performSearch() {
        viewModel.search(query: searchText, category: selectedCategory == "all" ? nil : selectedCategory)
    }
}

// MARK: - Knowledge Result Row
struct KnowledgeResultRow: View {
    let result: KnowledgeResult

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(result.title)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                Text("\(result.relevancePercentage)%")
                    .font(.caption)
                    .foregroundColor(.blue)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(4)
            }

            Text(result.content)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .lineLimit(2)

            HStack {
                if let category = result.category {
                    Text(category)
                        .font(.caption)
                        .foregroundColor(.blue)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(4)
                }
                Spacer()
                Text(result.citation)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Empty Knowledge View
struct EmptyKnowledgeView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "book.closed")
                .font(.system(size: 50))
                .foregroundColor(.secondary)
            Text("法律知识库")
                .font(.headline)
            Text("输入关键词搜索法律法规、案例和司法解释")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Preview
struct KnowledgeView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            KnowledgeView()
        }
    }
}
