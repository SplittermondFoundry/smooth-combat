param(
    [string]$InstalledBackupDirectory,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../dist/character-focus-preview')
)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
$moduleId = 'splittermond-smoother-fight'
$sourcePath = Join-Path $projectDirectory "Modul/$moduleId"
$stagePath = Join-Path $outputPath "preview-11/$moduleId"
New-Item -ItemType Directory -Path $stagePath -Force | Out-Null
Get-ChildItem -LiteralPath $sourcePath | Copy-Item -Destination $stagePath -Recurse -Force
$manifestPath = Join-Path $stagePath 'module.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifest.version = "$($manifest.version)-character-focus.11"
$manifest.title = 'Splittermond Smoother Fight – Charakterwahl-Vorschau'
$manifest.PSObject.Properties.Remove('manifest')
$manifest.PSObject.Properties.Remove('download')
$manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $manifestPath -Encoding utf8
$previewZip = Join-Path $outputPath 'smoother-fight-character-focus-preview-11.zip'
Compress-Archive -LiteralPath $stagePath -DestinationPath $previewZip -Force
$archives = @($previewZip)
if ($InstalledBackupDirectory) {
    $backupPath = [IO.Path]::GetFullPath($InstalledBackupDirectory)
    $backupManifest = Get-Content -LiteralPath (Join-Path $backupPath 'module.json') -Raw | ConvertFrom-Json
    if ($backupManifest.id -ne $moduleId -or (Split-Path $backupPath -Leaf) -ne $moduleId) {
        throw 'The supplied backup is not the expected complete module directory.'
    }
    $rollbackZip = Join-Path $outputPath 'smoother-fight-installed-backup.zip'
    Compress-Archive -LiteralPath $backupPath -DestinationPath $rollbackZip -Force
    $archives += $rollbackZip
}
$archives | ForEach-Object { Get-FileHash -LiteralPath $_ -Algorithm SHA256 } |
    Select-Object Path, Hash | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'sha256.json') -Encoding utf8
Get-Item -LiteralPath $archives | Select-Object FullName, Length
