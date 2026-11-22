import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  MessageSquare,
  MessageSquareReply,
  PenLine,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CardEdits } from '@/lib/card-export';
import { applyRegexRules } from '@/lib/regex-processor';
import { cn } from '@/lib/utils';
import type { RegexRule } from '@/types/chat';

interface GreetingsSectionProps {
  edits: CardEdits;
  characterName?: string;
  userName?: string;
  displayRegexRules?: RegexRule[];
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void | Promise<void>;
  onEditChange: <K extends keyof CardEdits>(key: K, value: CardEdits[K]) => void;
  /** 用选定下标的开场白直接开启新对话（0 = 默认开场白，1..N = 备选开场白） */
  onStartWithGreeting?: (greetingIndex: number) => void;
  startingGreetingIndex?: number | null;
}

function renderStageText(
  raw: string,
  charName: string,
  userName: string,
  rules: RegexRule[],
): string {
  const expanded = raw
    .replace(/\{\{char\}\}/gi, charName || '角色')
    .replace(/\{\{user\}\}/gi, userName || '你');
  if (!rules.length) return expanded;
  return applyRegexRules(expanded, rules, false, 0).trim() || expanded;
}

function shortSnippet(raw: string): string {
  const oneLine = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{(?:char|user)\}\}/gi, '')
    .replace(/[*_`~「」『』"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!oneLine) return '空台词';
  return oneLine.length > 10 ? `${oneLine.slice(0, 10)}…` : oneLine;
}

export function GreetingsSection({
  edits,
  characterName,
  userName = '你',
  displayRegexRules = [],
  dirty = false,
  saving = false,
  onSave,
  onEditChange,
  onStartWithGreeting,
  startingGreetingIndex = null,
}: GreetingsSectionProps) {
  const hasAnyContent = Boolean(
    edits.firstMessage.trim() || edits.alternateGreetings.some((g) => g.trim()),
  );
  const [mode, setMode] = useState<'stage' | 'edit'>(() => (hasAnyContent ? 'stage' : 'edit'));
  const [activeIndex, setActiveIndex] = useState(0);
  const pendingFocusIndexRef = useRef<number | null>(null);
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});

  const allGreetings = useMemo(
    () => [
      { label: '默认开场白', text: edits.firstMessage, index: 0 },
      ...edits.alternateGreetings.map((text, idx) => ({
        label: `备选 ${idx + 1}`,
        text,
        index: idx + 1,
      })),
    ],
    [edits.firstMessage, edits.alternateGreetings],
  );

  useEffect(() => {
    if (activeIndex >= allGreetings.length) {
      setActiveIndex(Math.max(0, allGreetings.length - 1));
    }
  }, [activeIndex, allGreetings.length]);

  useEffect(() => {
    if (mode !== 'edit' || pendingFocusIndexRef.current === null) return;
    const targetIdx = pendingFocusIndexRef.current;
    pendingFocusIndexRef.current = null;
    const el = textareaRefs.current[targetIdx];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  }, [mode, allGreetings.length]);

  const updateGreeting = (index: number, value: string) => {
    const next = [...edits.alternateGreetings];
    next[index] = value;
    onEditChange('alternateGreetings', next);
  };

  const activeItem = allGreetings[activeIndex] ?? allGreetings[0];
  const resolvedCharName = characterName || edits.name || '角色';

  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <MessageSquare className="h-4 w-4 text-[color:var(--brand-hi)]" />
            <h2 className="font-serif text-base font-semibold text-[color:var(--text-primary)]">开场白剧场</h2>
            <Badge variant="outline" className="h-5 px-2 text-[11px] font-normal text-[color:var(--text-muted)]">
              共 {allGreetings.length} 段
            </Badge>
            {dirty && (
              <Badge variant="secondary" className="h-5 px-2 text-[11px] font-normal text-brand">
                有未保存修改
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
            像翻剧场台本一样赏玩每段开场白，看中哪段可以直接带入酒馆开聊（支持 ← → 方向键切换）。
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg bg-[var(--hover-overlay)] p-0.5">
            <button
              type="button"
              aria-pressed={mode === 'stage'}
              onClick={() => setMode('stage')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                mode === 'stage'
                  ? 'bg-[var(--brand-active-bg)] text-brand shadow-sm'
                  : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-body)]',
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              剧场赏玩
            </button>
            <button
              type="button"
              aria-pressed={mode === 'edit'}
              onClick={() => {
                pendingFocusIndexRef.current = activeIndex;
                setMode('edit');
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                mode === 'edit'
                  ? 'bg-[var(--brand-active-bg)] text-brand shadow-sm'
                  : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-body)]',
              )}
            >
              <PenLine className="h-3.5 w-3.5" />
              编辑台词
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const nextIdx = edits.alternateGreetings.length + 1;
              onEditChange('alternateGreetings', [...edits.alternateGreetings, '']);
              setActiveIndex(nextIdx);
              pendingFocusIndexRef.current = nextIdx;
              setMode('edit');
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            新增备选
          </Button>

          {onSave && (dirty || mode === 'edit') && (
            <Button
              size="sm"
              variant={dirty ? 'default' : 'outline'}
              disabled={saving || !dirty}
              onClick={() => void onSave()}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? '保存中…' : '保存开场白'}
            </Button>
          )}
        </div>
      </div>

      {mode === 'stage' ? (
        <div
          className="space-y-3.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          tabIndex={0}
          aria-label="开场白剧场切换区（支持左右方向键切换）"
          onKeyDown={(e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const target = e.target instanceof HTMLElement ? e.target : null;
            if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
            if (e.key === 'ArrowLeft' && activeIndex > 0) {
              e.preventDefault();
              setActiveIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'ArrowRight' && activeIndex < allGreetings.length - 1) {
              e.preventDefault();
              setActiveIndex((i) => Math.min(allGreetings.length - 1, i + 1));
            }
          }}
        >
          {allGreetings.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              {allGreetings.map((item) => {
                const isSelected = item.index === activeIndex;
                const isEmpty = !item.text.trim();
                const snippet = shortSnippet(item.text);
                return (
                  <button
                    key={item.index}
                    type="button"
                    aria-pressed={isSelected}
                    title={`${item.label}：${snippet}`}
                    onClick={() => setActiveIndex(item.index)}
                    className={cn(
                      'tap-target shrink-0 rounded-full px-3 py-1 text-xs transition-colors border',
                      isSelected
                        ? 'border-[color:var(--brand-hairline)] bg-[var(--brand-active-bg)] text-brand font-medium'
                        : 'border-[color:var(--border-subtle)] bg-chrome text-[color:var(--text-muted)] hover:text-[color:var(--text-body)]',
                      isEmpty && 'opacity-60',
                    )}
                  >
                    <span>{item.label}</span>
                    {item.index > 0 && !isEmpty && (
                      <span className="ml-1.5 opacity-70 max-w-24 truncate align-bottom hidden sm:inline-block">
                        · {snippet}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="paper-bg rounded-xl border border-[color:var(--border-subtle)] p-5 sm:p-6 shadow-warm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--hairline-inner)] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary/80" />
                <span className="font-serif text-sm font-semibold text-[color:var(--text-primary)]">
                  {resolvedCharName} · {activeItem.label}
                </span>
                {activeItem.text.trim() && (
                  <span className="text-xs text-[color:var(--text-muted)]">
                    {activeItem.text.trim().length} 字
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {allGreetings.length > 1 && (
                  <div className="flex items-center gap-0.5 mr-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={activeIndex <= 0}
                      onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                      aria-label="上一段开场白"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs tabular-nums text-[color:var(--text-muted)] px-1">
                      {activeIndex + 1} / {allGreetings.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={activeIndex >= allGreetings.length - 1}
                      onClick={() => setActiveIndex((i) => Math.min(allGreetings.length - 1, i + 1))}
                      aria-label="下一段开场白"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    pendingFocusIndexRef.current = activeIndex;
                    setMode('edit');
                  }}
                >
                  <PenLine className="mr-1 h-3.5 w-3.5" />
                  修改这段
                </Button>

                {onStartWithGreeting && (
                  <Button
                    size="sm"
                    disabled={!activeItem.text.trim() || startingGreetingIndex !== null}
                    onClick={() => onStartWithGreeting(activeItem.index)}
                  >
                    <MessageSquareReply className="mr-1.5 h-3.5 w-3.5" />
                    {startingGreetingIndex === activeItem.index ? '正在展开场景…' : '用这段开场白开聊'}
                  </Button>
                )}
              </div>
            </div>

            {activeItem.text.trim() ? (
              <div className="reading-flow font-serif text-[15px] leading-[1.85] text-[color:var(--text-body)] whitespace-pre-wrap">
                <ChatMarkdown
                  text={renderStageText(
                    activeItem.text,
                    resolvedCharName,
                    userName,
                    displayRegexRules,
                  )}
                />
              </div>
            ) : (
              <div className="py-10 text-center space-y-2">
                <p className="text-sm text-[color:var(--text-muted)]">这段开场白还没有写内容</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    pendingFocusIndexRef.current = activeIndex;
                    setMode('edit');
                  }}
                >
                  去填写台词
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="default-greeting-input" className="text-sm font-medium text-[color:var(--character-label)]">
                默认开场白
              </label>
              {onStartWithGreeting && edits.firstMessage.trim() && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-primary"
                  disabled={startingGreetingIndex !== null}
                  onClick={() => onStartWithGreeting(0)}
                >
                  <MessageSquareReply className="mr-1 h-3.5 w-3.5" />
                  用默认开场白开聊
                </Button>
              )}
            </div>
            <Textarea
              id="default-greeting-input"
              ref={(el) => { textareaRefs.current[0] = el; }}
              value={edits.firstMessage}
              onChange={(event) => onEditChange('firstMessage', event.target.value)}
              placeholder="写下角色初见时的场景描写与第一句台词（支持 {{char}} 与 {{user}} 占位符）…"
              className="min-h-[180px] text-sm leading-relaxed"
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[color:var(--character-label)]">
              备选开场白（{edits.alternateGreetings.length}）
            </h3>
            {edits.alternateGreetings.map((greeting, index) => (
              <div key={index} className="rounded-lg border border-[color:var(--border-subtle)] bg-chrome p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[color:var(--text-muted)]">
                    备选开场 #{index + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    {onStartWithGreeting && greeting.trim() && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-primary"
                        disabled={startingGreetingIndex !== null}
                        onClick={() => onStartWithGreeting(index + 1)}
                      >
                        <MessageSquareReply className="mr-1 h-3.5 w-3.5" />
                        用这段开聊
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-[color:var(--text-muted)] hover:text-destructive"
                      onClick={() =>
                        onEditChange('alternateGreetings', edits.alternateGreetings.filter((_, i) => i !== index))
                      }
                      aria-label={`删除备选开场白 ${index + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <Textarea
                  ref={(el) => { textareaRefs.current[index + 1] = el; }}
                  aria-label={`备选开场白 ${index + 1}`}
                  value={greeting}
                  onChange={(event) => updateGreeting(index, event.target.value)}
                  placeholder="平行时间线、不同身份或季节的另一段初遇场景…"
                  className="min-h-[132px] text-sm leading-relaxed"
                />
              </div>
            ))}
            {edits.alternateGreetings.length === 0 && (
              <p className="text-xs text-[color:var(--text-muted)]">
                还没有备选开场白。点右上角「新增备选」，可以为同一角色准备多条平行初见剧情。
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
