import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';
const testExecutable = await requireIsolatedNativeArtifact('com.ste.explorer.chat1107');
const out=path.resolve('.cache/chat-load-1107/native'),vault=path.join(out,'vault'),profile=path.join(process.env.APPDATA,'com.ste.explorer.chat1107');
await mkdir(vault,{recursive:true});await mkdir(profile,{recursive:true});
const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/api.?key|password|token|authorization/i.test(k)?'':clean(v)])):value;
const config=JSON.parse(await readFile(path.join(process.env.APPDATA,'com.ste.explorer/config.json'),'utf8'));
const metadata=JSON.parse(await readFile(path.join(config.vaultRoot,'库信息.json'),'utf8'));
await writeFile(path.join(vault,'库信息.json'),JSON.stringify(clean(metadata)));
const cardDir=path.join(vault,'角色','加载诊断'),storyDir=path.join(cardDir,'故事','加载诊断');await mkdir(storyDir,{recursive:true});
const card={id:'char-load',name:'加载诊断',tags:[],status:'未开始',createdAt:1,updatedAt:1,card:{spec:'chara_card_v3',spec_version:'3.0',data:{name:'加载诊断',description:'虚构的书店店主。',first_mes:'聊天加载回归：请进，外面在下雨。',extensions:{}}}};
const story={id:'story-load',characterId:card.id,title:'加载诊断',markers:[],meta:{},createdAt:1,updatedAt:1,session:{id:'chat-load',title:'加载诊断',createdAt:1,user:{name:'旅人'},character:{name:card.name},messages:[{id:'greeting',role:'assistant',content:card.card.data.first_mes}]}};
await writeFile(path.join(cardDir,'档案.json'),JSON.stringify(card));await writeFile(path.join(storyDir,'故事.json'),JSON.stringify(story));
const profileFixture=JSON.parse(await readFile('.cache/chat-load-1107/effective-profile-fixture.json','utf8'));
await writeFile(path.join(profile,'config.json'),JSON.stringify({vaultRoot:vault,vaultRegistry:{version:1,activeId:'chat1107',vaults:[{id:'chat1107',name:'聊天诊断隔离库',path:vault,createdAt:1,lastUsedAt:1}]},...profileFixture}));
const app=spawn(testExecutable,[],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9238'}});
let browser,page;const errors=[],consoleErrors=[],failed=[];
try {
 let ready=false;for(let i=0;i<60;i++){try{await fetch('http://127.0.0.1:9238/json/version');ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}if(!ready)throw Error('CDP unavailable');
 browser=await chromium.connectOverCDP('http://127.0.0.1:9238');page=browser.contexts()[0].pages()[0];
 page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
 // Keep normal networking; the sanitized model profiles point at a local
 // unavailable endpoint. No generation is requested during this check.
 await page.goto('http://tauri.localhost/');
 await expect(page.locator('main')).toBeVisible({timeout:90000});
 const configured=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('config_get',{key:'vaultRoot'}));expect(path.resolve(configured)).toBe(vault);
 await page.evaluate(()=>localStorage.setItem('ste-play-guide-seen','1'));
 await page.goto('http://tauri.localhost/play/story-load');
 const tavern=page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
 await expect(tavern.locator('#chat')).toContainText('聊天加载回归：请进，外面在下雨。',{timeout:60000});
 await expect(tavern.locator('#ste_play_mode')).toBeAttached({timeout:15000});
 await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,errors,consoleErrors,failed},null,2));
 await page.screenshot({path:path.join(out,'loaded.png')});console.log('Native story and settings loaded with sanitized user preferences');
}catch(e){if(page){const bootstrap=await page.evaluate(async()=>{const h=[...window.__STE_TAVERN_HOSTS__?.values()??[]][0];if(!h)return null;const r=await h.request('/api/bootstrap');return {status:r.status,...(!r.ok?{error:await r.json()}:{})};}).catch(()=>null);console.log('bootstrap diagnosis',JSON.stringify(bootstrap));const frames=[];for(const f of page.frames())frames.push({url:f.url(),body:(await f.locator('body').innerText().catch(()=>'' )).slice(0,4500)});await writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(e),bootstrap,errors,consoleErrors,failed,frames},null,2));await page.screenshot({path:path.join(out,'failure.png')});}throw e;}
finally{if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();}
