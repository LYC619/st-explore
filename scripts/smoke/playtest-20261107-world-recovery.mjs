import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tavernFrontend } from '../tavern/vite-plugin.mjs';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const out='.cache/play-world-b25-recovery'; await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,plugins:[tavernFrontend(),react()],optimizeDeps:{entries:['src/main.tsx']},resolve:{alias:{'@':path.resolve('src')}},cacheDir:'node_modules/.vite-world-recovery',server:{host:'127.0.0.1',port:4242,strictPort:true,watch:null,hmr:false}});await server.listen();
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:900}}),base='http://127.0.0.1:4242';
const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const button=name=>page.getByRole('button',{name,exact:true});
const close=async()=>{await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);};
const download=async(name,file)=>{const waiting=page.waitForEvent('download');await button(name).click();await(await waiting).saveAs(`${out}/${file}`);};
try{
 await page.goto(base+'/worlds');if(await button('知道了').isVisible())await button('知道了').click();
 const ids=await page.evaluate(async()=>{
  const db=await import('/src/lib/archive-db.ts'),{saveSummary}=await import('/src/lib/summary-db.ts');
  const {currentWorldRepo}=await import('/src/play/storage/world-repo.ts'),{createWorld,stepWorld}=await import('/src/play/world/simulation.ts');
  const {withIntelligence}=await import('/src/play/agents/state.ts'),{startGal,sceneFromText}=await import('/src/play/gal/scene.ts');
  const {importStageImage}=await import('/src/play/media/asset.ts'),{currentMediaRepo}=await import('/src/play/media/media-repo.ts');
  const card=db.buildCharacterFromCard({name:'异世剑客',description:'来自另一个世界的剑客。',scenario:'GUEST_A_PRIVATE'});await db.saveCharacter(card);
  const second=db.buildCharacterFromCard({name:'星海医师',description:'来自星际飞船的医师。',scenario:'GUEST_B_PRIVATE'});await db.saveCharacter(second);
  const story=db.buildStoryFromSession({id:'memory-source',title:'回顾来源测试',createdAt:1,user:{name:'玩家'},character:{name:card.name},messages:Array.from({length:36},(_,i)=>({id:`m${i}`,role:i%2?'user':'assistant',content:i===30?'楼层定位目标 <summary>在桥头约定春日再会。</summary>':`第${i}层的日常见闻。`}))},card.id);await db.saveArchiveStory(story);
  for(const [kind,title,content,floor]of[['diary','医师日记','记下旅途相遇。',12],['volume','旅途章节','我们已经抵达渡口。',20]])await saveSummary({id:crypto.randomUUID(),bookId:story.id,bookTitle:story.title,kind,title,content,floorStart:floor,floorEnd:floor,createdAt:1,updatedAt:1});
  const media=await importStageImage(await(await fetch('/play/backgrounds/sanctuary.webp')).blob());await currentMediaRepo().put(media);
  let state=withIntelligence(createWorld(73));state.intelligence.personas.a0.privateNotes='FULL_PACKAGE_PRIVATE';
  let world=await currentWorldRepo().create('恢复核验',state);for(let i=0;i<24;i++)world=await currentWorldRepo().append(world,stepWorld(world.state),'step');
  state=startGal(world.state,sceneFromText('素材与断点','旅人','这段私密故事随完整包保存。'),'story','a0');state.gal.backgroundAsset=media.id;
  const gal=await currentWorldRepo().create('整包剧场核验',state);
  return{world:world.worldId,gal:gal.worldId,story:story.id,card:card.id,second:second.id,media:media.id};
 });
 await page.goto(base+'/worlds/'+ids.world);await expect(button('推进一步')).toBeEnabled();if(await button('知道了').isVisible())await button('知道了').click();
 await button('打开记忆中枢').click();await page.getByText('回顾已有故事的小总结、日记与章节',{exact:true}).click();
 await page.getByLabel('来源故事',{exact:true}).selectOption(ids.story);await expect(page.locator('.world-memory-card')).toHaveCount(3);
 const summary=page.locator('.world-memory-card').filter({hasText:'在桥头约定春日再会'});await summary.getByRole('button',{name:'提炼为短事实'}).click();
 await expect(page.getByLabel('一句短事实')).toHaveValue('在桥头约定春日再会。');await button('确认保存').click();await button('剧情时间线').click();
 await summary.getByRole('button',{name:'回到发生楼层'}).click();await expect(page).toHaveURL(new RegExp('/story/'+ids.story));
 await expect(page.locator('[data-index="30"]')).toBeInViewport({timeout:10000});results.push('既有小总结/日记/章节汇总；短事实确认；真实来源楼层跳转');
 await page.goto(base+'/worlds/'+ids.world);await button('世界存档与回放').click();await button('回看世界').click();await page.getByLabel('选择回放版本').fill('10');await button('查看此刻地图').click();await expect(page.getByTestId('world-tick')).toContainText('第 10 步');await button('从这里分支').click();await expect(page.getByTestId('world-tick')).toContainText('第 10 步');await expect(page).not.toHaveURL(new RegExp(ids.world));results.push('轻量历史真实回放与第10步分支');
 await page.goto(base+'/worlds/'+ids.world);await button('世界存档与回放').click();await download('分享公开沙盘快照','public.ste-world');
 const publicText=await readFile(`${out}/public.ste-world`,'utf8');const publicData=await page.evaluate(async text=>{const{readPackage}=await import('/src/play/storage/world-package.ts');return [...readPackage(text).records()];},publicText);
 expect(publicData).toHaveLength(1);expect(JSON.stringify(publicData)).not.toContain('FULL_PACKAGE_PRIVATE');results.push('公开下载解包：单快照，无私密人设/历史');
 await page.goto(base+'/gal/'+ids.gal);await expect(page.locator('.gal-background[src^="blob:"]')).toBeVisible();await button('剧场行囊').click();await download('导出完整故事与素材','full.ste-world');await close();
 const secondContext=await browser.newContext(),restore=await secondContext.newPage();await restore.goto(base+'/worlds');await restore.getByLabel('导入世界备份文件').setInputFiles(`${out}/full.ste-world`);await expect(restore).toHaveURL(/\/gal\//);await expect(restore.locator('.gal-background[src^="blob:"]')).toBeVisible();
 const restored=await restore.evaluate(async()=>{const{currentWorldRepo}=await import('/src/play/storage/world-repo.ts');return(await currentWorldRepo().open(location.pathname.split('/').at(-1))).latest.state;});expect(restored.intelligence.personas.a0.privateNotes).toBe('FULL_PACKAGE_PRIVATE');expect(restored.gal.backgroundAsset).toBe(ids.media);await restore.reload();await expect(restore.getByRole('heading',{name:'素材与断点'})).toBeVisible();await secondContext.close();results.push('完整包真实下载→全新浏览器库导入→素材/秘密/剧场断点重开');
 // Actual local-file and directory selectors. Only selected images are decoded.
 await button('剧场行囊').click();await button('背景与立绘').click();const fc=page.waitForEvent('filechooser');await button('选择本地图片').click();await(await fc).setFiles('public/play/backgrounds/forest.webp');await expect(button('选择本地图片')).toBeEnabled();
 const dc=page.waitForEvent('filechooser');await button('从外部素材目录挑选').click();await(await dc).setFiles(path.resolve('public/play/backgrounds'));await button('mountain.webp').click();await expect(button('选择本地图片')).toBeEnabled();await close();await page.setViewportSize({width:390,height:480});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:`${out}/gal-assets-short.png`});results.push('本地素材、目录挑选与390px短视口');
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/worlds');await button('✧ 主神空间').click();await button('启程').click();const sanctuary=page.url().split('/').at(-1);
 for(const name of ['异世剑客','星海医师']){await button('世界存档与回放').click();await button('召唤与来客档案').click();await button(name).click();await button('确认召唤').click();await expect(page.getByRole('status').filter({hasText:'已在休息室'})).toBeVisible();await close();}
 await page.evaluate(async id=>{const db=await import('/src/lib/archive-db.ts');const c=await db.getCharacter(id);c.card.description='已更新的剑客身世';await db.saveCharacter(c);},ids.card);
 await button('世界存档与回放').click();await button('召唤与来客档案').click();await button('异世剑客').click();await expect(page.getByText('来源卡已更新。确认后只更新本地人设，保留已发生的经历。',{exact:true})).toBeVisible();await close();
 for(let i=0;i<24;i++){await button('推进一步').click();await expect(button('推进一步')).toBeEnabled();}
 const lived=await page.evaluate(async id=>{const {currentWorldRepo}=await import('/src/play/storage/world-repo.ts');const h=await currentWorldRepo().open(id);return {actors:h.latest.state.actors.slice(0,2),events:h.index.flatMap(c=>c.events)};},sanctuary);
 expect(lived.actors.every(a=>a.journeys>0)).toBe(true);expect(lived.events.some(e=>e.actors.some(a=>['a0','a1'].includes(a))&&['talk','gift','help'].includes(e.kind))).toBe(true);results.push('两位跨作品来客真实召唤/日程走动/社交，来源更新提示');
 // An invalid tail is retained and readable history remains recoverable via UI.
 await page.evaluate(async id=>{const{openDB}=await import('/src/lib/idb.ts');const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('worldCommits','readwrite'),s=tx.objectStore('worldCommits'),r=s.index('worldId').openCursor(IDBKeyRange.only(id),'prev');r.onsuccess=()=>{const c=r.result.value;c.hash='broken';r.result.update(c);};tx.oncomplete=resolve;tx.onerror=reject;});},ids.world);
 await page.goto(base+'/worlds/'+ids.world);await expect(button('从完整版本另存分支')).toBeVisible();await button('从完整版本另存分支').click();await expect(button('推进一步')).toBeEnabled();await button('推进一步').click();await expect(button('推进一步')).toBeEnabled();results.push('损坏尾保留原件→从完整版本另存→继续推演');
 await page.evaluate(async id=>{const{openDB}=await import('/src/lib/idb.ts');const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('worldCommits','readwrite'),r=tx.objectStore('worldCommits').index('worldId').openCursor(IDBKeyRange.only(id),'prev');r.onsuccess=()=>{const c=r.result.value;c.hash='broken';r.result.update(c);};tx.oncomplete=resolve;tx.onerror=reject;});},ids.gal);
 await page.goto(base+'/gal/'+ids.gal);await expect(button('从完整版本另存分支')).toBeVisible();await button('从完整版本另存分支').click();await expect(page).toHaveURL(/\/gal\//);await expect(page.getByRole('heading',{name:'素材与断点'})).toBeVisible();results.push('GAL损坏尾也可另存完整分支并返回剧场');
 const privateWorld=await page.evaluate(async()=>{const {createWorld}=await import('/src/play/world/simulation.ts');const {saveFact}=await import('/src/play/memory/console.ts');const {currentWorldRepo}=await import('/src/play/storage/world-repo.ts');return(await currentWorldRepo().create('视角核验',saveFact(createWorld(73),{type:'secret',subject:'沈砚',text:'B_UI_PRIVATE_CANARY',visibility:'private',owner:'a1'}))).worldId;});
 await page.goto(base+'/worlds/'+privateWorld);await button('接管追踪人物冒险').click();await expect(page.locator('[data-actor-id="a1"]')).toHaveCount(0);await expect(page.locator('[data-actor-id="a0"]')).toBeVisible();await button('打开记忆中枢').click();await button('状态与事件').click();await expect(page.getByLabel('所见范围',{exact:true})).toHaveValue('a0');await expect(page.getByRole('dialog')).not.toContainText('B_UI_PRIVATE_CANARY');await page.getByLabel('所见范围',{exact:true}).selectOption('director');await expect(page.getByRole('dialog')).toContainText('B_UI_PRIVATE_CANARY');await close();results.push('接管默认只见本人事件/近处人物/所知记忆；导演需显式切换');
 const nonFirst=await page.evaluate(async()=>{const{createWorld}=await import('/src/play/world/simulation.ts');const{takeControl}=await import('/src/play/adventure/control.ts');const{currentWorldRepo}=await import('/src/play/storage/world-repo.ts');const state=takeControl(createWorld(73),'a1'),repo=currentWorldRepo();let c=await repo.create('非首位接管恢复',structuredClone(state));state.tick=1;c=await repo.append(c,{state,events:[{id:'perspective-own',tick:1,kind:'talk',title:'沈砚自己的会面',detail:'本人参与的事件。',cause:'同处一地',actors:['a1'],region:state.actors[1].region,witnesses:['a1']},{id:'perspective-other',tick:1,kind:'talk',title:'远方独有的会面',detail:'本人未见的事件。',cause:'同处一地',actors:['a2'],region:state.actors[2].region,witnesses:['a2']}]},'step');return c.worldId;});
 await page.goto(base+'/worlds/'+nonFirst);await expect(page.getByLabel('玩家冒险')).toContainText('沈砚');await expect(page.getByLabel('追踪人物摘要')).toContainText('沈砚');
 await button('查看经历与关系').click();await button('查看此人的事件').click();await expect(page.locator('.world-feed')).toContainText('沈砚自己的会面');await expect(page.locator('.world-feed')).not.toContainText('远方独有的会面');
 await button('打开记忆中枢').click();await expect(page.getByLabel('所见范围',{exact:true})).toHaveValue('a1');await expect(page.getByRole('dialog')).not.toContainText('远方独有的会面');await page.getByLabel('所见范围',{exact:true}).selectOption('director');await expect(page.getByRole('dialog')).toContainText('远方独有的会面');await close();results.push('非首位接管重开恢复冒险面板与本人筛选；导演时间线可显式查看远方事件');
 await page.goto(base+'/gal/'+ids.gal);await button('从完整版本另存分支').click();await expect(page).toHaveURL(/\/gal\//);await button('剧场行囊').click();await button('收起故事到回收站').click();await expect(page).toHaveURL(base+'/worlds');await button('回收站').click();await expect(button('恢复世界')).toBeVisible();await button('恢复世界').click();await button('查看进行中').click();results.push('视觉故事通过剧场菜单收起，可从回收站恢复');
 expect(errors).toEqual([]);await writeFile(`${out}/result.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}catch(e){await page.screenshot({path:`${out}/failure.png`});await writeFile(`${out}/failure.txt`,(await page.locator('body').innerText())+'\n'+e.stack);throw e;}finally{await browser.close();await server.close();}
