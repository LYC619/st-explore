import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectBuildInfo, isBuildInput } from './build-info.mjs';

test('production inputs exclude history, evidence and tests', () => {
  for (const file of ['src/App.tsx','public/sw.js','src-tauri/src/lib.rs','scripts/tavern/build.mjs','package-lock.json']) assert.equal(isBuildInput(file),true,file);
  for (const file of ['docs/maintenance/CURRENT.md','_reference/example.ts','.user/notes.md','src/test/example.ts','src/lib/sample.test.ts','scripts/tavern/node_modules/x.js','scripts/tavern/build.test.mjs']) assert.equal(isBuildInput(file),false,file);
});
test('git failure gives an honest unknown without preventing a build', () => {
  const root=mkdtempSync(path.join(tmpdir(),'ste-build-info-test-'));
  writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'0.9.9'}));
  const info=collectBuildInfo(root,{now:new Date('2026-11-12T00:00:00Z'),git:()=>{throw Error('unavailable');}});
  assert.equal(info.commit,null); assert.equal(info.dirty,null); assert.deepEqual(info.dirtyFiles,[]);
  assert.equal(info.version,'0.9.9'); assert.equal(info.builtAt,'2026-11-12T00:00:00.000Z');
});
