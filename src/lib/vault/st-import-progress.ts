/**
 * ST 导入三个阶段（解压 / 扫描 / 入库）共用的进度与取消约定。
 *
 * 单独成文件是为了让 Rust 桥接层（tauri-fs）和纯逻辑层（st-import）都能引用，
 * 又不至于让 tauri-fs 反向依赖 st-import 那一大坨扫描逻辑。
 */

export type STImportPhase = 'validate' | 'extract' | 'scan' | 'import';

export interface STImportProgress {
  phase: STImportPhase;
  /** 已处理项数 */
  done: number;
  /**
   * 总数。扫描阶段事先不知道要走多少目录，留空 → 进度条走不确定态，
   * 只报「已发现 N 个文件」。解压和入库都能预先算出总数。
   */
  total?: number;
  /** 当前处理对象的短标签（文件名/条目名），用于让用户看出它在动 */
  label?: string;
}

export type STImportProgressHandler = (progress: STImportProgress) => void;

export interface STImportControls {
  onProgress?: STImportProgressHandler;
  signal?: AbortSignal;
}

/**
 * 用户主动取消。
 *
 * 不用 `signal.throwIfAborted()` 抛的 DOMException：那个在不同运行时里
 * name/类型都不完全一致，跨 jsdom 和客户端判断起来不稳。自己的类既好断言，
 * 也能一眼看出是业务上的取消而不是网络/IO 错误。
 */
export class STImportAbortedError extends Error {
  constructor(message = '导入已取消') {
    super(message);
    this.name = 'STImportAbortedError';
  }
}

export function isSTImportAborted(error: unknown): boolean {
  return error instanceof STImportAbortedError
    || (error as { name?: string } | null)?.name === 'STImportAbortedError';
}

/** 循环里逐项调用；signal 已置位就抛，调用方统一按取消处理。 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new STImportAbortedError();
}

/**
 * 进度节流。入库时每个文件都报会把 React 打成每秒上千次 setState，
 * 界面反而更卡——这正是这轮要解决的问题，别用进度条把它换个形式做回来。
 *
 * 首次和末次必报（`flush`），中间按时间间隔压。
 */
export function throttleProgress(
  handler: STImportProgressHandler | undefined,
  intervalMs = 80,
): { report: STImportProgressHandler; flush: STImportProgressHandler } {
  if (!handler) {
    const noop = () => {};
    return { report: noop, flush: noop };
  }
  let last = 0;
  return {
    report: (progress) => {
      const now = Date.now();
      if (now - last < intervalMs) return;
      last = now;
      handler(progress);
    },
    flush: (progress) => {
      last = Date.now();
      handler(progress);
    },
  };
}

/** 阶段名 → 界面文案。进度弹窗和选择弹窗共用，避免两处各写一份。 */
export const ST_IMPORT_PHASE_LABEL: Record<STImportPhase, string> = {
  validate: '校验备份包',
  extract: '解压备份包',
  scan: '扫描内容',
  import: '写入库中',
};
