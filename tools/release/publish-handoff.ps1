param(
  [string]$DestinationDir = "",
  [switch]$SkipLeakCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $repoRoot "tools\release\local-settings.ps1")
. (Join-Path $repoRoot "tools\release\release-inventory.ps1")

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
$zipPath = Join-Path $releaseRoot $zipName
$verificationPath = Join-Path $releaseRoot "package-verification.json"

if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
  throw "missing local release ZIP: $zipPath. Run npm run build:release:all first."
}
Assert-ReleaseZipChecksum -ArchivePath $zipPath -VerificationPath $verificationPath
Assert-ReleaseZipInventory -ArchivePath $zipPath -ExpectedRootNames @(Get-ReleasePackageFileNames)
$version = (Get-Content -LiteralPath (Join-Path $repoRoot "VERSION") -Raw).Trim()
$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "could not determine handoff source commit" }
Assert-ReleaseZipBuildIdentity -ArchivePath $zipPath -ExpectedVersion $version -ExpectedCommit $commit `
  -BuildStatePath (Join-Path $repoRoot "dev-local/build-state.json") `
  -VerificationPath $verificationPath -ReadmePath (Join-Path $repoRoot "release-assets/README.txt")

if (-not $SkipLeakCheck) {
  & (Join-Path $repoRoot "tools/checks/repo-hygiene.ps1") -IncludeLocalRelease
  if ($LASTEXITCODE -ne 0) {
    throw "repo hygiene check failed for local release"
  }
}

New-Item -ItemType Directory -Force -Path $normalizedDestination | Out-Null
Copy-Item -LiteralPath $zipPath -Destination (Join-Path $normalizedDestination $zipName) -Force
Write-Host "[publish-handoff] copied $zipName to $normalizedDestination"
