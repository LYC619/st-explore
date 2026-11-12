import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';
const testExecutable = await requireIsolatedNativeArtifact('com.ste.explorer.world1107');
const out=path.resolve('.cache/play-world-b25-native'),vault=path.join(out,'vault'),profile=path.join(process.env.APPDATA,'com.ste.explorer.world1107');
const original='C:/Users/yicha/AppData/Roaming/com.ste.explorer/config.json',originalHash=createHash('sha256').update(await readFile(original)).digest('hex');
await mkdir(vault,{recursive:true});await mkdir(profile,{recursive:true});
const configFile=path.join(profile,'config.json');
try{const old=JSON.parse(await readFile(configFile,'utf8'));if(path.resolve(old.vaultRoot)!==vault)throw Error('Unexpected test profile');}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(configFile,JSON.stringify({vaultRoot:vault,vaultRegistry:{version:1,activeId:'world1107',vaults:[{id:'world1107',name:'世界隔离核验',path:vault,createdAt:1,lastUsedAt:1}]}}));}
const testConfig=JSON.parse(await readFile(configFile,'utf8'));testConfig.apiProfiles=JSON.stringify([{id:'native-fixture',name:'原生请求夹具',apiUrl:'http://127.0.0.1:4247/v1/chat/completions',apiKey:'TEST_ONLY',model:'gpt-4o-mini'}]);testConfig.apiActiveProfile='native-fixture';await writeFile(configFile,JSON.stringify(testConfig));
let requests=0,respond=false;const sockets=new Set();const http=createServer((req,res)=>{requests++;req.resume();if(respond){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'{"actionId":"rest"}'}}],usage:{prompt_tokens:300,completion_tokens:30}}));}});http.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(resolve=>http.listen(4247,'127.0.0.1',resolve));
const exe=testExecutable,errors=[],results=[];let app,browser,page;
async function launch(){
 app=spawn(exe,[],{cwd:process.cwd(),windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9237'}});
 let ready=false;for(let i=0;i<60;i++){try{await fetch('http://127.0.0.1:9237/json/version');ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}
 if(!ready)throw Error('Native WebView2 unavailable');browser=await chromium.connectOverCDP('http://127.0.0.1:9237');page=browser.contexts()[0].pages()[0];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.locator('body')).not.toContainText('正在打开文件库',{timeout:20000});
}
async function quit(){const exited=new Promise(resolve=>app.once('exit',resolve));await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('Native close timed out')),12000))]);await browser.close();browser=undefined;}
const button=name=>page.getByRole('button',{name,exact:true});
try{
 await launch();await page.goto('http://tauri.localhost/worlds');await expect(button('开辟新世界')).toBeVisible({timeout:25000});if(await button('知道了').isVisible())await button('知道了').click();
 await button('开辟新世界').click();await button('启程').click();await expect(page.getByTestId('world-tick')).toContainText('第 0 步');const world=page.url().split('/').at(-1);
 for(let i=0;i<5;i++){await button('推进一步').click();await expect(button('推进一步')).toBeEnabled();}
 await button('打开记忆中枢').click();await button('状态与事件').click();await button('＋ 一句新记忆').click();await page.getByLabel('一句短事实').fill('原生磁盘保存的约定。');await button('确认保存').click();await expect(page.locator('.world-capture')).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.screenshot({path:path.join(out,'native-world.png')});await quit();
 const files=await readdir(path.join(vault,'世界',world));const last=JSON.parse(await readFile(path.join(vault,'世界',world,files.filter(f=>/\d{6}\.json/.test(f)).sort().at(-1)),'utf8'));
 expect(last.state.tick).toBe(5);expect(last.state.intelligence.facts.some(f=>f.text==='原生磁盘保存的约定。')).toBe(true);results.push('Windows WebView2真实Worker/原子磁盘存档/短事实/正常关窗');
 await launch();await page.goto('http://tauri.localhost/worlds/'+world);await expect(page.getByTestId('world-tick')).toContainText('第 5 步',{timeout:15000});await button('打开记忆中枢').click();await button('状态与事件').click();await expect(page.locator('.world-memory-card').filter({hasText:'原生磁盘保存的约定'})).toBeVisible();await page.keyboard.press('Escape');results.push('退出程序后重新启动：世界、记忆及时间一致');
 // Import through the real file input, exercising Rust filesystem and hashed image storage.
 await button('返回世界列表').click();await page.getByLabel('导入世界备份文件').setInputFiles(path.resolve('.cache/play-world-b25-recovery/full.ste-world'));
 await expect(page).toHaveURL(/\/gal\//,{timeout:15000});await expect(page.locator('.gal-background[src^="blob:"]')).toBeVisible();const gal=page.url().split('/').at(-1);
 await page.screenshot({path:path.join(out,'native-gal.png')});await quit();
 expect((await readdir(path.join(vault,'世界素材'))).some(f=>/^[a-f0-9]{64}\.json$/.test(f))).toBe(true);
 await launch();await page.goto('http://tauri.localhost/gal/'+gal);await expect(page.locator('.gal-background[src^="blob:"]')).toBeVisible();await expect(page.getByRole('heading',{name:'素材与断点'})).toBeVisible();await quit();results.push('整包导入至原生Vault，素材落盘，GAL关窗重开');
 await launch();await page.goto('http://tauri.localhost/worlds/'+world);await expect(button('推进一步')).toBeEnabled();
 async function configureAI(timeout,calls){await button('世界存档与回放').click();await button('人物智能与额度').click();await button('人物自主思考').click();await page.getByLabel('模型连接',{exact:true}).selectOption('native-fixture');await page.getByText('本次额度与记忆整理',{exact:true}).click();await page.getByLabel('单次超时（秒）').fill(String(timeout));await page.getByLabel('最多请求次数').fill(String(calls));await button('确认并开启新额度').click();await expect(button('确认并开启新额度')).toBeEnabled();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);}
 await configureAI(30,10);await button('推进一步').click();await expect.poll(()=>requests).toBe(1);await button('停止').click();await expect(button('推进一步')).toBeEnabled({timeout:8000});await expect(page.getByTestId('world-tick')).toContainText('第 5 步');results.push('原生HTTP在途停止：世界不推进，预算已持久记账');
 await configureAI(1,10);await button('推进一步').click();await expect(page.getByRole('alert')).toContainText('超时',{timeout:10000});expect(requests).toBe(2);await expect(button('推进一步')).toBeEnabled();
 respond=true;await configureAI(30,1);await button('推进一步').click();await expect(page.getByRole('alert')).toContainText('额度',{timeout:10000});expect(requests).toBe(3);await expect(page.getByTestId('world-tick')).toContainText('第 5 步');await page.screenshot({path:path.join(out,'native-budget.png')});await quit();
 const entries=(await readdir(path.join(vault,'世界',world))).filter(f=>/\d{6}\.json/.test(f)).sort();const lastAI=JSON.parse(await readFile(path.join(vault,'世界',world,entries.at(-1)),'utf8'));expect(lastAI.state.intelligence.receipts.map(r=>r.status)).toEqual(['cancelled','cancelled','completed']);expect(lastAI.state.intelligence.receipts.every(r=>r.charged>0)).toBe(true);results.push('原生HTTP真实超时与单次预算熔断；三次请求，无自动重试，费用随档保存');
 expect(createHash('sha256').update(await readFile(original)).digest('hex')).toBe(originalHash);expect(errors).toEqual([]);
 await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors,originalConfigUnchanged:true,isolatedProfile:profile,vault,executableHash:createHash('sha256').update(await readFile(exe)).digest('hex')},null,2));console.log(JSON.stringify({results,errors}));
}catch(e){if(page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}throw e;}finally{if(browser)await browser.close().catch(()=>{});if(app&&app.exitCode===null)app.kill();for(const s of sockets)s.destroy();await new Promise(resolve=>http.close(resolve));}
