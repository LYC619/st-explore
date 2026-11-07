import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tavernFrontend } from '../tavern/vite-plugin.mjs';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
const server=await createServer({configFile:false,plugins:[tavernFrontend(),react()],resolve:{alias:{'@':path.resolve('src')}},optimizeDeps:{entries:['src/main.tsx']},cacheDir:'node_modules/.vite-world-compat',server:{host:'127.0.0.1',port:4245,strictPort:true,watch:null,hmr:false}});await server.listen();
process.env.STE_SMOKE_URL='http://127.0.0.1:4245';process.env.STE_SMOKE_OUTPUT='.cache/play-world-b25-extensions-final';await mkdir(process.env.STE_SMOKE_OUTPUT,{recursive:true});
try{await import('./playtest-20261104-extensions.mjs');}finally{await server.close();}
