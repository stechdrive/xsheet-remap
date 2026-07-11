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
$helperTitle = "CSP" + (-join ([char[]]@(0x81ea, 0x52d5, 0x767b, 0x9332, 0x30d8, 0x30eb, 0x30d1, 0x30fc)))
$previousDontWriteBytecode = $env:PYTHONDONTWRITEBYTECODE
$env:PYTHONDONTWRITEBYTECODE = "1"
Push-Location $repoRoot
try {
  if ($Build) {
    npm run build:desktop
    if ($LASTEXITCODE -ne 0) {
      throw "desktop suite build failed with exit code $LASTEXITCODE"
    }
  }

  $apps = @(
    [pscustomobject]@{
      Name = "xsheet-editor"
      ExpectedTitle = "xsheet-editor"
      ExePath = "apps/editor/src-tauri/target/release/xsheet-editor.exe"
      ArgumentList = @()
      WorkingDirectory = "."
      MinWidth = 1024
      MinHeight = 720
    },
    [pscustomobject]@{
      Name = "xsheet-remap"
      ExpectedTitle = "xsheet-remap"
      ExePath = "apps/desktop/src-tauri/target/release/xsheet-remap.exe"
      ArgumentList = @()
      WorkingDirectory = "."
      MinWidth = 1024
      MinHeight = 720
    },
    [pscustomobject]@{
      Name = "xsheet-template-editor"
      ExpectedTitle = "xsheet-template-editor"
      ExePath = "apps/template-editor/src-tauri/target/release/xsheet-template-editor.exe"
      ArgumentList = @()
      WorkingDirectory = "."
      MinWidth = 1024
      MinHeight = 720
    },
    [pscustomobject]@{
      Name = "xsheet-corrector"
      ExpectedTitle = $sheetCorrectorTitle
      ExePath = "apps/sheet-corrector/src-tauri/target/release/xsheet-corrector.exe"
      ArgumentList = @()
      WorkingDirectory = "."
      MinWidth = 460
      MinHeight = 340
    },
    [pscustomobject]@{
      Name = "xsheet-csp-import-helper"
      ExpectedTitle = $helperTitle
      ExePath = "release-local/csp-import-helper/python/pythonw.exe"
      ArgumentList = @("-m", "csp_import_helper", "--gui")
      WorkingDirectory = "release-local"
      MinWidth = 820
      MinHeight = 660
    }
  )

  foreach ($app in $apps) {
    Write-Host "[app-suite-smoke] checking $($app.Name)"
    & (Join-Path $PSScriptRoot "win-desktop-smoke.ps1") `
      -ExePath $app.ExePath `
      -ExpectedTitle $app.ExpectedTitle `
      -ArgumentList $app.ArgumentList `
      -WorkingDirectory $app.WorkingDirectory `
      -MinWidth $app.MinWidth `
      -MinHeight $app.MinHeight
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
