import SwiftUI

// MARK: - Login View
struct LoginView: View {
    @StateObject private var authViewModel = AuthViewModel()
    @State private var username = ""
    @State private var password = ""
    @State private var showPassword = false

    var body: some View {
        VStack(spacing: 24) {
            // Logo and title
            VStack(spacing: 12) {
                Image(systemName: "scale.3d")
                    .font(.system(size: 60))
                    .foregroundColor(.blue)
                    .frame(width: 100, height: 100)
                    .background(Color.blue.opacity(0.1))
                    .clipShape(Circle())

                Text("法律智能体")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("AI 驱动的法律咨询助手")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .padding(.top, 60)

            // Form
            VStack(spacing: 16) {
                // Username
                VStack(alignment: .leading, spacing: 8) {
                    Text("用户名")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    HStack {
                        Image(systemName: "person")
                            .foregroundColor(.secondary)
                        TextField("请输入用户名", text: $username)
                            .autocorrectionDisabled()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                    .background(Color(.systemGray6))
                    .cornerRadius(10)
                }

                // Password
                VStack(alignment: .leading, spacing: 8) {
                    Text("密码")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    HStack {
                        Image(systemName: "lock")
                            .foregroundColor(.secondary)
                        Group {
                            if showPassword {
                                TextField("请输入密码", text: $password)
                            } else {
                                SecureField("请输入密码", text: $password)
                            }
                        }
                        Button(action: { showPassword.toggle() }) {
                            Image(systemName: showPassword ? "eye.slash" : "eye")
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                    .background(Color(.systemGray6))
                    .cornerRadius(10)
                }
            }
            .padding(.horizontal, 32)

            // Error message
            if let error = authViewModel.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding(.horizontal, 32)
            }

            // Login button
            Button(action: handleLogin) {
                if authViewModel.isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                } else {
                    Text("登录")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.blue)
                        .cornerRadius(10)
                }
            }
            .disabled(authViewModel.isLoading)
            .padding(.horizontal, 32)

            Spacer()

            // Footer
            Text("登录即表示您同意我们的服务条款和隐私政策")
                .font(.caption2)
                .foregroundColor(.secondary)
                .padding(.bottom, 32)
        }
    }

    private func handleLogin() {
        Task {
            do {
                try await authViewModel.login(username: username, password: password)
            } catch {
                print("Login failed: \(error)")
            }
        }
    }
}

// MARK: - Preview
struct LoginView_Previews: PreviewProvider {
    static var previews: some View {
        LoginView()
    }
}
