import SwiftUI

// MARK: - Launch Screen View
struct LaunchScreenView: View {
    @State private var showContent = false

    var body: some View {
        ZStack {
            Color.blue.ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "scale.3d")
                    .font(.system(size: 80))
                    .foregroundColor(.white)
                Text("法律智能体")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                Text("AI 驱动的法律咨询助手")
                    .font(.subheadline)
                    .foregroundColor(.white.opacity(0.8))
            }
        }
        .opacity(showContent ? 1 : 0)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.5)) { showContent = true }
        }
    }
}

// MARK: - Preview
struct LaunchScreenView_Previews: PreviewProvider {
    static var previews: some View {
        LaunchScreenView()
    }
}
