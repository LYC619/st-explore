// Synthetic vault shaped like the user's largest library (counts and sizes only):
// 119 characters, ~1,387 record files, ~447 MB of JSON/Markdown, ~113 files over 1 MB.
// All text is generated; no real library content is read.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.cache/large-vault-1109/base');
// The root is wiped first, so it can never be a real library.
if (!root.startsWith(path.resolve('.cache/large-vault-1109') + path.sep)) throw Error('Fixture root must be inside .cache/large-vault-1109/');
await rm(root, { recursive: true, force: true });
const pool = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇';
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const text = chars => { let s = ''; for (let i = 0; i < chars; i++) s += i % 40 === 39 ? '\n' : pool[Math.floor(rand() * pool.length)]; return s; };
const id = prefix => prefix + '-' + Math.floor(rand() * 1e12).toString(36) + Math.floor(rand() * 1e12).toString(36);
let files = 0, bytes = 0, large = 0;
async function put(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content); files++; bytes += Buffer.byteLength(content); if (Buffer.byteLength(content) > 1048576) large++;
}
const message = (i, name) => ({ id: id('m'), role: i % 2 ? 'assistant' : 'user', name: i % 2 ? name : 'Observer', content: text(480), createdAt: 1700000000000 + i * 60000, swipes: i % 7 === 1 ? [text(300), text(300)] : undefined });
for (let c = 0; c < 119; c++) {
  const name = `合成角色${String(c).padStart(3, '0')}`, characterId = `bench-char-${c}`;
  const dir = path.join(root, '角色', name);
  await put(path.join(dir, '档案.json'), JSON.stringify({ id: characterId, name, tags: ['合成'], createdAt: 1, updatedAt: 1,
    card: { spec: 'chara_card_v3', data: { name, description: text(6000), first_mes: text(800), personality: text(400), scenario: text(600), extensions: {} } },
    attachments: [{ id: 'a1', title: '合成附件', path: '附件/data.bin', pathBase: 'character', size: 4096, addedAt: 1 }] }));
  await put(path.join(dir, '附件', 'data.bin'), 'x'.repeat(4096));
  await put(path.join(dir, '卡片.png'), 'png');
  const stories = c < 79 ? 10 : 9;
  for (let s = 0; s < stories; s++) {
    const largeStory = (c * 10 + s) % 10 === 3 && large < 113;
    const count = largeStory ? 900 + Math.floor(rand() * 600) : 90 + Math.floor(rand() * 60);
    const storyId = `bench-story-${c}-${s}`, title = `合成故事${s}`;
    const messages = Array.from({ length: count }, (_, i) => message(i, name));
    await put(path.join(dir, '故事', title, '故事.json'), JSON.stringify({ id: storyId, characterId, title, createdAt: 1, updatedAt: 1, markers: [], meta: {},
      session: { id: id('chat'), title, createdAt: 1, user: { name: 'Observer' }, character: { name }, messages } }));
    if (s === 0) {
      const fields = { id: `bench-summary-${c}`, kind: 'volume', title: '合成总结', bookId: storyId, bookTitle: title, floorStart: 0, floorEnd: 49, volumeNumber: 1, createdAt: 1, updatedAt: 1 };
      await put(path.join(dir, '故事', title, '分卷总结·合成总结.md'), `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n${text(1500)}`);
    }
  }
}
await put(path.join(root, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 2 }));
console.log(JSON.stringify({ root, files, mb: +(bytes / 1048576).toFixed(1), large }));
