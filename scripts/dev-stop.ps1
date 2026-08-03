<#
.SYNOPSIS
    legal-agent 停止脚本（v2.3 阶段十）。
.DESCRIPTION
    停止并清理容器（保留数据卷）。
.PARAMETER Clean
    同时删除数据卷（完全重置，下次启动重新导入种子数据）。
.EXAMPLE
    .\scripts\dev-stop.ps1          # 停止容器，保留数据
    .\scripts\dev-stop.ps1 -Clean   # 停止并删除数据卷
#>
param([switch]$Clean)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectRoot
try {
    if ($Clean) {
        Write-Host '[1] 停止容器并删除数据卷...' -ForegroundColor Cyan
        docker compose down -v 2>&1 | ForEach-Object { Write-Host "  $_" }
        Write-Host '  [OK] 容器已停止，数据卷已删除' -ForegroundColor Green
    } else {
        Write-Host '[1] 停止容器（保留数据卷）...' -ForegroundColor Cyan
        docker compose down 2>&1 | ForEach-Object { Write-Host "  $_" }
        Write-Host '  [OK] 容器已停止，数据已保留' -ForegroundColor Green
    }
} finally {
    Pop-Location
}
