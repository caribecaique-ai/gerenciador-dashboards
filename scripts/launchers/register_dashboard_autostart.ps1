$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherScript = Join-Path $scriptDir "start_dashboards_autostart.ps1"
$taskName = "GerenciadorDashboards_Autostart"
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$launcherScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Inicia gerenciador e dashboards no logon do Windows." `
  -Force | Out-Null

Write-Host "Tarefa registrada: $taskName"
Write-Host "Usuario: $userId"
Write-Host "Launcher: $launcherScript"
