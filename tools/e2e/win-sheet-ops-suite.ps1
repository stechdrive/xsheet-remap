param(
  [string]$ExePath = "dev-local/xsheet-editor.exe",
  [string]$ArtifactRoot = ".tmp/desktop-e2e",
  [int]$TimeoutSeconds = 45,
  [switch]$Build,
  [switch]$RequireScreenshot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:OS -ne "Windows_NT") {
  throw "win-sheet-ops-suite.ps1 can only run on Windows."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

if ($Build) {
  Write-Host "[sheet-ops-suite] building the editor development executable once before leaf scenarios..."
  npm run build:dev -- --target editor
  if ($LASTEXITCODE -ne 0) {
    throw "editor development build failed with exit code $LASTEXITCODE"
  }
}

$scenarios = @(
  "shell-layout",
  "stack-guides",
  "multipage-timing",
  "timing-edit",
  "asset-drop",
  "asset-preview",
  "sound-ops",
  "camera-ops",
  "timeline-ripple",
  "timeline-memo"
  "sheet-history"
)

$artifactBase = if ([System.IO.Path]::IsPathRooted($ArtifactRoot)) {
  [System.IO.Path]::GetFullPath($ArtifactRoot)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repoRoot $ArtifactRoot))
}
$suiteId = "{0:yyyyMMdd-HHmmss-fff}" -f (Get-Date)
$suiteRoot = Join-Path $artifactBase "sheet-ops-suite-$suiteId"
$suiteSummaryPath = Join-Path $suiteRoot "suite-summary.json"
New-Item -ItemType Directory -Path $suiteRoot -Force | Out-Null

$runner = Join-Path $PSScriptRoot "win-desktop-e2e.ps1"
$results = [System.Collections.Generic.List[object]]::new()

foreach ($scenario in $scenarios) {
  $scenarioRoot = Join-Path $suiteRoot $scenario
  $childArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $runner,
    "-Scenario", $scenario,
    "-ExePath", $ExePath,
    "-ArtifactRoot", $scenarioRoot,
    "-TimeoutSeconds", "$TimeoutSeconds"
  )
  if ($RequireScreenshot) {
    $childArguments += "-RequireScreenshot"
  }

  Write-Host "[sheet-ops-suite] starting isolated scenario: $scenario"
  & powershell @childArguments
  $exitCode = $LASTEXITCODE
  $summaryFile = Get-ChildItem -LiteralPath $scenarioRoot -Filter "summary.json" -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  $summary = if ($summaryFile) {
    Get-Content -LiteralPath $summaryFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  } else {
    $null
  }
  $passed = $exitCode -eq 0 -and $null -ne $summary -and [bool]$summary.passed
  $results.Add([pscustomobject]@{
    scenario = $scenario
    passed = $passed
    exitCode = $exitCode
    summary = if ($summaryFile) { $summaryFile.FullName } else { $null }
    error = if ($summary -and $summary.error) { $summary.error } elseif ($exitCode -ne 0) { "runner exited with code $exitCode" } else { $null }
    checks = if ($summary -and ($summary.PSObject.Properties.Name -contains "checks")) { @($summary.checks) } else { @() }
    artifacts = if ($summary -and ($summary.PSObject.Properties.Name -contains "artifacts")) { @($summary.artifacts) } else { @() }
  })
}

$failed = @($results | Where-Object { -not $_.passed })
$suiteSummary = [pscustomobject]@{
  suiteId = $suiteId
  passed = $failed.Count -eq 0
  exePath = $ExePath
  scenarios = @($results)
}
$suiteSummary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $suiteSummaryPath -Encoding UTF8

Write-Host "[sheet-ops-suite] summary: $suiteSummaryPath"
if ($failed.Count -gt 0) {
  $failedNames = ($failed | ForEach-Object { $_.scenario }) -join ", "
  throw "sheet-ops suite failed: $failedNames"
}

Write-Host "[sheet-ops-suite] all isolated scenarios passed"
