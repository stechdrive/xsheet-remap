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
    [string[]]$ExpectedRootNames
  )

  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    throw "release ZIP does not exist: $ArchivePath"
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
        $hasUnsafeSegment
      ) {
        $invalidPaths.Add($entryName)
        continue
      }

      $actualRootNames.Add($segments[0])
    }

    if ($invalidPaths.Count -gt 0) {
      throw (
        "release ZIP '$ArchivePath' contains unsafe paths: " +
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

function Assert-ReleaseZipBuildIdentity {
  param(
    [string]$ArchivePath,
    [string]$ExpectedVersion,
    [string]$ExpectedCommit,
    [string]$BuildStatePath
  )

  $buildState = Get-Content -LiteralPath $BuildStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($buildState.mode -ne "coherent") { throw "release requires a coherent desktop build" }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $manifestEntries = @($archive.Entries | Where-Object { $_.FullName -eq "RELEASE.json" })
    if ($manifestEntries.Count -ne 1) { throw "release ZIP must contain exactly one RELEASE.json" }
    $reader = [System.IO.StreamReader]::new($manifestEntries[0].Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($manifest.version -ne $ExpectedVersion -or $manifest.commit -ne $ExpectedCommit) {
      throw "release ZIP does not match the current version and commit"
    }
    foreach ($app in @("editor", "remap", "template", "corrector")) {
      $record = $buildState.applications.$app
      $name = "xsheet-$app.exe"
      if ($record.version -ne $ExpectedVersion -or $record.commit -ne $ExpectedCommit -or
          $record.workingTreeDirty -ne $false -or $record.executable -ne $name) {
        throw "release build record for $name does not match the current clean commit"
      }
      $entries = @($archive.Entries | Where-Object { $_.FullName -eq $name })
      if ($entries.Count -ne 1) { throw "release ZIP must contain exactly one $name" }
      $stream = $entries[0].Open()
      $hasher = [System.Security.Cryptography.SHA256]::Create()
      try {
        $actual = ($hasher.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join ""
        if ($actual -ne $record.sha256) { throw "release ZIP $name differs from the verified desktop build" }
      } finally { $stream.Dispose(); $hasher.Dispose() }
    }
  } finally { $archive.Dispose() }
}
