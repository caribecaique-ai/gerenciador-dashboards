$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$managerRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$workspaceRoot = Split-Path $managerRoot -Parent
$dashboardRoot = Join-Path $workspaceRoot "clickup_dashboard"
$logPath = Join-Path $scriptDir "dashboard_rule_guard.log"

function Write-GuardLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $logPath -Value $line
}

function Get-ListeningPid {
  param([Parameter(Mandatory = $true)][int]$Port)

  try {
    $tcp = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($tcp) {
      return $tcp.OwningProcess
    }
  } catch {
    # fallback below
  }

  $line = netstat -ano | Select-String ":$Port" | Select-String "LISTENING" | Select-Object -First 1
  if (-not $line) {
    return $null
  }

  $parts = ($line.ToString() -replace "\s+", " ").Trim().Split(" ")
  if ($parts.Length -lt 5) {
    return $null
  }

  return $parts[-1]
}

function Ensure-NodeModules {
  param([Parameter(Mandatory = $true)][string]$Workdir)

  if (-not (Test-Path (Join-Path $Workdir "node_modules"))) {
    Write-GuardLog "Instalando dependencias em $Workdir"
    npm install --prefix "$Workdir" | Out-Null
  }
}

function Ensure-Service {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Workdir,
    [Parameter(Mandatory = $true)][string]$CmdLine
  )

  if (Get-ListeningPid -Port $Port) {
    return
  }

  Ensure-NodeModules -Workdir $Workdir
  Write-GuardLog "Subindo $Title na porta $Port"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c $CmdLine" -WorkingDirectory $Workdir -WindowStyle Hidden | Out-Null
}

if (-not (Test-Path $dashboardRoot)) {
  Write-GuardLog "Repositorio clickup_dashboard nao encontrado em $dashboardRoot"
  exit 0
}

$mutexName = "DashboardRuleGuard_GerenciadorDashboards"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
  exit 0
}

Write-GuardLog "Guardiao iniciado."

try {
  $tick = 0
  while ($true) {
    try {
      $managerApiUp = [bool](Get-ListeningPid -Port 3005)
      $managerFrontendUp = [bool](Get-ListeningPid -Port 3010)

      if ($managerApiUp -or $managerFrontendUp) {
        Ensure-Service `
          -Port 3001 `
          -Title "DASHBOARD_API_3001" `
          -Workdir (Join-Path $dashboardRoot "backend") `
          -CmdLine 'set "HTTP_PROXY=" && set "HTTPS_PROXY=" && set "ALL_PROXY=" && set "GIT_HTTP_PROXY=" && set "GIT_HTTPS_PROXY=" && set "NO_PROXY=localhost,127.0.0.1,::1" && npm run start > backend.run.log 2>&1'

        Ensure-Service `
          -Port 5173 `
          -Title "DASHBOARD_FRONTEND_5173" `
          -Workdir (Join-Path $dashboardRoot "frontend") `
          -CmdLine 'npm run preview -- --host 0.0.0.0 --port 5173 > frontend.run.log 2>&1'
      }

      $tick++
      if (($tick % 30) -eq 0) {
        Write-GuardLog "Heartbeat: managerApiUp=$managerApiUp, managerFrontendUp=$managerFrontendUp"
      }
    } catch {
      Write-GuardLog ("Erro no ciclo do guardiao: " + $_.Exception.Message)
    }

    Start-Sleep -Seconds 8
  }
}
finally {
  Write-GuardLog "Guardiao encerrado."
  $mutex.ReleaseMutex() | Out-Null
  $mutex.Dispose()
}
