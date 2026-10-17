param(
  [switch]$SkipDesktop,
  [switch]$SkipLeakCheck,
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "release-inventory.ps1")

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$releaseRoot = if ($OutputDir) {
  [System.IO.Path]::GetFullPath($OutputDir)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repoRoot "release-local"))
}
$releasePackageName = "xsheet-remap"

function Test-IsInsideOrEqualPath {
  param(
    [string]$Path,
    [string]$Directory
  )

  $pathTrimChars = [char[]]@(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd($pathTrimChars)
  $fullDirectory = [System.IO.Path]::GetFullPath($Directory).TrimEnd($pathTrimChars)
  return (
    $fullPath.Equals($fullDirectory, [System.StringComparison]::OrdinalIgnoreCase) -or
    $fullPath.StartsWith(
      $fullDirectory + [System.IO.Path]::DirectorySeparatorChar,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  )
}

function Assert-PathInsideRepository {
  param([string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-IsInsideOrEqualPath -Path $fullPath -Directory $repoRoot)) {
    throw "refusing to write local release output outside repository: $fullPath"
  }
}

function Remove-DirectorySafely {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $fullPath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
  if (-not (Test-IsInsideOrEqualPath -Path $fullPath -Directory $releaseRoot)) {
    throw "refusing to remove directory outside local release root: $fullPath"
  }

  Remove-Item -LiteralPath $fullPath -Recurse -Force
}

function Remove-ReleasePathSafely {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $fullPath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
  if (-not (Test-IsInsideOrEqualPath -Path $fullPath -Directory $releaseRoot)) {
    throw "refusing to remove path outside local release root: $fullPath"
  }

  Remove-Item -LiteralPath $fullPath -Recurse -Force
}

function Remove-RepositoryTempPathSafely {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $fullPath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
  $allowedRoot = Join-Path $repoRoot ".tmp\local-release-zip"
  if (-not (Test-IsInsideOrEqualPath -Path $fullPath -Directory $allowedRoot)) {
    throw "refusing to remove path outside local release ZIP temp root: $fullPath"
  }

  Remove-Item -LiteralPath $fullPath -Recurse -Force
}

function Get-RepoRelativePath {
  param([string]$Path)
  return Get-RelativePath -BasePath $repoRoot -Path $Path
}

function Get-ReleaseRelativePath {
  param([string]$Path)
  return Get-RelativePath -BasePath $releaseRoot -Path $Path
}

function Get-RelativePath {
  param(
    [string]$BasePath,
    [string]$Path
  )

  $resolvedBasePath = [System.IO.Path]::GetFullPath($BasePath)
  if (-not $resolvedBasePath.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $resolvedBasePath += [System.IO.Path]::DirectorySeparatorChar
  }
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $baseUri = New-Object System.Uri -ArgumentList $resolvedBasePath
  $pathUri = New-Object System.Uri -ArgumentList $resolvedPath
  return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace("/", "/")
}

function Copy-RequiredFile {
  param(
    [string]$SourceRelativePath,
    [string]$DestinationName,
    [string]$ComponentName,
    [System.Collections.Generic.List[object]]$Components
  )

  $sourcePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $SourceRelativePath))
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "missing required build output for ${ComponentName}: $sourcePath"
  }

  $destinationPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $DestinationName))
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  $Components.Add([pscustomobject]@{
    name = $ComponentName
    type = "file"
    status = "copied"
    path = Get-ReleaseRelativePath $destinationPath
  })
  Write-Host "[local-package] copied $ComponentName to $(Get-ReleaseRelativePath $destinationPath)"
}

function Add-PreservedFile {
  param(
    [string]$DestinationName,
    [string]$ComponentName,
    [System.Collections.Generic.List[object]]$Components
  )

  $path = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $DestinationName))
  if (-not (Test-Path -LiteralPath $path)) {
    return
  }

  $Components.Add([pscustomobject]@{
    name = $ComponentName
    type = "file"
    status = "preserved"
    path = Get-ReleaseRelativePath $path
  })
}

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

function New-LocalReleaseZip {
  param(
    [string]$PackageName,
    [string[]]$ExpectedRootNames
  )

  $zipPath = Join-Path $releaseRoot "$PackageName.zip"
  $zipChecksumPath = Join-Path $releaseRoot "$PackageName.zip.sha256"
  Remove-ReleasePathSafely $zipPath
  Remove-ReleasePathSafely $zipChecksumPath
  Assert-ReleaseRootInventory `
    -RootPath $releaseRoot `
    -ExpectedRootNames $ExpectedRootNames

  $stageRoot = Join-Path $repoRoot ".tmp\local-release-zip\$([System.Guid]::NewGuid().ToString("N"))"

  try {
    New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

    foreach ($rootName in $ExpectedRootNames) {
      $sourcePath = Join-Path $releaseRoot $rootName
      Copy-Item -LiteralPath $sourcePath -Destination $stageRoot -Recurse -Force
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
      $stageRoot,
      $zipPath,
      [System.IO.Compression.CompressionLevel]::Optimal,
      $false
    )

    Assert-ReleaseZipInventory `
      -ArchivePath $zipPath `
      -ExpectedRootNames $ExpectedRootNames

    $zipHash = Get-Sha256Hex $zipPath
    ("{0}  {1}" -f $zipHash, "$PackageName.zip") |
      Set-Content -LiteralPath $zipChecksumPath -Encoding UTF8
    Write-Host "[local-package] packaged $PackageName.zip with release files at the archive root"
  } finally {
    Remove-RepositoryTempPathSafely $stageRoot
  }
}

Assert-PathInsideRepository $releaseRoot
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$components = New-Object System.Collections.Generic.List[object]
$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$expectedReleaseVersion = [string]$packageJson.version
$releaseGuideName = "README.txt"
$releaseGuideSource = Join-Path $repoRoot "release-assets\$releaseGuideName"
$releaseGuidePath = Join-Path $releaseRoot $releaseGuideName
if (-not (Test-Path -LiteralPath $releaseGuideSource)) {
  throw "missing release guide: $releaseGuideSource"
}
Copy-Item -LiteralPath $releaseGuideSource -Destination $releaseGuidePath -Force
$thirdPartyNoticeName = "THIRD_PARTY_NOTICES.md"
$thirdPartyNoticeSource = Join-Path $repoRoot $thirdPartyNoticeName
$thirdPartyNoticePath = Join-Path $releaseRoot $thirdPartyNoticeName
if (-not (Test-Path -LiteralPath $thirdPartyNoticeSource)) {
  throw "missing third-party notices: $thirdPartyNoticeSource"
}
Copy-Item -LiteralPath $thirdPartyNoticeSource -Destination $thirdPartyNoticePath -Force

$desktopComponents = @(
  [pscustomobject]@{
    Key = "remap"
    Name = "xsheet-remap"
    Source = ".cache/cargo-target/release/xsheet-remap.exe"
    Destination = "xsheet-remap.exe"
  },
  [pscustomobject]@{
    Key = "corrector"
    Name = "xsheet-corrector"
    Source = ".cache/cargo-target/release/xsheet-corrector.exe"
    Destination = "xsheet-corrector.exe"
  }
)

function Assert-CoherentDesktopBuildState {
  param(
    [object[]]$DesktopComponents,
    [string]$ExpectedVersion
  )

  $statePath = Join-Path $repoRoot "dev-local\build-state.json"
  if (-not (Test-Path -LiteralPath $statePath)) {
    throw "desktop build state is missing: $statePath. Run npm run build:release:desktop before packaging."
  }

  try {
    $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "desktop build state is unreadable: $statePath. Run npm run build:release:desktop before packaging."
  }

  if ([string]$state.mode -ne "coherent") {
    throw "desktop outputs are $($state.mode), not a coherent two-app build. Run npm run build:release:desktop before packaging."
  }
  if (-not $state.applications) {
    throw "desktop build state has no application records. Run npm run build:release:desktop before packaging."
  }

  $sessionIds = New-Object System.Collections.Generic.List[string]
  foreach ($component in $DesktopComponents) {
    $stateProperty = $state.applications.PSObject.Properties[$component.Key]
    if (-not $stateProperty) {
      throw "desktop build state is missing $($component.Key). Run npm run build:release:desktop before packaging."
    }

    $applicationState = $stateProperty.Value
    if ([string]$applicationState.version -ne $ExpectedVersion) {
      throw "$($component.Name) build version $($applicationState.version) does not match $ExpectedVersion. Run npm run build:release:desktop before packaging."
    }
    if ([string]::IsNullOrWhiteSpace([string]$applicationState.buildSessionId)) {
      throw "$($component.Name) has no desktop build session. Run npm run build:release:desktop before packaging."
    }
    $sessionIds.Add([string]$applicationState.buildSessionId)

    $sourcePath = Join-Path $repoRoot $component.Source
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "missing desktop build output: $sourcePath"
    }
    $actualHash = Get-Sha256Hex $sourcePath
    if ($actualHash -ne [string]$applicationState.sha256) {
      throw "$($component.Name) output changed after its recorded build session. Run npm run build:release:desktop before packaging."
    }
  }

  if (@($sessionIds | Sort-Object -Unique).Count -ne 1) {
    throw "desktop outputs were produced by different build sessions. Run npm run build:release:desktop before packaging."
  }
}

if (-not $SkipDesktop) {
  Assert-CoherentDesktopBuildState `
    -DesktopComponents $desktopComponents `
    -ExpectedVersion $expectedReleaseVersion
}

Remove-ReleasePathSafely (Join-Path $releaseRoot "xsheet-template-editor.exe")

foreach ($desktopComponent in $desktopComponents) {
  if ($SkipDesktop) {
    Add-PreservedFile `
      -DestinationName $desktopComponent.Destination `
      -ComponentName $desktopComponent.Name `
      -Components $components
  } else {
    Copy-RequiredFile `
      -SourceRelativePath $desktopComponent.Source `
      -DestinationName $desktopComponent.Destination `
      -ComponentName $desktopComponent.Name `
      -Components $components
  }
}

# Remove only known retired product outputs inside the validated release root.
foreach ($retired in @("xsheet-template.exe", "xsheet-editor.exe", "xsheet-importer.exe", "xsheet-csp-import-helper.exe", "xsheet-csp-import-helper.bat", "csp-import-helper", "csp-import-helper-cli", "assets", "_internal")) {
  Remove-ReleasePathSafely (Join-Path $releaseRoot $retired)
}

$commit = ""
try {
  $commit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
} catch {
  $commit = ""
}

$releaseManifest = [ordered]@{
  schemaVersion = 1
  name = "xsheet-remap local release"
  version = $packageJson.version
  commit = $commit
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  components = $components
}
$releaseManifestPath = Join-Path $releaseRoot "RELEASE.json"
$releaseManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $releaseManifestPath -Encoding UTF8

$checksumTargets = @(
  "xsheet-remap.exe",
  "xsheet-corrector.exe",
  "README.txt",
  "THIRD_PARTY_NOTICES.md",
  "RELEASE.json"
)
$checksumLines = New-Object System.Collections.Generic.List[string]
foreach ($relativePath in $checksumTargets) {
  $targetPath = Join-Path $releaseRoot ($relativePath -replace "/", "\")
  if (Test-Path -LiteralPath $targetPath) {
    $checksumLines.Add(("{0}  {1}" -f (Get-Sha256Hex $targetPath), $relativePath))
  }
}
$checksumLines | Set-Content -LiteralPath (Join-Path $releaseRoot "CHECKSUMS.sha256") -Encoding UTF8

$expectedReleaseRootNames = New-Object System.Collections.Generic.List[string]
@("README.txt", "THIRD_PARTY_NOTICES.md", "RELEASE.json", "CHECKSUMS.sha256") |
  ForEach-Object { $expectedReleaseRootNames.Add($_) }
foreach ($desktopComponent in $desktopComponents) {
  if (Test-Path -LiteralPath (Join-Path $releaseRoot $desktopComponent.Destination) -PathType Leaf) {
    $expectedReleaseRootNames.Add($desktopComponent.Destination)
  }
}
New-LocalReleaseZip `
  -PackageName $releasePackageName `
  -ExpectedRootNames @($expectedReleaseRootNames)

if (-not $SkipLeakCheck) {
  & (Join-Path $repoRoot "tools/checks/repo-hygiene.ps1") -IncludeLocalRelease
  if ($LASTEXITCODE -ne 0) {
    throw "repo hygiene check failed for local release"
  }
}

Write-Host "[local-package] ready: $releaseRoot"
