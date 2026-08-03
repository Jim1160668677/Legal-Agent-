# Legal Agent - Multi-Platform Client Development

## 📁 Project Structure

```
各版本/
├── README.md                    # Main documentation & navigation
├── DEPLOYMENT.md               # Deployment guide for all platforms
├── VERSION_CONTROL.md          # Git workflow & release management
├── common/
│   ├── API_SPECIFICATION.md    # Unified API contract (all platforms)
│   ├── UI_GUIDELINES.md       # Design system & UX standards
│   └── sdk/
│       ├── package.json        # SDK package config
│       └── src/
│           └── index.ts        # TypeScript SDK (shared across all clients)
│
├── web/                        # Web application (React + Vite)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── components/
│       │   └── Layout.tsx
│       ├── pages/
│       │   ├── Login.tsx
│       │   ├── Chat.tsx
│       │   ├── CaseAnalysis.tsx
│       │   ├── Knowledge.tsx
│       │   └── Profile.tsx
│       └── stores/
│           ├── authStore.ts
│           └── chatStore.ts
│
├── taro/                       # Taro cross-platform framework
│   ├── package.json
│   ├── taro.config.ts
│   └── src/
│       ├── app.tsx
│       └── pages/
│           └── index.tsx
│
├── wechat-miniapp/             # WeChat Mini Program
│   ├── project.config.json
│   ├── app.ts
│   └── pages/
│       └── chat/
│           └── chat.ts
│
├── android/                    # Android native (Kotlin + Jetpack Compose)
│   └── app/
│       ├── build.gradle.kts
│       └── src/main/java/com/sapiensai/legalagent/
│           ├── MainActivity.kt
│           └── data/remote/
│               └── LegalAgentApi.kt
│
├── ios/                        # iOS native (Swift + SwiftUI)
│   ├── LegalAgent.podspec
│   └── LegalAgent/
│       ├── App/
│       │   └── LegalAgentApp.swift
│       └── Core/API/
│           └── Client.swift
│
└── harmonyos/                  # HarmonyOS native (ArkTS)
    └── entry/src/main/
        ├── config.json
        └── ets/
            ├── entryability/
            │   └── EntryAbility.ets
            ├── pages/index/
            │   └── Index.ets
            └── sdk/
                └── LegalAgentSDK.ets
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- Android Studio (for Android builds)
- Xcode 14+ (for iOS builds)
- DevEco Studio (for HarmonyOS builds)
- WeChat Developer Tools (for Mini Program)

### Quick Start

#### 1. Web Version
```bash
cd 各版本/web
npm install
npm run dev      # Start development server
npm run build    # Build for production
```

#### 2. Taro Cross-Platform
```bash
cd 各版本/taro
npm install
npm run dev:h5      # H5 version
npm run dev:weapp   # WeChat Mini Program
```

#### 3. Android
```bash
cd 各版本/android
./gradlew assembleDebug
# APK generated in app/build/outputs/apk/debug/
```

#### 4. iOS
```bash
cd 各版本/ios
pod install
open LegalAgent.xcworkspace
# Build and run from Xcode
```

#### 5. HarmonyOS
```bash
cd 各版本/harmonyos
# Open in DevEco Studio and build
```

## 📋 API Configuration

All clients connect to the backend via the unified API. Update the base URL in each platform:

| Platform | Config File | Key Variable |
|----------|-------------|--------------|
| Web | `.env` | `VITE_API_BASE_URL` |
| Taro | `src/config/index.ts` | `API_BASE_URL` |
| WeChat | `app.ts` | `apiBaseUrl` |
| Android | `LegalAgentApi.kt` | `BASE_URL` |
| iOS | `Client.swift` | `baseURL` |
| HarmonyOS | `LegalAgentSDK.ets` | `baseUrl` |

## 🔧 Environment Variables

Create `.env` files in each platform directory:

```env
# .env (Web/Taro)
VITE_API_BASE_URL=https://api.legal-agent.com
VITE_APP_VERSION=1.0.0
```

## 📱 Publishing Checklist

### Web
- [ ] Build production bundle
- [ ] Deploy to CDN/Server
- [ ] Configure HTTPS
- [ ] Add favicon and meta tags
- [ ] Test on multiple browsers

### WeChat Mini Program
- [ ] Register developer account
- [ ] Fill app info in `project.config.json`
- [ ] Build with production settings
- [ ] Upload to WeChat for review
- [ ] Submit for approval

### Android
- [ ] Generate signing key
- [ ] Configure release build
- [ ] Create listing in Play Console
- [ ] Upload APK/AAB
- [ ] Submit for review

### iOS
- [ ] Configure Apple Developer account
- [ ] Set up provisioning profiles
- [ ] Archive and upload to App Store Connect
- [ ] Fill app store listing
- [ ] Submit for review

### HarmonyOS
- [ ] Register on Huawei Developer Alliance
- [ ] Configure signing certificate
- [ ] Build HAP file
- [ ] Submit to AppGallery
- [ ] Monitor review status

## 🔗 Related Documentation

- [API Specification](common/API_SPECIFICATION.md)
- [UI Guidelines](common/UI_GUIDELINES.md)
- [Version Control](VERSION_CONTROL.md)
- [Deployment Guide](DEPLOYMENT.md)
