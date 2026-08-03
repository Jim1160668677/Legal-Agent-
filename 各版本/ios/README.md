# Legal Agent iOS

法律智能体 iOS 原生应用。

## 项目简介

基于 Swift + SwiftUI 构建的 iOS 原生应用，提供法律咨询问答、案例分析和知识库功能，遵循苹果 Human Interface Guidelines。

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | Swift 5.9+ |
| UI 框架 | SwiftUI |
| 状态管理 | Combine + @StateObject/@ObservedObject |
| 网络请求 | URLSession |
| 架构 | MVVM |
| 最低版本 | iOS 16.0 |

## 快速开始

1. 确保已安装 Xcode 15+ 和 CocoaPods
2. 进入项目目录，安装依赖：
   ```bash
   pod install
   ```
3. 打开工作区：
   ```bash
   open LegalAgent.xcworkspace
   ```
4. 选择目标设备或模拟器，点击运行

## 目录结构

```
ios/
├── LegalAgent/
│   ├── App/
│   │   └── LegalAgentApp.swift    # 应用入口
│   ├── Components/                # 公共组件
│   │   ├── LaunchScreen.swift
│   │   ├── LawCitationView.swift
│   │   └── MessageBubble.swift
│   ├── Core/
│   │   ├── API/
│   │   │   └── Client.swift       # API 客户端
│   │   ├── Models/                # 数据模型
│   │   │   ├── ChatMessage.swift
│   │   │   ├── ChatSession.swift
│   │   │   ├── AnalysisResult.swift
│   │   │   ├── KnowledgeResult.swift
│   │   │   ├── User.swift
│   │   │   └── ApiResponse.swift
│   │   └── ViewModels/            # ViewModel 层
│   │       ├── AuthViewModel.swift
│   │       ├── ChatViewModel.swift
│   │       ├── AnalysisViewModel.swift
│   │       ├── KnowledgeViewModel.swift
│   │       └── ProfileViewModel.swift
│   ├── Views/                     # 页面视图
│   │   ├── ContentView.swift
│   │   ├── ChatView.swift
│   │   ├── AnalysisView.swift
│   │   ├── KnowledgeView.swift
│   │   ├── LoginView.swift
│   │   └── ProfileView.swift
│   └── Resources/
│       ├── Assets.xcassets/
│       └── Info.plist
├── LegalAgent.podspec
└── Podfile
```

## API 配置说明

API 基础地址在 `Core/API/Client.swift` 中配置：

```swift
struct APIClient {
    static let baseURL = "https://api.example.com"
    // ...
}
```

或在 `Info.plist` 中配置：

```xml
<key>APIBaseURL</key>
<string>https://api.example.com</string>
```

## 构建发布说明

```bash
# 安装依赖
pod install

# 打开项目
open LegalAgent.xcworkspace
```

在 Xcode 中：
1. 选择目标设备或模拟器
2. 配置 Signing & Capabilities（需有效的 Apple Developer 账号）
3. 点击 Run 或 Product → Archive 进行归档发布

发布到 App Store：
1. 使用 **Product → Archive** 打包
2. 在 Xcode Organizer 中上传至 App Store Connect
3. 在 App Store Connect 中填写版本信息并提交审核
