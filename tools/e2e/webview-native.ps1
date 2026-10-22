param([string]$BaselineCommit = '')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $root
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$parent = Join-Path $root 'reference-local/webview-native'
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$run = Join-Path $parent ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() + '-' + [guid]::NewGuid().ToString())
$runner = Join-Path $PSScriptRoot 'webview-native.ts'
$prepareArgs = @('--import', 'tsx', $runner, 'prepare', $run)
if ($BaselineCommit) { $prepareArgs += $BaselineCommit }
& $node @prepareArgs
if ($LASTEXITCODE -ne 0) { throw 'WebView candidate preflight failed; no EXE was launched' }
$prepared = Get-Content -LiteralPath (Join-Path $run 'prepared.json') -Raw | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot 'webview-desktop.cs')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WebviewInputObservation {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
}
'@
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $run 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --remote-debugging-address=127.0.0.1"
$env:XSHEET_WEBVIEW_TEST_PORT = "$port"
$env:TEMP = Join-Path $run 'temp'; $env:TMP = $env:TEMP
# This scenario uses the production file/IPC paths, not the old automatic project hook.
Remove-Item Env:XSHEET_REMAP_E2E -ErrorAction SilentlyContinue
$cursor = [WebviewInputObservation+Point]::new()
[void][WebviewInputObservation]::GetCursorPos([ref]$cursor)
$observation = [ordered]@{ startedAt=[DateTime]::UtcNow.ToString('o'); foregroundOwned=$false; samples=0;
  cursorBefore=@{x=$cursor.X;y=$cursor.Y}; input='CDP only; no OS input API calls'; sampleIntervalMs=50;
  isolation='unselected-win32-desktop'; inputDesktopBefore=[WebviewDesktop]::InputDesktopName() }
$app = $null; $driver = $null; $isolatedDesktop = $null; $failed = $null
try {
  $isolatedDesktop = [WebviewDesktop]::new($prepared.artifact.executable, $root)
  $app = $isolatedDesktop.App
  $observation.testDesktop=$isolatedDesktop.Name
  $driverArgs = @('--import', 'tsx', ('"{0}"' -f $runner), 'execute', ('"{0}"' -f $run))
  $driver = Start-Process -FilePath $node -ArgumentList $driverArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'driver.log') -RedirectStandardError (Join-Path $run 'driver-errors.log')
  # Keep a process handle before it exits; Windows PowerShell otherwise loses ExitCode after polling HasExited.
  $null = $driver.Handle
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  while (-not $driver.HasExited) {
    [uint32]$owner = 0
    [void][WebviewInputObservation]::GetWindowThreadProcessId([WebviewInputObservation]::GetForegroundWindow(), [ref]$owner)
    $observation.samples++
    if ([WebviewDesktop]::InputDesktopName() -eq $isolatedDesktop.Name) { throw 'Test desktop became the input desktop; verification stopped' }
    if ($owner -eq $app.Id) { $observation.foregroundOwned=$true; throw 'The test app acquired OS foreground; background verification stopped' }
    if ($app.HasExited) { throw 'Test EXE exited before its driver completed' }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Bounded WebView diagnostic exceeded 120 seconds' }
    Start-Sleep -Milliseconds 50
  }
  $driver.WaitForExit()
  $observation.driverExitCode=$driver.ExitCode
  if ($driver.ExitCode -ne 0) { throw 'WebView scenario failed; see result.json and driver-errors.log' }
  $observation.windowOnTestDesktop=$isolatedDesktop.HasAppWindow()
  if (-not $observation.windowOnTestDesktop) { throw 'Test EXE window was not on its isolated desktop' }
} catch { $failed = $_.Exception.ToString() }
finally {
  if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
  if ($isolatedDesktop) {
    try { $isolatedDesktop.Dispose(); $observation.desktopReleased=$true }
    catch { $failed = "$failed`nTest desktop cleanup failed: $($_.Exception.Message)"; $observation.desktopReleased=$false }
  }
  [void][WebviewInputObservation]::GetCursorPos([ref]$cursor)
  $observation.cursorAfter=@{x=$cursor.X;y=$cursor.Y}
  $observation.finishedAt=[DateTime]::UtcNow.ToString('o')
  try { $observation.inputDesktopAfter=[WebviewDesktop]::InputDesktopName() }
  catch { $failed = "$failed`nCould not observe input desktop at completion: $($_.Exception.Message)" }
  $observation.error=$failed
  $observation | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $run 'os-observation.json') -Encoding UTF8
  $resultPath = Join-Path $run 'result.json'
  if (Test-Path -LiteralPath $resultPath) { $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json }
  else {
    # Early launcher failures still need a failed record tied to the prepared EXE.
    $result = $prepared
    $result | Add-Member -NotePropertyMembers @{
      phase='webview-native'; inputMode='cdp-and-tauri-event-injection'; status='failed'; checks=@();
      startedAt=$observation.startedAt; finishedAt=$observation.finishedAt
    }
  }
  $result | Add-Member -NotePropertyName osObservation -NotePropertyValue $observation
  if ($failed) { $result.status = 'failed' }
  $result | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $resultPath -Encoding UTF8
  Write-Output "[webview] evidence: $run"
}
if ($failed) { throw $failed }
Write-Output '[webview] scenario passed on an unselected desktop; this is not OS-drop acceptance.'
