# Vercel 部署脚本 - Legal Agent
# 用法：.\scripts\deploy-vercel.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Legal Agent - Vercel 部署脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Vercel CLI
Write-Host "[1/5] 检查 Vercel CLI..." -ForegroundColor Yellow
try {
    $vercelVersion = npx vercel --version 2>&1
    Write-Host "  Vercel CLI 版本: $vercelVersion" -ForegroundColor Green
} catch {
    Write-Host "  错误: Vercel CLI 未安装" -ForegroundColor Red
    Write-Host "  请运行: npm install -g vercel" -ForegroundColor Yellow
    exit 1
}

# 检查登录状态
Write-Host ""
Write-Host "[2/5] 检查登录状态..." -ForegroundColor Yellow
try {
    $user = npx vercel whoami 2>&1
    Write-Host "  已登录: $user" -ForegroundColor Green
} catch {
    Write-Host "  需要登录 Vercel" -ForegroundColor Yellow
    Write-Host "  正在打开登录页面..." -ForegroundColor Cyan
    npx vercel login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  登录失败" -ForegroundColor Red
        exit 1
    }
}

# 检查环境变量
Write-Host ""
Write-Host "[3/5] 检查环境变量..." -ForegroundColor Yellow
$requiredVars = @("MONGO_URI", "REDIS_URL", "JWT_SECRET", "AGNES_API_KEY", "PII_ENCRYPTION_KEY")
$missingVars = @()

foreach ($var in $requiredVars) {
    $value = [Environment]::GetEnvironmentVariable($var, "Process")
    if (-not $value) {
        $missingVars += $var
        Write-Host "  [警告] 未设置: $var" -ForegroundColor Red
    } else {
        Write-Host "  [OK] $var" -ForegroundColor Green
    }
}

if ($missingVars.Count -gt 0) {
    Write-Host ""
    Write-Host "  缺少必要的环境变量！" -ForegroundColor Red
    Write-Host "  你需要在 Vercel 控制台设置这些变量：" -ForegroundColor Yellow
    Write-Host "  1. 登录 https://vercel.com"
    Write-Host "  2. 创建项目后，进入 Settings -> Environment Variables"
    Write-Host "  3. 添加以下变量："
    foreach ($var in $missingVars) {
        Write-Host "     - $var"
    }
}

# 确认继续
Write-Host ""
Write-Host "[4/5] 准备部署..." -ForegroundColor Yellow
Write-Host "  是否继续？(Y/N)"
$confirm = Read-Host
if ($confirm -ne "Y") {
    Write-Host "  部署已取消" -ForegroundColor Yellow
    exit 0
}

# 执行部署
Write-Host ""
Write-Host "[5/5] 执行部署..." -ForegroundColor Yellow
Write-Host "  首次部署会要求你确认项目配置..." -ForegroundColor Cyan
Write-Host ""

npx vercel --prod

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  部署成功！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  下一步：" -ForegroundColor Yellow
    Write-Host "  1. 在 Vercel 控制台添加环境变量"
    Write-Host "  2. 重新部署以使环境变量生效"
    Write-Host "  3. 访问你的应用 URL 进行测试"
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "  部署失败，请检查错误信息" -ForegroundColor Red
    exit 1
}
