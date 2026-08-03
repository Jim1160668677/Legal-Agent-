import SwiftUI

// MARK: - Law Citation View Component
struct LawCitationView: View {
    let citations: [LawCitation]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(citations) { citation in
                    CitationTag(citation: citation)
                }
            }
        }
    }
}

struct CitationTag: View {
    let citation: LawCitation

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "scale.3d")
                .font(.caption2)
            Text(citation.lawName)
                .font(.caption2)
            Text(citation.article)
                .font(.caption2)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Color.blue.opacity(0.1))
        .foregroundColor(.blue)
        .cornerRadius(4)
    }
}

// MARK: - Session Card Component
struct SessionCard: View {
    let session: ChatSession
    let isSelected: Bool
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "message")
                .font(.title2)
                .foregroundColor(isSelected ? .white : .blue)
                .frame(width: 40, height: 40)
                .background(isSelected ? Color.blue : Color.blue.opacity(0.1))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(session.title ?? "新对话")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)
                Text(session.previewMessage ?? "暂无消息")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Text(session.timeAgo)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(isSelected ? Color.blue.opacity(0.1) : Color.clear)
        .cornerRadius(8)
    }
}

// MARK: - Loading Overlay
struct LoadingOverlay: View {
    let message: String

    var body: some View {
        ZStack {
            Color.black.opacity(0.3).ignoresSafeArea()
            VStack(spacing: 16) {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    .scaleEffect(1.5)
                Text(message)
                    .font(.body)
                    .foregroundColor(.white)
            }
            .padding()
            .background(Color.black.opacity(0.7))
            .cornerRadius(12)
        }
    }
}

// MARK: - Preview
struct MessageBubble_Previews: PreviewProvider {
    static var previews: some View {
        VStack {
            MessageBubble(ChatMessage(sessionId: "1", role: .user, content: "你好，我想咨询一下劳动合同的问题"))
            MessageBubble(ChatMessage(sessionId: "1", role: .assistant, content: "您好！关于劳动合同问题，我需要了解一些具体情况..."))
            TypingIndicator()
        }
        .padding()
    }
}
