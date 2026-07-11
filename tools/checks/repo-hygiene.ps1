param(
  [switch]$IncludeBuildOutput,
  [switch]$IncludeHelperBuildOutput,
  [switch]$IncludeLocalRelease
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

$binaryExtensions = @(
  ".bin", ".bmp", ".clip", ".dll", ".exe", ".gif", ".ico", ".jpeg", ".jpg",
  ".pdf", ".png", ".psb", ".psd", ".tar", ".tif", ".tiff", ".webp", ".zip"
)

function Test-IsTextScanCandidate {
  param([string]$Path)

  $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  return -not ($binaryExtensions -contains $extension)
}

function Get-TrackedTextFiles {
  git ls-files |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) -and (Test-IsTextScanCandidate $_) }
}

function Get-BuildOutputTextFiles {
  $distPath = Join-Path $repoRoot "apps/web/dist"
  if (-not (Test-Path -LiteralPath $distPath)) {
    return @()
  }

  Get-ChildItem -LiteralPath $distPath -Recurse -File |
    Where-Object { Test-IsTextScanCandidate $_.FullName } |
    ForEach-Object { Resolve-Path -Relative -LiteralPath $_.FullName }
}

function Get-BuildOutputBinaryFiles {
  $paths = @(
    "apps/editor/src-tauri/target/release/xsheet-editor.exe",
    "apps/desktop/src-tauri/target/release/xsheet-remap.exe",
    "apps/sheet-corrector/src-tauri/target/release/xsheet-corrector.exe",
    "apps/template-editor/src-tauri/target/release/xsheet-template-editor.exe"
  )

  $paths |
    Where-Object { Test-Path -LiteralPath $_ } |
    ForEach-Object { Resolve-Path -Relative -LiteralPath $_ }
}

function Test-IsOcrVendorBundle {
  param([string]$Path)

  $normalized = $Path.Replace("\", "/").TrimStart([char[]]"./")
  return $normalized -match '^apps/web/dist/assets/(?:dist|worker-entry-[^/]+)\.js$'
}

$patterns = New-Object System.Collections.Generic.List[object]
$patterns.Add([pscustomobject]@{
  Name = "Windows user profile path"
  Regex = [regex]'[A-Za-z]:\\Users\\[^\\\s''"`<>]+'
})
$patterns.Add([pscustomobject]@{
  Name = "Developer workspace path"
  Regex = [regex]'[A-Za-z]:\\(?:GitHub|gh|dev|src|work)\\[^\\\s''"`<>]+'
})
$privateCloudRoot = [string]::Concat("C:", [char]0x5c, "Google", "Drive")
$privateDriveName = [string]::Concat([char[]](0x30DE, 0x30A4, 0x30C9, 0x30E9, 0x30A4, 0x30D6))
$privateProjectCodeName = [string]::Concat([char[]](0x59, 0x43, 0x34))
$patterns.Add([pscustomobject]@{
  Name = "Local cloud drive path"
  Regex = [regex][regex]::Escape($privateCloudRoot)
})
$patterns.Add([pscustomobject]@{
  Name = "Local cloud drive display name"
  Regex = [regex][regex]::Escape($privateDriveName)
})
$patterns.Add([pscustomobject]@{
  Name = "Internal project code name"
  Regex = [regex][regex]::Escape($privateProjectCodeName)
})

if ($env:USERPROFILE) {
  $patterns.Add([pscustomobject]@{
    Name = "Current USERPROFILE path"
    Regex = [regex][regex]::Escape($env:USERPROFILE)
  })
}

if ($env:USERNAME -and $env:USERNAME.Length -ge 4) {
  $patterns.Add([pscustomobject]@{
    Name = "Current Windows user name"
    Regex = [regex]("(?i)\b" + [regex]::Escape($env:USERNAME) + "\b")
  })
}

$patterns.Add([pscustomobject]@{
  Name = "Likely inline secret"
  Regex = [regex]'(?i)\b(api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*[\x22\x27][A-Za-z0-9_./+=-]{16,}'
})

$outputOnlyPatterns = New-Object System.Collections.Generic.List[object]
$outputOnlyPatterns.Add([pscustomobject]@{
  Name = "Repository root path in build output"
  Regex = [regex][regex]::Escape($repoRoot)
})
$outputOnlyPatterns.Add([pscustomobject]@{
  Name = "Reference-local path in build output"
  Regex = [regex]'reference-local'
})
$outputOnlyPatterns.Add([pscustomobject]@{
  Name = "CSP helper build temp path in build output"
  Regex = [regex]'csp-import-helper-(build-venv|pyinstaller|dist)'
})

$binaryPatterns = New-Object System.Collections.Generic.List[object]
$patterns |
  Where-Object {
    $_.Name -in @(
      "Windows user profile path",
      "Developer workspace path",
      "Current USERPROFILE path",
      "Current Windows user name"
    )
  } |
  ForEach-Object { $binaryPatterns.Add($_) }
$outputOnlyPatterns | ForEach-Object { $binaryPatterns.Add($_) }

function Get-OutputScanRoots {
  $roots = New-Object System.Collections.Generic.List[string]
  if ($IncludeHelperBuildOutput) {
    $helperDistPath = Join-Path $repoRoot ".tmp/csp-import-helper-dist"
    if (Test-Path -LiteralPath $helperDistPath) {
      $roots.Add($helperDistPath)
    }
  }
  if ($IncludeLocalRelease) {
    $localReleasePath = Join-Path $repoRoot "release-local"
    if (Test-Path -LiteralPath $localReleasePath) {
      $roots.Add($localReleasePath)
    }
  }
  return $roots
}

function Invoke-RipgrepOutputScan {
  param(
    [string[]]$RootPaths,
    [string[]]$RegexPatterns,
    [string[]]$FixedStringPatterns,
    [System.Collections.Generic.List[object]]$Findings
  )

  if ($RootPaths.Count -eq 0) {
    return
  }

  $rg = Get-Command rg -ErrorAction SilentlyContinue
  if (-not $rg) {
    throw "ripgrep is required to scan large build/release output directories"
  }

  $scanSets = @(
    [pscustomobject]@{
      Mode = "regex"
      Args = @()
      Patterns = $RegexPatterns
    },
    [pscustomobject]@{
      Mode = "fixed"
      Args = @("--fixed-strings")
      Patterns = $FixedStringPatterns
    }
  )

  foreach ($scanSet in $scanSets) {
    $scanPatterns = @($scanSet.Patterns | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($scanPatterns.Count -eq 0) {
      continue
    }

    $argsList = @(
      "--hidden",
      "--no-ignore",
      "--text",
      "--files-with-matches",
      "--glob", "!*.zip",
      "--color", "never"
    )
    $argsList += $scanSet.Args
    foreach ($pattern in $scanPatterns) {
      $argsList += @("-e", $pattern)
    }
    $argsList += $RootPaths

    $matches = & $rg.Source @argsList 2>$null
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 1) {
      continue
    }
    if ($exitCode -ne 0) {
      throw "ripgrep build/release output scan failed with exit code $exitCode"
    }

    foreach ($match in ($matches | Sort-Object -Unique)) {
      $Findings.Add([pscustomobject]@{
        File = $match
        Line = 0
        Rule = "Build/release output local/private data"
        Value = "matched local path, private path, or secret pattern"
      })
    }
  }
}

$files = New-Object System.Collections.Generic.List[string]
Get-TrackedTextFiles | ForEach-Object { $files.Add($_) }
if ($IncludeBuildOutput) {
  Get-BuildOutputTextFiles | ForEach-Object { $files.Add($_) }
}

$findings = New-Object System.Collections.Generic.List[object]

foreach ($file in ($files | Sort-Object -Unique)) {
  $content = Get-Content -LiteralPath $file -Raw -ErrorAction Stop
  foreach ($pattern in $patterns) {
    if ($pattern.Name -eq "Internal project code name" -and (Test-IsOcrVendorBundle $file)) {
      continue
    }
    foreach ($match in $pattern.Regex.Matches($content)) {
      $lineNumber = ($content.Substring(0, $match.Index) -split "`n").Count
      $findings.Add([pscustomobject]@{
        File = $file
        Line = $lineNumber
        Rule = $pattern.Name
        Value = $match.Value
      })
    }
  }
}

if ($findings.Count -gt 0) {
  Write-Host "[repo-hygiene] potential local/private data leak detected:" -ForegroundColor Red
  $findings |
    Sort-Object File, Line, Rule |
    ForEach-Object {
      Write-Host ("{0}:{1}: {2}: {3}" -f $_.File, $_.Line, $_.Rule, $_.Value)
    }
  exit 1
}

if ($IncludeBuildOutput) {
  foreach ($file in (Get-BuildOutputBinaryFiles | Sort-Object -Unique)) {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $repoRoot $file))
    $decodedContents = @(
      [System.Text.Encoding]::UTF8.GetString($bytes),
      [System.Text.Encoding]::Unicode.GetString($bytes)
    )
    foreach ($pattern in $binaryPatterns) {
      foreach ($content in $decodedContents) {
        foreach ($match in $pattern.Regex.Matches($content)) {
          $findings.Add([pscustomobject]@{
            File = $file
            Line = 0
            Rule = "Build output binary: $($pattern.Name)"
            Value = $match.Value
          })
          break
        }
      }
    }
  }
}

$outputScanRoots = Get-OutputScanRoots
$outputScanRegexPatterns = @(
  '(?i)\b(api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*[\x22\x27][A-Za-z0-9_./+=-]{16,}',
  'reference-local',
  'csp-import-helper-(build-venv|pyinstaller|dist)'
)
$outputScanFixedPatterns = New-Object System.Collections.Generic.List[string]
$outputScanFixedPatterns.Add($repoRoot)
if ($env:USERPROFILE) {
  $outputScanFixedPatterns.Add($env:USERPROFILE)
}
if ($env:USERNAME -and $env:USERNAME.Length -ge 4) {
  $outputScanFixedPatterns.Add($env:USERNAME)
}
$outputScanFixedPatterns.Add($privateCloudRoot)
$outputScanFixedPatterns.Add($privateDriveName)
Invoke-RipgrepOutputScan `
  -RootPaths @($outputScanRoots | ForEach-Object { $_ }) `
  -RegexPatterns $outputScanRegexPatterns `
  -FixedStringPatterns @($outputScanFixedPatterns | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) `
  -Findings $findings

if ($findings.Count -gt 0) {
  Write-Host "[repo-hygiene] potential local/private data leak detected:" -ForegroundColor Red
  $findings |
    Sort-Object File, Line, Rule |
    ForEach-Object {
      Write-Host ("{0}:{1}: {2}: {3}" -f $_.File, $_.Line, $_.Rule, $_.Value)
    }
  exit 1
}

Write-Host "[repo-hygiene] passed"
exit 0
