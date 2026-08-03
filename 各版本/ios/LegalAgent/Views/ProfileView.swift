import SwiftUI

// MARK: - Profile View
struct ProfileView: View {
    @StateObject private var authViewModel = AuthViewModel()
    @StateObject private var profileViewModel = ProfileViewModel()
    @State private var showLogoutAlert = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // User card
                VStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(Color.blue.opacity(0.1))
                            .frame(width: 80, height: 80)
                        Image(systemName: "person.fill")
                            .font(.system(size: 36))
                            .foregroundColor(.blue)
                    }

                    VStack(spacing: 4) {
                        Text(profileViewModel.displayName)
                            .font(.title2)
                            .fontWeight(.bold)
                        Text(profileViewModel.userRole)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.vertical, 16)

                Divider()

                // Menu items
                VStack(spacing: 0) {
                    ProfileMenuItem(icon: "person.circle", title: "个人信息", subtitle: "查看和编辑个人资料")
                    ProfileMenuItem(icon: "doc.text", title: "我的案件", subtitle: "查看历史分析记录")
                    ProfileMenuItem(icon: "clock.arrow.circlepath", title: "对话历史", subtitle: "查看聊天历史")
                    ProfileMenuItem(icon: "book.fill", title: "收藏法规", subtitle: "查看收藏的法律条文")
                    ProfileMenuItem(icon: "gear", title: "设置", subtitle: "应用设置")
                }
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .padding(.horizontal)
                .shadow(radius: 2)

                // App info
                VStack(spacing: 8) {
                    Text("法律智能体 v1.0.0")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("基于 AI 的法律咨询服务")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 16)

                // Logout button
                Button(action: { showLogoutAlert = true }) {
                    HStack {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                        Text("退出登录")
                    }
                    .foregroundColor(.red)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(10)
                }
                .padding(.horizontal)
                .alert("确认退出", isPresented: $showLogoutAlert) {
                    Button("取消", role: .cancel) {}
                    Button("退出", role: .destructive) { handleLogout() }
                } message: {
                    Text("确定要退出登录吗？")
                }

                Spacer(minLength: 24)
            }
        }
        .navigationTitle("我的")
        .navigationBarTitleDisplayMode(.large)
        .onAppear {
            profileViewModel.loadUserProfile()
        }
    }

    private func handleLogout() {
        Task {
            await authViewModel.logout()
        }
    }
}

// MARK: - Profile Menu Item
struct ProfileMenuItem: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(.blue)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

// MARK: - Preview
struct ProfileView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            ProfileView()
        }
    }
}
