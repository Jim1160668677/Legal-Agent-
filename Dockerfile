# syntax=docker/dockerfile:1.6
# legal-agent 多阶段 Dockerfile（Phase 2.7 / A5）
#
# 三阶段构建：
#   1. builder  —— 编译 TypeScript → dist/
#   2. deps     —— 安装生产依赖（node_modules）
#   3. runtime  —— 仅 dist + 生产 node_modules，非 root 运行
#
# 镜像大小目标：< 300MB
# 设计依据：DEPLOYMENT.md §本地全栈 docker-compose；Phase 2.10 验收「docker build 成功，<300MB」

# ===== Stage 1: builder =====
FROM node:20-alpine AS builder
WORKDIR /app

# 先复制 package*.json 利用层缓存
COPY package*.json ./
# 国内镜像加速（部署目标为国内云服务器；registry.npmjs.org 在国内极慢）
RUN npm config set registry https://registry.npmmirror.com
# 安装全部依赖（含 devDependencies，编译需要 tsc / @types/*）
# --legacy-peer-deps：@nestjs/testing@11 与 @nestjs/common@10 peer 冲突，本地 dev 也用此 flag
RUN npm ci --legacy-peer-deps

# 复制源码与 TS 配置（.dockerignore 已排除 node_modules / dist / .env）
COPY tsconfig.json ./
COPY src/ ./src/

# 编译输出到 dist/
RUN npm run build


# ===== Stage 2: deps（生产依赖独立层，便于复用缓存）=====
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# 国内镜像加速（与 builder 阶段一致）
RUN npm config set registry https://registry.npmmirror.com
# 仅安装生产依赖（--omit=dev 等价于旧 --production）
# --legacy-peer-deps：与 builder 阶段保持一致，避免 lockfile resolve 失败
RUN npm ci --omit=dev --legacy-peer-deps


# ===== Stage 3: runtime =====
FROM node:20-alpine AS runtime
WORKDIR /app

# 健康检查依赖：wget（alpine 默认自带 busybox wget，无需额外安装）
# 时区数据（法律场景对日期敏感，如诉讼时效计算）
RUN apk add --no-cache tzdata \
  && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo "Asia/Shanghai" > /etc/timezone \
  && apk del tzdata

# 创建非 root 用户（容器安全基线）
RUN addgroup -S app && adduser -S app -G app

# 从 deps 拷贝生产 node_modules
COPY --from=deps /app/node_modules ./node_modules
# 从 builder 拷贝编译产物
COPY --from=builder /app/dist ./dist
# package.json 供 npm run start 解析
COPY package.json ./

# 切换非 root 用户
USER app

# 运行时环境变量（可被 docker run --env 覆盖）
ENV NODE_ENV=prod \
    PORT=3000 \
    LOG_LEVEL=info

EXPOSE 3000

# 健康检查：liveness 用 /health（不依赖 mongo/redis，避免依赖抖动触发容器重启循环）
# readiness 探针由 SLB/K8s 外部配置（/health/ready），容器内只做 liveness
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# 启动命令
CMD ["node", "dist/main.js"]
