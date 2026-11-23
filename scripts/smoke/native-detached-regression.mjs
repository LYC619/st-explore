// New R1/R8/R9 acceptance runner. Only receipt-verified independent native builds.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';

const identifier = process.env.STE_NATIVE_TEST_IDENTIFIER;
assert.equal(process.env.STE_TEST_PRIVATE_DESKTOP, '1', 'Only launch through private desktop wrapper');
const executable = await requireIsolatedNativeArtifact(identifier);
const parent = path.resolve(process.env.STE_NATIVE_TEST_OUTPUT ?? '.cache/verify/native-detached-regression');
assert.ok(parent.startsWith(path.resolve('.cache/verify') + path.sep), 'Synthetic output must stay under .cache/verify/');
const root = path.join(parent, `native-${randomUUID()}`);
const vault = path.join(root, 'vault');
await mkdir(vault, { recursive: true });
await writeFile(path.join(vault, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 3, updatedAt: 1 }));
await writeFile(path.join(root, 'fixture.json'), JSON.stringify({ identifier, synthetic: true }));
const report = { identifier, receipt: process.env.STE_NATIVE_TEST_RECEIPT, executable, syntheticRoot: root, status: 'running', checks: [], runtimeErrors: [], assetFailures: [], processIds: [] };
const save = () => writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 30000) {
  for (const deadline = Date.now() + timeout; Date.now() < deadline;) {
    try { if (await fn()) return; } catch(e) {if(!/garbage collected|session closed|Execution context/.test(e.message))throw e;report.automationRetries=(report.automationRetries??0)+1;}
    await delay(100);
  }
  throw Error('bounded wait expired');
}
let app, stage = 'verify-isolation', syntheticReady = false;
async function check(name, fn) {
  stage = name; const at = Date.now(); const details = await fn();
  report.checks.push({ name, status: 'passed', seconds: (Date.now() - at) / 1000, ...details });
  await save(); console.log(`PASS ${name}`);
}
async function start() {
  await requireIsolatedNativeArtifact(identifier);
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const temp = path.join(root, `temp-${randomUUID()}`); await mkdir(temp);
  const child = spawn(executable, [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env,
    TEMP: temp, TMP: temp, WEBVIEW2_USER_DATA_FOLDER: path.join(root, `webview-${randomUUID()}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=http://127.0.0.1:${port}`,
  } });
  const session = { child, port, closed: new Promise(resolve => child.once('close', resolve)) };
  app = session; report.processIds.push(child.pid); await save();
  console.log(`START owned pid=${child.pid} port=${port}`);
  let spawnError; child.once('error', e => { spawnError = e; });
  await until(async () => {
    if (spawnError || child.exitCode !== null) throw Error('isolated launch failed');
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, 120000);
  session.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  session.context = session.browser.contexts()[0]; session.page = session.context.pages()[0];
  const observe = page => {
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => report.runtimeErrors.push({ name: e.name, message: e.message.slice(0, 350) }));
    page.on('requestfailed', req => { if (new URL(req.url()).hostname === 'tauri.localhost') {
      const failure={url:req.url(),error:req.failure()?.errorText,stage};
      if(failure.error==='net::ERR_ABORTED') (report.cancelledRequests??=[]).push(failure);else report.assetFailures.push(failure);
    } });
    page.on('response', response => { if (new URL(response.url()).hostname === 'tauri.localhost' && response.status() >= 400) report.assetFailures.push({ url: response.url(), status: response.status() }); });
  };
  session.context.pages().forEach(observe); session.context.on('page', observe);
  await session.page.waitForFunction(() => !!window.__TAURI__?.core);
  session.invoke = (command, args) => session.page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
  const environment = await session.invoke('get_environment_info');
  for (const location of [environment.nominalPath, environment.resolvedPath].filter(Boolean)) assert.equal(path.basename(location.replace(/\\/g, '/')), identifier);
  session.configDir = environment.nominalPath;
  report.environment = { nominalPath: environment.nominalPath, resolvedPath: environment.resolvedPath, packageIdentity: environment.packageIdentity };
  // Keep the native new-window protocol unmodified by browser-wide Fetch interception.
  await expect(session.page.locator('[data-vault-switcher]').or(session.page.getByRole('button', { name: '选择文件夹', exact: true })).first()).toBeVisible({ timeout: 60000 });
  return session;
}
async function stop(session) {
  if (!session) return;
  if (session.child.exitCode === null) {
    await session.page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {});
    await until(() => session.child.exitCode !== null, 20000);
  }
  const code = await session.closed;
  await session.browser?.close().catch(() => {});
  return code;
}
async function popupAfter(click) {
  await app.page.evaluate(()=>{ if(!window.__nativeOpen){window.__nativeOpen=window.open;window.open=function(...args){const child=window.__nativeOpen.apply(this,args);window.__nativeChild=child;return child;};} });
  await click();
  await until(()=>popupEval(child=>!!child?.document.querySelector('iframe') && [...child.document.querySelectorAll('button')].some(b=>b.textContent.trim()==='过程'&&!b.disabled)),60000);
  report.childInspection='same-origin opener reference; WebView2 child CDP Runtime session unavailable';
  return true;
}
const popupEval=(fn,arg)=>app.page.evaluate(({source,arg})=>new Function('child','arg',`return (${source})(child,arg)`)(window.__nativeChild,arg),{source:fn.toString(),arg});
const popupClick=name=>popupEval((child,name)=>{const b=[...child.document.querySelectorAll('button')].find(b=>b.textContent.trim()===name||b.getAttribute('aria-label')===name);if(!b||b.disabled)throw Error('Missing enabled synthetic action: '+name);b.click();},name);
const popupDialog=()=>popupEval(c=>!!c.document.querySelector('[role="dialog"], [role="alertdialog"]'));
async function assertMainScrolls() {
  const page = app.page; await page.bringToFront();
  const point = await page.evaluate(() => {
    const area = [...document.querySelectorAll('main div')].filter(el => el.scrollHeight > el.clientHeight + 200 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)).sort((a,b) => b.clientHeight-a.clientHeight)[0];
    if (!area) throw Error('Synthetic reader scroll area missing');
    area.dataset.nativeScroll='true'; area.scrollTop=0;
    const r=area.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 };
  });
  await page.mouse.move(point.x,point.y); await page.mouse.wheel(0,600);
  await expect.poll(() => page.locator('[data-native-scroll]').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  assert.equal(await page.locator('body').getAttribute('data-scroll-locked'), null);
  return await page.locator('[data-native-scroll]').evaluate(el => el.scrollTop);
}
async function storyFromDisk() {
  const files=[];
  async function walk(directory) { for (const entry of await readdir(directory,{withFileTypes:true})) {
    const full=path.join(directory,entry.name); if(entry.isDirectory()) await walk(full); else if(entry.name==='故事.json') files.push(full);
  } }
  await walk(vault); assert.equal(files.length,1); return JSON.parse(await readFile(files[0],'utf8'));
}
try {
  await check('fresh-independent-identity-and-synthetic-vault',async()=>{
    await start();
    const previous=await app.invoke('config_get',{key:'vaultRoot'});
    assert.ok(previous===null || path.resolve(previous).startsWith(parent+path.sep));
    const configDir=app.configDir;
    assert.equal(await stop(app),0);
    assert.equal(path.basename(configDir),identifier);
    const profile={id:'synthetic-r1r9',name:'R1R9 合成验收库',path:vault,createdAt:1,lastUsedAt:1};
    await writeFile(path.join(configDir,'config.json'),JSON.stringify({vaultRoot:vault,vaultRegistry:{version:1,activeId:profile.id,vaults:[profile]}}));
    await start();
    await expect(app.page.locator('[data-vault-switcher]')).toHaveAttribute('aria-label','当前文件库：R1R9 合成验收库');
    syntheticReady=true;
    await app.page.evaluate(()=>{
      localStorage.setItem('ste-play-guide-seen','1'); localStorage.setItem('ste-tag-migration-v2-notice','1');
      localStorage.setItem('ste-tavern-window-mode','detached');
      for(const module of ['home','cardviewer','worldbook','preset']) localStorage.setItem(`onboarding-${module}-completed@synthetic-r1r9`,'1');
    });
    return {configIdentity:identifier,syntheticOnly:true};
  });
  let storyId;
  await check('import-card-and-open-native-tavern',async()=>{
    const page=app.page;
    await page.getByRole('button',{name:'角色库',exact:true}).first().click();
    const card={spec:'chara_card_v3',spec_version:'3.0',data:{name:'R1R9 合成旅人',description:'Synthetic fixture',personality:'',scenario:'',mes_example:'',extensions:{},first_mes:Array.from({length:85},(_,i)=>`Synthetic opening paragraph ${i}. This is generated test text for native scrolling.`).join('\n\n')}};
    const cardFile=path.join(root,'synthetic-card.json'); await writeFile(cardFile,JSON.stringify(card));
    await page.locator('input[type="file"][accept*=".png"]').setInputFiles(cardFile);
    await page.getByRole('button',{name:'导入 1 张角色卡',exact:true}).click();
    await expect(page.locator('[data-character-id]')).toHaveCount(1);
    await page.locator('[data-character-id]').click();
    await popupAfter(()=>page.getByRole('button',{name:'新开聊天',exact:true}).click());
    await until(()=>popupEval(child=>child.document.querySelector('iframe')?.contentDocument.querySelector('#chat')?.textContent.includes('Synthetic opening paragraph 0.')),60000);
    // Return through the retained real reader entry if new-chat stays on character page.
    if(!/\/chat\?storyId=/.test(page.url())) {
      await page.getByRole('button',{name:'角色库',exact:true}).first().click();
      await page.locator('[data-character-id]').click();
      await page.getByRole('button',{name:'处理',exact:true}).first().click();
    }
    await expect(page).toHaveURL(/\/chat\?storyId=/);
    storyId=new URL(page.url()).searchParams.get('storyId');
    await expect(page.locator('[data-detached-sync-banner]')).toBeVisible();
    const labels=await page.evaluate(async()=> (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).map(win=>win.label));
    assert.ok(labels.some(label=>label.startsWith('tavern-detached-')));
    assert.equal(report.assetFailures.length,0);assert.equal(report.runtimeErrors.length,0);
    return {nativeLabels:labels,cardCount:1,storyCount:1,resourceFailures:0};
  });
  await check('R8-native-help-and-process-modal-scroll',async()=>{
    const observations=[];
    for(const name of ['使用帮助','过程']) {
      await popupClick(name);
      await until(popupDialog);
      const scroll=await assertMainScrolls();
      await popupEval(c=>c.document.dispatchEvent(new c.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
      await until(async()=>!await popupDialog());
      await popupClick(name); await until(popupDialog);
      await popupEval(c=>c.document.querySelector('[data-foreign-dialog-overlay]').dispatchEvent(new c.PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true})));
      await until(async()=>!await popupDialog());
      observations.push({panel:name,mainScroll:scroll,escape:true,overlay:true,childInput:'DOM events in native WebView2; OS keyboard focus not covered'});
    }
    return {observations};
  });
  await check('R1-native-sync-close-and-save-reader-title',async()=>{
    await popupEval(async child=>{
      const frameWindow=child.document.querySelector('iframe').contentWindow;
      const ctx=frameWindow.SillyTavern.getContext();
      const msg={name:'R1R9 合成旅人',is_user:false,is_system:false,send_date:new Date().toISOString(),mes:'Synthetic final native reply',extra:{}};
      ctx.chat.push(msg);ctx.addOneMessage(msg);await ctx.saveChat();await frameWindow.__STE_TAVERN_FLUSH__();
    });
    await expect(app.page.locator('main')).toContainText('Synthetic final native reply');
    await popupEval(c=>c.close());
    await until(()=>popupEval(c=>c.closed));
    await expect(app.page.locator('[data-detached-sync-banner]')).toHaveCount(0);
    const title=app.page.getByRole('button',{name:/^故事名称：/});await expect(title).toBeEnabled();await title.click();
    await app.page.getByRole('textbox',{name:'故事名称',exact:true}).fill('R1R9 原生保存通过');
    await app.page.getByRole('textbox',{name:'故事名称',exact:true}).press('Enter');
    await expect.poll(async()=> (await storyFromDisk()).title).toBe('R1R9 原生保存通过');
    const story=await storyFromDisk();assert.equal(story.session.messages.length,2);
    await expect(app.page.getByText('聊天处理内容尚未保存',{exact:true})).toHaveCount(0);
    return {messageCount:2,titleSaved:true,conflictNotice:false};
  });
  await check('R9-native-draft-dock-without-empty-window',async()=>{
    await popupAfter(()=>app.page.getByRole('button',{name:'继续聊天',exact:true}).click());
    await popupEval(c=>{window.__nativeUnload={count:0,prevented:0};c.addEventListener('beforeunload',e=>{window.__nativeUnload.count++;if(e.defaultPrevented||e.returnValue)window.__nativeUnload.prevented++;});const frame=c.document.querySelector('iframe').contentWindow;const input=frame.document.querySelector('#send_textarea');input.value='Synthetic native saved draft';input.dispatchEvent(new frame.Event('input',{bubbles:true}));});
    await popupClick('收回页内');
    await until(()=>popupEval(c=>c.closed));
    await expect(app.page).toHaveURL(new RegExp(`/play/${storyId}`));
    await expect(app.page.frameLocator('iframe').locator('#send_textarea')).toHaveValue('Synthetic native saved draft');
    await delay(5000);
    const labels=await app.page.evaluate(async()=> (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).map(win=>win.label));
    report.nativeAfterDock=await app.page.evaluate(async()=>Promise.all((await window.__TAURI__.webviewWindow.getAllWebviewWindows()).map(async win=>{try{return {label:win.label,visible:await win.isVisible(),size:await win.innerSize()};}catch(e){return {label:win.label,error:String(e)};}})));
    const unload=await app.page.evaluate(()=>window.__nativeUnload);report.nativeDockUnload=unload;
    assert.deepEqual(labels,['main']);assert.equal(unload.prevented,0);assert.equal(unload.count,1);
    return {beforeUnload:unload,nativeLabels:labels,draftRestored:true};
  });
  await check('native-main-close-and-process-exit',async()=>{
    assert.equal(report.runtimeErrors.length,0);assert.equal(report.assetFailures.length,0);
    const processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'],{windowsHide:true,encoding:'utf8'}));
    const owned=new Set([app.child.pid]);
    for(let previous=-1;previous!==owned.size;){previous=owned.size;for(const p of processes)if(owned.has(p.ParentProcessId))owned.add(p.ProcessId);}
    await app.page.getByRole('button',{name:'关闭窗口',exact:true}).click();
    await until(()=>app.child.exitCode!==null,20000);assert.equal(await app.closed,0);
    let stillListening=false;try{stillListening=(await fetch(`http://127.0.0.1:${app.port}/json/version`,{signal:AbortSignal.timeout(1000)})).ok;}catch{}
    assert.equal(stillListening,false);
    await until(()=>[...owned].every(pid=>{try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}}),20000);
    return {exitCode:0,debugEndpointClosed:true,ownedProcessCount:owned.size,remainingProcesses:0};
  });
  report.status='passed';
}catch(error){
  report.status='failed';report.failure={stage,name:error.name,message:error.message.slice(0,1000),stack:error.stack?.slice(0,1800)};
  if(syntheticReady && app?.page && !app.page.isClosed()) {
    try {report.failureChildState=await popupEval(c=>({exists:!!c,closed:c?.closed,frames:c?.document.querySelectorAll('iframe').length,buttons:[...c?.document.querySelectorAll('button')??[]].map(b=>({text:b.textContent.trim(),disabled:b.disabled})),body:c?.document.body.innerText.slice(0,500)}));}catch(e){report.failureChildState={error:e.message};}
  }
  if(syntheticReady && app?.page && !app.page.isClosed()) await app.page.screenshot({path:path.join(root,'failed-synthetic.png')}).catch(()=>{});
  console.error(`FAIL ${stage}: ${error.message.slice(0,600)}`);process.exitCode=1;
}finally{
  if(app?.child.exitCode===null) {try{await stop(app);}catch{app.child.kill();await app.closed;report.forcedCleanup=true;}}
  await app?.browser?.close().catch(()=>{});
  await save();console.log(`Native evidence: ${root}`);
}
