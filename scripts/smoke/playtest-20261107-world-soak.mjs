import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tavernFrontend } from '../tavern/vite-plugin.mjs';
import path from 'node:path';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const out=process.env.STE_SOAK_OUTPUT||'.cache/play-world-b25-soak';await mkdir(out,{recursive:true});
const files=['src/pages/WorldPlay.tsx','src/pages/GalPlay.tsx','src/play/world/session.ts','src/play/world/simulation.ts','src/play/storage/world-repo.ts','src/play/media/pool.ts'];
const identity=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
const server=await createServer({configFile:false,plugins:[tavernFrontend(),react()],resolve:{alias:{'@':path.resolve('src')}},optimizeDeps:{entries:['src/main.tsx']},cacheDir:'node_modules/.vite-world-soak',server:{host:'127.0.0.1',port:4241,strictPort:true,watch:null,hmr:false}});await server.listen();
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');const start=Date.now(),samples=[];let steps=0,cycles=0;const duration=Number(process.env.STE_SOAK_SECONDS??3600)*1000;
const button=name=>page.getByRole('button',{name,exact:true});
try{
 await page.goto('http://127.0.0.1:4241/worlds');await expect(button('开辟新世界')).toBeVisible();
 const ids=await page.evaluate(async()=>{const {currentWorldRepo}=await import('/src/play/storage/world-repo.ts');const {createWorld}=await import('/src/play/world/simulation.ts');const {sceneFromText,startGal}=await import('/src/play/gal/scene.ts');const {currentMediaRepo}=await import('/src/play/media/media-repo.ts');const {importStageImage}=await import('/src/play/media/asset.ts');const world=await currentWorldRepo().create('持续运行核验',createWorld(73));const media=await importStageImage(await(await fetch('/play/backgrounds/sanctuary.webp')).blob());await currentMediaRepo().put(media);const state=startGal(createWorld(73),sceneFromText('循环读取','旅人','这段对白只在本地阅读，不调用模型。'),'story','a0');state.gal.backgroundAsset=media.id;const gal=await currentWorldRepo().create('持续剧场核验',state);return{world:world.worldId,gal:gal.worldId};});
 await page.goto('http://127.0.0.1:4241/worlds/'+ids.world);await expect(button('推进一步')).toBeEnabled({timeout:30000});
 while(Date.now()-start<duration){
  await button('推进一步').click();steps++;await expect(page.getByTestId('world-tick')).toContainText(`第 ${steps} 步`);await expect(button('推进一步')).toBeEnabled({timeout:30000});
  if(steps%20===0){
   await button('返回世界列表').click();await page.locator('.world-save-card').filter({hasText:'持续剧场核验'}).getByRole('button',{name:'进入世界'}).click();await expect(button('离开剧场')).toBeVisible();await expect(page.locator('.gal-background[src^="blob:"]')).toBeVisible();
   await button('离开剧场').click();await page.locator('.world-save-card').filter({hasText:'持续运行核验'}).getByRole('button',{name:'进入世界'}).click();await expect(button('推进一步')).toBeEnabled({timeout:30000});cycles++;
  }
  if(steps%50===0||steps===1){await cdp.send('HeapProfiler.collectGarbage');const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));const ui=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,events:document.querySelectorAll('.world-event').length,iframes:document.querySelectorAll('iframe').length}));samples.push({elapsedSeconds:(Date.now()-start)/1000,steps,cycles,heapBytes:metrics.JSHeapUsedSize,nodes:metrics.Nodes,listeners:metrics.JSEventListeners,...ui});await writeFile(`${out}/progress.json`,JSON.stringify({identity,samples,errors},null,2));}
  await page.waitForTimeout(4500);
 }
 expect(errors).toEqual([]);expect(samples.every(s=>s.events<=100&&s.iframes===0)).toBe(true);
 await writeFile(`${out}/result.json`,JSON.stringify({identity,elapsedSeconds:(Date.now()-start)/1000,steps,cycles,samples,errors},null,2));console.log(JSON.stringify({seconds:(Date.now()-start)/1000,steps,cycles,errors}));
}catch(e){await writeFile(`${out}/failure.json`,JSON.stringify({identity,steps,cycles,samples,errors,error:String(e)},null,2));throw e;}finally{await browser.close();await server.close();}
