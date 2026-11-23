import type { RemoveOptions } from '@/lib/repo';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, Download, Save, History, FileJson, Copy, ArrowLeft, FlaskConical } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { HelpCard } from '@/components/HelpCard';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import type { NormalizedPreset, OrderEntry, PresetItem, PromptBlock, PromptOrderGroup } from '@/types/preset';
import { DEFAULT_CHARACTER_ID, generatePresetId } from '@/types/preset';
import { parsePreset, selectActivePromptOrderGroup } from '@/lib/preset-parser';
import {
  getAllPresets, getPreset, savePreset, deletePreset, saveEditedPreset, createPresetDiy,
} from '@/lib/preset-db';
import { togglePresetEmbeddedScriptInDraft } from '@/lib/preset-resources';
import { saveAssetWithCow } from '@/lib/asset-cow-save';
import { buildPresetSaveItem } from '@/lib/asset-save-record';
import { getCharacter } from '@/lib/archive-db';
import { updateCharacterAssetReference } from '@/lib/character-asset-ref';
import { takePendingToolFile } from '@/lib/tool-handoff';
import { PresetOverview } from '@/components/preset/PresetOverview';
import { PromptEditor } from '@/components/preset/PromptEditor';
import { PresetUtilityFields } from '@/components/preset/PresetUtilityFields';
import { PresetRegexEditor } from '@/components/preset/PresetRegexEditor';
import { PresetExport } from '@/components/preset/PresetExport';
import { PresetPlayground } from '@/components/preset/PresetPlayground';
import { GuidedTour } from '@/components/GuidedTour';
import { PRESET_TOUR_STEPS, isTourCompleted, setTourCompleted } from '@/lib/tour-steps';
import type { RegexRule } from '@/types/chat';
import { executeDeleteAction } from '@/lib/destructive-action';
import { useAssetIdentityNavigation } from '@/hooks/use-asset-identity-navigation';
import { presetContentFingerprint, presetOptionLabel } from '@/lib/preset-catalog';
import { PresetDraftBoundary } from '@/components/preset/PresetDraftBoundary';
import { getVaultEpoch } from '@/lib/vault/active';
import { scopedKey } from '@/lib/vault/vault-scope';

const PRESET_SESSION_KEY = 'preset-active-session';
const MAX_HISTORY_STEPS = 50;
interface PresetSessionPtr { itemId: string | null; }
interface PromptHistorySnapshot {
  prompts: PromptBlock[];
  promptOrder: PromptOrderGroup[];
}

function loadSessionPtr(): PresetSessionPtr | null {
  try {
    const raw = sessionStorage.getItem(scopedKey(PRESET_SESSION_KEY));
    return raw ? (JSON.parse(raw) as PresetSessionPtr) : null;
  } catch { return null; }
}

function cloneHistorySnapshot(np: NormalizedPreset): PromptHistorySnapshot {
  return {
    prompts: structuredClone(np.prompts),
    promptOrder: structuredClone(np.promptOrder),
  };
}

export default function Preset() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [creatingDiy, setCreatingDiy] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const saveInFlight = useRef(false);
  const loadedEpoch = useRef(getVaultEpoch());
  const [cowCharacterId, setCowCharacterId] = useState<string | undefined>();
  const [cowCharacterName, setCowCharacterName] = useState('');
  const [preset, setPreset] = useState<NormalizedPreset | null>(null);
  const [originalPreset, setOriginalPreset] = useState<NormalizedPreset | null>(null);
  const [fileName, setFileName] = useState('preset');
  const [originalFileName, setOriginalFileName] = useState('preset');
  const [activeCharacterId, setActiveCharacterId] = useState(DEFAULT_CHARACTER_ID);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<PresetItem[]>([]);
  const [listReadError, setListReadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PresetItem | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [tab, setTab] = useState('overview');
  const [showTour, setShowTour] = useState(false);

  const historyRef = useRef<PromptHistorySnapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPresetRef = useRef<NormalizedPreset | null>(null);
  latestPresetRef.current = preset;
  const [, forceUpdate] = useState(0);

  useEffect(() => () => {
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
  }, []);

  const isDirty = JSON.stringify({ title: fileName.trim() || '未命名预设', preset })
    !== JSON.stringify({ title: originalFileName.trim() || '未命名预设', preset: originalPreset });

  const resetHistory = useCallback((np: NormalizedPreset | null) => {
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    if (!np) {
      historyRef.current = [];
      historyIndexRef.current = -1;
      return;
    }
    historyRef.current = [cloneHistorySnapshot(np)];
    historyIndexRef.current = 0;
  }, []);

  const pushHistory = useCallback((nextPreset: NormalizedPreset) => {
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    const nextSnap = cloneHistorySnapshot(nextPreset);
    const curSnap = historyRef.current[historyIndexRef.current];
    if (curSnap && JSON.stringify(curSnap) === JSON.stringify(nextSnap)) return;
    const h = historyRef.current.slice(0, historyIndexRef.current + 1);
    h.push(nextSnap);
    if (h.length > MAX_HISTORY_STEPS) h.shift();
    historyRef.current = h;
    historyIndexRef.current = h.length - 1;
    forceUpdate((n) => n + 1);
  }, []);

  const scheduleHistorySnapshot = useCallback((nextPreset: NormalizedPreset) => {
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
    historyDebounceRef.current = setTimeout(() => {
      historyDebounceRef.current = null;
      pushHistory(nextPreset);
    }, 400);
  }, [pushHistory]);

  const applyPreset = useCallback((item: PresetItem | null) => {
    loadedEpoch.current = getVaultEpoch();
    setPreset(item?.preset ?? null);
    setOriginalPreset(item?.preset ?? null);
    setFileName(item?.catalog?.name || item?.title || 'preset');
    setOriginalFileName(item?.catalog?.name || item?.title || 'preset');
    setCurrentItemId(item?.id ?? null);
    const activeGroup = item ? selectActivePromptOrderGroup(item.preset) : undefined;
    const firstId = activeGroup?.character_id ?? DEFAULT_CHARACTER_ID;
    setActiveCharacterId(firstId);
    resetHistory(item?.preset ?? null);
    setTab('overview');
  }, [resetHistory]);

  const initialTarget = useRef<Promise<{ item: PresetItem | null; imported: boolean }> | null>(null);
  const { pendingTarget, confirmPending, cancelPending, captureCurrent, requestAsset, acceptLocalAsset, ownsLocation } = useAssetIdentityNavigation({
    isDirty,
    load: async (identity, { initial, isCurrent }) => {
      const epoch = getVaultEpoch();
      if (initial && !identity.assetId && !initialTarget.current) {
        const handoff = takePendingToolFile('preset');
        const sessionId = loadSessionPtr()?.itemId;
        initialTarget.current = handoff ? handoff.text().then((text) => ({
          item: { id: generatePresetId(), title: handoff.name.replace(/\.json$/i, ''), preset: parsePreset(JSON.parse(text)), createdAt: Date.now(), updatedAt: Date.now(), autoSaved: true },
          imported: true,
        })) : (sessionId ? getPreset(sessionId) : Promise.resolve(null)).then((item) => ({ item: item ?? null, imported: false }));
      }
      let readErr: string | null = null;
      const [item, character, items, restored] = await Promise.all([
        identity.assetId ? getPreset(identity.assetId) : null,
        identity.characterId ? getCharacter(identity.characterId) : null,
        getAllPresets().catch((err: unknown) => {
          readErr = err instanceof Error ? err.message : '读取预设列表失败';
          return [];
        }),
        initial && !identity.assetId ? initialTarget.current : null,
      ]);
      if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请从预设库重新打开');
      if (isCurrent()) {
        setListReadError(readErr);
        setSavedItems(item && !items.some((saved) => saved.id === item.id) ? [item, ...items] : items);
      }
      if (identity.assetId && !item) throw new Error('找不到这套预设，它可能已被移除，请返回预设库重新选择');
      return { item: item ?? restored?.item ?? null, characterName: character?.name ?? '', imported: restored?.imported ?? false };
    },
    accept: (target, identity) => {
      applyPreset(target.item);
      setCowCharacterId(identity.characterId ?? undefined);
      setCowCharacterName(target.characterName);
      if (target.imported && target.item) void persistImportedHistory(target.item);
    },
    onError: (error) => toast({ title: '载入预设失败', description: error instanceof Error ? error.message : String(error), variant: 'destructive' }),
  });

  const refreshSaved = useCallback(async (isCurrent = captureCurrent()) => {
    const epoch = getVaultEpoch();
    try {
      const items = await getAllPresets();
      if (isCurrent() && epoch === getVaultEpoch() && epoch === loadedEpoch.current) {
        setListReadError(null);
        setSavedItems(items);
      }
    } catch (error) {
      if (isCurrent() && epoch === getVaultEpoch()) {
        setListReadError(error instanceof Error ? error.message : '无法刷新已存预设列表');
      }
    }
  }, [captureCurrent]);

  const persistImportedHistory = useCallback(async (item: PresetItem) => {
    const isCurrent = captureCurrent();
    const epoch = loadedEpoch.current;
    try {
      if (epoch !== getVaultEpoch()) return;
      await savePreset({ ...item, autoSaved: false });
      if (!isCurrent() || epoch !== getVaultEpoch()) return;
      setCurrentItemId(item.id);
      await refreshSaved(isCurrent);
    } catch (error) {
      console.error('[Preset] auto-persist imported preset failed:', error);
    }
  }, [captureCurrent, refreshSaved]);

  useEffect(() => {
    if (!isTourCompleted('preset')) {
      const t = setTimeout(() => setShowTour(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    try {
      if (currentItemId) sessionStorage.setItem(scopedKey(PRESET_SESSION_KEY), JSON.stringify({ itemId: currentItemId }));
      else sessionStorage.removeItem(scopedKey(PRESET_SESSION_KEY));
    } catch { /* Optional sessionStorage pointer */ }
  }, [currentItemId]);

  const mutateWithHistory = useCallback((updater: (prev: NormalizedPreset) => NormalizedPreset) => {
    setPreset((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      pushHistory(next);
      return next;
    });
  }, [pushHistory]);

  const handleOrderChange = useCallback((order: OrderEntry[]) => {
    mutateWithHistory((prev) => ({
      ...prev,
      promptOrder: prev.promptOrder.map((g) => (g.character_id === activeCharacterId ? { ...g, order } : g)),
    }));
  }, [activeCharacterId, mutateWithHistory]);

  const undo = useCallback(() => {
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    const livePreset = latestPresetRef.current;
    if (livePreset) {
      const liveSnap = cloneHistorySnapshot(livePreset);
      const topSnap = historyRef.current[historyIndexRef.current];
      if (!topSnap || JSON.stringify(topSnap) !== JSON.stringify(liveSnap)) {
        const h = historyRef.current.slice(0, historyIndexRef.current + 1);
        h.push(liveSnap);
        if (h.length > MAX_HISTORY_STEPS) h.shift();
        historyRef.current = h;
        historyIndexRef.current = h.length - 1;
      }
    }
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    const snap = historyRef.current[historyIndexRef.current];
    setPreset((prev) => prev ? { ...prev, prompts: structuredClone(snap.prompts), promptOrder: structuredClone(snap.promptOrder) } : prev);
    forceUpdate((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    const snap = historyRef.current[historyIndexRef.current];
    setPreset((prev) => prev ? { ...prev, prompts: structuredClone(snap.prompts), promptOrder: structuredClone(snap.promptOrder) } : prev);
    forceUpdate((n) => n + 1);
  }, []);

  const hasUncommittedPromptDraft = Boolean(
    preset
    && historyRef.current[historyIndexRef.current]
    && JSON.stringify(cloneHistorySnapshot(preset)) !== JSON.stringify(historyRef.current[historyIndexRef.current]),
  );
  const canUndo = historyIndexRef.current > 0 || hasUncommittedPromptDraft;
  const canRedo = !hasUncommittedPromptDraft && historyIndexRef.current < historyRef.current.length - 1;

  const handleCharacterIdChange = useCallback((id: number) => {
    setActiveCharacterId(id);
  }, []);

  const handleBlockContentChange = useCallback((identifier: string, content: string) => {
    setPreset((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        prompts: prev.prompts.map((p) => (p.identifier === identifier ? { ...p, content } : p)),
      };
      scheduleHistorySnapshot(next);
      return next;
    });
  }, [scheduleHistorySnapshot]);

  const handleBlockNameChange = useCallback((identifier: string, name: string) => {
    setPreset((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        prompts: prev.prompts.map((p) => (p.identifier === identifier ? { ...p, name } : p)),
      };
      scheduleHistorySnapshot(next);
      return next;
    });
  }, [scheduleHistorySnapshot]);

  const handleBlockRoleChange = useCallback((identifier: string, role: 'system' | 'user' | 'assistant') => {
    mutateWithHistory((prev) => ({
      ...prev,
      prompts: prev.prompts.map((p) => (p.identifier === identifier && !p.marker ? { ...p, role } : p)),
    }));
  }, [mutateWithHistory]);

  const handleAddBlock = useCallback((name: string, kind: 'relative' | 'injection' = 'relative') => {
    const identifier = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    mutateWithHistory((prev) => {
      const base = { identifier, name: name || (kind === 'injection' ? '新注入块' : '新提示词块'), role: 'system' as const, content: '' };
      const newBlock = kind === 'injection'
        ? { ...base, injection_position: 1, injection_depth: 4, injection_order: 100, injection_trigger: [] as string[] }
        : base;
      return {
        ...prev,
        prompts: [...prev.prompts, newBlock],
        promptOrder: prev.promptOrder.map((g) =>
          g.character_id === activeCharacterId
            ? { ...g, order: [...g.order, { identifier, enabled: true }] }
            : g
        ),
      };
    });
    return identifier;
  }, [activeCharacterId, mutateWithHistory]);

  const handleDeleteBlock = useCallback((identifier: string) => {
    mutateWithHistory((prev) => ({
      ...prev,
      prompts: prev.prompts.filter((p) => p.identifier !== identifier || p.marker === true),
      promptOrder: prev.promptOrder.map((g) => ({
        ...g,
        order: g.order.filter((o) => o.identifier !== identifier),
      })),
    }));
  }, [mutateWithHistory]);

  const handleBlockInjectionChange = useCallback((identifier: string, field: 'injection_depth' | 'injection_order', value: number) => {
    setPreset((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        prompts: prev.prompts.map((p) => (p.identifier === identifier ? { ...p, [field]: value } : p)),
      };
      scheduleHistorySnapshot(next);
      return next;
    });
  }, [scheduleHistorySnapshot]);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setPreset((prev) => prev ? { ...prev, originalData: { ...prev.originalData, [key]: value } } : prev);
  }, []);

  const handleNumberParamChange = useCallback((key: string, value: number | undefined) => {
    setPreset((prev) => {
      if (!prev) return prev;
      const nextOd = { ...prev.originalData };
      if (value === undefined) delete nextOd[key];
      else nextOd[key] = value;
      return { ...prev, originalData: nextOd };
    });
  }, []);

  const handleToggleScript = useCallback((scriptKey: string, enabled: boolean) => {
    setPreset((prev) => (prev ? togglePresetEmbeddedScriptInDraft(prev, scriptKey, enabled) : prev));
  }, []);

  const handleRulesChange = useCallback((rules: RegexRule[]) => {
    setPreset((prev) => prev ? { ...prev, regexRules: rules, hasRegexExtension: true } : prev);
  }, []);

  const loadFile = useCallback(async (file: File) => {
    const isCurrent = captureCurrent();
    const epoch = getVaultEpoch();
    if (!file.name.toLowerCase().endsWith('.json')) {
      toast({ title: '请选择 .json 预设文件', description: '若要导入整套 .zip 预设压缩包，请前往「预设库 → 导入预设」。', variant: 'destructive' });
      return;
    }
    try {
      const np = parsePreset(JSON.parse(await file.text()));
      if (!isCurrent() || epoch !== getVaultEpoch()) return;
      const name = file.name.replace(/\.json$/i, '');
      const item = { id: generatePresetId(), title: name, preset: np, createdAt: Date.now(), updatedAt: Date.now(), autoSaved: true };
      applyPreset(item);
      void persistImportedHistory(item);
      toast({ title: '预设导入成功', description: `共读入 ${np.prompts.length} 个提示词块` });
    } catch (e) {
      if (!isCurrent()) return;
      toast({
        title: '无法读取预设文件',
        description: e instanceof Error ? e.message : '请检查文件是否为 SillyTavern 聊天补全预设 JSON',
        variant: 'destructive',
      });
    }
  }, [toast, captureCurrent, applyPreset, persistImportedHistory]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }, [loadFile]);

  const handleSaveLocal = useCallback(async () => {
    if (!preset || saveInFlight.current) return;
    const effectiveTitle = fileName.trim() || '未命名预设';
    saveInFlight.current = true; setSaving(true);
    const isCurrent = captureCurrent();
    const epoch = getVaultEpoch();
    const assertCurrent = () => { if (!isCurrent() || epoch !== getVaultEpoch() || epoch !== loadedEpoch.current) throw new Error('当前预设或资料库已切换，请重新打开后保存'); };
    const now = Date.now();
    try {
      assertCurrent();
      const base = currentItemId ? await getPreset(currentItemId) : undefined;
      assertCurrent();
      if (currentItemId && !base && savedItems.some(item => item.id === currentItemId)) throw new Error('预设已被移除，请先在「导出」页签备份草稿');
      if (cowCharacterId && base) {
        const result = await saveAssetWithCow({
          kind: 'preset',
          baseId: base.id,
          reload: getAllPresets,
          characterId: cowCharacterId,
          characterName: cowCharacterName,
          title: effectiveTitle,
          titleExplicit: effectiveTitle !== originalFileName,
          content: { preset, autoSaved: false },
          newId: generatePresetId,
          save: savePreset,
          now,
          assertCurrent,
          validate: (_target, latestBase) => {
            if (originalPreset && presetContentFingerprint(latestBase.preset) !== presetContentFingerprint(originalPreset)) throw new Error('来源预设已在其他位置修改，请先导出草稿，再重新打开');
          },
        });
        if (!isCurrent() || epoch !== getVaultEpoch()) return;
        setFileName(result.title);
        if (result.action === 'update') toast({ title: '已保存修改' });
        else if (result.action === 'redirect') toast({ title: `已更新专属预设「${result.title}」`, description: '原共享预设未改动' });
        else toast({ title: '已生成角色专属预设副本', description: `「${result.title}」，不影响其他角色` });
        const applySaved = () => {
          setCurrentItemId(result.targetId);
          setOriginalPreset(preset);
          setOriginalFileName(result.title);
        };
        if (ownsLocation()) acceptLocalAsset(result.targetId, applySaved);
        else applySaved();
        await refreshSaved();
        return;
      }
      const id = currentItemId || generatePresetId();
      if (base) await saveEditedPreset(id, effectiveTitle, preset, originalPreset ?? undefined, originalFileName);
      else await savePreset(buildPresetSaveItem({ base, id, title: effectiveTitle, preset, now }));
      assertCurrent();
      if (cowCharacterId && !base) {
        const updatedCharacter = await updateCharacterAssetReference(cowCharacterId, 'preset', id, id, now);
        if (!updatedCharacter) throw new Error('预设已保存，但角色挂载切换失败：角色可能已被移除');
      }
      if (!isCurrent()) return;
      const applySaved = () => {
        setCurrentItemId(id);
        setFileName(effectiveTitle);
        setOriginalPreset(preset);
        setOriginalFileName(effectiveTitle);
      };
      if (ownsLocation()) acceptLocalAsset(id, applySaved);
      else applySaved();
      await refreshSaved();
      toast({ title: '预设已保存', description: '修改已写入预设库，进入内置酒馆或重新刷新即可生效' });
    } catch (error: unknown) {
      if (!isCurrent()) return;
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally { saveInFlight.current = false; setSaving(false); }
  }, [preset, originalPreset, originalFileName, fileName, currentItemId, savedItems, cowCharacterId, cowCharacterName, refreshSaved, toast, captureCurrent, acceptLocalAsset, ownsLocation]);

  const handleDiy = async () => {
    if (!currentItemId || !preset || saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true); setCreatingDiy(true);
    const isCurrent = captureCurrent(), epoch = getVaultEpoch();
    try {
      if (epoch !== loadedEpoch.current) throw new Error('资料库已切换，请从预设库重新打开');
      const item = await createPresetDiy(currentItemId, { title: fileName.trim() || '未命名预设', preset });
      if (!isCurrent() || epoch !== getVaultEpoch()) return;
      setOriginalPreset(preset); setOriginalFileName(fileName);
      toast({ title: `已另存副本「${item.title}」`, description: '原版与已有角色挂载保持不动' });
      await refreshSaved(isCurrent);
      setDiyTarget(item.id);
    } catch (error) { if (isCurrent()) toast({ title: '另存副本失败', description: error instanceof Error ? error.message : String(error), variant: 'destructive' }); }
    finally { saveInFlight.current = false; setSaving(false); setCreatingDiy(false); }
  };
  const [diyTarget, setDiyTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!diyTarget || saving) return;
    navigate(`/preset?assetId=${encodeURIComponent(diyTarget)}&from=${searchParams.get('from') === 'detail' ? 'detail' : searchParams.get('from') === 'library' ? 'library' : 'catalog'}`);
    setDiyTarget(null);
  }, [diyTarget, saving, navigate, searchParams]);

  const handleDeleteItem = useCallback(async (options: RemoveOptions) => {
    if (!deleteTarget) return;
    const isCurrent = captureCurrent();
    const target = deleteTarget;
    const deleted = await executeDeleteAction(async () => {
      if (loadedEpoch.current !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开后删除');
      await deletePreset(target.id, options);
      if (!isCurrent()) return;
      if (target.id === currentItemId) setCurrentItemId(null);
      await refreshSaved(isCurrent);
    }, {
      onSuccess: () => { if (isCurrent()) toast({ title: `已删除预设「${target.title}」` }); },
      onFailure: () => { if (isCurrent()) toast({ title: '删除预设失败', variant: 'destructive' }); },
    });
    if (deleted && isCurrent()) setDeleteTarget(null);
    return deleted;
  }, [currentItemId, deleteTarget, refreshSaved, toast, captureCurrent]);

  const actions = preset && (
    <>
      <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setTrialOpen(true)}>
        <FlaskConical className="w-4 h-4 mr-1.5" /> 边改边试
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={saving}>
            <History className="w-4 h-4 mr-1.5" /> 切换预设
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <h4 className="text-sm font-medium mb-2">库内预设（{savedItems.length}）</h4>
          {listReadError && <p role="alert" className="text-xs text-destructive mb-2">{listReadError}</p>}
          <ScrollArea className="max-h-72">
            <div className="space-y-1">
              {savedItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-accent/40 text-sm">
                  <FileJson className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <button type="button" className="flex-1 min-w-0 text-left truncate" title={presetOptionLabel(item)} onClick={() => requestAsset(item.id)}>
                    {presetOptionLabel(item)}
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-destructive text-xs shrink-0" onClick={() => setDeleteTarget(item)}>删除</button>
                </div>
              ))}
              {savedItems.length === 0 && !listReadError && <p className="text-xs text-muted-foreground text-center py-4">暂无已保存预设</p>}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
      <Button type="button" size="sm" disabled={saving} onClick={() => void handleSaveLocal()}>
        <Save className="w-4 h-4 mr-1.5" /> {saving ? '保存中…' : currentItemId ? '保存修改' : '保存到预设库'}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={saving || !currentItemId} onClick={() => void handleDiy()}><Copy className="w-4 h-4 mr-1.5" />另存为 DIY 副本</Button>
      <label>
        <Button variant="outline" size="sm" asChild>
          <span><Download className="w-4 h-4 mr-1.5" /> 导入 JSON</span>
        </Button>
        <input type="file" accept=".json,application/json" className="hidden" disabled={saving}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }} />
      </label>
    </>
  );

  return (
    <AppLayout actions={actions}>
      <PresetDraftBoundary dirty={isDirty || saving} />
      <AlertDialog open={!!pendingTarget} onOpenChange={(open) => { if (!open) cancelPending(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认切换预设？</AlertDialogTitle>
            <AlertDialogDescription>当前预设有未保存的修改，切换后这些改动将会丢失。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>放弃并切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <fieldset disabled={creatingDiy} className="contents">
        <div className="container mx-auto px-4 py-6">
          <Button type="button" variant="ghost" className="mb-3" onClick={() => navigate(searchParams.get('from') === 'detail' && currentItemId ? `/presets/${encodeURIComponent(currentItemId)}` : `/presets${currentItemId ? `?presetId=${encodeURIComponent(currentItemId)}` : ''}`)}><ArrowLeft className="w-4 h-4 mr-1" />{searchParams.get('from') === 'detail' ? '返回系列详情' : '返回预设库'}</Button>
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg gold-gradient flex items-center justify-center shadow-card shrink-0">
              <SlidersHorizontal className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-display font-semibold">预设 DIY 工坊</h1>
                {cowCharacterId && cowCharacterName && (
                  <Badge variant="secondary" title="从角色页进入的处理：保存共享预设时会生成该角色的派生副本，原资产不动">
                    为「{cowCharacterName}」定制
                  </Badge>
                )}
                <HelpCard>
                  自由调整提示词激活顺序、正文、采样参数、开头预填词与内嵌正则／脚本，支持随时打开右上角「边改边试」测试最新文风，保存后完整兼容 SillyTavern。
                </HelpCard>
              </div>
              {preset ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">预设名称：</span>
                  <Input
                    size="sm"
                    aria-label="预设名称"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="输入预设名称"
                    className="max-w-xs text-sm font-medium"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">精修提示词顺序、采样温度、开头预填与内嵌正则</p>
              )}
            </div>
          </div>

          {!preset ? (
            <Card className="max-w-2xl mx-auto" data-tour="preset-import">
              <CardContent className="pt-6">
                <label
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 cursor-pointer transition-colors ${
                    dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                  }`}
                >
                  <Download className="w-8 h-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">拖入或点击选择预设文件（.json）</span>
                  <span className="text-xs text-muted-foreground/70">支持 SillyTavern 导出的聊天补全预设</span>
                  <input type="file" accept=".json,application/json" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }} />
                </label>
                {listReadError && <p role="alert" className="mt-3 text-xs text-destructive">{listReadError}</p>}
                {savedItems.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground mb-2">或从预设库打开：</p>
                    <div className="space-y-1">
                      {savedItems.slice(0, 8).map((item) => (
                        <button key={item.id} type="button" className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-accent/40 text-sm text-left" onClick={() => requestAsset(item.id)}>
                          <FileJson className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="flex-1 min-w-0 truncate" title={presetOptionLabel(item)}>{presetOptionLabel(item)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList data-tour="preset-tabs" className="max-w-full overflow-x-auto justify-start">
                <TabsTrigger value="overview">概览与参数</TabsTrigger>
                <TabsTrigger value="prompts">提示词编排</TabsTrigger>
                <TabsTrigger value="utility">衔接与包裹格式</TabsTrigger>
                <TabsTrigger value="regex">正则{preset.regexRules.length > 0 ? `（${preset.regexRules.length}）` : ''}</TabsTrigger>
                <TabsTrigger value="export" data-tour="preset-export">导出</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-4">
                <PresetOverview
                  preset={preset}
                  onNumberParamChange={handleNumberParamChange}
                  onFieldChange={handleFieldChange}
                  onToggleScript={handleToggleScript}
                />
              </TabsContent>
              <TabsContent value="prompts" className="mt-4">
                <PromptEditor
                  preset={preset}
                  activeCharacterId={activeCharacterId}
                  onCharacterIdChange={handleCharacterIdChange}
                  onOrderChange={handleOrderChange}
                  onBlockContentChange={handleBlockContentChange}
                  onBlockNameChange={handleBlockNameChange}
                  onBlockRoleChange={handleBlockRoleChange}
                  onAddBlock={handleAddBlock}
                  onDeleteBlock={handleDeleteBlock}
                  onBlockInjectionChange={handleBlockInjectionChange}
                  onUndo={undo}
                  onRedo={redo}
                  canUndo={canUndo}
                  canRedo={canRedo}
                />
              </TabsContent>
              <TabsContent value="utility" className="mt-4">
                <PresetUtilityFields preset={preset} onFieldChange={handleFieldChange} />
              </TabsContent>
              <TabsContent value="regex" className="mt-4">
                <PresetRegexEditor rules={preset.regexRules} onRulesChange={handleRulesChange} />
              </TabsContent>
              <TabsContent value="export" className="mt-4">
                <PresetExport preset={preset} originalPreset={originalPreset} activeCharacterId={activeCharacterId} fileName={fileName} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </fieldset>
      <Sheet open={trialOpen && !!preset} onOpenChange={setTrialOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>边改边试 · {fileName || '未命名预设'}</SheetTitle>
            <SheetDescription>直接读取当前尚未保存的提示词与参数草稿进行对话测试，不污染正式聊天记录。</SheetDescription>
          </SheetHeader>
          {preset && <PresetPlayground presetId={currentItemId || 'diy-draft'} presetOverride={{ title: fileName, preset }} />}
        </SheetContent>
      </Sheet>
      <DeleteConfirmDialog
        open={!!deleteTarget}
        title={`删除预设「${deleteTarget?.title ?? ''}」？`}
        description="条目将从预设库移除。若角色仍挂载该预设，角色页会提示引用失效。"
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        fileTarget={deleteTarget ? { store: 'presets', id: deleteTarget.id } : undefined}
        onConfirm={handleDeleteItem}
      />
      {showTour && (
        <GuidedTour
          steps={PRESET_TOUR_STEPS}
          module="preset"
          onComplete={() => { setTourCompleted('preset'); setShowTour(false); }}
          onSkip={() => { setTourCompleted('preset'); setShowTour(false); }}
        />
      )}
    </AppLayout>
  );
}
