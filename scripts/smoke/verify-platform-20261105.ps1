$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $workspace
$testTemp = Join-Path $workspace '.cache/1105-performance/platform-temp'
New-Item -ItemType Directory -Force -Path $testTemp | Out-Null
$env:TEMP = $testTemp
$env:TMP = $testTemp
& node --test --test-reporter=spec scripts/tavern/*.test.mjs *> .cache/1105-performance/node-platform.log
$nodeResult = $LASTEXITCODE
& cargo test --manifest-path src-tauri/Cargo.toml --lib *> .cache/1105-performance/rust-platform.log
$rustResult = $LASTEXITCODE
@{node=$nodeResult;rust=$rustResult} | ConvertTo-Json -Compress
if ($nodeResult -ne 0 -or $rustResult -ne 0) { exit 1 }
