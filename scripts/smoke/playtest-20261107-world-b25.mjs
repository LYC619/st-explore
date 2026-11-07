import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tavernFrontend } from '../tavern/vite-plugin.mjs';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const out='.cache/play-world-b25'; await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,plugins:[tavernFrontend(),react()],resolve:{alias:{'@':path.resolve('src')}},optimizeDeps:{entries:['src/main.tsx']},cacheDir:'node_modules/.vite-world-b25',server:{host:'127.0.0.1',port:4240,strictPort:true,watch:null,hmr:false}});await server.listen();
const browser=await chromium.launch({headless:true,channel:'msedge'}); const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],results=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://world-test.invalid/**',async route=>{
 const body=route.request().postDataJSON(),context=JSON.parse(body.messages[1].content);requests.push(context);
 let value=context.self?{actionId:context.legalActions.find(a=>a.id==='rest').id,facts:['答应过下次在营地见面。']}:context.playerAction?{title:'灯下的约定',background:'sanctuary',beats:[{speaker:'异界旅人',text:'灯火微微摇晃。你刚才的选择，让我们走到了同一条路上。'},{speaker:'旁白',text:'雨声渐弱，门外传来一声清脆的铃响。'}],choices:[{label:'推开门，看看来客',intent:'打开门迎接来客'},{label:'留下，与她谈谈约定',intent:'留下来谈论此前的约定'}]}:{text:'细雨落在渡口，旅人们重新审视前路。没有人能越过关闭的水道。'};
 await new Promise(r=>setTimeout(r,120));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:300,completion_tokens:80}})});
});
await page.route(/^https?:\/\/(?!127\.0\.0\.1|world-test\.invalid)/,r=>r.abort());
const button=name=>page.getByRole('button',{name,exact:true});const menu=async()=>{await button('世界存档与回放').click();};const close=async()=>{await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);};
const noOverflow=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
const tick=n=>expect(page.getByTestId('world-tick')).toContainText(`第 ${n} 步`);
async function source(){return page.evaluate(async()=>{const db=await import('/src/lib/archive-db.ts');const c=db.buildCharacterFromCard({name:'异界旅人',description:'独立、热情的旅者。',personality:'温柔但勇敢',scenario:'PRIVATE_GUEST_CANARY',first_mes:'她在星门前停下脚步，微笑着向你伸出手。'});await db.saveCharacter(c);const profiles=await import('/src/components/ai-tools/api-profiles.ts');profiles.persistProfiles([{id:'fixture',name:'隔离核验连接',apiUrl:'https://world-test.invalid/v1/chat/completions',apiKey:'FIXTURE_ONLY',model:'gpt-4o-mini'}],'fixture');return c.id;});}
try{
 await page.goto('http://127.0.0.1:4240/worlds');const cardId=await source(); if(await button('知道了').isVisible()) await button('知道了').click();
 await button('开辟新世界').click();await button('启程').click();await tick(0);const worldURL=page.url();
 await button('接管追踪人物冒险').click();await expect(page.getByLabel('玩家冒险')).toBeVisible();
 await page.getByRole('button',{name:/探索此地/}).click();await tick(1);await button('推进一步').click();await tick(2);await expect(button('进入事件剧场')).toBeVisible();
 await button('进入事件剧场').click();await expect(page).toHaveURL(/\/gal\//);await expect(page.locator('iframe')).toHaveCount(0);
 await expect(page.getByRole('button',{name:/01.*上前应对/})).toBeVisible({timeout:10000});await page.screenshot({path:`${out}/encounter-desktop.png`});
 await page.getByRole('button',{name:/01.*上前应对/}).click();await expect(page).toHaveURL(worldURL);await tick(3);results.push('真实Worker探索→独立事件剧场→规则结算一次→返回地图');
 await button('打开记忆中枢').click();await button('状态与事件').click();await button('＋ 一句新记忆').click();await page.getByLabel('一句短事实').fill('答应给沈砚带回一份干粮。');await button('确认保存').click();await expect(page.locator('.world-memory-card').filter({hasText:'答应给沈砚'})).toBeVisible();
 const fact=page.locator('.world-memory-card').filter({hasText:'答应给沈砚'});await fact.getByRole('switch').click();await expect(fact).toContainText('已停用');await fact.getByRole('button',{name:'删除',exact:true}).click();await button('已删除').click();await button('恢复').click();await button('返回记忆').click();await expect(fact).toContainText('已停用');await page.screenshot({path:`${out}/memory-desktop.png`});await close();results.push('短事实保存、Switch停用、删除恢复');
 await menu();await button('导演管理：人物智能与额度').click();await button('人物自主思考').click();await page.getByLabel('模型连接',{exact:true}).selectOption('fixture');await button('确认并开启新额度').click();await close();
 await button('推进一步').click();await tick(4);await expect(button('推进一步')).toBeEnabled();expect(requests.some(r=>r.self)).toBe(true);results.push('实际浏览器出站人设请求、预算落盘、合法动作与旁白');
 await page.setViewportSize({width:390,height:844});await noOverflow();await page.screenshot({path:`${out}/adventure-mobile.png`});await button('打开记忆中枢').click();await noOverflow();await close();
 await button('返回世界列表').click();await button('✧ 主神空间').click();await button('启程').click();await tick(0);await menu();await button('召唤与来客档案').click();await button('异界旅人').click();await page.getByLabel('携带的短事实',{exact:false}).fill('答应在星门下重逢。');await button('确认召唤').click();await expect(page.getByRole('status').filter({hasText:'已在休息室'})).toBeVisible();await close();await page.screenshot({path:`${out}/sanctuary-mobile.png`});results.push('主神空间：真实角色库选择、确认映射、携带短事实与本地实例');
 await button('返回世界列表').click();await button('▷ 视觉故事').click();await page.getByLabel('角色',{exact:true}).selectOption(cardId);await button('揭幕').click();await expect(page).toHaveURL(/\/gal\//);await noOverflow();const galURL=page.url();
 await expect(page.getByRole('button',{name:/01.*走近/})).toBeVisible({timeout:10000});const before=requests.length;await page.screenshot({path:`${out}/gal-mobile.png`});
 await page.getByRole('button',{name:/01.*走近/}).dblclick();await expect(page.getByRole('heading',{name:'灯下的约定'})).toBeVisible({timeout:15000});expect(requests.length-before).toBe(1);
 const after=requests.length;await expect(button('下一段对白')).toBeVisible({timeout:10000});await button('下一段对白').click();await expect(page.getByRole('button',{name:/01.*推开门/})).toBeVisible({timeout:10000});expect(requests.length).toBe(after);
 await page.reload();await expect(page.getByRole('heading',{name:'灯下的约定'})).toBeVisible();await expect(page.getByRole('button',{name:/01.*推开门/})).toBeVisible({timeout:10000});expect(requests.length).toBe(after);
 await button('或者，说出你自己的选择…').click();await page.getByLabel('自由行动').fill('我想邀请她一起听雨。');await page.setViewportSize({width:390,height:480});await expect(button('继续 →')).toBeInViewport();await noOverflow();await page.screenshot({path:`${out}/gal-short.png`});
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:`${out}/gal-desktop.png`});await button('剧情回顾').click();await expect(page.locator('.gal-history')).toContainText('走近对方');await close();
 results.push('GAL真实入口、无iframe、双击仅调用一次、对白推进零调用、重开断点、390px与短视口、历史回顾');
 expect(errors).toEqual([]);await writeFile(`${out}/browser.json`,JSON.stringify({results,errors,requests:requests.length,worldURL,galURL},null,2));console.log(JSON.stringify({results,errors,requests:requests.length}));
}catch(e){await page.screenshot({path:`out/failure.png`.replace('out',out)});console.log((await page.locator('body').innerText()).slice(-6000));throw e;}finally{await browser.close();await server.close();}
