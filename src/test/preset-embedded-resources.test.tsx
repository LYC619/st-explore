import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PresetEmbeddedResources } from '@/components/preset/PresetEmbeddedResources';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { parsePreset, exportPreset } from '@/lib/preset-parser';
import { getPreset } from '@/lib/preset-db';
import type { PresetItem } from '@/types/preset';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root;
afterEach(async()=>{await act(async()=>root?.unmount());setActiveVault(null);document.body.innerHTML='';});
const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!;
async function click(text:string){await act(async()=>button(text).click());}
async function input(label:string,value:string){await act(async()=>{const node=document.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});}
it('reads the library copy and manages a script through real persistence and discard protection',async()=>{
 const fs=createMemFs(),vault=createVault(fs);setActiveVault(vault);
 const item:PresetItem={id:'p',title:'预设资源',createdAt:1,updatedAt:1,preset:parsePreset({prompts:[],prompt_order:[],extensions:{regex_scripts:[{id:'r',scriptName:'内嵌正则',findRegex:'a',replaceString:'b',placement:[2]}],tavern_helper:{scripts:[{type:'script',id:'script',name:'脚本A',info:'说明',content:'throw new Error("never run")',custom:{keep:true},enabled:false}]}}})};
 await vault.repo('presets').put(item);
 const opened=vi.fn(),dirty=vi.fn();
 function Fixture(){const[preset,setPreset]=useState(item);return <PresetEmbeddedResources preset={preset} onChanged={setPreset} onOpenRegex={opened} onDirty={dirty}/>;}
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<Fixture/>));
 await click('读取到正则库并管理');expect(opened).toHaveBeenCalledTimes(1);expect(await vault.repo('regexes').get(opened.mock.calls[0][0])).toMatchObject({rules:[{id:'r'}]});
 await click('管理脚本 · 脚本A');await input('内嵌脚本源码','new script content');expect(dirty).toHaveBeenLastCalledWith(true);
 await click('关闭');expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('放弃未保存的修改');
 await click('返回继续整理');expect(document.querySelector<HTMLTextAreaElement>('[aria-label="内嵌脚本源码"]')?.value).toBe('new script content');
 await click('保存内嵌脚本');expect(document.querySelector('[role="dialog"]')).toBeNull();expect(dirty).toHaveBeenLastCalledWith(false);
 const saved=await getPreset('p');expect(JSON.parse(exportPreset(saved!.preset)).extensions.tavern_helper.scripts[0]).toMatchObject({id:'script',content:'new script content',custom:{keep:true},enabled:false});
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="移除内嵌脚本 脚本A"]')!.click());
 await click('确认删除');expect(JSON.parse(exportPreset((await getPreset('p'))!.preset)).extensions.tavern_helper.scripts).toEqual([]);
});
