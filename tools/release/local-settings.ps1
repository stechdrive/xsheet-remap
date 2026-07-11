function Get-RepoLocalEnvValue {
  param(
    [string]$RepoRoot,
    [string]$Name
  )

  $localEnvPath = Join-Path $RepoRoot ".env.local"
  if (-not (Test-Path -LiteralPath $localEnvPath)) {
    return ""
  }

  foreach ($line in Get-Content -LiteralPath $localEnvPath -Encoding UTF8) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
      continue
    }
    if ($trimmed -notmatch '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      continue
    }
    if ($Matches[1] -ne $Name) {
      continue
    }

    $value = $Matches[2].Trim()
    if (
      ($value.Length -ge 2) -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    return [System.Environment]::ExpandEnvironmentVariables($value)
  }

  return ""
}

function Resolve-XsheetHandoffDirectory {
  param(
    [string]$RepoRoot,
    [string]$ExplicitDirectory = ""
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitDirectory)) {
    return [System.IO.Path]::GetFullPath($ExplicitDirectory)
  }
  if (-not [string]::IsNullOrWhiteSpace($env:XSHEET_RELEASE_COPY_DIR)) {
    return [System.IO.Path]::GetFullPath($env:XSHEET_RELEASE_COPY_DIR)
  }

  $localDirectory = Get-RepoLocalEnvValue -RepoRoot $RepoRoot -Name "XSHEET_RELEASE_COPY_DIR"
  if (-not [string]::IsNullOrWhiteSpace($localDirectory)) {
    return [System.IO.Path]::GetFullPath($localDirectory)
  }

  return ""
}
