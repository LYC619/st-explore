import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useState } from 'react';
import { currentScene, currentBeat, type GalState } from '@/play/gal/scene';
export function GalStage({ gal, busy, next, choose, retry, error }: { gal: GalState; busy: boolean; next: () => void; choose: (id: string, input?: string) => void; retry: () => void; error: string }) {
  useI18n();
  const scene = currentScene(gal), beat = currentBeat(gal), [shown, setShown] = useState(0), [input, setInput] = useState(''), [writing, setWriting] = useState(false);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(beat.text.length); return; }
    setShown(0); const timer = setInterval(() => setShown(n => { const next = Math.min(n + 4, beat.text.length); if (next >= beat.text.length) clearInterval(timer); return next; }), 22);
    return () => clearInterval(timer);
  }, [beat.text, beat.id, scene.id]);
  const ready = shown >= beat.text.length, terminal = !beat.next;
  function advance() { if (!ready) setShown(beat.text.length); else if (!terminal && !busy) next(); }
  return <div className="gal-reading">
    <div className="gal-chapter"><span>SCENE {gal.choices.length + 1 < 10 ? '0' : ''}{gal.choices.length + 1}</span><h1>{scene.title}</h1></div>
    {error && <div className="gal-error" role="alert">{error}</div>}
    <section className="gal-dialogue" aria-label={tr("剧情对白")}><div className="gal-speaker">{beat.speaker || tr("旁白")}</div>
      <button className="gal-text" onClick={advance} disabled={busy} aria-label={!ready ? tr("显示完整对白") : terminal ? tr("当前对白") : tr("下一段对白")}><span aria-hidden="true">{beat.text.slice(0, shown)}</span><span className="sr-only">{beat.text}</span><small>{!ready ? tr("轻触展开") : terminal ? tr("你的选择，会让故事走向何方") : tr("轻触继续 ▸")}</small></button>
    </section>
    {terminal && ready && <div className="gal-choice-area">{gal.pending ? <div className="gal-pending" role="status"><span>{busy ? tr("故事正在回应你的选择…") : tr("上次选择已保存，等待续写")}</span>{!busy && <button onClick={retry}>{tr("继续这次选择")}</button>}</div> : <><div className="gal-choices">{scene.choices.map((choice, i) => <button key={choice.id} disabled={busy} onClick={() => choose(choice.id)}><span className="gal-choice-number">0{i+1}</span><span><strong>{choice.label}</strong>{gal.kind === 'encounter' && <small>{choice.intent}</small>}</span><i>↗</i></button>)}</div>
      {gal.kind === 'story' && <><button className="gal-free-toggle" aria-expanded={writing} onClick={() => setWriting(!writing)}>{writing ? tr("收起自由行动") : tr("或者，说出你自己的选择…")}</button>{writing && <form className="gal-free-input" onSubmit={e => { e.preventDefault(); if (input.trim() && !busy) { choose('free', input.trim()); setInput(''); setWriting(false); } }}><input aria-label={tr("自由行动")} autoFocus maxLength={400} placeholder={tr("我想…")} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.nativeEvent.isComposing && e.key === 'Enter') e.preventDefault(); }} /><button type="submit" disabled={busy || !input.trim()}>{tr("继续 →")}</button></form>}</>}
    </>}</div>}
  </div>;
}
