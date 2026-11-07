import type { STRegexScript } from '@/lib/st-regex-interop';
import type { ChatSession } from '@/types/chat';
import { importHelperScripts, type HelperScript } from '@/lib/roleplay/helper-settings';

export interface FrontendRule { lane: 'globalScripts' | 'embeddedScripts'; script: STRegexScript }
export interface FrontendDraft {
  source: string;
  rules: FrontendRule[];
  scripts: HelperScript[];
  variables: string;
  notes: string;
  selectedRule: number;
  floor: number;
  candidate: number;
}
export interface FrontendState { schema: 1; draft: FrontendDraft; applied: FrontendDraft | null }
export const emptyFrontend = (): FrontendDraft => ({ source: '', rules: [], scripts: [], variables: '{}', notes: '', selectedRule: 0, floor: -1, candidate: 0 });
export function validateFrontend(draft: FrontendDraft): FrontendDraft {
  if (!draft || typeof draft.source !== 'string' || !Array.isArray(draft.rules) || draft.rules.length > 100
    || !Array.isArray(draft.scripts) || typeof draft.variables !== 'string' || typeof draft.notes !== 'string'
    || !Number.isSafeInteger(draft.selectedRule) || draft.selectedRule < 0 || !Number.isSafeInteger(draft.floor) || draft.floor < -1
    || !Number.isSafeInteger(draft.candidate) || draft.candidate < 0
    || JSON.stringify(draft).length > 4 * 1024 * 1024) throw new Error('成品前端内容无效或超过 4 MiB');
  const ids = new Set<string>();
  for (const { lane, script } of draft.rules) {
    if (!['globalScripts', 'embeddedScripts'].includes(lane) || !script || typeof script.scriptName !== 'string'
      || typeof script.findRegex !== 'string' || typeof script.replaceString !== 'string' || !script.id
      || !Array.isArray(script.placement) || script.placement.some(p => !Number.isInteger(p))
      || [script.minDepth, script.maxDepth].some(depth => depth != null && (!Number.isSafeInteger(depth) || depth < 0))
      || ids.has(lane + script.id)) throw new Error('正则需要唯一 ID、名称、查找内容、替换内容和 placement 数组');
    ids.add(lane + script.id);
  }
  // Validate executable structure but keep explicit enable selections and original fields.
  importHelperScripts(draft.scripts);
  return structuredClone(draft);
}
export function newHtmlRule(html: string, name: string): FrontendRule {
  const source = unwrapFrontendHtml(html);
  // Original Helper recognizes a complete HTML document as a runnable frontend.
  const document = /<(?:html|head|body)\b/i.test(source) ? source
    : '<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n' + source + '\n</body></html>';
  return { lane: 'embeddedScripts', script: { id: crypto.randomUUID(), scriptName: name, findRegex: '<StatusPlaceHolderImpl/>',
    replaceString: '\n```html\n' + document + '\n```\n', trimStrings: [], steLiteralReplacement: true, placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null } };
}
export function importFrontendFile(draft: FrontendDraft, name: string, text: string): FrontendDraft {
  const next = structuredClone(draft);
  if (text.length > 2 * 1024 * 1024) throw new Error('单份材料不能超过 2 MiB');
  next.source = [next.source, name].filter(Boolean).join('、');
  if (/\.html?$/i.test(name)) { next.rules.push(newHtmlRule(text, name)); next.selectedRule = next.rules.length - 1; }
  else if (/\.[cm]?js$/i.test(name)) next.scripts.push(...importHelperScripts({ type: 'script', name, content: text }));
  else if (/\.json$/i.test(name)) {
    const data = JSON.parse(text), extensions = (data.data ?? data).extensions;
    if (Array.isArray(data.rules) && Array.isArray(data.scripts) && typeof data.variables === 'string') return validateFrontend({ ...data, scripts: importHelperScripts(data.scripts) });
    const rules = extensions?.regex_scripts ?? (Array.isArray(data) && data[0]?.findRegex !== undefined ? data : data.findRegex !== undefined ? [data] : undefined);
    if (rules) {
      next.rules.push(...rules.map((script: STRegexScript) => ({ lane: 'embeddedScripts' as const, script: { ...script, id: script.id || crypto.randomUUID() } })));
      if (extensions?.tavern_helper?.scripts?.length) next.scripts.push(...importHelperScripts(extensions.tavern_helper.scripts));
    } else if (data.type === 'script' || data.type === 'folder' || Array.isArray(data)) next.scripts.push(...importHelperScripts(data));
    else if (data && typeof data === 'object') next.variables = JSON.stringify(data, null, 2);
    else throw new Error('变量材料需要 JSON 对象');
  } else next.notes += (next.notes ? '\n\n' : '') + name + '\n' + text;
  return validateFrontend(next);
}
export function frontendSnapshot(session: ChatSession, floor: number, candidate: number) {
  const index = floor < 0 ? session.messages.length - 1 : floor;
  const message = session.messages[index], raw = message?.rawData;
  const selected = raw?.swipe_id ?? 0;
  // Never fall back to the active candidate's data when previewing an empty alternate.
  const extra = candidate === selected ? raw?.extra : raw?.swipe_info?.[candidate]?.extra;
  const variables = raw?.variables?.[candidate] ?? extra?.variables ?? {};
  return { index, candidate, message: candidate === selected ? message?.content ?? '' : raw?.swipes?.[candidate] ?? '',
    role: message?.role ?? 'assistant', data: structuredClone(variables), chatVariables: structuredClone(session.rawMetadata?.chat_metadata?.variables ?? {}) };
}
export function unwrapFrontendHtml(text: string): string {
  return text.trim().replace(/^```(?:html)?\s*\n([\s\S]*?)\n```$/i, '$1');
}
export interface FrontendDiagnostic {
  kind: 'ready' | 'error' | 'resource' | 'variables' | 'console'; message: string;
  source?: string; line?: number; column?: number;
}
/** Isolated sample APIs only. No RPC, parent access, original scripts or writes to the story. */
export function frontendPreview(html: string, variables: string, snapshot?: ReturnType<typeof frontendSnapshot>, token = '') {
  const data = JSON.parse(variables);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('预览变量必须是 JSON 对象');
  const source = unwrapFrontendHtml(html);
  const head = /<head(?:\s[^>]*)?>/i;
  const match = head.exec(source), insertion = match ? match.index + match[0].length : 0;
  const prefix = source.slice(0, insertion), insertionLine = prefix.split('\n').length;
  const sourceOffset = html.slice(0, Math.max(0, html.indexOf(source))).split('\n').length - 1;
  const payload = JSON.stringify({ data, snapshot, token, sourceOffset, insertionLine }).replace(/</g, '\\u003c');
  // One injected line preserves HTML source line numbers. Report editor offsets,
  // including the optional Markdown fence, and correct columns on that line.
  const bootstrap = `<script>(()=>{const injected=document.currentScript.outerHTML.length,p=${payload};let data=p.data,reads=0;const s=p.snapshot||{index:0,candidate:0,message:'',role:'assistant',chatVariables:{}};
const report=(kind,message,extra={})=>parent.postMessage({type:'ste-frontend-preview',token:p.token,diagnostic:{kind,message:String(message).slice(0,1500),...extra}},'*');
addEventListener('error',e=>{if(!e.message){report('resource','资源加载失败',{source:String(e.target?.src||e.target?.href||'未知资源')});return}const local=!e.filename||e.filename==='about:srcdoc';report('error',e.message,{source:local?'当前 HTML':e.filename,line:e.lineno?(local?e.lineno+p.sourceOffset:e.lineno):undefined,column:e.colno?(local&&e.lineno===p.insertionLine?Math.max(1,e.colno-injected):e.colno):undefined})},true);
addEventListener('unhandledrejection',e=>report('error',String(e.reason),{source:'异步脚本（浏览器未提供行列）'}));
const originalError=console.error.bind(console);console.error=(...args)=>{originalError(...args);report('console',args.map(x=>String(x)).join(' '))};
const note=(type)=>{if(reads++<30)report('variables','读取 '+type+' 变量 · 楼层 '+s.index+' / 候选 '+(s.candidate+1))};
const api={getCurrentMessageId:()=>s.index,getLastMessageId:()=>s.index,getVariables:(o={})=>{note(o.type||'message');return structuredClone(o.type==='chat'?s.chatVariables:data)},getChatMessages:()=>{note('message');return [{message_id:s.index,swipe_id:s.candidate,message:s.message,role:s.role,data:structuredClone(data)}]},replaceVariables:v=>{data=structuredClone(v);report('variables','仅更新预览内变量副本')},updateVariablesWith:f=>{data=f(structuredClone(data));report('variables','仅更新预览内变量副本')},eventOn:()=>()=>{},eventOnce:()=>()=>{},waitGlobalInitialized:async()=>{},tavern_events:{MESSAGE_RECEIVED:'message',MESSAGE_SWIPED:'swipe',CHAT_CHANGED:'chat'}};Object.assign(window,api);window.TavernHelper=api;report('ready','变量读取接口已就绪；配套脚本在聊天中运行');})();</script>`.replace(/[\r\n]/g, '');
  return source.slice(0, insertion) + bootstrap + source.slice(insertion);
}
