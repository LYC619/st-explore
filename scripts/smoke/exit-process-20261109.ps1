param(
  [ValidateSet('snapshot','remaining','close','cleanup')] [string]$Action,
  [int]$RootPid,
  [string]$ExpectedExe,
  [string]$SnapshotFile
)
$ErrorActionPreference='Stop'
# Only the exact artifact and descendants recorded while that artifact was live.
$s5Rows=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,ExecutablePath)
if ($Action -eq 'snapshot' -or $Action -eq 'close') {
  $s5Root=$s5Rows | Where-Object ProcessId -eq $RootPid
  if (!$s5Root -or $s5Root.ExecutablePath -ine $ExpectedExe) { throw 'Test root identity mismatch' }
  if ($Action -eq 'close') {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class S5Window { [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam); }'
    $s5Handle=(Get-Process -Id $RootPid).MainWindowHandle
    if ($s5Handle -eq 0) { throw 'No test window' }
    if (![S5Window]::PostMessage($s5Handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'Close request failed' }
    '{"closeRequested":true}'
    exit
  }
  $s5Owned=@($s5Root)
  do {
    $s5Next=@($s5Rows | Where-Object { $_.ParentProcessId -in $s5Owned.ProcessId -and $_.ProcessId -notin $s5Owned.ProcessId })
    $s5Owned+= $s5Next
  } while ($s5Next.Count)
  $s5Proof=@($s5Owned | ForEach-Object { [ordered]@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o');exe=$_.ExecutablePath} })
  [ordered]@{root=$RootPid;expectedExe=$ExpectedExe;processes=$s5Proof} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $SnapshotFile -Encoding utf8
  [ordered]@{ownedProcesses=$s5Proof.Count;windowPresent=((Get-Process -Id $RootPid).MainWindowHandle -ne 0)} | ConvertTo-Json -Compress
  exit
}
$s5Proof=Get-Content -LiteralPath $SnapshotFile -Raw | ConvertFrom-Json
if ($s5Proof.root -ne $RootPid -or $s5Proof.expectedExe -ine $ExpectedExe) { throw 'Snapshot identity mismatch' }
$s5Alive=@($s5Rows | Where-Object {
  $s5Current=$_
  @($s5Proof.processes | Where-Object { $_.pid -eq $s5Current.ProcessId -and $_.created -eq $s5Current.CreationDate.ToUniversalTime().ToString('o') -and $_.exe -ieq $s5Current.ExecutablePath }).Count -gt 0
})
if ($Action -eq 'cleanup') {
  # Diagnostic fallback only, after recording a failed natural exit. Never counts as passing.
  foreach ($s5Process in $s5Alive) { Stop-Process -Id $s5Process.ProcessId -Force -ErrorAction SilentlyContinue }
  [ordered]@{cleanedTestProcesses=$s5Alive.Count} | ConvertTo-Json -Compress
  exit
}
$s5Ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -in $s5Alive.ProcessId)
$s5Main=Get-Process -Id $RootPid -ErrorAction SilentlyContinue
[ordered]@{remainingProcesses=$s5Alive.Count;rootAlive=($RootPid -in $s5Alive.ProcessId);windowPresent=($null -ne $s5Main -and $s5Main.MainWindowHandle -ne 0);listeningPorts=$s5Ports.Count} | ConvertTo-Json -Compress
