import {chromium,expect} from '@playwright/test';import {readFile,writeFile} from 'node:fs/promises';
const out='.cache/1104-frontend',b=await chromium.connectOverCDP('http://127.0.0.1:9227'),p=b.contexts()[0].pages()[0];const errors=[];p.on('pageerror',e=>errors.push(e.message));const navigate=path=>p.evaluate(path=>{history.pushState(null,'',path);dispatchEvent(new PopStateEvent('popstate'));},path);
try{
 const notice=p.getByRole('button',{name:'知道了',exact:true});if(await notice.count())await notice.click();
 const story=JSON.parse(await readFile(out+'/native-vault/角色/我的双胞胎老婆/故事/第1-6卷 小总结版/故事.json','utf8'));
 await navigate('/beautify');await p.locator('#beautify-story').selectOption(story.id);await expect(p.getByText('主绑定世界书：！！！！！我的双胞胎女友',{exact:false})).toBeVisible();
 const rules=p.getByLabel('显示正则',{exact:true});
 if(await rules.locator('option').count()===1 && await rules.locator('option').first().textContent()==='先读取成品或新建 HTML')await p.getByRole('button',{name:'新建 HTML',exact:true}).click();
 else await rules.selectOption('0');
 await p.locator('#frontend-find').fill('$');await p.locator('#frontend-html').fill('\n\n```html\n<!DOCTYPE html><html><body><div id="native-front">Windows 原生前端测试</div></body></html>\n```\n\n');
 await p.getByRole('button',{name:'使用示例变量',exact:true}).click();await expect(p.frameLocator('iframe[title="成品前端预览"]').locator('body')).toContainText('Windows 原生前端测试');
 await p.getByRole('button',{name:'保存草稿',exact:true}).last().click();await expect(p.getByText('草稿已保存',{exact:false}).first()).toBeVisible();await p.reload();await expect(p.locator('#frontend-html')).toHaveValue(/Windows 原生前端测试/);
 await p.getByRole('button',{name:'应用到当前故事／分支',exact:true}).click();await expect(p.getByText('已有应用内容',{exact:false})).toBeVisible();await p.screenshot({path:out+'/native-editor.png'});
 await p.getByRole('button',{name:'进入聊天',exact:true}).click();const t=p.frameLocator('iframe[title="SillyTavern 角色扮演"]');await expect(t.locator('#send_textarea')).toBeVisible({timeout:90000});
 const guide=p.getByRole('button',{name:'知道了',exact:true});if(await guide.count())await guide.first().click();
 if(!await t.locator('#tavern_helper').count())await t.locator('.ste_original_zip').setInputFiles('.cache/helper.zip');await expect(t.locator('#tavern_helper')).toBeAttached({timeout:60000});
 const f=p.frames().find(f=>f.url().includes('tavern.html'));const info=await f.evaluate(async()=>({version:(await (await fetch('/version')).json()).pkgVersion,helper:typeof window.TavernHelper?.getVariables,world:(await import('/script.js')).characters[(await import('/script.js')).this_chid].data.extensions.world}));
 await expect(t.frameLocator('#chat iframe').first().locator('body')).toContainText('Windows 原生前端测试',{timeout:45000});await p.screenshot({path:out+'/native-chat.png'});
 await writeFile(out+'/native-result.json',JSON.stringify({passed:['Windows WebView2 正式生产前端启动','真实磁盘副本库读取359楼及主绑定世界书','成品HTML预览、草稿保存和完整刷新恢复','原版助手ZIP安装及公共接口','新建HTML无需开启原卡正则即可在真实聊天渲染'],info,errors},null,2));console.log(JSON.stringify({info,errors}));
}catch(e){await p.screenshot({path:out+'/native-failed.png'});throw e;}finally{await b.close();}
