param(
  [Parameter(Mandatory = $true)]
  [string]$Manifest,
  [string]$ClipPath = "",
  [string]$PsdPath = "",
  [string]$Python = "",
  [string]$HelperPython = "",
  [string]$Shortcut = "",
  [string]$VenvPath = ".tmp\csp-psd-diagnostic-venv",
  [ValidateSet("standard", "fast", "turbo")]
  [string]$Speed = "fast",
  [switch]$SkipExport,
  [switch]$DumpTree,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$env:PYTHONDONTWRITEBYTECODE = "1"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Resolve-InputPath([string]$PathValue, [switch]$MustExist) {
  if (-not $PathValue) {
    return ""
  }
  $candidate = if ([System.IO.Path]::IsPathRooted($PathValue)) {
    $PathValue
  } else {
    Join-Path $repoRoot $PathValue
  }
  if ($MustExist) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }
  return [System.IO.Path]::GetFullPath($candidate)
}

function Resolve-Python([string]$Requested, [string]$Fallback) {
  if ($Requested) {
    return $Requested
  }
  if ($Fallback -and (Test-Path -LiteralPath $Fallback)) {
    return $Fallback
  }
  return "python"
}

function Ensure-DiagnosticVenv([string]$VenvRoot, [string]$BasePython) {
  $resolvedVenv = Resolve-InputPath $VenvRoot
  $venvPython = Join-Path $resolvedVenv "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $venvPython)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedVenv) -Force | Out-Null
    & $BasePython -m venv $resolvedVenv
    if ($LASTEXITCODE -ne 0) {
      throw "failed to create PSD diagnostic venv: $resolvedVenv"
    }
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $venvPython -c "import psd_tools" *> $null
  $importExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($importExitCode -ne 0) {
    & $venvPython -m pip install "psd-tools>=1.10,<2" *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "failed to install psd-tools into PSD diagnostic venv: $resolvedVenv"
    }
  }
  return $venvPython
}

$manifestPath = Resolve-InputPath $Manifest -MustExist
$clipResolved = Resolve-InputPath $ClipPath
if (-not $SkipExport -and -not $Shortcut.Trim()) {
  throw "PSD export requires -Shortcut matching a shortcut configured in CSP. Use -SkipExport to inspect an existing PSD."
}
if (-not $PsdPath) {
  if ($clipResolved) {
    $PsdPath = [System.IO.Path]::ChangeExtension($clipResolved, ".psd")
  } else {
    $PsdPath = Join-Path (Split-Path -Parent $manifestPath) "csp-import-diagnostic.psd"
  }
}
$psdResolved = Resolve-InputPath $PsdPath

$defaultHelperPython = Join-Path $repoRoot ".tmp\csp-import-helper-build-venv\Scripts\python.exe"
$helperPythonResolved = Resolve-Python $HelperPython $defaultHelperPython
$basePython = Resolve-Python $Python $helperPythonResolved
$diagnosticPython = Ensure-DiagnosticVenv $VenvPath $basePython

if (-not $SkipExport) {
  if ($clipResolved) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "tools\csp-import-helper\reset-test-clip.ps1") -ClipPath $clipResolved -DiscardOpenDocument -Quiet -Python $helperPythonResolved
    if ($LASTEXITCODE -ne 0) {
      throw "failed to open CLIP for PSD diagnostic: $clipResolved"
    }
  }

  $env:PYTHONPATH = Join-Path $repoRoot "apps\csp-import-helper\src"
  $exportArgs = @(
    (Join-Path $repoRoot "tools\csp-import-helper\export-psd-from-csp.py"),
    "--psd", $psdResolved,
    "--speed", $Speed,
    "--shortcut", $Shortcut
  )
  if ($Json) {
    $exportArgs += "--json"
  }
  & $helperPythonResolved @exportArgs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

$inspectArgs = @((Join-Path $repoRoot "tools\csp-import-helper\inspect-psd.py"), "--psd", $psdResolved, "--manifest", $manifestPath)
if ($Json) {
  $inspectArgs += "--json"
}
if ($DumpTree) {
  $inspectArgs += "--dump-tree"
}
& $diagnosticPython @inspectArgs
exit $LASTEXITCODE
