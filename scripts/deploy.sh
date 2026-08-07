#!/bin/bash
# deploy.sh — legal-agent 生产部署脚本（Unix bash 版）
#
# 用法:
#   ./scripts/deploy.sh --domain legal.example.com [--tag v0.1.0]
#
# 前置条件:
#   - Docker + Docker Compose 已安装
#   - .env.prod 存在于脚本运行目录
#   - 证书已申请并放置在 /opt/legal-agent/certs/

set -euo pipefail

# ===== 参数解析 =====
DOMAIN=""
TAG=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
    echo "Usage: $0 --domain <DOMAIN> [--tag <TAG>]"
    echo ""
    echo "Options:"
    echo "  --domain  生产域名（必填）"
    echo "  --tag     镜像版本号，默认 git HEAD hash"
    echo "  -h, --help  显示帮助"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --domain) DOMAIN="$2"; shift 2 ;;
        --tag)    TAG="$2";    shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

if [[ -z "$DOMAIN" ]]; then
    echo "Error: --domain is required"
    usage
fi

if [[ -z "$TAG" ]]; then
    TAG=$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
fi

echo "=========================================="
echo " legal-agent 生产部署"
echo " Domain: $DOMAIN"
echo " Tag:    $TAG"
echo "=========================================="

# ===== 前置检查 =====
check_prerequisites() {
    echo "[1/6] 检查前置条件..."

    if ! command -v docker &>/dev/null; then
        echo "Error: docker 未安装"
        exit 1
    fi

    if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null; then
        echo "Error: docker-compose 未安装"
        exit 1
    fi

    if [[ ! -f "${PROJECT_DIR}/.env.prod" ]]; then
        echo "Error: .env.prod 不存在，请在 ${PROJECT_DIR}/ 下创建"
        exit 1
    fi

    if [[ ! -d "${PROJECT_DIR}/certs" ]]; then
        echo "Warning: certs 目录不存在，nginx 容器将使用默认自签名证书"
    fi

    echo "  [OK] 前置条件检查通过"
}

# ===== 构建镜像 =====
build_image() {
    echo "[2/6] 构建后端镜像 legal-agent:${TAG}..."
    docker build -t "legal-agent:${TAG}" "${PROJECT_DIR}"
    echo "  [OK] 镜像构建完成"
}

# ===== 构建 Web 前端 =====
build_web() {
    echo "[3/6] 检查 Web 前端构建..."
    local WEB_DIST="${PROJECT_DIR}/各版本/web/dist"

    if [[ ! -d "${WEB_DIST}" ]] || [[ -z "$(ls -A "${WEB_DIST}" 2>/dev/null)" ]]; then
        echo "  Web 未构建，开始构建..."
        cd "${PROJECT_DIR}/各版本/web"
        npm install --legacy-peer-deps
        npm run build
        echo "  [OK] Web 前端构建完成"
    else
        echo "  [OK] Web 前端已构建，跳过"
    fi
}

# ===== 停止旧服务 =====
stop_services() {
    echo "[4/6] 停止旧服务..."
    docker compose -f "${PROJECT_DIR}/docker-compose.yml" down app nginx 2>/dev/null || true
    echo "  [OK] 旧服务已停止"
}

# ===== 启动服务 =====
start_services() {
    echo "[5/6] 启动服务..."

    # 启动基础服务（mongo + redis）
    docker compose -f "${PROJECT_DIR}/docker-compose.yml" up -d --no-recreate mongo redis
    echo "  [OK] mongo + redis 已启动"

    # 等待数据库就绪
    echo "  等待数据库就绪（10s）..."
    sleep 10

    # 启动应用和 nginx
    docker compose -f "${PROJECT_DIR}/docker-compose.yml" up -d --force-recreate app nginx
    echo "  [OK] app + nginx 已启动"
}

# ===== 健康检查 =====
health_check() {
    echo "[6/6] 健康检查..."

    local MAX_RETRIES=5
    local RETRY=0
    local HEALTH_URL="https://${DOMAIN}/health"
    local READY_URL="https://${DOMAIN}/health/ready"

    while [[ $RETRY -lt $MAX_RETRIES ]]; do
        RETRY=$((RETRY + 1))
        echo "  尝试 ${RETRY}/${MAX_RETRIES}: ${HEALTH_URL}"

        # liveness 检查（宿主机 curl）
        HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "${HEALTH_URL}" 2>/dev/null || echo "000")

        if [[ "$HTTP_CODE" == "200" ]]; then
            echo "  [OK] liveness 检查通过 (HTTP ${HTTP_CODE})"

            # readiness 检查
            READY_BODY=$(curl -sf "${READY_URL}" 2>/dev/null || echo "")
            if echo "$READY_BODY" | grep -q '"status":"ready"'; then
                echo "  [OK] readiness 检查通过"
                echo ""
                echo "=========================================="
                echo " 部署成功！"
                echo "  Domain: ${DOMAIN}"
                echo "  Tag:    ${TAG}"
                echo "=========================================="
                return 0
            else
                echo "  [WARN] readiness 检查未通过: ${READY_BODY}"
            fi
        else
            echo "  [FAIL] liveness 检查失败 (HTTP ${HTTP_CODE})"
        fi

        if [[ $RETRY -lt $MAX_RETRIES ]]; then
            echo "  重试中...（${MAX_RETRIES - RETRY} 次剩余）"
            sleep 5
        fi
    done

    echo ""
    echo "=========================================="
    echo " 健康检查失败，请查看日志："
    echo "   docker compose -f ${PROJECT_DIR}/docker-compose.yml logs app nginx"
    echo "=========================================="
    exit 1
}

# ===== 主流程 =====
main() {
    check_prerequisites
    build_image
    build_web
    stop_services
    start_services
    health_check
}

main
