param(
  [string]$ExePath = "apps/desktop/src-tauri/target/release/xsheet-remap.exe",
  [string]$ArtifactRoot = ".tmp/desktop-e2e-real-dnd",
  [string]$PythonPath = "python",
  [int]$TimeoutSeconds = 45,
  [switch]$Build,
  [switch]$KeepOpen
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:OS -ne "Windows_NT") {
  throw "win-real-dnd.ps1 can only run on Windows."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

if ($Build) {
  Write-Host "[real-dnd] building desktop executable..."
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
$sourceRoot = Join-Path $runRoot "source"
$cutFolder = Join-Path $sourceRoot "cut-folder"
$directFileFolder = Join-Path $sourceRoot "direct-file"
$exportRoot = Join-Path $runRoot "exports"
$profileRoot = Join-Path $runRoot "profile"
$webViewRoot = Join-Path $profileRoot "webview2"
$logRoot = Join-Path $runRoot "logs"
$screenshotRoot = Join-Path $runRoot "screenshots"
$tempRoot = Join-Path $runRoot "temp"
$resultPath = Join-Path $runRoot "result.json"
$reportPath = Join-Path $runRoot "real-dnd-report.json"
$summaryPath = Join-Path $runRoot "summary.json"

@($runRoot, $sourceRoot, $cutFolder, $directFileFolder, $exportRoot, $profileRoot, $webViewRoot, $logRoot, $screenshotRoot, $tempRoot) |
  ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

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
    $graphics.DrawString($Label, $font, [System.Drawing.Brushes]::Black, 12, 44)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    if ($font) { $font.Dispose() }
    $graphics.Dispose()
    $bitmap.Dispose()
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

function Resolve-Python {
  param([string]$RequestedPython)

  if ([System.IO.Path]::IsPathRooted($RequestedPython) -and (Test-Path -LiteralPath $RequestedPython)) {
    return (Resolve-Path -LiteralPath $RequestedPython).Path
  }
  $runtimePython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  if (Test-Path -LiteralPath $runtimePython) {
    return (Resolve-Path -LiteralPath $runtimePython).Path
  }
  return $RequestedPython
}

function Ensure-RealDndVenv {
  param([string]$BasePython)

  $venvRoot = Join-Path $repoRoot ".tmp\win-real-dnd-venv"
  $venvPython = Join-Path $venvRoot "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "[real-dnd] creating Python venv: $venvRoot"
    & $BasePython -m venv $venvRoot
    if ($LASTEXITCODE -ne 0) {
      throw "failed to create Python venv"
    }
  }

  & $venvPython -c "import pywinauto" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[real-dnd] installing pywinauto dependencies into isolated venv..."
    & $venvPython -m pip install -r (Join-Path $repoRoot "tools\e2e\win-real-dnd\requirements.txt")
    if ($LASTEXITCODE -ne 0) {
      throw "failed to install pywinauto dependencies"
    }
  }
  return $venvPython
}

function Close-TestExplorerWindows {
  param([string]$RootPath)

  $normalizedRoot = ([System.IO.Path]::GetFullPath($RootPath)).Replace('\', '/').TrimEnd('/')
  $rootUrl = "file:///$normalizedRoot"
  try {
    $shell = New-Object -ComObject Shell.Application
    foreach ($window in @($shell.Windows())) {
      try {
        $url = [string]$window.LocationURL
        if ($url -like "$rootUrl/*") {
          $window.Quit()
        }
      } catch {
        # Ignore stale shell windows. This cleanup only prevents old E2E Explorer
        # windows from becoming accidental drop targets.
      }
    }
  } catch {
    Write-Host "[real-dnd] warning: failed to inspect Explorer windows: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

New-E2EImage -Path (Join-Path $cutFolder "A1.png") -Label "A1" -Color "LightSkyBlue"
New-E2EImage -Path (Join-Path $cutFolder "A1_e.png") -Label "A1_e" -Color "MistyRose"
New-E2EImage -Path (Join-Path $cutFolder "A2.png") -Label "A2" -Color "LightGreen"
New-E2EImage -Path (Join-Path $cutFolder "sheet_001.png") -Label "SHEET" -Color "WhiteSmoke"
New-E2EImage -Path (Join-Path $directFileFolder "Direct_A2.png") -Label "Direct A2" -Color "LightGreen"
Close-TestExplorerWindows -RootPath $artifactRootPath

$basePython = Resolve-Python -RequestedPython $PythonPath
$venvPython = Ensure-RealDndVenv -BasePython $basePython
$remoteDebugPort = Get-FreeTcpPort

$previousEnvironment = @{}
$environmentOverrides = @{
  "XSHEET_REMAP_E2E" = "1"
  "XSHEET_REMAP_E2E_SCENARIO" = "real-dnd"
  "XSHEET_REMAP_E2E_ROOT" = $runRoot
  "XSHEET_REMAP_E2E_ASSETS" = $cutFolder
  "XSHEET_REMAP_E2E_EXPORTS" = $exportRoot
  "WEBVIEW2_USER_DATA_FOLDER" = $webViewRoot
  "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS" = "--remote-debugging-port=$remoteDebugPort"
  "TEMP" = $tempRoot
  "TMP" = $tempRoot
}

foreach ($key in $environmentOverrides.Keys) {
  $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
  [Environment]::SetEnvironmentVariable($key, $environmentOverrides[$key], "Process")
}

$manifestPath = Join-Path $runRoot "manifest.json"
[pscustomobject]@{
  runId = $runId
  scenario = "real-dnd"
  exePath = $resolvedExePath
  runRoot = $runRoot
  cutFolder = $cutFolder
  directFile = Join-Path $directFileFolder "Direct_A2.png"
  sourceRoot = $sourceRoot
  remoteDebugPort = $remoteDebugPort
  python = $venvPython
  environment = $environmentOverrides
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "[real-dnd] run root: $runRoot"
Write-Host "[real-dnd] This test moves the real mouse. Do not use the desktop until it finishes." -ForegroundColor Yellow

$process = $null
$passed = $false
$errorMessage = $null

try {
  $process = Start-Process -FilePath $resolvedExePath -PassThru -WindowStyle Normal -WorkingDirectory $runRoot
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      throw "desktop process exited before CDP scenario started. Exit code: $($process.ExitCode)"
    }
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$remoteDebugPort/json" -TimeoutSec 1
      if ($targets) { break }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }

  $tsxPath = Join-Path $repoRoot "node_modules\.bin\tsx.cmd"
  & $tsxPath "tools/e2e/win-real-dnd/real-dnd-cdp.ts" `
    "--port" "$remoteDebugPort" `
    "--python" "$venvPython" `
    "--app-pid" "$($process.Id)" `
    "--folder" "$cutFolder" `
    "--direct-file" "$(Join-Path $directFileFolder "Direct_A2.png")" `
    "--allowed-root" "$runRoot" `
    "--result" "$resultPath" `
    "--report" "$reportPath"
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "real DnD CDP scenario failed with exit code $exitCode"
  }

  $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if (-not $result.passed) {
    throw "real DnD scenario failed: $($result.error)"
  }

  if ($KeepOpen) {
    Write-Host "[real-dnd] KeepOpen is enabled. Press Enter to close the launched app."
    [void][Console]::ReadLine()
  }

  $passed = $true
  Write-Host "[real-dnd] passed"
} catch {
  $errorMessage = $_.Exception.Message
  Write-Host "[real-dnd] failed: $errorMessage" -ForegroundColor Red
  throw
} finally {
  [pscustomobject]@{
    runId = $runId
    scenario = "real-dnd"
    passed = $passed
    error = $errorMessage
    processId = if ($process) { $process.Id } else { $null }
    manifest = $manifestPath
    result = if (Test-Path -LiteralPath $resultPath) { $resultPath } else { $null }
    report = if (Test-Path -LiteralPath $reportPath) { $reportPath } else { $null }
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

  if ($process -and -not $process.HasExited) {
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(5000)) {
      Stop-Process -Id $process.Id -Force
    }
  }

  Close-TestExplorerWindows -RootPath $artifactRootPath

  foreach ($key in $environmentOverrides.Keys) {
    [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], "Process")
  }

  Write-Host "[real-dnd] summary: $summaryPath"
}
