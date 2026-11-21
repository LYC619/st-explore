import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './runtime';

export type DiagnosticKind = 'vault' | 'frontend_error' | 'model' | 'import' | 'writeback';
export interface DiagnosticEvent {
  event: DiagnosticKind;
  operation: string;
  category?: string;
  source?: string;
  host?: string;
  model?: string;
  elapsedMs?: number;
  count?: number;
  attempt?: number;
  status?: number;
}
const operations = new Set(['open','switch','close','start','end','failed','error','rejection','render','route','request','parse']);
const categories = new Set(['permission','rate_limit','service','network','timeout','invalid_request','blocked','empty','truncated','interrupted','parse','cancelled','syntax','type','range','reference','error','unknown']);
const errorTypes: Record<string,string> = { SyntaxError:'syntax', TypeError:'type', RangeError:'range', ReferenceError:'reference', Error:'error' };

function hash(value: string): string {
  let a=0x811c9dc5,b=0x9e3779b9;
  for(const char of value){a=Math.imul(a^char.charCodeAt(0),16777619);b=Math.imul(b^char.charCodeAt(0),2246822519);}
  return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}

export function sanitizeDiagnostic(value: DiagnosticEvent): DiagnosticEvent {
  const numeric = (n: number | undefined) => Number.isFinite(n) && n! >= 0 ? Math.min(Math.floor(n!), Number.MAX_SAFE_INTEGER) : undefined;
  // Construct a new object. Unexpected fields such as message/body/authorization never cross IPC.
  return {event:value.event,operation:operations.has(value.operation)?value.operation:'error',
    category:value.category ? (categories.has(value.category)?value.category:'unknown'):undefined,
    source:value.source?hash(value.source):undefined,host:value.host?hash(value.host):undefined,model:value.model?hash(value.model):undefined,
    elapsedMs:numeric(value.elapsedMs),count:numeric(value.count),attempt:numeric(value.attempt),status:numeric(value.status)};
}

export function safeErrorTag(error: unknown): string {
  return error instanceof Error ? (error.name || 'Error') : 'UnknownError';
}

export function diagnosticForError(error: unknown, operation = 'error', location?: string): DiagnosticEvent {
  // Even unquoted parse errors may contain private text. Keep only a known error type and hashed callsite.
  const name = error instanceof Error ? error.name : '';
  const source = location ?? (error instanceof Error ? error.stack?.split('\n').slice(1,3).join('\n') : undefined);
  return sanitizeDiagnostic({event:'frontend_error',operation,category:errorTypes[name]??'unknown',source});
}

export function createDiagnosticReporter(sink: (value:DiagnosticEvent)=>void|Promise<void>, now=Date.now) {
  const seen = new Map<string,{time:number;suppressed:number;value:DiagnosticEvent}>();
  const send = (value:DiagnosticEvent) => {try {void Promise.resolve(sink(value)).catch(()=>{});} catch {/* Diagnostics must not break the operation. */}};
  const flush = (all=false) => {
    for(const [key,item] of seen){if(all||now()-item.time>=5000){if(item.suppressed)send({...item.value,count:item.suppressed});seen.delete(key);}}
  };
  const report = (input:DiagnosticEvent) => {
    flush(); const value=sanitizeDiagnostic(input);
    const key=JSON.stringify({...value,elapsedMs:undefined,count:undefined});
    const prior=seen.get(key);if(prior){prior.suppressed++;return;}
    if(seen.size>=128)flush(true);
    seen.set(key,{time:now(),suppressed:0,value});send(value);
  };
  return {report,flush:()=>flush(true)};
}
const reporter = createDiagnosticReporter(value => isTauri() ? invoke<void>('write_diagnostic_event',{event:value}) : undefined);
export const reportDiagnostic = reporter.report;
export function reportError(error:unknown,operation='error',location?:string) {reportDiagnostic(diagnosticForError(error,operation,location));}

export function installGlobalDiagnostics(target:Window=window):()=>void {
  const onError=(event:ErrorEvent)=>reportError(event.error,'error',`${event.filename}:${event.lineno}:${event.colno}`);
  const onRejection=(event:PromiseRejectionEvent)=>reportError(event.reason,'rejection');
  const flush=()=>reporter.flush();
  target.addEventListener('error',onError);target.addEventListener('unhandledrejection',onRejection);target.addEventListener('pagehide',flush);
  return ()=>{target.removeEventListener('error',onError);target.removeEventListener('unhandledrejection',onRejection);target.removeEventListener('pagehide',flush);flush();};
}

export interface EnvironmentInfo {status:'normal'|'redirected'|'unknown';nominalPath:string;resolvedPath:string|null;packageIdentity:string|null;logAvailable:boolean}
export function getEnvironmentInfo():Promise<EnvironmentInfo> {return invoke('get_environment_info');}
export function openLogDirectory():Promise<void> {return invoke('open_log_directory');}
