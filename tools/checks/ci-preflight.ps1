param(
  [string]$Npm = "",
  [switch]$IncludeWorkingTree
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$preflightRoot = Join-Path $repoRoot ".tmp\ci-preflight"
$runRoot = Join-Path $preflightRoot ([guid]::NewGuid().ToString("N"))
$cloneRoot = Join-Path $runRoot "source"
$nodeVersionPath = Join-Path $repoRoot ".node-version"
$packageJsonPath = Join-Path $repoRoot "package.json"

function Invoke-CheckedCommand {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath $($ArgumentList -join ' ') failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Resolve-NpmCommand {
  if ($Npm) {
    return (Get-Command $Npm -ErrorAction Stop).Source
  }
  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command npm -ErrorAction Stop
  }
  return $command.Source
}

function Assert-CleanWorktree {
  $status = & git -C $repoRoot status --porcelain --untracked-files=all
  if ($LASTEXITCODE -ne 0) {
    throw "git status failed with exit code $LASTEXITCODE"
  }
  if ($status) {
    throw "CI preflight requires a clean committed worktree:`n$($status -join "`n")"
  }
}

function Add-WorkingTreeChangesToClone {
  $patchPath = Join-Path $runRoot "working-tree.patch"
  & git -C $repoRoot diff --binary HEAD --output=$patchPath
  if ($LASTEXITCODE -ne 0) {
    throw "git diff failed with exit code $LASTEXITCODE"
  }
  if ((Get-Item -LiteralPath $patchPath).Length -gt 0) {
    Invoke-CheckedCommand -FilePath "git" -ArgumentList @("apply", "--whitespace=nowarn", $patchPath) -WorkingDirectory $cloneRoot
  }

  $untrackedFiles = @(& git -C $repoRoot ls-files --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) {
    throw "git ls-files failed with exit code $LASTEXITCODE"
  }
  foreach ($relativePath in $untrackedFiles) {
    $sourcePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $relativePath))
    $destinationPath = [System.IO.Path]::GetFullPath((Join-Path $cloneRoot $relativePath))
    if (-not $sourcePath.StartsWith(
        $repoRoot + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
      )) {
      throw "refusing to copy preflight source outside repository: $sourcePath"
    }
    if (-not $destinationPath.StartsWith(
        $cloneRoot + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
      )) {
      throw "refusing to copy preflight file outside clone: $destinationPath"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  }

  Invoke-CheckedCommand -FilePath "git" -ArgumentList @("add", "-A") -WorkingDirectory $cloneRoot
  $pending = & git -C $cloneRoot status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "temporary clone git status failed with exit code $LASTEXITCODE"
  }
  if ($pending) {
    Invoke-CheckedCommand `
      -FilePath "git" `
      -ArgumentList @(
        "-c", "user.name=xsheet-remap CI preflight",
        "-c", "user.email=ci-preflight@invalid.local",
        "commit", "--quiet", "-m", "CI preflight working tree"
      ) `
      -WorkingDirectory $cloneRoot
  }
}

function Assert-ToolVersions {
  param([string]$NpmCommand)

  $expectedNode = (Get-Content -LiteralPath $nodeVersionPath -Raw -Encoding UTF8).Trim()
  $actualNode = (& node --version).Trim().TrimStart("v")
  if ($LASTEXITCODE -ne 0 -or $actualNode -ne $expectedNode) {
    throw "CI preflight requires Node $expectedNode; found $actualNode"
  }

  $packageJson = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($packageJson.packageManager -notmatch '^npm@(.+)$') {
    throw "package.json packageManager must pin npm, got '$($packageJson.packageManager)'"
  }
  $expectedNpm = $Matches[1]
  $actualNpm = (& $NpmCommand --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualNpm -ne $expectedNpm) {
    throw "CI preflight requires npm $expectedNpm; found $actualNpm"
  }

  Write-Host "[ci-preflight] Node $actualNode / npm $actualNpm"
}

function Remove-PreflightRun {
  if (-not (Test-Path -LiteralPath $runRoot)) {
    return
  }
  $resolvedPreflightRoot = [System.IO.Path]::GetFullPath($preflightRoot)
  $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
  if (-not $resolvedRunRoot.StartsWith(
      $resolvedPreflightRoot + [System.IO.Path]::DirectorySeparatorChar,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "refusing to remove CI preflight path outside its root: $resolvedRunRoot"
  }
  Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force
}

$npmCommand = Resolve-NpmCommand
if (-not $IncludeWorkingTree) {
  Assert-CleanWorktree
}
Assert-ToolVersions -NpmCommand $npmCommand

New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
try {
  Write-Host "[ci-preflight] creating clean local clone at $cloneRoot"
  Invoke-CheckedCommand `
    -FilePath "git" `
    -ArgumentList @("clone", "--quiet", "--local", "--no-hardlinks", $repoRoot, $cloneRoot) `
    -WorkingDirectory $repoRoot
  if ($IncludeWorkingTree) {
    Write-Host "[ci-preflight] applying current working tree to temporary clone"
    Add-WorkingTreeChangesToClone
  }
  Invoke-CheckedCommand -FilePath $npmCommand -ArgumentList @("ci") -WorkingDirectory $cloneRoot
  Invoke-CheckedCommand -FilePath $npmCommand -ArgumentList @("run", "check") -WorkingDirectory $cloneRoot
  Write-Host "[ci-preflight] clean install and repository checks passed"
} finally {
  Remove-PreflightRun
}
