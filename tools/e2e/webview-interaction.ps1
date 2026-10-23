param([string]$BaselineCommit = '', [string]$Fault = '', [Alias('Phase')][ValidateSet('corrector','remap','all')][string]$SelectedPhase = 'all', [switch]$WorkingTreeDiagnostic, [string]$RunDirectory = '')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $root
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$run = Join-Path $root ('reference-local/webview-interaction/' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '-' + [guid]::NewGuid())
if ($RunDirectory) { $run=[IO.Path]::GetFullPath($RunDirectory) }
$runner = Join-Path $PSScriptRoot 'webview-interaction.ts'
$env:XSHEET_INTERACTION_FAULT = $Fault
$env:XSHEET_WORKING_TREE_DIAGNOSTIC = if ($WorkingTreeDiagnostic) { '1' } else { '' }
& $node --import tsx $runner prepare $run $BaselineCommit
if ($LASTEXITCODE -ne 0) { throw 'Interaction preflight failed; no EXE launched' }
$prepared = Get-Content -LiteralPath (Join-Path $run 'prepared.json') -Raw | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot 'webview-desktop.cs')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class InteractionForeground {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
'@
$phases = @('corrector','remap')
if ($SelectedPhase -ne 'all') { $phases=@($SelectedPhase) }
if ($Fault) { if ($Fault -in @('corrector-entry','draft-recovery')) { $phases=@('corrector') } else { $phases=@('remap') } }
foreach ($phase in $phases) {
  $directory = Join-Path $run $phase
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
  $listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop()
  $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $directory 'profile'
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --remote-debugging-address=127.0.0.1 --enable-automation"
  $env:XSHEET_WEBVIEW_TEST_PORT = "$port"
  $env:TEMP=Join-Path $directory 'temp'; $env:TMP=$env:TEMP
  New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
  Remove-Item Env:XSHEET_REMAP_E2E -ErrorAction SilentlyContinue
  $desktop=$null; $driver=$null; $failure=$null
  $observation=[ordered]@{startedAt=[DateTime]::UtcNow.ToString('o'); inputMode='cdp'; inputDesktopBefore=[WebviewDesktop]::InputDesktopName(); foregroundOwned=$false; samples=0; childRestarts=@(); windowsVersion=[Environment]::OSVersion.VersionString; powershellVersion=$PSVersionTable.PSVersion.ToString()}
  try {
    $desktop=[WebviewDesktop]::new($prepared.artifacts.$phase.executable,$root)
    $observation.desktop=$desktop.Name
    $argsList=@('--import','tsx',('"{0}"' -f $runner),'execute',('"{0}"' -f $run),$phase)
    $driver=Start-Process -FilePath $node -ArgumentList $argsList -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $directory 'driver.log') -RedirectStandardError (Join-Path $directory 'driver-errors.log')
    $null=$driver.Handle
    $deadline=[DateTime]::UtcNow.AddSeconds(180)
    while (-not $driver.HasExited) {
      [uint32]$owner=0
      [void][InteractionForeground]::GetWindowThreadProcessId([InteractionForeground]::GetForegroundWindow(),[ref]$owner)
      $observation.samples++
      if ([WebviewDesktop]::InputDesktopName() -ne $observation.inputDesktopBefore) { throw 'Input desktop changed during verification' }
      if ($desktop.OwnsProcess([int]$owner)) { $observation.foregroundOwned=$true; throw 'An owned test process acquired foreground' }
      if ($desktop.App.HasExited) { throw 'Application exited before driver' }
      $request=Join-Path $directory 'stop-template.json'
      $response=Join-Path $directory 'stopped-template.json'
      if ((Test-Path -LiteralPath $request) -and -not (Test-Path -LiteralPath $response)) {
        if ($phase -ne 'corrector') { throw 'Child restart is only allowed in Corrector scenario' }
        $children=@($desktop.OwnedProcessIds() | Where-Object { $_ -ne $desktop.App.Id } | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Where-Object { $_.ProcessName -eq 'xsheet-remap' })
        if ($children.Count -ne 1) { throw 'Expected exactly one owned template child' }
        $childId=$children[0].Id
        $desktop.KillChild($childId)
        $restart=@{pid=$childId;stoppedAt=[DateTime]::UtcNow.ToString('o');parentStillRunning=(-not $desktop.App.HasExited)}
        $observation.childRestarts+= $restart
        $temporary="$response.tmp"
        $restart | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
        Move-Item -LiteralPath $temporary -Destination $response
      }
      if ([DateTime]::UtcNow -gt $deadline) { throw 'Interaction phase exceeded its 180 second bound' }
      Start-Sleep -Milliseconds 50
    }
    $driver.WaitForExit(); $observation.driverExitCode=$driver.ExitCode
    if ($driver.ExitCode -ne 0) { throw 'Interaction assertions failed; see phase result and trace' }
    if (-not $desktop.HasAppWindow()) { throw 'Root window is not on the test desktop' }
  } catch { $failure=$_.Exception.ToString() }
  finally {
    if ($desktop) {
      $owned=@($desktop.OwnedProcessIds())
      @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $owned } | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $directory 'owned-processes.json') -Encoding UTF8
      $observation.ownedWindows=@($desktop.OwnedWindows())
    }
    if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
    if ($desktop) {
      try { $desktop.Dispose(); $observation.desktopReleased=(-not [WebviewDesktop]::TestDesktopExists($desktop.Name)) }
      catch { $failure="$failure`nCleanup: $($_.Exception.Message)"; $observation.desktopReleased=$false }
    }
    $observation.finishedAt=[DateTime]::UtcNow.ToString('o')
    $observation.inputDesktopAfter=[WebviewDesktop]::InputDesktopName()
    $observation.error=$failure
    $observation | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $directory 'os-observation.json') -Encoding UTF8
  }
  if ($failure) { Write-Output "[interaction] evidence: $run"; throw $failure }
}
if ($SelectedPhase -eq 'all' -and -not $Fault) {
  & $node --import tsx $runner finish $run
  if ($LASTEXITCODE -ne 0) { throw 'Interaction evidence validation failed' }
}
Write-Output "[interaction] evidence: $run"
