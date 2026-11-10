param([switch]$WorkingTreeDiagnostic)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $root
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$run = Join-Path $root ('reference-local/corrector-folder-lock/' + [guid]::NewGuid().ToString('N'))
$runner = Join-Path $PSScriptRoot 'corrector-folder-lock.ts'
$env:XSHEET_WORKING_TREE_DIAGNOSTIC = if ($WorkingTreeDiagnostic) { '1' } else { '' }
& $node --import tsx $runner prepare $run
if ($LASTEXITCODE -ne 0) { throw 'Corrector artifact preflight failed; no EXE launched' }
$prepared = Get-Content -LiteralPath (Join-Path $run 'prepared.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
$fixture = [Drawing.Image]::FromFile((Join-Path $root 'apps/web/public/templates/standard-a3/timesheet.png'))
try { $fixture.Save($prepared.source, [Drawing.Imaging.ImageFormat]::Jpeg) }
finally { $fixture.Dispose() }
Add-Type -Path (Join-Path $PSScriptRoot 'webview-desktop.cs')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CorrectorForegroundObservation {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
'@
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $run 'profile'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --remote-debugging-address=127.0.0.1"
$env:XSHEET_WEBVIEW_TEST_PORT = "$port"
$env:LOCALAPPDATA = Join-Path $run 'app-data'
$observation = [ordered]@{ inputDesktopBefore=[WebviewDesktop]::InputDesktopName(); foregroundOwned=$false; samples=0; input='relative process argument; CDP; no OS drag/drop'; startedAt=[DateTime]::UtcNow.ToString('o') }
$isolated = $null; $driver = $null; $failed = $null
try {
    $isolated = [WebviewDesktop]::new($prepared.artifact.executable, $prepared.input, $false, [string[]]@('.'))
    $observation.testDesktop = $isolated.Name
    $driverArgs = @('--import', 'tsx', ('"{0}"' -f $runner), 'execute', ('"{0}"' -f $run))
    $driver = Start-Process -FilePath $node -ArgumentList $driverArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'driver.log') -RedirectStandardError (Join-Path $run 'driver-errors.log')
    $null = $driver.Handle
    $deadline = [DateTime]::UtcNow.AddSeconds(150)
    while (-not $driver.HasExited) {
        [uint32]$owner = 0
        [void][CorrectorForegroundObservation]::GetWindowThreadProcessId([CorrectorForegroundObservation]::GetForegroundWindow(), [ref]$owner)
        $observation.samples++
        if ([WebviewDesktop]::InputDesktopName() -ne $observation.inputDesktopBefore) { throw 'Input desktop changed' }
        if ($isolated.OwnsProcess([int]$owner)) { $observation.foregroundOwned=$true; throw 'Test process acquired foreground' }
        if ($isolated.App.HasExited) { throw 'Corrector exited before checks completed' }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Corrector diagnostic exceeded 150 seconds' }
        Start-Sleep -Milliseconds 50
    }
    $driver.WaitForExit()
    if ($driver.ExitCode -ne 0) { throw 'Folder-lock checks failed; see result.json' }
    $observation.appStillRunning = -not $isolated.App.HasExited
    if (-not $observation.appStillRunning) { throw 'Corrector exited during folder renames' }
} catch { $failed = $_.Exception.ToString() }
finally {
    if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
    if ($isolated) {
        try { $isolated.Dispose(); $observation.cleanupComplete=$true }
        catch { $failed = "$failed`nCleanup failed: $($_.Exception.Message)"; $observation.cleanupComplete=$false }
    }
    $observation.inputDesktopAfter = [WebviewDesktop]::InputDesktopName()
    $observation.finishedAt = [DateTime]::UtcNow.ToString('o')
    $observation.error = $failed
    $resultPath = Join-Path $run 'result.json'
    $report = if (Test-Path -LiteralPath $resultPath) { Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{ status='failed'; prepared=$prepared } }
    $report | Add-Member -NotePropertyName osObservation -NotePropertyValue $observation
    if ($failed) { $report.status = 'failed' }
    $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resultPath -Encoding UTF8
    Write-Output "[corrector-folder-lock] evidence: $resultPath"
}
if ($failed) { throw $failed }
