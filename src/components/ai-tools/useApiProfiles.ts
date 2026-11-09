// APIConfigCard 的状态与操作逻辑（表单草稿 + 增删改切换 + 取模型 + 测试连通）。
// 拆自原 APIConfigCard.tsx（阶段8.1 codex P2.1）：视图只管渲染，交互全走这个 hook。
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { fetchModels, callOpenAIMessages } from './useOpenAI';
import {
  type APIConfig, type ApiProfile, DEFAULT_API_URL, DEFAULT_MODEL,
  generateProfileId, persistProfiles, loadApiProfiles,
  storeProfileModelsIfCurrent,
  normalizeModelNames,
} from './api-profiles';
import { subscribeApiProfileChanges } from './useApiProfileState';
import { getApiConfigSyncState } from '@/lib/vault/sensitive-config';

export interface TestResult { ok: boolean; text: string }

export function useApiProfiles() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [activeId, setActiveId] = useState('');

  // 表单 = 活跃提供商的草稿（点「保存」才写入）
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [modelList, setModelList] = useState<string[]>([]);
  const [favoriteModels, setFavoriteModels] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const [externalChanged, setExternalChanged] = useState(false);
  const formRef = useRef({ activeId, apiUrl, apiKey }); formRef.current = { activeId, apiUrl, apiKey };
  const catalogRequest = useRef(0);
  const modelAbort = useRef<AbortController | null>(null), testAbort = useRef<AbortController | null>(null);
  const connectionTest = useRef(0);

  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const loadIntoForm = useCallback((p?: ApiProfile) => {
    ++catalogRequest.current; ++connectionTest.current;
    modelAbort.current?.abort(); testAbort.current?.abort();
    setFetchingModels(false); setTesting(false);
    setName(p?.name ?? '');
    setApiKey(p?.apiKey ?? '');
    setApiUrl(p?.apiUrl || DEFAULT_API_URL);
    setModel(p?.model || DEFAULT_MODEL);
    setModelList(normalizeModelNames(p?.modelList));
    setFavoriteModels(normalizeModelNames(p?.favoriteModels));
    setTestResult(null);
    setDirty(false);
    setExternalChanged(false);
  }, []);

  const reload = useCallback(() => {
    const { profiles: ps, activeId: aid } = loadApiProfiles();
    setProfiles(ps);
    setActiveId(aid);
    const active = ps.find((p) => p.id === aid) ?? ps[0];
    loadIntoForm(active);
  }, [loadIntoForm]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => subscribeApiProfileChanges(scopeChanged => {
    if (scopeChanged || !dirtyRef.current) { reload(); return; }
    const state = loadApiProfiles();
    setProfiles(state.profiles);
    if (state.activeId !== formRef.current.activeId) setExternalChanged(true);
  }), [reload]);
  useEffect(() => () => { ++catalogRequest.current; ++connectionTest.current; modelAbort.current?.abort(); testAbort.current?.abort(); }, []);
  useEffect(() => { ++connectionTest.current; testAbort.current?.abort(); setTesting(false); setTestResult(null); }, [apiKey, apiUrl, model]);

  const savedActive = profiles.find((p) => p.id === activeId);
  const persist = (ps: ApiProfile[], id: string) => {
    if (persistProfiles(ps, id)) return true;
    toast({ title: '连接尚未保存', description: getApiConfigSyncState().message || '请先重新读取已保存连接。', variant: 'destructive' });
    return false;
  };

  const handleSwitch = (id: string) => {
    const { profiles: ps } = loadApiProfiles();
    const target = ps.find((p) => p.id === id);
    if (!target) return;
    if (!persist(ps, id)) return;
    setProfiles(ps);
    setActiveId(id);
    loadIntoForm(target);
  };

  const handleAdd = () => {
    const { profiles: ps } = loadApiProfiles();
    const fresh: ApiProfile = {
      id: '',
      name: `提供商 ${ps.length + 1}`,
      apiKey: '',
      apiUrl: DEFAULT_API_URL,
      model: DEFAULT_MODEL,
      modelList: [],
      favoriteModels: [],
    };
    setActiveId('');
    loadIntoForm(fresh);
    setDirty(true);
  };

  const handleDuplicate = () => {
    const copy: ApiProfile = {
      id: '',
      name: `${name || '提供商'} 副本`,
      apiKey: apiKey.trim(),
      apiUrl: apiUrl.trim() || DEFAULT_API_URL,
      model: model.trim() || DEFAULT_MODEL,
      modelList,
      favoriteModels,
    };
    setActiveId('');
    loadIntoForm(copy);
    setDirty(true);
  };

  const handleDelete = () => {
    const { profiles: ps, activeId: aid } = loadApiProfiles();
    const rest = ps.filter((p) => p.id !== activeId);
    if (rest.length === ps.length) return false;
    if (!persist(rest, aid === activeId ? rest[0]?.id ?? '' : aid)) return false;
    reload();
    toast({ title: '已删除提供商' });
    return true;
  };

  const handleSave = () => {
    if (!apiKey.trim()) {
      toast({ title: '请输入 API Key', variant: 'destructive' });
      return false;
    }
    const { profiles: ps, activeId: aid } = loadApiProfiles();
    let idx = ps.findIndex((p) => p.id === activeId);
    if (!activeId) {
      idx = ps.length;
      ps.push({ id: generateProfileId(), name: name.trim() || '提供商', apiKey: '', apiUrl: DEFAULT_API_URL, model: DEFAULT_MODEL });
    }
    if (idx < 0) { toast({ title: '当前服务已不存在，请重新选择', variant: 'destructive' }); return false; }
    ps[idx] = {
      ...ps[idx],
      name: name.trim() || ps[idx].name,
      apiKey: apiKey.trim(),
      apiUrl: apiUrl.trim() || DEFAULT_API_URL,
      model: model.trim() || DEFAULT_MODEL,
      modelList,
      favoriteModels,
    };
    if (!persist(ps, activeId ? aid : ps[idx].id)) return false;
    setActiveId(ps[idx].id);
    setProfiles(ps);
    setDirty(false);
    setExternalChanged(false);
    toast({ title: '配置已保存', description: ps[idx].name });
    return true;
  };

  const handleFetchModels = async (): Promise<boolean> => {
    const key = apiKey.trim();
    const url = apiUrl.trim() || DEFAULT_API_URL;
    if (!key) {
      toast({ title: '请先输入 API Key', variant: 'destructive' });
      return false;
    }
    setFetchingModels(true);
    const request = ++catalogRequest.current;
    modelAbort.current?.abort();
    const controller = new AbortController(); modelAbort.current = controller;
    const profileId = activeId;
    try {
      const models = await fetchModels(url, key, controller.signal);
      const form = formRef.current;
      if (request !== catalogRequest.current || form.activeId !== profileId || form.apiUrl.trim() !== url || form.apiKey.trim() !== key) return false;
      setModelList(models);
      // 模型列表随获取即写入该提供商（属元数据，不必等「保存」）
      if (storeProfileModelsIfCurrent({ id: profileId, apiUrl: url, apiKey: key }, models)) setProfiles(loadApiProfiles().profiles);
      toast({ title: `已获取 ${models.length} 个模型` });
      return true;
    } catch (e) {
      if (request !== catalogRequest.current || controller.signal.aborted) return false;
      toast({ title: '获取模型列表失败', description: safeError(e, key), variant: 'destructive' });
      return false;
    } finally {
      if (request === catalogRequest.current) setFetchingModels(false);
    }
  };

  // 测试连通：用表单当前值发一个 5 token 的小请求，报延迟或错误详情（可在保存前先测）
  const handleTest = async () => {
    const cfg: APIConfig = {
      apiKey: apiKey.trim(),
      apiUrl: apiUrl.trim() || DEFAULT_API_URL,
      model: model.trim() || DEFAULT_MODEL,
    };
    if (!cfg.apiKey) {
      toast({ title: '请先输入 API Key', variant: 'destructive' });
      return;
    }
    setTesting(true);
    const request = ++connectionTest.current;
    testAbort.current?.abort();
    const controller = new AbortController(); testAbort.current = controller;
    setTestResult(null);
    const t0 = performance.now();
    try {
      await callOpenAIMessages(cfg, [{ role: 'user', content: 'Hi' }], { params: { max_tokens: 5 }, signal: controller.signal });
      if (request !== connectionTest.current || controller.signal.aborted) return;
      const ms = Math.round(performance.now() - t0);
      setTestResult({ ok: true, text: `连通正常 · ${ms}ms · ${cfg.model}` });
    } catch (e) {
      if (request === connectionTest.current && !controller.signal.aborted) setTestResult({ ok: false, text: safeError(e, cfg.apiKey) });
    } finally {
      if (request === connectionTest.current) setTesting(false);
    }
  };

  return {
    // 列表 / 活跃
    profiles, activeId, savedActive,
    // 切换共享/本库作用域后由 ApiScopeToggle 调用：localStorage 已被换成另一套配置
    reload,
    // 表单字段
    name, setName, apiKey, setApiKey, apiUrl, setApiUrl, model, setModel, modelList, favoriteModels, setFavoriteModels,
    dirty, setDirty,
    externalChanged,
    // 异步态
    fetchingModels, testing, testResult,
    // 操作
    handleSwitch, handleAdd, handleDuplicate, handleDelete,
    handleSave, handleFetchModels, handleTest,
  };
}

function safeError(error: unknown, key: string): string {
  const message = error instanceof Error ? error.message : '请检查接口地址、密钥和模型';
  return key ? message.split(key).join('***') : message;
}
