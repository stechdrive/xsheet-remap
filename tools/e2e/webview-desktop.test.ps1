$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'webview-desktop.cs')
$before = [WebviewDesktop]::InputDesktopName()
$observer = [WebviewDesktop]::ObserverDesktopName()
foreach ($attempt in 1..3) {
  $failed = $false
  try {
    $unexpected = [WebviewDesktop]::new((Join-Path $PSScriptRoot ([guid]::NewGuid().ToString() + '.exe')), $PSScriptRoot)
    $unexpected.Dispose()
  } catch {
    if ($_.Exception.ToString() -notmatch 'Win32Exception') { throw }
    $errorWithDesktop = $_.Exception
    while ($errorWithDesktop -and -not $errorWithDesktop.Data.Contains('testDesktopName')) { $errorWithDesktop = $errorWithDesktop.InnerException }
    if (-not $errorWithDesktop) { throw 'Missing failed-launch desktop identity' }
    if ([WebviewDesktop]::TestDesktopExists($errorWithDesktop.Data['testDesktopName'])) { throw 'Failed launch leaked its desktop' }
    $failed = $true
  }
  if (-not $failed) { throw 'Nonexistent executable unexpectedly launched' }
  if ([WebviewDesktop]::InputDesktopName() -ne $before) { throw 'Failed launch changed the input desktop' }
  if ([WebviewDesktop]::ObserverDesktopName() -ne $observer) { throw 'Failed launch moved the observer thread' }
}
Write-Output '[webview-launcher] three failed launches released their desktops and preserved input/observer desktops'
