$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$managerRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$workspaceRoot = Split-Path $managerRoot -Parent
$dashboardRoot = Join-Path $workspaceRoot "clickup_dashboard"
$guardScript = Join-Path $scriptDir "dashboard_rule_guard.ps1"

function Parse-EnvBoolean {
  param(
    [string]$Value,
    [bool]$Default = $false
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $Default
  }

  switch -Regex ($Value.Trim().ToLower()) {
    "^(1|true|yes|on)$" { return $true }
    "^(0|false|no|off)$" { return $false }
    default { return $Default }
  }
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
    Write-Host "[SETUP] Instalando dependencias em $Workdir"
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

  $listeningPid = Get-ListeningPid -Port $Port
  if ($listeningPid) {
    Write-Host "[OK] Porta $Port ja ativa (PID $listeningPid)."
    return
  }

  Ensure-NodeModules -Workdir $Workdir
  Write-Host "[START] Subindo $Title na porta $Port..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c $CmdLine" -WorkingDirectory $Workdir -WindowStyle Hidden | Out-Null
}

function Ensure-Guard {
  param([Parameter(Mandatory = $true)][string]$ScriptPath)

  $guardRunning = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "powershell.exe" -and
      $_.CommandLine -like "*dashboard_rule_guard.ps1*"
    } |
    Select-Object -First 1

  if ($guardRunning) {
    Write-Host "[OK] Regra ativa (guard PID $($guardRunning.ProcessId))."
    return
  }

  Write-Host "[START] Ativando guardiao da regra..."
  Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$ScriptPath`"" -WindowStyle Hidden | Out-Null
}

function Get-LanIpv4 {
  try {
    $activeInterface = Get-NetIPConfiguration |
      Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address -ne $null } |
      Select-Object -First 1
    if ($activeInterface -and $activeInterface.IPv4Address -and $activeInterface.IPv4Address.IPAddress) {
      return $activeInterface.IPv4Address.IPAddress
    }
  } catch {
    return $null
  }
  return $null
}

$managerOnlyMode = Parse-EnvBoolean -Value $env:MANAGER_ONLY_MODE -Default $true
$networkMode = Parse-EnvBoolean -Value $env:MANAGER_NETWORK_MODE -Default $false

if (-not (Test-Path $dashboardRoot) -and -not $managerOnlyMode) {
  throw "Repositorio clickup_dashboard nao encontrado em $dashboardRoot"
}

if ($managerOnlyMode) {
  Write-Host "Iniciando gerenciador (modo manager-only)..."
} else {
  Write-Host "Iniciando gerenciador + dashboards..."
}

Ensure-Service `
  -Port 3005 `
  -Title "MANAGER_API_3005" `
  -Workdir (Join-Path $managerRoot "apps\api\backend") `
  -CmdLine 'set "HTTP_PROXY=" && set "HTTPS_PROXY=" && set "ALL_PROXY=" && set "GIT_HTTP_PROXY=" && set "GIT_HTTPS_PROXY=" && set "NO_PROXY=localhost,127.0.0.1,::1" && node server.js > manager_api_3005.run.log 2>&1'

Ensure-Service `
  -Port 3010 `
  -Title "MANAGER_FRONTEND_3010" `
  -Workdir (Join-Path $managerRoot "frontend") `
  -CmdLine 'npm run preview -- --host 0.0.0.0 --port 3010 > manager_frontend_3010.run.log 2>&1'

if (-not $managerOnlyMode) {
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

  Ensure-Guard -ScriptPath $guardScript
}

Write-Host ""
Write-Host "URLs:"
$lanHost = Get-LanIpv4
$publicHost = if ($networkMode -and -not [string]::IsNullOrWhiteSpace($lanHost)) { $lanHost } else { "localhost" }
Write-Host "- Gerenciador: http://$publicHost`:3010"
Write-Host "- API Gerenciador: http://$publicHost`:3005/api/health"
if ($managerOnlyMode) {
  Write-Host "- Modo: manager-only (dashboard interno por /api/dashboard no proprio gerenciador)"
} else {
  Write-Host "- Dashboard: http://$publicHost`:5173"
  Write-Host "- API Dashboard: http://$publicHost`:3001/health"
}
Write-Host ""
Write-Host "Script finalizado. Os servicos seguem em background."
