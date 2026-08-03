# Legal Agent Android

法律智能体 Android 原生应用。

## 项目简介

基于 Kotlin + Jetpack Compose 构建的 Android 原生应用，提供法律咨询问答、案例分析和知识库功能，采用 Material3 设计语言。

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | Kotlin |
| UI 框架 | Jetpack Compose |
| 设计语言 | Material Design 3 |
| 网络请求 | Retrofit + OkHttp |
| 异步处理 | Kotlin Coroutines |
| 依赖注入 | Hilt (Dagger) |
| 状态管理 | ViewModel + StateFlow |
| 数据持久化 | DataStore |
| 图片加载 | Coil |
| Gradle | 8.2 |
| 编译 SDK | 34 |
| 最低 SDK | 24 (Android 7.0) |

## 快速开始

1. 使用 Android Studio（推荐 Flamingo 或更高版本）打开项目
2. 等待 Gradle 同步完成
3. 修改 `app/src/main/java/com/sapiensai/legalagent/util/Constants.kt` 中的 API 地址
4. 连接设备或启动模拟器，点击运行

## 目录结构

```
android/
├── app/
│   ├── src/main/
│   │   ├── java/com/sapiensai/legalagent/
│   │   │   ├── LegalAgentApp.kt       # Application 类
│   │   │   ├── ui/
│   │   │   │   └── MainActivity.kt    # 主 Activity
│   │   │   ├── repository/            # 数据层
│   │   │   │   ├── AuthRepository.kt
│   │   │   │   ├── ChatRepository.kt
│   │   │   │   ├── AnalysisRepository.kt
│   │   │   │   └── KnowledgeRepository.kt
│   │   │   ├── viewmodel/             # ViewModel 层
│   │   │   │   ├── AuthViewModel.kt
│   │   │   │   ├── ChatViewModel.kt
│   │   │   │   ├── AnalysisViewModel.kt
│   │   │   │   ├── KnowledgeViewModel.kt
│   │   │   │   └── ProfileViewModel.kt
│   │   │   └── util/                  # 工具类
│   │   │       ├── Constants.kt
│   │   │       ├── DateUtils.kt
│   │   │       └── NetworkUtils.kt
│   │   ├── res/
│   │   │   ├── values/
│   │   │   │   ├── colors.xml
│   │   │   │   ├── strings.xml
│   │   │   │   └── themes.xml
│   │   │   └── xml/
│   │   │       └── network_security_config.xml
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts
├── gradle/wrapper/
│   └── gradle-wrapper.properties
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```

## 构建说明

```bash
# Debug 构建
./gradlew assembleDebug

# Release 构建（需配置签名）
./gradlew assembleRelease

# 仅构建 app 模块
./gradlew :app:assembleDebug
```

## 签名发布说明

在 `app/build.gradle.kts` 中添加签名配置：

```kts
android {
    signingConfigs {
        create("release") {
            storeFile = file("../keystore.jks")
            storePassword = System.getenv("KEYSTORE_PASSWORD") ?: ""
            keyAlias = System.getenv("KEY_ALIAS") ?: ""
            keyPassword = System.getenv("KEY_PASSWORD") ?: ""
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}
```

使用环境变量或 `local.properties` 管理密钥信息，不要将密钥文件提交到版本控制。
