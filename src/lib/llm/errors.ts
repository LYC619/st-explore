import { isTauri } from '@/lib/runtime';
export const LLM_MESSAGES = {
    permission: '密钥无效或没有访问权限，请检查连接配置。',
    rate_limit: '服务请求过于频繁，请稍后再试。',
    service: '模型服务暂时不可用，请稍后再试。',
    network: '连接模型服务失败，请检查网络和接口地址。',
    timeout: '等待模型回复超时，已停止等待；服务端可能仍在处理。',
    invalid_request: '请求参数或接口地址不正确，请检查模型和配置。',
    blocked: '服务的内容安全策略拦截了本次回复。',
    empty: '模型返回了空回复，没有可保存的内容。',
    truncated: '回复因长度限制被截断，已保留收到的内容。',
    interrupted: '回复中途断开，已保留收到的部分内容。',
    parse: '服务返回的内容无法解析，请检查接口格式。',
    cancelled: '已取消生成。',
} as const;
export type LLMErrorCategory = keyof typeof LLM_MESSAGES;
export class LLMError extends Error {
    readonly category: LLMErrorCategory;
    readonly attempts: number;
    readonly status?: number;
    readonly retryAfterMs?: number;
    declare readonly partialText: string;
    constructor(category: LLMErrorCategory, options: {
        attempts: number;
        status?: number;
        partialText?: string;
        retryAfterMs?: number;
    }) {
        const browserNote = category === 'network' && !isTauri() ? ' 网页版也可能受到跨域限制，桌面版不受此限制。' : '';
        const details = [...(options.status ? [`HTTP ${options.status}`] : []), options.attempts ? `已尝试 ${options.attempts} 次` : '尚未发送请求'];
        super(LLM_MESSAGES[category] + browserNote + (category === 'cancelled' ? '' : `（${details.join('；')}）`));
        this.name = category === 'cancelled' ? 'AbortError' : 'LLMError';
        this.category = category;
        this.attempts = options.attempts;
        this.status = options.status;
        this.retryAfterMs = options.retryAfterMs;
        // Partial output is for the local editor, never enumerable diagnostic metadata.
        Object.defineProperty(this, 'partialText', { value: options.partialText ?? '', enumerable: false });
    }
}
export function isLLMCancelled(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError'; }
export function statusCategory(status: number): LLMErrorCategory {
    if (status === 401 || status === 403)
        return 'permission';
    if (status === 429)
        return 'rate_limit';
    if (status === 408 || status === 504 || status === 524)
        return 'service';
    if (status >= 500 || status === 425)
        return 'service';
    return 'invalid_request';
}
export function embeddedCategory(value: unknown): LLMErrorCategory {
    const error = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const hints = typeof value === 'string'
        ? value
        : [error.code, error.status, error.type, error.message].filter(v => typeof v === 'string' || typeof v === 'number').map(String).join(' ');
    if (/content[_ -]?filter|content[_ -]?policy|safety|moderation|blocked|prohibited[_ -]?content|recitation|blocklist|spii|refusal|安全|审核|拦截/i.test(hints))
        return 'blocked';
    if (/rate[_ -]?limit|quota|resource[_ -]?exhausted|429/i.test(hints))
        return 'rate_limit';
    if (/authentication|invalid[_ -]?api[_ -]?key|api[_ -]?key[_ -]?invalid|permission|unauthenticated|forbidden|401|403/i.test(hints))
        return 'permission';
    if (/invalid[_ -]?request|invalid[_ -]?argument|bad[_ -]?request|400/i.test(hints))
        return 'invalid_request';
    return 'service';
}
