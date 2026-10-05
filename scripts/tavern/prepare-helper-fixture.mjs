import { mkdir, writeFile } from 'node:fs/promises';
const commit = '87ca341a2a2279f4c18cd1918c5ae9dbd1dac492';
const response = await fetch(`https://codeload.github.com/N0VI028/JS-Slash-Runner/zip/${commit}`, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`Helper fixture download failed: HTTP ${response.status}`);
await mkdir('.cache', { recursive: true });
await writeFile('.cache/helper.zip', new Uint8Array(await response.arrayBuffer()));
console.log('Saved the upstream 4.11.3 ZIP to .cache/helper.zip; installation verifies its compiled assets.');
