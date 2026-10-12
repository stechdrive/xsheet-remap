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
Push-Location $repoRoot
try {
  if ($Build) {
    npm run build:dev -- --target all
    if ($LASTEXITCODE -ne 0) {
      throw "desktop development suite build failed with exit code $LASTEXITCODE"
    }
  }

  $apps = @(
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

  Write-Host "[app-suite-smoke] all three applications passed"
} finally {
  Pop-Location
}
