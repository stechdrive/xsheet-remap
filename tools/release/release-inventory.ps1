$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-ReleasePackageFileNames {
  return @("README.txt", "xsheet-corrector.exe", "xsheet-remap.exe")
}

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
    [string]$VerificationPath
  )

  $verification = Read-ReleasePackageVerification -Path $VerificationPath
  if ([System.IO.Path]::GetFileName($ArchivePath) -cne $verification.archive.name) {
    throw "release ZIP name differs from the package verification record"
  }
  $expectedHash = $verification.archive.sha256
  $actualHash = Get-ReleaseFileSha256Hex -Path $ArchivePath
  if ($actualHash -ne $expectedHash) {
    throw "release ZIP checksum mismatch: expected $expectedHash, got $actualHash"
  }
}

function Read-ReleasePackageVerification {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "release package verification record does not exist: $Path"
  }
  $record = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($record.schemaVersion -ne 1 -or $record.archive.name -cne "xsheet-remap.zip" -or
      $record.archive.sha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $record.version -notmatch '^\d+\.\d+\.\d+$' -or $record.commit -cnotmatch '^[a-f0-9]{40}$' -or
      [string]::IsNullOrWhiteSpace($record.buildSessionId)) {
    throw "invalid release package verification record: $Path"
  }
  $expected = @(Get-ReleasePackageFileNames)
  $names = @($record.files | ForEach-Object { $_.path })
  Assert-ReleaseInventorySet -ActualRootNames $names -ExpectedRootNames $expected -Context "package verification record"
  if ($names.Count -ne $expected.Count) { throw "duplicate package verification file record" }
  foreach ($file in $record.files) {
    if ($expected -cnotcontains $file.path -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$') {
      throw "invalid package verification file record"
    }
  }
  return $record
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
      $entryName = [string]$entry.FullName
      if ([string]::IsNullOrWhiteSpace($entryName)) {
        $invalidPaths.Add("(empty)")
        continue
      }

      if (
        $entryName -match '[\\/:]' -or $entryName -in @(".", "..") -or
        $actualRootNames -contains $entryName -or
        ($ExpectedRootNames -contains $entryName -and $ExpectedRootNames -cnotcontains $entryName)
      ) {
        $invalidPaths.Add($entryName)
        continue
      }

      $actualRootNames.Add($entryName)
    }

    if ($invalidPaths.Count -gt 0) {
      throw (
        "release ZIP '$ArchivePath' contains non-flat, duplicate or unsafe paths: " +
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
    [string]$BuildStatePath,
    [string]$VerificationPath,
    [string]$ReadmePath
  )

  $buildState = Get-Content -LiteralPath $BuildStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($buildState.mode -ne "coherent") { throw "release requires a coherent desktop build" }
  $verification = Read-ReleasePackageVerification -Path $VerificationPath
  if ($verification.version -ne $ExpectedVersion -or $verification.commit -ne $ExpectedCommit) {
    throw "release ZIP does not match the current version and commit"
  }
  Assert-ReleaseZipChecksum -ArchivePath $ArchivePath -VerificationPath $VerificationPath
  Assert-ReleaseZipInventory -ArchivePath $ArchivePath -ExpectedRootNames @(Get-ReleasePackageFileNames)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    foreach ($app in @("remap", "corrector")) {
      $record = $buildState.applications.$app
      $name = "xsheet-$app.exe"
      if ($record.version -ne $ExpectedVersion -or $record.commit -ne $ExpectedCommit -or
          $record.workingTreeDirty -ne $false -or $record.executable -cne $name -or
          $record.buildSessionId -ne $verification.buildSessionId) {
        throw "release build record for $name does not match the current clean commit"
      }
    }
    foreach ($file in $verification.files) {
      $name = $file.path
      $expectedHash = if ($name -eq "README.txt") {
        Get-ReleaseFileSha256Hex -Path $ReadmePath
      } else {
        $app = $name.Replace("xsheet-", "").Replace(".exe", "")
        $buildState.applications.$app.sha256
      }
      if ($file.sha256 -ne $expectedHash) { throw "release package $name differs from current build or guide" }
      $stream = $archive.GetEntry($name).Open()
      $hasher = [System.Security.Cryptography.SHA256]::Create()
      try {
        $actual = ($hasher.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join ""
        if ($actual -ne $expectedHash) { throw "release ZIP $name differs from the verified desktop build or guide" }
      } finally { $stream.Dispose(); $hasher.Dispose() }
    }
  } finally { $archive.Dispose() }
}
