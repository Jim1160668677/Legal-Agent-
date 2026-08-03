<#
.SYNOPSIS
    legal-agent 一键启动脚本（v2.3 阶段十）。
.DESCRIPTION
    完成以下步骤：
      1. 检查 Docker 是否可用
      2. docker compose up -d 启动 MongoDB + Redis
      3. 等待服务健康（最多 60 秒）
      4. 导入种子数据（法条 + 知识库，首次启动）
      5. 启动 NestJS 应用（npm run start:dev）
    支持参数跳过某些步骤，便于增量使用。
.PARAMETER SkipSeed
    跳过种子数据导入（已导入过时使用）。
.PARAMETER SkipApp
    仅启动基础设施，不启动应用（仅想跑容器时使用）。
.PARAMETER ImportOnly
    仅导入种子数据，不启动应用。
.EXAMPLE
    .\scripts\dev-start.ps1              # 完整启动
    .\scripts\dev-start.ps1 -SkipSeed    # 跳过种子导入
    .\scripts\dev-start.ps1 -ImportOnly  # 仅导入种子
#>
param(
    [switch]$SkipSeed,
    [switch]$SkipApp,
    [switch]$ImportOnly
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$msg) { Write-Host "`n[1] $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg)  { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg)   { Write-Host "  [X] $msg" -ForegroundColor Red }

# ===== Step 1: 检查 Docker =====
Write-Step '检查 Docker 环境...'
$dockerOk = $false
try {
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $dockerVersion) {
        Write-Ok "Docker Server v$dockerVersion"
        $dockerOk = $true
    }
} catch { }

if (-not $dockerOk) {
    Write-Err 'Docker 未运行或未安装。请先启动 Docker Desktop。'
    Write-Host '  下载：https://www.docker.com/products/docker-desktop'
    exit 1
}

# ===== Step 2: 启动 MongoDB + Redis =====
Write-Step '启动 MongoDB + Redis 容器...'
Push-Location $ProjectRoot
try {
    docker compose up -d 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'docker compose up 失败'
        exit 1
    }
    Write-Ok '容器已启动'
} finally {
    Pop-Location
}

# ===== Step 3: 等待服务健康 =====
Write-Step '等待服务健康...'
$maxWait = 60
$waited = 0
$mongoReady = $false
$redisReady = $false

while ($waited -lt $maxWait -and -not ($mongoReady -and $redisReady)) {
    Start-Sleep -Seconds 2
    $waited += 2

    if (-not $mongoReady) {
        $mongoResult = docker exec legal-mongo mongosh --quiet --eval 'db.adminCommand("ping").ok' 2>$null
        if ($mongoResult -eq '1') {
            $mongoReady = $true
            Write-Ok "MongoDB 就绪（${waited}s）"
        }
    }

    if (-not $redisReady) {
        $redisResult = docker exec legal-redis redis-cli ping 2>$null
        if ($redisResult -eq 'PONG') {
            $redisReady = $true
            Write-Ok "Redis 就绪（${waited}s）"
        }
    }

    if (-not ($mongoReady -and $redisReady)) {
        Write-Host "  等待中... ${waited}s / ${maxWait}s" -NoNewline
        Write-Host "`r" -NoNewline
    }
}

if (-not $mongoReady) { Write-Err 'MongoDB 未在 60s 内就绪'; exit 1 }
if (-not $redisReady) { Write-Err 'Redis 未在 60s 内就绪'; exit 1 }

# ===== Step 4: 导入种子数据 =====
if ($ImportOnly) {
    Write-Step '仅导入种子数据模式...'
    $SkipApp = $true
    $SkipSeed = $false
}

if (-not $SkipSeed) {
    Write-Step '导入种子法条数据...'
    Push-Location $ProjectRoot
    try {
        npm run import:law 2>&1 | ForEach-Object { Write-Host "  $_" }
        if ($LASTEXITCODE -eq 0) { Write-Ok '法条导入完成' } else { Write-Warn '法条导入失败（可能已导入）' }

        Write-Step '导入种子知识库数据...'
        npm run import:knowledge 2>&1 | ForEach-Object { Write-Host "  $_" }
        if ($LASTEXITCODE -eq 0) { Write-Ok '知识库导入完成' } else { Write-Warn '知识库导入失败（可能已导入）' }
    } finally {
        Pop-Location
    }
} else {
    Write-Warn '跳过种子数据导入（-SkipSeed）'
}

# ===== Step 5: 启动应用 =====
if ($SkipApp) {
    Write-Step '基础设施就绪（-SkipApp 已跳过应用启动）'
    Write-Host ''
    Write-Host '容器状态：' -ForegroundColor Cyan
    docker compose ps 2>&1 | ForEach-Object { Write-Host "  $_" }
    Write-Host ''
    Write-Host '手动启动应用：npm run start:dev' -ForegroundColor Gray
    exit 0
}

Write-Step '启动 NestJS 应用（npm run start:dev）...'
Write-Host '  按 Ctrl+C 停止应用；容器保持运行。' -ForegroundColor Gray
Write-Host ''

Push-Location $ProjectRoot
try {
    npm run start:dev
} finally {
    Pop-Location
}
