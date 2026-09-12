/** Browser-only bridge: a read of live ST state, with no storage dependency. */
export function captureRecoveryFile(st: {
  chat: readonly Record<string, unknown>[];
  chat_metadata: Record<string, unknown>;
  name1: string;
  name2: string;
  getCurrentChatId: () => string | undefined;
}): { fileName: string; text: string };
