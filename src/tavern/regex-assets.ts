import { loadUpstream, type ScriptTree } from './upstream.js';
import type { RequestHost } from './bridge-types.js';
import type { RegexAssetsSnapshot } from './protocol.js';
import type { STRegexScript } from '../lib/st-regex-interop';

/** Linked STE collections are presented in the genuine upstream regex editor and engine. */
export function filterEmbeddedRegexScripts(
    scripts: STRegexScript[],
    snapshot: Pick<RegexAssetsSnapshot, 'suppressedEmbeddedIds' | 'suppressedEmbeddedScripts'>,
): STRegexScript[] {
    const stable = (value: unknown): unknown => value && typeof value === 'object'
        ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [key, stable((value as Record<string, unknown>)[key])])) : value;
    const signature = ({ id: _id, ...script }: STRegexScript): string => JSON.stringify(stable(script));
    const pending = [...(snapshot.suppressedEmbeddedScripts ?? [])];
    return scripts.filter(script => {
        const index = pending.findIndex(source => source.id ? source.id === script.id : signature(source) === signature(script));
        if (index >= 0) { pending.splice(index, 1); return false; }
        return !(script.id && snapshot.suppressedEmbeddedIds.includes(script.id));
    });
}

export function installRegexAssets(host: RequestHost): () => Promise<boolean> {
    let snapshot: RegexAssetsSnapshot = { globalScripts: [], embeddedScripts: [], revisions: {}, suppressedEmbeddedIds: [] };
    // Older work copies and imported minimal rules may omit this upstream field.
    // Apply defaults only to the executable projection, preserving source bytes.
    const frontendRules = () => (snapshot.frontend?.rules ?? []).map(item => ({ ...item,
        script: { ...item.script, trimStrings: Array.isArray(item.script.trimStrings) ? item.script.trimStrings : [] } }));
    // Applying this branch's copy is explicit consent for these rules. Keep the
    // original character allowlist in charge of every other embedded rule.
    window.__STE_ALLOWED_FRONTEND_REGEX__ = () => frontendRules()
        .filter(item => item.lane === 'embeddedScripts').map(item => item.script);
    window.__STE_REGEX_REQUIRING_CONSENT__ = scripts => {
        const applied = new Set(window.__STE_ALLOWED_FRONTEND_REGEX__().map(script => script.id));
        return scripts.filter(script => !applied.has(script.id));
    };
    window.__STE_REGEX_LANE__ = (lane, ordinary) => {
        const scripts = lane === 'embeddedScripts' ? filterEmbeddedRegexScripts(ordinary, snapshot) : ordinary;
        const overrides = new Map(frontendRules().filter(item => item.lane === lane).map(item => [item.script.id, item.script]));
        const result = [...scripts, ...snapshot[lane]].map(script => {
            const replacement = overrides.get(script.id);
            if (!replacement) return script;
            overrides.delete(script.id); return replacement;
        });
        return [...result, ...overrides.values()];
    };
    window.__STE_SAVE_REGEX_LANE__ = async (scripts, type) => {
        const lane = type === 0 ? 'globalScripts' : type === 1 ? 'embeddedScripts' : null;
        if (!lane) return scripts;
        const response = await host.request('/ste/regex-assets/save', { chatKey: snapshot.chatKey, revisions: snapshot.revisions, [lane]: scripts });
        const result = await response.json() as { error?: { message?: string }; snapshot: RegexAssetsSnapshot; globalScripts?: STRegexScript[]; embeddedScripts?: STRegexScript[] };
        if (!response.ok) { toastr.error(result.error?.message ?? '正则未保存'); throw new Error(result.error?.message ?? '正则未保存'); }
        snapshot = result.snapshot;
        return result[lane] ?? scripts;
    };
    return async function refresh(): Promise<boolean> {
        const response = await host.request('/ste/regex-assets');
        const result = await response.json() as RegexAssetsSnapshot & { error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message ?? '正则资产加载失败');
        const renderingRules = (value: RegexAssetsSnapshot) => [value.globalScripts, value.embeddedScripts, value.suppressedEmbeddedIds,
            value.suppressedEmbeddedScripts ?? [], value.frontend?.rules ?? []];
        const changed = JSON.stringify(renderingRules(snapshot)) !== JSON.stringify(renderingRules(result));
        snapshot = result;
        if (window.TavernHelper?.getScriptTrees) {
            const current = window.TavernHelper.getScriptTrees({ type: 'global' });
            const strip = (trees: ScriptTree[]): ScriptTree[] => trees.filter(script => !script.id?.startsWith('ste-frontend:'))
                .map(script => Array.isArray(script.scripts) ? { ...script, scripts: strip(script.scripts) } : script);
            const ordinary = strip(current);
            // CHAT_CHANGED can arrive after an initial script has already run,
            // before Helper's debounced settings write has reached the host.
            const running = new Map<string, ScriptTree>();
            const collect = (trees: ScriptTree[]): void => trees.forEach(script => {
                if (script.id?.startsWith('ste-frontend:')) running.set(script.id, script);
                if (Array.isArray(script.scripts)) collect(script.scripts);
            });
            collect(current);
            const applied: ScriptTree[] = (snapshot.frontendScripts ?? []).map(script => script.id && running.has(script.id)
                ? { ...script, data: running.get(script.id)!.data } : script);
            const next = [...ordinary, ...applied];
            if (JSON.stringify(current) !== JSON.stringify(next)) window.TavernHelper.replaceScriptTrees(next, { type: 'global' });
        }
        if (snapshot.missingAssetIds?.length) toastr.warning('关联正则资产缺失：' + snapshot.missingAssetIds.join('、'));
        const regex = await loadUpstream('/scripts/extensions/regex/index.js');
        await regex.loadRegexScripts();
        const native = document.querySelector<HTMLElement>('#regex_native_backend_toggle_button');
        if (native) { native.style.display = 'none'; }
        return changed;
    };
}
