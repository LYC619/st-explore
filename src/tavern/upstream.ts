import type { STRawMessage } from '../types/chat';
import type { RecoveryState } from './bridge-types';
import type { STRegexScript } from '../lib/st-regex-interop';

export interface WorldEntry { world: string; uid: string | number; comment?: string; content: string; constant?: boolean; disable?: boolean }
export interface EventMap {
  GENERATION_AFTER_COMMANDS: [type: string, options: unknown, dryRun: boolean];
  WORLD_INFO_ACTIVATED: [entries: WorldEntry[]];
  MESSAGE_RECEIVED: [index: number, type: string];
  OAI_PRESET_CHANGED_BEFORE: [value: { presetName: string }];
  GENERATION_STOPPED: []; GENERATION_ENDED: []; CHAT_CHANGED: [];
}
export interface EventSource {
  events: Record<string, ((...args: unknown[]) => unknown)[]>;
  on<T extends unknown[] = unknown[]>(name: string, listener: (...args: T) => unknown): void;
  makeFirst<T extends unknown[] = unknown[]>(name: string, listener: (...args: T) => unknown): void;
  emit(name: string, ...args: unknown[]): Promise<void>;
}
export interface Filter { getFilterData(key: string): { selected: string[]; excluded: string[] }; setFilterData(key: string, value: { selected: string[]; excluded: string[] }, quiet: boolean): void }
export interface UpstreamState extends RecoveryState {
  characters: { name: string; data?: { extensions?: { world?: string } } }[]; this_chid: number;
  event_types: Record<string, string>; eventSource: EventSource; entitiesFilter: Filter;
  printMessages(): Promise<void>; saveChatConditional(): Promise<void>; flushDebouncedChatSave(): Promise<void>;
  cancelPendingSettingsSave(): void; saveSettings(): Promise<boolean>; stopGeneration(): void; waitForGenerationIdle(): Promise<void>;
  messageEditDone(editor: JQueryElement): Promise<void>; hasUnsavedChat(): boolean;
  reloadCurrentChat(): Promise<void>; updateMessageBlock(index: number, message: STRawMessage): void;
  substituteParams(text: string): string; printCharacters(force: boolean): Promise<void>; openCharacterChat(key: string): Promise<void>;
  generateQuietPrompt(options: { quietPrompt: string }): Promise<string>;
  generateRaw(options: { prompt: { role: string; content: string }[] }): Promise<string>;
  doNavbarIconClick(this: HTMLElement): Promise<void>;
}
export interface JQueryElement {
  [index: number]: HTMLElement; length: number;
  closest(selector: string): JQueryElement; find(selector: string): JQueryElement; children(selector: string): JQueryElement;
  attr(name: string, value: string): JQueryElement; prop(name: string, value: unknown): JQueryElement;
  val(value: string): JQueryElement; hasClass(name: string): boolean; is(selector: string): boolean;
  trigger(name: string): JQueryElement; triggerHandler(name: string): unknown; promise(): Promise<void>;
}
export interface AjaxResponse { abort(): void; status: number; responseJSON?: unknown }
export interface AjaxOptions {
  url?: string; async?: boolean; data?: unknown; dataType?: string;
  success?(data: unknown, status: string, xhr: AjaxResponse): void;
  error?(xhr: AjaxResponse, status: string, error: unknown): void;
  complete?(xhr: AjaxResponse, status: string): void;
}
export interface JQuery {
  (selector: string): JQueryElement;
  ajax(urlOrOptions: string | AjaxOptions, options?: AjaxOptions): AjaxResponse;
  Deferred(): { promise(value: AjaxResponse): AjaxResponse; resolve(data: unknown, status: string, xhr: AjaxResponse): void; reject(xhr: AjaxResponse, status: string, error: unknown): void };
}
export interface Lodash {
  merge<T extends object>(target: T, source: object): T;
  defaultsDeep<T extends object>(target: T, source: object): T;
  has(target: object, path: string): boolean; unset(target: object, path: string): boolean;
  get(target: object, path: string, fallback?: unknown): unknown;
}
export interface ScriptTree { id?: string; data?: Record<string, unknown>; scripts?: ScriptTree[]; [key: string]: unknown }
export interface PopupOptions { wide?: boolean; okButton?: string; cancelButton?: string }
export interface UpstreamModules {
  '/script.js': UpstreamState;
  '/lib.js': { lodash: Lodash };
  '/tauri/main/api/chat-surface.js': { installChatSurfaceApi(): void };
  '/scripts/popup.js': { Popup: new (content: HTMLElement, type: number, input?: string, options?: PopupOptions) => { show(): Promise<unknown>; complete(value: number): Promise<void> }; POPUP_TYPE: { TEXT: number; CONFIRM: number } };
  '/scripts/extensions.js': { extension_settings: { variables?: { global?: Record<string, unknown> } } };
  '/scripts/slash-commands.js': { executeSlashCommandsWithOptions(command: string, options: { handleParserErrors: boolean; handleExecutionErrors: boolean }): Promise<{ pipe?: string } | undefined> };
  '/scripts/extensions/regex/index.js': { loadRegexScripts(): Promise<void> };
  '/scripts/extensions/regex/engine.js': { getRegexedString(text: string, placement: number, options: { isPrompt: boolean }): string; regex_placement: { WORLD_INFO: number } };
  '/scripts/openai.js': { oai_settings: { preset_settings_openai: string; openai_max_context: number; openai_max_tokens: number; custom_model: string; custom_url: string; chat_completion_source: string }; openai_settings: unknown[]; openai_setting_names: Record<string, number> };
  '/scripts/world-info.js': { selected_world_info: string[]; METADATA_KEY: string; updateWorldInfoList(): Promise<void>; worldInfoCache: Map<string, unknown> };
  '/scripts/tags.js': { loadTagsSettings(data: unknown): void; printTagFilters(): void };
  '/scripts/filters.js': { FILTER_TYPES: { TAG: string } };
  '/scripts/group-chats.js': { groupCandidatesFilter: Filter; groupMembersFilter: Filter };
  '/scripts/bookmarks.js': { branchChat(index: number): Promise<unknown> };
}
/** The pinned upstream stays JavaScript; these are the reviewed surfaces STE consumes. */
export function loadUpstream<K extends keyof UpstreamModules>(path: K): Promise<UpstreamModules[K]> {
  return import(/* @vite-ignore */ new URL(path, location.href).href) as Promise<UpstreamModules[K]>;
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '酒馆操作失败'; }

declare global {
  const toastr: { error(message: string, title?: string): void; warning(message: string): void; success(message: string): void; info(message: string, title?: string): void };
  const $: JQuery;
  interface Window {
    _: Lodash;
    __STE_STAMP_CHAT__(messages: STRawMessage[]): void;
    __STE_NEW_MESSAGE_ID__(message: STRawMessage): void;
    __STE_OPEN_CARD_EDITOR__(card: { _ste_revision?: string; avatar: string }): void;
    __STE_DRAFT_CAPTURE__?(): Promise<void>; __STE_DRAFT_READY__(): boolean;
    __STE_TAVERN_FLUSH__?(): Promise<void>; __STE_TAVERN_DIRTY__?(): boolean;
    __STE_TAVERN_REFRESH_LIBRARY__?(): Promise<void>; __STE_TAVERN_SNAPSHOT__?(): Promise<{ fileName: string; text: string }>;
    __STE_TAVERN_OPEN_SETTINGS__?(section: 'runtime' | 'models' | 'scripts' | 'branches' | 'chat'): Promise<void>;
    __STE_BEFORE_CHAT_SWITCH__(): Promise<void>; __STE_TAVERN_READY__(): void;
    __STE_TAVERN_STARTUP__(message: string, failed?: boolean): void;
    __STE_ST_EVALUATED__?: boolean; __STE_SAVE_FAILED__?: boolean;
    __STE_AGENT_MODE__: boolean; __STE_CONTEXT_RESERVE__?: number; __STE_MEMORY_OWNER__?: string;
    __STE_EFFECTIVE_WORLDS__(entries: WorldEntry[]): Promise<WorldEntry[]>;
    __STE_WORLD_PROMPT__(entries: WorldEntry[]): Promise<unknown>;
    __STE_USER_AVATAR__(name: string): string | undefined;
    __STE_BAIBAI_HIDE__(message: STRawMessage): void; __STE_BAIBAI_BUSY__?(): boolean;
    __STE_BAIBAI_FLUSH__?(): Promise<void>; __STE_BAIBAI_REFRESH__?(): void;
    __STE_BAIBAI_ASSET_URL__(relative: string): string; __STE_BAIBAI_IMPORT__(specifier: string): Promise<unknown>;
    __STE_REFRESH_CONNECTIONS__?(): Promise<void>; __STE_REFRESH_REGEX__?(): Promise<boolean>;
    __STE_ALLOWED_FRONTEND_REGEX__(): STRegexScript[];
    __STE_REGEX_REQUIRING_CONSENT__(scripts: STRegexScript[]): STRegexScript[];
    __STE_REGEX_LANE__(lane: 'globalScripts' | 'embeddedScripts', ordinary: STRegexScript[]): STRegexScript[];
    __STE_SAVE_REGEX_LANE__(scripts: STRegexScript[], type: number): Promise<STRegexScript[]>;
    __STE_EXTENSION_RESOURCE__(name: string, resource: string): string | undefined;
    __STE_HELPER_GENERATING__?: boolean; __STE_HELPER_FLUSH__?(): Promise<void>;
    __STE_HELPER_STATE__?(): { frames: number; scriptFrames: number; htmlFrames: number; pending: number; eventWaiters: number; writerBusy: boolean; listeners: number; listenerCounts: Record<string, number> };
    TavernHelper?: { getScriptTrees(options: { type: 'global' }): ScriptTree[]; replaceScriptTrees(trees: ScriptTree[], options: { type: 'global' }): void };
    __TAURI__: { core: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown>; convertFileSrc(path: string): string }; event: { listen(name: string, listener: (event: { event: string; payload: unknown }) => void): Promise<() => void> } };
    __TAURITAVERN__: { invoke: { safeInvoke(command: string, args?: Record<string, unknown>): Promise<unknown>; flushAll(): Promise<void> }; api: Record<string, unknown>; iosPolicy: null };
    __TAURITAVERN_THUMBNAIL__(type: string, file: string): string;
    __TAURITAVERN_MAIN_READY__: Promise<void>;
  }
}
