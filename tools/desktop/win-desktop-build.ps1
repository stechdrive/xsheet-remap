param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("development", "release")]
  [string]$Mode,
  [Parameter(Mandatory = $true)]
  [string]$Target,
  [switch]$SkipLeakCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$cargoTargetRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".cache\cargo-target"))
$devRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "dev-local"))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "release-local"))
$buildLockPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".cache\desktop-build.lock"))
$desktopApps = @(
  [pscustomobject]@{
    Key = "editor"
    Name = "xsheet-editor"
    Workspace = "@xsheet-remap/editor"
    RelativePath = ".cache/cargo-target/release/xsheet-editor.exe"
  },
  [pscustomobject]@{
    Key = "remap"
    Name = "xsheet-remap"
    Workspace = "@xsheet-remap/desktop"
    RelativePath = ".cache/cargo-target/release/xsheet-remap.exe"
  },
  [pscustomobject]@{
    Key = "template"
    Name = "xsheet-template"
    Workspace = "@xsheet-remap/template-editor"
    RelativePath = ".cache/cargo-target/release/xsheet-template.exe"
  },
  [pscustomobject]@{
    Key = "corrector"
    Name = "xsheet-corrector"
    Workspace = "@xsheet-remap/sheet-corrector"
    RelativePath = ".cache/cargo-target/release/xsheet-corrector.exe"
  }
)

$allowedTargets = @("all", "editor", "remap", "template", "corrector")
$targetKeys = @(
  $Target.Split(",", [System.StringSplitOptions]::RemoveEmptyEntries) |
    ForEach-Object { $_.Trim().ToLowerInvariant() } |
    Sort-Object -Unique
)
if ($targetKeys.Count -eq 0) {
  throw "at least one desktop build target is required"
}
$invalidTargets = @($targetKeys | Where-Object { $_ -notin $allowedTargets })
if ($invalidTargets.Count -gt 0) {
  throw "unknown desktop build target(s): $($invalidTargets -join ', '). Allowed: editor, remap, template, corrector, all."
}
if ($targetKeys -contains "all" -and $targetKeys.Count -gt 1) {
  throw "target 'all' cannot be combined with individual desktop targets"
}
$isDevelopment = $Mode -eq "development"
if (-not $isDevelopment -and ($targetKeys.Count -ne 1 -or $targetKeys[0] -ne "all")) {
  throw "release desktop builds require target 'all'; partial builds are development-only"
}

foreach ($app in $desktopApps) {
  $app | Add-Member -NotePropertyName OutputPath -NotePropertyValue ([System.IO.Path]::GetFullPath((Join-Path $repoRoot $app.RelativePath)))
  $app | Add-Member -NotePropertyName DevPath -NotePropertyValue ([System.IO.Path]::GetFullPath((Join-Path $devRoot "$($app.Name).exe")))
  $app | Add-Member -NotePropertyName ReleasePath -NotePropertyValue ([System.IO.Path]::GetFullPath((Join-Path $releaseRoot "$($app.Name).exe")))
  foreach ($path in @($app.OutputPath, $app.DevPath, $app.ReleasePath)) {
    if (-not $path.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "resolved $($app.Name) executable is outside the repository: $path"
    }
  }
}

$selectedApps = if ($targetKeys -contains "all") {
  @($desktopApps)
} else {
  @($desktopApps | Where-Object { $_.Key -in $targetKeys })
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

function Stop-RepositoryExecutables {
  param([object[]]$Apps)

  if ($env:OS -ne "Windows_NT") {
    return
  }

  $allowedPaths = @(
    $Apps | ForEach-Object { @($_.OutputPath, $_.DevPath, $_.ReleasePath) }
  )
  $processNames = @($Apps | ForEach-Object { $_.Name })
  $runningTargets = Get-Process -Name $processNames -ErrorAction SilentlyContinue |
    Where-Object {
      try {
        if (-not $_.Path) {
          $false
        } else {
          $processPath = [System.IO.Path]::GetFullPath($_.Path)
          [bool]($allowedPaths | Where-Object { $processPath -ieq $_ })
        }
      } catch {
        $false
      }
    }

  foreach ($process in $runningTargets) {
    Write-Host "[desktop-build] stopping repository executable pid=$($process.Id) path=$($process.Path)"
    Stop-Process -Id $process.Id -Force
  }
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

function Update-DevelopmentLaunchpad {
  param(
    [object[]]$Apps,
    [string]$BuildSessionId
  )

  New-Item -ItemType Directory -Path $devRoot -Force | Out-Null
  $statePath = Join-Path $devRoot "build-state.json"
  $applicationStates = [ordered]@{}
  if (Test-Path -LiteralPath $statePath) {
    try {
      $previousState = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($previousState.applications) {
        foreach ($property in $previousState.applications.PSObject.Properties) {
          if ($desktopApps.Key -contains $property.Name) {
            $applicationStates[$property.Name] = $property.Value
          }
        }
      }
    } catch {
      Write-Host "[desktop-build] replacing unreadable dev-local build state" -ForegroundColor Yellow
    }
  }

  $version = (Get-Content -LiteralPath (Join-Path $repoRoot "VERSION") -Raw -Encoding UTF8).Trim()
  $commit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
  $workingTreeDirty = [bool](& git -C $repoRoot status --porcelain --untracked-files=normal 2>$null)
  $builtAtUtc = (Get-Date).ToUniversalTime().ToString("o")

  foreach ($app in $Apps) {
    Copy-Item -LiteralPath $app.OutputPath -Destination $app.DevPath -Force
    $applicationStates[$app.Key] = [ordered]@{
      name = $app.Name
      version = $version
      commit = $commit
      workingTreeDirty = $workingTreeDirty
      buildSessionId = $BuildSessionId
      builtAtUtc = $builtAtUtc
      sourcePath = $app.RelativePath.Replace("\", "/")
      executable = "$($app.Name).exe"
      sha256 = Get-Sha256Hex $app.OutputPath
    }
    Write-Host "[desktop-build] updated dev-local/$($app.Name).exe"
  }

  $complete = @($desktopApps | Where-Object { -not $applicationStates.Contains($_.Key) }).Count -eq 0
  $sessionValues = @(
    $desktopApps |
      Where-Object { $applicationStates.Contains($_.Key) } |
      ForEach-Object { [string]$applicationStates[$_.Key].buildSessionId }
  )
  $allSessionsRecorded = $complete -and @(
    $sessionValues | Where-Object { [string]::IsNullOrWhiteSpace($_) }
  ).Count -eq 0
  $sessionIds = @(
    $sessionValues |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Sort-Object -Unique
  )
  $mode = if ($allSessionsRecorded -and $sessionIds.Count -eq 1) {
    "coherent"
  } elseif ($complete) {
    "mixed"
  } else {
    "partial"
  }

  $stateJson = [ordered]@{
    schemaVersion = 1
    purpose = "development-launchpad"
    mode = $mode
    updatedAtUtc = $builtAtUtc
    applications = $applicationStates
  } | ConvertTo-Json -Depth 8
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($statePath, $stateJson + [Environment]::NewLine, $utf8WithoutBom)
  Write-Host "[desktop-build] dev-local state: $mode"
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
$existingCargoTargetDir = $env:CARGO_TARGET_DIR
$existingCargoBuildJobs = $env:CARGO_BUILD_JOBS
$existingViteBuildChannel = $env:VITE_XSHEET_BUILD_CHANNEL
$existingViteBuildSession = $env:VITE_XSHEET_BUILD_SESSION
$env:CARGO_TARGET_DIR = $cargoTargetRoot
if ([string]::IsNullOrWhiteSpace($existingCargoBuildJobs)) {
  $env:CARGO_BUILD_JOBS = [string][math]::Max(1, [math]::Min(8, [Environment]::ProcessorCount))
  Write-Host "[desktop-build] cargo jobs capped at $($env:CARGO_BUILD_JOBS) (override with CARGO_BUILD_JOBS)"
}
$env:CARGO_ENCODED_RUSTFLAGS = (@(
  if (-not [string]::IsNullOrWhiteSpace($existingEncodedRustFlags)) { $existingEncodedRustFlags }
  $rustFlags
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join $encodedRustFlagSeparator

$buildLock = $null
try {
  New-Item -ItemType Directory -Path (Split-Path -Parent $buildLockPath) -Force | Out-Null
  $buildLock = [System.IO.File]::Open(
    $buildLockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
} catch [System.IO.IOException] {
  throw "another desktop build is already running for this repository; wait for it to finish before starting a new build"
}

Write-Host "[desktop-build] mode=$Mode targets=$($targetKeys -join ',')"
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

  Stop-RepositoryExecutables -Apps $selectedApps
  $buildSessionId = [guid]::NewGuid().ToString("N")
  $env:VITE_XSHEET_BUILD_CHANNEL = if ($isDevelopment) { "development" } else { "release" }
  $env:VITE_XSHEET_BUILD_SESSION = $buildSessionId
  Write-Host "[desktop-build] frontend channel=$($env:VITE_XSHEET_BUILD_CHANNEL) session=$buildSessionId"

  foreach ($app in $selectedApps) {
    Write-Host "[desktop-build] building $($app.Name)"
    npm run build:portable -w $app.Workspace
    if ($LASTEXITCODE -ne 0) {
      throw "$($app.Name) build failed with exit code $LASTEXITCODE"
    }
  }

  & (Join-Path $repoRoot "tools/maintenance/prune-cargo-build-history.ps1") `
    -TargetRoot $cargoTargetRoot `
    -PackageNames @($selectedApps | ForEach-Object { $_.Name })
  if ($LASTEXITCODE -ne 0) {
    throw "cargo build history pruning failed"
  }

  foreach ($app in $selectedApps) {
    if (-not (Test-Path -LiteralPath $app.OutputPath)) {
      throw "$($app.Name) build did not produce expected exe: $($app.OutputPath)"
    }
  }

  Update-DevelopmentLaunchpad -Apps $selectedApps -BuildSessionId $buildSessionId

  if (-not $isDevelopment) {
    & (Join-Path $repoRoot "tools/release/local-package.ps1") -SkipHelper -SkipLeakCheck
    if ($LASTEXITCODE -ne 0) {
      throw "local release copy failed for desktop outputs"
    }
  }

  if (-not $SkipLeakCheck) {
    & (Join-Path $repoRoot "tools/checks/repo-hygiene.ps1") -IncludeBuildOutput -IncludeDevOutput
    if ($LASTEXITCODE -ne 0) {
      throw "repo hygiene check failed after build"
    }
  }
} catch {
  $buildError = $_
  try {
    & (Join-Path $repoRoot "tools/maintenance/prune-cargo-build-history.ps1") `
      -TargetRoot $cargoTargetRoot `
      -PackageNames @($selectedApps | ForEach-Object { $_.Name })
  } catch {
    Write-Warning "cargo build history pruning also failed after the build error: $($_.Exception.Message)"
  }
  throw $buildError
} finally {
  Pop-Location
  $env:CARGO_ENCODED_RUSTFLAGS = $existingEncodedRustFlags
  $env:CARGO_TARGET_DIR = $existingCargoTargetDir
  $env:CARGO_BUILD_JOBS = $existingCargoBuildJobs
  $env:VITE_XSHEET_BUILD_CHANNEL = $existingViteBuildChannel
  $env:VITE_XSHEET_BUILD_SESSION = $existingViteBuildSession
  if ($buildLock) {
    $buildLock.Dispose()
  }
}
