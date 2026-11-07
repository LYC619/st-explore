param([switch]$Resume)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $workspace
$identifier = 'com.ste.explorer.playtest1105'
$profile = Join-Path $env:APPDATA $identifier
$configFile = Join-Path $profile 'config.json'
if ((Test-Path -LiteralPath $profile) -and -not $Resume) { throw 'Isolated test profile already exists; inspect before reusing' }
$vault = Join-Path $workspace '.cache/1105-performance/vault'
$metaFile = Join-Path $vault '库信息.json'
if(-not $Resume){
  $meta = Get-Content -Raw -LiteralPath $metaFile | ConvertFrom-Json -AsHashtable
  $meta.Remove('roleplay')
  $meta | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $metaFile -Encoding utf8NoBOM
  New-Item -ItemType Directory -Path $profile | Out-Null
  @{vaultRoot=$vault;vaultRegistry=@{version=1;activeId='performance1105';vaults=@(@{id='performance1105';name='性能验证副本';path=$vault;createdAt=1;lastUsedAt=1})}} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configFile -Encoding utf8NoBOM
} elseif ([IO.Path]::GetFullPath((Get-Content -Raw -LiteralPath $configFile | ConvertFrom-Json).vaultRoot) -ne [IO.Path]::GetFullPath($vault)) { throw 'Unexpected isolated vault; refusing resume' }
$app = $null
try {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9229'
  $app = Start-Process -FilePath (Join-Path $workspace '.cache/1105-performance/STE-test.exe') -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
  $ready=$false
  for($i=0;$i -lt 60;$i++){ try { $null=Invoke-RestMethod 'http://127.0.0.1:9229/json/version' -TimeoutSec 1;$ready=$true;break } catch { Start-Sleep -Milliseconds 500 } }
  if(-not $ready){throw 'WebView2 CDP unavailable'}
  & node scripts/smoke/native-performance-20261105.mjs
  if($LASTEXITCODE -ne 0){throw 'Native performance check failed'}
} finally {
  if($app -and -not $app.HasExited){Stop-Process -Id $app.Id -Force}
  Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
}
