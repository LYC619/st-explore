import {
  Activity,
  ArrowLeft,
  CircleHelp,
  Code,
  ExternalLink,
  FileUp,
  GitBranch,
  Loader2,
  Menu,
  PanelRightClose,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { QuickModelSwitcher } from '@/components/ai-tools/QuickModelSwitcher';

export type TavernSettingsSection = 'runtime' | 'models' | 'scripts' | 'branches' | 'chat';

export interface RoleplayHeaderBarProps {
  detached: boolean;
  fromChats: boolean;
  isMobile: boolean;
  ready: boolean;
  leaving: boolean;
  isGenerating: boolean;
  status: string;
  detachedContainer: HTMLElement | null;
  onDockBackInline: () => void;
  onLeave: () => void;
  onPopOutToDetached: () => void;
  onManageModels: () => void;
  onOpenProcess: () => void;
  onOpenSettings: (section: TavernSettingsSection) => void;
  onOpenGuide: () => void;
  onCloseChat: () => void;
}

export function RoleplayHeaderBar({
  detached,
  fromChats,
  isMobile,
  ready,
  leaving,
  isGenerating,
  status,
  detachedContainer,
  onDockBackInline,
  onLeave,
  onPopOutToDetached,
  onManageModels,
  onOpenProcess,
  onOpenSettings,
  onOpenGuide,
  onCloseChat,
}: RoleplayHeaderBarProps) {
  const actionClass = 'min-h-11 md:min-h-0 md:h-8 px-2 text-xs';
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[color:var(--border-subtle)] bg-chrome/80 px-2.5 py-1">
      {detached ? (
        <Button
          variant="ghost"
          size="sm"
          className={actionClass}
          disabled={leaving || isGenerating}
          title={isGenerating ? '请等待本轮回复生成结束后再收回页内' : '关闭独立窗口，把对话收回到主窗口页内继续'}
          onClick={onDockBackInline}
        >
          {leaving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PanelRightClose className="mr-1 h-3.5 w-3.5" />}
          收回页内
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className={actionClass} disabled={leaving} onClick={onLeave}>
          {leaving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="mr-1 h-3.5 w-3.5" />}
          {fromChats ? '返回聊天列表' : '返回聊天处理'}
        </Button>
      )}

      <QuickModelSwitcher
        portalContainer={detachedContainer}
        busy={isGenerating}
        disabled={leaving}
        onManage={onManageModels}
        className="min-h-11 md:min-h-0 md:h-8 max-w-[13rem] text-xs"
      />

      <span role="status" title={status} className="min-w-[7rem] flex-1 truncate px-1 text-xs text-muted-foreground">
        {status}
      </span>

      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-0.5">
        {!detached && !isMobile && (
          <Button
            variant="outline"
            size="sm"
            className={actionClass}
            disabled={leaving || isGenerating}
            onClick={onPopOutToDetached}
            title={isGenerating ? '请等待本轮回复生成结束后再弹出独立窗口' : '弹出为独立窗口，可与左侧阅读/角色库左右分屏（Win + ← / →）'}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            独立窗口
          </Button>
        )}
        <Button variant="ghost" size="sm" className={actionClass} disabled={!ready} aria-label="过程" title="查看请求与生成过程" onClick={onOpenProcess}>
          <Activity className="h-3.5 w-3.5 xl:mr-1" /><span className="hidden xl:inline">过程</span>
        </Button>
        <Button variant="ghost" size="sm" className={actionClass} disabled={!ready || leaving} aria-label="分支" title="切换或管理故事分支" onClick={() => onOpenSettings('branches')}>
          <GitBranch className="h-3.5 w-3.5 xl:mr-1" /><span className="hidden xl:inline">分支</span>
        </Button>
        <Button variant="ghost" size="sm" className={actionClass} disabled={!ready || leaving} aria-label="脚本" title="脚本与扩展控制" onClick={() => onOpenSettings('scripts')}>
          <Code className="h-3.5 w-3.5 xl:mr-1" /><span className="hidden xl:inline">脚本</span>
        </Button>
        <Button variant="ghost" size="sm" className={actionClass} disabled={!ready || leaving} aria-label="聊天工具" title="打开聊天工具菜单" onClick={() => onOpenSettings('chat')}>
          <Menu className="h-3.5 w-3.5 xl:mr-1" /><span className="hidden xl:inline">聊天工具</span>
        </Button>
        <Button variant="ghost" size="sm" className={actionClass} disabled={!ready} aria-label="玩法设置" title="打开玩法与记忆设置" onClick={() => onOpenSettings('runtime')}>
          <SlidersHorizontal className="h-3.5 w-3.5 xl:mr-1" /><span className="hidden xl:inline">玩法设置</span>
        </Button>
        <Button variant="ghost" size="sm" className={actionClass} aria-label="使用帮助" title="查看续聊使用帮助" onClick={onOpenGuide}>
          <CircleHelp className="h-3.5 w-3.5 xl:mr-1" /><span className="hidden xl:inline">使用帮助</span>
        </Button>
        <Button variant="ghost" size="sm" className={actionClass} disabled={leaving} aria-label="关闭聊天" title="保存并关闭当前聊天" onClick={onCloseChat}>
          <X className="h-3.5 w-3.5 xl:mr-1" /><span className="hidden xl:inline">关闭聊天</span>
        </Button>
      </div>
    </header>
  );
}

export interface RoleplayRecoveryBannersProps {
  ready: boolean;
  error?: string;
  saveFailed: boolean;
  startupSlow: boolean;
  leaving: boolean;
  exporting: boolean;
  exportNotice?: string;
  confirmExit: boolean;
  closingWindow: boolean;
  detachedContainer: HTMLElement | null;
  onRetryStartup: () => void;
  onRetrySave: () => void;
  onExportRecovery: () => void;
  onConfirmExitChange: (open: boolean) => void;
  onForceLeave: () => void;
}

export function RoleplayRecoveryBanners({
  ready,
  error,
  saveFailed,
  startupSlow,
  leaving,
  exporting,
  exportNotice,
  confirmExit,
  closingWindow,
  detachedContainer,
  onRetryStartup,
  onRetrySave,
  onExportRecovery,
  onConfirmExitChange,
  onForceLeave,
}: RoleplayRecoveryBannersProps) {
  return (
    <>
      {(error || saveFailed) && (
        <div role="alert" className="shrink-0 border-b bg-destructive/10 px-4 py-3 text-sm">
          <p className="break-words text-destructive">{error ?? '正在重试保存…'}</p>
          {!ready && !saveFailed && (
            <Button variant="outline" size="sm" className="mt-2 min-h-11" disabled={leaving} onClick={onRetryStartup}>
              <RotateCcw className="mr-1 h-4 w-4" />重新加载酒馆
            </Button>
          )}
          {saveFailed && (
            <>
              <p className="mt-1 text-muted-foreground">可以修复原因后重试，或先导出恢复文件再离开。导出会保留当前编辑和未发送输入。</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={leaving} onClick={onRetrySave}>
                  {leaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}重试保存
                </Button>
                <Button variant="outline" size="sm" disabled={exporting} onClick={onExportRecovery}>
                  <FileUp className="mr-1 h-4 w-4" />{exporting ? '正在导出…' : '导出当前内容'}
                </Button>
                <Button variant="ghost" size="sm" disabled={leaving || exporting} onClick={() => onConfirmExitChange(true)}>
                  退出聊天
                </Button>
              </div>
              {exportNotice && <p className="mt-2 text-muted-foreground" role="status">{exportNotice}</p>}
            </>
          )}
        </div>
      )}

      {!ready && !error && startupSlow && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-muted px-4 py-2 text-sm">
          <span>加载时间较长，可等待当前步骤完成，或重新加载。</span>
          <Button variant="outline" size="sm" className="min-h-11" disabled={leaving} onClick={onRetryStartup}>
            <RotateCcw className="mr-1 h-4 w-4" />重新加载酒馆
          </Button>
        </div>
      )}

      <AlertDialog open={confirmExit} onOpenChange={onConfirmExitChange}>
        <AlertDialogContent container={detachedContainer}>
          <AlertDialogHeader>
            <AlertDialogTitle>离开未保存的聊天？</AlertDialogTitle>
            <AlertDialogDescription>
              本次保存没有完成。离开后，尚未保存的回复、编辑和输入可能丢失。建议先取消并“导出当前内容”；确认离开会直接{closingWindow ? '关闭窗口' : '离开聊天'}。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>留在聊天</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onForceLeave}
            >
              确认离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
