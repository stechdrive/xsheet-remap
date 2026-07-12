param(
  [string]$ClipPath = $env:XSHEET_CSP_TEST_CLIP,
  [switch]$DiscardOpenDocument,
  [switch]$CloseOpenDocument,
  [switch]$Quiet,
  [string]$Python = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$srcRoot = Join-Path $repoRoot "apps\csp-import-helper\src"

if (-not $CloseOpenDocument -and -not $ClipPath) {
  throw "ClipPath is required. Pass -ClipPath or set XSHEET_CSP_TEST_CLIP."
}

$resolvedClip = if ($ClipPath) { (Resolve-Path -LiteralPath $ClipPath).Path } else { "" }

if (-not $Python) {
  $venvPython = Join-Path $repoRoot ".tmp\csp-import-helper-build-venv\Scripts\python.exe"
  $Python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { "python" }
}

$env:PYTHONPATH = if ($env:PYTHONPATH) { "$srcRoot;$env:PYTHONPATH" } else { $srcRoot }

$argsList = @("-m", "csp_import_helper.test_clip")
if ($CloseOpenDocument) {
  $argsList += "--close-open-document"
} else {
  $argsList += @("--clip", $resolvedClip)
}
if ($DiscardOpenDocument) { $argsList += "--discard-open-document" }
if ($Quiet) { $argsList += "--quiet" }

$previousDontWriteBytecode = $env:PYTHONDONTWRITEBYTECODE
try {
  $env:PYTHONDONTWRITEBYTECODE = "1"
  & $Python @argsList
  $pythonExitCode = $LASTEXITCODE
} finally {
  if ($null -eq $previousDontWriteBytecode) {
    Remove-Item Env:\PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue
  } else {
    $env:PYTHONDONTWRITEBYTECODE = $previousDontWriteBytecode
  }
}
exit $pythonExitCode
