param(
  [string]$TagName = "latest",
  [string]$ReleaseTitle = "xsheet-remap",
  [string]$ZipPath = "",
  [string]$ChecksumPath = "",
  [switch]$SkipBuildArtifactCheck,
  [switch]$SkipMainPush,
  [switch]$KeepUnexpectedAssets,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$versionPath = Join-Path $repoRoot "VERSION"
$defaultZipPath = Join-Path $repoRoot "release-local\xsheet-remap.zip"
$defaultChecksumPath = Join-Path $repoRoot "release-local\xsheet-remap.zip.sha256"
$releaseZipPath = if ($ZipPath) { [System.IO.Path]::GetFullPath($ZipPath) } else { $defaultZipPath }
$releaseChecksumPath = if ($ChecksumPath) { [System.IO.Path]::GetFullPath($ChecksumPath) } else { $defaultChecksumPath }
$expectedAssetNames = @("xsheet-remap.zip", "xsheet-remap.zip.sha256")
$expectedPackageRootNames = @(
  "assets",
  "CHECKSUMS.sha256",
  "csp-import-helper",
  "README.txt",
  "RELEASE.json",
  "xsheet-corrector.exe",
  "xsheet-editor.exe",
  "xsheet-importer.exe",
  "xsheet-remap.exe",
  "xsheet-template.exe"
)

. (Join-Path $PSScriptRoot "release-inventory.ps1")

function Invoke-ExternalCommand {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  if ($DryRun) {
    Write-Host "[github-release] dry-run: $FilePath $($ArgumentList -join ' ')"
    return
  }

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Get-ExternalCommandOutput {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [switch]$AllowFailure
  )

  $output = & $FilePath @ArgumentList 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    $text = ($output | Out-String).Trim()
    throw "$FilePath $($ArgumentList -join ' ') failed with exit code ${exitCode}: $text"
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Text = ($output | Out-String).Trim()
  }
}

function Assert-CommandAvailable {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "required command not found on PATH: $Name"
  }
}

function Assert-CleanWorktree {
  $status = Get-ExternalCommandOutput -FilePath "git" -ArgumentList @("status", "--porcelain")
  if (-not [string]::IsNullOrWhiteSpace($status.Text)) {
    throw "refusing to create GitHub release with uncommitted changes:`n$($status.Text)"
  }
}

function Assert-OnMainBranch {
  $branch = Get-ExternalCommandOutput -FilePath "git" -ArgumentList @("branch", "--show-current")
  if ($branch.Text -ne "main") {
    throw "GitHub release must be created from main; current branch is '$($branch.Text)'"
  }
}

function Assert-AssetPath {
  param(
    [string]$Path,
    [string]$ExpectedName
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "missing release asset: $Path"
  }
  $actualName = [System.IO.Path]::GetFileName($Path)
  if ($actualName -ne $ExpectedName) {
    throw "release asset name must stay fixed as $ExpectedName; got $actualName"
  }
}

function Get-ReleaseJson {
  param([string]$Tag)

  $result = Get-ExternalCommandOutput `
    -FilePath "gh" `
    -ArgumentList @("release", "view", $Tag, "--json", "assets,isImmutable,url") `
    -AllowFailure

  if ($result.ExitCode -ne 0) {
    return $null
  }
  return $result.Text | ConvertFrom-Json
}

Push-Location $repoRoot
try {
  Assert-CommandAvailable "git"
  Assert-CommandAvailable "gh"

  if (-not (Test-Path -LiteralPath $versionPath -PathType Leaf)) {
    throw "missing VERSION file: $versionPath"
  }

  $version = (Get-Content -LiteralPath $versionPath -Raw -Encoding UTF8).Trim()
  if ($version -notmatch '^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$') {
    throw "VERSION must contain only the release version, got: $version"
  }

  Assert-CleanWorktree
  Assert-OnMainBranch

  if (-not $SkipBuildArtifactCheck) {
    Assert-AssetPath -Path $releaseZipPath -ExpectedName "xsheet-remap.zip"
    Assert-AssetPath -Path $releaseChecksumPath -ExpectedName "xsheet-remap.zip.sha256"
    Assert-ReleaseZipChecksum `
      -ArchivePath $releaseZipPath `
      -ArchiveChecksumPath $releaseChecksumPath `
      -ExpectedArchiveName "xsheet-remap.zip"
    Assert-ReleaseZipInventory `
      -ArchivePath $releaseZipPath `
      -ExpectedPackageName "xsheet-remap" `
      -ExpectedRootNames $expectedPackageRootNames
  }

  $head = (Get-ExternalCommandOutput -FilePath "git" -ArgumentList @("rev-parse", "HEAD")).Text

  if ($DryRun) {
    Write-Host "[github-release] dry-run: fixed release tag: $TagName"
    Write-Host "[github-release] dry-run: release title: $ReleaseTitle"
    Write-Host "[github-release] dry-run: release notes: $version"
    Write-Host "[github-release] dry-run: release commit: $head"
    Write-Host "[github-release] dry-run: asset: $releaseZipPath"
    Write-Host "[github-release] dry-run: asset: $releaseChecksumPath"
    return
  }

  Invoke-ExternalCommand -FilePath "gh" -ArgumentList @("auth", "status")

  if (-not $SkipMainPush) {
    Invoke-ExternalCommand -FilePath "git" -ArgumentList @("push", "origin", "main")
  }

  Invoke-ExternalCommand -FilePath "git" -ArgumentList @("tag", "-f", $TagName, $head)
  Invoke-ExternalCommand -FilePath "git" -ArgumentList @("push", "origin", "refs/tags/$TagName", "--force")

  $release = Get-ReleaseJson -Tag $TagName
  if ($null -eq $release) {
    Invoke-ExternalCommand `
      -FilePath "gh" `
      -ArgumentList @(
        "release", "create", $TagName,
        $releaseZipPath,
        $releaseChecksumPath,
        "--title", $ReleaseTitle,
        "--notes", $version,
        "--latest",
        "--verify-tag"
      )
    $release = Get-ReleaseJson -Tag $TagName
  } else {
    if ($release.isImmutable) {
      throw "GitHub release '$TagName' is immutable and cannot be updated with fixed-asset release flow."
    }
    Invoke-ExternalCommand `
      -FilePath "gh" `
      -ArgumentList @(
        "release", "edit", $TagName,
        "--title", $ReleaseTitle,
        "--notes", $version,
        "--latest",
        "--draft=false",
        "--prerelease=false"
      )
    Invoke-ExternalCommand `
      -FilePath "gh" `
      -ArgumentList @(
        "release", "upload", $TagName,
        $releaseZipPath,
        $releaseChecksumPath,
        "--clobber"
      )
    $release = Get-ReleaseJson -Tag $TagName
  }

  if (-not $KeepUnexpectedAssets -and $null -ne $release -and $null -ne $release.assets) {
    foreach ($asset in $release.assets) {
      if ($expectedAssetNames -notcontains $asset.name) {
        Invoke-ExternalCommand -FilePath "gh" -ArgumentList @("release", "delete-asset", $TagName, $asset.name, "--yes")
      }
    }
  }

  $release = Get-ReleaseJson -Tag $TagName
  $releaseUrl = if ($null -ne $release -and $release.url) { $release.url } else { "(release URL unavailable)" }
  Write-Host "[github-release] updated fixed release $TagName at $head"
  Write-Host "[github-release] version: $version"
  Write-Host "[github-release] url: $releaseUrl"
} finally {
  Pop-Location
}
