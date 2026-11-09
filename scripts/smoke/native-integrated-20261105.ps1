param([switch]$RestoreOnly)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $workspace
$testExecutable = & node scripts/smoke/verify-native-artifact.mjs com.ste.explorer.playtest1105
if ($LASTEXITCODE -ne 0) { throw 'Verified isolated build receipt required before profile writes' }
$out = Join-Path $workspace '.cache/1105-native-integrated'
$originalFile = Join-Path $env:APPDATA 'com.ste.explorer/config.json'
$testFile = Join-Path $env:APPDATA 'com.ste.explorer.playtest1105/config.json'
$originalHash = (Get-FileHash -LiteralPath $originalFile -Algorithm SHA256).Hash
$testBefore = [IO.File]::ReadAllBytes($testFile)
$original = Get-Content -Raw -LiteralPath $originalFile | ConvertFrom-Json -AsHashtable
$vault = (Join-Path $out 'vault').Replace('\','/')
$app = $null
$beforeArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
try {
  @{vaultRoot=$vault; apiProfiles=$original.apiProfiles; apiActiveProfile=$original.apiActiveProfile;
    vaultRegistry=@{version=1;activeId='integrated1105';vaults=@(@{id='integrated1105';name='组合验证副本';path=$vault;createdAt=1;lastUsedAt=1})}
  } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $testFile -Encoding utf8NoBOM
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9229'
  $env:STE_REAL_MODEL_TEST='1'
  $app = Start-Process -FilePath $testExecutable -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
  $ready=$false
  for($i=0;$i -lt 60;$i++){try{$null=Invoke-RestMethod 'http://127.0.0.1:9229/json/version' -TimeoutSec 1;$ready=$true;break}catch{Start-Sleep -Milliseconds 500}}
  if(-not $ready){throw 'WebView2 CDP unavailable'}
  if($RestoreOnly){ & node scripts/smoke/playtest-20261105-native-integrated.mjs --restore-only }
  else { & node scripts/smoke/playtest-20261105-native-integrated.mjs }
  if($LASTEXITCODE -ne 0){throw 'Native integration check failed'}
} finally {
  if($app -and -not $app.HasExited){Stop-Process -Id $app.Id -Force}
  [IO.File]::WriteAllBytes($testFile,$testBefore)
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=$beforeArgs
  Remove-Item Env:STE_REAL_MODEL_TEST -ErrorAction SilentlyContinue
  $unchanged = (Get-FileHash -LiteralPath $originalFile -Algorithm SHA256).Hash -eq $originalHash
  @{originalConfigUnchanged=$unchanged;testConfigRestored=$true;finished=(Get-Date -Format o)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'isolation.json') -Encoding utf8NoBOM
  if(-not $unchanged){throw 'Original config changed during test'}
}
