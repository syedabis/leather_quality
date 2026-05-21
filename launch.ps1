# CONFIGURATION
$DEPLOY_DIR       = $PSScriptRoot
$INFERENCE_DIR    = Join-Path $DEPLOY_DIR "inference-client"
$INFERENCE_SCRIPT = "run_stream_server.py"
$DASHBOARD_URL    = "http://localhost:3000"
$DOCKER_EXE       = "C:\Program Files\Docker\Docker\Docker Desktop.exe"

# Detect LAN IP — pick the adapter that has a default gateway (i.e. the active one)
$lanIP = (Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } |
    Select-Object -First 1).IPv4Address.IPAddress
if (-not $lanIP) {
    $lanIP = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
        Select-Object -First 1).IPAddress
}
$NETWORK_URL = if ($lanIP) { "http://${lanIP}:3000" } else { "(IP not detected)" }

$ErrorActionPreference = "SilentlyContinue"
$inferenceProc = $null

function Stop-All {
    Write-Host ""
    Write-Host "  Stopping system..." -ForegroundColor Yellow
    if ($inferenceProc -and -not $inferenceProc.HasExited) {
        Get-WmiObject Win32_Process |
            Where-Object { $_.ParentProcessId -eq $inferenceProc.Id } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Stop-Process -Id $inferenceProc.Id -Force -ErrorAction SilentlyContinue
    }
    Set-Location $DEPLOY_DIR
    docker compose down --timeout 15 2>&1 | Out-Null
    Write-Host "  System stopped. Goodbye." -ForegroundColor Green
    Start-Sleep 2
}

Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-All } | Out-Null

Clear-Host
Write-Host ""
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host "     SPRAY PLANT OPERATIONS                 " -ForegroundColor DarkCyan
Write-Host "     Dada Bespoke Concepts                  " -ForegroundColor DarkCyan
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host ""

# 1. Check Docker
$dockerReady = $false
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { $dockerReady = $true }

if (-not $dockerReady) {
    Write-Host "  Starting Docker Desktop..." -ForegroundColor Cyan
    if (Test-Path $DOCKER_EXE) {
        Start-Process $DOCKER_EXE
    } else {
        Write-Host "  Docker Desktop not found. Please install it and try again." -ForegroundColor Red
        Read-Host "  Press Enter to exit"
        exit 1
    }

    Write-Host "  Waiting for Docker" -NoNewline -ForegroundColor Cyan
    $elapsed = 0
    while ($elapsed -lt 120) {
        Start-Sleep 3
        $elapsed += 3
        Write-Host "." -NoNewline -ForegroundColor Cyan
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
    }
    Write-Host ""

    if (-not $dockerReady) {
        Write-Host "  Docker failed to start. Open Docker Desktop manually and retry." -ForegroundColor Red
        Read-Host "  Press Enter to exit"
        exit 1
    }
}

Write-Host "  Docker ready." -ForegroundColor Green

# 2. Stop any running containers
Write-Host "  Stopping old containers..." -ForegroundColor Cyan
Set-Location $DEPLOY_DIR
docker compose down 2>&1 | Out-Null

# 3. Pull latest images
Write-Host "  Checking for updates..." -ForegroundColor Cyan
docker compose pull 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Images up to date." -ForegroundColor Green
} else {
    Write-Host "  Could not check for updates (offline?) - using local images." -ForegroundColor Yellow
}

# 4. Start containers
Write-Host "  Starting containers..." -ForegroundColor Cyan
docker compose up -d 2>&1 | Out-Null
Write-Host "  Containers started." -ForegroundColor Green

# 4. Wait for dashboard
Write-Host "  Waiting for dashboard" -NoNewline -ForegroundColor Cyan
$elapsed = 0
while ($elapsed -lt 90) {
    Start-Sleep 3
    $elapsed += 3
    Write-Host "." -NoNewline -ForegroundColor Cyan
    try {
        $r = Invoke-WebRequest $DASHBOARD_URL -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -lt 500) { break }
    } catch { }
}
Write-Host ""

# 5. Open browser
Start-Process $DASHBOARD_URL
Write-Host "  Browser opened." -ForegroundColor Green

# 6. Start inference
$inferenceScript = Join-Path $INFERENCE_DIR $INFERENCE_SCRIPT
if (Test-Path $inferenceScript) {
    Write-Host "  Starting inference on all plants..." -ForegroundColor Cyan
    $inferenceProc = Start-Process -FilePath "python" -ArgumentList $INFERENCE_SCRIPT -WorkingDirectory $INFERENCE_DIR -PassThru
    Write-Host "  Inference running (PID $($inferenceProc.Id))." -ForegroundColor Green
} else {
    Write-Host "  Inference script not found - skipping." -ForegroundColor Yellow
}

# 7. Running banner
Write-Host ""
Write-Host "  ================================================" -ForegroundColor Green
Write-Host "     SYSTEM IS RUNNING                           " -ForegroundColor Green
Write-Host "                                                 " -ForegroundColor Green
Write-Host "     This machine  : http://localhost:3000       " -ForegroundColor White
Write-Host "     Network (LAN) : $NETWORK_URL" -ForegroundColor Cyan
Write-Host "                                                 " -ForegroundColor Green
Write-Host "     Open either address in any browser on       " -ForegroundColor Gray
Write-Host "     the same Wi-Fi / network to view live.      " -ForegroundColor Gray
Write-Host "                                                 " -ForegroundColor Green
Write-Host "     Cameras  : All 6 plants active              " -ForegroundColor White
Write-Host "                                                 " -ForegroundColor Green
Write-Host "     Press Enter to STOP everything              " -ForegroundColor Yellow
Write-Host "  ================================================" -ForegroundColor Green
Write-Host ""

Read-Host | Out-Null
Stop-All
