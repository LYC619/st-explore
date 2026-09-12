/** Pure projections of the upstream ST objects. They never own a second chat store. */
export function helperMessageSource(message) {
    return JSON.stringify([message.extra?.ste_runtime?.messageId, message.extra?.ste_runtime?.candidateId,
        message.swipe_id ?? 0, message.mes, message.is_user === true, message.is_system === true]);
}
function publicExtra(extra) {
    const copy = structuredClone(extra ?? {});
    delete copy.ste_runtime;
    return copy;
}
export function helperMessages(chat) {
    return chat.map((message, message_id) => {
        const index = message.swipe_id ?? 0, swipes = message.swipes ?? [message.mes ?? ''];
        const role = message.is_user ? 'user' : message.extra?.ste_runtime?.role === 'system' || ['narrator', 'system', 'comment'].includes(message.extra?.type) ? 'system' : 'assistant';
        return { message_id, name: message.name ?? '', role, is_hidden: message.is_system === true,
            message: message.mes ?? '', data: structuredClone(message.variables?.[index] ?? {}), extra: publicExtra(message.extra),
            swipe_id: index, swipes: [...swipes], swipes_data: swipes.map((_, i) => structuredClone(message.variables?.[i] ?? {})),
            swipes_info: swipes.map((_, i) => { const info = structuredClone(message.swipe_info?.[i] ?? {}); info.extra = publicExtra(info.extra); return info; }) };
    });
}
function dictionary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('楼层变量与 extra 必须是 JSON 对象');
    return structuredClone(value);
}
export function prepareHelperMessageChanges(chat, patches, sources, baselines = []) {
    if (!Array.isArray(patches) || patches.length > 100) throw new Error('每次最多修改 100 条消息');
    const seen = new Set(), fields = new Set(['message_id', 'message', 'data', 'extra', 'is_hidden']);
    return patches.map(patch => {
        if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !fields.has(key))) throw new Error('暂不支持此消息字段；可修改 message、data、extra、is_hidden');
        const id = patch.message_id;
        if (!Number.isInteger(id) || id < 0 || id >= chat.length || seen.has(id)) throw new Error('消息编号无效或重复');
        seen.add(id);
        if (sources[id] !== helperMessageSource(chat[id])) throw new Error('楼层或候选已变化，请读取最新消息后重试');
        const message = structuredClone(chat[id]), index = message.swipe_id ?? 0;
        if ('data' in patch && JSON.stringify(message.variables?.[index] ?? {}) !== JSON.stringify(baselines[id]?.data)) throw new Error('楼层变量已变化，请重新读取后再修改');
        if ('extra' in patch && JSON.stringify(publicExtra(message.extra)) !== JSON.stringify(baselines[id]?.extra)) throw new Error('楼层扩展数据已变化，请重新读取后再修改');
        if ('message' in patch) {
            if (typeof patch.message !== 'string' || patch.message.length > 1024 * 1024) throw new Error('消息正文无效或过长');
            message.mes = patch.message;
            if (message.swipes) message.swipes[index] = patch.message;
        }
        if ('is_hidden' in patch) {
            if (typeof patch.is_hidden !== 'boolean') throw new Error('隐藏状态必须是布尔值');
            message.is_system = patch.is_hidden;
        }
        if ('data' in patch) {
            message.variables ??= [];
            message.variables[index] = dictionary(patch.data);
        }
        if ('extra' in patch) message.extra = { ...dictionary(patch.extra), ste_runtime: message.extra?.ste_runtime };
        if (message.mes !== chat[id].mes || message.is_system !== chat[id].is_system) {
            if (message.extra?.ste_runtime) delete message.extra.ste_runtime.turnId;
        }
        if (message.swipe_info?.[index]) message.swipe_info[index].extra = structuredClone(message.extra ?? {});
        return { id, message };
    });
}
