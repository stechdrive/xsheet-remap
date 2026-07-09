param(
  [switch]$SkipDesktop,
  [switch]$SkipHelper,
  [switch]$RequireHelper,
  [switch]$IncludeHelperCli,
  [switch]$SkipLeakCheck,
  [switch]$SkipDistributionCopy,
  [string]$DistributionCopyDir = "",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $repoRoot "tools\release\local-settings.ps1")
$releaseRoot = if ($OutputDir) {
  [System.IO.Path]::GetFullPath($OutputDir)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repoRoot "release-local"))
}
$releasePackageName = "xsheet-remap"
$distributionCopyDirectory = Resolve-XsheetReleaseCopyDirectory -RepoRoot $repoRoot -ExplicitDirectory $DistributionCopyDir
$hasDistributionCopyDirectory = -not [string]::IsNullOrWhiteSpace($distributionCopyDirectory)
$shouldCopyDistributionZip = -not $SkipDistributionCopy -and (
  $hasDistributionCopyDirectory
)

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

function Copy-HelperDirectory {
  param(
    [string]$SourceDirectory,
    [string]$DestinationName,
    [string]$ComponentName,
    [System.Collections.Generic.List[object]]$Components
  )

  $destinationPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $DestinationName))
  Remove-DirectorySafely $destinationPath
  Copy-Item -LiteralPath $SourceDirectory -Destination $destinationPath -Recurse -Force
  $exeName = Split-Path -Leaf $SourceDirectory
  $exePath = Join-Path $destinationPath "$exeName.exe"
  $Components.Add([pscustomobject]@{
    name = $ComponentName
    type = "onedir"
    status = "copied"
    path = Get-ReleaseRelativePath $destinationPath
    exe = if (Test-Path -LiteralPath $exePath) { Get-ReleaseRelativePath $exePath } else { "" }
  })
  Write-Host "[local-package] copied $ComponentName to $(Get-ReleaseRelativePath $destinationPath)"
}

function Get-HelperLauncherVersion {
  param([string]$LauncherPath)

  if (-not (Test-Path -LiteralPath $LauncherPath)) {
    throw "missing helper launcher for version check: $LauncherPath"
  }

  $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $extension = [System.IO.Path]::GetExtension($LauncherPath).ToLowerInvariant()
  if ($extension -in @(".bat", ".cmd")) {
    $processInfo.FileName = if ($env:ComSpec) { $env:ComSpec } else { "cmd.exe" }
    $processInfo.Arguments = "/d /s /c `"`"$LauncherPath`" --version`""
  } else {
    $processInfo.FileName = $LauncherPath
    $processInfo.Arguments = "--version"
  }
  $processInfo.UseShellExecute = $false
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $processInfo.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::Start($processInfo)
  if (-not $process.WaitForExit(15000)) {
    try {
      $process.Kill()
    } catch {
      # Ignore cleanup failures; the caller gets the timeout error below.
    }
    throw "timed out while reading helper version from ${LauncherPath}"
  }

  $output = @($process.StandardOutput.ReadToEnd(), $process.StandardError.ReadToEnd()) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $exitCode = $process.ExitCode
  if ($exitCode -ne 0) {
    throw "failed to read helper version from ${LauncherPath}: exit code $exitCode"
  }

  $text = (@($output) | ForEach-Object { [string]$_ }) -join "`n"
  if ($text -match 'xsheet-csp-import-helper\s+([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)') {
    return $Matches[1]
  }
  if ($text -match '([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)') {
    return $Matches[1]
  }

  throw "failed to parse helper version from ${LauncherPath}: $text"
}

function Assert-HelperLauncherVersion {
  param(
    [string]$LauncherPath,
    [string]$ExpectedVersion
  )

  $actualVersion = Get-HelperLauncherVersion -LauncherPath $LauncherPath
  if ($actualVersion -ne $ExpectedVersion) {
    throw (
      "CSP import helper version mismatch: expected $ExpectedVersion, got $actualVersion at $LauncherPath. " +
      "Run npm run build:csp-helper or npm run build:all-local to refresh the helper."
    )
  }
  return $actualVersion
}

function Remove-StaleHelperFromRelease {
  param(
    [string]$LauncherPath,
    [string]$ExpectedVersion
  )

  $actualVersion = Get-HelperLauncherVersion -LauncherPath $LauncherPath
  if ($actualVersion -eq $ExpectedVersion) {
    return $actualVersion
  }

  Write-Host (
    "[local-package] removing stale CSP import helper from local release: " +
    "expected $ExpectedVersion, got $actualVersion. Run npm run build:csp-helper to include it."
  ) -ForegroundColor Yellow
  Remove-ReleasePathSafely $LauncherPath
  Remove-ReleasePathSafely (Join-Path $releaseRoot "xsheet-csp-import-helper.exe")
  Remove-ReleasePathSafely (Join-Path $releaseRoot "_internal")
  Remove-ReleasePathSafely (Join-Path $releaseRoot "csp-import-helper")
  return $null
}

function Copy-HelperDirectoryToReleaseRoot {
  param(
    [string]$SourceDirectory,
    [string]$ComponentName,
    [System.Collections.Generic.List[object]]$Components,
    [string]$Status = "copied"
  )

  $sourcePath = [System.IO.Path]::GetFullPath($SourceDirectory)
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "missing helper portable source: $sourcePath"
  }

  $launcherName = "xsheet-csp-import-helper.bat"
  $sourceLauncherPath = Join-Path $sourcePath $launcherName
  $sourceRuntimePath = Join-Path $sourcePath "csp-import-helper"
  if (-not (Test-Path -LiteralPath $sourceLauncherPath)) {
    throw "missing helper BAT launcher in portable source: $sourceLauncherPath"
  }
  if (-not (Test-Path -LiteralPath $sourceRuntimePath)) {
    throw "missing helper runtime directory in portable source: $sourceRuntimePath"
  }
  $helperVersion = Assert-HelperLauncherVersion -LauncherPath $sourceLauncherPath -ExpectedVersion $expectedReleaseVersion

  $destinationLauncherPath = Join-Path $releaseRoot $launcherName
  $destinationExePath = Join-Path $releaseRoot "xsheet-csp-import-helper.exe"
  $destinationInternalPath = Join-Path $releaseRoot "_internal"
  $destinationRuntimePath = Join-Path $releaseRoot "csp-import-helper"
  Remove-ReleasePathSafely $destinationLauncherPath
  Remove-ReleasePathSafely $destinationExePath
  Remove-ReleasePathSafely $destinationInternalPath
  Remove-ReleasePathSafely $destinationRuntimePath

  Get-ChildItem -LiteralPath $sourcePath -Force |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $releaseRoot -Recurse -Force
    }

  $Components.Add([pscustomobject]@{
    name = $ComponentName
    type = "portable-python-bat"
    status = $Status
    path = "."
    launcher = Get-ReleaseRelativePath $destinationLauncherPath
    runtime = Get-ReleaseRelativePath $destinationRuntimePath
    version = $helperVersion
  })
  Write-Host "[local-package] $Status $ComponentName to release root"
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
  param([string]$PackageName)

  $zipPath = Join-Path $releaseRoot "$PackageName.zip"
  $zipChecksumPath = Join-Path $releaseRoot "$PackageName.zip.sha256"
  Remove-ReleasePathSafely $zipPath
  Remove-ReleasePathSafely $zipChecksumPath

  $stageRoot = Join-Path $repoRoot ".tmp\local-release-zip\$([System.Guid]::NewGuid().ToString("N"))"
  $packageRoot = Join-Path $stageRoot $PackageName

  try {
    New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null

    $excludedRootNames = @(
      "$PackageName.zip",
      "$PackageName.zip.sha256"
    )
    Get-ChildItem -LiteralPath $releaseRoot -Force |
      Where-Object { $excludedRootNames -notcontains $_.Name } |
      ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $packageRoot -Recurse -Force
      }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
      $stageRoot,
      $zipPath,
      [System.IO.Compression.CompressionLevel]::Optimal,
      $false
    )

    $zipHash = Get-Sha256Hex $zipPath
    ("{0}  {1}" -f $zipHash, "$PackageName.zip") |
      Set-Content -LiteralPath $zipChecksumPath -Encoding UTF8
    Write-Host "[local-package] packaged $PackageName.zip with top-level $PackageName/ folder"
  } finally {
    Remove-RepositoryTempPathSafely $stageRoot
  }
}

function Copy-DistributionZip {
  param(
    [string]$PackageName,
    [string]$DestinationDirectory
  )

  $zipPath = Join-Path $releaseRoot "$PackageName.zip"
  $zipChecksumPath = Join-Path $releaseRoot "$PackageName.zip.sha256"
  if (-not (Test-Path -LiteralPath $zipPath)) {
    throw "missing local release ZIP to copy: $zipPath"
  }
  if (-not (Test-Path -LiteralPath $zipChecksumPath)) {
    throw "missing local release ZIP checksum to copy: $zipChecksumPath"
  }

  New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null
  Copy-Item -LiteralPath $zipPath -Destination (Join-Path $DestinationDirectory "$PackageName.zip") -Force
  Copy-Item -LiteralPath $zipChecksumPath -Destination (Join-Path $DestinationDirectory "$PackageName.zip.sha256") -Force
  Write-Host "[local-package] copied $PackageName.zip and checksum to $DestinationDirectory"
}

Assert-PathInsideRepository $releaseRoot
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$components = New-Object System.Collections.Generic.List[object]
$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$expectedReleaseVersion = [string]$packageJson.version

if (-not $SkipDesktop) {
  Copy-RequiredFile `
    -SourceRelativePath "apps/desktop/src-tauri/target/release/xsheet-remap.exe" `
    -DestinationName "xsheet-remap.exe" `
    -ComponentName "xsheet-remap" `
    -Components $components
  Copy-RequiredFile `
    -SourceRelativePath "apps/sheet-corrector/src-tauri/target/release/xsheet-corrector.exe" `
    -DestinationName "xsheet-corrector.exe" `
    -ComponentName "xsheet-corrector" `
    -Components $components
}

$helperDistRoot = Join-Path $repoRoot ".tmp\csp-import-helper-dist"
$helperSource = Join-Path $helperDistRoot "xsheet-csp-import-helper"
$helperCliSource = Join-Path $helperDistRoot "xsheet-csp-import-helper-cli"
$helperLauncherName = "xsheet-csp-import-helper.bat"
$helperLegacyExeName = "xsheet-csp-import-helper.exe"
$helperLauncherPath = Join-Path $releaseRoot $helperLauncherName
$helperLegacyExePath = Join-Path $releaseRoot $helperLegacyExeName
$helperRuntimePath = Join-Path $releaseRoot "csp-import-helper"

if (-not $SkipHelper) {
  if (Test-Path -LiteralPath $helperSource) {
    Copy-HelperDirectoryToReleaseRoot `
      -SourceDirectory $helperSource `
      -ComponentName "xsheet-csp-import-helper" `
      -Components $components
  } elseif ($RequireHelper) {
    throw "missing required CSP import helper portable source: $helperSource"
  } elseif (Test-Path -LiteralPath $helperLauncherPath) {
    $helperVersion = Assert-HelperLauncherVersion -LauncherPath $helperLauncherPath -ExpectedVersion $expectedReleaseVersion
    Remove-ReleasePathSafely $helperLegacyExePath
    Remove-ReleasePathSafely (Join-Path $releaseRoot "_internal")
    $components.Add([pscustomobject]@{
      name = "xsheet-csp-import-helper"
      type = "portable-python-bat"
      status = "preserved"
      path = "."
      launcher = $helperLauncherName
      runtime = Get-ReleaseRelativePath $helperRuntimePath
      version = $helperVersion
    })
  } else {
    Remove-ReleasePathSafely $helperLegacyExePath
    Remove-ReleasePathSafely (Join-Path $releaseRoot "_internal")
    Write-Host "[local-package] helper portable source not found; skipping: $helperSource" -ForegroundColor Yellow
  }

  if ($IncludeHelperCli) {
    if (Test-Path -LiteralPath $helperCliSource) {
      Copy-HelperDirectory `
        -SourceDirectory $helperCliSource `
        -DestinationName "csp-import-helper-cli" `
        -ComponentName "xsheet-csp-import-helper-cli" `
        -Components $components
    } elseif ($RequireHelper) {
      throw "missing required CSP import helper CLI onedir: $helperCliSource"
    } else {
      Write-Host "[local-package] helper CLI onedir not found; skipping: $helperCliSource" -ForegroundColor Yellow
    }
  }
} else {
  if (Test-Path -LiteralPath $helperLauncherPath) {
    $helperVersion = Remove-StaleHelperFromRelease -LauncherPath $helperLauncherPath -ExpectedVersion $expectedReleaseVersion
    if ($helperVersion) {
      Remove-ReleasePathSafely $helperLegacyExePath
      Remove-ReleasePathSafely (Join-Path $releaseRoot "_internal")
      $components.Add([pscustomobject]@{
        name = "xsheet-csp-import-helper"
        type = "portable-python-bat"
        status = "preserved"
        path = "."
        launcher = Get-ReleaseRelativePath $helperLauncherPath
        runtime = Get-ReleaseRelativePath $helperRuntimePath
        version = $helperVersion
      })
    }
  } else {
    Remove-ReleasePathSafely $helperLegacyExePath
    Remove-ReleasePathSafely (Join-Path $releaseRoot "_internal")
  }
}

$commit = ""
try {
  $commit = (& git -C $repoRoot rev-parse --short HEAD 2>$null).Trim()
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
  "xsheet-csp-import-helper.bat",
  "assets/xsheet-remap.laf",
  "csp-import-helper-cli/xsheet-csp-import-helper-cli.exe",
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
New-LocalReleaseZip -PackageName $releasePackageName
if ($shouldCopyDistributionZip) {
  Copy-DistributionZip -PackageName $releasePackageName -DestinationDirectory $distributionCopyDirectory
}

if (-not $SkipLeakCheck) {
  & (Join-Path $repoRoot "tools/checks/repo-hygiene.ps1") -IncludeLocalRelease
  if ($LASTEXITCODE -ne 0) {
    throw "repo hygiene check failed for local release"
  }
}

Write-Host "[local-package] ready: $releaseRoot"
