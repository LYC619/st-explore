import { createServer } from 'vite';
import config from '../../vite.config.ts';

// Browser acceptance runs should not reload an active story when another bounded
// work item updates a source file. Each Playwright invocation starts a fresh server.
// Keep optimized dependencies apart from build/unit runs, under Vite's served
// node_modules path (a root dot-directory is rejected by the static middleware).
// Load the actual config before createServer: Vite's in-flight config loader can
// stall the Tavern plugin's dynamic imports on Node 22.14. No plugin is omitted.
const port = Number(process.env.STE_TEST_PORT ?? 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid test server port');
const server = await createServer({ ...config, configFile: false, cacheDir: `node_modules/.vite-browser-${port}`,
  server: { ...config.server, host: '127.0.0.1', port, strictPort: true, watch: null, hmr: false } });
await server.listen();
