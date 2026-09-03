# Scheduled daily restart (5am) for the Spray Plant system.
# Place this file in the same folder as launch.ps1 / Start Spray Plant.bat,
# then register it with Windows Task Scheduler to run once a day.
#
# What it does, in order:
#   1. Signals run_all_plants.py to end all active sessions/modes and exit
#      on its own (same .stop_signal file launch.ps1 already uses), so
#      nothing is left for the next startup's orphan-cleanup to guess at.
#   2. Force-stops anything left (inference process + children).
#   3. Stops the Docker containers and the mobile backend (pm2) — same
#      steps launch.ps1's own Stop-All performs.
#   4. Closes the existing launch.ps1 console window (and its parent
#      "Start Spray Plant.bat" window, if still open).
#   5. Re-launches Start Spray Plant.bat fresh, which does the entire
#      startup sequence itself (Docker check, pull, containers up, mobile
#      backend, browser, inference).

# ── CONFIGURATION — must match launch.ps1's own values ─────────────────────
$DEPLOY_DIR       = $PSScriptRoot
$INFERENCE_DIR    = Join-Path $DEPLOY_DIR "inference-client"
$START_BAT_NAME   = "Start Spray Plant.bat"   # adjust if the file is named differently

$ErrorActionPreference = "SilentlyContinue"

function Log($msg) {
    Write-Output "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
}

Log "Daily restart starting."

# ── 1. Gracefully stop the running inference process ──────────────────────
$inference = Get-WmiObject Win32_Process |
    Where-Object { $_.CommandLine -like "*run_all_plants.py*" }

if ($inference) {
    Log "Found running inference (PID $($inference.ProcessId)) - signaling graceful stop."
    $stopSignalFile = Join-Path $INFERENCE_DIR ".stop_signal"
    New-Item -ItemType File -Path $stopSignalFile -Force | Out-Null
    Start-Sleep 5
    Remove-Item $stopSignalFile -Force

    # Force-stop anything still left (children first, then the process itself)
    Get-WmiObject Win32_Process |
        Where-Object { $_.ParentProcessId -eq $inference.ProcessId } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Stop-Process -Id $inference.ProcessId -Force
    Log "Inference stopped."
} else {
    Log "No running inference process found."
}

# ── 2. Stop containers + mobile backend ────────────────────────────────────
Set-Location $DEPLOY_DIR
Log "Stopping Docker containers..."
docker compose down --timeout 15 2>&1 | Out-Null

Log "Stopping mobile backend (pm2)..."
pm2 stop leatherflow 2>&1 | Out-Null

# ── 3. Close the existing launch.ps1 window (and its parent .bat window) ──
$launchProc = Get-WmiObject Win32_Process |
    Where-Object { $_.CommandLine -like "*launch.ps1*" }

if ($launchProc) {
    $parentId = $launchProc.ParentProcessId
    Log "Closing existing launch.ps1 window (PID $($launchProc.ProcessId))."
    Stop-Process -Id $launchProc.ProcessId -Force
    if ($parentId) {
        $parentProc = Get-WmiObject Win32_Process -Filter "ProcessId=$parentId"
        if ($parentProc -and $parentProc.CommandLine -like "*.bat*") {
            Log "Closing parent .bat window (PID $parentId)."
            Stop-Process -Id $parentId -Force
        }
    }
} else {
    Log "No running launch.ps1 window found."
}


# Wait until the old launch.ps1 process is fully gone before re-launching.
# Loops indefinitely and retries force-killing if the process is stubborn,
# guaranteeing we never trigger the duplicate-instance guard in the new run.
$_attempts = 0
while ($true) {
    $_stillThere = Get-WmiObject Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*launch.ps1*" }
    
    if (-not $_stillThere) {
        Log "Old launcher is completely gone. Proceeding with restart."
        break
    }
    
    $_attempts++
    Log "Old launcher (PID $(($_stillThere | Select-Object -First 1).ProcessId)) still closing... (attempt $_attempts)"
    
    if ($_attempts % 5 -eq 0) {
        Log "Stubborn launcher detected, retrying force-kill on all matching processes..."
        $_stillThere | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    
    Start-Sleep 1
}

# ── 4. Re-launch fresh ──────────────────────────────────────────────────────
$startBat = Join-Path $DEPLOY_DIR $START_BAT_NAME
if (Test-Path $startBat) {
    Log "Re-launching $START_BAT_NAME."
    Start-Process -FilePath $startBat -WorkingDirectory $DEPLOY_DIR
    Log "Daily restart complete."
} else {
    Log "ERROR: $startBat not found - could not restart. Check START_BAT_NAME in this script."
}
