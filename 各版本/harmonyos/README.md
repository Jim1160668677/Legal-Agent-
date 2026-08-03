# Legal Agent HarmonyOS

法律智能体 HarmonyOS 原生应用。

## 项目简介

基于 ArkTS + ArkUI 构建的 HarmonyOS 原生应用，提供法律咨询问答、案例分析和知识库功能，适配 default 和 tablet 设备。

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | ArkTS |
| UI 框架 | ArkUI |
| 最低 API | API Version 9 (HarmonyOS 2.0) |
| 目标 API | API Version 11 (HarmonyOS 4.0+) |
| 构建工具 | hvigor |

## 快速开始

1. 安装[DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/)
2. 打开 DevEco Studio，选择 **Open HarmonyOS Project**
3. 选择项目目录：`g:\智能体设计\legal-agent\各版本\harmonyos`
4. 连接设备或启动模拟器，点击运行

## 目录结构

```
harmonyos/
├── entry/
│   └── src/
│       └── main/
│           ├── ets/
│           │   ├── components/         # 公共组件
│           │   │   ├── CaseTypeSelector.ets
│           │   │   ├── LoadingSpinner.ets
│           │   │   ├── MessageBubble.ets
│           │   │   └── SearchBar.ets
│           │   ├── entryability/
│           │   │   └── EntryAbility.ets  # 应用入口
│           │   ├── models/             # 数据模型
│           │   │   ├── AnalysisResult.ets
│           │   │   ├── ChatMessage.ets
│           │   │   ├── ChatSession.ets
│           │   │   ├── KnowledgeResult.ets
│           │   │   └── User.ets
│           │   ├── pages/              # 页面
│           │   │   ├── index/Index.ets
│           │   │   ├── chat/Chat.ets
│           │   │   ├── analysis/Analysis.ets
│           │   │   ├── knowledge/Knowledge.ets
│           │   │   └── profile/Profile.ets
│           │   ├── sdk/
│           │   │   └── LegalAgentSDK.ets  # SDK 封装
│           │   └── utils/              # 工具类
│           │       ├── Constants.ets
│           │       ├── DateUtil.ets
│           │       └── Storage.ets
│           └── config.json             # 模块配置
```

## 构建说明

```bash
# 使用 hvigor 构建
npx hvigorw assembleHap --mode modules -m entry

# 清理构建产物
npx hvigorw clean
```

## 发布流程

1. 在[华为开发者联盟](https://developer.huawei.com/consumer/cn/)控制台创建应用
2. 获取 bundle ID 并在 `config.json` 中确认
3. 生成签名证书：
   - DevEco Studio → File → Project Structure → Signing
   - 选择自动签名或手动导入证书
4. 使用 **Product → Generate HAP/SID** 打包
5. 在 AppGallery Connect 提交审核上线
