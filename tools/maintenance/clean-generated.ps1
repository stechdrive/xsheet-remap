param(
  [switch]$Apply,
  [switch]$IncludeSharedCargoCache,
  [switch]$IncludeReferenceEvaluations
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$relativeTargets = New-Object System.Collections.Generic.List[string]
@(
  "apps/editor/src-tauri/target",
  "apps/desktop/src-tauri/target",
  "apps/template-editor/src-tauri/target",
  "apps/sheet-corrector/src-tauri/target",
  "native/desktop-runtime/target",
  ".tmp"
) | ForEach-Object { $relativeTargets.Add($_) }
if ($IncludeSharedCargoCache) {
  $relativeTargets.Add(".cache/cargo-target")
}
if ($IncludeReferenceEvaluations) {
  $relativeTargets.Add("reference-local/calibration-evals")
}

function Get-DirectoryBytes {
  param([string]$Path)

  $total = 0L
  try {
    foreach ($file in [System.IO.Directory]::EnumerateFiles($Path, "*", [System.IO.SearchOption]::AllDirectories)) {
      try {
        $total += ([System.IO.FileInfo]::new($file)).Length
      } catch {
        # Size reporting is advisory; deletion still uses the verified literal path.
      }
    }
  } catch {
    # Report zero when an unreadable child prevents enumeration.
  }
  return $total
}

$targets = New-Object System.Collections.Generic.List[object]
foreach ($relativePath in $relativeTargets) {
  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $relativePath))
  if ($fullPath.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not $fullPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "refusing generated cleanup outside repository: $fullPath"
  }
  if (Test-Path -LiteralPath $fullPath -PathType Container) {
    $targets.Add([pscustomobject]@{
      RelativePath = $relativePath.Replace("\", "/")
      FullPath = $fullPath
      Bytes = Get-DirectoryBytes $fullPath
    })
  }
}

if ($targets.Count -eq 0) {
  Write-Host "[clean-generated] no matching generated directories"
  exit 0
}

$targets |
  Select-Object RelativePath, @{ Name = "GiB"; Expression = { [math]::Round($_.Bytes / 1GB, 3) } } |
  Format-Table -AutoSize
$totalBytes = ($targets | Measure-Object Bytes -Sum).Sum
Write-Host ("[clean-generated] total: {0:N2} GiB" -f ($totalBytes / 1GB))

if (-not $Apply) {
  Write-Host "[clean-generated] preview only; pass -Apply to delete these exact directories"
  exit 0
}

foreach ($target in $targets) {
  $verifiedPath = [System.IO.Path]::GetFullPath($target.FullPath)
  if (-not $verifiedPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "cleanup target escaped repository after verification: $verifiedPath"
  }
  Write-Host "[clean-generated] removing $($target.RelativePath)"
  Remove-Item -LiteralPath $verifiedPath -Recurse -Force
}

Write-Host "[clean-generated] completed"
