import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getPresetTagOptions, loadPresetTags, presetTagParts, savePresetTags, type PresetTagPreferences } from '@/lib/preset-tags';
import { getPresetTags } from '@/lib/preset-tag-values';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';

export function PresetTagManager({ preferences, items, onClose, onChanged }: {
  preferences: PresetTagPreferences; items: AssetIndexEntry[]; onClose: () => void; onChanged: () => void;
}) {
  const [prefs, setPrefs] = useState(preferences), [category, setCategory] = useState(preferences.categories.find(value => !preferences.deletedCategories?.includes(value)) || (preferences.deletedCategories?.includes('未分类') ? '' : '未分类'));
  const [newCategory, setNewCategory] = useState(''), [newTag, setNewTag] = useState('');
  const [editing, setEditing] = useState(''), [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState('');
  const [deletingCategory, setDeletingCategory] = useState(false);
  const tags = getPresetTagOptions(prefs, items.flatMap(item => getPresetTags(item.catalog)));
  const categories = [...new Set([...prefs.categories, ...tags.map(tag => presetTagParts(tag).category), '未分类'])]
    .filter(value => !prefs.deletedCategories?.includes(value));
  const raw = (label: string) => category === '未分类' ? label.trim() : `${category}/${label.trim()}`;
  const save = async (next: PresetTagPreferences, rename?: { from: string; to?: string; category?: boolean }) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await savePresetTags(next, prefs, rename);
      const saved = await loadPresetTags();
      setPrefs(saved);
      if (rename?.category && !rename.to) setCategory(saved.categories.find(value => !saved.deletedCategories?.includes(value)) || (saved.deletedCategories?.includes('未分类') ? '' : '未分类'));
      setEditing(''); setDeleting(''); setDeletingCategory(false); setNewTag(''); setNewCategory(''); onChanged();
    }
    catch (e) { setError(`${e instanceof Error ? e.message : String(e)}。已保存的条目会保留，可重试剩余操作。`); onChanged(); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-3xl max-h-[85dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>管理预设标签</DialogTitle><DialogDescription>分组整理预设。隐藏仅影响筛选栏；改名和删除会同步到使用该标签的预设。</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="flex flex-col sm:flex-row gap-5 min-w-0">
      <aside className="sm:w-40 shrink-0 space-y-1">
        {categories.map(value => <Button key={value} variant={value === category ? 'secondary' : 'ghost'} className="w-full justify-start" onClick={() => setCategory(value)}>{value}</Button>)}
        <Input aria-label="新建预设标签分组" placeholder="新分组" value={newCategory} onChange={e => setNewCategory(e.target.value)} />
        <Button variant="outline" size="sm" disabled={!newCategory.trim() || newCategory.includes('/') || ['类型', '风格'].includes(newCategory.trim()) || categories.includes(newCategory.trim())} onClick={() => { setCategory(newCategory.trim()); void save({ ...prefs, categories: [...prefs.categories, newCategory.trim()], deletedCategories: prefs.deletedCategories?.filter(value => value !== newCategory.trim()) }); }}>添加分组</Button>
      </aside>
      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center gap-2"><h3 className="text-sm font-medium flex-1">{category || '请先新建一级标签'}</h3>{category && <Button variant="ghost" size="sm" onClick={() => { setDeleting(category); setDeletingCategory(true); }}>删除一级标签</Button>}</div>
        {category && <div className="flex gap-2"><Input aria-label="新建预设标签" placeholder={`添加到${category}`} value={newTag} onChange={e => setNewTag(e.target.value)} /><Button disabled={!newTag.trim() || tags.includes(raw(newTag))} onClick={() => void save({ ...prefs, tags: [...prefs.tags, raw(newTag)], deleted: prefs.deleted?.filter(tag => tag !== raw(newTag)) })}>添加标签</Button></div>}
        {tags.filter(tag => presetTagParts(tag).category === category).map(tag => <div key={tag} className="rounded-lg border border-[color:var(--border-subtle)] p-2 flex flex-wrap items-center gap-2">
          {editing === tag ? <><Input aria-label={`重命名 ${tag}`} className="flex-1 min-w-28" value={label} onChange={e => setLabel(e.target.value)} /><Button size="sm" disabled={!label.trim() || raw(label) !== tag && tags.includes(raw(label))} onClick={() => void save({ ...prefs, tags: [...prefs.tags.filter(t => t !== tag), raw(label)], hidden: prefs.hidden.map(t => t === tag ? raw(label) : t), deleted: prefs.deleted?.filter(value => value !== raw(label)) }, { from: tag, to: raw(label) })}>保存名称</Button><Button size="sm" variant="ghost" onClick={() => setEditing('')}>取消</Button></> : <><span className="min-w-0 flex-1 text-sm break-words">{presetTagParts(tag).label}<span className="text-xs text-muted-foreground ml-2">{items.filter(item => getPresetTags(item.catalog).includes(tag)).length}</span></span><Button size="sm" variant="ghost" onClick={() => { setEditing(tag); setLabel(presetTagParts(tag).label); }}>改名</Button><Button size="sm" variant="ghost" onClick={() => void save({ ...prefs, hidden: prefs.hidden.includes(tag) ? prefs.hidden.filter(t => t !== tag) : [...prefs.hidden, tag] })}>{prefs.hidden.includes(tag) ? '显示' : '隐藏'}</Button><Button size="sm" variant="ghost" aria-label={`删除预设标签 ${tag}`} onClick={() => { setDeleting(tag); setDeletingCategory(false); }}>删除</Button></>}
        </div>)}
        {deleting && <div role="alert" className="rounded-lg border border-destructive p-3 space-y-2 text-sm"><p>删除“{deleting}”{deletingCategory ? '及全部二级标签' : ''}，并移除同系列预设上的对应标签？</p><Button size="sm" variant="destructive" onClick={() => void save({ ...prefs, categories: deletingCategory ? prefs.categories.filter(c => c !== deleting) : prefs.categories, tags: prefs.tags.filter(t => deletingCategory ? presetTagParts(t).category !== deleting : t !== deleting), hidden: prefs.hidden.filter(t => deletingCategory ? presetTagParts(t).category !== deleting : t !== deleting) }, { from: deleting, category: deletingCategory })}>确认删除标签</Button><Button size="sm" variant="ghost" onClick={() => setDeleting('')}>取消</Button></div>}
      </div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="outline" disabled={busy} onClick={onClose}>{busy ? '保存中…' : '完成'}</Button>
  </DialogContent></Dialog>;
}
