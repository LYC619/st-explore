$ErrorActionPreference = 'Stop'
$workspace = (Get-Location).Path
$testRoot = Join-Path $workspace '.cache/1105-native-integrated'
$runSuffix = Get-Date -Format 'yyyyMMddHHmmss'
$installDir = Join-Path $testRoot "installed-$runSuffix"
$roamingDir = 'C:/Users/yicha/AppData/Roaming/com.ste.explorer'
$localDir = 'C:/Users/yicha/AppData/Local/com.ste.explorer'
$roamingBackup = 'C:/Users/yicha/AppData/Roaming/com.ste.explorer.before-test1105formal'
$localBackup = 'C:/Users/yicha/AppData/Local/com.ste.explorer.before-test1105formal'
$roamingResult = "C:/Users/yicha/AppData/Roaming/com.ste.explorer.test-result1105formal-$runSuffix"
$localResult = "C:/Users/yicha/AppData/Local/com.ste.explorer.test-result1105formal-$runSuffix"
$uninstallKey = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/ST Explorer'
$productKey = 'HKCU:/Software/ste/ST Explorer'
foreach ($path in @($installDir, $roamingBackup, $localBackup, $roamingResult, $localResult)) {
  if (Test-Path -LiteralPath $path) { throw "Test destination already exists: $path" }
}
function Test-RegistryKey([string]$path) {
  $native = $path.Replace('HKCU:/', 'HKCU\').Replace('/', '\')
  & reg.exe query $native *> $null
  return $LASTEXITCODE -eq 0
}
if ((Test-RegistryKey $uninstallKey) -or (Test-RegistryKey $productKey)) { throw 'An existing install needs separate handling' }
if (Get-Process | Where-Object { $_.ProcessName -match '^STE$|^STE-.*portable$' }) { throw 'Close the existing app before isolation' }
# Validate all directory moves before touching either profile folder.
foreach ($pair in @(@($roamingDir,$roamingBackup,$roamingResult),@($localDir,$localBackup,$localResult))) {
  $expectedParent = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($pair[0]))
  foreach ($path in $pair) {
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($path)) -ne $expectedParent -or [IO.Path]::GetFileName($path) -notlike 'com.ste.explorer*') { throw 'Profile isolation path check failed' }
  }
}
$config = Get-Content -Raw -LiteralPath (Join-Path $roamingDir 'config.json') | ConvertFrom-Json
$hashBefore = Get-ChildItem -File -LiteralPath $roamingDir | ForEach-Object { @{ name=$_.Name; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } }
$result = [ordered]@{ started=(Get-Date -Format o); installExit=$null; nativeTestExit=$null; uninstallExit=$null; configRestored=$false }
$appProcess = $null
try {
  Move-Item -LiteralPath $roamingDir -Destination $roamingBackup
  Move-Item -LiteralPath $localDir -Destination $localBackup
  New-Item -ItemType Directory -Path $roamingDir | Out-Null
  $vault = (Join-Path $testRoot 'vault').Replace('\','/')
  $isolatedConfig = @{ vaultRoot=$vault; apiProfiles=$config.apiProfiles; apiActiveProfile=$config.apiActiveProfile; vaultRegistry=@{version=1; activeId='formal-1105';vaults=@(@{id='formal-1105';name='正式包测试副本';path=$vault;createdAt=1;lastUsedAt=1})} }
  $isolatedConfig | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $roamingDir 'config.json') -Encoding utf8
  $installer = Join-Path $workspace 'release/2026-11-05-performance-diagnostics/ST-Explorer-0.9.8-2026-11-05-setup.exe'
  $install = Start-Process -FilePath $installer -ArgumentList @('/S','/NS',"/D=$installDir") -WindowStyle Hidden -PassThru -Wait
  $result.installExit = $install.ExitCode
  if ($install.ExitCode -ne 0) { throw 'Installer failed' }
  $result.installedHash = (Get-FileHash -LiteralPath (Join-Path $installDir 'STE.exe') -Algorithm SHA256).Hash.ToLower()
  $portableHash = (Get-FileHash -LiteralPath 'release/2026-11-05-performance-diagnostics/STE-0.9.8-2026-11-05-portable.exe' -Algorithm SHA256).Hash.ToLower()
  Copy-Item -LiteralPath (Join-Path $installDir 'STE.exe') -Destination (Join-Path $testRoot 'installed.exe')
  & node .cache/1105-native-integrated/check-binary.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Installed executable has unexpected differences from portable artifact' }
  $result.registeredVersion = (Get-ItemProperty -LiteralPath $uninstallKey).DisplayVersion
  Write-Output 'Installer passed; installed executable matches formal portable artifact'
  $priorBrowserArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9229'
    $appProcess = Start-Process -FilePath (Join-Path $installDir 'STE.exe') -WorkingDirectory $installDir -WindowStyle Hidden -PassThru
  } finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $priorBrowserArgs }
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:9229/json/version' -TimeoutSec 1; $ready=$true; break } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw 'Formal WebView2 did not start' }
  $env:STE_REAL_MODEL_TEST = '1'
  try {
    if ($env:STE_NATIVE_RESTORE_ONLY -eq '1') {
      & node scripts/smoke/playtest-20261105-native-integrated.mjs --restore-only
    } else { & node scripts/smoke/playtest-20261105-native-integrated.mjs }
    $result.nativeTestExit=$LASTEXITCODE
    if ($env:STE_NATIVE_RESTORE_ONLY -eq '1') { Copy-Item -LiteralPath (Join-Path $testRoot 'portable-result.json') -Destination (Join-Path $testRoot 'installed-restore-result.json') }
    if ($result.nativeTestExit -eq 0) {
      Stop-Process -Id $appProcess.Id -Force
      Start-Sleep -Milliseconds 1500
      try {
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9229'
        $appProcess = Start-Process -FilePath (Join-Path $workspace 'release/2026-11-05-performance-diagnostics/STE-0.9.8-2026-11-05-portable.exe') -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
      } finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $priorBrowserArgs }
      for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:9229/json/version' -TimeoutSec 1; break } catch { Start-Sleep -Milliseconds 500 }
      }
      & node scripts/smoke/playtest-20261105-native-integrated.mjs --restore-only; $result.portableTestExit=$LASTEXITCODE
    }
  } finally { Remove-Item Env:STE_REAL_MODEL_TEST }
} catch { $result.error=$_.Exception.Message; Write-Output $result.error }
finally {
  if ($appProcess -and -not $appProcess.HasExited) {
    $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $appProcess.Id })
    Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
    foreach ($child in $children) { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 1500
  }
  if (Test-Path -LiteralPath (Join-Path $installDir 'uninstall.exe')) {
    $uninstall = Start-Process -FilePath (Join-Path $installDir 'uninstall.exe') -ArgumentList @('/S','/UPDATE',"_?=$installDir") -WindowStyle Hidden -Wait -PassThru
    $result.uninstallExit=$uninstall.ExitCode
  }
  # NSIS intentionally retains this install-location key when keeping app data.
  if (Test-Path -LiteralPath $productKey) {
    $registered = (Get-Item -LiteralPath $productKey).GetValue('')
    if ($registered -eq $installDir) { Remove-Item -LiteralPath $productKey } else { $result.registryCleanupError='Unexpected install-location value; kept it' }
  }
  $result.uninstallRegistrationRemoved = -not (Test-Path -LiteralPath $uninstallKey)
  $result.installedExecutableRemoved = -not (Test-Path -LiteralPath (Join-Path $installDir 'STE.exe'))
  if (Test-Path -LiteralPath $roamingBackup) {
    if (Test-Path -LiteralPath $roamingDir) {
      # Keep evidence but discard test copies of connection credentials.
      $testConfig = Get-Content -Raw -LiteralPath (Join-Path $roamingDir 'config.json') | ConvertFrom-Json -AsHashtable
      $testConfig.Remove('apiProfiles'); $testConfig.Remove('apiActiveProfile')
      $testConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $roamingDir 'config.json') -Encoding utf8
      Move-Item -LiteralPath $roamingDir -Destination $roamingResult
    }
    Move-Item -LiteralPath $roamingBackup -Destination $roamingDir
  }
  if (Test-Path -LiteralPath $localBackup) {
    if (Test-Path -LiteralPath $localDir) { Move-Item -LiteralPath $localDir -Destination $localResult }
    Move-Item -LiteralPath $localBackup -Destination $localDir
  }
  $checks = $hashBefore | ForEach-Object { @{name=$_.name; unchanged=((Get-FileHash -LiteralPath (Join-Path $roamingDir $_.name) -Algorithm SHA256).Hash -eq $_.sha256)} }
  $result.configRestored = @($checks | Where-Object { -not $_.unchanged }).Count -eq 0
  $result.configChecks=$checks
  $result.finished=(Get-Date -Format o)
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $testRoot 'lifecycle.json') -Encoding utf8
  $result | ConvertTo-Json -Depth 8
}
if ($result.error -or $result.nativeTestExit -ne 0 -or $result.portableTestExit -ne 0 -or -not $result.configRestored -or $result.uninstallExit -ne 0) { exit 1 }
