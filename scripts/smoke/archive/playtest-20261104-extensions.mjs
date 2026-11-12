import { chromium,expect } from '@playwright/test';
import { readFile,writeFile } from 'node:fs/promises';
const base=process.env.STE_SMOKE_URL||'http://127.0.0.1:4214',out=process.env.STE_SMOKE_OUTPUT||'.cache/1104-frontend';
const preset=JSON.parse((await readFile('D:/2.数据库/我的STExplore/资产/预设/Reborn2.3.json','utf8')).replace(/^\uFEFF/,''));
const schema=await readFile('D:/8.Project/0_1_酒馆相关/加MVU前端/前端/柏崎星奈/01_MVU_ZOD脚本.js','utf8');
const helper=Array.from(await readFile('.cache/helper.zip'));
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],failed=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()})});
await page.route('https://example.invalid/**',async route=>{const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});const b=req.postDataJSON();requests.push(b);return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'测试回复。<UpdateVariable><JSONPatch>[{"op":"replace","path":"/世界/地点","value":"测试庭院"}]</JSONPatch></UpdateVariable>'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'});});
try {
 await page.goto(base+'/settings');await page.getByRole('button',{name:'显示',exact:true}).waitFor();
 const ids=await page.evaluate(async({preset,helper})=>{
  const db=await import('/src/lib/archive-db.ts'),{getCurrentRepo}=await import('/src/lib/repo/index.ts'),{parsePreset}=await import('/src/lib/preset-parser.ts');
  await db.saveRoleplayPreferences({installedTavernHelper:(await import('/src/lib/roleplay/tavern-helper-package.ts')).readTavernHelperZip(new Uint8Array(helper)),tavern:{extension_settings:{tavern_helper:{script:{enabled:{presets:['Reborn2.3']},popuped:{presets:['Reborn2.3']}}}}}});
  (await import('/src/components/ai-tools/api-profiles.ts')).persistProfiles([{id:'test',name:'兼容性夹具',model:'fixture',apiUrl:'https://example.invalid/completion',apiKey:''}],'test');localStorage.setItem('ste-play-guide-seen','1');
  await getCurrentRepo('presets').put({...preset.__ste,preset:parsePreset(preset)});
  const card=db.buildCharacterFromCard({spec:'chara_card_v3',data:{name:'扩展兼容测试',description:'用于扩展回归的虚构角色',first_mes:'你好'}});card.assets=[{kind:'worldbook',assetId:'mvu-init',relations:['primary']}];await db.saveCharacter(card);
  const {parseWorldBook}=await import('/src/types/worldbook.ts');await getCurrentRepo('worldbooks').put({id:'mvu-init',title:'MVU测试初始化',createdAt:1,updatedAt:1,worldbook:parseWorldBook({entries:{0:{uid:0,comment:'[InitVar] 初始变量',content:JSON.stringify({世界:{日期:'测试日',地点:'测试书房',时段:'上午'},柏崎星奈:{爱慕度:3}}),disable:true,constant:false,position:0}}})});
  const story=db.buildStoryFromSession({id:'compat',title:'扩展兼容测试',createdAt:1,user:{name:'测试者'},character:{name:card.name},messages:[{id:'greeting',role:'assistant',content:'你好',rawData:{variables:[{stat_data:{世界:{日期:'测试日',地点:'测试书房',时段:'上午'},柏崎星奈:{爱慕度:3}},schema:'没有用别管这个'}]}}]},card.id);story.assets=[{kind:'preset',assetId:preset.__ste.id}];await db.saveArchiveStory(story);return {story:story.id};
 },{preset,helper});
 await page.goto(base+'/play/'+ids.story);const tavern=page.frameLocator('iframe[title="SillyTavern 角色扮演"]');await expect(tavern.locator('#tavern_helper')).toBeAttached({timeout:60000});const frame=page.frames().find(f=>f.url().includes('tavern.html'));
 await expect.poll(()=>frame.evaluate(()=>typeof window.SPresetEditorBridge),{timeout:120000}).toBe('object');
 console.log('SPreset loaded');
 const spreset=await frame.evaluate(()=>({features:window.SPresetEditorBridge.getPresetFeatures(),promptPrepare:typeof window.SPresetImports?.promptManager?.preparePrompt}));
 await tavern.locator('#send_textarea').fill('仅写一句测试问候。');await tavern.locator('#send_but').click();await expect(tavern.locator('#chat')).toContainText('测试回复。',{timeout:45000});
 const store=await page.evaluate(async id=>(await (await import('/src/lib/archive-db.ts')).getArchiveStory(id)).session.messages.at(-1),ids.story);expect(store.content).toContain('测试回复');
 console.log('SPreset generated');
 // Use the original MVU entry and the user's schema in a branch-scoped work copy.
 await page.goto(base+'/beautify');
 await page.evaluate(async({id,schema})=>{
  const {loadFrontend,saveFrontend}=await import('/src/lib/frontend-workbench-store.ts'),{emptyFrontend,importFrontendFile}=await import('/src/lib/frontend-workbench.ts');
  const state=await loadFrontend(id,null);let draft=importFrontendFile(emptyFrontend(),'MVU.js',"import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';");draft=importFrontendFile(draft,'Schema.js',schema);draft.scripts.forEach(s=>s.enabled=true);await saveFrontend(id,null,draft,state.text,state.revision,'apply');
 },{id:ids.story,schema});
 await page.goto(base+'/play/'+ids.story);await expect(tavern.locator('#tavern_helper')).toBeAttached({timeout:60000});const mvuFrame=page.frames().find(f=>f.url().includes('tavern.html'));
 await expect.poll(()=>mvuFrame.evaluate(()=>typeof window.Mvu),{timeout:180000}).toBe('object');
 const mvu=await mvuFrame.evaluate(()=>({keys:Object.keys(window.Mvu),state:window.Mvu.getMvuData({type:'message',message_id:0})}));console.log('MVU loaded');await writeFile(out+'/mvu-loaded.json',JSON.stringify(mvu,null,2));
 await tavern.locator('#send_textarea').fill('再写一句测试问候。');await tavern.locator('#send_but').click();await expect.poll(()=>mvuFrame.evaluate(()=>window.Mvu.getMvuData({type:'message',message_id:-1})?.stat_data?.世界?.地点),{timeout:60000}).toBe('测试庭院');
 await expect.poll(()=>page.evaluate(async id=>(await (await import('/src/lib/archive-db.ts')).getArchiveStory(id)).session.messages.at(-1)?.rawData?.variables?.[0]?.stat_data?.世界?.地点,ids.story),{timeout:30000}).toBe('测试庭院');
 await page.reload();await expect(tavern.locator('#tavern_helper')).toBeAttached({timeout:60000});await expect.poll(()=>page.frames().find(f=>f.url().includes('tavern.html')).evaluate(async()=>(await import('/script.js')).chat.length?window.TavernHelper?.getVariables({type:'message',message_id:-1})?.stat_data?.世界?.地点:undefined),{timeout:30000}).toBe('测试庭院');await page.screenshot({path:out+'/extensions.png'});await writeFile(out+'/extensions-result.json',JSON.stringify({spreset,mvu,requests:requests.filter(Boolean).map(r=>({messages:r.messages?.length,stream:r.stream,model:r.model})),errors,failed},null,2));
 console.log('compatibility passed');
} catch(e){await writeFile(out+'/extensions-state.json',JSON.stringify(await Promise.all(page.frames().filter(f=>f.url().includes('tavern.html')).map(f=>f.evaluate(async()=>({chat:(await import('/script.js')).chat,metadata:(await import('/script.js')).chat_metadata,mvuKeys:Object.keys(window.Mvu||{}),scripts:window.TavernHelper?.getScriptTrees({type:'global'}),unique:window.th_unique_check?Object.fromEntries(Object.entries(window.th_unique_check).map(([k,v])=>[k,[...v]])):null,rows:[...document.querySelectorAll('#tavern_helper div[data-script-id]')].map(x=>x.dataset.scriptId),toasts:document.querySelector('#toast-container')?.innerText})))),null,2));await page.screenshot({path:out+'/extensions-failed.png'});await writeFile(out+'/extensions-error.json',JSON.stringify({error:e.message.slice(0,3500),errors,failed},null,2));throw new Error(e.message.slice(0,1500));}finally{await browser.close();}
