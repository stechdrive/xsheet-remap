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

$argsList = @("--manifest", $manifest)
if ($Run) { $argsList += "--run" }
if ($Json) { $argsList += "--json" }

& $resolvedLauncher @argsList
$runExitCode = $LASTEXITCODE

if ($ResetClip -and $Run -and -not $KeepClipOpen) {
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
