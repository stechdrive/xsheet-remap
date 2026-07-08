param(
  [string]$ExePath = "apps/desktop/src-tauri/target/release/xsheet-remap.exe",
  [string]$ExpectedTitle = "xsheet-remap",
  [int]$TimeoutSeconds = 30,
  [int]$StableSeconds = 3,
  [int]$MinWidth = 800,
  [int]$MinHeight = 600,
  [switch]$Build
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:OS -ne "Windows_NT") {
  throw "win-desktop-smoke.ps1 can only run on Windows."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

if ($Build) {
  Write-Host "[desktop-smoke] building desktop executable..."
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

if (-not ("WinDesktopSmokeUser32" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WinDesktopSmokeUser32
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
  $callback = [WinDesktopSmokeUser32+EnumWindowsProc]{
    param([IntPtr]$Handle, [IntPtr]$Param)

    if (-not [WinDesktopSmokeUser32]::IsWindowVisible($Handle)) {
      return $true
    }

    [uint32]$windowProcessId = 0
    [void][WinDesktopSmokeUser32]::GetWindowThreadProcessId($Handle, [ref]$windowProcessId)
    if ($windowProcessId -ne [uint32]$ProcessId) {
      return $true
    }

    $titleBuilder = New-Object System.Text.StringBuilder 512
    [void][WinDesktopSmokeUser32]::GetWindowText($Handle, $titleBuilder, $titleBuilder.Capacity)

    $rect = New-Object WinDesktopSmokeUser32+RECT
    [void][WinDesktopSmokeUser32]::GetWindowRect($Handle, [ref]$rect)

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

  [void][WinDesktopSmokeUser32]::EnumWindows($callback, [IntPtr]::Zero)
  return $windows
}

Write-Host "[desktop-smoke] launching $resolvedExePath"
$process = Start-Process -FilePath $resolvedExePath -PassThru -WindowStyle Normal
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$matchedWindow = $null

try {
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

  Write-Host "[desktop-smoke] found window '$($matchedWindow.Title)' $($matchedWindow.Width)x$($matchedWindow.Height)"
  Start-Sleep -Seconds $StableSeconds

  if ($process.HasExited) {
    throw "desktop process exited during the ${StableSeconds}s stability window. Exit code: $($process.ExitCode)"
  }

  Write-Host "[desktop-smoke] passed"
} finally {
  if ($process -and -not $process.HasExited) {
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(5000)) {
      Stop-Process -Id $process.Id -Force
    }
  }
}
