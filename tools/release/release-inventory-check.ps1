param(
  [string]$ReleaseRoot = "",
  [string]$ZipPath = "",
  [string]$ChecksumPath = "",
  [string]$PackageName = "xsheet-remap",
  [Parameter(Mandatory = $true)]
  [string]$ExpectedRootsBase64
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "release-inventory.ps1")

$expectedRootsText = [System.Text.Encoding]::UTF8.GetString(
  [System.Convert]::FromBase64String($ExpectedRootsBase64)
)
$expectedRootNames = @($expectedRootsText -split "`r?`n" | Where-Object { $_ -ne "" })
if ([string]::IsNullOrWhiteSpace($ReleaseRoot) -and [string]::IsNullOrWhiteSpace($ZipPath)) {
  throw "ReleaseRoot or ZipPath is required"
}
if (-not [string]::IsNullOrWhiteSpace($ReleaseRoot)) {
  Assert-ReleaseRootInventory -RootPath $ReleaseRoot -ExpectedRootNames $expectedRootNames
}
if (-not [string]::IsNullOrWhiteSpace($ZipPath)) {
  if (-not [string]::IsNullOrWhiteSpace($ChecksumPath)) {
    Assert-ReleaseZipChecksum `
      -ArchivePath $ZipPath `
      -ArchiveChecksumPath $ChecksumPath `
      -ExpectedArchiveName "$PackageName.zip"
  }
  Assert-ReleaseZipInventory `
    -ArchivePath $ZipPath `
    -ExpectedRootNames $expectedRootNames
}
if (-not [string]::IsNullOrWhiteSpace($ChecksumPath) -and [string]::IsNullOrWhiteSpace($ZipPath)) {
  throw "ZipPath is required when ChecksumPath is provided"
}

Write-Host "[release-inventory] passed"
