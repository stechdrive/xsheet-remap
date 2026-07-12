param(
  [Parameter(Mandatory = $true)]
  [string]$RunRoot,
  [string]$Out = "",
  [string]$OperationLog = "csp-import-log.json"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path -LiteralPath $RunRoot).Path
$xdts = Join-Path $root "export.normalized.xdts"
$assets = Join-Path $root "assets"
if (-not (Test-Path -LiteralPath $xdts)) {
  throw "XDTS not found: $xdts"
}
if (-not (Test-Path -LiteralPath $assets)) {
  throw "assets directory not found: $assets"
}

$outPath = if ($Out) { $Out } else { Join-Path $root "csp-import.xci" }
$xdtsText = Get-Content -LiteralPath $xdts -Raw -Encoding UTF8
$jsonStart = $xdtsText.IndexOf("{")
if ($jsonStart -lt 0) {
  throw "XDTS JSON body not found: $xdts"
}
$xdtsJson = $xdtsText.Substring($jsonStart) | ConvertFrom-Json
$trackNames = @($xdtsJson.timeTables[0].timeTableHeaders[0].names)

function Get-FirstTrackIndex {
  param([string]$Name)
  for ($index = 0; $index -lt $trackNames.Count; $index += 1) {
    if ($trackNames[$index] -eq $Name) {
      return $index
    }
  }
  return $null
}

function Get-PreviousSeparatorLabel {
  param([int]$BeforeIndex)
  for ($index = $BeforeIndex - 1; $index -ge 0; $index -= 1) {
    $name = [string]$trackNames[$index]
    $trimmed = $name.Trim()
    if ($trimmed.StartsWith("=====") -and $trimmed.EndsWith("=====")) {
      return ($trimmed -replace "^=+", "" -replace "=+$", "").Trim()
    }
  }
  return ""
}

$tracks = @()
foreach ($entry in @(
  [pscustomobject]@{ Name = "A"; VisibleRowIndex = 2 },
  [pscustomobject]@{ Name = "BG"; VisibleRowIndex = 14 }
)) {
  $name = $entry.Name
  $asset = Join-Path $assets "$($name)_01.png"
  if (Test-Path -LiteralPath $asset) {
    $trackIndex = Get-FirstTrackIndex -Name $name
    if ($null -eq $trackIndex) {
      continue
    }
    $stageLabel = Get-PreviousSeparatorLabel -BeforeIndex $trackIndex
    $kind = if ($name -eq "BG") { "stack-guide" } else { "cell" }
    $tracks += [pscustomobject]@{
      trackId = "smoke.$name"
      kind = $kind
      xdtsTrackName = $name
      stackOrder = $trackIndex
      stageId = "smoke.stage"
      stageLabel = $stageLabel
      targetFolderPath = @($stageLabel)
      automationHints = [pscustomobject]@{
        visibleRowIndex = $entry.VisibleRowIndex
      }
      cels = @(
        [pscustomobject]@{
          cspCellName = "$($name)_01"
          firstFrame = 0
          material = [pscustomobject]@{
            assetId = "smoke.asset.$name"
            pathKind = "asset-root-relative"
            path = "$($name)_01.png"
          }
        }
      )
    }
  }
}

$manifest = [pscustomobject]@{
  schemaVersion = 4
  createdBy = [pscustomobject]@{
    app = "xsheet-remap"
    version = "dev"
  }
  assetRoot = "assets"
  cuts = @(
    [pscustomobject]@{
      cutId = "smoke.cut"
      order = 0
      cutNumber = "SMOKE"
      displayName = "SMOKE"
      timelineName = "SMOKE"
      durationFrames = [int]$xdtsJson.timeTables[0].duration
      fps = [int]$xdtsJson.timeTables[0].frameRate
      files = [pscustomobject]@{
        xdts = "export.normalized.xdts"
        operationLog = $OperationLog
      }
      importStack = [pscustomobject]@{
        enabled = $true
        startSeparator = "===== XSHEET IMPORT START ====="
        endSeparator = "===== XSHEET IMPORT END ====="
      }
      tracks = $tracks
    }
  )
}

$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outPath -Encoding UTF8
Write-Host $outPath
