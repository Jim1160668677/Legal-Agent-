# app.json 未找到错误 调试报告 (2026-07-23)

## 根因
开发工具打开了错误目录 G:\智能体设计\legal-agent（后端TS项目），其根目录无 app.json，project.config.json 也无 miniprogramRoot 配置。
证据：错误提示 lib:3.17.0 与 legal-agent/project.private.config.json 的 libVersion 完全一致。
真正的小程序项目在 G:\智能体设计\Taro版，dist/app.json 完整有效（22页/5tab，JSON校验通过）。

## 逐步记录
1. 检查 app.json 存在性：legal-agent 根/子目录均无；Taro版/dist/app.json 存在
2. 读 project.config.json：legal-agent 无 miniprogramRoot（libVersion 3.17.0）；Taro版有 miniprogramRoot:dist/（libVersion 3.16.2）
3. JSON 校验：Taro版/dist/app.json 通过 ConvertFrom-Json，22 pages + tabBar 5 项
4. Taro 源码完整：src/app.config.ts + app.tsx + app.scss；构建命令 npm run build:weapp / dev:weapp

## 解决方案
方案A(推荐)：开发工具中关闭 legal-agent → 导入 G:\智能体设计\Taro版 → 自动读取 miniprogramRoot:dist/ 定位 app.json
方案B(辅助)：删除 legal-agent 下误配置的 project.config.json 与 project.private.config.json（后端项目不需要）
重新编译：cd G:\智能体设计\Taro版; npm run dev:weapp
