param(
  [string]$TargetRoot = ".cache/cargo-target",
  [string[]]$PackageNames = @(
    "xsheet-editor",
    "xsheet-remap",
    "xsheet-template",
    "xsheet-corrector"
  ),
  [ValidateRange(2, 20)]
  [int]$KeepPerPackage = 4
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resolvedTargetRoot = if ([System.IO.Path]::IsPathRooted($TargetRoot)) {
  [System.IO.Path]::GetFullPath($TargetRoot)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repoRoot $TargetRoot))
}
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedTargetRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "cargo target root must stay inside the repository: $resolvedTargetRoot"
}

foreach ($profile in @("debug", "release")) {
  $buildRoot = Join-Path $resolvedTargetRoot "$profile\build"
  if (-not (Test-Path -LiteralPath $buildRoot -PathType Container)) {
    continue
  }

  foreach ($packageName in $PackageNames) {
    if ($packageName -notmatch '^xsheet-[a-z-]+$') {
      throw "unexpected desktop package name: $packageName"
    }
    $matchingDirectories = @(
      Get-ChildItem -LiteralPath $buildRoot -Directory -Filter "$packageName-*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending
    )
    if ($matchingDirectories.Count -le $KeepPerPackage) {
      continue
    }

    foreach ($directory in @($matchingDirectories | Select-Object -Skip $KeepPerPackage)) {
      $resolvedPath = [System.IO.Path]::GetFullPath($directory.FullName)
      $buildPrefix = [System.IO.Path]::GetFullPath($buildRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
      if (-not $resolvedPath.StartsWith($buildPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "refusing to prune outside cargo build root: $resolvedPath"
      }
      Write-Host "[cargo-retention] removing stale $profile build output: $($directory.Name)"
      Remove-Item -LiteralPath $resolvedPath -Recurse -Force
    }
  }
}

Write-Host "[cargo-retention] kept at most $KeepPerPackage build directories per desktop package and profile"
