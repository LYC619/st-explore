import { afterEach, expect, it } from 'vitest';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession } from '@/lib/archive-db';
it('recovers a failed rollback before retrying deletion in the same vault session', async () => {
 const disk=createMemFs(); let broken=false, moves=0;
 const fs: VaultFs={...disk, rename: async (from,to)=>{
   if(broken && (to.includes('/files/') && ++moves===2 || from.includes('/files/'))) throw new Error('device offline');
   await disk.rename(from,to);
 }};
 const vault=createVault(fs); setActiveVault(vault);
 const character={...buildStoryFromSession({id:'session', title:'重试', messages:[], character:{name:'c'}, user:{name:'u'}, createdAt:1}), id:'retry'};
 await vault.repo('archiveStories').put(character);
 broken=true;
 await expect(vault.repo('archiveStories').remove(character.id,{deleteFiles:false})).rejects.toThrow('恢复未完成');
 broken=false;
 await vault.repo('archiveStories').remove(character.id,{deleteFiles:false});
 const restarted=createVault(disk);
 expect(await restarted.repo('archiveStories').get(character.id)).toBeUndefined();
});
afterEach(()=>setActiveVault(null));
