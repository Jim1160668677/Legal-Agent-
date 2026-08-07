<#
.SYNOPSIS
    legal-agent 生产部署脚本（Windows PowerShell 版）
.DESCRIPTION
    构建后端 Docker 镜像，构建 Web 前端，启动 Docker Compose 服务，
    执行宿主机健康检查。
.PARAMETER Domain
    生产域名（必填）
.PARAMETER Tag
    镜像版本号，默认使用 git HEAD hash
.EXAMPLE
    .\scripts\deploy.ps1 -Domain "legal.example.com" -Tag "v0.1.0"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "生产域名（必填）")]
    [string]$Domain,

    [Parameter(Mandatory = $false, HelpMessage = "镜像版本号，默认 git HEAD hash")]
    [string]$Tag = ""
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

# 获取 git hash 作为默认 tag
if (-not $Tag) {
    try {
        $Tag = & git -C $ProjectDir rev-parse --short HEAD 2>$null
        if (-not $Tag) { $Tag = "unknown" }
    } catch {
        $Tag = "unknown"
    }
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " legal-agent 生产部署" -ForegroundColor Cyan
Write-Host " Domain: $Domain" -ForegroundColor White
Write-Host " Tag:    $Tag" -ForegroundColor White
Write-Host "==========================================" -ForegroundColor Cyan

# ===== [1/6] 前置检查 =====
Write-Host "`n[1/6] 检查前置条件..." -ForegroundColor Yellow

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Error: docker 未安装" -ForegroundColor Red
    exit 1
}

if (-not (docker compose version 2>$null) -and -not (docker-compose version 2>$null)) {
    Write-Host "Error: docker-compose 未安装" -ForegroundColor Red
    exit 1
}

$envFile = Join-Path $ProjectDir ".env.prod"
if (-not (Test-Path $envFile)) {
    Write-Host "Error: .env.prod 不存在，请在 $ProjectDir 下创建" -ForegroundColor Red
    exit 1
}

$certsDir = Join-Path $ProjectDir "certs"
if (-not (Test-Path $certsDir)) {
    Write-Host "Warning: certs 目录不存在，nginx 容器将使用默认自签名证书" -ForegroundColor Yellow
}

Write-Host "  [OK] 前置条件检查通过" -ForegroundColor Green

# ===== [2/6] 构建镜像 =====
Write-Host "[2/6] 构建后端镜像 legal-agent:$Tag..." -ForegroundColor Yellow
docker build -t "legal-agent:$Tag" $ProjectDir
Write-Host "  [OK] 镜像构建完成" -ForegroundColor Green

# ===== [3/6] 构建 Web 前端 =====
Write-Host "[3/6] 检查 Web 前端构建..." -ForegroundColor Yellow
$webDist = Join-Path $ProjectDir "各版本\web\dist"

if (-not (Test-Path $webDist) -or -not (Get-ChildItem $webDist -ErrorAction SilentlyContinue)) {
    Write-Host "  Web 未构建，开始构建..." -ForegroundColor Yellow
    Set-Location (Join-Path $ProjectDir "各版本\web")
    npm install --legacy-peer-deps
    npm run build
    Write-Host "  [OK] Web 前端构建完成" -ForegroundColor Green
    Set-Location $ProjectDir
} else {
    Write-Host "  [OK] Web 前端已构建，跳过" -ForegroundColor Green
}

# ===== [4/6] 停止旧服务 =====
Write-Host "[4/6] 停止旧服务..." -ForegroundColor Yellow
docker compose -f (Join-Path $ProjectDir "docker-compose.yml") down app nginx 2>$null
Write-Host "  [OK] 旧服务已停止" -ForegroundColor Green

# ===== [5/6] 启动服务 =====
Write-Host "[5/6] 启动服务..." -ForegroundColor Yellow

docker compose -f (Join-Path $ProjectDir "docker-compose.yml") up -d --no-recreate mongo redis
Write-Host "  [OK] mongo + redis 已启动" -ForegroundColor Green

Write-Host "  等待数据库就绪（10s）..." -ForegroundColor Gray
Start-Sleep -Seconds 10

docker compose -f (Join-Path $ProjectDir "docker-compose.yml") up -d --force-recreate app nginx
Write-Host "  [OK] app + nginx 已启动" -ForegroundColor Green

# ===== [6/6] 健康检查 =====
Write-Host "[6/6] 健康检查..." -ForegroundColor Yellow

$MaxRetries = 5
$Retry = 0
$HealthUrl = "https://$Domain/health"
$ReadyUrl = "https://$Domain/health/ready"

while ($Retry -lt $MaxRetries) {
    $Retry++
    Write-Host "  尝试 ${Retry}/${MaxRetries}: $HealthUrl" -ForegroundColor Gray

    try {
        # liveness 检查（宿主机 Invoke-WebRequest）
        $Response = Invoke-WebRequest -Uri $HealthUrl -Method Get -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        $HttpCode = $Response.StatusCode

        if ($HttpCode -eq 200) {
            Write-Host "  [OK] liveness 检查通过 (HTTP $HttpCode)" -ForegroundColor Green

            # readiness 检查
            $ReadyBody = Invoke-RestMethod -Uri $ReadyUrl -Method Get -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
            if ($ReadyBody.data.status -eq "ready") {
                Write-Host "  [OK] readiness 检查通过" -ForegroundColor Green
                Write-Host ""
                Write-Host "==========================================" -ForegroundColor Cyan
                Write-Host " 部署成功！" -ForegroundColor Green
                Write-Host "  Domain: $Domain" -ForegroundColor White
                Write-Host "  Tag:    $Tag" -ForegroundColor White
                Write-Host "==========================================" -ForegroundColor Cyan
                exit 0
            } else {
                Write-Host "  [WARN] readiness 检查未通过: $($ReadyBody.data.status)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [FAIL] liveness 检查失败 (HTTP $HttpCode)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  [FAIL] liveness 检查异常: $($_.Exception.Message)" -ForegroundColor Red
    }

    if ($Retry -lt $MaxRetries) {
        Write-Host "  重试中...（$($MaxRetries - $Retry) 次剩余）" -ForegroundColor Gray
        Start-Sleep -Seconds 5
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Red
Write-Host " 健康检查失败，请查看日志：" -ForegroundColor Red
Write-Host "   docker compose -f $(Join-Path $ProjectDir 'docker-compose.yml') logs app nginx" -ForegroundColor Red
Write-Host "==========================================" -ForegroundColor Red
exit 1
