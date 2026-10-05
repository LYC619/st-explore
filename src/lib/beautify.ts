import { normalizeHelperSettings, type HelperSettings, type HelperScript } from '@/lib/roleplay/helper-settings';
export interface BeautifyConfig {
  statusEnabled: boolean; mvuEnabled: boolean; mode: 'inline' | 'floating'; title: string;
  color: string; source: 'message' | 'chat'; fields: { label: string; path: string }[];
  initialData: Record<string, unknown>;
}
export const DEFAULT_BEAUTIFY: BeautifyConfig = { statusEnabled: false, mvuEnabled: false, mode: 'inline', title: '当前状态',
  color: '#92704a', source: 'message', fields: [{ label: '好感度', path: 'trust' }, { label: '地点', path: 'location' }], initialData: { trust: 0, location: '未记录' } };
/** Kept self-contained: the same evaluator is embedded in the sandboxed MVU script. */
export function applyMvuPatch(data: Record<string, unknown>, patches: unknown): Record<string, unknown> {
  if (!Array.isArray(patches) || patches.length > 500) throw new Error('JSON Patch 必须是最多 500 项的数组');
  const next = structuredClone(data);
  for (const patch of patches) {
    if (!patch || !['add', 'replace', 'remove'].includes(patch.op) || typeof patch.path !== 'string' || !patch.path.startsWith('/')) {
      throw new Error('支持 add、replace、remove 和以 / 开始的 JSON Pointer');
    }
    const parts = patch.path.slice(1).split('/').map((part: string) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (parts.some((part: string) => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('无效的变量路径');
    let parent: Record<string, unknown> | unknown[] = next;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(parent, part)) throw new Error(`变量路径不存在：${patch.path}`);
      const child = (parent as Record<string, unknown>)[part];
      if (!child || typeof child !== 'object') throw new Error(`变量路径不是对象：${patch.path}`);
      parent = child as Record<string, unknown>;
    }
    const key = parts[parts.length - 1];
    if (patch.op !== 'remove' && !Object.hasOwn(patch, 'value')) throw new Error('更新缺少 value');
    if (Array.isArray(parent)) {
      const index = key === '-' && patch.op === 'add' ? parent.length : /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
      if (index < 0 || index > parent.length || patch.op !== 'add' && index === parent.length) throw new Error('数组位置无效');
      if (patch.op === 'add') parent.splice(index, 0, structuredClone(patch.value));
      else if (patch.op === 'remove') parent.splice(index, 1);
      else parent[index] = structuredClone(patch.value);
    } else {
      if (patch.op !== 'add' && !Object.hasOwn(parent, key)) throw new Error(`变量不存在：${patch.path}`);
      if (patch.op === 'remove') delete parent[key];
      else parent[key] = structuredClone(patch.value);
    }
  }
  return next;
}

export function normalizeBeautifyConfig(value: unknown): BeautifyConfig {
  const c = value as Partial<BeautifyConfig> | null;
  if (!c || !Array.isArray(c.fields) || c.fields.length > 30 || !c.fields.length) throw new Error('状态栏需要 1–30 个显示字段');
  if (!c.initialData || typeof c.initialData !== 'object' || Array.isArray(c.initialData)) throw new Error('初始变量必须是 JSON 对象');
  if (JSON.stringify(c.initialData).length > 200_000) throw new Error('初始变量内容过大');
  return { statusEnabled: c.statusEnabled === true, mvuEnabled: c.mvuEnabled === true,
    mode: c.mode === 'floating' ? 'floating' : 'inline', source: c.source === 'chat' ? 'chat' : 'message',
    title: String(c.title ?? '当前状态').slice(0, 120), color: /^#[\da-f]{6}$/i.test(c.color ?? '') ? c.color! : DEFAULT_BEAUTIFY.color,
    fields: c.fields.map(field => {
      if (typeof field?.path !== 'string' || !field.path.trim() || field.path.length > 200) throw new Error('显示字段需要有效的变量路径');
      return { label: String(field.label ?? field.path).slice(0, 80), path: field.path.trim() };
    }), initialData: structuredClone(c.initialData) };
}

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function fieldValue(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key] : undefined, data);
}
export function buildStatusPreview(config: BeautifyConfig, data: Record<string, unknown>): string {
  const c = normalizeBeautifyConfig(config);
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#fbf8f3;color:#302c28;font:14px/1.6 system-ui}h3{margin:0 0 12px;color:${c.color}}dl{margin:0}div{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #ddd3c5;padding:7px 0}dt{color:#746b60}dd{margin:0;overflow-wrap:anywhere;max-width:70%}</style></head><body><h3>${escapeHtml(c.title)}</h3><dl>${c.fields.map(field => {
    const value = fieldValue(data, field.path);
    return `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : value)}</dd></div>`;
  }).join('')}</dl></body></html>`;
}

const sourceJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
function statusSource(c: BeautifyConfig): string {
  return `const config = ${sourceJson(c)};\n` + String.raw`
document.body.style.cssText = 'margin:0;padding:12px;color:#302c28;background:#fbf8f3;font:14px/1.6 system-ui';
function draw() {
  let variables = {};
  if (config.source === 'chat') variables = getVariables({ type: 'chat' });
  else {
    const messages = getChatMessages('0-{{lastMessageId}}', { hide_state: 'unhidden' });
    variables = [...messages].reverse().find(m => m.data?.stat_data)?.data ?? {};
  }
  const data = variables.stat_data ?? (Object.keys(variables).length ? variables : config.initialData);
  const title = document.createElement('strong'); title.textContent = config.title; title.style.color = config.color;
  document.body.replaceChildren(title);
  for (const field of config.fields) {
    const value = field.path.split('.').reduce((v, key) => v && typeof v === 'object' && Object.hasOwn(v, key) ? v[key] : undefined, data);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-top:1px solid #ddd3c5';
    const label = document.createElement('span'); label.textContent = field.label;
    const output = document.createElement('span'); output.style.cssText = 'max-width:70%;overflow-wrap:anywhere';
    output.textContent = value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    row.append(label, output); document.body.append(row);
  }
}
for (const event of Object.values(tavern_events)) eventOn(event, draw);
eventOn('ste-helper:variables', draw);
setInterval(draw, 1000);
draw();`;
}

function mvuSource(c: BeautifyConfig): string {
  return `const initialData = ${sourceJson(c.initialData)};\nconst applyPatch = ${applyMvuPatch.toString()};\n` + String.raw`
async function updateLatest() {
  const messages = getChatMessages('0-{{lastMessageId}}', { hide_state: 'unhidden' });
  const latest = messages.at(-1);
  if (!latest || latest.role !== 'assistant') return;
  const block = /<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/i.exec(latest.message);
  if (!block) return;
  const current = getVariables({ type: 'message', message_id: latest.message_id });
  if (current._steMvuSource === latest.message) return;
  const previous = messages.slice(0, -1).reverse().find(m => m.data?.stat_data);
  const base = previous?.data.stat_data ?? initialData;
  const stat_data = applyPatch(base, JSON.parse(block[1].replace(/^\s*\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60\s*$/g, '')));
  replaceVariables({ ...current, stat_data, _steMvuSource: latest.message }, { type: 'message', message_id: latest.message_id });
  await flushHelperWrites();
}
for (const name of ['GENERATION_ENDED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED']) {
  if (tavern_events[name]) eventOn(tavern_events[name], updateLatest);
}
await updateLatest();`;
}

export function mergeBeautifySettings(settings: HelperSettings, config: BeautifyConfig): HelperSettings {
  const c = normalizeBeautifyConfig(config);
  const base = (id: string, name: string): HelperScript => ({ type: 'script', id, name, enabled: false,
    content: '', grants: [], data: {}, info: '', button: { enabled: false, buttons: [] } });
  const status: HelperScript = { ...base('ste-beautify-status', '状态栏'), enabled: c.statusEnabled,
    content: statusSource(c), grants: ['read'], data: { steBeautify: c, ste_widget: { mode: c.mode } } };
  const mvu: HelperScript = { ...base('ste-beautify-mvu', 'MVU · JSON Patch'), enabled: c.mvuEnabled,
    content: mvuSource(c), grants: ['read', 'write'], info: '将最新回复的 JSONPatch（add/replace/remove）应用到楼层 stat_data，保留各候选变量。' };
  return normalizeHelperSettings({ ...settings,
    scripts: [...settings.scripts.filter(s => !['ste-beautify-status', 'ste-beautify-mvu'].includes(s.id)), mvu, status] });
}
