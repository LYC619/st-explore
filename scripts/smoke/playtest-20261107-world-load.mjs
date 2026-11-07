import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tavernFrontend } from '../tavern/vite-plugin.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const out='.cache/play-world-b25-load';await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,plugins:[tavernFrontend(),react()],optimizeDeps:{entries:['src/main.tsx']},resolve:{alias:{'@':path.resolve('src')}},cacheDir:'node_modules/.vite-world-load',server:{host:'127.0.0.1',port:4244,strictPort:true,watch:null,hmr:false}});await server.listen();
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:900}}),cdp=await page.context().newCDPSession(page),globalCDP=await browser.newBrowserCDPSession();
const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));await cdp.send('Performance.enable');
const button=name=>page.getByRole('button',{name,exact:true});
try{
 await page.goto('http://127.0.0.1:4244/worlds');await expect(button('开辟新世界')).toBeVisible({timeout:20000});
 for(const count of [12,50]){
  const seeded=await page.evaluate(async count=>{
   const{createWorld,stepWorld}=await import('/src/play/world/simulation.ts'),{currentWorldRepo}=await import('/src/play/storage/world-repo.ts');
   const state=createWorld(73),base=structuredClone(state.actors);state.actors=Array.from({length:count},(_,i)=>({...structuredClone(base[i%12]),id:`a${i}`,name:`行旅${i+1}`,relations:{}}));
   const repo=currentWorldRepo();let last=await repo.create(`${count}人压力`,state),eventCount=0;const start=performance.now();
   while(eventCount<11000){const result=stepWorld(last.state);eventCount+=result.events.length;last=await repo.append(last,result,'step');}
   return{id:last.worldId,eventCount,tick:last.state.tick,prepareMs:performance.now()-start};
  },count);
  const loadedAt=Date.now();await page.goto('http://127.0.0.1:4244/worlds/'+seeded.id);await expect(button('推进一步')).toBeEnabled({timeout:45000});if(await button('知道了').isVisible())await button('知道了').click();const loadMs=Date.now()-loadedAt;
  const durations=[];for(let i=0;i<20;i++){const t=Date.now();await button('推进一步').click();await expect(button('推进一步')).toBeEnabled();durations.push(Date.now()-t);}
  await cdp.send('HeapProfiler.collectGarbage');const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const frames=await page.evaluate(()=>new Promise(resolve=>{const frames=[],start=performance.now();let previous=start;function sample(t){frames.push(t-previous);previous=t;if(t-start<5000)requestAnimationFrame(sample);else resolve({count:frames.length,elapsed:t-start,p95:frames.sort((a,b)=>a-b)[Math.floor(frames.length*.95)]});}requestAnimationFrame(sample);}));
  const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const processes=(await globalCDP.send('SystemInfo.getProcessInfo')).processInfo;
  const pids=processes.map(p=>p.id).filter(Number.isSafeInteger).join(',');
  const memory=JSON.parse(execFileSync('powershell',['-NoProfile','-Command',`Get-Process -Id ${pids} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`],{encoding:'utf8'}));
  const index=await page.evaluate(async id=>{const{currentWorldRepo}=await import('/src/play/storage/world-repo.ts');const h=await currentWorldRepo().open(id);return{eventCount:h.index.reduce((n,r)=>n+r.events.length,0),snapshotsInIndex:h.index.some(r=>'state'in r),rows:h.index.length};},seeded.id);
  expect(index.eventCount).toBeLessThanOrEqual(10000);expect(index.snapshotsInIndex).toBe(false);expect(await page.locator('.world-event').count()).toBeLessThanOrEqual(100);
  results.push({actors:count,...seeded,loadMs,stepMedianMs:durations.sort((a,b)=>a-b)[10],stepP95Ms:durations[19],fps:frames.count/(frames.elapsed/1000),frameP95Ms:frames.p95,mainThreadBusyFraction:(after.TaskDuration-before.TaskDuration)/(frames.elapsed/1000),heapBytes:after.JSHeapUsedSize,domNodes:after.Nodes,listeners:after.JSEventListeners,index,processes:processes.map(p=>({...p,...memory.find(m=>m.Id===p.id)}))});
  await page.screenshot({path:`${out}/${count}-actors.png`});await writeFile(`${out}/progress.json`,JSON.stringify({results,errors},null,2));
 }
 expect(errors).toEqual([]);await writeFile(`${out}/result.json`,JSON.stringify({results,errors,environment:'Headless Edge Windows; process working sets include browser/GPU processes, not dedicated GPU allocation measurements'},null,2));console.log(JSON.stringify(results.map(({actors,loadMs,stepMedianMs,stepP95Ms,fps,heapBytes,index})=>({actors,loadMs,stepMedianMs,stepP95Ms,fps,heapBytes,index}))));
}finally{await browser.close();await server.close();}
