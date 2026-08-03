# Legal Agent Taro

法律智能体跨端应用（Taro v3）。

## 项目简介

基于 Taro v3 框架的跨端应用，一套代码同时支持 H5、微信小程序等多端运行。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Taro v3.6 |
| UI 框架 | React 18 |
| 样式 | SCSS |
| 状态管理 | Zustand |
| 类型检查 | TypeScript 5 |

## 快速开始

```bash
# 安装依赖
npm install

# H5 开发模式
npm run dev:h5

# 微信小程序开发模式
npm run dev:weapp

# H5 生产构建
npm run build:h5

# 微信小程序生产构建
npm run build:weapp
```

## 多端构建命令

| 命令 | 说明 |
|------|------|
| `npm run dev:h5` | H5 开发 |
| `npm run build:h5` | H5 生产构建 |
| `npm run dev:weapp` | 微信小程序开发 |
| `npm run build:weapp` | 微信小程序生产构建 |
| `npm run dev:rn` | React Native 开发 |
| `npm run build:rn` | React Native 生产构建 |
| `npm run build:alipay` | 支付宝小程序构建 |
| `npm run build:jd` | 京东小程序构建 |

## 目录结构

```
taro/
├── config/
│   └── index.ts           # Taro 配置
├── src/
│   ├── components/        # 公共组件
│   │   ├── LoadingSkeleton.tsx
│   │   └── MessageBubble.tsx
│   ├── pages/             # 页面
│   │   ├── analysis/
│   │   ├── chat/
│   │   ├── knowledge/
│   │   ├── login/
│   │   ├── profile/
│   │   └── index.tsx
│   ├── services/          # API 服务
│   │   └── api.ts
│   ├── stores/            # 状态管理
│   │   ├── auth.ts
│   │   └── chat.ts
│   ├── styles/            # 样式文件
│   │   ├── common.scss
│   │   └── variables.scss
│   ├── app.config.ts      # 页面路由配置
│   └── app.tsx            # 应用入口
├── package.json
└── taro.config.ts
```

## 配置说明

Taro 配置位于 `config/index.ts`：

```ts
export default defineConfig(async () => ({
  compiler: 'typescript',
  framework: 'react',
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    router: { mode: 'history' },
  },
}))
```

页面路由在 `src/app.config.ts` 中配置。
