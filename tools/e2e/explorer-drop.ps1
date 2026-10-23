param([switch]$WorkingTreeDiagnostic, [switch]$CompileOnly)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $root
# Windows PowerShell's .NET Framework UI Automation assemblies; no Python,
# drivers, installation, global configuration, or existing app automation.
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing,System.Windows.Forms
$references=@([System.Windows.Automation.AutomationElement].Assembly.Location,[System.Windows.Automation.TreeScope].Assembly.Location,[System.Windows.Rect].Assembly.Location,[System.Drawing.Bitmap].Assembly.Location,[System.Windows.Forms.Screen].Assembly.Location) | Select-Object -Unique
Add-Type -Path (Join-Path $PSScriptRoot 'explorer-input.cs') -ReferencedAssemblies $references
Add-Type -Path (Join-Path $PSScriptRoot 'webview-desktop.cs')
if ($CompileOnly) { Write-Output '[explorer] Native input helper compiled; no GUI launched'; exit 0 }
$node=(Get-Command node -CommandType Application | Select-Object -First 1).Source
$run=Join-Path $root ('reference-local/explorer-drop/'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+'-'+[guid]::NewGuid())
$runner=Join-Path $PSScriptRoot 'explorer-drop.ts'
$env:XSHEET_WORKING_TREE_DIAGNOSTIC=if ($WorkingTreeDiagnostic) {'1'} else {''}
& $node --import tsx $runner prepare $run
if ($LASTEXITCODE -ne 0) { throw 'Explorer preflight failed; no EXE launched' }
$prepared=Get-Content -LiteralPath (Join-Path $run 'prepared.json') -Raw | ConvertFrom-Json
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop()
$env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $run 'profile'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$port --remote-debugging-address=127.0.0.1 --enable-automation"
$env:XSHEET_WEBVIEW_TEST_PORT="$port"
$env:TEMP=Join-Path $run 'temp'; $env:TMP=$env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
Remove-Item Env:XSHEET_REMAP_E2E -ErrorAction SilentlyContinue
$desktop=$null; $driver=$null; $failure=$null; $windows=@{}; $attempted=@{}
$observation=[ordered]@{startedAt=[DateTime]::UtcNow.ToString('o'); inputMode='os-input'; interactive=$true; inputDesktopBefore=[WebviewDesktop]::InputDesktopName(); windowsClosed=$false; ownedProcessesExited=$false; windowsVersion=[Environment]::OSVersion.VersionString; powershellVersion=$PSVersionTable.PSVersion.ToString()}
function Write-Record($Name,$Value) {
  $file=Join-Path $run $Name
  $Value | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath "$file.tmp" -Encoding UTF8
  Move-Item -LiteralPath "$file.tmp" -Destination $file
}
try {
  $shell=New-Object -ComObject Shell.Application
  $originalWindows=@($shell.Windows() | ForEach-Object { [long]$_.HWND })
  $desktop=[WebviewDesktop]::new($prepared.artifact.executable,$root,$true)
  # Process.MainWindowHandle can select Tauri's top-level tooltip window.
  # Select the uniquely titled, visible window owned by this exact test PID.
  $windowDeadline=[DateTime]::UtcNow.AddSeconds(10)
  do {
    $target=[ExplorerInput]::AppWindow($desktop.App.Id,'xsheet-remap')
    if ($target -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 50 }
  } while ($target -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $windowDeadline)
  if ($target -eq [IntPtr]::Zero) { throw 'Test Remap has no main window' }
  [ExplorerInput]::Place($target,$false)
  $driver=Start-Process -FilePath $node -ArgumentList @('--import','tsx',('"{0}"' -f $runner),'execute',('"{0}"' -f $run)) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'driver.log') -RedirectStandardError (Join-Path $run 'driver-errors.log')
  $null=$driver.Handle
  $deadline=[DateTime]::UtcNow.AddSeconds(120)
  while (-not $driver.HasExited) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Interactive verification exceeded its 120 second bound' }
    if ([WebviewDesktop]::InputDesktopName() -ne $observation.inputDesktopBefore) { throw 'Input desktop changed; stop test' }
    foreach ($spec in $prepared.specifications) {
      $id=$spec.id
      if ((Test-Path -LiteralPath (Join-Path $run "$id-open.json")) -and -not $windows.ContainsKey($id) -and -not (Test-Path -LiteralPath (Join-Path $run "$id-complete.json"))) {
        $request=Get-Content -LiteralPath (Join-Path $run "$id-open.json") -Raw | ConvertFrom-Json
        $folder=[IO.Path]::GetFullPath($request.folder)
        if (-not $folder.StartsWith($run+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Explorer fixture is outside this run' }
        $null=Start-Process -FilePath "$env:WINDIR/explorer.exe" -ArgumentList ('/n,"{0}"' -f $folder) -PassThru
        $limit=[DateTime]::UtcNow.AddSeconds(10); $matches=@()
        do {
          $matches=@($shell.Windows() | Where-Object { try { $_.Document.Folder.Self.Path -eq $folder -and [long]$_.HWND -notin $originalWindows } catch {$false} })
          if ($matches.Count -eq 0) { Start-Sleep -Milliseconds 100 }
        } while ($matches.Count -eq 0 -and [DateTime]::UtcNow -lt $limit)
        if ($matches.Count -ne 1) { throw 'Expected one new test Explorer window; no mouse input sent' }
        $window=$matches[0]; $windows[$id]=$window
        # Tauri/WebView startup can restore its initial size after the process
        # event loop is ready. Place only after the driver confirms app startup.
        [ExplorerInput]::Place($target,$false)
        [ExplorerInput]::Place([IntPtr][long]$window.HWND,$true)
        $first=$true
        foreach ($name in $request.selection) {
          $item=$window.Document.Folder.ParseName($name)
          if (-not $item) { throw 'Test selection item was not found' }
          $window.Document.SelectItem($item,$(if ($first) {29} else {1})); $first=$false
        }
        Write-Record "$id-ready.json" @{hwnd=[long]$window.HWND; folder=$folder; clientBounds=[ExplorerInput]::ClientBounds($target)}
      }
      if ((Test-Path -LiteralPath (Join-Path $run "$id-drop.json")) -and -not $attempted.ContainsKey($id)) {
        $attempted[$id]=$true # Exactly one attempt, including input failure.
        $window=$windows[$id]
        $selected=@($window.Document.SelectedItems() | ForEach-Object { $_.Path } | Sort-Object)
        $expected=@($spec.selection | ForEach-Object { Join-Path (Join-Path $run $spec.folder) $_ } | Sort-Object)
        if (@(Compare-Object $selected $expected).Count -ne 0) { throw 'Explorer selection differs from the requested files' }
        $source=[IntPtr][long]$window.HWND
        $bounds=[ExplorerInput]::SelectedItemBounds($source,$spec.selection[0])
        $client=[ExplorerInput]::ClientBounds($target)
        $request=Get-Content -LiteralPath (Join-Path $run "$id-drop.json") -Raw | ConvertFrom-Json
        Write-Record "$id-geometry.json" @{clientBounds=$client; webview=$request.position; sourceBounds=$bounds}
        if ([Math]::Abs($client[2]-$request.position.viewport.width) -gt 3 -or [Math]::Abs($client[3]-$request.position.viewport.height) -gt 3) { throw 'WebView and native client geometry do not match' }
        $sx=[int]($bounds[0]+[Math]::Min(50,$bounds[2]/2)); $sy=[int]($bounds[1]+$bounds[3]/2)
        $tx=[int]($client[0]+$request.position.x); $ty=[int]($client[1]+$request.position.y)
        $input=[ordered]@{status='failed'; attempts=1; startedAt=[DateTime]::UtcNow.ToString('o'); selectedPaths=$selected; sourceHwnd=[long]$source; targetHwnd=[long]$target; targetPid=$desktop.App.Id; sourcePoint=@($sx,$sy); targetPoint=@($tx,$ty); method='Win32.SendInput'; selection='ShellFolderView.SelectItem'; actor='automation'; toolVersion=$prepared.inputTool.version}
        try {
          [ExplorerInput]::Screenshot($source,(Join-Path $run "screenshots/$id-selection.png"))
          [ExplorerInput]::Drop($source,$target,$sx,$sy,$tx,$ty,$desktop.App.Id)
          $input.status='sent'
        } finally { $input.finishedAt=[DateTime]::UtcNow.ToString('o'); Write-Record "$id-input.json" $input }
      }
      if ((Test-Path -LiteralPath (Join-Path $run "$id-complete.json")) -and $windows.ContainsKey($id)) {
        $windows[$id].Quit(); $windows.Remove($id)
      }
    }
    Start-Sleep -Milliseconds 50
  }
  $driver.WaitForExit(); $observation.driverExitCode=$driver.ExitCode
  if ($driver.ExitCode -ne 0) { throw 'Explorer acceptance failed; see preserved result/trace. No retry was performed.' }
} catch { $failure=$_.Exception.ToString() }
finally {
  if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
  foreach ($window in $windows.Values) { try { $window.Quit() } catch { $failure="$failure`nExplorer cleanup: $($_.Exception.Message)" } }
  if ($shell) {
    $remaining=@($shell.Windows() | Where-Object { try { $_.Document.Folder.Self.Path.StartsWith($run+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) } catch {$false} })
    $observation.windowsClosed=($remaining.Count -eq 0)
  }
  if ($desktop) { try { $desktop.Dispose(); $observation.ownedProcessesExited=$true } catch { $failure="$failure`nRemap cleanup: $($_.Exception.Message)" } }
  $observation.finishedAt=[DateTime]::UtcNow.ToString('o'); $observation.inputDesktopAfter=[WebviewDesktop]::InputDesktopName(); $observation.error=$failure
  Write-Record 'os-observation.json' $observation
  Write-Output "[explorer] evidence: $run"
}
if ($failure) { throw $failure }
if (-not $observation.windowsClosed -or -not $observation.ownedProcessesExited) { throw 'Test windows/processes did not close' }
& $node --import tsx $runner finish $run
if ($LASTEXITCODE -ne 0) { throw 'Explorer evidence finalization failed' }
