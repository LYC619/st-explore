/** Linked STE collections are presented in the genuine upstream regex editor and engine. */
export function filterEmbeddedRegexScripts(scripts, snapshot) {
    const stable = value => value && typeof value === 'object'
        ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    const signature = ({ id: _id, ...script }) => JSON.stringify(stable(script));
    const pending = [...snapshot.suppressedEmbeddedScripts ?? []];
    return scripts.filter(script => {
        const index = pending.findIndex(source => source.id ? source.id === script.id : signature(source) === signature(script));
        if (index >= 0) { pending.splice(index, 1); return false; }
        return !snapshot.suppressedEmbeddedIds.includes(script.id);
    });
}

export function installRegexAssets(host) {
    let snapshot = { globalScripts: [], embeddedScripts: [], revisions: {}, suppressedEmbeddedIds: [] };
    window.__STE_REGEX_LANE__ = (lane, ordinary) => {
        const scripts = lane === 'embeddedScripts' ? filterEmbeddedRegexScripts(ordinary, snapshot) : ordinary;
        return [...scripts, ...snapshot[lane]];
    };
    window.__STE_SAVE_REGEX_LANE__ = async (scripts, type) => {
        const lane = type === 0 ? 'globalScripts' : type === 1 ? 'embeddedScripts' : null;
        if (!lane) return scripts;
        const response = await host.request('/ste/regex-assets/save', { chatKey: snapshot.chatKey, revisions: snapshot.revisions, [lane]: scripts });
        const result = await response.json();
        if (!response.ok) { toastr.error(result.error?.message ?? '正则未保存'); throw new Error(result.error?.message ?? '正则未保存'); }
        snapshot = result.snapshot;
        return result[lane];
    };
    return async function refresh() {
        const response = await host.request('/ste/regex-assets');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? '正则资产加载失败');
        snapshot = result;
        if (snapshot.missingAssetIds.length) toastr.warning('关联正则资产缺失：' + snapshot.missingAssetIds.join('、'));
        const regex = await import('/scripts/extensions/regex/index.js');
        await regex.loadRegexScripts();
        const native = document.querySelector('#regex_native_backend_toggle_button');
        if (native) { native.style.display = 'none'; }
    };
}
