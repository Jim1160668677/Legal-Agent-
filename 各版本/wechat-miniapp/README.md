# Legal Agent 微信小程序

法律智能体微信小程序原生版本。

## 项目简介

基于微信小程序原生开发框架构建的法律智能体小程序，提供法律咨询、案例分析和知识库查询功能。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | 微信小程序原生 |
| 样式 | WXSS + 微信组件库 |
| 数据交互 | 原生 wx.request |
| 存储 | wx.setStorageSync / 本地存储 |

## 快速开始

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 打开微信开发者工具，选择**导入项目**
3. 项目目录选择 `g:\智能体设计\legal-agent\各版本\wechat-miniapp`
4. 填写 AppID（或使用测试号），点击**导入**
5. 在开发者工具中运行预览

## 目录结构

```
wechat-miniapp/
├── assets/
│   └── icons/             # 图标资源
├── pages/
│   ├── chat/              # 聊天页
│   │   ├── chat.wxml
│   │   ├── chat.wxss
│   │   ├── chat.ts
│   │   └── chat.json
│   ├── knowledge/         # 知识库页
│   ├── login/             # 登录页
│   └── profile/           # 个人中心页
├── utils/
│   ├── api.ts             # API 请求封装
│   └── storage.ts         # 本地存储封装
├── app.ts                 # 应用入口
├── app.json               # 全局配置
├── app.wxss               # 全局样式
├── project.config.json    # 项目配置
└── sitemap.json           # 索引配置
```

## 配置说明

编辑 `project.config.json`：

```json
{
  "appid": "YOUR_WECHAT_APPID",
  "projectname": "legal-agent-wechat",
  "miniprogramRoot": "dist/",
  "compileType": "miniprogram",
  "libVersion": "2.25.0"
}
```

将 `YOUR_WECHAT_APPID` 替换为实际的 AppID。

API 地址在 `utils/api.ts` 中配置：

```ts
const BASE_URL = 'https://api.example.com'
```

## 发布流程

1. 在[微信公众平台](https://mp.weixin.qq.com)完成小程序备案和审核
2. 在微信开发者工具中点击**上传**，填写版本号和项目备注
3. 登录微信公众平台，进入**版本管理**，提交审核
4. 审核通过后，点击**发布**上线
