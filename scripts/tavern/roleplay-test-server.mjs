import { createServer } from 'vite';

// Browser acceptance runs should not reload an active story when another bounded
// work item updates a source file. Each Playwright invocation starts a fresh server.
// Keep optimized dependencies apart from build/unit runs, under Vite's served
// node_modules path (a root dot-directory is rejected by the static middleware).
const server = await createServer({ cacheDir: 'node_modules/.vite-roleplay', server: { host: '127.0.0.1', port: 4178, strictPort: true, watch: null, hmr: false } });
await server.listen();
