export type HelperGrant = 'read' | 'write' | 'generate';
export interface HelperScript {
  type: 'script'; id: string; name: string; content: string; enabled: boolean; grants: HelperGrant[];
  info: string; data: Record<string, unknown>;
  button: { enabled: boolean; buttons: { name: string; visible: boolean }[] };
}
export interface HelperSettings {
  schema: 1;
  scripts: HelperScript[];
  html: { enabled: boolean; grants: HelperGrant[] };
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function grants(value: unknown): HelperGrant[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(grant => !['read', 'write', 'generate'].includes(grant))) throw new Error('脚本含不支持的权限');
  return [...new Set(value)] as HelperGrant[];
}
function script(value: unknown, imported: boolean): HelperScript {
  const item = object(value), buttons = object(item.button);
  if (item.type !== 'script' || typeof item.content !== 'string') throw new Error('脚本内容必须是 script 类型的 JavaScript 文本');
  if (item.content.length > 512 * 1024) throw new Error('单个脚本不能超过 512 KiB');
  const id = item.id === undefined && imported ? crypto.randomUUID() : item.id;
  // eslint-disable-next-line no-control-regex -- Imported IDs must not contain control bytes.
  if (typeof id !== 'string' || !id || id.length > 160 || /[\x00-\x1f]/.test(id)) throw new Error('脚本 ID 无效');
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160) throw new Error('脚本名称无效');
  const data = structuredClone(object(item.data));
  if (JSON.stringify(data).length > 512 * 1024) throw new Error('脚本变量不能超过 512 KiB');
  return { type: 'script', id, name: item.name, content: item.content, enabled: !imported && item.enabled === true,
    grants: imported ? [] : grants(item.grants), info: typeof item.info === 'string' ? item.info.slice(0, 4000) : '', data,
    button: { enabled: buttons.enabled === true, buttons: (Array.isArray(buttons.buttons) ? buttons.buttons : []).slice(0, 20).map(value => {
      const button = object(value);
      if (typeof button.name !== 'string' || !button.name || button.name.length > 100) throw new Error('脚本按钮名称无效');
      return { name: button.name, visible: button.visible !== false };
    }) } };
}
function unique(scripts: HelperScript[]) {
  if (scripts.length > 32) throw new Error('每个聊天最多保存 32 个脚本');
  if (new Set(scripts.map(item => item.id)).size !== scripts.length) throw new Error('脚本 ID 重复');
  if (scripts.filter(item => item.enabled).length > 8) throw new Error('每个聊天最多同时启用 8 个脚本');
  return scripts;
}
export function normalizeHelperSettings(value: unknown): HelperSettings {
  const settings = object(value), html = object(settings.html);
  if (settings.schema !== undefined && settings.schema !== 1) throw new Error('脚本设置版本不受支持');
  if (settings.scripts !== undefined && !Array.isArray(settings.scripts)) throw new Error('脚本列表格式无效');
  return { schema: 1, scripts: unique((settings.scripts as unknown[] ?? []).map(value => script(value, false))),
    html: { enabled: html.enabled === true, grants: grants(html.grants) } };
}

/** Accept the published helper script/folder JSON shape; imported code is inert until explicitly enabled. */
export function importHelperScripts(value: unknown): HelperScript[] {
  const result: HelperScript[] = [];
  function walk(value: unknown, depth: number) {
    if (depth > 8) throw new Error('脚本文件夹嵌套过深');
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    const item = object(value);
    if (item.type === 'folder' && Array.isArray(item.scripts)) { walk(item.scripts, depth + 1); return; }
    result.push(script(item, true));
    if (result.length > 32) throw new Error('每次最多导入 32 个脚本');
  }
  walk(value, 0);
  return unique(result);
}
