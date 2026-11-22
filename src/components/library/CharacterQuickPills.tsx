import { BookOpen, MessageSquare, Sparkles } from 'lucide-react';

interface CharacterQuickPillsProps {
  hasStory: boolean;
  busy?: boolean;
  onReminisce: () => void;
  onContinueChat: () => void;
  onOpenGreetings: () => void;
}

export function CharacterQuickPills({
  hasStory,
  busy = false,
  onReminisce,
  onContinueChat,
  onOpenGreetings,
}: CharacterQuickPillsProps) {
  if (hasStory) {
    return (
      <>
        <button
          type="button"
          onClick={onReminisce}
          className="tap-target inline-flex min-h-7 items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 px-2.5 py-0.5 text-[11px] text-white transition-colors"
          title="打开上次阅读的故事回味"
        >
          <BookOpen className="w-3 h-3" />
          回味
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onContinueChat}
          className="tap-target inline-flex min-h-7 items-center gap-1 rounded-full bg-[rgba(224,138,74,0.22)] hover:bg-[rgba(224,138,74,0.36)] backdrop-blur-sm border border-[rgba(240,161,92,0.45)] px-2.5 py-0.5 text-[11px] text-[rgba(246,178,115,1)] transition-colors disabled:opacity-60"
          title="直接进入酒馆接着上次故事聊"
        >
          <MessageSquare className="w-3 h-3" />
          {busy ? '打开中…' : '续聊'}
        </button>
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenGreetings}
      className="tap-target inline-flex min-h-7 items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 px-2.5 py-0.5 text-[11px] text-white transition-colors"
      title="赏玩这张卡的开场白并选一段开聊"
    >
      <Sparkles className="w-3 h-3" />
      赏玩开场
    </button>
  );
}
