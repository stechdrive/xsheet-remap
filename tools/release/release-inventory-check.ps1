param(
  [string]$ReleaseRoot = "",
  [string]$ZipPath = "",
  [string]$VerificationPath = "",
  [string]$ExpectedVersion = "",
  [string]$ExpectedCommit = "",
  [string]$BuildStatePath = "",
  [string]$ReadmePath = "",
  [string]$ExpectedRootsBase64 = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "release-inventory.ps1")

$expectedRootNames = @(Get-ReleasePackageFileNames)
if ($ExpectedRootsBase64) {
  $expectedRootsText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ExpectedRootsBase64))
  $expectedRootNames = @($expectedRootsText -split "`r?`n" | Where-Object { $_ -ne "" })
}
if ([string]::IsNullOrWhiteSpace($ReleaseRoot) -and [string]::IsNullOrWhiteSpace($ZipPath)) {
  throw "ReleaseRoot or ZipPath is required"
}
if (-not [string]::IsNullOrWhiteSpace($ReleaseRoot)) {
  Assert-ReleaseRootInventory -RootPath $ReleaseRoot -ExpectedRootNames $expectedRootNames
}
if (-not [string]::IsNullOrWhiteSpace($ZipPath)) {
  if (-not [string]::IsNullOrWhiteSpace($VerificationPath)) {
    Assert-ReleaseZipChecksum `
      -ArchivePath $ZipPath `
      -VerificationPath $VerificationPath
  }
  Assert-ReleaseZipInventory `
    -ArchivePath $ZipPath `
    -ExpectedRootNames $expectedRootNames
  if ($BuildStatePath) {
    if (-not $ExpectedVersion -or -not $ExpectedCommit -or -not $VerificationPath -or -not $ReadmePath) { throw "Version, commit, verification record and README are required with BuildStatePath" }
    Assert-ReleaseZipBuildIdentity -ArchivePath $ZipPath -ExpectedVersion $ExpectedVersion -ExpectedCommit $ExpectedCommit -BuildStatePath $BuildStatePath -VerificationPath $VerificationPath -ReadmePath $ReadmePath
  }
}
if (-not [string]::IsNullOrWhiteSpace($VerificationPath) -and [string]::IsNullOrWhiteSpace($ZipPath)) {
  throw "ZipPath is required when VerificationPath is provided"
}

Write-Host "[release-inventory] passed"
