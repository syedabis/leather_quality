# CONFIGURATION
$DEPLOY_DIR         = $PSScriptRoot
$INFERENCE_DIR      = Join-Path $DEPLOY_DIR "inference-client"
$INFERENCE_SCRIPT   = "run_all_plants.py"
$DASHBOARD_URL      = "http://localhost:3000"
$DOCKER_EXE         = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$MOBILE_BACKEND_DIR = "D:\Plant Installtion\deployement\backend-mobile"

# Detect LAN IP - pick the adapter that has a default gateway (i.e. the active one)
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

# ── Guard: block a second instance ────────────────────────────────────────────
# If another launch.ps1 is already running (from a bat-file click that was never
# properly closed), show a warning popup and exit immediately instead of letting
# the new instance's Stop-All kill the running inference.
$_running = Get-WmiObject Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "powershell" -and $_.CommandLine -like "*launch.ps1*" -and $_.ProcessId -ne $PID }
if ($_running) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "Spray Plant is already running!`n`nClose the existing launcher window first, then try again.",
        "Already Running",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    exit 0
}

function Stop-All {
    Write-Host ""
    Write-Host "  Stopping system..." -ForegroundColor Yellow
    if ($inferenceProc -and -not $inferenceProc.HasExited) {
        # Ask the inference script to end active sessions and exit gracefully
        # before force-killing it, so sessions aren't left orphaned mid-run
        # (the next startup's cleanup only knows the restart time, not the
        # real stop time).
        $stopSignalFile = Join-Path $INFERENCE_DIR ".stop_signal"
        New-Item -ItemType File -Path $stopSignalFile -Force -ErrorAction SilentlyContinue | Out-Null
        Start-Sleep 5
        Remove-Item $stopSignalFile -Force -ErrorAction SilentlyContinue
        Get-WmiObject Win32_Process |
            Where-Object { $_.ParentProcessId -eq $inferenceProc.Id } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Stop-Process -Id $inferenceProc.Id -Force -ErrorAction SilentlyContinue
    }
    Set-Location $DEPLOY_DIR
    docker compose down --timeout 15 2>&1 | Out-Null
    # Stop mobile backend
    pm2 stop leatherflow 2>&1 | Out-Null
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

# 4b. Start mobile app backend (LeatherFlow API on port 3008)
Write-Host "  Starting mobile app backend..." -ForegroundColor Cyan
$mobileBackendScript = Join-Path $MOBILE_BACKEND_DIR "index.js"
if (Test-Path $mobileBackendScript) {
    pm2 delete leatherflow 2>&1 | Out-Null
    pm2 start $mobileBackendScript --name leatherflow --cwd $MOBILE_BACKEND_DIR 2>&1 | Out-Null
    Write-Host "  Mobile backend running on port 3008 (via PM2)." -ForegroundColor Green
} else {
    Write-Host "  Mobile backend not found at $MOBILE_BACKEND_DIR - skipping." -ForegroundColor Yellow
}

# 5. Wait for dashboard
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

# 6. Open browser
Start-Process $DASHBOARD_URL
Write-Host "  Browser opened." -ForegroundColor Green

# 7. Start inference - kill any existing instance first so only one ever runs
$inferenceScript = Join-Path $INFERENCE_DIR $INFERENCE_SCRIPT
if (Test-Path $inferenceScript) {
    $existing = Get-WmiObject Win32_Process -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -like "*run_all_plants.py*" }
    if ($existing) {
        Write-Host "  Found existing inference (PID $($existing.ProcessId)) - stopping it..." -ForegroundColor Yellow
        # Ask it to end active sessions and exit gracefully first, so sessions
        # aren't left orphaned for the next startup's cleanup to guess at.
        $stopSignalFile = Join-Path $INFERENCE_DIR ".stop_signal"
        New-Item -ItemType File -Path $stopSignalFile -Force -ErrorAction SilentlyContinue | Out-Null
        Start-Sleep 5
        Remove-Item $stopSignalFile -Force -ErrorAction SilentlyContinue
        # Kill child processes of that CMD window first, then the CMD itself
        Get-WmiObject Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ParentProcessId -eq $existing.ProcessId } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Stop-Process -Id $existing.ProcessId -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
        Write-Host "  Old inference stopped." -ForegroundColor Green
    }
    Write-Host "  Starting inference on all plants..." -ForegroundColor Cyan
    $inferenceProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/k python $INFERENCE_SCRIPT" -WorkingDirectory $INFERENCE_DIR -PassThru
    Write-Host "  Inference running (PID $($inferenceProc.Id))." -ForegroundColor Green
} else {
    Write-Host "  Inference script not found - skipping." -ForegroundColor Yellow
}

# 8. Running banner
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
