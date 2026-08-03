# Legal Agent Web

法律智能体网页端应用。

## 项目简介

基于 React + Vite + Zustand 构建的法律智能体 Web 应用，提供法律咨询问答、案例分析和法律知识库等功能。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18 |
| 构建工具 | Vite 5 |
| 状态管理 | Zustand |
| 路由 | React Router v6 |
| UI 组件 | Ant Design 5 |
| HTTP 客户端 | Axios |
| 测试 | Vitest + Testing Library |
| 类型检查 | TypeScript 5 |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 类型检查
npm run type-check

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 目录结构

```
web/
├── src/
│   ├── components/        # 公共组件
│   │   ├── ChatList.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── LawCitation.tsx
│   │   ├── Layout.tsx
│   │   └── Skeleton.tsx
│   ├── pages/             # 页面组件
│   │   ├── CaseAnalysis.tsx
│   │   ├── Chat.tsx
│   │   ├── Knowledge.tsx
│   │   ├── Login.tsx
│   │   └── Profile.tsx
│   ├── stores/            # Zustand 状态管理
│   │   ├── authStore.ts
│   │   └── chatStore.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## API 配置说明

API 基础地址通过 Vite 环境变量配置：

```ts
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'YOUR_API_BASE_URL',
        changeOrigin: true,
      },
    },
  },
})
```

或通过 `.env` 文件配置：

```
VITE_API_BASE_URL=https://api.example.com
```

## 构建部署说明

```bash
# 生产构建，输出到 dist/ 目录
npm run build

# 将 dist/ 目录部署到静态服务器（Nginx、Vercel、Netlify 等）
# Nginx 示例：
# location / {
#   root   /var/www/legal-agent-web;
#   index  index.html;
#   try_files $uri $uri/ /index.html;
# }
```
