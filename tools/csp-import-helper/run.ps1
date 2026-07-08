param(
  [Parameter(Mandatory = $true)]
  [string]$Manifest,
  [switch]$Run,
  [switch]$ProbeWindow,
  [switch]$Json,
  [switch]$TimelineDisabledConfirmed,
  [int]$Limit = 0,
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$srcRoot = Join-Path $repoRoot "apps\csp-import-helper\src"
$env:PYTHONPATH = if ($env:PYTHONPATH) { "$srcRoot;$env:PYTHONPATH" } else { $srcRoot }

$argsList = @("-m", "csp_import_helper", "--manifest", $Manifest)
if ($Run) { $argsList += "--run" }
if ($ProbeWindow) { $argsList += "--probe-window" }
if ($Json) { $argsList += "--json" }
if ($TimelineDisabledConfirmed) { $argsList += "--timeline-disabled-confirmed" }
if ($Limit -gt 0) { $argsList += @("--limit", "$Limit") }

& $Python @argsList
exit $LASTEXITCODE
