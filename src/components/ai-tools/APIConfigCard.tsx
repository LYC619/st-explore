import { useEffect, useState } from 'react';
import { Key, Check, AlertCircle, PlugZap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DEFAULT_API_URL } from './api-profiles';
import { useApiProfiles } from './useApiProfiles';
import { ApiScopeToggle } from './ApiScopeToggle';
import { ProfileToolbar } from './ProfileToolbar';
import { ModelNameInput } from './ModelNameInput';
import { ApiConfigSyncNotice } from './ApiConfigSyncNotice';

// 持久化/领域层已拆到 api-profiles.ts；barrel（index.ts）从那里导出 loadAPIConfig 等。

/** 多提供商 API 配置卡：全应用唯一的 AI 配置维护点（其余页面用 ApiStatusLine 状态条）。 */
export function APIConfigCard() {
  const {
    profiles, activeId, savedActive,
    name, setName, apiKey, setApiKey, apiUrl, setApiUrl, model, setModel, modelList, favoriteModels, setFavoriteModels,
    dirty, setDirty, externalChanged, fetchingModels, testing, testResult, reload,
    handleSwitch, handleAdd, handleDuplicate, handleDelete,
    handleSave, handleFetchModels, handleTest,
  } = useApiProfiles();

  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  useEffect(() => setIsKeyVisible(false), [activeId]);
  const requestChange = (action: () => void) => {
    const apply = () => { setIsKeyVisible(false); action(); };
    if (dirty) setPending(() => apply); else apply();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="w-5 h-5" />
          AI 服务配置
        </CardTitle>
        <CardDescription>
          每个服务保存自己的地址、密钥和常用模型。各 AI 工作区可直接切换已保存的服务与模型；连接信息在这里维护，密钥保存在本机。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ApiScopeToggle onChanged={reload} onRequestChange={requestChange} />
        <ApiConfigSyncNotice />
        {!profiles.length && <p role="status" className="text-sm text-muted-foreground">尚无已保存连接。可重新读取本机连接，或填写下方信息后保存新服务。</p>}

        <ProfileToolbar
          profiles={profiles}
          activeId={activeId}
          onSwitch={id => requestChange(() => handleSwitch(id))}
          onAdd={() => requestChange(handleAdd)}
          onDuplicate={handleDuplicate}
          onDeleteClick={() => setDeleteOpen(true)}
        />

        <div className="space-y-2">
          <Label>提供商名称</Label>
          <Input
            value={name}
            aria-label="提供商名称"
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            placeholder="例如：OpenAI / 中转站 A / 本地 Ollama"
          />
        </div>

        <div className="space-y-2">
          <Label>API Key</Label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                type={isKeyVisible ? 'text' : 'password'}
                value={apiKey}
                aria-label="API Key"
                onChange={(e) => { setApiKey(e.target.value); setDirty(true); }}
                placeholder="sk-..."
              />
            </div>
            <Button variant="outline" onClick={() => setIsKeyVisible(!isKeyVisible)}>
              {isKeyVisible ? '隐藏' : '显示'}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>API 接口地址</Label>
          <Input
            value={apiUrl}
            aria-label="API 接口地址"
            onChange={(e) => { setApiUrl(e.target.value); setDirty(true); }}
            placeholder={DEFAULT_API_URL}
          />
          <p className="text-xs text-muted-foreground">
            支持 OpenAI 兼容格式的接口，如官方、各类中转站、本地部署的模型等
          </p>
        </div>

        <ModelNameInput
          model={model}
          modelList={modelList}
          favoriteModels={favoriteModels}
          onFavoriteToggle={value => { setFavoriteModels(previous => previous.includes(value) ? previous.filter(item => item !== value) : [...previous, value]); setDirty(true); }}
          fetching={fetchingModels}
          onModelChange={(v) => { setModel(v); setDirty(true); }}
          onFetch={handleFetchModels}
        />

        {externalChanged && <div role="status" className="rounded-md border border-border p-3 text-xs text-muted-foreground">当前使用的服务已在其他位置切换。这里保留的是「{name}」的草稿，保存只更新该服务。<Button variant="link" size="sm" onClick={() => requestChange(reload)}>查看当前配置</Button></div>}

        <div className="flex gap-2 pt-2 flex-wrap items-center">
          <Button onClick={handleSave}>保存配置</Button>
          <Button variant="outline" className="gap-1" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
            测试连通
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">有未保存的修改</span>}
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 text-sm rounded-md border px-3 py-2 ${
            testResult.ok
              ? 'border-[var(--status-ok-bg)] bg-[var(--status-ok-bg)] text-[color:var(--status-ok)]'
              : 'border-[var(--status-warn-bg)] bg-[var(--status-warn-bg)] text-[color:var(--status-warn)]'
          }`}>
            {testResult.ok ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span className="break-all">{testResult.text}</span>
          </div>
        )}

        {savedActive?.apiKey ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="w-4 h-4 text-primary" />
            已保存：{savedActive.name} · {savedActive.model}
            {savedActive.apiUrl !== DEFAULT_API_URL && <span className="text-xs">· 自定义接口</span>}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="w-4 h-4 text-destructive" />
            当前提供商尚未配置 API Key
          </div>
        )}
      </CardContent>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除提供商「{savedActive?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>该提供商的密钥与配置将被移除，此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { handleDelete(); setDeleteOpen(false); }}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!pending} onOpenChange={open => { if (!open) setPending(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>服务配置还未保存</AlertDialogTitle><AlertDialogDescription>切换会离开当前草稿。可以先保存，或放弃这次修改。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel onClick={() => setPending(null)}>继续编辑</AlertDialogCancel>
            <Button variant="outline" onClick={() => { const action = pending; setPending(null); action?.(); }}>放弃修改并切换</Button>
            <AlertDialogAction onClick={event => { event.preventDefault(); if (handleSave()) { const action = pending; setPending(null); action?.(); } }}>保存并切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
