# MaintenanceBoard Agent Windows
# Config : lire config.json dans le même dossier
param()

$scriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath    = Join-Path $scriptDir "config.json"
$tokenFile     = Join-Path $scriptDir "machine-token.txt"
$logFile       = Join-Path $scriptDir "agent.log"
$lastEventFile = Join-Path $scriptDir "last-event.txt"

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

  # Écrans et projecteurs : données EDID (fabricant, modèle, n° de série)
  try {
    $monitors = Get-WmiObject -Namespace root\wmi -Class WmiMonitorID -ErrorAction SilentlyContinue
    foreach ($m in $monitors) {
      $decode  = { param($arr) ($arr | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ }) -join '' }
      $model   = (& $decode $m.UserFriendlyName).Trim()
      $brand   = (& $decode $m.ManufacturerName).Trim()
      $serial  = (& $decode $m.SerialNumberID).Trim()
      if ($model -or $brand) {
        $items += @{ type = "Monitor"; name = $model; brand = $brand; serial = $serial }
      }
    }
  } catch {}

  # Périphériques audio : casques, micros, enceintes USB/jack
  try {
    Get-WmiObject Win32_SoundDevice -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.Name) {
        $items += @{ type = "Audio"; name = $_.Name; brand = $_.Manufacturer; serial = $null }
      }
    }
  } catch {}

  # Périphériques HID USB : claviers, souris, manettes, tablettes...
  # Le numéro de série est dans l'InstanceId quand le fabricant le fournit :
  # USB\VID_XXXX&PID_XXXX\<serial>  (absent si générique → "0000000...")
  try {
    Get-PnpDevice -Class HIDClass -Status OK -ErrorAction SilentlyContinue |
      Where-Object { $_.InstanceId -match '^USB\\' -and $_.FriendlyName -notmatch 'Hub|Root|Composite|Enumerated' } |
      ForEach-Object {
        $parts  = $_.InstanceId -split '\\'
        $rawSerial = if ($parts.Count -ge 3) { $parts[2] } else { $null }
        # Ignorer les pseudo-serials génériques (tout 0, &, trop courts)
        $serial = if ($rawSerial -and $rawSerial -notmatch '^[0&]|^.{1,4}$') { $rawSerial } else { $null }
        $items += @{ type = "HID"; name = $_.FriendlyName; brand = $null; serial = $serial }
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

# ── Collecte des sessions Windows ────────────────────────────────────────────
# Nécessite l'accès au journal Sécurité (droits admin ou auditeur).
# EventID 4624 = ouverture de session interactive/réseau
# EventID 4634/4647 = fermeture de session
function Send-SessionEvents {
  # Ne rien faire si le token machine n'est pas encore enregistré
  if (-not (Test-Path $tokenFile)) { return }
  $token = (Get-Content $tokenFile -Raw).Trim()

  # Dernière date traitée (ou 24h en arrière au premier lancement)
  $since = if (Test-Path $lastEventFile) {
    [DateTime]::Parse((Get-Content $lastEventFile -Raw).Trim())
  } else {
    (Get-Date).AddHours(-24)
  }

  $events = @()

  try {
    # Ouvertures de session interactives (type 2) et réseau (type 10)
    $logonEvents = Get-WinEvent -FilterHashtable @{
      LogName   = 'Security'
      Id        = 4624
      StartTime = $since
    } -ErrorAction SilentlyContinue

    foreach ($ev in $logonEvents) {
      $xml     = [xml]$ev.ToXml()
      $ns      = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
      $ns.AddNamespace("e", "http://schemas.microsoft.com/win/2004/08/events/event")
      $logonType = ($xml.SelectSingleNode("//e:Data[@Name='LogonType']", $ns)).'#text'
      # Garder uniquement les sessions interactives (2) et Remote Desktop (10)
      if ($logonType -notin @('2', '10')) { continue }
      # LogonProcessName = "User32" → vraie session humaine (bureau Windows)
      # "Advapi", "NtLmSsp", "Kerberos"... → services, batch, réseau → ignorer
      $logonProcess = ($xml.SelectSingleNode("//e:Data[@Name='LogonProcessName']", $ns)).'#text'
      if ($logonProcess -ne 'User32') { continue }
      $winUser = ($xml.SelectSingleNode("//e:Data[@Name='TargetUserName']", $ns)).'#text'
      # Ignorer les comptes système
      if ($winUser -match '^\$|^SYSTEM$|^LOCAL SERVICE$|^NETWORK SERVICE$|^DWM-|^UMFD-|^ANONYMOUS') { continue }
      $events += @{
        winUser    = $winUser
        event      = "LOGIN"
        occurredAt = $ev.TimeCreated.ToString("o")
      }
    }

    # Fermetures de session :
    # - Event 4634 : logoff de toutes sessions, filtré par LogonType 2 (interactif) et 10 (RDP)
    # - Event 4647 : logoff initié explicitement par l'utilisateur (complément de 4634)
    # Les deux sont combinés avec déduplication sur une fenêtre de 5 secondes par utilisateur.
    $logoffRaw = Get-WinEvent -FilterHashtable @{
      LogName   = 'Security'
      Id        = @(4634, 4647)
      StartTime = $since
    } -ErrorAction SilentlyContinue

    $seenLogoff = @{}

    foreach ($ev in $logoffRaw) {
      $xml     = [xml]$ev.ToXml()
      $ns      = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
      $ns.AddNamespace("e", "http://schemas.microsoft.com/win/2004/08/events/event")

      # Pour Event 4634 : vérifier LogonType (2=interactif, 10=RDP)
      if ($ev.Id -eq 4634) {
        $logonType = ($xml.SelectSingleNode("//e:Data[@Name='LogonType']", $ns)).'#text'
        if ($logonType -notin @('2', '10')) { continue }
      }

      $winUser = ($xml.SelectSingleNode("//e:Data[@Name='TargetUserName']", $ns)).'#text'
      if ($winUser -match '^\$|^SYSTEM$|^LOCAL SERVICE$|^NETWORK SERVICE$|^DWM-|^UMFD-') { continue }

      # Déduplication : même utilisateur dans une fenêtre de 5 secondes
      $bucket5s = [math]::Floor([double]($ev.TimeCreated.ToFileTimeUtc()) / 50000000)
      $bucketKey = "$winUser|$bucket5s"
      if ($seenLogoff.ContainsKey($bucketKey)) { continue }
      $seenLogoff[$bucketKey] = $true

      $events += @{
        winUser    = $winUser
        event      = "LOGOUT"
        occurredAt = $ev.TimeCreated.ToString("o")
      }
    }
  } catch {
    Write-Log "Avertissement journal sécurité : $_"
    return
  }

  # Sauvegarder la date courante comme dernier traitement
  Set-Content -Path $lastEventFile -Value (Get-Date).ToString("o") -Encoding UTF8

  if ($events.Count -eq 0) { return }

  try {
    $body    = @{ events = $events } | ConvertTo-Json -Depth 5
    $headers = @{ "X-Agent-Token" = $token; "Content-Type" = "application/json" }
    $result  = Invoke-RestMethod -Uri "$serverUrl/api/agents/sessions" `
                 -Method POST -Body $body -Headers $headers -TimeoutSec 30
    Write-Log "Sessions envoyées : $($result.inserted) événement(s)"
  } catch {
    Write-Log "Erreur envoi sessions : $_"
  }
}

# ── Boucle principale ─────────────────────────────────────────────────────────
while ($true) {
  Send-CheckIn
  Send-SessionEvents
  Start-Sleep -Seconds 300
}
