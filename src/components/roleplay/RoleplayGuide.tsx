import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface RoleplayGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModels: () => void;
  onRuntime: () => void;
  inChat?: boolean;
  runtimeReady?: boolean;
}

export function RoleplayGuide({ open, onOpenChange, onModels, onRuntime, inChat = true, runtimeReady = true }: RoleplayGuideProps) {
  const openSettings = (action: () => void) => { onOpenChange(false); action(); };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>聊天与记忆指南</DialogTitle>
        <DialogDescription>先选主模型，再按需要开启记忆。聊天窗口沿用 SillyTavern 的操作方式。</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm leading-relaxed">
        <p><strong>主模型</strong>负责与你对话。先在模型设置中选择连接；没有可用连接时，点击“管理连接”填写 API 地址、密钥和模型。</p>
        <div className="space-y-3">
          <section className="rounded-lg border p-3">
            <h3 className="font-medium">无 Agent · 先聊起来</h3>
            <p className="mt-1 text-muted-foreground">只配置主模型即可。使用原酒馆的世界书触发、预设和正则，不要求模型支持工具调用。</p>
          </section>
          <section className="rounded-lg border p-3">
            <h3 className="font-medium">STE Agent · 自动查阅资料与记忆</h3>
            <p className="mt-1 text-muted-foreground">主模型继续扮演角色，工具模型根据剧情选取世界书、查找和维护本地文件记忆，也能补充文风与剧情提醒。请另选一个支持工具调用的工具模型，再在玩法设置中开启 Agent。</p>
          </section>
          <section className="rounded-lg border p-3">
            <h3 className="font-medium">柏宝书 · 自动摘要与台账</h3>
            <p className="mt-1 text-muted-foreground">在玩法设置中导入指定版本的柏宝书 ZIP，然后选择“无 Agent”，把记忆维护设为“柏宝书”。它使用工具模型整理摘要和人物、物品等记录；与 STE 文件记忆同一时间只启用一种。</p>
          </section>
        </div>
        <p className="text-muted-foreground">玩法设置里可以查看、修改记忆，检查本轮引用的资料。之后随时点击聊天顶部的“使用帮助”重新查看这份指南。</p>
      </div>
      <DialogFooter className="gap-2 sm:space-x-0">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>知道了</Button>
        <Button variant="outline" onClick={() => openSettings(onModels)}>{inChat ? '打开模型设置' : '配置主模型'}</Button>
        <Button disabled={!runtimeReady} onClick={() => openSettings(onRuntime)}>{inChat ? runtimeReady ? '打开玩法设置' : '聊天准备中…' : '选择角色聊天'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
