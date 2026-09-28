param(
  [Parameter(Mandatory = $true)][string]$MsiPath,
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$EnrollmentToken
)

$ErrorActionPreference = 'Stop'
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase($MsiPath, 1)
foreach ($entry in @(
  @{ Name = 'SERVERURL'; Value = $ServerUrl },
  @{ Name = 'ENROLLMENTTOKEN'; Value = $EnrollmentToken }
)) {
  $value = $entry.Value.Replace("'", "''")
  $view = $database.OpenView("UPDATE Property SET Value='$value' WHERE Property='$($entry.Name)'")
  $view.Execute()
  $view.Close()
}
$database.Commit()
