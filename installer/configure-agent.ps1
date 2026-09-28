param(
  [string]$ServerUrl,
  [string]$EnrollmentToken,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceName = 'MaintenanceBoardAgent'

if ($Uninstall) {
  Stop-ScheduledTask -TaskName $serviceName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $serviceName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $installDir 'config.json') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $installDir 'machine-token.txt') -Force -ErrorAction SilentlyContinue
  exit 0
}

if ($ServerUrl -notmatch '^https?://\S+$') { throw 'URL du serveur invalide' }
if (-not $EnrollmentToken -or $EnrollmentToken -eq '00000000-0000-0000-0000-000000000000') {
  throw "Jeton d'enrôlement manquant"
}

@{ serverUrl = $ServerUrl.TrimEnd('/'); enrollmentToken = $EnrollmentToken } |
  ConvertTo-Json -Compress |
  Set-Content -LiteralPath (Join-Path $installDir 'config.json') -Encoding UTF8

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $installDir 'agent.ps1')`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 2) `
  -ExecutionTimeLimit ([System.TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Stop-ScheduledTask -TaskName $serviceName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $serviceName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $serviceName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $serviceName
