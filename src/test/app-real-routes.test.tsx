import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import App from '@/App';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { setCurrentVaultId } from '@/lib/vault/vault-scope';
import { buildCharacterFromCard, buildStoryFromSession } from '@/lib/archive-db';
import { clearToastsForModal } from '@/hooks/use-toast';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let vault: ReturnType<typeof createVault>;
let errors: unknown[][];
// Load real route modules before per-route assertions. Cold compilation of the entire
// app belongs to setup, not to a five-second interaction deadline. Nothing is mocked.
beforeAll(async () => {
  const modules = import.meta.glob('../pages/{Home,ChatHub,Index,Tools,Library,CharacterPage,StoryWorkspace,SettingsPage,WorldBook,AssetLibrary,CardViewer,Preset,PresetLibrary,RegexTool,Beautify,NotFound,GalPlay,WorldPlay,PresetDetail,Roleplay}.tsx');
  await Promise.all(Object.values(modules).map(load => load()));
}, 30000);
beforeEach(async () => {
  localStorage.clear();sessionStorage.clear();clearToastsForModal();setCurrentVaultId(null);
  const fs=createMemFs();await fs.writeText('库信息.json',JSON.stringify({schemaVersion:2}));vault=createVault(fs);setActiveVault(vault);
  vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});
  vi.stubGlobal('IntersectionObserver',class {observe(){}unobserve(){}disconnect(){}});
  vi.stubGlobal('fetch',vi.fn(async (input:RequestInfo | URL) => {
    if(input==='/ste/tavern-defaults.json')return new Response(JSON.stringify({}),{status:200,headers:{'Content-Type':'application/json'}});
    throw new Error('Unexpected synthetic-test network request');
  }));
  vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  HTMLElement.prototype.scrollTo=()=>{};Element.prototype.scrollIntoView=()=>{};
  Element.prototype.hasPointerCapture=()=>false;Element.prototype.setPointerCapture=()=>{};Element.prototype.releasePointerCapture=()=>{};
  errors=[];vi.spyOn(console,'error').mockImplementation((...args: unknown[])=>{errors.push(args);});
});
afterEach(async () => {if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML='';setActiveVault(null);setCurrentVaultId(null);clearToastsForModal();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function renderRoute(path:string) {
  history.replaceState({},'',path);
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>{root!.render(<App/>);});
  await act(async()=>{await vi.dynamicImportSettled();});
  await vi.waitFor(async()=>{
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
    expect(document.querySelector('[data-app-error]')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    const content=document.querySelector('main')?.textContent ?? document.body.textContent;
    expect(content?.trim().length).toBeGreaterThan(0);
    expect(content?.trim()).not.toMatch(/^正在(?:打开|加载)/);
  });
}

// Each concrete branch in App.tsx, including redirects, missing-record handling and wildcard.
const routes=['/','/play','/play/synthetic-missing','/worlds','/worlds/synthetic-missing','/gal/synthetic-missing','/library','/character/synthetic-missing','/story/synthetic-missing','/tools','/chat','/assets','/worldbook','/card-viewer','/preset','/presets','/presets/synthetic-missing','/regex','/beautify','/settings','/ai-tools','/synthetic-not-found'];
it.each(routes)('renders the actual route %s on an empty synthetic library',async path=>{
  await renderRoute(path);
  expect(errors).toEqual(path==='/synthetic-not-found' ? [['404 Error: User attempted to access non-existent route:',path]] : []);
  expect(vi.mocked(fetch).mock.calls.every(([input])=>input==='/ste/tavern-defaults.json')).toBe(true);
  if(path==='/ai-tools')expect(location.pathname).toBe('/settings');
});

it('renders CharacterPage with real info, rating, story and asset children across every tab',async()=>{
  const character=buildCharacterFromCard({name:'合成角色',description:'合成简介',first_mes:'合成开场白'});
  const story=buildStoryFromSession({id:'synthetic-story',title:'合成故事',createdAt:1,character:{name:'合成角色'},user:{name:'合成用户'},messages:[{id:'m1',role:'assistant',content:'合成楼层',rawData:{}}]},character.id);
  await vault.repo('characters').put(character);await vault.repo('archiveStories').put(story);
  await renderRoute(`/character/${character.id}`);
  expect(document.querySelector('[data-character-info-rail]')).not.toBeNull();
  expect(document.body.textContent).toContain('合成故事');
  const labels=['故事','备注','关联资产','立绘','角色卡编辑','开场白'];
  for(const label of labels){
    const tab=[...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(el=>el.textContent?.trim().startsWith(label));
    expect(tab).toBeTruthy();await act(async()=>{tab!.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));});
    expect(tab).toHaveAttribute('aria-selected','true');
    expect(document.querySelector('[data-app-error]')).toBeNull();
    expect(document.querySelector('[role="tabpanel"][data-state="active"]')?.textContent?.trim().length).toBeGreaterThan(0);
  }
  const rating=[...document.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent?.trim()==='未评分');
  expect(rating).toBeTruthy();await act(async()=>rating!.click());
  expect(document.querySelector('[role="dialog"]')).toHaveTextContent('评分「合成角色」');
  expect(errors).toEqual([]);expect(fetch).not.toHaveBeenCalled();
});
