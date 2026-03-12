$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $scriptDir "start_dashboard_stack.ps1"

$env:MANAGER_ONLY_MODE = "0"
$env:MANAGER_NETWORK_MODE = "1"

Start-Sleep -Seconds 8

& $startScript
