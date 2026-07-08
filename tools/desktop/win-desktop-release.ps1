param(
  [switch]$SkipLeakCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $repoRoot "tools\release\local-settings.ps1")
$releaseExeRelativePath = "apps/desktop/src-tauri/target/release/xsheet-remap.exe"
$releaseExePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $releaseExeRelativePath))
$sheetCorrectorReleaseExeRelativePath = "apps/sheet-corrector/src-tauri/target/release/xsheet-corrector.exe"
$sheetCorrectorReleaseExePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $sheetCorrectorReleaseExeRelativePath))
$developmentCopyDirectory = Resolve-XsheetReleaseCopyDirectory -RepoRoot $repoRoot
$hasDevelopmentCopyDirectory = -not [string]::IsNullOrWhiteSpace($developmentCopyDirectory)
$developmentCopyExePath = if ($hasDevelopmentCopyDirectory) {
  [System.IO.Path]::GetFullPath((Join-Path $developmentCopyDirectory "xsheet-remap.exe"))
} else {
  ""
}
$sheetCorrectorDevelopmentCopyExePath = if ($hasDevelopmentCopyDirectory) {
  [System.IO.Path]::GetFullPath((Join-Path $developmentCopyDirectory "xsheet-corrector.exe"))
} else {
  ""
}

if (-not $releaseExePath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "resolved release executable is outside the repository: $releaseExePath"
}
if (-not $sheetCorrectorReleaseExePath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "resolved sheet corrector executable is outside the repository: $sheetCorrectorReleaseExePath"
}

function Add-RustPathRemapFlag {
  param(
    [System.Collections.Generic.List[string]]$Flags,
    [string]$SourcePath,
    [string]$Replacement
  )

  if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    return
  }

  try {
    $resolvedPath = [System.IO.Path]::GetFullPath($SourcePath)
  } catch {
    return
  }

  $Flags.Add("--remap-path-prefix=$resolvedPath=$Replacement")
}

$rustFlags = New-Object System.Collections.Generic.List[string]
Add-RustPathRemapFlag $rustFlags $repoRoot "/workspace"
Add-RustPathRemapFlag $rustFlags $env:USERPROFILE "/user-profile"
Add-RustPathRemapFlag $rustFlags $env:CARGO_HOME "/cargo-home"
if ($env:USERPROFILE) {
  Add-RustPathRemapFlag $rustFlags ([System.IO.Path]::Combine($env:USERPROFILE, ".cargo")) "/cargo-home"
}
Add-RustPathRemapFlag $rustFlags $env:RUSTUP_HOME "/rustup-home"

$encodedRustFlagSeparator = [string][char]0x1f
$existingEncodedRustFlags = $env:CARGO_ENCODED_RUSTFLAGS
$env:CARGO_ENCODED_RUSTFLAGS = (@(
  if (-not [string]::IsNullOrWhiteSpace($existingEncodedRustFlags)) { $existingEncodedRustFlags }
  $rustFlags
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join $encodedRustFlagSeparator

Push-Location $repoRoot
try {
  if (-not $SkipLeakCheck) {
    & (Join-Path $repoRoot "tools/checks/repo-hygiene.ps1")
    if ($LASTEXITCODE -ne 0) {
      throw "repo hygiene check failed before build"
    }
  }

  node (Join-Path $repoRoot "tools/version/sync-version.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "build version sync failed with exit code $LASTEXITCODE"
  }

  if ($env:OS -eq "Windows_NT") {
    $buildOutputPaths = @($releaseExePath, $sheetCorrectorReleaseExePath)
    if ($hasDevelopmentCopyDirectory) {
      $buildOutputPaths += @($developmentCopyExePath, $sheetCorrectorDevelopmentCopyExePath)
    }
    $runningTargets = Get-Process -Name "xsheet-remap", "xsheet-corrector" -ErrorAction SilentlyContinue |
      Where-Object {
        try {
          if (-not $_.Path) {
            $false
          } else {
            $processPath = [System.IO.Path]::GetFullPath($_.Path)
            [bool]($buildOutputPaths | Where-Object { $processPath -ieq $_ })
          }
        } catch {
          $false
        }
      }

    foreach ($process in $runningTargets) {
      Write-Host "[desktop-build] stopping running build output exe pid=$($process.Id) path=$($process.Path)"
      Stop-Process -Id $process.Id -Force
    }
  }

  npm run build:portable -w @xsheet-remap/desktop
  if ($LASTEXITCODE -ne 0) {
    throw "desktop build failed with exit code $LASTEXITCODE"
  }

  npm run build:portable -w @xsheet-remap/sheet-corrector
  if ($LASTEXITCODE -ne 0) {
    throw "sheet corrector build failed with exit code $LASTEXITCODE"
  }

  if (-not (Test-Path -LiteralPath $releaseExePath)) {
    throw "desktop build did not produce expected exe: $releaseExePath"
  }
  if (-not (Test-Path -LiteralPath $sheetCorrectorReleaseExePath)) {
    throw "sheet corrector build did not produce expected exe: $sheetCorrectorReleaseExePath"
  }

  if ($hasDevelopmentCopyDirectory) {
    New-Item -ItemType Directory -Force -Path $developmentCopyDirectory | Out-Null
    Copy-Item -LiteralPath $releaseExePath -Destination $developmentCopyExePath -Force
    Write-Host "[desktop-build] copied release exe to $developmentCopyExePath"
    Copy-Item -LiteralPath $sheetCorrectorReleaseExePath -Destination $sheetCorrectorDevelopmentCopyExePath -Force
    Write-Host "[desktop-build] copied sheet corrector exe to $sheetCorrectorDevelopmentCopyExePath"
  } else {
    Write-Host "[desktop-build] XSHEET_RELEASE_COPY_DIR is not set; skipping external release copy"
  }

  & (Join-Path $repoRoot "tools/release/local-package.ps1") -SkipHelper -SkipLeakCheck
  if ($LASTEXITCODE -ne 0) {
    throw "local release copy failed for desktop outputs"
  }

  if (-not $SkipLeakCheck) {
    & (Join-Path $repoRoot "tools/checks/repo-hygiene.ps1") -IncludeBuildOutput
    if ($LASTEXITCODE -ne 0) {
      throw "repo hygiene check failed after build"
    }
  }
} finally {
  Pop-Location
}
