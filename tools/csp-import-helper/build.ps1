param(
  [string]$Python = "",
  [string]$OutputDir = "",
  [switch]$CopyToLocalRelease,
  [switch]$IncludeCliInLocalRelease,
  [switch]$IncludeOcrDiagnostics,
  [switch]$ForceCleanVenv,
  [switch]$SkipLeakCheck,
  [string]$PythonEmbedZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$appRoot = Join-Path $repoRoot "apps\csp-import-helper"
$venvRoot = Join-Path $repoRoot ".tmp\csp-import-helper-build-venv"
$distRoot = if ($OutputDir) { [System.IO.Path]::GetFullPath($OutputDir) } else { Join-Path $repoRoot ".tmp\csp-import-helper-dist" }
$packageRoot = Join-Path $distRoot "xsheet-importer"
$runtimeRoot = Join-Path $packageRoot "csp-import-helper"
$pythonRoot = Join-Path $runtimeRoot "python"
$appOutputRoot = Join-Path $runtimeRoot "app"
$sitePackagesRoot = Join-Path $runtimeRoot "site-packages"
$launcherRoot = Join-Path $appRoot "launcher"
$launcherTargetRoot = Join-Path $repoRoot ".tmp\csp-import-helper-launcher-target"
$diagnosticModuleNames = @(
  "bidi",
  "cv2",
  "imagesize",
  "modelscope",
  "numpy",
  "onnxruntime",
  "paddle",
  "paddleocr",
  "paddlex",
  "pandas",
  "pyclipper",
  "pypdfium2",
  "rapidocr_onnxruntime",
  "shapely",
  "winrt"
)

function Test-IsInsideOrEqualPath {
  param(
    [string]$Path,
    [string]$Directory
  )

  $pathTrimChars = [char[]]@(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd($pathTrimChars)
  $fullDirectory = [System.IO.Path]::GetFullPath($Directory).TrimEnd($pathTrimChars)
  return (
    $fullPath.Equals($fullDirectory, [System.StringComparison]::OrdinalIgnoreCase) -or
    $fullPath.StartsWith(
      $fullDirectory + [System.IO.Path]::DirectorySeparatorChar,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  )
}

function Remove-DirectorySafely {
  param(
    [string]$Path,
    [string]$AllowedRoot,
    [string]$Description
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $resolvedPath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
  $resolvedAllowedRoot = [System.IO.Path]::GetFullPath($AllowedRoot)
  if (-not (Test-IsInsideOrEqualPath -Path $resolvedPath -Directory $resolvedAllowedRoot)) {
    throw "refusing to remove $Description outside allowed root: $resolvedPath"
  }
  Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Get-PythonCommand {
  if ($Python) {
    return @($Python)
  }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return @($py.Source, "-3")
  }
  return @("python")
}

function Invoke-SelectedPython {
  param([string[]]$Arguments)
  $command = Get-PythonCommand
  $exe = $command[0]
  $prefixArgs = @()
  if ($command.Count -gt 1) {
    $prefixArgs = $command[1..($command.Count - 1)]
  }
  & $exe @prefixArgs @Arguments
}

function Remove-VenvSafely {
  param([string]$Reason)

  if (-not (Test-Path -LiteralPath $venvRoot)) {
    return
  }

  Write-Host "[csp-import-helper] rebuilding venv ($Reason): $venvRoot"
  Remove-DirectorySafely -Path $venvRoot -AllowedRoot $repoRoot -Description "venv"
}

function Get-SelectedPythonMajorMinor {
  $lines = @(
    Invoke-SelectedPython @(
      "-c",
      "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    )
  )
  if ($LASTEXITCODE -ne 0 -or $lines.Count -lt 1) {
    $command = (Get-PythonCommand) -join " "
    throw "failed to start the selected build Python: $command"
  }
  return ([string]$lines[0]).Trim()
}

function Test-PythonModuleInstalled {
  param(
    [string]$PythonExe,
    [string]$ModuleName
  )

  & $PythonExe -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)" $ModuleName | Out-Null
  return $LASTEXITCODE -eq 0
}

function Assert-ExpectedVenv {
  param([string]$ExpectedMajorMinor)

  if (-not (Test-Path -LiteralPath $venvRoot)) {
    return
  }
  $venvPython = Join-Path $venvRoot "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $venvPython)) {
    Remove-VenvSafely "Python executable is missing"
    return
  }

  $versionLines = @()
  try {
    $versionLines = @(& $venvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null)
  } catch {
    Remove-VenvSafely "Python interpreter is unavailable"
    return
  }
  if ($LASTEXITCODE -ne 0 -or $versionLines.Count -lt 1) {
    Remove-VenvSafely "Python interpreter is unavailable"
    return
  }

  $version = ([string]$versionLines[0]).Trim()
  if ($version -ne $ExpectedMajorMinor) {
    Remove-VenvSafely "selected Python is $ExpectedMajorMinor, venv uses $version"
    return
  }
  if ($ForceCleanVenv) {
    Remove-VenvSafely "ForceCleanVenv"
    return
  }
  if (-not $IncludeOcrDiagnostics) {
    foreach ($moduleName in $diagnosticModuleNames) {
      if (Test-PythonModuleInstalled -PythonExe $venvPython -ModuleName $moduleName) {
        Remove-VenvSafely "diagnostic OCR module '$moduleName' is installed but this is a release build"
        return
      }
    }
  }
}

function Get-BuildPythonInfo {
  param([string]$PythonExe)

  $lines = & $PythonExe -c @'
import platform
import sys
print(str(sys.version_info.major)+chr(46)+str(sys.version_info.minor)+chr(46)+str(sys.version_info.micro))
print(str(sys.version_info.major)+str(sys.version_info.minor))
print(platform.machine())
'@
  if ($LASTEXITCODE -ne 0 -or $lines.Count -lt 3) {
    throw "failed to read build Python version"
  }
  return [pscustomobject]@{
    Version = [string]$lines[0]
    Tag = [string]$lines[1]
    Machine = [string]$lines[2]
  }
}

function Resolve-PythonEmbedZip {
  param([string]$PythonVersion)

  if ($PythonEmbedZip) {
    $resolved = [System.IO.Path]::GetFullPath($PythonEmbedZip)
    if (-not (Test-Path -LiteralPath $resolved)) {
      throw "Python embeddable ZIP not found: $resolved"
    }
    return $resolved
  }

  $cacheRoot = Join-Path $repoRoot ".tmp\python-embed"
  New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
  $archivePath = Join-Path $cacheRoot "python-$PythonVersion-embed-amd64.zip"
  if (-not (Test-Path -LiteralPath $archivePath)) {
    $url = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
    Write-Host "[csp-import-helper] downloading Python embeddable runtime: $url"
    Invoke-WebRequest -Uri $url -OutFile $archivePath
  }
  return $archivePath
}

function Write-PythonPathFile {
  param([string]$PythonTag)

  $pthPath = Join-Path $pythonRoot "python$PythonTag._pth"
  if (-not (Test-Path -LiteralPath $pthPath)) {
    throw "Python embeddable path file not found: $pthPath"
  }

  @(
    "python$PythonTag.zip",
    ".",
    "..\app",
    "..\site-packages",
    "import site"
  ) | Set-Content -LiteralPath $pthPath -Encoding ASCII
}

function Build-HelperLauncher {
  $manifestPath = Join-Path $launcherRoot "Cargo.toml"
  $lockPath = Join-Path $launcherRoot "Cargo.lock"
  $iconPath = Join-Path $launcherRoot "icons\icon.ico"
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "missing native helper launcher manifest: $manifestPath"
  }
  if (-not (Test-Path -LiteralPath $lockPath)) {
    throw "missing native helper launcher lock file: $lockPath"
  }
  if (-not (Test-Path -LiteralPath $iconPath)) {
    throw "missing native helper launcher icon: $iconPath"
  }

  $previousCargoTargetDir = $env:CARGO_TARGET_DIR
  $env:CARGO_TARGET_DIR = $launcherTargetRoot
  try {
    & cargo build --manifest-path $manifestPath --release --locked
    if ($LASTEXITCODE -ne 0) {
      throw "native helper launcher build failed"
    }
  } finally {
    if ($null -eq $previousCargoTargetDir) {
      Remove-Item Env:\CARGO_TARGET_DIR -ErrorAction SilentlyContinue
    } else {
      $env:CARGO_TARGET_DIR = $previousCargoTargetDir
    }
  }

  $sourceLauncherPath = Join-Path $launcherTargetRoot "release\xsheet-importer.exe"
  if (-not (Test-Path -LiteralPath $sourceLauncherPath)) {
    throw "native helper launcher output not found: $sourceLauncherPath"
  }
  Copy-Item -LiteralPath $sourceLauncherPath -Destination (Join-Path $packageRoot "xsheet-importer.exe") -Force
}

function Write-SiteCustomize {
  $siteCustomizePath = Join-Path $appOutputRoot "sitecustomize.py"
  @(
    "from __future__ import annotations",
    "",
    "import os",
    "from pathlib import Path",
    "import sys",
    "",
    "_RUNTIME_ROOT = Path(__file__).resolve().parents[1]",
    "_SITE_PACKAGES = _RUNTIME_ROOT / 'site-packages'",
    "for _path in (_SITE_PACKAGES / 'win32', _SITE_PACKAGES / 'win32' / 'lib', _SITE_PACKAGES / 'pythonwin'):",
    "    _path_text = str(_path)",
    "    if _path.exists() and _path_text not in sys.path:",
    "        sys.path.append(_path_text)",
    "_PYWIN32_SYSTEM32 = _SITE_PACKAGES / 'pywin32_system32'",
    "if _PYWIN32_SYSTEM32.exists():",
    "    if hasattr(os, 'add_dll_directory'):",
    "        os.add_dll_directory(str(_PYWIN32_SYSTEM32))",
    "    else:",
    "        os.environ['PATH'] = str(_PYWIN32_SYSTEM32) + os.pathsep + os.environ.get('PATH', '')"
  ) | Set-Content -LiteralPath $siteCustomizePath -Encoding ASCII
}

function Copy-LineSeedFonts {
  $fontSourceRoot = Join-Path $repoRoot "node_modules\@fontsource\line-seed-jp"
  if (-not (Test-Path -LiteralPath $fontSourceRoot)) {
    throw "LINE Seed JP font package not found: $fontSourceRoot"
  }

  $fontOutputRoot = Join-Path $appOutputRoot "csp_import_helper\fonts\line-seed-jp"
  $fontFilesOutputRoot = Join-Path $fontOutputRoot "files"
  New-Item -ItemType Directory -Force -Path $fontOutputRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $fontFilesOutputRoot | Out-Null

  foreach ($cssFile in @("400.css", "700.css", "800.css")) {
    Copy-Item -LiteralPath (Join-Path $fontSourceRoot $cssFile) -Destination $fontOutputRoot -Force
  }

  Get-ChildItem -LiteralPath (Join-Path $fontSourceRoot "files") -File |
    Where-Object { $_.Name -match '^line-seed-jp-.+-(400|700|800)-normal\.woff2?$' } |
    Copy-Item -Destination $fontFilesOutputRoot -Force
}

function Copy-HelperAssets {
  $assetSourceRoot = Join-Path $appRoot "assets"
  if (-not (Test-Path -LiteralPath $assetSourceRoot)) {
    throw "CSP import helper assets not found: $assetSourceRoot"
  }

  $assetOutputRoot = Join-Path $packageRoot "assets"
  New-Item -ItemType Directory -Force -Path $assetOutputRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $assetSourceRoot "xsheet-remap.laf") -Destination $assetOutputRoot -Force
}

function Remove-PythonCaches {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Get-ChildItem -LiteralPath $Path -Recurse -Directory -Force -Filter "__pycache__" |
    ForEach-Object {
      Remove-DirectorySafely -Path $_.FullName -AllowedRoot $runtimeRoot -Description "Python cache"
    }
}

function Remove-UnneededRuntimeFiles {
  $unneededPaths = @(
    (Join-Path $sitePackagesRoot "bin"),
    (Join-Path $sitePackagesRoot "adodbapi"),
    (Join-Path $sitePackagesRoot "isapi"),
    (Join-Path $sitePackagesRoot "PyWin32.chm")
  )
  foreach ($path in $unneededPaths) {
    Remove-DirectorySafely -Path $path -AllowedRoot $runtimeRoot -Description "unused helper runtime file"
  }
}

$selectedPythonMajorMinor = Get-SelectedPythonMajorMinor
Assert-ExpectedVenv -ExpectedMajorMinor $selectedPythonMajorMinor

if (-not (Test-Path -LiteralPath $venvRoot)) {
  Invoke-SelectedPython @("-m", "venv", $venvRoot)
  if ($LASTEXITCODE -ne 0) {
    throw "failed to create helper build venv with Python $selectedPythonMajorMinor"
  }
}

$venvPython = Join-Path $venvRoot "Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
  throw "helper build venv did not create a Python executable: $venvPython"
}
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
  throw "failed to upgrade build pip"
}

$pythonInfo = Get-BuildPythonInfo -PythonExe $venvPython
if ($pythonInfo.Machine -notin @("AMD64", "x86_64")) {
  throw "Python embeddable helper build currently expects amd64 Python, found $($pythonInfo.Machine)"
}
$pythonEmbedArchive = Resolve-PythonEmbedZip -PythonVersion $pythonInfo.Version

New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
Remove-DirectorySafely -Path $packageRoot -AllowedRoot $distRoot -Description "helper package"
Remove-DirectorySafely -Path (Join-Path $distRoot "xsheet-csp-import-helper") -AllowedRoot $distRoot -Description "legacy helper package"
Remove-DirectorySafely -Path (Join-Path $distRoot "xsheet-csp-import-helper-cli") -AllowedRoot $distRoot -Description "legacy helper CLI package"
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $pythonRoot | Out-Null
New-Item -ItemType Directory -Force -Path $appOutputRoot | Out-Null
New-Item -ItemType Directory -Force -Path $sitePackagesRoot | Out-Null

Expand-Archive -LiteralPath $pythonEmbedArchive -DestinationPath $pythonRoot -Force
Write-PythonPathFile -PythonTag $pythonInfo.Tag

Copy-Item `
  -LiteralPath (Join-Path $appRoot "src\csp_import_helper") `
  -Destination $appOutputRoot `
  -Recurse `
  -Force
Copy-LineSeedFonts
Copy-HelperAssets

$runtimeRequirementsPath = Join-Path $appRoot "requirements\runtime.txt"
& $venvPython -m pip install --no-compile --upgrade --target $sitePackagesRoot -r $runtimeRequirementsPath
if ($LASTEXITCODE -ne 0) {
  throw "failed to install helper runtime requirements"
}

if ($IncludeOcrDiagnostics) {
  & $venvPython -m pip install --no-compile --upgrade --target $sitePackagesRoot -r (Join-Path $appRoot "requirements\diagnostic-ocr.txt")
  if ($LASTEXITCODE -ne 0) {
    throw "failed to install helper OCR diagnostic requirements"
  }
}

Remove-UnneededRuntimeFiles
Remove-PythonCaches -Path $runtimeRoot
Build-HelperLauncher
Write-SiteCustomize

$portablePython = Join-Path $pythonRoot "python.exe"
$previousDontWriteBytecode = $env:PYTHONDONTWRITEBYTECODE
$env:PYTHONDONTWRITEBYTECODE = "1"
try {
  & $portablePython -m csp_import_helper --version
  if ($LASTEXITCODE -ne 0) {
    throw "portable helper version check failed"
  }
  & $portablePython -c "import webview; from webview.dom import DOMEventHandler; print('pywebview import ok')"
  if ($LASTEXITCODE -ne 0) {
    throw "portable helper pywebview import check failed"
  }
} finally {
  if ($null -eq $previousDontWriteBytecode) {
    Remove-Item Env:\PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue
  } else {
    $env:PYTHONDONTWRITEBYTECODE = $previousDontWriteBytecode
  }
}
Remove-PythonCaches -Path $runtimeRoot

if (-not $SkipLeakCheck) {
  & (Join-Path $repoRoot "tools/checks/repo-hygiene.ps1") -IncludeHelperBuildOutput
  if ($LASTEXITCODE -ne 0) {
    throw "repo hygiene check failed for CSP import helper build output"
  }
}

if ($CopyToLocalRelease) {
  $packageArgs = @{
    SkipDesktop = $true
    SkipLeakCheck = $true
  }
  if ($IncludeCliInLocalRelease) {
    Write-Host "[csp-import-helper] IncludeCliInLocalRelease is ignored for the native launcher helper." -ForegroundColor Yellow
  }
  & (Join-Path $repoRoot "tools/release/local-package.ps1") @packageArgs
  if ($LASTEXITCODE -ne 0) {
    throw "local release copy failed for CSP import helper"
  }
}

Write-Host "[csp-import-helper] built portable native launcher helper: $packageRoot"
