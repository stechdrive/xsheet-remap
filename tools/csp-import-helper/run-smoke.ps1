param(
  [string]$RunRoot = ".tmp\desktop-e2e\20260703-145307-129",
  [Alias("ExePath")]
  [string]$LauncherPath = ".tmp\csp-import-helper-dist\xsheet-csp-import-helper\xsheet-csp-import-helper.bat",
  [switch]$Run,
  [switch]$ResetClip,
  [string]$ClipPath = $env:XSHEET_CSP_TEST_CLIP,
  [switch]$DiscardOpenDocument,
  [switch]$KeepClipOpen,
  [switch]$ProbeWindow,
  [ValidateSet("standard", "fast", "turbo")]
  [string]$Speed = "turbo",
  [string]$SaveAs = "",
  [switch]$Json
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Resolve-InputPath([string]$PathValue) {
  $candidate = if ([System.IO.Path]::IsPathRooted($PathValue)) {
    $PathValue
  } else {
    Join-Path $repoRoot $PathValue
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Resolve-OutputPath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $repoRoot $PathValue))
}

$resolvedRunRoot = Resolve-InputPath $RunRoot
$resolvedLauncher = if ([System.IO.Path]::IsPathRooted($LauncherPath)) {
  $LauncherPath
} else {
  Join-Path $repoRoot $LauncherPath
}

if (-not (Test-Path -LiteralPath $resolvedLauncher)) {
  throw "CSP import helper launcher not found: $resolvedLauncher`nBuild it first: powershell -NoProfile -ExecutionPolicy Bypass -File tools/csp-import-helper/build.ps1"
}

if ($ResetClip) {
  $resetArgs = @("-File", (Join-Path $repoRoot "tools\csp-import-helper\reset-test-clip.ps1"))
  if ($ClipPath) { $resetArgs += @("-ClipPath", $ClipPath) }
  $portablePython = Join-Path (Split-Path -Parent $resolvedLauncher) "csp-import-helper\python\python.exe"
  if (Test-Path -LiteralPath $portablePython) { $resetArgs += @("-Python", $portablePython) }
  if ($DiscardOpenDocument) { $resetArgs += "-DiscardOpenDocument" }
  if ($Json) { $resetArgs += "-Quiet" }
  if (-not $Json) {
    Write-Host "[csp-import-helper] resetting CSP test CLIP..."
  }
  & powershell -NoProfile -ExecutionPolicy Bypass @resetArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$manifestOut = Join-Path $resolvedRunRoot "csp-import.$PID.xci"
$operationLog = "csp-import-log.$PID.json"
$manifest = (& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "tools\csp-import-helper\make-smoke-manifest.ps1") -RunRoot $resolvedRunRoot -Out $manifestOut -OperationLog $operationLog | Select-Object -Last 1).Trim()
if (-not (Test-Path -LiteralPath $manifest)) {
  throw "Smoke manifest was not created: $manifest"
}

if (-not $Json) {
  Write-Host "[csp-import-helper] smoke manifest: $manifest"
  Write-Host "[csp-import-helper] helper launcher: $resolvedLauncher"
  Write-Host "[csp-import-helper] automation speed: $Speed"
  if (-not $Run) {
    Write-Host "[csp-import-helper] dry-run only. Add -Run to operate CSP."
  }
}

if ($ProbeWindow) {
  $probeArgs = @("--manifest", $manifest, "--probe-window")
  if ($Json) { $probeArgs += "--json" }
  & $resolvedLauncher @probeArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$argsList = @("--manifest", $manifest, "--speed", $Speed)
if ($Run) { $argsList += "--run" }
if ($Json) { $argsList += "--json" }
$operationLogPath = Join-Path $resolvedRunRoot "csp-import-job-log.json"
if ($Run -and (Test-Path -LiteralPath $operationLogPath)) {
  Remove-Item -LiteralPath $operationLogPath -Force
}
$resolvedSaveAs = ""
if ($SaveAs) {
  $resolvedSaveAs = Resolve-OutputPath $SaveAs
  $saveDirectory = Split-Path -Parent $resolvedSaveAs
  New-Item -ItemType Directory -Force -Path $saveDirectory | Out-Null
  $argsList += @("--save-as", $resolvedSaveAs)
  if (-not $KeepClipOpen) { $argsList += "--close-after-save" }
}

& $resolvedLauncher @argsList
$runExitCode = $LASTEXITCODE

if ($Run -and $runExitCode -eq 0) {
  $manifestData = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  $expectedImportCount = @(
    $manifestData.cuts |
      ForEach-Object { $_.tracks } |
      ForEach-Object { $_.cels } |
      Where-Object { $null -ne $_.material }
  ).Count
  if (-not (Test-Path -LiteralPath $operationLogPath)) {
    Write-Error "CSP helper operation log was not created: $operationLogPath"
    $runExitCode = 1
  } else {
    $operationLogData = Get-Content -LiteralPath $operationLogPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $errorCount = @($operationLogData.errors).Count
    $importedCount = @($operationLogData.events | Where-Object { $_.event -eq "asset.imported" }).Count
    $timingEvent = @($operationLogData.events | Where-Object { $_.event -eq "automation.timing_profile" }) | Select-Object -Last 1
    if ($errorCount -ne 0) {
      Write-Error "CSP helper operation log contains $errorCount error(s): $operationLogPath"
      $runExitCode = 1
    } elseif ($importedCount -ne $expectedImportCount) {
      Write-Error "CSP helper imported $importedCount of $expectedImportCount expected asset(s): $operationLogPath"
      $runExitCode = 1
    } elseif (-not $timingEvent -or $timingEvent.speedMode -ne $Speed) {
      $actualSpeed = if ($timingEvent) { $timingEvent.speedMode } else { "missing" }
      Write-Error "CSP helper speed mismatch. Expected '$Speed', got '$actualSpeed': $operationLogPath"
      $runExitCode = 1
    } elseif ($resolvedSaveAs -and -not (Test-Path -LiteralPath $resolvedSaveAs)) {
      Write-Error "CSP helper did not create the saved CLIP: $resolvedSaveAs"
      $runExitCode = 1
    } elseif (-not $Json) {
      Write-Host "[csp-import-helper] verified $importedCount asset import(s), speed '$Speed', errors 0"
      if ($resolvedSaveAs) {
        Write-Host "[csp-import-helper] verified saved CLIP: $resolvedSaveAs"
      }
    }
  }
}

if ($ResetClip -and $Run -and -not $KeepClipOpen -and -not $resolvedSaveAs) {
  $cleanupArgs = @("-File", (Join-Path $repoRoot "tools\csp-import-helper\reset-test-clip.ps1"), "-CloseOpenDocument")
  if ($Json) { $cleanupArgs += "-Quiet" }
  if (-not $Json) {
    Write-Host "[csp-import-helper] closing CSP test CLIP without saving..."
  }
  & powershell -NoProfile -ExecutionPolicy Bypass @cleanupArgs
  if ($LASTEXITCODE -ne 0 -and $runExitCode -eq 0) {
    $runExitCode = $LASTEXITCODE
  }
}

exit $runExitCode
