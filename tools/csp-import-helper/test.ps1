param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$srcRoot = Join-Path $repoRoot "apps\csp-import-helper\src"
$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = if ($env:XSHEET_TEST_DEPENDENCIES) { "$srcRoot;$env:XSHEET_TEST_DEPENDENCIES" } else { $srcRoot }
if (-not $PSBoundParameters.ContainsKey("Python") -and $env:XSHEET_TEST_PYTHON) { $Python = $env:XSHEET_TEST_PYTHON }

$previousDontWriteBytecode = $env:PYTHONDONTWRITEBYTECODE
try {
  $env:PYTHONDONTWRITEBYTECODE = "1"
  & $Python (Join-Path $PSScriptRoot "run-tests.py")
  $pythonExitCode = $LASTEXITCODE
} finally {
  $env:PYTHONPATH = $previousPythonPath
  if ($null -eq $previousDontWriteBytecode) {
    Remove-Item Env:\PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue
  } else {
    $env:PYTHONDONTWRITEBYTECODE = $previousDontWriteBytecode
  }
}
exit $pythonExitCode
