import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import type { RemoveOptions } from '@/lib/repo';
/**
 * 正则独立工具页（2.0 阶段5，定稿第六章）。
 * 左栏 = 现有 RegexSidebar（规则管理/快速添加/批量导入/ST 互导，编辑的是全局当前规则集）；
 * 右栏 = 规则集资产库（入库/载入/删除，角色上下文走写时复制）+ 可视化生效预览
 * （选文本或某楼，逐条标出哪条规则改了哪、哪条没命中）。
 * 布局铁律：flex-wrap + 行内 basis，禁视口断点。
 */
import { useMemo, useState, useEffect, useCallback, useRef  } from 'react';
import { Regex as RegexIcon, Archive, Save, FolderOpen, Trash2, Eye, ChevronDown, ChevronUp, User, Bot } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { RegexSidebar } from '@/components/chat/RegexSidebar';
import { HelpCard } from '@/components/HelpCard';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { RegexRule } from '@/types/chat';
import { listStoryIndex, type StoryIndexEntry } from '@/lib/archive-index';
import { getInitialRegexRules } from '@/lib/session-storage';
import { previewRegexRules, diffParts } from '@/lib/regex-preview';
import { parseSTRegexImport } from '@/lib/st-regex-interop';
import { takePendingToolFile } from '@/lib/tool-handoff';
import {
  getAllRegexCollections,
  getRegexCollection,
  saveRegexCollection,
  deleteRegexCollection,
  buildRegexCollection,
  generateRegexCollectionId,
} from '@/lib/regex-db';
import type { RegexCollectionItem } from '@/types/regex';
import { saveAssetWithCow } from '@/lib/asset-cow-save';
import { getCharacter, getArchiveStory } from '@/lib/archive-db';
import { getVaultEpoch } from '@/lib/vault/active';
import { updateCharacterAssetReference } from '@/lib/character-asset-ref';
import { executeDeleteAction } from '@/lib/destructive-action';
import { useAssetIdentityNavigation } from '@/hooks/use-asset-identity-navigation';

const RegexTool = () => {
  useI18n();
  const { toast } = useToast();
  // 角色上下文（角色页关联资产区「处理」进来）：保存走写时复制
  const [cowCharacterId, setCowCharacterId] = useState<string | undefined>();
  const [cowCharacterName, setCowCharacterName] = useState('');

  const [rules, setRules] = useState<RegexRule[]>(getInitialRegexRules);
  const [collections, setCollections] = useState<RegexCollectionItem[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<RegexCollectionItem | null>(null);
  const [collectionName, setCollectionName] = useState('');
  // 当前载入的资产 id（保存回资产时用；null = 纯当前规则集）
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ title: '', rules }));
  const isDirty = JSON.stringify({ title: collectionName, rules }) !== savedSnapshot;

  // 预览区状态
  const [sampleText, setSampleText] = useState('');
  const [asUser, setAsUser] = useState(false);
  const [sampleDepth, setSampleDepth] = useState('0');
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  // 从故事取某楼
  const [stories, setStories] = useState<StoryIndexEntry[]>([]);
  const [pickStoryId, setPickStoryId] = useState('');
  const [pickFloor, setPickFloor] = useState('');
  const sampleRequest = useRef(0);
  useEffect(() => {
    const requests = sampleRequest;
    requests.current++;
    return () => { requests.current++; };
  }, [pickStoryId, pickFloor]);

  const initialImport = useRef<Promise<RegexRule[] | null> | null>(null);
  const { pendingTarget, confirmPending, cancelPending, captureCurrent, requestAsset } = useAssetIdentityNavigation({
    isDirty,
    load: async (identity, { initial, isCurrent }) => {
      if (initial && !identity.assetId && !initialImport.current) {
        const handoff = takePendingToolFile('regex');
        initialImport.current = handoff ? handoff.text().then((text) => {
          const imported = parseSTRegexImport(JSON.parse(text));
          if (imported.length === 0) throw new Error(tr("文件里没有可识别的正则脚本"));
          return imported;
        }) : Promise.resolve(null);
      }
      const [item, character, items, imported] = await Promise.all([
        identity.assetId ? getRegexCollection(identity.assetId) : null,
        identity.characterId ? getCharacter(identity.characterId) : null,
        getAllRegexCollections().catch(() => []),
        initial && !identity.assetId ? initialImport.current : null,
      ]);
      if (isCurrent()) setCollections(item && !items.some((saved) => saved.id === item.id) ? [item, ...items] : items);
      if (identity.assetId && !item) throw new Error(tr("找不到这个规则集，它可能已经被删除"));
      return { item, characterName: character?.name ?? '', preserveSession: initial && !identity.assetId, imported };
    },
    accept: (target, identity) => {
      if (!target.preserveSession) {
        const nextRules: RegexRule[] = JSON.parse(JSON.stringify(target.item?.rules ?? []));
        const title = target.item?.title ?? '';
        setRules(nextRules);
        setCollectionName(title);
        setActiveCollectionId(target.item?.id ?? null);
        setSavedSnapshot(JSON.stringify({ title, rules: nextRules }));
      }
      if (target.imported) {
        const imported = target.imported;
        setRules((previous) => {
          const byId = new Map(previous.map((rule) => [rule.id, rule]));
          imported.forEach((rule) => byId.set(rule.id, rule));
          return Array.from(byId.values());
        });
        toast({ title: tr("已导入 ST 正则"), description: tr("{{v0}} 条规则", { v0: imported.length }) });
      }
      setCowCharacterId(identity.characterId ?? undefined);
      setCowCharacterName(target.characterName);
    },
    onError: (error) => toast({ title: tr("载入规则集失败"), description: error instanceof Error ? error.message : String(error), variant: 'destructive' }),
  });

  const refreshCollections = useCallback(async (isCurrent = captureCurrent()) => {
    try {
      const items = await getAllRegexCollections();
      if (isCurrent()) setCollections(items);
    } catch { /* 列表失败不阻塞工具 */ }
  }, [captureCurrent]);

  // 故事列表只用于预览取样，不参与编辑对象身份。
  useEffect(() => {
    let cancelled = false;
    listStoryIndex().then((items) => { if (!cancelled) setStories(items); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ---- 资产库操作 ----

  const handleSaveAsCollection = async () => {
    const isCurrent = captureCurrent();
    const savedRules: RegexRule[] = JSON.parse(JSON.stringify(rules));
    const name = collectionName.trim();
    let savedTitle = name;
    if (!name) {
      toast({ title: tr("请输入规则集名称"), variant: 'destructive' });
      return;
    }
    try {
      if (cowCharacterId) {
        // 角色上下文：写时复制决策
        const base = activeCollectionId ? collections.find((c) => c.id === activeCollectionId) : undefined;
        if (base) {
          const result = await saveAssetWithCow({
            kind: 'regex',
            baseId: base.id,
            reload: getAllRegexCollections,
            characterId: cowCharacterId,
            characterName: cowCharacterName,
            title: name,
            content: { rules: savedRules },
            newId: generateRegexCollectionId,
            save: saveRegexCollection,
          });
          if (!isCurrent()) return;
          savedTitle = result.title;
          // 原地更新这条历来不提示，与世界书/预设的「已保存」不一致；统一文案是另一件事
          if (result.action === 'redirect') {
            toast({ title: tr("已更新派生副本「{{v0}}」", { v0: result.title }) });
          } else if (result.action === 'copy') {
            toast({ title: tr("已生成派生副本"), description: tr("「{{v0}}」，原规则集未改动", { v0: result.title }) });
          }
          setActiveCollectionId(result.targetId);
        } else {
          // 角色上下文的全新规则集：直接入库并挂引用
          const item = buildRegexCollection(name, savedRules);
          await saveRegexCollection(item);
          const updatedCharacter = await updateCharacterAssetReference(cowCharacterId, 'regex', item.id, item.id);
          if (!updatedCharacter) throw new Error(tr("资产已保存，但角色引用切换失败：角色可能已被删除"));
          if (!isCurrent()) return;
          setActiveCollectionId(item.id);
          toast({ title: tr("已存入资产库并关联「{{v0}}」", { v0: cowCharacterName }) });
        }
      } else if (activeCollectionId && collections.some((c) => c.id === activeCollectionId)) {
        // 更新已载入的资产
        const base = collections.find((c) => c.id === activeCollectionId)!;
        await saveRegexCollection({
          ...base,
          title: name,
          rules: savedRules,
          updatedAt: Date.now(),
        });
        if (!isCurrent()) return;
        toast({ title: tr("已更新规则集「{{v0}}」", { v0: name }) });
      } else {
        const item = buildRegexCollection(name, savedRules);
        await saveRegexCollection(item);
        if (!isCurrent()) return;
        setActiveCollectionId(item.id);
        toast({ title: tr("已存入资产库「{{v0}}」", { v0: name }) });
      }
      if (!isCurrent()) return;
      setCollectionName((current) => current === collectionName ? savedTitle : current);
      setSavedSnapshot(JSON.stringify({ title: savedTitle, rules: savedRules }));
      await refreshCollections(isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      // 含写时复制的重读失败与「资产已被删除」——原先只说「保存失败」，不说为什么
      toast({
        title: tr("保存失败"),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleLoadCollection = (item: RegexCollectionItem) => {
    requestAsset(item.id);
  };

  const handleDeleteCollection = async (options: RemoveOptions) => {
    if (!deleteTarget) return;
    const isCurrent = captureCurrent();
    const target = deleteTarget;
    const deleted = await executeDeleteAction(async () => {
      await deleteRegexCollection(target.id, options);
      if (!isCurrent()) return;
      if (activeCollectionId === target.id) setActiveCollectionId(null);
      await refreshCollections(isCurrent);
    }, {
      onSuccess: () => { if (isCurrent()) toast({ title: tr("已删除规则集「{{v0}}」", { v0: target.title }) }); },
      onFailure: () => { if (isCurrent()) toast({ title: tr("删除规则集失败"), variant: 'destructive' }); },
    });
    if (deleted && isCurrent()) setDeleteTarget(null);
    return deleted;
  };

  // ---- 可视化预览 ----

  const preview = useMemo(
    () => (sampleText ? previewRegexRules(sampleText, rules, asUser, sampleDepth === '' ? undefined : Number(sampleDepth)) : null),
    [sampleText, rules, asUser, sampleDepth],
  );

  const pickStory = stories.find((s) => s.id === pickStoryId);

  const handlePickFloor = async () => {
    if (!pickStory) return;
    const request = ++sampleRequest.current;
    const epoch = getVaultEpoch();
    const isCurrent = () => request === sampleRequest.current && epoch === getVaultEpoch();
    const n = parseInt(pickFloor, 10);
    let story;
    try {
      story = await getArchiveStory(pickStory.id);
    } catch {
      if (isCurrent()) toast({ title: tr("故事读取失败，请重试"), variant: 'destructive' });
      return;
    }
    if (!isCurrent()) return;
    if (!story) {
      toast({ title: tr("故事已不存在，请重新选择"), variant: 'destructive' });
      return;
    }
    const msg = story.session.messages[n - 1];
    if (!msg) {
      toast({ title: tr("该故事没有第 {{v0}} 楼（共 {{v1}} 楼）", { v0: pickFloor, v1: story.session.messages.length }), variant: 'destructive' });
      return;
    }
    setSampleText(msg.content);
    setAsUser(msg.role === 'user' || !!msg.is_user);
    setSampleDepth(String(story.session.messages.length - n));
    toast({ title: tr("已取「{{v0}}」第 {{v1}} 楼", { v0: pickStory.title, v1: n }) });
  };

  return (
    <AppLayout>
      <AlertDialog open={!!pendingTarget} onOpenChange={(open) => { if (!open) cancelPending(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("确认切换规则集？")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("当前规则集有未保存的修改，加载后将丢失这些修改。")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>{tr("确认加载")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg gold-gradient flex items-center justify-center shadow-card">
            <RegexIcon className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <h1 className="font-display text-xl font-semibold">{tr("正则工具")}</h1>
              <HelpCard>{tr("这里编辑的是全局「当前规则集」，聊天处理与导出用的就是它。可把整套规则存入资产库共享、 复用；在右侧预览里贴一段文本或取某楼，能直观看到每条规则改了哪里、哪条没命中。")}</HelpCard>
            </div>
            <p className="text-xs text-muted-foreground">{tr("编辑规则 · 预览结果 · 保存规则集")}</p>
          </div>
          {cowCharacterId && cowCharacterName && (
            <Badge variant="secondary" className="ml-2">{tr("正在为「{{v0}}」处理（保存时写时复制）", { v0: cowCharacterName })}</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-3">
          <Input
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            placeholder={tr("规则集名称（如：清理思维链套装）")}
            className="basis-64 grow"
          />
          <Button size="sm" onClick={handleSaveAsCollection}>
            <Save className="w-4 h-4 mr-1.5" />{tr("存入资产库")}</Button>
        </div>
        <div className="flex items-start gap-4 flex-wrap">
          {/* 左栏：现有规则管理组件（常驻模式） */}
          <section aria-label={tr("正则编辑")} className="min-w-0 basis-[28rem] grow-[3] [&>aside]:w-full">
            <h2 className="mb-2 text-sm font-medium">{tr("编辑当前规则集")}</h2>
            <RegexSidebar rules={rules} onRulesChange={setRules} isOpen />
          </section>

          {/* 右栏 */}
          <div className="min-w-0 basis-[22rem] grow-[2] space-y-4">
            {/* 可视化生效预览 */}
            <Card className="p-4" data-tour="regex-preview">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="w-4 h-4 text-primary" />
                <h2 className="font-display font-medium">{tr("生效预览")}</h2>
                <span className="text-xs text-muted-foreground">{tr("贴一段文本，或从故事里取某一楼")}</span>
              </div>

              {/* 取样：文本框 + 从故事取楼 */}
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <Select value={pickStoryId} onValueChange={setPickStoryId}>
                  <SelectTrigger className="h-8 basis-56 grow max-w-72">
                    <SelectValue placeholder={tr("从故事取样（可选）")} />
                  </SelectTrigger>
                  <SelectContent>
                    {stories.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {tr("{{v0}}（{{v1}} 楼）", { v0: s.title, v1: s.floorCount })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={pickFloor}
                  onChange={(e) => setPickFloor(e.target.value.replace(/\D/g, ''))}
                  placeholder={tr("楼层号")}
                  className="w-24"
                  disabled={!pickStory}
                />
                <Button size="sm" variant="outline" onClick={handlePickFloor} disabled={!pickStory || !pickFloor}>{tr("取该楼")}</Button>
                <Button
                  size="sm"
                  variant={asUser ? 'secondary' : 'outline'}
                  onClick={() => { sampleRequest.current++; setAsUser(!asUser); }}
                  title={tr("切换按用户楼还是 AI 楼应用（影响「作用于」限定的规则）")}
                >
                  {asUser ? <User className="w-3.5 h-3.5 mr-1" /> : <Bot className="w-3.5 h-3.5 mr-1" />}{asUser ? tr("按用户楼预览") : tr("按AI楼预览")}</Button>
              </div>
              <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span>{tr("样例深度（末楼为 0）")}</span><Input aria-label={tr("样例深度")} type="number" min={0} step={1} value={sampleDepth} onChange={event => { sampleRequest.current++; setSampleDepth(event.target.value); }} className="w-24" /></label>
              <Textarea
                value={sampleText}
                onChange={(e) => { sampleRequest.current++; setSampleText(e.target.value); }}
                placeholder={tr("在这里粘贴要测试的文本，例如带 <thinking> 或状态栏的 AI 回复…")}
                className="min-h-28 font-mono text-xs"
              />

              {preview && (
                <div className="mt-3 space-y-3">
                  {/* 每条规则的命中情况 */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">{tr("逐条生效情况（{{v0}} 条命中）", { v0: preview.matchedCount })}</p>
                    <div className="space-y-1">
                      {preview.effects.map((e) => {
                        const expanded = expandedRuleId === e.ruleId;
                        const canExpand = e.matched;
                        const diff = expanded && e.matched ? diffParts(e.before, e.after) : null;
                        return (
                          <div key={e.ruleId} className="rounded-md border border-border">
                            <button
                              className={cn(
                                'w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left',
                                canExpand && 'hover:bg-accent/40',
                              )}
                              onClick={() => canExpand && setExpandedRuleId(expanded ? null : e.ruleId)}
                            >
                              <span className="flex-1 min-w-0 truncate" title={e.ruleName}>{e.ruleName}</span>
                              {e.disabled ? (
                                <Badge variant="outline" className="h-5 text-[11px] text-muted-foreground shrink-0">{tr("已禁用")}</Badge>
                              ) : e.invalid ? (
                                <Badge variant="destructive" className="h-5 text-[11px] shrink-0">{tr("正则无效")}</Badge>
                              ) : !e.applied ? (
                                <Badge variant="outline" className="h-5 text-[11px] text-muted-foreground shrink-0">{tr("不符合当前消息角色或楼层范围")}</Badge>
                              ) : e.matched ? (
                                <Badge variant="outline" className="h-5 text-[11px] shrink-0 bg-[var(--status-ok-bg)] text-[color:var(--status-ok)] border-[var(--status-ok-bg)]">{tr("命中")}</Badge>
                              ) : (
                                <Badge variant="outline" className="h-5 text-[11px] text-muted-foreground shrink-0">{tr("未命中")}</Badge>
                              )}
                              {canExpand && (expanded ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />)}
                            </button>
                            {diff && (
                              <div className="px-2.5 pb-2 text-xs font-mono whitespace-pre-wrap break-all border-t border-border pt-2">
                                <span className="text-muted-foreground">{diff.prefix.slice(-120)}</span>
                                {diff.removed && (
                                  <del className="bg-destructive/15 text-destructive rounded px-0.5">{diff.removed.slice(0, 400)}</del>
                                )}
                                {diff.added && (
                                  <ins className="bg-[var(--status-ok-bg)] text-[color:var(--status-ok)] no-underline rounded px-0.5">
                                    {diff.added.slice(0, 400)}
                                  </ins>
                                )}
                                <span className="text-muted-foreground">{diff.suffix.slice(0, 120)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 最终结果 */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{tr("全部规则应用后")}</p>
                    <div className="rounded-md bg-muted/40 border border-border p-2.5 text-xs whitespace-pre-wrap break-words max-h-56 overflow-auto">
                      {preview.final || <span className="text-muted-foreground">{tr("（全部内容被清理，输出为空）")}</span>}
                    </div>
                  </div>
                </div>
              )}
            </Card>
            <details data-regex-library className="rounded-lg border border-border bg-card p-4">
              <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium"><Archive className="w-4 h-4" />{tr("从正则库载入")}<span className="ml-auto text-xs font-normal text-muted-foreground">{tr("{{v0}} 份规则集", { v0: collections.length })}</span></summary>
              <div className="mt-3">
              {collections.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tr("还没有规则集资产。命名后点「存入资产库」即可收藏当前规则。")}</p>
              ) : (
                <div className="space-y-1.5">
                  {collections.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm',
                        activeCollectionId === item.id ? 'border-primary/50 bg-primary/5' : 'border-border',
                      )}
                    >
                      <span className="flex-1 min-w-0 truncate" title={item.title}>{item.title}</span>
                      {item.derived && (
                        <Badge variant="outline" className="h-4 px-1 text-[11px] text-muted-foreground shrink-0">{tr("派生")}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground shrink-0">{tr("{{v0}} 条", { v0: item.rules.length })}</span>
                      <Button variant="ghost" size="icon" title={tr("载入为当前规则集")} onClick={() => handleLoadCollection(item)}>
                        <FolderOpen className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        title={tr("删除")}
                        onClick={() => setDeleteTarget(item)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </details>

          </div>
        </div>
      </div>
      <DeleteConfirmDialog
        open={!!deleteTarget}
        title={tr("删除规则集「{{v0}}」？", { v0: deleteTarget?.title ?? '' })}
        description={tr("条目将从列表移除。若角色仍引用该规则集，角色页会显示引用失效。")}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        fileTarget={deleteTarget ? { store: 'regexes', id: deleteTarget.id } : undefined}
            onConfirm={handleDeleteCollection}
      />
    </AppLayout>
  );
};

export default RegexTool;
