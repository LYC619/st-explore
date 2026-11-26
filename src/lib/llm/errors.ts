import { getLocale, tr } from '@/lib/i18n';
import { isTauri } from '@/lib/runtime';
export const LLM_MESSAGES = {
    get permission() { return tr("密钥无效或没有访问权限，请检查连接配置。"); },
    get rate_limit() { return tr("服务请求过于频繁，请稍后再试。"); },
    get service() { return tr("模型服务暂时不可用，请稍后再试。"); },
    get network() { return tr("连接模型服务失败，请检查网络和接口地址。"); },
    get timeout() { return tr("等待模型回复超时，已停止等待；服务端可能仍在处理。"); },
    get invalid_request() { return tr("请求参数或接口地址不正确，请检查模型和配置。"); },
    get blocked() { return tr("接口的内容安全策略拦截了本次回复，可在「设置 → AI 配置」切换模型或调整提示词后再试。"); },
    get empty() { return tr("模型这次返回了空回，没有可保存的内容；可点重试，或在「AI 配置」中切换其他模型。"); },
    get truncated() { return tr("回复因长度限制被截断，已保留收到的内容。"); },
    get interrupted() { return tr("回复中途断开，已保留收到的部分内容。"); },
    get parse() { return tr("服务返回的内容无法解析，请检查接口格式。"); },
    get cancelled() { return tr("已取消生成。"); },
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
        const browserNote = category === 'network' && !isTauri() ? tr(" 网页版也可能受到跨域限制，桌面版不受此限制。") : '';
        const details = [...(options.status ? [`HTTP ${options.status}`] : []), options.attempts ? tr("已尝试 {{v0}} 次", { v0: options.attempts }) : tr("尚未发送请求")];
        const detailSuffix = category === 'cancelled'
            ? ''
            : (getLocale() === 'en' ? ` (${details.join('; ')})` : `（${details.join('；')}）`);
        super(LLM_MESSAGES[category] + browserNote + detailSuffix);
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
