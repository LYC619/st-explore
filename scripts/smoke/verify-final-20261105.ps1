$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $workspace
$testTemp = Join-Path $workspace '.cache/1105-performance/platform-temp'
$env:TEMP=$testTemp
$env:TMP=$testTemp
& npx vitest run --maxWorkers=2 *> .cache/1105-performance/full-final.log
$suite=$LASTEXITCODE
& npx tsc -p tsconfig.app.json --noEmit *> .cache/1105-performance/types-final.log
$types=$LASTEXITCODE
& npx tsc -p tsconfig.node.json --noEmit *> .cache/1105-performance/node-types.log
$nodeTypes=$LASTEXITCODE
& node --test scripts/sync-version.test.mjs *> .cache/1105-performance/version-final.log
$version=$LASTEXITCODE
@{suite=$suite;types=$types;nodeTypes=$nodeTypes;version=$version} | ConvertTo-Json -Compress | Set-Content .cache/1105-performance/final-checks.json -Encoding utf8NoBOM
if($suite -ne 0 -or $types -ne 0 -or $nodeTypes -ne 0 -or $version -ne 0){exit 1}
