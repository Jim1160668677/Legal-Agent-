# 子项目 A:后端 + Web 全功能国内云正式上线 — 设计文档

- 日期:2026-08-07
- 状态:已评审(设计评审通过,待写实施计划)
- 范围:`子项目 A`(部署/上线/合规/运维),不含小程序(B)与移动端(C)

## 1. 背景与目标

legal-agent 后端已完整开发(1293 单测全绿),Web 前端已在 Vercel 验证构建链可用。
本子项目把「后端 + Web」交付为**国内云正式上线版本**:
- 部署到国内云 ECS + 已备案域名,国内访问快、合规
- 全功能可用:登录/对话/文书生成/知识库/律师审核/视觉识别
- 含运维闭环:监控告警/结构化日志/自动备份/安全加固/发布回滚
- 交付上线文档与合规页面

## 2. 部署拓扑(方案 1:单机 Docker Compose 全栈)

```
用户浏览器 ─443/HTTPS/备案域名─► ECS
                                    └─ Nginx 容器(唯一对外):
                                        ├─ /     → web/dist 静态前端
                                        ├─ /v1/* → 反代 app:3000
                                        └─ HTTPS 证书(Let's Encrypt 自动续期)
                                    └─ app 容器(NestJS, 非 root, 3000)
                                        ├─ mongo(仅 docker 内网)
                                        └─ redis(仅 docker 内网+密码)
```

- Nginx 是唯一对外暴露入口;**app/mongo/redis 不再映射宿主端口**
- Web 前端与 API 同源(相对路径),无 CORS 跨域问题
- 单机单点,以「自动备份 + 快速重建脚本」兜底

## 3. 基础设施与架构决策

| 项 | 决策 |
|----|------|
| 部署方式 | ECS 内 Docker Compose;单机 |
| 前端 | web/dist(构建产物)由 Nginx 托管 |
| 数据库 | Docker 内自建 mongo 7 / redis 7(认证 + 内网) |
| HTTPS | Let's Encrypt certbot,自动续期 |
| 备份 | mongodump 每日 → 本机 + OSS/COS 留存 30 天;redis AOF+快照 |
| 监控 | ECS 云监控 + 外部 uptime 探活;pino JSON 日志落盘轮转 |
| 发布 | ECS 本地脚本(deploy/rollback/backup/restore),镜像 tag 版本化 |
| 凭据 | .env.prod 注入(不入 git);JWT/Mongo/Redis 生产强密码 |

## 4. 安全加固清单

1. compose 去掉 `27017:27017` / `6379:6379` 公网映射,mongo/redis 仅内部 `expose`
2. Redis 加 `--requirepass`;Mongo 内建认证;连接串带 auth
3. 生产 JWT_SECRET ≥48 字符随机;Mongo/Redis 密码独立生成
4. mongo 容器内 `mongod --bind_ip 127.0.0.1`
5. 云安全组仅放行 443(及 SSH 22 限来源 IP)
6. Nginx 配置安全头中复用(参考 vercel.json 的 nosniff/X-Frame-Options),限流(rate-limit)可在 Nginx 层兜底
7. 应用已具备:helmet、ValidationPipe、白名单 JWT、traceId、Swagger prod 关闭 —保留
8. 密钥轮换:运维手册给出 JWT/Mongo/Redis 密钥轮换步骤

## 5. 备份与恢复

- 每日 02:00 备份容器触发 `mongodump` → `/data/backups/<UTC日期>` → 同步 OSS/COS(保留 30 天)
- redis `appendonly yes` + `SAVE 60 1000`
- `restore.sh` 手册:`mongorestore` 到临时库→校验→切换
- 每周自动 `--dryRun` 校验归档;上线前做一次「删库恢复演练」并留档

## 6. 监控与告警

- `/health`(存活)外部探活:Uptime Kuma/UptimeRobot 每小时
- `/health/ready`(就绪,依赖 mongo+redis)供 Nginx 摘流
- ECS 云监控:CPU/内存/磁盘/带宽阈值告警到手机
- 日志:pino JSON 落盘 + `logrotate`(30 天)+ ERROR/CRITICAL 关键词告警
- 告警通道:对接手机/企业微信/钉钉(任选)

## 6. Web 前端交付

- 用 @legal-agent/sdk 构建 web(已验证);产物 7.4MB/464KB gzip
- Nginx 镜像内置 web/dist 与配置(配置/证书文件入卷,避免漂移)
- Nginx gzip + 静态 cache-control
- 新增合规页面:用户协议 / 隐私政策 / AI 免责声明;登录注册需勾选「同意」方可使用

## 7. 发布流程

```
git pull → docker build 打 tag legal-agent:{V} → compose 拉起
        → 构建 web/dist → nginx reload
        → 健康断言(python /health,/health/ready)通过
        → 失败则 rollback.sh 回退上一 tag
```
- `deploy.sh` / `rollback.sh` / `backup.sh` / `restore.sh` / `.env.production.example`
- 数据初始化:法律知识库(31 条法条)+ 管理员账号创建脚本

## 8. 文档交付

1. `DEPLOYMENT.md` 增补:生产要求/防火墙/备案步骤
2. `docs/OPS_GUIDE.md` 运维手册
3. `docs/GO_LIVE_CHECKLIST.md` 上线自检清单
4. `docs/PRIVACY.md` 隐私政策要旨 + Web 页面
5. 备份策略 + 恢复演练记录(存档)

## 9. 上线验收(Done 定义)

- 全功能冒烟:登录/对话/文书/知识库/律师审核/视觉 全绿(真实线上)
- HTTPS 可达、/health 与 /health/ready 通过
- 备份任务至少一次成功、告警通道已通、恢复演练完成
- 文档四件套 + 登录注册勾选协议生效

## 10. 非目标(由 B、C 承接)

- 微信小程序上架、Android/iOS/HarmonyOS 打包与商店审核
- 多租户/计费/合规审计(app 为先)