import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tavernFrontend } from '../tavern/vite-plugin.mjs';
import path from 'node:path';
if(process.env.STE_REAL_MODEL_TEST!=='1')throw Error('Explicit real provider opt-in required');
const out=process.env.STE_REAL_OUTPUT||'.cache/play-world-b25-real-prose';await mkdir(out,{recursive:true});
const configPath='C:/Users/yicha/AppData/Roaming/com.ste.explorer/config.json',original=await readFile(configPath),config=JSON.parse(original.toString('utf8').replace(/^\uFEFF/,''));
const profiles=typeof config.apiProfiles==='string'?JSON.parse(config.apiProfiles):config.apiProfiles,profile=profiles.find(p=>p.id===config.apiActiveProfile);
const server=await createServer({configFile:false,plugins:[tavernFrontend(),react()],resolve:{alias:{'@':path.resolve('src')}},optimizeDeps:{entries:['src/main.tsx']},cacheDir:'node_modules/.vite-world-prose',server:{host:'127.0.0.1',port:4246,strictPort:true,watch:null,hmr:false}});await server.listen();
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage(),envelopes=[];
try{
 await page.route(profile.apiUrl,async route=>{try{const response=await route.fetch({timeout:35000,maxRetries:0}),body=await response.json().catch(()=>({}));envelopes.push({status:response.status(),finishReason:body.choices?.[0]?.finish_reason,usage:body.usage});await route.fulfill({response});}catch{await route.abort('failed');}});
 await page.goto('http://127.0.0.1:4246/worlds');
 const result=await page.evaluate(async({profile,outputTokens,purposes})=>{
  const{persistProfiles}=await import('/src/components/ai-tools/api-profiles.ts');persistProfiles([profile],profile.id);
  const{createWorld,stepWorld}=await import('/src/play/world/simulation.ts'),{withIntelligence,intelligence}=await import('/src/play/agents/state.ts'),{beginBudget}=await import('/src/play/agents/budget.ts');
  const{WorldModelGateway}=await import('/src/play/agents/model-gateway.ts'),{currentWorldRepo}=await import('/src/play/storage/world-repo.ts'),{publicNarrationContext}=await import('/src/play/agents/context-projector.ts');
  const{sceneFromText,startGal,stageChoice,acceptScene}=await import('/src/play/gal/scene.ts'),{generateScene}=await import('/src/play/gal/generate-scene.ts');
  let state=withIntelligence(createWorld(73));state.intelligence.settings={...state.intelligence.settings,profileId:profile.id,model:profile.model,mode:'ai',maxCalls:2,maxTokens:12000,outputTokens};state.intelligence=beginBudget(state.intelligence);
  state.intelligence.personas.a0={identity:'林照晚是守信的药师，爱观察山川草木。',temperament:'温柔但坚定，不轻易许诺。',ambition:'寻找能救助同伴的药草。',privateNotes:'只用于隔离核验：未向旁人提起一枚旧银铃。'};
  const settled=stepWorld(state,{type:'rain',duration:4}),repo=currentWorldRepo();let current=await repo.create('虚构叙事核验',settled.state);
  const gateway=new WorldModelGateway(()=>intelligence(current.state),async data=>{const next=structuredClone(current.state);next.intelligence=data;current=await repo.append(current,{state:next,events:[]},'request');});
  const results=[];
  for(const purpose of purposes){const start=performance.now();try{
   if(purpose==='narrative'){const context=publicNarrationContext(settled.state,settled.events);const {value}=await gateway.request({purpose,tick:settled.state.tick,system:'把已结算的公开事件写成一段有画面感的中文旁白。不得新增行动、物品、秘密、角色心理或改变结果。只返回 JSON：{"text":"80至220字旁白"}。',context},new AbortController().signal);results.push({purpose,elapsedMs:performance.now()-start,value});}
   else{let next=startGal(current.state,sceneFromText('渡口听雨','林照晚','林照晚站在廊檐下，望着封闭的渡口。她问你：既然雨未停，要不要一起寻找山路上的草药？'),'story','a0');next=stageChoice(next,0,'ask');current=await repo.append(current,{state:next,events:[]},'configure');const scene=await generateScene(current.state,gateway,new AbortController().signal);current=await repo.append(current,{state:acceptScene(current.state,next.gal.pending.id,scene),events:[]},'configure');results.push({purpose,elapsedMs:performance.now()-start,scene});}
  }catch(e){results.push({purpose,elapsedMs:performance.now()-start,error:e.message});}}
  return{results,receipts:current.state.intelligence.receipts,charged:current.state.intelligence.budget.charged};
 },{profile,outputTokens:Number(process.env.STE_REAL_OUTPUT_TOKENS||1024),purposes:process.env.STE_REAL_PURPOSE?[process.env.STE_REAL_PURPOSE]:['narrative','scene']});
 expect(createHash('sha256').update(await readFile(configPath)).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));
 await writeFile(`${out}/result.json`,JSON.stringify({model:profile.model,fictionalInputsOnly:true,originalConfigUnchanged:true,...result,envelopes},null,2));console.log(JSON.stringify(result.results.map(r=>({purpose:r.purpose,elapsedMs:r.elapsedMs,error:r.error,beats:r.scene?.beats.length,choices:r.scene?.choices.length}))) );
}finally{await browser.close();await server.close();}
