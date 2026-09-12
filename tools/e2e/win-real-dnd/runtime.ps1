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

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell promotes a native command's stderr to a terminating
    # NativeCommandError while the script-wide preference is Stop. A missing
    # optional import is the condition we are probing for here, so capture its
    # exit code without aborting before the dependency install can run.
    $ErrorActionPreference = "SilentlyContinue"
    & $venvPython -c "import pywinauto" *> $null
    $pywinautoImportExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($pywinautoImportExitCode -ne 0) {
    Write-Host "[real-dnd] installing pywinauto dependencies into isolated venv..."
    & $venvPython -m pip install -r (Join-Path $repoRoot "tools\e2e\win-real-dnd\requirements.txt") 2>&1 |
      ForEach-Object { Write-Host $_ }
    $pipInstallExitCode = $LASTEXITCODE
    if ($pipInstallExitCode -ne 0) {
      throw "failed to install pywinauto dependencies"
    }
  }
  return $venvPython
}
