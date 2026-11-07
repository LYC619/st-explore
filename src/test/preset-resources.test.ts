import { afterEach, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { parsePreset, exportPreset } from '@/lib/preset-parser';
import { getPreset } from '@/lib/preset-db';
import type { PresetItem } from '@/types/preset';
import type { RegexCollectionItem } from '@/types/regex';
import { listPresetEmbeddedScripts, readPresetEmbeddedRegex, updatePresetEmbeddedScript, removePresetEmbeddedScript } from '@/lib/preset-resources';
const script={type:'script',id:'original-script',name:'作者脚本',content:'throw new Error("never run")',enabled:true,info:'作者说明',custom:{retain:true},button:{enabled:true,buttons:[{name:'按钮',visible:true}]}};
async function fixture(){
 const fs=createMemFs(),vault=createVault(fs);setActiveVault(vault);
 const preset:PresetItem={id:'preset',title:'资源预设',createdAt:1,updatedAt:1,preset:parsePreset({prompts:[],prompt_order:[],extensions:{unknown:{keep:true},regex_scripts:[{id:'original-regex',scriptName:'作者正则',findRegex:'hello',replaceString:'world',placement:[2],custom:'keep'}],tavern_helper:{other:'keep',scripts:[{type:'folder',id:'folder',name:'分组',custom:'keep',scripts:[script]}]}}})};
 await vault.repo('presets').put(preset);return{fs,vault,preset};
}
afterEach(()=>setActiveVault(null));
it('reads embedded regex once and reuses an edited library copy instead of overwriting it',async()=>{
 const{fs,vault,preset}=await fixture();const before=JSON.stringify(await getPreset(preset.id));
 const first=await readPresetEmbeddedRegex(preset.id);expect(first.rules[0].id).toBe('original-regex');expect(first.rules[0]._raw?.custom).toBe('keep');
 await vault.repo<RegexCollectionItem>('regexes').put({...first,title:'我的规则副本',rules:first.rules.map(rule=>({...rule,replaceString:'edited'}))});
 const again=await readPresetEmbeddedRegex(preset.id);expect(again.id).toBe(first.id);expect(again.rules[0].replaceString).toBe('edited');
 expect(await vault.repo('regexes').list()).toHaveLength(1);expect(JSON.stringify(await getPreset(preset.id))).toBe(before);
 expect((await createVault(fs).repo<RegexCollectionItem>('regexes').get(first.id))?.rules[0].replaceString).toBe('edited');
});
it('edits only the chosen embedded script while preserving its identity, unknown fields and sibling extension data',async()=>{
 const{preset}=await fixture();const[resource]=listPresetEmbeddedScripts(preset.preset);
 const saved=await updatePresetEmbeddedScript(preset,resource.key,{name:'我的脚本',content:'export const safe = true;',info:'新说明'});
 const raw=JSON.parse(exportPreset(saved.preset));
 expect(raw.extensions.tavern_helper.scripts[0]).toMatchObject({id:'folder',custom:'keep',scripts:[{...script,name:'我的脚本',content:'export const safe = true;',info:'新说明'}]});
 expect(raw.extensions.unknown).toEqual({keep:true});expect(raw.extensions.regex_scripts[0].id).toBe('original-regex');
 expect(JSON.parse(exportPreset(preset.preset)).extensions.tavern_helper.scripts[0].scripts[0]).toEqual(script);
 await expect(updatePresetEmbeddedScript(preset,resource.key,{name:'旧快照',content:'overwrite',info:''})).rejects.toThrow(/变化|修改/);
 const removed=await removePresetEmbeddedScript(saved,resource.key);
 expect(listPresetEmbeddedScripts(removed.preset)).toEqual([]);expect(JSON.parse(exportPreset(removed.preset)).extensions.tavern_helper.scripts[0]).toMatchObject({id:'folder',custom:'keep',scripts:[]});
});
