import { tr, getLocale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useCallback, useRef, useState } from 'react';
import { Database, Eye, FolderCog, Info, KeyRound, Settings, BookText } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { APIConfigCard } from '@/components/ai-tools';
import { AboutSettingsPanel, DataSettingsPanel } from '@/components/GlobalSettings';
import { HelpCard } from '@/components/HelpCard';
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
import {
  DirectorySettingsPanel,
  DisplaySettingsPanel,
} from '@/components/settings/RuntimeSettingsPanel';
import {
  loadSettingsSection,
  saveSettingsSection,
  type SettingsSection,
} from '@/lib/settings-navigation';
import { BuiltinPromptsPanel } from '@/components/settings/BuiltinPromptsPanel';
import { cn } from '@/lib/utils';

const SECTION_ITEMS = [
  // English uses a section noun here; the same Chinese word is also the Show action.
  { key: 'display', get label() { return getLocale() === 'en' ? 'Display' : tr("显示"); }, icon: Eye },
  { key: 'ai', get label() { return tr("AI 配置"); }, icon: KeyRound },
  { key: 'prompts', get label() { return tr("内置提示词"); }, icon: BookText },
  { key: 'directories', get label() { return tr("目录与连接"); }, icon: FolderCog },
  { key: 'data', get label() { return tr("数据与备份"); }, icon: Database },
  { key: 'about', get label() { return tr("关于与引导"); }, icon: Info },
] satisfies Array<{ key: SettingsSection; label: string; icon: typeof Eye }>;

function renderSettingsPanel(
  activeSection: SettingsSection,
  onAiDirtyStateChange: (state: { dirty: boolean; save: () => boolean }) => void,
) {
  switch (activeSection) {
    case 'display':
      return <DisplaySettingsPanel />;
    case 'ai':
      return (
        <div className="space-y-3" data-tour="ai-config">
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-muted-foreground">{tr("全应用 AI 能力共用这里的提供商配置。")}</p>
            <HelpCard>{tr("支持保存多个 OpenAI 兼容提供商并随时切换，可拉取模型列表、测试连通。密钥仅保存在本地，客户端另镜像到系统配置目录，不写入库文件夹。")}</HelpCard>
          </div>
          <APIConfigCard onDirtyStateChange={onAiDirtyStateChange} />
        </div>
      );
    case 'prompts':
      return <BuiltinPromptsPanel />;
    case 'directories':
      return <DirectorySettingsPanel />;
    case 'data':
      return <DataSettingsPanel />;
    case 'about':
      return <AboutSettingsPanel />;
  }
}

const SettingsPage = () => {
  useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSection>(() => loadSettingsSection());
  const [pendingSection, setPendingSection] = useState<SettingsSection | null>(null);
  const aiDirtyRef = useRef<{ dirty: boolean; save: () => boolean }>({ dirty: false, save: () => true });
  const activeItem = SECTION_ITEMS.find((item) => item.key === activeSection) ?? SECTION_ITEMS[0];

  const handleAiDirtyStateChange = useCallback((state: { dirty: boolean; save: () => boolean }) => {
    aiDirtyRef.current = state;
  }, []);

  const applySection = (section: SettingsSection) => {
    aiDirtyRef.current = { dirty: false, save: () => true };
    setActiveSection(section);
    saveSettingsSection(section);
  };

  const selectSection = (section: SettingsSection) => {
    if (section === activeSection) return;
    if (activeSection === 'ai' && aiDirtyRef.current.dirty) {
      setPendingSection(section);
      return;
    }
    applySection(section);
  };

  return (
    <AppLayout
      leftActions={
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          <span className="font-display font-semibold">{tr("设置")}</span>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6">
        <div className="grid gap-5 md:grid-cols-[190px_minmax(0,1fr)] md:gap-8">
          <nav
            aria-label={tr("设置分区")}
            className="flex gap-1 overflow-x-auto border-b border-border pb-2 md:sticky md:top-0 md:h-fit md:flex-col md:overflow-visible md:border-b-0 md:border-r md:pb-0 md:pr-4"
          >
            {SECTION_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.key === activeSection;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => selectSection(item.key)}
                  className={cn(
                    'flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors',
                    active
                      ? 'bg-[var(--brand-active-bg)] text-brand font-medium'
                      : 'text-muted-foreground hover:bg-[var(--hover-overlay)] hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <section className="min-w-0" aria-labelledby="settings-section-title">
            <h1 id="settings-section-title" className="mb-4 font-display text-lg font-semibold">
              {activeItem.label}
            </h1>
            {renderSettingsPanel(activeSection, handleAiDirtyStateChange)}
          </section>
        </div>
      </div>

      <AlertDialog open={pendingSection !== null} onOpenChange={(open) => { if (!open) setPendingSection(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("AI 服务配置还未保存")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("你刚修改了接口地址、密钥或模型，切换设置分区会丢失未保存的改动。")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{tr("继续编辑")}</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const next = pendingSection;
                setPendingSection(null);
                if (next) applySection(next);
              }}
            >{tr("放弃修改并切换")}</Button>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (aiDirtyRef.current.save()) {
                  const next = pendingSection;
                  setPendingSection(null);
                  if (next) applySection(next);
                }
              }}
            >{tr("保存并切换")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
};

export default SettingsPage;
