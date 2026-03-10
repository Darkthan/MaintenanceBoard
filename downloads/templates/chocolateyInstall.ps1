# Chocolatey install script pour maintenance-agent
$ErrorActionPreference = 'Stop'

$toolsDir   = "$(Split-Path -Parent $MyInvocation.MyCommand.Definition)"
$agentScript = Join-Path $toolsDir "agent.ps1"
$serviceName = "MaintenanceBoardAgent"

# Créer le service Windows via NSSM si disponible, sinon tâche planifiée
$nssm = Get-Command nssm -ErrorAction SilentlyContinue

if ($nssm) {
  Write-Host "Installation via NSSM..."
  & nssm install $serviceName powershell.exe "-NonInteractive -WindowStyle Hidden -File `"$agentScript`""
  & nssm set $serviceName Start SERVICE_AUTO_START
  & nssm start $serviceName
} else {
  Write-Host "Installation via tâche planifiée..."
  $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
               -Argument "-NonInteractive -WindowStyle Hidden -File `"$agentScript`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
                -ExecutionTimeLimit ([System.TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

  Register-ScheduledTask -TaskName $serviceName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $serviceName
  Write-Host "Tâche planifiée '$serviceName' créée et démarrée."
}

Write-Host "MaintenanceBoard Agent installé avec succès."
