$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output = Join-Path $root 'downloads/templates/maintenance-agent.msi'

Push-Location $root
try {
  wix build -arch x64 -pdbtype none -out $output installer/MaintenanceBoardAgent.wxs
  if ($LASTEXITCODE -ne 0) { throw "Échec de la compilation WiX ($LASTEXITCODE)" }
  Write-Host "MSI créé : $output"
} finally {
  Pop-Location
}
