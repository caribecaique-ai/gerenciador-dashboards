$ErrorActionPreference = "Stop"

$taskName = "GerenciadorDashboards_Autostart"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Tarefa removida: $taskName"
} else {
  Write-Host "Tarefa nao encontrada: $taskName"
}
