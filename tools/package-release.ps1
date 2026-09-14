param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../dist')
)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$moduleId = 'splittermond-smoother-fight'
$sourcePath = Join-Path $projectDirectory "Modul/$moduleId"
$manifestPath = Join-Path $sourcePath 'module.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw | ConvertFrom-Json
if ($manifest.id -ne $moduleId -or $manifest.version -notmatch '^\d+\.\d+\.\d+$' -or $package.version -ne $manifest.version) {
    throw 'Module id and stable package/manifest versions must match.'
}
$version = $manifest.version
$archiveName = "$moduleId-v$version.zip"
if ($manifest.download -ne "$($manifest.url)/releases/download/v$version/$archiveName") {
    throw 'The manifest download URL does not match the regular archive name.'
}
foreach ($entry in @($manifest.esmodules) + @($manifest.styles)) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourcePath $entry) -PathType Leaf)) {
        throw "Missing runtime entry: $entry"
    }
}
$outputPath = [IO.Path]::GetFullPath((Join-Path $OutputDirectory $version))
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$archivePath = Join-Path $outputPath $archiveName
# Match the runtime-only archive layout used by the regular release workflow.
$entries = @('assets', 'lang', 'scripts', 'styles', 'templates', 'LICENSE', 'module.json', 'README.md') |
    ForEach-Object { Join-Path $sourcePath $_ }
Compress-Archive -LiteralPath $entries -DestinationPath $archivePath -Force
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $outputPath 'module.json') -Force
Copy-Item -LiteralPath (Join-Path $projectDirectory 'RELEASE_NOTES.md') -Destination (Join-Path $outputPath 'RELEASE_NOTES.md') -Force
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256 |
    Select-Object Path, Hash | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'sha256.json') -Encoding utf8
Get-Item -LiteralPath $archivePath | Select-Object FullName, Length
