param(
  [string]$ExePath = "apps/editor/src-tauri/target/release/xsheet-editor.exe",
  [string]$Scenario = "launch",
  [string]$FixtureSource = "",
  [string]$ArtifactRoot = ".tmp/desktop-e2e",
  [string]$ExpectedTitle = "xsheet-editor",
  [int]$TimeoutSeconds = 30,
  [int]$StableSeconds = 3,
  [int]$MinWidth = 800,
  [int]$MinHeight = 600,
  [switch]$Build,
  [switch]$RequireScreenshot,
  [switch]$KeepOpen
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:OS -ne "Windows_NT") {
  throw "win-desktop-e2e.ps1 can only run on Windows."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

$supportedScenarios = @("launch", "full-default-a3", "sheet-ops", "sound-ops", "auto-calibration")
if (-not ($supportedScenarios -contains $Scenario)) {
  throw "unsupported desktop e2e scenario: $Scenario"
}

if ($Build) {
  Write-Host "[desktop-e2e] building desktop executable..."
  npm run build:desktop
  if ($LASTEXITCODE -ne 0) {
    throw "desktop build failed with exit code $LASTEXITCODE"
  }
}

$candidateExePath = if ([System.IO.Path]::IsPathRooted($ExePath)) {
  $ExePath
} else {
  Join-Path $repoRoot $ExePath
}

if (-not (Test-Path -LiteralPath $candidateExePath)) {
  throw "desktop executable not found: $candidateExePath"
}

$resolvedExePath = (Resolve-Path -LiteralPath $candidateExePath).Path
$artifactRootPath = if ([System.IO.Path]::IsPathRooted($ArtifactRoot)) {
  [System.IO.Path]::GetFullPath($ArtifactRoot)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repoRoot $ArtifactRoot))
}

$runId = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$runRoot = Join-Path $artifactRootPath $runId
$assetRoot = Join-Path $runRoot "assets"
$exportRoot = Join-Path $runRoot "exports"
$profileRoot = Join-Path $runRoot "profile"
$webViewRoot = Join-Path $profileRoot "webview2"
$logRoot = Join-Path $runRoot "logs"
$screenshotRoot = Join-Path $runRoot "screenshots"
$tempRoot = Join-Path $runRoot "temp"

@($runRoot, $assetRoot, $exportRoot, $profileRoot, $webViewRoot, $logRoot, $screenshotRoot, $tempRoot) |
  ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

if (-not ("WinDesktopE2EUser32" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WinDesktopE2EUser32
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@
}

function Get-VisibleProcessWindows {
  param([int]$ProcessId)

  $windows = New-Object System.Collections.Generic.List[object]
  $callback = [WinDesktopE2EUser32+EnumWindowsProc]{
    param([IntPtr]$Handle, [IntPtr]$Param)

    if (-not [WinDesktopE2EUser32]::IsWindowVisible($Handle)) {
      return $true
    }

    [uint32]$windowProcessId = 0
    [void][WinDesktopE2EUser32]::GetWindowThreadProcessId($Handle, [ref]$windowProcessId)
    if ($windowProcessId -ne [uint32]$ProcessId) {
      return $true
    }

    $titleBuilder = New-Object System.Text.StringBuilder 512
    [void][WinDesktopE2EUser32]::GetWindowText($Handle, $titleBuilder, $titleBuilder.Capacity)

    $rect = New-Object WinDesktopE2EUser32+RECT
    [void][WinDesktopE2EUser32]::GetWindowRect($Handle, [ref]$rect)

    $windows.Add([pscustomobject]@{
      Handle = $Handle
      Title = $titleBuilder.ToString()
      Left = $rect.Left
      Top = $rect.Top
      Width = $rect.Right - $rect.Left
      Height = $rect.Bottom - $rect.Top
    })

    return $true
  }

  [void][WinDesktopE2EUser32]::EnumWindows($callback, [IntPtr]::Zero)
  return $windows
}

function New-E2EImage {
  param(
    [string]$Path,
    [string]$Label,
    [string]$Color
  )

  Add-Type -AssemblyName System.Drawing
  $bitmap = New-Object System.Drawing.Bitmap 180, 120
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $font = $null
  try {
    $graphics.Clear([System.Drawing.Color]::FromName($Color))
    $font = New-Object System.Drawing.Font "Arial", 18, ([System.Drawing.FontStyle]::Bold)
    $brush = [System.Drawing.Brushes]::Black
    $graphics.DrawString($Label, $font, $brush, 12, 44)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    if ($font) { $font.Dispose() }
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function New-FullDefaultA3FixtureSet {
  param([string]$Destination)

  $names = @(
    "A1.png", "A1_e.png", "A1_k.png", "A1_s.png", "A1_y.png", "A1_ss.png",
    "B1.png", "C1.png", "D1.png", "E1.png", "F1.png", "G1.png", "H1.png", "I1.png",
    "J1.png", "K1.png", "L1.png",
    "BG.png", "BG_e.png", "BOOK1.png", "BOOK1_e.png", "BOOK2_3.png",
    "SL1.png", "SL1_e.png", "PAN1.png", "MEMO1.png", "MEMO1_ss.png",
    "sheet_001.png", "sheet_002.png"
  )
  $colors = @("LightSkyBlue", "MistyRose", "Khaki", "LightGreen", "Plum", "PeachPuff", "Gainsboro", "Lavender")
  for ($index = 0; $index -lt $names.Count; $index += 1) {
    $name = $names[$index]
    New-E2EImage -Path (Join-Path $Destination $name) -Label ([System.IO.Path]::GetFileNameWithoutExtension($name)) -Color $colors[$index % $colors.Count]
  }
}

function Copy-E2EFixtures {
  param(
    [string]$Source,
    [string]$Destination,
    [string]$ScenarioName
  )

  if ([string]::IsNullOrWhiteSpace($Source)) {
    if ($ScenarioName -eq "full-default-a3") {
      New-FullDefaultA3FixtureSet -Destination $Destination
      return
    }
    New-E2EImage -Path (Join-Path $Destination "A1.png") -Label "A1" -Color "LightSkyBlue"
    New-E2EImage -Path (Join-Path $Destination "A2.png") -Label "A2" -Color "LightGreen"
    New-E2EImage -Path (Join-Path $Destination "A1_e.png") -Label "A1_e" -Color "MistyRose"
    if ($ScenarioName -eq "auto-calibration") {
      $templateFixture = Join-Path $repoRoot "apps\web\public\templates\standard-a3\timesheet.png"
      if (-not (Test-Path -LiteralPath $templateFixture)) {
        $templateFixture = Join-Path $repoRoot "reference-local\templates\standard-a3\timesheet.png"
      }
      if (Test-Path -LiteralPath $templateFixture) {
        Copy-Item -LiteralPath $templateFixture -Destination (Join-Path $Destination "sheet_001.png") -Force
      } else {
        New-E2EImage -Path (Join-Path $Destination "sheet_001.png") -Label "SHEET 1" -Color "WhiteSmoke"
      }
    } else {
      New-E2EImage -Path (Join-Path $Destination "sheet_001.png") -Label "SHEET 1" -Color "WhiteSmoke"
    }
    New-E2EImage -Path (Join-Path $Destination "sheet_002.png") -Label "SHEET 2" -Color "Gainsboro"
    return
  }

  $resolvedSource = Resolve-Path -LiteralPath $Source
  $sourceItem = Get-Item -LiteralPath $resolvedSource.Path
  if ($sourceItem.PSIsContainer) {
    Copy-Item -LiteralPath $sourceItem.FullName -Destination (Join-Path $Destination $sourceItem.Name) -Recurse -Force
  } else {
    Copy-Item -LiteralPath $sourceItem.FullName -Destination (Join-Path $Destination $sourceItem.Name) -Force
  }
}

function Save-WindowScreenshot {
  param(
    [object]$Window,
    [string]$Path
  )

  try {
    Add-Type -AssemblyName System.Drawing
    [void][WinDesktopE2EUser32]::ShowWindow($Window.Handle, 9)
    [void][WinDesktopE2EUser32]::SetForegroundWindow($Window.Handle)
    Start-Sleep -Milliseconds 300

    $width = [Math]::Max(1, [int]$Window.Width)
    $height = [Math]::Max(1, [int]$Window.Height)
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen([int]$Window.Left, [int]$Window.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
      $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
    return $true
  } catch {
    $errorPath = [System.IO.Path]::ChangeExtension($Path, ".error.txt")
    $_.Exception.Message | Set-Content -LiteralPath $errorPath -Encoding UTF8
    Write-Host "[desktop-e2e] screenshot capture skipped: $($_.Exception.Message)" -ForegroundColor Yellow
    return $false
  }
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

Copy-E2EFixtures -Source $FixtureSource -Destination $assetRoot -ScenarioName $Scenario

$manifestPath = Join-Path $runRoot "manifest.json"
$summaryPath = Join-Path $runRoot "summary.json"
$scenarioResultPath = Join-Path $runRoot "result.json"
$screenshotPath = Join-Path $screenshotRoot "launch.png"
$remoteDebugPort = if ($Scenario -eq "sheet-ops" -or $Scenario -eq "sound-ops" -or $Scenario -eq "auto-calibration") { Get-FreeTcpPort } else { $null }
$previousEnvironment = @{}
$environmentOverrides = @{
  "XSHEET_REMAP_E2E" = "1"
  "XSHEET_REMAP_E2E_SCENARIO" = $Scenario
  "XSHEET_REMAP_E2E_ROOT" = $runRoot
  "XSHEET_REMAP_E2E_ASSETS" = $assetRoot
  "XSHEET_REMAP_E2E_EXPORTS" = $exportRoot
  "WEBVIEW2_USER_DATA_FOLDER" = $webViewRoot
  "TEMP" = $tempRoot
  "TMP" = $tempRoot
}
if ($remoteDebugPort) {
  $environmentOverrides["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=$remoteDebugPort"
}

foreach ($key in $environmentOverrides.Keys) {
  $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
  [Environment]::SetEnvironmentVariable($key, $environmentOverrides[$key], "Process")
}

$manifest = [pscustomobject]@{
  runId = $runId
  scenario = $Scenario
  exePath = $resolvedExePath
  runRoot = $runRoot
  assetRoot = $assetRoot
  exportRoot = $exportRoot
  profileRoot = $profileRoot
  webViewRoot = $webViewRoot
  screenshotRoot = $screenshotRoot
  environment = $environmentOverrides
  fixtureFiles = @(Get-ChildItem -LiteralPath $assetRoot -Recurse -File | ForEach-Object { $_.FullName })
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "[desktop-e2e] run root: $runRoot"
Write-Host "[desktop-e2e] launching $resolvedExePath"

$process = $null
$matchedWindow = $null
$passed = $false
$errorMessage = $null
$screenshotCaptured = $false
$scenarioResult = $null

try {
  $process = Start-Process -FilePath $resolvedExePath -PassThru -WindowStyle Normal -WorkingDirectory $runRoot
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      throw "desktop process exited before a visible window appeared. Exit code: $($process.ExitCode)"
    }

    $matchedWindow = Get-VisibleProcessWindows -ProcessId $process.Id |
      Where-Object { $_.Title -like "*$ExpectedTitle*" -and $_.Width -ge $MinWidth -and $_.Height -ge $MinHeight } |
      Select-Object -First 1

    if ($matchedWindow) {
      break
    }

    Start-Sleep -Milliseconds 250
  }

  if (-not $matchedWindow) {
    $windows = Get-VisibleProcessWindows -ProcessId $process.Id
    $windowSummary = if ($windows.Count -gt 0) {
      ($windows | ForEach-Object { "'$($_.Title)' $($_.Width)x$($_.Height)" }) -join ", "
    } else {
      "none"
    }
    throw "no matching desktop window found within ${TimeoutSeconds}s. Observed windows: $windowSummary"
  }

  Write-Host "[desktop-e2e] found window '$($matchedWindow.Title)' $($matchedWindow.Width)x$($matchedWindow.Height)"
  $screenshotCaptured = Save-WindowScreenshot -Window $matchedWindow -Path $screenshotPath
  if ($screenshotCaptured) {
    Write-Host "[desktop-e2e] saved screenshot: $screenshotPath"
  } elseif ($RequireScreenshot) {
    throw "screenshot capture failed and RequireScreenshot is set"
  }

  Start-Sleep -Seconds $StableSeconds
  if ($process.HasExited) {
    throw "desktop process exited during the ${StableSeconds}s stability window. Exit code: $($process.ExitCode)"
  }

  if ($Scenario -eq "sheet-ops" -or $Scenario -eq "sound-ops") {
    $sheetOpsReportPath = Join-Path $runRoot "$Scenario-report.json"
    $sheetOpsAssetPath = Join-Path $assetRoot "A1.png"
    $sheetOpsSecondaryAssetPath = Join-Path $assetRoot "A2.png"
    $sheetOpsSourcePath = Join-Path $assetRoot "sheet_001.png"
    $sheetOpsSecondarySourcePath = Join-Path $assetRoot "sheet_002.png"
    $tsxPath = Join-Path $repoRoot "node_modules\.bin\tsx.cmd"
    Write-Host "[desktop-e2e] running $Scenario CDP scenario on port $remoteDebugPort"
    $sheetOpsArguments = @(
      "tools/e2e/sheet-ops-cdp.ts",
      "--port", "$remoteDebugPort",
      "--result", "$scenarioResultPath",
      "--report", "$sheetOpsReportPath",
      "--asset", "$sheetOpsAssetPath",
      "--asset-secondary", "$sheetOpsSecondaryAssetPath",
      "--asset-root", "$assetRoot",
      "--sheet-source", "$sheetOpsSourcePath",
      "--sheet-source-secondary", "$sheetOpsSecondarySourcePath"
    )
    if ($Scenario -eq "sound-ops") {
      $sheetOpsArguments += @("--sound-only", "true")
    }
    & $tsxPath @sheetOpsArguments
    $sheetOpsExitCode = $LASTEXITCODE
    if ($sheetOpsExitCode -ne 0 -and -not (Test-Path -LiteralPath $scenarioResultPath)) {
      throw "sheet-ops CDP scenario failed before writing result.json. Exit code: $sheetOpsExitCode"
    }
  }

  if ($Scenario -eq "auto-calibration") {
    $autoCalibrationReportPath = Join-Path $runRoot "auto-calibration-report.json"
    $autoCalibrationSource = Get-ChildItem -LiteralPath $assetRoot -File |
      Where-Object { $_.Extension -match '^\.(png|jpg|jpeg)$' } |
      Where-Object { $_.BaseName -match 'sheet' } |
      Sort-Object Name |
      Select-Object -First 1
    if (-not $autoCalibrationSource) {
      $autoCalibrationSource = Get-ChildItem -LiteralPath $assetRoot -File |
        Where-Object { $_.Extension -match '^\.(png|jpg|jpeg)$' } |
        Sort-Object Name |
        Select-Object -First 1
    }
    if (-not $autoCalibrationSource) {
      throw "auto-calibration scenario requires at least one image fixture"
    }
    $tsxPath = Join-Path $repoRoot "node_modules\.bin\tsx.cmd"
    Write-Host "[desktop-e2e] running auto-calibration CDP scenario on port $remoteDebugPort"
    & $tsxPath "tools/e2e/auto-calibration-cdp.ts" `
      "--port" "$remoteDebugPort" `
      "--result" "$scenarioResultPath" `
      "--report" "$autoCalibrationReportPath" `
      "--sheet-source" "$($autoCalibrationSource.FullName)"
    $autoCalibrationExitCode = $LASTEXITCODE
    if ($autoCalibrationExitCode -ne 0 -and -not (Test-Path -LiteralPath $scenarioResultPath)) {
      throw "auto-calibration CDP scenario failed before writing result.json. Exit code: $autoCalibrationExitCode"
    }
  }

  if ($Scenario -ne "launch") {
    $scenarioDeadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $scenarioDeadline) {
      if ($process.HasExited) {
        throw "desktop process exited before scenario result was written. Exit code: $($process.ExitCode)"
      }
      if (Test-Path -LiteralPath $scenarioResultPath) {
        break
      }
      Start-Sleep -Milliseconds 250
    }

    if (-not (Test-Path -LiteralPath $scenarioResultPath)) {
      throw "desktop e2e scenario did not write result.json within ${TimeoutSeconds}s"
    }

    $scenarioResult = Get-Content -LiteralPath $scenarioResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $scenarioResult.passed) {
      $scenarioError = if ($scenarioResult.error) { $scenarioResult.error } else { "unknown scenario failure" }
      throw "desktop e2e scenario failed: $scenarioError"
    }
    Write-Host "[desktop-e2e] scenario result passed: $scenarioResultPath"
    if ($scenarioResult.PSObject.Properties.Name -contains "cspValidation") {
      Write-Host "[desktop-e2e] CSP validation XDTS: $($scenarioResult.cspValidation.xdtsPath)"
      Write-Host "[desktop-e2e] CSP validation assets: $($scenarioResult.cspValidation.assetsPath)"
      Write-Host "[desktop-e2e] CSP validation guide: $($scenarioResult.cspValidation.guidePath)"
    }
  }

  if ($KeepOpen) {
    Write-Host "[desktop-e2e] KeepOpen is enabled. Press Enter to close the launched app."
    [void][Console]::ReadLine()
  }

  $passed = $true
  Write-Host "[desktop-e2e] passed"
} catch {
  $errorMessage = $_.Exception.Message
  Write-Host "[desktop-e2e] failed: $errorMessage" -ForegroundColor Red
  throw
} finally {
  $summary = [pscustomobject]@{
    runId = $runId
    scenario = $Scenario
    passed = $passed
    error = $errorMessage
    processId = if ($process) { $process.Id } else { $null }
    window = $matchedWindow
    screenshotCaptured = $screenshotCaptured
    screenshot = if (Test-Path -LiteralPath $screenshotPath) { $screenshotPath } else { $null }
    manifest = $manifestPath
    cspValidation = if ($scenarioResult -and ($scenarioResult.PSObject.Properties.Name -contains "cspValidation")) { $scenarioResult.cspValidation } else { $null }
  }
  $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

  if ($process -and -not $process.HasExited) {
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(5000)) {
      Stop-Process -Id $process.Id -Force
    }
  }

  foreach ($key in $environmentOverrides.Keys) {
    [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], "Process")
  }

  Write-Host "[desktop-e2e] summary: $summaryPath"
}
