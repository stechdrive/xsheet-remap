param(
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
    [string]$ComponentName
  )

  $sourcePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $SourceRelativePath))
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "missing required build output for ${ComponentName}: $sourcePath"
  }

  $destinationPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $DestinationName))
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  Write-Host "[local-package] copied $ComponentName to $(Get-ReleaseRelativePath $destinationPath)"
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
  Remove-ReleasePathSafely $zipPath
  Remove-ReleasePathSafely (Join-Path $releaseRoot "package-verification.json")
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

    Write-Host "[local-package] packaged $PackageName.zip with release files at the archive root"
  } finally {
    Remove-RepositoryTempPathSafely $stageRoot
  }
}

Assert-PathInsideRepository $releaseRoot
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$expectedReleaseVersion = [string]$packageJson.version
$releaseGuideName = "README.txt"
$releaseGuideSource = Join-Path $repoRoot "release-assets\$releaseGuideName"
$releaseGuidePath = Join-Path $releaseRoot $releaseGuideName
if (-not (Test-Path -LiteralPath $releaseGuideSource)) {
  throw "missing release guide: $releaseGuideSource"
}
Copy-Item -LiteralPath $releaseGuideSource -Destination $releaseGuidePath -Force

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
  return $state
}

$buildState = Assert-CoherentDesktopBuildState -DesktopComponents $desktopComponents -ExpectedVersion $expectedReleaseVersion
$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -cnotmatch '^[a-f0-9]{40}$') { throw "could not determine package source commit" }
foreach ($component in $desktopComponents) {
  if ($buildState.applications.($component.Key).commit -ne $commit) { throw "desktop build does not match the current commit" }
}

Remove-ReleasePathSafely (Join-Path $releaseRoot "xsheet-template-editor.exe")

foreach ($desktopComponent in $desktopComponents) {
  Copy-RequiredFile `
    -SourceRelativePath $desktopComponent.Source `
    -DestinationName $desktopComponent.Destination `
    -ComponentName $desktopComponent.Name
}

# Remove only known retired product outputs inside the validated release root.
foreach ($retired in @("xsheet-template.exe", "xsheet-editor.exe", "xsheet-importer.exe", "xsheet-csp-import-helper.exe", "xsheet-csp-import-helper.bat", "csp-import-helper", "csp-import-helper-cli", "assets", "_internal", "LICENSE", "LICENSE.txt", "THIRD_PARTY_NOTICES.md", "RELEASE.json", "CHECKSUMS.sha256", "xsheet-remap.zip.sha256")) {
  Remove-ReleasePathSafely (Join-Path $releaseRoot $retired)
}

$expectedReleaseRootNames = @(Get-ReleasePackageFileNames)
New-LocalReleaseZip `
  -PackageName $releasePackageName `
  -ExpectedRootNames @($expectedReleaseRootNames)

# Local verification metadata is deliberately outside the three-file ZIP.
$verification = [ordered]@{
  schemaVersion = 1
  version = $expectedReleaseVersion
  commit = $commit
  buildSessionId = $buildState.applications.remap.buildSessionId
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  archive = [ordered]@{ name = "$releasePackageName.zip"; sha256 = Get-Sha256Hex (Join-Path $releaseRoot "$releasePackageName.zip") }
  files = @($expectedReleaseRootNames | ForEach-Object {
    [ordered]@{ path = $_; sha256 = Get-Sha256Hex (Join-Path $releaseRoot $_) }
  })
}
$verificationPath = Join-Path $releaseRoot "package-verification.json"
$verification | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $verificationPath -Encoding UTF8
Assert-ReleaseZipChecksum -ArchivePath (Join-Path $releaseRoot "$releasePackageName.zip") -VerificationPath $verificationPath

if (-not $SkipLeakCheck) {
  & (Join-Path $repoRoot "tools/checks/repo-hygiene.ps1") -IncludeLocalRelease
  if ($LASTEXITCODE -ne 0) {
    throw "repo hygiene check failed for local release"
  }
}

Write-Host "[local-package] ready: $releaseRoot"
