import { afterEach, expect, it } from 'vitest';
import { createVault } from '@/lib/vault/vault-backend';
import { createMemFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { parsePreset, exportPreset } from '@/lib/preset-parser';
import type { PresetItem } from '@/types/preset';
import { organizePresetFolders } from '@/lib/preset-db';
import { normalizePresetCatalog } from '@/lib/preset-catalog';
const preset = (id: string, series = '星海'): PresetItem => ({ id, title: '同名预设', preset: parsePreset({ prompts: [], prompt_order: [], custom: 'keep' }), catalog: { series, models: ['gemini3.1', 'gemini3.8'] }, createdAt: 1, updatedAt: 1 });
afterEach(() => setActiveVault(null));
it('stores versions under series folders, preserves collisions and moves only the edited version', async () => {
 const fs=createMemFs(), vault=createVault(fs); setActiveVault(vault);
 await vault.repo<PresetItem>('presets').put(preset('a')); await vault.repo<PresetItem>('presets').put(preset('b'));
 expect(await vault.pathOf('presets','a')).toBe('资产/预设/星海/同名预设.json');
 expect(await vault.pathOf('presets','b')).toBe('资产/预设/星海/同名预设·2.json');
 await vault.repo<PresetItem>('presets').put(preset('a','新系列'));
 expect(await vault.pathOf('presets','a')).toBe('资产/预设/新系列/同名预设.json');
 const restarted=createVault(fs); expect(await restarted.repo('presets').list()).toHaveLength(2);
 expect(await restarted.repo('presets').get('a')).toEqual(preset('a','新系列'));
});
it('evicts externally deleted cached files and permits deleting a ghost record', async () => {
 const fs=createMemFs(), vault=createVault(fs); setActiveVault(vault);
 await vault.repo<PresetItem>('presets').put(preset('a')); await vault.repo('presets').get('a'); await vault.repo('presets').listLight();
 await fs.removeFile((await vault.pathOf('presets','a'))!);
 expect(await vault.repo('presets').listLight()).toEqual([]);
 expect(await vault.repo('presets').get('a')).toBeUndefined();
 await expect(vault.repo('presets').remove('a',{deleteFiles:false})).resolves.toBeUndefined();
});
it('refreshes external additions and moves while retaining compatibility with flat legacy paths', async () => {
 const fs=createMemFs(), vault=createVault(fs); setActiveVault(vault);
 await vault.repo('presets').listLight();
 const item=preset('external'); await fs.writeText('资产/预设/旧扁平.json',JSON.stringify({...JSON.parse(exportPreset(item.preset)),__ste:{...item,preset:undefined}}));
 await vault.refreshAssets?.('presets');
 expect((await vault.repo('presets').listLight()).map(v=>v.id)).toEqual(['external']);
 await fs.rename('资产/预设/旧扁平.json','资产/预设/自建系列/旧扁平.json');
 await vault.refreshAssets?.('presets');
 expect(await vault.pathOf('presets','external')).toBe('资产/预设/自建系列/旧扁平.json');
 expect((await vault.repo<PresetItem>('presets').get('external'))?.catalog?.models).toEqual(['gemini3.1','gemini3.8']);
 expect(normalizePresetCatalog({models:['gemini3.1','gemini3.8']}).models).toEqual(['gemini3.1','gemini3.8']);
});


it('explicitly organizes old flat files, keeps colliding versions and leaves strays alone', async () => {
 const fs=createMemFs();
 for(const id of ['old-a','old-b']) {
   const item=preset(id);
   await fs.writeText(`资产/预设/${id}.json`,JSON.stringify({...JSON.parse(exportPreset(item.preset)),__ste:{...item,preset:undefined}}));
 }
 await fs.writeText('资产/预设/用户说明.txt','mine');
 const vault=createVault(fs); setActiveVault(vault);
 expect(await vault.pathOf('presets','old-a')).toBe('资产/预设/old-a.json');
 const result=await organizePresetFolders();
 expect(result).toEqual({moved:2,unchanged:0,failed:[]});
 expect(await vault.pathOf('presets','old-a')).toBe('资产/预设/星海/同名预设.json');
 expect(await vault.pathOf('presets','old-b')).toBe('资产/预设/星海/同名预设·2.json');
 expect(await vault.repo('presets').get('old-a')).toEqual(preset('old-a'));
 expect(await fs.readText('资产/预设/用户说明.txt')).toBe('mine');
 expect(await organizePresetFolders()).toEqual({moved:0,unchanged:2,failed:[]});
});


it('keeps the original readable when one series move fails and retries without overwriting the other version', async () => {
 const disk=createMemFs(); let fail=true;
 const fs={...disk, rename: async (from:string,to:string) => {
   if(fail && to==='资产/预设/星海/同名预设.json') { fail=false; throw new Error('disk offline'); }
   await disk.rename(from,to);
 }};
 for(const id of ['old-a','old-b']) {
   const item=preset(id);
   await disk.writeText(`资产/预设/${id}.json`,JSON.stringify({...JSON.parse(exportPreset(item.preset)),__ste:{...item,preset:undefined}}));
 }
 const vault=createVault(fs); setActiveVault(vault);
 const result=await organizePresetFolders();
 expect(result.moved).toBe(1); expect(result.failed).toHaveLength(1); expect(result.failed[0]).toContain('disk offline');
 expect(await vault.repo('presets').get('old-a')).toEqual(preset('old-a'));
 expect(await vault.pathOf('presets','old-a')).toBe('资产/预设/old-a.json');
 expect(await organizePresetFolders()).toEqual({moved:1,unchanged:1,failed:[]});
 const restarted=createVault(disk); expect(await restarted.repo('presets').list()).toHaveLength(2);
 for(const id of ['old-a','old-b']) expect(await restarted.repo('presets').get(id)).toEqual(preset(id));
});
