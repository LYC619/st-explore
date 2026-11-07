import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatWorkbench } from '@/components/chat/ChatWorkbench';
import { getDefaultExportSettings } from '@/lib/session-storage';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root: Root;
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';vi.unstubAllGlobals();});
it('keeps appearance, search, floor menu, centered title in order and retains extra actions on compact screens',async()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 const originalWidth=window.innerWidth;Object.defineProperty(window,'innerWidth',{value:390,configurable:true});
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);
 try {
  await act(async()=>root.render(<ChatWorkbench session={{id:'toolbar',title:'非常长的故事名'.repeat(20),messages:[],character:{name:'角色'},user:{name:'我'},createdAt:1}} markers={[]} favorites={[]} settings={getDefaultExportSettings()} onFavoritesChange={()=>{}} onSettingsChange={()=>{}} toolbarExtras={<button>小说视图</button>} />));
  const toolbar=host.querySelector('[data-chat-toolbar]')!;
  const appearance=[...toolbar.querySelectorAll('button')].find(n=>n.textContent==='外观')!;
  const title=toolbar.querySelector('[data-chat-story-name]')!;
  const floor=[...toolbar.querySelectorAll('button')].find(n=>n.textContent==='楼层处理')!;
  const search=toolbar.querySelector('[aria-label="搜索消息正文"]')!;
  for(const [a,b] of [[appearance,search],[search,floor],[floor,title]])expect(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(toolbar.textContent).toContain('小说视图');expect(toolbar.textContent).toContain('导出');
  await act(async()=>floor.click());
  expect(document.querySelector('label')?.textContent).toContain('显示已隐藏楼层');
  expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
 } finally {Object.defineProperty(window,'innerWidth',{value:originalWidth,configurable:true});}
});
