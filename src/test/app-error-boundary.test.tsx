import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createMemFs} from '@/lib/vault/fs';
import {createVault} from '@/lib/vault/vault-backend';
import {setActiveVault} from '@/lib/vault/active';
const fault=vi.hoisted(()=>({home:true,reported:vi.fn()}));
// Deliberately failing leaf, with the actual App/router/chrome/storage collaborators.
vi.mock('@/pages/Home',()=>({default:()=>{if(fault.home)throw new Error('synthetic-render-failure');return <h1>合成首页</h1>;}}));
vi.mock('@/pages/Tools',async()=>{
  const {lazy,createElement}=await import('react');
  const FailedChunk=lazy(()=>Promise.reject(new TypeError('Failed to fetch dynamically imported module: synthetic-chunk')));
  return {default:()=>createElement(FailedChunk)};
});
vi.mock('@/lib/diagnostics',async original=>({...await original<typeof import('@/lib/diagnostics')>(),reportError:fault.reported}));
import App from '@/App';
import {AppErrorBoundary} from '@/components/AppErrorBoundary';

let root:Root|undefined;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(async()=>{
  localStorage.clear();sessionStorage.clear();history.replaceState({},'','/');
  fault.home=true;fault.reported.mockClear();
  vi.spyOn(console,'error').mockImplementation(()=>{});
  vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  const fs=createMemFs();await fs.writeText('库信息.json',JSON.stringify({schemaVersion:2}));setActiveVault(createVault(fs));
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);
});

it('catches a rejected lazy page and offers reload while keeping navigation',async()=>{
  fault.home=false;history.replaceState({},'','/tools');
  await act(async()=>root!.render(<App/>));
  await settle(()=>expect(document.body).toHaveTextContent('页面资源加载失败'));
  expect([...document.querySelectorAll('button')].some(b=>b.textContent==='重新加载')).toBe(true);
  expect([...document.querySelectorAll('button')].some(b=>b.textContent?.trim()==='角色库')).toBe(true);
  expect(document.querySelector('[data-app-error]')).not.toHaveTextContent('synthetic-chunk');
  expect(fault.reported).toHaveBeenCalledTimes(1);
});

it('recovers an application-level throw even when the thrown value is null',async()=>{
  function BrokenRoot(){if(fault.home)throw null;return <div>应用已恢复</div>;}
  await act(async()=>root!.render(<AppErrorBoundary><BrokenRoot/></AppErrorBoundary>));
  expect(document.querySelector('[data-app-error]')).not.toBeNull();
  expect(fault.reported).toHaveBeenCalledTimes(1);
  fault.home=false;
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='重试')!.click());
  expect(document.body).toHaveTextContent('应用已恢复');
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML='';setActiveVault(null);vi.restoreAllMocks();});
async function settle(check:()=>void){await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});check();});}

it('keeps the real navigation after a route rendering error and can retry',async()=>{
  await act(async()=>root!.render(<App/>));
  await settle(()=>expect(document.querySelector('[data-app-error]')).not.toBeNull());
  expect(document.body).toHaveTextContent('当前页面暂时无法显示');
  expect([...document.querySelectorAll('button')].some(b=>b.textContent?.trim()==='角色库')).toBe(true);
  expect(fault.reported).toHaveBeenCalledTimes(1);
  fault.home=false;
  const retry=[...document.querySelectorAll('button')].find(b=>b.textContent==='重试')!;
  await act(async()=>retry.click());
  await settle(()=>expect(document.body).toHaveTextContent('合成首页'));
  expect(document.querySelector('[data-app-error]')).toBeNull();
});
