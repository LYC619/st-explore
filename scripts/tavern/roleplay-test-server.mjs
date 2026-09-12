import { createServer } from 'vite';

// Browser acceptance runs should not reload an active story when another bounded
// work item updates a source file. Each Playwright invocation starts a fresh server.
const server = await createServer({ server: { host: '127.0.0.1', port: 4178, strictPort: true, watch: null, hmr: false } });
await server.listen();
