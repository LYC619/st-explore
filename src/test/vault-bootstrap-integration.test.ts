import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',async original=>({...await original<typeof import('@tauri-apps/api/core')>(),invoke:native.invoke}));
import { bootVault } from '@/lib/vault/bootstrap';
import { getActiveVault, setActiveVault } from '@/lib/vault/active';
import { getCurrentVaultId, setCurrentVaultId } from '@/lib/vault/vault-scope';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { buildCharacterFromCard } from '@/lib/archive-db';
import { loadAPIConfig } from '@/components/ai-tools/api-profiles';

let fs:VaultFs;
let config:Record<string,unknown>;
const path='D:/synthetic-bootstrap-vault';
const profile={id:'synthetic-vault',name:'合成库',path,createdAt:1,lastUsedAt:1};
beforeEach(async()=>{
  localStorage.clear();setActiveVault(null);setCurrentVaultId(null);vi.stubGlobal('__TAURI_INTERNALS__',{});
  fs=createMemFs();await fs.writeText('库信息.json',JSON.stringify({schemaVersion:2}));
  // MemFs treats the empty path as absent; native stat reports the authorized root itself.
  const stat=fs.stat;fs.stat=async relative=>relative===''?{exists:true,isDir:true}:stat(relative);
  config={vaultRegistry:{version:1,activeId:profile.id,vaults:[profile]},vaultRoot:path,apiScopeByVault:{[profile.id]:'vault'},apiProfilesByVault:{[profile.id]:{profiles:JSON.stringify([{id:'synthetic-provider',name:'合成连接',apiKey:'synthetic-only-key',apiUrl:'https://synthetic.invalid/v1/chat/completions',model:'synthetic-local-model'}]),active:'synthetic-provider'}}};
  native.invoke.mockReset();native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>={})=>{
    if(command==='write_diagnostic_event')return;
    if(command==='config_get')return config[String(args.key)]??null;
    if(command==='config_set'){config[String(args.key)]=args.value;return;}
    expect(args.root).toBe(path);
    const file=String(args.path??'');
    if(command==='vault_stat'){const stat=await fs.stat(file);return {exists:stat.exists,is_dir:stat.isDir,size:stat.size};}
    if(command==='vault_list_dir')return (await fs.list(file)).map(e=>({name:e.name,is_dir:e.isDir,is_symlink:!!e.isSymlink,size:e.size}));
    if(command==='vault_read_text')return fs.readText(file);
    if(command==='vault_write_text')return fs.writeText(file,String(args.content));
    if(command==='vault_mkdir')return fs.mkdir(file);
    if(command==='vault_read_binary')return fs.readBinary(file);
    if(command==='vault_write_binary')return fs.writeBinary(file,String(args.base64));
    if(command==='vault_rename')return fs.rename(String(args.from),String(args.to));
    if(command==='vault_remove_file')return fs.removeFile(file);
    if(command==='vault_remove_empty_dir')return fs.removeEmptyDir(file);
    throw new Error(`Unimplemented synthetic platform command: ${command}`);
  });
  vi.spyOn(console,'warn').mockImplementation(()=>{});
});
afterEach(()=>{setActiveVault(null);setCurrentVaultId(null);vi.unstubAllGlobals();vi.restoreAllMocks();});

it('boots through the real registry, scope, sensitive configuration, filesystem bridge and repository',async()=>{
  const character=buildCharacterFromCard({name:'合成启动角色',description:'合成内容'});await createVault(fs).repo('characters').put(character);
  const state=await bootVault();
  expect(vi.mocked(console.warn).mock.calls).toEqual([]);
  expect(state).toBe('ready');
  expect(getCurrentVaultId()).toBe(profile.id);expect(loadAPIConfig()).toMatchObject({model:'synthetic-local-model',apiKey:'synthetic-only-key'});
  expect(await getActiveVault()!.repo('characters').get(character.id)).toMatchObject({id:character.id,name:'合成启动角色'});
  const reads=native.invoke.mock.calls.filter(([command])=>command==='config_get').map(([,args])=>args.key);
  expect(reads).toContain('apiProfilesByVault');expect(reads).not.toContain('apiProfiles');
});
it('an unavailable library reaches the unset state without activating a backend',async()=>{
  const original=fs.stat;fs.stat=async relative=>relative===''?{exists:false,isDir:false}:original(relative);
  await expect(bootVault()).resolves.toBe('unset');expect(getActiveVault()).toBeNull();
  expect(loadAPIConfig()).toMatchObject({model:'synthetic-local-model'});
});
it('a corrupt system configuration reaches repair through the actual error classifier',async()=>{
  native.invoke.mockImplementation(async(command:string)=>{if(command==='write_diagnostic_event')return;throw 'STE_CONFIG_INVALID:synthetic';});
  await expect(bootVault()).resolves.toBe('repair');expect(getActiveVault()).toBeNull();
});
