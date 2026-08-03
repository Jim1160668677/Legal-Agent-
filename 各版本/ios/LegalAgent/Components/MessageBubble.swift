import SwiftUI

// MARK: - Message Bubble Component
struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .assistant {
                AvatarView(icon: "robot.fill", color: .blue)
                    .frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 6) {
                    Text(message.content)
                        .font(.body)
                        .foregroundColor(.primary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(16)
                    if let refs = message.references, !refs.isEmpty {
                        LawCitationView(citations: refs)
                    }
                }
            } else {
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text(message.content)
                        .font(.body)
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.blue)
                        .cornerRadius(16)
                    if let refs = message.references, !refs.isEmpty {
                        LawCitationView(citations: refs)
                    }
                }
                AvatarView(icon: "person.fill", color: .green)
                    .frame(width: 32, height: 32)
            }
        }
        .padding(.horizontal)
    }
}

// MARK: - Avatar View
struct AvatarView: View {
    let icon: String
    let color: Color

    var body: some View {
        Image(systemName: icon)
            .font(.title3)
            .foregroundColor(.white)
            .frame(width: 32, height: 32)
            .background(color)
            .clipShape(Circle())
    }
}

// MARK: - Typing Indicator Component
struct TypingIndicator: View {
    @State private var animate = false

    var body: some View {
        HStack(spacing: 8) {
            AvatarView(icon: "robot.fill", color: .blue)
                .frame(width: 32, height: 32)
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(.secondarySystemBackground))
                .frame(height: 36)
                .overlay(
                    HStack(spacing: 4) {
                        Circle()
                            .fill(Color.gray)
                            .frame(width: 8, height: 8)
                            .opacity(animate ? 1 : 0.4)
                            .animation(.easeInOut(duration: 0.6).repeatForever(), value: animate)
                        Circle()
                            .fill(Color.gray)
                            .frame(width: 8, height: 8)
                            .opacity(animate ? 0.4 : 1)
                            .animation(.easeInOut(duration: 0.6).delay(0.2).repeatForever(), value: animate)
                        Circle()
                            .fill(Color.gray)
                            .frame(width: 8, height: 8)
                            .opacity(animate ? 1 : 0.4)
                            .animation(.easeInOut(duration: 0.6).delay(0.4).repeatForever(), value: animate)
                    }
                )
                .onAppear { animate = true }
        }
        .padding(.horizontal)
    }
}

// MARK: - Input Bar Component
struct InputBar: View {
    @Binding var text: String
    let isLoading: Bool
    let onSend: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            TextField("输入您的问题...", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...4)
                .disabled(isLoading)
                .padding(10)
                .background(Color(.systemGray6))
                .cornerRadius(12)
            Button(action: onSend) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundColor(text.trimmingCharacters(in: .whitespaces).isEmpty || isLoading ? .gray : .blue)
            }
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(.systemBackground))
    }
}
