# MaintenanceBoard Agent Windows
# Config : lire config.json dans le même dossier
param()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir "config.json"
$tokenFile  = Join-Path $scriptDir "machine-token.txt"
$logFile    = Join-Path $scriptDir "agent.log"

function Write-Log($msg) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$timestamp  $msg" | Tee-Object -FilePath $logFile -Append | Write-Host
}

if (-not (Test-Path $configPath)) {
  Write-Log "ERREUR : config.json introuvable dans $scriptDir"
  exit 1
}

$config    = Get-Content $configPath -Raw | ConvertFrom-Json
$serverUrl = $config.serverUrl.TrimEnd('/')

Write-Log "Agent démarré. Serveur : $serverUrl"

function Get-Peripherals {
  $items = @()
  try {
    Get-WmiObject Win32_DesktopMonitor | ForEach-Object {
      $items += @{ type = "Monitor"; name = $_.Name }
    }
  } catch {}
  try {
    Get-WmiObject Win32_USBHub | Where-Object { $_.Description -match "HID|keyboard|mouse" } | ForEach-Object {
      $items += @{ type = "USB"; name = $_.Description }
    }
  } catch {}
  return $items
}

function Send-CheckIn {
  $token = if (Test-Path $tokenFile) { (Get-Content $tokenFile -Raw).Trim() } else { $config.enrollmentToken }

  try {
    $bios = Get-WmiObject Win32_BIOS
    $cpu  = (Get-WmiObject Win32_Processor | Select-Object -First 1).Name
    $ram  = [math]::Round((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
    $os   = (Get-WmiObject Win32_OperatingSystem).Caption
    $osVer= (Get-WmiObject Win32_OperatingSystem).Version
    $usr  = (Get-WmiObject Win32_ComputerSystem).UserName

    $ips  = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
               Where-Object { $_.IPAddress -ne "127.0.0.1" } |
               Select-Object -ExpandProperty IPAddress)
    $macs = @(Get-NetAdapter -ErrorAction SilentlyContinue |
               Where-Object { $_.Status -eq "Up" } |
               Select-Object -ExpandProperty MacAddress)

    $body = @{
      hostname     = $env:COMPUTERNAME
      serialNumber = $bios.SerialNumber
      type         = "PC"
      cpu          = $cpu
      ramGb        = $ram
      os           = $os
      osVersion    = $osVer
      user         = $usr
      ips          = $ips
      macs         = $macs
      peripherals  = @(Get-Peripherals)
    } | ConvertTo-Json -Depth 5

    $headers  = @{ "X-Agent-Token" = $token; "Content-Type" = "application/json" }
    $response = Invoke-RestMethod -Uri "$serverUrl/api/agents/checkin" `
                  -Method POST -Body $body -Headers $headers -TimeoutSec 30

    if ($response.agentToken) {
      Set-Content -Path $tokenFile -Value $response.agentToken -Encoding UTF8
      Write-Log "Token machine enregistré (équipement $($response.equipmentId))"
    } else {
      Write-Log "Check-in OK (équipement $($response.equipmentId))"
    }
  } catch {
    Write-Log "Erreur check-in : $_"
  }
}

while ($true) {
  Send-CheckIn
  Start-Sleep -Seconds 300
}
