$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-NormalizedExpectedReleaseRoots {
  param([string[]]$ExpectedRootNames)

  $normalized = @(
    $ExpectedRootNames |
      ForEach-Object {
        $name = [string]$_
        if (
          [string]::IsNullOrWhiteSpace($name) -or
          $name -in @(".", "..") -or
          $name -match '[\\/]'
        ) {
          throw "release inventory root names must be single path segments: '$name'"
        }
        $name
      } |
      Sort-Object -Unique
  )

  if ($normalized.Count -ne @($ExpectedRootNames).Count) {
    throw "release inventory contains duplicate expected root names"
  }
  return $normalized
}

function Assert-ReleaseInventorySet {
  param(
    [string[]]$ActualRootNames,
    [string[]]$ExpectedRootNames,
    [string]$Context
  )

  $expected = @(Get-NormalizedExpectedReleaseRoots -ExpectedRootNames $ExpectedRootNames)
  $actual = @($ActualRootNames | Sort-Object -Unique)
  $missing = @($expected | Where-Object { $actual -notcontains $_ })
  $unexpected = @($actual | Where-Object { $expected -notcontains $_ })

  if ($missing.Count -gt 0 -or $unexpected.Count -gt 0) {
    $missingText = if ($missing.Count -gt 0) { $missing -join ", " } else { "none" }
    $unexpectedText = if ($unexpected.Count -gt 0) { $unexpected -join ", " } else { "none" }
    throw "$Context inventory mismatch: missing=[$missingText]; unexpected=[$unexpectedText]"
  }
}

function Assert-ReleaseRootInventory {
  param(
    [string]$RootPath,
    [string[]]$ExpectedRootNames
  )

  if (-not (Test-Path -LiteralPath $RootPath -PathType Container)) {
    throw "release root does not exist: $RootPath"
  }

  $actualRootNames = @(
    Get-ChildItem -LiteralPath $RootPath -Force |
      ForEach-Object { $_.Name }
  )
  Assert-ReleaseInventorySet `
    -ActualRootNames $actualRootNames `
    -ExpectedRootNames $ExpectedRootNames `
    -Context "release root '$RootPath'"
}

function Get-ReleaseFileSha256Hex {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "release file does not exist: $Path"
  }

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return (($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
}

function Assert-ReleaseZipChecksum {
  param(
    [string]$ArchivePath,
    [string]$ArchiveChecksumPath,
    [string]$ExpectedArchiveName
  )

  if (-not (Test-Path -LiteralPath $ArchiveChecksumPath -PathType Leaf)) {
    throw "release checksum file does not exist: $ArchiveChecksumPath"
  }
  $checksumText = (Get-Content -LiteralPath $ArchiveChecksumPath -Raw -Encoding UTF8).Trim()
  $escapedArchiveName = [regex]::Escape($ExpectedArchiveName)
  if ($checksumText -notmatch "^([0-9A-Fa-f]{64})\s+\*?$escapedArchiveName$") {
    throw "release checksum file has an invalid format: $ArchiveChecksumPath"
  }

  $expectedHash = $Matches[1].ToLowerInvariant()
  $actualHash = Get-ReleaseFileSha256Hex -Path $ArchivePath
  if ($actualHash -ne $expectedHash) {
    throw "release ZIP checksum mismatch: expected $expectedHash, got $actualHash"
  }
}

function Assert-ReleaseZipInventory {
  param(
    [string]$ArchivePath,
    [string]$ExpectedPackageName,
    [string[]]$ExpectedRootNames
  )

  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    throw "release ZIP does not exist: $ArchivePath"
  }
  if (
    [string]::IsNullOrWhiteSpace($ExpectedPackageName) -or
    $ExpectedPackageName -in @(".", "..") -or
    $ExpectedPackageName -match '[\\/]'
  ) {
    throw "release package name must be one path segment: '$ExpectedPackageName'"
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $actualRootNames = New-Object System.Collections.Generic.List[string]
    $invalidPaths = New-Object System.Collections.Generic.List[string]

    foreach ($entry in $archive.Entries) {
      $entryName = ([string]$entry.FullName).Replace("\", "/")
      if ([string]::IsNullOrWhiteSpace($entryName)) {
        $invalidPaths.Add("(empty)")
        continue
      }

      $segments = @($entryName -split '/' | Where-Object { $_ -ne "" })
      $hasUnsafeSegment = @($segments | Where-Object { $_ -in @(".", "..") }).Count -gt 0
      if (
        $entryName.StartsWith("/", [System.StringComparison]::Ordinal) -or
        $entryName.Contains("//") -or
        $segments.Count -eq 0 -or
        $segments[0] -ne $ExpectedPackageName -or
        $hasUnsafeSegment
      ) {
        $invalidPaths.Add($entryName)
        continue
      }

      if ($segments.Count -ge 2) {
        $actualRootNames.Add($segments[1])
      }
    }

    if ($invalidPaths.Count -gt 0) {
      throw (
        "release ZIP '$ArchivePath' contains paths outside the expected package root: " +
        (@($invalidPaths | Sort-Object -Unique) -join ", ")
      )
    }

    Assert-ReleaseInventorySet `
      -ActualRootNames @($actualRootNames) `
      -ExpectedRootNames $ExpectedRootNames `
      -Context "release ZIP '$ArchivePath'"
  } finally {
    $archive.Dispose()
  }
}
