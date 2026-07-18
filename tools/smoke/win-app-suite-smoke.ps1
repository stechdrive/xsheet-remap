param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:OS -ne "Windows_NT") {
  throw "win-app-suite-smoke.ps1 can only run on Windows."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$sheetCorrectorTitle = -join ([char[]]@(0x30b7, 0x30fc, 0x30c8, 0x753b, 0x50cf, 0x88dc, 0x6b63))
$helperTitle = "xsheet-importer"
$previousDontWriteBytecode = $env:PYTHONDONTWRITEBYTECODE
$env:PYTHONDONTWRITEBYTECODE = "1"
Push-Location $repoRoot
try {
  if ($Build) {
    npm run build:dev:all
    if ($LASTEXITCODE -ne 0) {
      throw "desktop development suite build failed with exit code $LASTEXITCODE"
    }
  }

  $apps = @(
    [pscustomobject]@{
      Name = "xsheet-editor"
      ExpectedTitle = "xsheet-editor"
      ExePath = "dev-local/xsheet-editor.exe"
      ArgumentList = @()
      WorkingDirectory = "."
      MinWidth = 1024
      MinHeight = 720
    },
    [pscustomobject]@{
      Name = "xsheet-remap"
      ExpectedTitle = "xsheet-remap"
      ExePath = "dev-local/xsheet-remap.exe"
      ArgumentList = @()
      WorkingDirectory = "."
      MinWidth = 1024
      MinHeight = 720
    },
    [pscustomobject]@{
      Name = "xsheet-template"
      ExpectedTitle = "xsheet-template"
      ExePath = "dev-local/xsheet-template.exe"
      ArgumentList = @()
      WorkingDirectory = "."
      MinWidth = 1024
      MinHeight = 720
    },
    [pscustomobject]@{
      Name = "xsheet-corrector"
      ExpectedTitle = $sheetCorrectorTitle
      ExePath = "dev-local/xsheet-corrector.exe"
      ArgumentList = @()
      WorkingDirectory = "."
      MinWidth = 460
      MinHeight = 340
    },
    [pscustomobject]@{
      Name = "xsheet-importer"
      ExpectedTitle = $helperTitle
      ExePath = "release-local/csp-import-helper/python/pythonw.exe"
      ArgumentList = @("-m", "csp_import_helper", "--gui")
      WorkingDirectory = "release-local"
      CleanupExecutablePath = "release-local/csp-import-helper/python/pythonw.exe"
      MinWidth = 820
      MinHeight = 660
    }
  )

  foreach ($app in $apps) {
    Write-Host "[app-suite-smoke] checking $($app.Name)"
    $cleanupExecutablePath = if ($app.PSObject.Properties.Name -contains "CleanupExecutablePath") {
      [System.IO.Path]::GetFullPath((Join-Path $repoRoot $app.CleanupExecutablePath))
    } else {
      ""
    }
    $existingCleanupProcessIds = if ($cleanupExecutablePath) {
      @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $cleanupExecutablePath } | ForEach-Object { [int]$_.ProcessId })
    } else {
      @()
    }
    try {
      & (Join-Path $PSScriptRoot "win-desktop-smoke.ps1") `
        -ExePath $app.ExePath `
        -ExpectedTitle $app.ExpectedTitle `
        -ArgumentList $app.ArgumentList `
        -WorkingDirectory $app.WorkingDirectory `
        -MinWidth $app.MinWidth `
        -MinHeight $app.MinHeight
    } finally {
      if ($cleanupExecutablePath) {
        Get-CimInstance Win32_Process |
          Where-Object {
            $_.ExecutablePath -eq $cleanupExecutablePath -and
            $existingCleanupProcessIds -notcontains [int]$_.ProcessId
          } |
          ForEach-Object {
            Write-Host "[app-suite-smoke] stopping test child pid=$($_.ProcessId) path=$($_.ExecutablePath)"
            Stop-Process -Id $_.ProcessId -Force
          }
      }
    }
  }

  Write-Host "[app-suite-smoke] all five applications passed"
} finally {
  Pop-Location
  if ($null -eq $previousDontWriteBytecode) {
    Remove-Item Env:\PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue
  } else {
    $env:PYTHONDONTWRITEBYTECODE = $previousDontWriteBytecode
  }
}
