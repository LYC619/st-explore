import { tr } from '@/lib/i18n';
import { useI18n, useLocalizedMemo } from '@/lib/i18n/react';
import { useEffect, useState } from 'react';
import {
  Archive,
  BookOpen,
  Braces,
  Download,
  FileText,
  Link2,
  Loader2,
  MessageSquareText,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatBytes } from '@/lib/storage-utils';
import {
  countImportPicks,
  createAllImportPicks,
  createEmptyImportPicks,
  IMPORT_POLICY_SUMMARY,
  toggleImportPick,
  type STImportPicks,
} from '@/lib/vault/st-import-presentation';
import type { STImportProgress } from '@/lib/vault/st-import-progress';
import type { STScanResult } from '@/lib/vault/st-import';

interface STImportSelectionDialogProps {
  root: string;
  scan: STScanResult;
  picks: STImportPicks;
  importing: boolean;
  /** 入库进度；importing 期间由父级喂进来。 */
  progress?: STImportProgress | null;
  /** 已经点过取消，正在等当前条目收尾 */
  canceling?: boolean;
  /** 解压时跳过的 secrets.json 数量；只有从备份包进来才可能 >0。 */
  skippedSecrets?: number;
  onPicksChange: (picks: STImportPicks) => void;
  onCancel: () => void;
  onImport: () => void;
}

type SectionId = 'characters' | 'chats' | 'worldbooks' | 'presets' | 'archives' | 'regex' | 'relationships';

interface SectionDefinition {
  id: SectionId;
  label: string;
  found: number;
  selected: number;
  icon: typeof Users;
}

interface PickRowProps {
  checked: boolean;
  title: string;
  description: string;
  onCheckedChange: (checked: boolean) => void;
  icon?: typeof Archive;
}

function PickRow({ checked, title, description, onCheckedChange, icon: Icon }: PickRowProps) {
  return (
    <Label className="flex min-h-14 cursor-pointer items-start gap-3 border-b border-border px-1 py-3 font-normal last:border-b-0 hover:bg-accent/30">
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} className="mt-0.5" />
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground" title={title}>{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </Label>
  );
}

export function STImportSelectionDialog({
  root,
  scan,
  picks,
  importing,
  progress = null,
  canceling = false,
  skippedSecrets = 0,
  onPicksChange,
  onCancel,
  onImport,
}: STImportSelectionDialogProps) {
  useI18n();
  const sections = useLocalizedMemo<SectionDefinition[]>(() => {
    const rows: Array<SectionDefinition | false> = [
      scan.characters.length > 0 && {
        id: 'characters', label: tr("角色"), found: scan.characters.length, selected: picks.chars.size, icon: Users,
      },
      scan.strayChats.length > 0 && {
        id: 'chats', label: tr("散聊天"), found: scan.strayChats.length, selected: picks.strays.size, icon: MessageSquareText,
      },
      scan.worldbooks.length > 0 && {
        id: 'worldbooks', label: tr("世界书"), found: scan.worldbooks.length, selected: picks.wbs.size, icon: BookOpen,
      },
      scan.presets.length > 0 && {
        id: 'presets', label: tr("预设"), found: scan.presets.length, selected: picks.presets.size, icon: SlidersHorizontal,
      },
      scan.archives.length > 0 && {
        id: 'archives', label: tr("其他资产"), found: scan.archives.length, selected: picks.archives.size, icon: Archive,
      },
      scan.regex !== null && {
        id: 'regex', label: tr("正则"), found: 1, selected: picks.regex ? 1 : 0, icon: Braces,
      },
      scan.relationships.status !== 'missing' && {
        id: 'relationships',
        label: tr("关联"),
        found: scan.relationships.status === 'parsed' ? 1 : 0,
        selected: picks.settingsRelations ? 1 : 0,
        icon: Link2,
      },
    ];
    return rows.filter((row): row is SectionDefinition => row !== false);
  }, [picks, scan]);
  const [activeSection, setActiveSection] = useState<SectionId>(sections[0]?.id ?? 'characters');
  useEffect(() => {
    if (!sections.some((section) => section.id === activeSection)) {
      setActiveSection(sections[0]?.id ?? 'characters');
    }
  }, [activeSection, sections]);
  const pickedCount = countImportPicks(picks);
  const availableCount = countImportPicks(createAllImportPicks(scan));
  const characterChatCount = scan.characters.reduce((sum, character) => sum + character.chats.length, 0);
  const foundSummary = [
    tr("{{v0}} 个角色", { v0: scan.characters.length }),
    tr("{{v0}} 场聊天", { v0: characterChatCount + scan.strayChats.length }),
    tr("{{v0}} 本世界书", { v0: scan.worldbooks.length }),
    tr("{{v0}} 个预设", { v0: scan.presets.length }),
  ].join(' · ');

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !canceling) onCancel(); }}>
      <DialogContent className="grid max-h-[calc(100vh-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-4 pt-6 pr-12">
          <DialogTitle>{tr("选择要导入的内容")}</DialogTitle>
          <DialogDescription className="space-y-1">
            <span className="block">{tr("扫描到 ")}{foundSummary}</span>
            <span className="block truncate" title={root}>
              {root}{scan.userDir ? tr(" · 已定位到 {{v0}}", { v0: scan.userDir }) : ''}
            </span>
          </DialogDescription>
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">{tr("重复导入规则：")}</span>{tr(IMPORT_POLICY_SUMMARY)}
            </p>
          </div>
          {skippedSecrets > 0 && (
            <div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">{tr("已跳过 secrets.json：")}</span>{tr("包里的 API 密钥文件没有被解压，本应用也不需要它。其余内容照常导入。")}</p>
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 border-y border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
            <div>
              <p className="text-sm font-medium">{tr("已选 ")}{pickedCount} / {availableCount}{tr(" 个项目组")}</p>
              <p className="text-xs text-muted-foreground">{tr("切换类别不会清除已经勾选的内容")}</p>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => onPicksChange(createAllImportPicks(scan))}>{tr("全选")}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onPicksChange(createEmptyImportPicks())}>{tr("清空")}</Button>
            </div>
          </div>

          <Tabs value={activeSection} onValueChange={(value) => setActiveSection(value as SectionId)} className="flex h-[min(58vh,34rem)] min-h-0 flex-col">
            <div className="shrink-0 overflow-x-auto border-y border-border bg-muted/30 px-4 py-2">
              <TabsList className="h-auto min-w-max justify-start bg-transparent p-0">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <TabsTrigger key={section.id} value={section.id} className="gap-1.5 px-2.5">
                      <Icon className="h-3.5 w-3.5" />
                      {section.label}
                      <span className="text-[11px] text-muted-foreground">{section.selected}/{section.found}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            <div className="min-h-0 overflow-y-auto px-6 py-3">
              <TabsContent value="characters" className="m-0">
                <p className="mb-2 text-xs text-muted-foreground">{tr("角色卡进入角色库，名下聊天一并进入对应角色的故事。")}</p>
                {scan.characters.map((character) => (
                  <PickRow
                    key={character.pngPath}
                    checked={picks.chars.has(character.pngPath)}
                    title={character.name}
                    description={character.chats.length
                      ? tr("{{v0}} 场聊天 · {{v1}}", { v0: character.chats.length, v1: formatBytes(character.chatBytes) })
                      : tr("仅角色卡 · {{v0}}", { v0: formatBytes(character.pngSize) })}
                    onCheckedChange={(checked) => onPicksChange({
                      ...picks,
                      chars: toggleImportPick(picks.chars, character.pngPath, checked),
                    })}
                  />
                ))}
              </TabsContent>

              <TabsContent value="chats" className="m-0">
                <p className="mb-2 text-xs text-muted-foreground">{tr("没有匹配角色卡的聊天会进入临时故事，内容不会丢弃。")}</p>
                {scan.strayChats.map((chat) => (
                  <PickRow
                    key={chat.path}
                    checked={picks.strays.has(chat.path)}
                    title={`${chat.characterDir} / ${chat.name}`}
                    description={tr("{{v0}} · 导入为未绑定故事", { v0: formatBytes(chat.size) })}
                    onCheckedChange={(checked) => onPicksChange({
                      ...picks,
                      strays: toggleImportPick(picks.strays, chat.path, checked),
                    })}
                  />
                ))}
              </TabsContent>

              <TabsContent value="worldbooks" className="m-0">
                <p className="mb-2 text-xs text-muted-foreground">{tr("世界书进入附属库，并用于恢复角色、全局和聊天关联。")}</p>
                {scan.worldbooks.map((worldbook) => (
                  <PickRow
                    key={worldbook.path}
                    checked={picks.wbs.has(worldbook.path)}
                    title={worldbook.name}
                    description={formatBytes(worldbook.size)}
                    onCheckedChange={(checked) => onPicksChange({
                      ...picks,
                      wbs: toggleImportPick(picks.wbs, worldbook.path, checked),
                    })}
                  />
                ))}
              </TabsContent>

              <TabsContent value="presets" className="m-0">
                <p className="mb-2 text-xs text-muted-foreground">{tr("聊天补全预设进入附属库，可继续查看和编辑。")}</p>
                {scan.presets.map((preset) => (
                  <PickRow
                    key={preset.path}
                    checked={picks.presets.has(preset.path)}
                    title={preset.name}
                    description={tr("{{v0}} · OpenAI Settings 预设", { v0: formatBytes(preset.size) })}
                    onCheckedChange={(checked) => onPicksChange({
                      ...picks,
                      presets: toggleImportPick(picks.presets, preset.path, checked),
                    })}
                  />
                ))}
              </TabsContent>

              <TabsContent value="archives" className="m-0">
                <p className="mb-2 text-xs text-muted-foreground">{tr("扩展代码不会执行；其他文件保持原目录结构，用户人设只提取相关设置，统一归档到“资产/其他/SillyTavern”。")}</p>
                {scan.archives.map((group) => (
                  <PickRow
                    key={group.kind}
                    icon={Archive}
                    checked={picks.archives.has(group.kind)}
                    title={group.label}
                    description={tr("{{v0}} · 识别 {{v1}} 项 · 共 {{v2}} 个归档文件 · {{v3}}", { v0: group.description, v1: group.itemCount, v2: group.files.length + (group.generatedFiles?.length ?? 0), v3: formatBytes(group.bytes) })}
                    onCheckedChange={(checked) => onPicksChange({
                      ...picks,
                      archives: toggleImportPick(picks.archives, group.kind, checked),
                    })}
                  />
                ))}
              </TabsContent>

              <TabsContent value="regex" className="m-0">
                <p className="mb-2 text-xs text-muted-foreground">{tr("settings.json 中的全局正则整组进入附属库。")}</p>
                {scan.regex && (
                  <PickRow
                    checked={picks.regex}
                    title={tr("ST 全局正则")}
                    description={tr("{{v0}} 条脚本 · 导入为一套规则集", { v0: scan.regex.count })}
                    onCheckedChange={(checked) => onPicksChange({ ...picks, regex: checked })}
                  />
                )}
              </TabsContent>

              <TabsContent value="relationships" className="m-0">
                <p className="mb-2 text-xs text-muted-foreground">{tr("主绑定和对话级关系随角色与聊天恢复；这里控制 settings 中的全局和额外链接。")}</p>
                {scan.relationships.status === 'parsed' ? (
                  <PickRow
                    checked={picks.settingsRelations}
                    title={tr("settings.json 世界书关系")}
                    description={tr("全局 {{v0}} 个 · 角色额外链接 {{v1}} 个", { v0: scan.relationships.globalWorldbooks.length, v1: scan.relationships.characterWorldbooks.reduce((sum, row) => sum + row.worldbooks.length, 0) })}
                    onCheckedChange={(checked) => onPicksChange({ ...picks, settingsRelations: checked })}
                  />
                ) : (
                  <div className="flex items-start gap-2 rounded border border-border bg-muted/30 p-3 text-sm">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <p><span className="font-medium">{tr("settings.json 无法解析。")}</span><br /><span className="text-xs text-muted-foreground">{tr("本次不会改动已有的全局或额外世界书链接。")}</span></p>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="px-6 py-4">
          {!!scan.warnings.length && !importing && (
            <p className="mb-3 text-xs text-muted-foreground">{tr("已安全跳过 ")}{scan.warnings.length}{tr(" 个符号链接、非法路径名或过深目录；路径会写入本次清单。")}</p>
          )}
          {importing && progress && (
            <div className="mb-3 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  {progress.total ? tr("写入中 {{v0}} / {{v1}}", { v0: progress.done, v1: progress.total }) : tr("写入中 {{v0}}", { v0: progress.done })}
                </span>
                <span className="min-w-0 truncate text-muted-foreground" title={progress.label}>
                  {progress.label ?? ''}
                </span>
              </div>
              <Progress
                value={progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0}
                className="h-2"
              />
              {/* 入库和前两个阶段不一样：写进去的东西撤不回来，取消前必须说清楚 */}
              <p className="text-xs text-muted-foreground">{tr("取消会停在当前条目，已经写入的内容会保留。")}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onCancel} disabled={canceling}>
              {importing ? (canceling ? tr("正在停止…") : tr("取消导入")) : tr("取消")}
            </Button>
            <Button onClick={onImport} disabled={importing || pickedCount === 0}>
              {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}{tr("导入 ")}{pickedCount}{tr(" 个项目组")}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
