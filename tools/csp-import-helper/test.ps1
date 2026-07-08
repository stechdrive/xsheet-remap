param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$srcRoot = Join-Path $repoRoot "apps\csp-import-helper\src"
$env:PYTHONPATH = if ($env:PYTHONPATH) { "$srcRoot;$env:PYTHONPATH" } else { $srcRoot }

& $Python -m unittest discover -s (Join-Path $repoRoot "apps\csp-import-helper\tests") -p "test_*.py"
exit $LASTEXITCODE
