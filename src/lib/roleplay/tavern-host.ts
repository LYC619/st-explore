import { getCurrentRepo } from '@/lib/repo';
import { getRoleplayPreferences, saveRoleplayPreferences, type ArchiveMetaRecord, getBranchLine, updateCharacter, updateArchiveStory } from '@/lib/archive-db';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { WorldBookItem } from '@/types/worldbook';
import type { PresetItem } from '@/types/preset';
import { loadApiProfiles } from '@/components/ai-tools/api-profiles';
import { openStorySession, type StoryCommit, type RoleplayStorySession } from './story-session';
import { tokenizeTavern } from './tokenizer';
import { customHeaders, prepareCompletion, sendPreparedCompletion } from './provider';
import type { RoleplayPreferences } from '@/types/roleplay';
import { createRoleplayAssets } from './assets';
import { avatarKey, createRoleplayCatalog, type ChatLocator } from './catalog';
import { createAgentRuntime, type AgentRuntime, type AgentStatus, type RuntimeConfiguration, type WorldScopeEntry } from './agent-runtime';
import { createRuntimeStore } from './runtime-store';
import { monitorCompletion } from './completion-monitor';
import { decodeLiveChat, encodeLiveChat } from './live-chat';
import { digest, refsAreCurrent, stableJson } from './fingerprint';
import type { AgentResource } from './tool-agent';
import { embedCharaInPng } from '@/lib/png-writer';
import { base64ToBytes, bytesToBase64 } from '@/lib/utils';
import { createWorldbookVersions, type WorldbookVersions } from './worldbook-versions';
import { BAIBAI_PIN, readBaiBaiZip, linkBaiBaiModule } from './baibai-package';
import { checkpointDraft, recoverDraft, type DraftCheckpoint } from './draft';
import { branchKey } from './paths';
import type { RegexCollectionItem } from '@/types/regex';
import { createRoleplayRegexAssets, type RoleplayRegexAssets, type RegexAssetSaveInput } from './regex-assets';
import { ruleToSTScript } from '@/lib/st-regex-interop';
import { importHelperScripts, normalizeHelperSettings } from './helper-settings';
import { createStoryPackageAdapter, type StoryPackagePreview } from './story-package';
import { saveStoryPackageFile } from './export-package-file';
import { ensureBranchRuntime } from './branch-inheritance';

export interface TavernDefaults {
  settings: Record<string, unknown>;
  presets?: Record<string, Array<{ name: string; data: Record<string, unknown> }>>;
  backgrounds?: string[];
  avatars?: string[];
}

export interface TavernHostOptions {
  storyId: string;
  branchId?: string | null;
  defaults: TavernDefaults;
  onCommit?: (commit: StoryCommit) => void;
  onSaveError?: (message: string) => void;
  onReady?: () => void;
  onGeneration?: (active: boolean) => void;
  onManageProfiles?: () => void;
  onManagePage?: (path: string) => void;
  onOpenStory?: (storyId: string) => void;
  onSelect?: (locator: ChatLocator) => void;
  onAgentStatus?: (status: AgentStatus) => void;
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

export async function createTavernHost(options: TavernHostOptions) {
  const vaultEpoch = getVaultEpoch();
  const repos = {
    stories: getCurrentRepo<ArchiveStory>('archiveStories'),
    characters: getCurrentRepo<ArchiveCharacter>('characters'),
    worldbooks: getCurrentRepo<WorldBookItem>('worldbooks'),
    presets: getCurrentRepo<PresetItem>('presets'),
    regexes: getCurrentRepo<RegexCollectionItem>('regexes'),
    meta: getCurrentRepo<ArchiveMetaRecord>('archiveMeta'),
  };
  let closed = false;
  let worldTransformer = (text: string) => text;
  const isCurrent = () => !closed && getVaultEpoch() === vaultEpoch;
  const packageAdapter = createStoryPackageAdapter({ isCurrent });
  const packagePreviews = new Map<string, StoryPackagePreview>();
  const [loadedStory, characters, assets, initialPreferences] = await Promise.all([
    repos.stories.get(options.storyId), repos.characters.list(), createRoleplayAssets({ ...repos, isCurrent }), getRoleplayPreferences(repos.meta),
  ]);
  let preferences = initialPreferences;
  const cardEditorVersions = new Map(characters.map(character => [character.id, digest(stableJson(character.card))]));
  let settingsWrite = Promise.resolve();
  let settingsError: unknown;
  let generation: { fileName: string; key: string; id: string } | null = null;
  if (!loadedStory) throw new Error('故事不存在');
  const story = loadedStory;
  const branchId = options.branchId ?? null;
  const initialLine = getBranchLine(story, branchId);
  if (!initialLine) throw new Error('故事分支不存在');
  const line = initialLine;
  const catalog = await createRoleplayCatalog({ ...repos, storyId: story.id, branchId, isCurrent });
  async function inheritRuntime(locator: ChatLocator) {
    return ensureBranchRuntime({ storyId: locator.storyId, branchId: locator.branchId, store: createRuntimeStore(locator.storyId),
      stories: repos.stories, worldbooks: repos.worldbooks, isCurrent });
  }
  await inheritRuntime(catalog.initial);
  let selected = catalog.initial;
  const session = await openStorySession(story.id, branchId, { repo: repos.stories, isCurrent });
  const sessions = new Map<string, RoleplayStorySession>([[selected.key, session]]);
  const selectedChats = new Map<string, string>([[selected.avatar, selected.fileName]]);
  const runtimes = new Map<string, AgentRuntime>();
  const worldVersions = new Map<string, WorldbookVersions>();
  const regexBindings = new Map<string, Promise<RoleplayRegexAssets>>();
  async function regexFor(locator: ChatLocator) {
    let adapter = regexBindings.get(locator.key);
    if (!adapter) {
      adapter = (async () => {
        const story = await repos.stories.get(locator.storyId);
        const character = story?.characterId ? await repos.characters.get(story.characterId) : undefined;
        return createRoleplayRegexAssets({ regexes: repos.regexes, storyAssets: story?.assets, characterAssets: character?.assets,
          isCurrent: () => isCurrent() && selected.key === locator.key });
      })();
      regexBindings.set(locator.key, adapter);
    }
    return adapter;
  }
  async function regexSnapshot(locator: ChatLocator) {
    const snapshot = await (await regexFor(locator)).read();
    const story = await repos.stories.get(locator.storyId);
    const character = story?.characterId ? await repos.characters.get(story.characterId) : undefined;
    const embedded = await Promise.all((character?.assets ?? []).filter(ref => ref.kind === 'regex' && ref.relations?.includes('embedded'))
      .map(ref => repos.regexes.get(ref.assetId)));
    return { ...snapshot, chatKey: locator.key, suppressedEmbeddedIds: embedded.flatMap(asset => asset?.rules.map(rule => rule.id) ?? []) };
  }
  function versionsFor(locator: ChatLocator) {
    let versions = worldVersions.get(locator.key);
    if (!versions) {
      versions = createWorldbookVersions({ storyId: locator.storyId, branchId: locator.branchId,
        store: createRuntimeStore(locator.storyId), stories: repos.stories, worldbooks: repos.worldbooks, isCurrent });
      worldVersions.set(locator.key, versions);
    }
    return versions;
  }
  async function liveSession(locator: ChatLocator) {
    let live = sessions.get(locator.key);
    if (!live) {
      live = await openStorySession(locator.storyId, locator.branchId, { repo: repos.stories, isCurrent });
      sessions.set(locator.key, live);
    }
    return live;
  }
  function mainProfile() {
    const { profiles, activeId } = loadApiProfiles();
    const found = profiles.find(p => p.id === (preferences.mainProfileId ?? activeId));
    if (!found) throw new Error('主模型连接配置已删除，请重新选择');
    return found;
  }
  function toolProfile() {
    const { profiles } = loadApiProfiles();
    const found = profiles.find(profile => profile.id === (preferences.toolProfileId ?? mainProfile().id));
    if (!found) throw new Error('工具模型连接已删除，请在 API 抽屉中重新选择');
    return found;
  }
  function runtimeFor(locator: ChatLocator) {
    let runtime = runtimes.get(locator.key);
    if (runtime) return runtime;
    runtime = createAgentRuntime({ storyId: locator.storyId, branchId: locator.branchId, store: createRuntimeStore(locator.storyId),
      stories: repos.stories, isCurrent, toolProfile,
      onStatus: status => { if (selected.key === locator.key) options.onAgentStatus?.(status); },
      worldResources: async (scope: WorldScopeEntry[], sourceSession, phase) => {
        const result: AgentResource[] = [];
        const seen = new Set<string>();
        const effective = (await versionsFor(locator).list()).filter(version => version.status === 'active' && refsAreCurrent(version.sourceRefs, sourceSession));
        for (const item of scope) {
          const worldId = assets.worldId(item.world);
          if (!worldId) continue;
          const world = await repos.worldbooks.get(worldId);
          const entry = world?.worldbook.entries[String(item.uid)];
          if (!entry || !entry.enabled) continue;
          const id = `world:${worldId}:${entry.uid}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const version = effective.find(version => version.worldId === worldId && version.entryId === String(entry.uid));
          result.push({ id, kind: 'worldbook', label: `${item.world} / ${entry.comment || entry.uid}${version ? ` v${version.version}` : ''}${entry.constant ? '（常驻设定）' : ''}`,
            keywords: entry.key, content: phase === 'context' ? worldTransformer(version?.content ?? entry.content) : version?.content ?? entry.content,
            digest: digest(stableJson({ entry, version: version?.id })) });
        }
        return result;
      },
      proposeWorldVersions: async (turnId, proposals, scope, refs) => {
        const allowed = new Map(scope.map(item => [`world:${assets.worldId(item.world)}:${item.uid}`, item]));
        for (const [index, proposal] of proposals.entries()) {
          const source = allowed.get(proposal.resourceId), worldId = source && assets.worldId(source.world);
          if (!source || !worldId) throw new Error('世界书版本不在本轮可用条目范围内');
          await versionsFor(locator).propose({ operationId: `turn:${turnId}:${index}`, worldId, entryId: source.uid,
            content: proposal.content, reason: proposal.reason, sourceRefs: refs });
        }
      },
    });
    runtimes.set(locator.key, runtime);
    return runtime;
  }
  const defaults = structuredClone(options.defaults);
  const controllers = new Set<AbortController>();
  const unsubscribeVault = subscribeActiveVault(() => {
    for (const controller of controllers) controller.abort();
    for (const runtime of runtimes.values()) runtime.close();
  });
  const version = { agent: 'SillyTavern:1.18.0:STE', pkgVersion: '1.18.0', tauriVersion: 'STE', gitRevision: null, gitBranch: null };

  function persistPreferences(patch: Partial<RoleplayPreferences>) {
    const snapshot = structuredClone(patch);
    const operation = settingsWrite.then(async () => {
      if (!isCurrent()) throw new Error('游玩会话已切换');
      await saveRoleplayPreferences(snapshot, repos.meta);
      preferences = await getRoleplayPreferences(repos.meta);
    });
    settingsWrite = operation.then(() => { settingsError = undefined; }, error => { settingsError = error; });
    return operation;
  }

  async function generate(body: JsonObject, signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    controllers.add(controller);
    const release = () => {
      controllers.delete(controller);
      signal?.removeEventListener('abort', abort);
    };
    const locator = { ...selected };
    const runtime = runtimeFor(locator);
    let turnId: string | undefined;
    try {
      const context = object(body.ste_context);
      const configuration = await runtime.configuration();
      const auxiliary = context.type === 'quiet' && (configuration.memoryOwner === 'baibai' || context.source === 'helper');
      let prepared = prepareCompletion(auxiliary ? toolProfile() : mainProfile(), body);
      if (configuration.mode === 'agent' && !['quiet', 'impersonate'].includes(String(context.type))) {
        await runtime.resume();
        if (context.worldHandled !== true || !Array.isArray(context.chat)) throw new Error('Agent 需要原始聊天与世界书的生成准备，请重新打开聊天');
        const story = await repos.stories.get(locator.storyId);
        const current = story && getBranchLine(story, locator.branchId);
        if (!current) throw new Error('生成目标不存在');
        const source = decodeLiveChat(context.chat, current.session);
        if (['swipe', 'regenerate', 'continue'].includes(String(context.type)) && source.messages.at(-1)?.role === 'assistant') source.messages.pop();
        const scope = Array.isArray(context.worldEntries) ? context.worldEntries as WorldScopeEntry[] : [];
        const result = await runtime.prepare(prepared, source, scope, controller.signal);
        prepared = result.prepared; turnId = result.turnId;
        if (typeof context.maxContext === 'number') {
          const estimate = Number(tokenizeTavern('/api/tokenizers/openai/count?model=' + encodeURIComponent(mainProfile().model), prepared.body.messages).token_count);
          const completion = Number(prepared.body.max_completion_tokens ?? prepared.body.max_tokens ?? 0);
          if (estimate + completion > context.maxContext) throw new Error('本轮资料超出上下文预算，请提高上下文窗口或开启新上下文周期');
        }
      }
      if (!isCurrent() || selected.key !== locator.key) throw new Error('生成期间已切换故事');
      const response = await sendPreparedCompletion(prepared, controller.signal);
      const headers = new Headers(response.headers);
      if (turnId) headers.set('x-ste-turn-id', turnId);
      return monitorCompletion(new Response(response.body, { status: response.status, statusText: response.statusText, headers }), {
        signal: controller.signal, stream: !!prepared.body.stream, onRelease: release,
        onFinish: async outcome => {
          if (turnId) {
            try { await runtime.finish(turnId, outcome); } catch (error) { runtime.fail(error); }
          }
        },
      });
    } catch (error) {
      if (turnId) await runtime.finish(turnId, { status: controller.signal.aborted ? 'cancelled' : 'failed', content: '' }).catch(() => {});
      runtime.fail(error); release(); throw error;
    }
  }

  async function characterDtos() {
    return Promise.all((await catalog.characters()).map(async dto => {
      const known = characters.find(c => avatarKey(c.id) === dto.avatar);
      const character = known ? await repos.characters.get(known.id) : undefined;
      const primary = character?.assets?.find(ref => ref.kind === 'worldbook' && (!ref.relations || ref.relations.includes('primary') || ref.relations.includes('embedded')));
      const world = primary ? assets.worldName(primary.assetId) : undefined;
      return { ...dto, ...(character ? { _ste_revision: digest(stableJson(character.card)) } : {}), ...(selectedChats.has(dto.avatar) ? { chat: selectedChats.get(dto.avatar)! } : {}),
        data: { ...dto.data, extensions: { ...object(dto.data.extensions), ...(world ? { world } : {}) } } };
    }));
  }

  function settingsSnapshot() {
    const profile = mainProfile();
    const base = { ...defaults.settings, ...preferences.tavern };
    const worldSettings = object(base.world_info_settings);
    const worldInfo = object(worldSettings.world_info);
    const savedWorldInfo = object(object(preferences.tavern?.world_info_settings).world_info);
    const primaryPreset = [...story.assets ?? [], ...characters.find(c => c.id === story.characterId)?.assets ?? []].find(ref => ref.kind === 'preset');
    const presetName = primaryPreset ? assets.presetName(primaryPreset.assetId) : undefined;
    const presetSettings = presetName ? assets.presetData().get(presetName) : undefined;
    const settings = {
      ...base, firstRun: false, username: line.session.user.name,
      main_api: 'openai', active_character: selected.avatar, active_group: null,
      amount_gen: base.amount_gen ?? 600, max_context: base.max_context ?? 32768,
      power_user: { ...object(defaults.settings.power_user), ...object(base.power_user), auto_load_chat: true, auto_connect: true },
      world_info_settings: { ...worldSettings, world_info: { ...worldInfo,
        globalSelect: savedWorldInfo.globalSelect ?? assets.worldItems().filter(item => item.stGlobal).map(item => assets.worldName(item.id)),
        charLore: savedWorldInfo.charLore ?? characters.map(character => ({ name: avatarKey(character.id).slice(0, -4),
          extraBooks: (character.assets ?? []).filter(ref => ref.kind === 'worldbook' && ref.relations?.includes('extra')).map(ref => assets.worldName(ref.assetId)).filter(Boolean) })),
      } },
      oai_settings: { ...object(defaults.settings.oai_settings), ...presetSettings, ...object(preferences.tavern?.oai_settings),
        openai_max_context: object(preferences.tavern?.oai_settings).openai_max_context ?? presetSettings?.openai_max_context ?? 32768,
        ...(presetName && !object(base.oai_settings).preset_settings_openai ? { preset_settings_openai: presetName } : {}),
        chat_completion_source: 'custom', custom_url: profile.apiUrl, custom_model: profile.model, stream_openai: true },
    };
    const group = (type: string) => defaults.presets?.[type] ?? [];
    const openai = new Map(group('openai_preset').map(preset => [preset.name, JSON.stringify(preset.data)]));
    for (const [name, data] of assets.presetData()) openai.set(name, JSON.stringify(data));
    return {
      settings: JSON.stringify(settings), world_names: assets.worldNames(),
      koboldai_settings: [], koboldai_setting_names: [], novelai_settings: [], novelai_setting_names: [],
      openai_settings: [...openai.values()], openai_setting_names: [...openai.keys()],
      textgenerationwebui_presets: group('textgen_preset').map(p => JSON.stringify(p.data)),
      textgenerationwebui_preset_names: group('textgen_preset').map(p => p.name),
      themes: group('theme').map(p => p.data), movingUIPresets: group('moving_ui').map(p => p.data),
      quickReplyPresets: group('quick_replies').map(p => p.data), instruct: group('instruct').map(p => p.data),
      context: group('context').map(p => p.data), sysprompt: group('sysprompt').map(p => p.data), reasoning: group('reasoning').map(p => p.data),
      enable_extensions: true, enable_extensions_auto_update: false, enable_accounts: false,
      request_compression: { enabled: false },
    };
  }

  return {
    ready() {
      if (isCurrent()) {
        options.onReady?.();
        void runtimeFor(selected).resume().catch(error => runtimeFor(selected).fail(error));
      }
    },
    isGenerating: () => generation !== null,
    isRequestActive: () => controllers.size > 0,
    setWorldTransformer(transformer: (text: string) => string) { worldTransformer = transformer; },
    async request(path: string, value?: unknown, signal?: AbortSignal): Promise<Response> {
      try {
        signal?.throwIfAborted();
        if (!isCurrent()) throw new Error('游玩会话已关闭或文件库已切换');
        const body = object(value);
        const pathname = new URL(path, 'https://ste.local').pathname;
        if (pathname === '/csrf-token') return json({ token: 'ste-local-host' });
        if (pathname === '/version') return json(version);
        if (pathname === '/api/ping') return json({});
        if (pathname === '/ste/story-package/export') {
          if (generation || controllers.size) throw new Error('请先结束当前生成再导出故事');
          const output = await packageAdapter.exportStory(selected.storyId);
          return json({ result: await saveStoryPackageFile(output), fileName: output.fileName, omissions: output.package.omissions });
        }
        if (pathname === '/ste/story-package/preview') {
          const preview = await packageAdapter.previewImport(String(body.text ?? '')), token = crypto.randomUUID();
          packagePreviews.clear(); packagePreviews.set(token, preview);
          return json({ token, preview });
        }
        if (pathname === '/ste/story-package/import') {
          if (generation || controllers.size) throw new Error('请先结束当前生成再导入故事');
          const preview = packagePreviews.get(String(body.token));
          if (!preview) throw new Error('导入预览已失效，请重新选择文件');
          const result = await packageAdapter.applyImport(preview); packagePreviews.delete(String(body.token));
          return json(result);
        }
        if (pathname === '/ste/open-story') {
          const id = String(body.storyId);
          if (!await repos.stories.get(id)) throw new Error('故事不存在');
          options.onOpenStory?.(id); return json({});
        }
        if (pathname === '/ste/helpers' || pathname === '/ste/helpers/save' || pathname === '/ste/helpers/import') {
          const locator = { ...selected }, store = createRuntimeStore(locator.storyId).underStoryLock!;
          const path = `.ste-control/roleplay/${branchKey(locator.branchId)}/helpers.json`;
          let result: unknown;
          const saved = await updateArchiveStory(locator.storyId, async current => {
            if (!isCurrent() || selected.key !== locator.key || !getBranchLine(current, locator.branchId)) throw new Error('脚本所属聊天已切换');
            const raw = await store.read(path);
            let settings = normalizeHelperSettings(raw === null ? {} : JSON.parse(raw));
            if (pathname !== '/ste/helpers') {
              if (body.chatKey !== locator.key || body.revision !== digest(raw ?? '')) throw new Error('脚本设置已变化，请重新打开面板');
              settings = pathname.endsWith('/import') ? normalizeHelperSettings({ ...settings, scripts: [...settings.scripts, ...importHelperScripts(body.scripts)] })
                : normalizeHelperSettings(body.settings);
              if (!isCurrent() || selected.key !== locator.key) throw new Error('脚本所属聊天已切换');
              await store.write(path, JSON.stringify(settings));
            }
            result = { chatKey: locator.key, revision: digest(pathname === '/ste/helpers' ? raw ?? '' : JSON.stringify(settings)), settings };
            return undefined;
          }, repos.stories);
          if (!saved) throw new Error('脚本所属故事不存在');
          return json(result);
        }
        if (pathname === '/ste/extensions') return json({ baibai: preferences.installedBaiBai
          ? { version: preferences.installedBaiBai.version, installedAt: preferences.installedBaiBai.installedAt } : null, supported: BAIBAI_PIN });
        if (pathname === '/ste/extensions/install') {
          if (generation || controllers.size) throw new Error('请等待当前生成与后台请求结束后再安装插件');
          if (!Array.isArray(body.bytes)) throw new Error('缺少插件 ZIP');
          const installedBaiBai = readBaiBaiZip(new Uint8Array(body.bytes));
          await persistPreferences({ installedBaiBai });
          return json({ version: installedBaiBai.version });
        }
        if (pathname === '/ste/extensions/remove') {
          if (generation || controllers.size) throw new Error('请等待当前生成与后台请求结束后再移除插件');
          await persistPreferences({ installedBaiBai: null });
          return json({});
        }
        if (pathname === '/ste/extensions/package') {
          const pkg = preferences.installedBaiBai;
          return json(pkg ? { ...pkg, module: linkBaiBaiModule(pkg) } : null);
        }
        if (pathname === '/ste/runtime') {
          const runtime = runtimeFor(selected);
          if (body.mode !== undefined || body.memoryOwner !== undefined) {
            if (generation || controllers.size) throw new Error('请先等待或停止生成与后台请求，再切换模式或记忆维护者');
            const config = await runtime.configuration();
            if (body.memoryOwner === 'baibai' && !preferences.installedBaiBai) throw new Error('请先在本面板安装柏宝书 1.2.7 原版 ZIP');
            await runtime.configure({ mode: (body.mode ?? config.mode) as RuntimeConfiguration['mode'],
              memoryOwner: (body.memoryOwner ?? config.memoryOwner) as RuntimeConfiguration['memoryOwner'] });
          }
          const config = await runtime.configuration();
          return json({ ...config, status: runtime.status(), contextReserveTokens: config.mode === 'agent' ? await runtime.ledger.reserve() : 0,
            storyId: selected.storyId, branchId: selected.branchId, chatKey: selected.key });
        }
        if (pathname.startsWith('/ste/draft')) {
          const locator = { ...selected };
          if (body.chatKey !== undefined && body.chatKey !== locator.key) throw new Error('草稿所属聊天已切换');
          const store = createRuntimeStore(locator.storyId).underStoryLock!;
          const path = `.ste-control/roleplay/${branchKey(locator.branchId)}/draft.json`;
          const acknowledged = (sessions.get(locator.key) ?? await liveSession(locator)).payload();
          let result: unknown = null;
          await updateArchiveStory(locator.storyId, async story => {
            if (!isCurrent()) throw new Error('文件库已切换');
            const line = getBranchLine(story, locator.branchId);
            if (!line) throw new Error('草稿所属分支不存在');
            if (pathname === '/ste/draft/capture') {
              const base = decodeLiveChat(acknowledged, line.session);
              const live = decodeLiveChat(body.chat, base);
              const edit = object(body.editor);
              const draft = checkpointDraft(base, live, String(body.input ?? ''),
                typeof edit.index === 'number' && typeof edit.text === 'string' ? { index: edit.index, text: edit.text } : undefined);
              if (!draft.input && !draft.changes.length && !draft.order) await store.remove(path);
              else await store.write(path, JSON.stringify(draft));
              result = { savedAt: draft.savedAt };
            } else if (pathname === '/ste/draft/discard') { await store.remove(path); }
            else {
              const text = await store.read(path);
              if (text) {
                const draft = JSON.parse(text) as DraftCheckpoint;
                const recovered = recoverDraft(line.session, draft);
                if (pathname === '/ste/draft/restore' && recovered.conflict) throw new Error('原故事已变化，请从草稿中复制需要的文字');
                result = { draft, conflict: recovered.conflict, changed: recovered.changed,
                  ...(pathname === '/ste/draft/restore' ? { chat: encodeLiveChat(recovered.session), input: recovered.input } : {}) };
              }
            }
            return undefined;
          }, repos.stories);
          if (pathname === '/ste/draft/restore') { sessions.get(locator.key)?.close(); sessions.delete(locator.key); }
          return json(result);
        }
        if (pathname === '/ste/runtime/status') return json(runtimeFor(selected).status());
        if (pathname === '/ste/regex-assets') return json(await regexSnapshot(selected));
        if (pathname === '/ste/regex-assets/save') {
          const locator = { ...selected };
          if (body.chatKey !== locator.key) throw new Error('正则编辑器所属聊天已切换');
          const result = await (await regexFor(locator)).save(body as unknown as RegexAssetSaveInput);
          return json({ ...result, snapshot: await regexSnapshot(locator) });
        }
        if (pathname === '/ste/runtime/confirm-candidate') {
          await runtimeFor(selected).confirmCandidate(String(body.turnId), { messageId: String(body.messageId),
            candidateId: String(body.candidateId), content: String(body.content) });
          return json({});
        }
        if (pathname === '/ste/worldbook-versions') {
          const versions = await versionsFor(selected).list();
          return json(await Promise.all(versions.map(async version => {
            const world = await repos.worldbooks.get(version.worldId);
            return { ...version, worldName: world?.title ?? version.worldId,
              entryName: world?.worldbook.entries[version.entryId]?.comment ?? version.entryId,
              originalContent: world?.worldbook.entries[version.entryId]?.content ?? '' };
          })));
        }
        if (pathname === '/ste/story-worlds') {
          const story = await repos.stories.get(selected.storyId), entries: JsonObject[] = [];
          for (const reference of story?.assets ?? []) {
            if (reference.kind !== 'worldbook') continue;
            const name = assets.worldName(reference.assetId);
            if (!name) continue;
            const data = await assets.readWorld(name);
            for (const entry of Object.values(object(data.entries))) entries.push({ ...object(entry), world: name });
          }
          return json(entries);
        }
        if (pathname === '/ste/worldbook-versions/accept' || pathname === '/ste/worldbook-versions/reject') {
          if (generation) throw new Error('请先停止生成，再决定世界书版本');
          const versions = versionsFor(selected);
          return json(await (pathname.endsWith('/accept') ? versions.accept(String(body.id)) : versions.reject(String(body.id))));
        }
        if (pathname === '/ste/worldbook-versions/effective') {
          const versions = (await versionsFor(selected).list()).filter(version => version.status === 'active');
          return json(versions.map(version => ({ world: assets.worldName(version.worldId), uid: version.entryId,
            content: version.content, version: version.version })));
        }
        if (pathname === '/ste/memory') return json(await runtimeFor(selected).memory.list());
        if (pathname === '/ste/memory/save') {
          const runtime = runtimeFor(selected);
          return json(await runtime.memory.commit({ operationId: crypto.randomUUID(), sourceRefs: [], manual: true,
            changes: [{ path: String(body.path), body: String(body.body), expectedDigest: body.expectedDigest === null ? null : String(body.expectedDigest) }] }));
        }
        if (pathname === '/ste/runtime/retry-memory') { await runtimeFor(selected).resume(true); return json({}); }
        if (pathname === '/ste/runtime/reset-context') {
          if (generation) throw new Error('请先停止生成');
          await runtimeFor(selected).ledger.reset(); return json({});
        }
        if (pathname === '/ste/configuration') {
          if (body.mainProfileId !== undefined || body.toolProfileId !== undefined) {
            if (generation) throw new Error('请先停止当前生成，再切换模型');
            const { profiles } = loadApiProfiles();
            for (const key of ['mainProfileId', 'toolProfileId'] as const) {
              if (body[key] !== undefined && !profiles.some(p => p.id === body[key])) throw new Error('连接配置不存在');
            }
            await persistPreferences({
              ...(typeof body.mainProfileId === 'string' ? { mainProfileId: body.mainProfileId } : {}),
              ...(typeof body.toolProfileId === 'string' ? { toolProfileId: body.toolProfileId } : {}),
            });
          }
          const { profiles } = loadApiProfiles();
          return json({ mainProfileId: mainProfile().id, toolProfileId: preferences.toolProfileId ?? mainProfile().id,
            profiles: profiles.map(p => ({ id: p.id, name: p.name, model: p.model, apiUrl: p.apiUrl })) });
        }
        if (pathname === '/ste/manage-profiles') { options.onManageProfiles?.(); return json({}); }
        if (pathname === '/ste/manage') {
          const story = await repos.stories.get(selected.storyId);
          const destinations: Record<string, string | undefined> = { library: '/library', worldbook: '/worldbook', assets: '/assets',
            story: '/story/' + encodeURIComponent(selected.storyId),
            character: story?.characterId ? '/character/' + encodeURIComponent(story.characterId) : '/library' };
          const target = String(body.target);
          if (!Object.hasOwn(destinations, target)) throw new Error('未知的管理页面');
          options.onManagePage?.(destinations[target]!); return json({});
        }
        if (pathname === '/ste/invoke') {
          if (body.command === 'get_tauritavern_settings') return json({ chat_virtualization_enabled: true });
          if (body.command === 'get_client_version') return json(version);
          if (body.command === 'get_version') return json('STE');
          if (['chat_history_generation_started', 'chat_history_generation_finished'].includes(String(body.command))) {
            const locator = object(object(body.args).locator);
            const target = locator.kind === 'character' ? await catalog.locate(String(locator.characterId) + '.png', String(locator.fileName)) : undefined;
            if (!target || body.command === 'chat_history_generation_started' && target.key !== selected.key) {
              throw new Error('生成目标与当前故事不匹配');
            }
            if (body.command === 'chat_history_generation_started') {
              if (generation) throw new Error('已有生成尚未结束');
              generation = { fileName: String(locator.fileName), key: target.key, id: crypto.randomUUID() };
              options.onGeneration?.(true);
            } else {
              if (!generation || generation.key !== target.key) throw new Error('没有匹配的生成任务');
              try { await (await liveSession(target)).flush(); }
              finally { generation = null; options.onGeneration?.(false); }
            }
            return json(null);
          }
          return json({ error: { message: `尚未接入的宿主命令：${String(body.command)}` } }, 501);
        }
        if (pathname.startsWith('/api/tokenizers/')) return json(tokenizeTavern(path, value));
        if (pathname === '/api/secrets/settings') return json({ allowKeysExposure: false });
        if (pathname === '/api/secrets/read') return json({});
        if (pathname === '/api/avatars/get') return json(defaults.avatars ?? []);
        if (pathname === '/api/stats/get') return json(preferences.stats ?? {});
        if (pathname === '/api/stats/update') {
          await persistPreferences({ stats: body });
          return json({ result: 'ok' });
        }
        if (pathname === '/api/backgrounds/all') return json({ images: defaults.backgrounds ?? [], config: {} });
        if (pathname === '/api/backgrounds/folders') return json({ folders: [], imageFolderMap: {} });
        if (pathname === '/api/image-metadata/all') return json({ images: {} });
        if (pathname === '/api/extensions/discover') return json([{ name: 'regex', type: 'system' },
          ...(preferences.installedBaiBai ? [{ name: 'third-party/ST-BaiBai-Book', type: 'local' }] : [])]);
        if (pathname === '/api/bootstrap') return json({
          settings: settingsSnapshot(), characters: await characterDtos(), groups: [], avatars: defaults.avatars ?? [],
          secret_state: {}, ios_policy: null,
        });
        if (pathname === '/api/settings/get') return json(settingsSnapshot());
        if (pathname === '/api/settings/save') {
          const tavern = structuredClone(body);
          const oai = object(tavern.oai_settings);
          customHeaders(oai.custom_include_headers);
          for (const key of ['api_key', 'api_key_openai', 'api_key_custom', 'proxy_password', 'secret_id', 'custom_url', 'custom_model']) delete oai[key];
          tavern.oai_settings = oai;
          delete tavern.api_key;
          await persistPreferences({ tavern });
          return json({ result: 'ok' });
        }
        if (pathname === '/api/backends/chat-completions/status') return json({
          bypass: true, data: [...new Set([mainProfile().model, ...mainProfile().modelList ?? []])].map(id => ({ id })),
        });
        if (pathname === '/api/backends/chat-completions/generate') return await generate(body, signal);
        if (pathname === '/api/characters/all') return json(await characterDtos());
        if (pathname === '/api/characters/get') {
          const character = (await characterDtos()).find(c => c.avatar === body.avatar_url);
          if (!character) throw new Error('角色不存在');
          return json(character);
        }
        if (pathname === '/api/characters/chats') {
          return json(await catalog.chats(String(body.avatar_url)));
        }
        if (pathname === '/api/chats/search') {
          const avatar = String(body.avatar_url), query = String(body.query ?? '').toLocaleLowerCase();
          const entries = await catalog.chats(avatar);
          const results = [];
          for (const entry of entries) {
            let preview = entry.mes;
            if (query && !entry.display_name.toLocaleLowerCase().includes(query)) {
              const source = await catalog.existingLine(avatar, entry.file_name);
              const found = source?.line.session.messages.find(message => message.content.toLocaleLowerCase().includes(query));
              if (!found) continue;
              preview = found.content;
            }
            results.push({ ...entry, file_name: entry.file_name.replace(/\.jsonl$/i, ''), message_count: entry.chat_items,
              file_size: `${(entry.file_size / 1024).toFixed(1)} KB`, preview_message: preview.slice(0, 500) });
          }
          return json(results);
        }
        if (pathname === '/api/characters/edit' || pathname === '/api/characters/merge-attributes') {
          const avatar = String(body.avatar_url ?? body.avatar);
          const character = characters.find(item => avatarKey(item.id) === avatar);
          // Synthetic characters belong to an unbound story; chat selection still works.
          if (typeof body.chat === 'string') selectedChats.set(avatar, body.chat);
          if (!character) {
            if ((await catalog.characters()).some(item => item.avatar === avatar) && typeof body.chat === 'string') return json({});
            throw new Error('角色不存在');
          }
          const avatarFile = object(body.avatar);
          if (typeof avatarFile.size === 'number' && avatarFile.size > 0) throw new Error('请在 STE 角色库中更换卡面');
          if (!isCurrent()) throw new Error('文件库已切换');
          // Embedded collections are authoritative; keep the card's exported copy synchronized.
          const incomingExtensions = object(object(body.data).extensions);
          if (Array.isArray(incomingExtensions.regex_scripts)) {
            const embedded = await Promise.all((character.assets ?? []).filter(ref => ref.kind === 'regex' && ref.relations?.includes('embedded'))
              .map(ref => repos.regexes.get(ref.assetId)));
            const linked = embedded.flatMap(asset => asset?.rules.map(ruleToSTScript) ?? []);
            const ids = new Set(linked.map(script => script.id));
            incomingExtensions.regex_scripts = [...incomingExtensions.regex_scripts.filter(script => !ids.has(object(script).id as string)), ...linked];
          }
          const updated = await updateCharacter(character.id, current => {
            if (!isCurrent()) throw new Error('文件库已切换');
            if (pathname.endsWith('/edit') && (typeof body._ste_revision === 'string' ? body._ste_revision : cardEditorVersions.get(character.id)) !== digest(stableJson(current.card))) {
              throw new Error('角色卡已被其他编辑修改，请重新打开后保存');
            }
            const card = structuredClone(current.card);
            const data = object(card.data ?? card);
            const extensions = object(data.extensions);
            const incoming = object(body.data);
            for (const [key, value] of Object.entries(object(incoming.extensions))) {
              if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('无效的扩展字段');
              extensions[key] = structuredClone(value);
            }
            if (pathname.endsWith('/edit')) {
              const fields = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'creator', 'character_version'];
              for (const field of fields) if (typeof body[field] === 'string') data[field] = body[field];
              if (typeof body.ch_name === 'string' && body.ch_name.trim()) data.name = body.ch_name;
              if (body.alternate_greetings !== undefined) data.alternate_greetings = Array.isArray(body.alternate_greetings) ? body.alternate_greetings : [body.alternate_greetings];
              if (typeof body.world === 'string') extensions.world = body.world;
              if (body.fav !== undefined) extensions.fav = body.fav === true || body.fav === 'true';
              if (typeof body.talkativeness === 'string' && Number.isFinite(Number(body.talkativeness))) extensions.talkativeness = Number(body.talkativeness);
            }
            data.extensions = extensions;
            const worldId = typeof extensions.world === 'string' ? assets.worldId(extensions.world) : undefined;
            const refs = typeof body.world === 'string' ? (current.assets ?? []).filter(ref => ref.kind !== 'worldbook' || ref.relations?.includes('extra')) : current.assets;
            const nextCard = card.data ? { ...card, data } : data;
            if (stableJson(nextCard) === stableJson(current.card) && typeof body.world !== 'string') return undefined;
            const pngBase64 = current.pngBase64 && stableJson(nextCard) !== stableJson(current.card)
              ? bytesToBase64(embedCharaInPng(base64ToBytes(current.pngBase64).buffer as ArrayBuffer, nextCard)) : current.pngBase64;
            return { card: nextCard, name: String(data.name ?? current.name), updatedAt: Date.now(), pngBase64,
              ...(typeof body.world === 'string' ? { assets: [...refs ?? [], ...(worldId ? [{ kind: 'worldbook' as const, assetId: worldId, relations: ['primary' as const] }] : [])] } : {}) };
          });
          if (updated) characters.splice(characters.indexOf(character), 1, updated);
          if (updated && pathname.endsWith('/edit')) cardEditorVersions.set(character.id, digest(stableJson(updated.card)));
          return json(updated ? { _ste_revision: digest(stableJson(updated.card)) } : {});
        }
        if (pathname === '/api/chats/get' || pathname === '/api/chats/save') {
          const avatar = String(body.avatar_url), name = String(body.file_name);
          if (pathname.endsWith('/get')) {
            const locator = await catalog.locate(avatar, name);
            if (controllers.size && locator?.key !== generation?.key) throw new Error('请先停止生成再切换聊天');
            if (!locator) return json([]);
            await inheritRuntime(locator);
            if (selected.key !== locator.key) {
              await (await liveSession(selected)).flush();
              selected = locator; options.onSelect?.(locator);
            }
            await runtimeFor(locator).resume();
            selectedChats.set(avatar, locator.fileName);
            return json((await liveSession(locator)).payload());
          }
          const target = await catalog.resolveForSave(avatar, name, body.chat);
          await inheritRuntime(target);
          const live = await liveSession(target);
          let commit: StoryCommit;
          if (target.created) {
            const current = (await catalog.existingLine(avatar, name))!.line.session;
            commit = { storyId: target.storyId, branchId: target.branchId, previous: { ...current, messages: [] }, session: current };
          } else commit = await live.save(body.chat);
          // Checkpoint saves target a new branch without necessarily navigating to it.
          if (!object((body.chat as unknown[])?.[0]).chat_metadata || !object(object((body.chat as unknown[])?.[0]).chat_metadata).main_chat) {
            selected = target; options.onSelect?.(target);
            selectedChats.set(avatar, target.fileName);
          }
          // Observers run after repo.put resolves; their failure cannot undo a saved reply.
          try { await runtimeFor(target).afterCommit(commit); } catch (error) { runtimeFor(target).fail(error); }
          try { options.onCommit?.(commit); } catch { /* The caller owns background task error reporting. */ }
          return json({ result: 'ok' });
        }
        if (pathname === '/api/chats/export') {
          if (body.is_group || !['txt', 'jsonl'].includes(String(body.format))) throw new Error('当前可导出单角色聊天的 JSONL 或纯文本');
          const locator = await catalog.locate(String(body.avatar_url), String(body.file));
          if (!locator) throw new Error('要导出的聊天不存在');
          await (await liveSession(locator)).flush();
          const current = await catalog.existingLine(String(body.avatar_url), String(body.file));
          if (!current) throw new Error('要导出的聊天已删除');
          const payload = encodeLiveChat(current.line.session);
          return json({ result: body.format === 'jsonl' ? payload.map(row => JSON.stringify(row)).join('\n')
            : payload.slice(1).filter(row => row.is_system !== true).map(row => `${row.name}: ${row.mes}`).join('\n\n') });
        }
        if (pathname === '/api/chats/rename') {
          if (generation) throw new Error('请先停止生成再重命名聊天');
          const result = await catalog.rename(String(body.avatar_url), String(body.original_file), String(body.renamed_file));
          sessions.get(result.locator.key)?.close(); sessions.delete(result.locator.key);
          if (selected.key === result.locator.key) { selected = result.locator; options.onSelect?.(selected); }
          selectedChats.set(result.locator.avatar, result.locator.fileName);
          return json({ sanitizedFileName: result.sanitizedFileName });
        }
        if (pathname === '/api/worldinfo/get') {
          return json(await assets.readWorld(String(body.name)));
        }
        if (pathname === '/api/worldinfo/edit') {
          return json(await assets.saveWorld(String(body.name), body.data));
        }
        if (pathname === '/api/worldinfo/delete') {
          await assets.deleteWorld(String(body.name));
          return json({});
        }
        if (pathname === '/api/presets/save') {
          if (body.apiId !== 'openai') throw new Error('当前连接使用 Chat Completion 预设');
          await assets.savePreset(String(body.name), body.preset);
          return json({ name: body.name });
        }
        if (pathname === '/api/presets/delete') {
          if (body.apiId !== 'openai') throw new Error('当前连接使用 Chat Completion 预设');
          await assets.deletePreset(String(body.name));
          return json({});
        }
        return json({ error: { message: `尚未接入的酒馆接口：${pathname}` } }, 501);
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (path.split('?')[0] === '/api/chats/save') {
          try { options.onSaveError?.(message); } catch { /* Reporting must not hide the write failure. */ }
        }
        return json({ error: { message } }, 409);
      }
    },
    tokenize: tokenizeTavern,
    thumbnail(type: string, file: string) {
      if (type === 'bg') return `/backgrounds/${encodeURIComponent(file)}`;
      const character = characters.find(c => avatarKey(c.id) === file);
      return character?.pngBase64 ? `data:image/png;base64,${character.pngBase64}` : '/img/ai4.png';
    },
    async flush() {
      for (const live of sessions.values()) await live.flush();
      await settingsWrite;
      if (settingsError !== undefined) throw settingsError;
      for (const runtime of runtimes.values()) await runtime.flush();
    },
    close() {
      closed = true;
      unsubscribeVault();
      for (const controller of controllers) controller.abort();
      for (const live of sessions.values()) live.close();
      for (const runtime of runtimes.values()) runtime.close();
    },
  };
}
