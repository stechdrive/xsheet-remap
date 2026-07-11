param(
  [string]$DestinationDir = "",
  [switch]$SkipLeakCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $repoRoot "tools\release\local-settings.ps1")

$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "release-local"))
$destinationDirectory = Resolve-XsheetHandoffDirectory `
  -RepoRoot $repoRoot `
  -ExplicitDirectory $DestinationDir

if ([string]::IsNullOrWhiteSpace($destinationDirectory)) {
  throw "handoff destination is not set. Pass -DestinationDir or set XSHEET_RELEASE_COPY_DIR."
}

$pathTrimChars = [char[]]@(
  [System.IO.Path]::DirectorySeparatorChar,
  [System.IO.Path]::AltDirectorySeparatorChar
)
$normalizedReleaseRoot = $releaseRoot.TrimEnd($pathTrimChars)
$normalizedDestination = [System.IO.Path]::GetFullPath($destinationDirectory).TrimEnd($pathTrimChars)
if (
  $normalizedDestination.Equals($normalizedReleaseRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
  $normalizedDestination.StartsWith(
    $normalizedReleaseRoot + [System.IO.Path]::DirectorySeparatorChar,
    [System.StringComparison]::OrdinalIgnoreCase
  )
) {
  throw "handoff destination must be outside release-local: $normalizedDestination"
}

$zipName = "xsheet-remap.zip"
$checksumName = "xsheet-remap.zip.sha256"
$zipPath = Join-Path $releaseRoot $zipName
$checksumPath = Join-Path $releaseRoot $checksumName

function Get-Sha256Hex {
  param([string]$Path)

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $hashBytes = $sha256.ComputeHash($stream)
    return (($hashBytes | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
  throw "missing local release ZIP: $zipPath. Run npm run build:all-local first."
}
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
  throw "missing local release ZIP checksum: $checksumPath. Run npm run build:all-local first."
}

$checksumText = (Get-Content -LiteralPath $checksumPath -Raw -Encoding UTF8).Trim()
if ($checksumText -notmatch '^([0-9a-fA-F]{64})\s+\*?xsheet-remap\.zip$') {
  throw "invalid ZIP checksum file: $checksumPath"
}
$expectedHash = $Matches[1].ToUpperInvariant()
$actualHash = (Get-Sha256Hex $zipPath).ToUpperInvariant()
if ($actualHash -ne $expectedHash) {
  throw "ZIP checksum mismatch: expected $expectedHash, got $actualHash"
}

if (-not $SkipLeakCheck) {
  & (Join-Path $repoRoot "tools/checks/repo-hygiene.ps1") -IncludeLocalRelease
  if ($LASTEXITCODE -ne 0) {
    throw "repo hygiene check failed for local release"
  }
}

New-Item -ItemType Directory -Force -Path $normalizedDestination | Out-Null
Copy-Item -LiteralPath $zipPath -Destination (Join-Path $normalizedDestination $zipName) -Force
Copy-Item -LiteralPath $checksumPath -Destination (Join-Path $normalizedDestination $checksumName) -Force
Write-Host "[publish-handoff] copied $zipName and $checksumName to $normalizedDestination"
