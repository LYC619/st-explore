param([Parameter(Mandatory=$true)][string]$ConfigDir, [Parameter(Mandatory=$true)][string]$Identifier,
  [Parameter(Mandatory=$true)][string]$RunRoot)
$ErrorActionPreference = 'Stop'
if ($Identifier -notmatch '^com\.ste\.explorer\.[a-z0-9-]+$') { throw 'Independent identifier required' }
$configTarget = [System.IO.Path]::GetFullPath($ConfigDir).TrimEnd('\', '/')
if ([System.IO.Path]::GetFileName($configTarget) -cne $Identifier) { throw 'Config identifier mismatch' }
$allowedRuns = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) '.cache/native-closeout')).TrimEnd('\') + '\'
$testRun = [System.IO.Path]::GetFullPath($RunRoot).TrimEnd('\')
if (-not $testRun.StartsWith($allowedRuns, [StringComparison]::OrdinalIgnoreCase)) { throw 'Run root outside synthetic area' }
$marker = Get-Content -LiteralPath (Join-Path $testRun 'fixture.json') -Raw | ConvertFrom-Json
if ($marker.identifier -cne $Identifier) { throw 'Synthetic marker mismatch' }
$lock = [System.IO.File]::Open((Join-Path $configTarget '.config.lock'), [System.IO.FileMode]::OpenOrCreate,
  [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::ReadWrite)
try {
  $lock.Lock(0, 1)
  [Console]::WriteLine('LOCK_READY')
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath (Join-Path $testRun 'release-lock'))) { Start-Sleep -Milliseconds 50 }
} finally { $lock.Unlock(0, 1); $lock.Dispose() }
[Console]::WriteLine('LOCK_RELEASED')
