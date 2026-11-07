import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.STE_SMOKE_URL||'http://127.0.0.1:4212',out=process.env.STE_SMOKE_OUTPUT||'.cache/playtest-20261031';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
await page.route(/https:\/\//,r=>r.abort());
try {
 await page.goto(base+'/presets');await page.getByRole('button',{name:'导入预设',exact:true}).first().click();
 await page.getByLabel('选择预设和附带文件').setInputFiles({name:'生产检验-Gemini-v1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({prompts:[{identifier:'main',name:'主提示词',role:'system',content:'生产内容'}],prompt_order:[],extensions:{regex_scripts:[{id:'r',scriptName:'生产正则',findRegex:'hidden',replaceString:'',placement:[2],disabled:false}]}}))});
 await page.getByLabel('作者',{exact:true}).fill('检验作者');await page.getByLabel('适配模型',{exact:true}).fill('gemini3.1，gemini3.8');
 await page.getByRole('button',{name:'导入 1 份预设',exact:true}).click();await page.getByRole('button',{name:'查看详情',exact:true}).click();
 const aside=page.getByRole('complementary',{name:'预设信息',exact:true});
 await expect(aside.getByRole('button',{name:'移除适配型号 gemini3.1',exact:true})).toBeVisible();await expect(aside.getByRole('button',{name:'移除适配型号 gemini3.8',exact:true})).toBeVisible();
 await aside.getByLabel('名称',{exact:true}).fill('生产页面直接编辑');await page.getByRole('button',{name:'保存资料',exact:true}).click();
 await page.reload();await expect(aside.getByLabel('名称',{exact:true})).toHaveValue('生产页面直接编辑');
 await expect(page.getByLabel('当前版本',{exact:true})).toHaveText('v1');await expect(page.getByRole('button',{name:/切换预设版本，当前/})).toHaveCount(0);
 await page.getByRole('tab',{name:'笔记',exact:true}).click();await page.getByRole('button',{name:'编辑笔记',exact:true}).click();
 await page.getByLabel('预设笔记正文',{exact:true}).fill('# 生产笔记\n\n刷新后仍保留');await page.getByRole('button',{name:'保存笔记',exact:true}).click();
 await page.reload();await page.getByRole('tab',{name:'笔记',exact:true}).click();await expect(page.getByText('刷新后仍保留',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'内容',exact:true}).click();await page.getByRole('button',{name:'读取到正则库并管理',exact:true}).click();
 await expect(page).toHaveURL(/\/regex/);await expect(page.getByText('生产正则',{exact:true}).first()).toBeVisible();
 expect(requests.filter(url=>url.includes('/src/'))).toEqual([]);expect(errors).toEqual([]);
 const result={passed:['生产dist真实导入、左侧直接编辑及刷新恢复','具体型号和笔记IndexedDB持久化','顶部版本导航与真实正则工具交接'],errors,sourceRequests:0};
 await page.screenshot({path:out+'/production-regex.png'});await writeFile(out+'/production-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(e){await page.screenshot({path:out+'/production-failure.png',fullPage:true});await writeFile(out+'/production-failure.txt',(await page.locator('body').innerText()).slice(0,12000));throw e;}finally{await browser.close();}
