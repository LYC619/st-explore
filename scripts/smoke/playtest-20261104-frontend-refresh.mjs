import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const out='.cache/1104-frontend',base='http://127.0.0.1:4214';
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const nav=path=>page.evaluate(path=>{history.pushState(null,'',path);dispatchEvent(new PopStateEvent('popstate'));},path);
try {
 await page.goto(base+'/settings');await page.getByRole('button',{name:'显示',exact:true}).waitFor();
 const id=await page.evaluate(async helper=>{
  const db=await import('/src/lib/archive-db.ts');
  await db.saveRoleplayPreferences({installedTavernHelper:(await import('/src/lib/roleplay/tavern-helper-package.ts')).readTavernHelperZip(new Uint8Array(helper))});
  localStorage.setItem('ste-play-guide-seen','1');
  (await import('/src/components/ai-tools/api-profiles.ts')).persistProfiles([{id:'test',name:'夹具',model:'fixture',apiUrl:'https://example.invalid/completion',apiKey:''}],'test');
  const card=db.buildCharacterFromCard({spec:'chara_card_v3',data:{name:'无内嵌正则',first_mes:'你好'}});await db.saveCharacter(card);
  const story=db.buildStoryFromSession({id:'refresh',title:'前端刷新回归',createdAt:1,user:{name:'旅人'},character:{name:card.name},messages:[{id:'m',role:'assistant',content:'你好'}]},card.id);await db.saveArchiveStory(story);return story.id;
 },Array.from(await readFile('.cache/helper.zip')));
 await nav('/beautify');await page.locator('#beautify-story').selectOption(id);await page.getByRole('button',{name:'新建 HTML',exact:true}).click();
 await page.locator('#frontend-find').fill('$');
 const html=text=>'\n\n```html\n<!DOCTYPE html><html><body><div>'+text+'</div></body></html>\n```\n\n';
 await page.locator('#frontend-html').fill(html('初次前端'));
 await page.getByRole('button',{name:'应用到当前故事／分支',exact:true}).click();await expect(page.getByText('已有应用内容',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'进入聊天',exact:true}).click();
 const tavern=page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
 await expect(tavern.frameLocator('#chat iframe').first().locator('body')).toContainText('初次前端',{timeout:60000});
 await expect(page.getByRole('button',{name:'过程',exact:true})).toBeEnabled();
 await tavern.locator('#send_textarea').click();await tavern.locator('#send_textarea').pressSequentially('保留未发送输入',{delay:80});await expect(tavern.locator('#send_textarea')).toHaveValue('保留未发送输入');
 await nav('/beautify');await page.getByRole('button',{name:'重新载入',exact:true}).click();await expect(page.locator('#frontend-html')).toHaveValue(/初次前端/);
 const beforeEdit=await page.evaluate(async id=>{const db=await import('/src/lib/archive-db.ts');return {session:(await db.getArchiveStory(id)).session,preferences:await db.getRoleplayPreferences()};},id);
 await page.locator('#frontend-html').fill(html('修改后前端'));
 await page.getByRole('button',{name:'应用到当前故事／分支',exact:true}).click();await writeFile(out+'/refresh-changes.json',JSON.stringify(await page.evaluate(async({id,before})=>{const db=await import('/src/lib/archive-db.ts'),after={session:(await db.getArchiveStory(id)).session,preferences:await db.getRoleplayPreferences()};const changes=[];const diff=(a,b,p='')=>{if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],p+'.'+k);}else changes.push(p);};diff(before,after);return changes;},{id,before:beforeEdit}),null,2));
 await expect(page.getByText('有未保存修改',{exact:false})).toHaveCount(0);
 await page.getByRole('button',{name:'进入聊天',exact:true}).click();
 await expect(tavern.frameLocator('#chat iframe').first().locator('body')).toContainText('修改后前端',{timeout:30000});
 await expect(tavern.locator('#send_textarea')).toHaveValue('保留未发送输入');
 await page.reload();await expect(tavern.frameLocator('#chat iframe').first().locator('body')).toContainText('修改后前端',{timeout:60000});
 await writeFile(out+'/refresh-result.json',JSON.stringify({passed:['原卡无正则时首次聊天正常渲染','美化修改应用后返回常驻聊天立即更新','未发送输入保留','完整刷新恢复应用HTML'],errors},null,2));
 console.log('frontend refresh passed');
} catch(error) {
 const f=page.frames().find(f=>f.url().includes('tavern.html'));
 await writeFile(out+'/refresh-failure.json',JSON.stringify({message:error.message,errors,alerts:await page.locator('[role=alert]').allTextContents(),state:await f?.evaluate(()=>({html:document.querySelector('#chat')?.innerHTML,allowed:window.__STE_ALLOWED_FRONTEND_REGEX__?.(),helper:typeof window.TavernHelper,frames:[...document.querySelectorAll('iframe')].map(f=>f.id)}))},null,2));
 throw error;
} finally {await browser.close();}
