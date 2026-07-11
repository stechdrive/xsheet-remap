param(
  [switch]$SkipLeakCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$desktopApps = @(
  [pscustomobject]@{
    Name = "xsheet-editor"
    Workspace = "@xsheet-remap/editor"
    RelativePath = "apps/editor/src-tauri/target/release/xsheet-editor.exe"
  },
  [pscustomobject]@{
    Name = "xsheet-remap"
    Workspace = "@xsheet-remap/desktop"
    RelativePath = "apps/desktop/src-tauri/target/release/xsheet-remap.exe"
  },
  [pscustomobject]@{
    Name = "xsheet-template-editor"
    Workspace = "@xsheet-remap/template-editor"
    RelativePath = "apps/template-editor/src-tauri/target/release/xsheet-template-editor.exe"
  },
  [pscustomobject]@{
    Name = "xsheet-corrector"
    Workspace = "@xsheet-remap/sheet-corrector"
    RelativePath = "apps/sheet-corrector/src-tauri/target/release/xsheet-corrector.exe"
  }
)

foreach ($app in $desktopApps) {
  $app | Add-Member -NotePropertyName OutputPath -NotePropertyValue ([System.IO.Path]::GetFullPath((Join-Path $repoRoot $app.RelativePath)))
  if (-not $app.OutputPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "resolved $($app.Name) executable is outside the repository: $($app.OutputPath)"
  }
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
    $buildOutputPaths = @($desktopApps | ForEach-Object { $_.OutputPath })
    $processNames = @($desktopApps | ForEach-Object { $_.Name })
    $runningTargets = Get-Process -Name $processNames -ErrorAction SilentlyContinue |
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

  foreach ($app in $desktopApps) {
    npm run build:portable -w $app.Workspace
    if ($LASTEXITCODE -ne 0) {
      throw "$($app.Name) build failed with exit code $LASTEXITCODE"
    }
  }

  foreach ($app in $desktopApps) {
    if (-not (Test-Path -LiteralPath $app.OutputPath)) {
      throw "$($app.Name) build did not produce expected exe: $($app.OutputPath)"
    }
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
