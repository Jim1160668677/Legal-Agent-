<#
.SYNOPSIS
    legal-agent 冒烟测试脚本（Phase 3 扩展）。
.DESCRIPTION
    验证全链路：
      Step 0: /health（liveness）
      Step 1: 登录拿 token
      Step 2: /v1/chat SSE 流式问答
      Step 3: /v1/reviews/queue 审核队列
      Step 4: /health/ready（readiness，mongo+redis 连通性）
      Step 5: /v1/non-existent → 404 统一信封
      Step 6: /v1/agents → 200 + AgentCard 列表
    前置条件：MongoDB + Redis 已启动，应用已启动（npm run start:dev 或 docker run）。
.EXAMPLE
    .\scripts\smoke-test.ps1
#>
$ErrorActionPreference = 'Stop'
$BaseUrl = 'http://localhost:3000'
$script:StepNo = 0

function Write-Step([string]$msg) {
    $script:StepNo++
    Write-Host "`n[$script:StepNo] $msg" -ForegroundColor Cyan
}
function Write-Ok([string]$msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Err([string]$msg)  { Write-Host "  [X] $msg" -ForegroundColor Red }
function Write-Warn([string]$msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

# ===== Step 0: 健康检查（liveness）=====
Write-Step '健康检查 GET /health（liveness）...'
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 10
    if ($health.status -eq 'ok' -or $health.data.status -eq 'ok') {
        Write-Ok "应用健康: $($health | ConvertTo-Json -Compress)"
    } else {
        Write-Err "健康检查异常: $($health | ConvertTo-Json -Compress)"
        exit 1
    }
} catch {
    Write-Err "应用未启动或 /health 不可达: $($_.Exception.Message)"
    Write-Host '  请先运行: npm run start:dev'
    exit 1
}

# ===== Step 1: 登录拿 token =====
Write-Step '登录 POST /v1/auth/login...'
$loginBody = @{ provider = 'phone'; externalId = '13800000001'; role = 'user' } | ConvertTo-Json
try {
    $loginResp = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/login" -Method Post -Body $loginBody -ContentType 'application/json' -TimeoutSec 15
    $token = $loginResp.data.accessToken
    if (-not $token) {
        Write-Err "登录失败，未返回 accessToken: $($loginResp | ConvertTo-Json -Compress)"
        exit 1
    }
    Write-Ok "登录成功，userId=$($loginResp.data.userId)"
} catch {
    Write-Err "登录失败: $($_.Exception.Message)"
    exit 1
}

$headers = @{ Authorization = "Bearer $token" }

# ===== Step 2: 对话问答（SSE 流式）=====
Write-Step '对话问答 POST /v1/chat（SSE 流式）...'
$chatBody = @{ message = '民法典第一百四十三条讲的是什么？' } | ConvertTo-Json

try {
    # -UseBasicParsing：PS 5.1 下避免 IE 引擎解析；RawContentStream 取原始字节再 UTF8 解码，修复中文乱码
    $response = Invoke-WebRequest -Uri "$BaseUrl/v1/chat" -Method Post -Body $chatBody -ContentType 'application/json' -Headers $headers -TimeoutSec 60 -UseBasicParsing
    # PS 5.1 的 Invoke-WebRequest 默认用 ISO-8859-1 解码无 charset 的响应体，SSE（text/event-stream）无 charset 导致中文乱码
    $bytes = $response.RawContentStream.ToArray()
    $content = [System.Text.Encoding]::UTF8.GetString($bytes)
    Write-Ok "HTTP $($response.StatusCode)，响应长度 $($content.Length) 字符"

    # 校验响应格式：SSE 应包含 event:/data: 前缀或统一信封
    if ($content -match 'event:' -or $content -match 'data:' -or $content -match '"code":0') {
        Write-Ok '响应格式校验通过（SSE 帧或统一信封）'
    } else {
        Write-Warn "响应格式非预期（前 200 字符）: $($content.Substring(0, [Math]::Min(200, $content.Length)))"
    }

    # 打印前 500 字符预览
    Write-Host "`n  --- 响应预览（前 500 字符）---" -ForegroundColor Gray
    $preview = $content.Substring(0, [Math]::Min(500, $content.Length))
    Write-Host $preview -ForegroundColor Gray
} catch {
    Write-Err "对话请求失败: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        # 错误响应同样用 UTF8 解码，避免中文错误消息乱码
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream(), [System.Text.Encoding]::UTF8)
        $errorBody = $reader.ReadToEnd()
        Write-Host "  错误响应: $errorBody" -ForegroundColor Red
    }
    exit 1
}

# ===== Step 3: 律师审核端点验证 =====
Write-Step '律师审核端点 GET /v1/reviews/queue...'
try {
    $queueResp = Invoke-RestMethod -Uri "$BaseUrl/v1/reviews/queue" -Method Get -Headers $headers -TimeoutSec 10
    Write-Ok "审核队列查询成功: code=$($queueResp.code), 数据条数=$($queueResp.data.Count)"
} catch {
    Write-Err "审核队列查询失败: $($_.Exception.Message)"
}

# ===== Step 4: 就绪探针（readiness）=====
Write-Step '就绪探针 GET /health/ready（readiness）...'
try {
    $ready = Invoke-RestMethod -Uri "$BaseUrl/health/ready" -Method Get -TimeoutSec 10
    if ($ready.data.status -eq 'ready') {
        Write-Ok "就绪: mongo=$($ready.data.checks.mongo), redis=$($ready.data.checks.redis)"
    } else {
        Write-Warn "未就绪: $($ready | ConvertTo-Json -Compress)"
    }
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 503) {
        Write-Warn "就绪探针返回 503（依赖未就绪，SLB 应摘除流量）: $($_.Exception.Message)"
    } else {
        Write-Err "就绪探针异常: $($_.Exception.Message)"
    }
}

# ===== Step 5: 404 统一信封 =====
Write-Step '404 路由 GET /v1/non-existent...'
# 用 curl.exe 读取 404 响应体（Invoke-RestMethod 异常处理会消费响应流导致读不到 body）
$raw404 = curl.exe -s -w "`n%{http_code}" "$BaseUrl/v1/non-existent" 2>&1
$lines404 = $raw404 -split "`n" | Where-Object { $_.Trim() -ne '' }
$httpCode404 = $lines404[-1]
$body404 = $lines404[0..($lines404.Count - 2)] -join ''
if ($httpCode404 -eq '404') {
    try {
        $json404 = $body404 | ConvertFrom-Json
        if ($json404.code -eq 4040 -and $json404.data -eq $null -and $json404.traceId) {
            Write-Ok "404 信封校验通过: code=$($json404.code), traceId=$($json404.traceId)"
        } else {
            Write-Warn "404 但信封格式异常: $body404"
        }
    } catch {
        Write-Warn "404 响应体解析失败: $body404"
    }
} else {
    Write-Err "预期 404，实际 HTTP $httpCode404"
}

# ===== Step 6: Agent 列表（A5 新增端点）=====
Write-Step 'Agent 列表 GET /v1/agents...'
try {
    $agentsResp = Invoke-RestMethod -Uri "$BaseUrl/v1/agents" -Method Get -Headers $headers -TimeoutSec 10
    if ($agentsResp.code -eq 0 -and $agentsResp.data.agents) {
        $count = $agentsResp.data.agents.Count
        Write-Ok "Agent 列表: $count 个 AgentCard"
        # 列出 agentId 与 exposure
        $agentsResp.data.agents | ForEach-Object {
            Write-Host "    - $($_.agentId) [$($_.exposure)]" -ForegroundColor Gray
        }
        # 断言不含 L-Internal
        $internal = $agentsResp.data.agents | Where-Object { $_.exposure -eq 'L-Internal' }
        if ($internal) {
            Write-Warn "发现 L-Internal agent 对外暴露: $($internal.agentId -join ', ')"
        } else {
            Write-Ok 'L-Internal agent 未对外暴露'
        }
    } else {
        Write-Err "Agent 列表响应异常: $($agentsResp | ConvertTo-Json -Compress)"
    }
} catch {
    Write-Err "Agent 列表请求失败: $($_.Exception.Message)"
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Ok '冒烟测试完成'
Write-Host "========================================`n" -ForegroundColor Cyan
