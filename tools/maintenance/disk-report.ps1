param(
  [switch]$Json
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Measure-TreeWithoutLinks {
  param([string]$Path)

  $bytes = 0L
  $files = 0L
  $stack = [System.Collections.Generic.Stack[string]]::new()
  $stack.Push([System.IO.Path]::GetFullPath($Path))
  while ($stack.Count -gt 0) {
    $current = $stack.Pop()
    try {
      foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($current)) {
        try {
          $attributes = [System.IO.File]::GetAttributes($entry)
          if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
              $stack.Push($entry)
            }
          } else {
            $bytes += ([System.IO.FileInfo]::new($entry)).Length
            $files++
          }
        } catch {
          # Continue reporting other entries when a local cache file is locked.
        }
      }
    } catch {
      # Continue reporting other roots when a directory is unreadable.
    }
  }
  return [pscustomobject]@{ Bytes = $bytes; Files = $files }
}

$rows = New-Object System.Collections.Generic.List[object]
foreach ($item in Get-ChildItem -LiteralPath $repoRoot -Force) {
  $measurement = if ($item.PSIsContainer) {
    Measure-TreeWithoutLinks $item.FullName
  } else {
    [pscustomobject]@{ Bytes = $item.Length; Files = 1 }
  }
  $rows.Add([pscustomobject]@{
    name = $item.Name
    kind = if ($item.PSIsContainer) { "directory" } else { "file" }
    bytes = $measurement.Bytes
    gib = [math]::Round($measurement.Bytes / 1GB, 3)
    files = $measurement.Files
  })
}

$orderedRows = @($rows | Sort-Object bytes -Descending)
if ($Json) {
  [ordered]@{
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    repository = $repoRoot
    totalBytes = ($orderedRows | Measure-Object bytes -Sum).Sum
    entries = $orderedRows
  } | ConvertTo-Json -Depth 5
} else {
  $orderedRows | Select-Object name, kind, gib, files | Format-Table -AutoSize
  $totalBytes = ($orderedRows | Measure-Object bytes -Sum).Sum
  Write-Host ("[disk-report] repository total: {0:N2} GiB" -f ($totalBytes / 1GB))
}
