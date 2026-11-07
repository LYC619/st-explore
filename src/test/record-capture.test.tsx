import { afterEach, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession } from '@/lib/archive-db';
import { captureRecord } from '@/lib/record-capture';
import type { SummaryItem } from '@/types/summary';

afterEach(() => setActiveVault(null));
it('captures a stable saved source once, separates coverage from its floor, and preserves diary perspective', async () => {
  const vault = createVault(createMemFs()); setActiveVault(vault);
  const story = buildStoryFromSession({ id: 's', title: '原故事', character: { name: '多人卡' }, user: { name: 'u' }, createdAt: 1,
    messages: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, role: 'assistant', content: `正文${i}` })) });
  await vault.repo('archiveStories').put(story);
  const input = { recordId: 'capture-one', storyId: story.id, branchId: null, messageId: 'm11', kind: 'diary' as const,
    content: '修剪后的日记', title: '日记', diaryOwner: '乔伊', range: { start: 0, end: 9 } };
  const result = await captureRecord(input); await captureRecord(input);
  expect(result).toMatchObject({ floorStart: 0, floorEnd: 9, diaryOwner: '乔伊', source: { messageId: 'm11', floor: 11 }, bookId: story.id });
  expect(await vault.repo<SummaryItem>('summaries').list()).toHaveLength(1);
  await expect(captureRecord({ ...input, recordId: 'bad', messageId: 'missing' })).rejects.toThrow(/来源/);
  await expect(captureRecord({ ...input, recordId: 'bad', branchId: 'missing' })).rejects.toThrow(/分支/);
  const noRange = await captureRecord({ ...input, recordId: 'capture-two', range: undefined });
  expect(noRange.rangeDetached).toBe(true);
  const pasted = await captureRecord({ ...input, recordId: 'capture-three', messageId: undefined, range: undefined });
  expect(pasted.rangeDetached).toBe(false);
  expect(pasted).toMatchObject({ floorStart: 0, floorEnd: 11 });
});

it('captures into character notes without replacing notes or changing story content, and is idempotent', async () => {
  const { captureCharacterNote } = await import('@/lib/record-capture');
  const { buildCharacterFromCard, getCharacter } = await import('@/lib/archive-db');
  const fs = createMemFs(), vault = createVault(fs); setActiveVault(vault);
  const character = { ...buildCharacterFromCard({ name: '备注角色' }), notes: [{ id: 'old', body: '已有备注', at: 1 }] };
  await vault.repo('characters').put(character);
  const story = buildStoryFromSession({ id: 's', title: '备注来源', character: { name: '角色' }, user: { name: 'u' }, createdAt: 1,
    messages: [{ id: 'm', role: 'assistant', content: '原文' }] }, character.id);
  await vault.repo('archiveStories').put(story);
  const before = JSON.stringify(await vault.repo('archiveStories').get(story.id));
  const input = { recordId: 'note', storyId: story.id, branchId: null, messageId: 'm', content: '选中的摘录', title: '新备注', expectedSource: '原文' };
  await captureCharacterNote(input); await captureCharacterNote(input);
  const saved = await getCharacter(character.id);
  expect(saved!.notes).toHaveLength(2);
  expect(saved!.notes!.find(note => note.id === 'old')!.body).toBe('已有备注');
  expect(saved!.notes!.find(note => note.id === 'note')!.body).toContain('选中的摘录');
  expect(JSON.stringify(await vault.repo('archiveStories').get(story.id))).toBe(before);
  await expect(captureCharacterNote({ ...input, recordId: 'wrong', expectedSource: '旧原文' })).rejects.toThrow(/修改/);
  await vault.repo<import('@/types/archive').ArchiveStory>('archiveStories').put({ ...story, characterId: undefined });
  await expect(captureCharacterNote({ ...input, recordId: 'unbound' })).rejects.toThrow(/绑定角色/);
});

it('can capture a note while another operation holds the source story queue', async () => {
  const {captureCharacterNote}=await import('@/lib/record-capture');
  const {buildCharacterFromCard,withArchiveStoryLock}=await import('@/lib/archive-db');
  const vault=createVault(createMemFs());setActiveVault(vault);
  const character=buildCharacterFromCard({name:'并发备注'});await vault.repo('characters').put(character);
  const story=buildStoryFromSession({id:'source',title:'并发来源',character:{name:'角色'},user:{name:'我'},createdAt:1,messages:[{id:'m',role:'assistant',content:'正文'}]},character.id);
  await vault.repo('archiveStories').put(story);
  let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const held=withArchiveStoryLock(story.id,async()=>{enter();await gate;});await entered;
  let timer:ReturnType<typeof setTimeout>;
  const capture=captureCharacterNote({recordId:'parallel',storyId:story.id,branchId:null,messageId:'m',content:'摘录'});
  try {await Promise.race([capture,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('备注不应等待故事队列')),500);})]);}
  finally {clearTimeout(timer!);release();await held;await capture;}
});
