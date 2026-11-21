import { loadUpstream, errorMessage } from './upstream.js';
/** Controls live in the original ST extension drawer and use its popup implementation. */
import { helperScriptStatus } from './helper-status.js';
import type { HelperHostController, HelperVariableSnapshot } from './helper-host.js';
import type { HelperGrant, HelperScript } from '../lib/roleplay/helper-settings';
import type { ResolvedVariableOption } from './protocol.js';

type EditableScript = Pick<HelperScript, 'type' | 'id' | 'name' | 'content' | 'button'>;

export async function installHelperControls(helper: HelperHostController): Promise<void> {
    const { Popup, POPUP_TYPE } = await loadUpstream('/scripts/popup.js');
    const panel = document.createElement('div'); panel.className = 'extension_container'; panel.id = 'ste_helper_settings';
    panel.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>内置助手 · 脚本与交互内容</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content"><small>按当前聊天保存。导入后启用脚本，并选择它可使用的能力。支持常用助手接口；外部模块和任意 ST 插件需另行适配。</small>
        <div class="flex-container"><label class="menu_button">导入脚本 JSON<input id="ste_helper_import" type="file" accept=".json" style="max-width:180px"></label>
        <button id="ste_helper_new" class="menu_button">新建脚本</button><button id="ste_helper_variables" class="menu_button">变量</button><button id="ste_helper_help" class="menu_button">支持范围</button></div>
        <div id="ste_helper_scripts"></div><hr><div id="ste_helper_html"></div><small>HTML 代码块在进入可见区域后运行；离屏和切换聊天会停止。内嵌内容不能访问父页面、原生文件或连接密钥。</small></div></div>`;
    document.querySelector<HTMLElement>('#extensions_settings')?.append(panel);
    function button(text: string, action: () => Promise<void>): HTMLButtonElement {
        const element = document.createElement('button'); element.className = 'menu_button'; element.textContent = text;
        element.addEventListener('click', () => { void action().catch(error => toastr.error(errorMessage(error))); }); return element;
    }
    function checkbox(text: string, checked: boolean, action: (enabled: boolean) => Promise<void>): HTMLLabelElement {
        const label = document.createElement('label'); label.className = 'checkbox_label';
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; input.setAttribute('aria-label', text);
        input.addEventListener('change', async () => { input.disabled = true; try { await action(input.checked); } catch (error) { toastr.error(errorMessage(error)); render(); } });
        label.append(input, document.createTextNode(text)); return label;
    }
    function grants(row: HTMLElement, target: { grants: HelperGrant[] }, save: () => Promise<void>): void {
        const entries: [HelperGrant, string][] = [['read', '读取剧情'], ['write', '修改资料'], ['generate', '调用工具模型']];
        for (const [grant, label] of entries) row.append(checkbox(label, target.grants.includes(grant), async enabled => {
            target.grants = target.grants.filter(item => item !== grant);
            if (enabled) { target.grants.push(grant); if ((grant === 'write' || grant === 'generate') && !target.grants.includes('read')) target.grants.push('read'); }
            await save();
        }));
    }
    async function editScript(script: EditableScript): Promise<void> {
        const box = document.createElement('div');
        box.innerHTML = '<label>名称<input class="text_pole ste_helper_name"></label><label>JavaScript<textarea class="text_pole ste_helper_source" rows="16" spellcheck="false"></textarea></label><small>使用 eventOn(getButtonEvent("按钮名"), 回调) 响应脚本按钮。同步变量更新可通过 await flushHelperWrites() 等待保存。</small>';
        box.querySelector<HTMLInputElement>('input')!.value = script.name; box.querySelector<HTMLTextAreaElement>('textarea')!.value = script.content;
        if (await new Popup(box, POPUP_TYPE.CONFIRM, '', { wide: true, okButton: '保存', cancelButton: '取消' }).show()) {
            const settings = helper.settings, current = settings.scripts.find(item => item.id === script.id);
            if (current) { current.name = box.querySelector<HTMLInputElement>('input')!.value; current.content = box.querySelector<HTMLTextAreaElement>('textarea')!.value; await helper.configure(settings); }
            else await helper.importScripts({ ...script, name: box.querySelector<HTMLInputElement>('input')!.value, content: box.querySelector<HTMLTextAreaElement>('textarea')!.value });
        }
    }
    function render(): void {
        const list = panel.querySelector<HTMLElement>('#ste_helper_scripts')!; list.replaceChildren();
        const summary = document.createElement('p');
        const enabled = helper.settings.scripts.filter(script => script.enabled);
        summary.id = 'ste_helper_status_summary';
        summary.textContent = `当前聊天 · ${enabled.length} 个已启用 · ${enabled.filter(script => helperScriptStatus(script, helper.records).state === 'running').length} 个运行中`;
        list.append(summary);
        if (!helper.settings.scripts.length) { const empty = document.createElement('p'); empty.textContent = '当前聊天还没有脚本'; list.append(empty); }
        for (const script of helper.settings.scripts) {
            const row = document.createElement('div'); row.className = 'ste-helper-script'; row.style.cssText = 'border-top:1px solid var(--SmartThemeBorderColor);padding:8px 0'; row.dataset.scriptId = script.id;
            const title = document.createElement('b'); title.textContent = script.name; row.append(title);
            const status = helperScriptStatus(script, helper.records);
            const badge = document.createElement('span'); badge.dataset.helperState = status.state; badge.textContent = status.label;
            badge.style.cssText = 'margin-left:8px;font-size:12px'; row.append(badge);
            const save = () => { const settings = helper.settings; settings.scripts = settings.scripts.map(current => current.id === script.id ? { ...script, data: current.data } : current); return helper.configure(settings); };
            row.append(checkbox('启用 ' + script.name, script.enabled, async checked => { script.enabled = checked; await save(); })); grants(row, script, save);
            const actions = document.createElement('div'); actions.className = 'flex-container';
            actions.append(button('编辑', () => editScript(script)), button('删除', async () => {
                const settings = helper.settings; settings.scripts = settings.scripts.filter(item => item.id !== script.id); await helper.configure(settings);
            }));
            if (script.enabled && script.button.enabled) for (const item of script.button.buttons.filter(btn => btn.visible)) actions.append(button(item.name, () => helper.button(script.id, item.name)));
            row.append(actions);
            const error = status.error;
            if (error) { const detail = document.createElement('small'); detail.textContent = error; row.append(detail); }
            list.append(row);
        }
        const html = panel.querySelector<HTMLElement>('#ste_helper_html')!; html.replaceChildren();
        const settings = helper.settings;
        const saveHtml = () => helper.configure({ ...helper.settings, html: settings.html });
        html.append(checkbox('运行 HTML 交互代码块', settings.html.enabled, async checked => { settings.html.enabled = checked; await saveHtml(); }));
        grants(html, settings.html, saveHtml);
    }
    panel.querySelector<HTMLInputElement>('#ste_helper_import')!.addEventListener('change', async event => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0]; if (!file) return;
        try { if (file.size > 4 * 1024 * 1024) throw new Error('脚本文件不能超过 4 MiB'); await helper.importScripts(JSON.parse(await file.text())); toastr.success('已导入，请选择能力并启用'); }
        catch (error) { toastr.error(errorMessage(error)); } finally { input.value = ''; }
    });
    panel.querySelector<HTMLElement>('#ste_helper_new')!.addEventListener('click', () => { void editScript({ type: 'script', id: crypto.randomUUID(), name: '信任计数',
        content: 'eventOn(getButtonEvent("信任 +1"), () => {\n  updateVariablesWith(value => ({ ...value, 信任: (value.信任 ?? 0) + 1 }));\n});',
        button: { enabled: true, buttons: [{ name: '信任 +1', visible: true }] } }).catch(error => toastr.error(errorMessage(error))); });
    panel.querySelector<HTMLElement>('#ste_helper_variables')!.addEventListener('click', async () => {
        const box = document.createElement('div'); box.innerHTML = '<label>变量范围<select><option value="chat">当前聊天</option><option value="message">指定楼层</option><option value="global">全局</option></select></label><label class="ste_variable_message" hidden>楼层编号（从 0 开始）<input type="number" min="0" class="text_pole"></label><textarea class="text_pole" rows="15" spellcheck="false"></textarea>';
        const select = box.querySelector<HTMLSelectElement>('select')!, index = box.querySelector<HTMLInputElement>('input')!, editor = box.querySelector<HTMLTextAreaElement>('textarea')!;
        index.value = String(helper.lastMessageId);
        let previous: HelperVariableSnapshot | undefined;
        let option: ResolvedVariableOption = { type: 'chat' };
        async function load(): Promise<void> {
            const type = select.value as ResolvedVariableOption['type'];
            option = type === 'message' ? { type, message_id: Number(index.value) } : { type };
            previous = await helper.variables(option);
            editor.value = JSON.stringify(previous.value, null, 2);
            box.querySelector<HTMLElement>('label.ste_variable_message')!.hidden = select.value !== 'message';
        }
        select.addEventListener('change', () => { void load().catch(error => toastr.error(errorMessage(error))); }); index.addEventListener('change', () => { void load().catch(error => toastr.error(errorMessage(error))); });
        try {
            await load();
            if (previous && await new Popup(box, POPUP_TYPE.CONFIRM, '', { wide: true, okButton: '保存变量', cancelButton: '取消' }).show()) {
                await helper.saveVariables(option, JSON.parse(editor.value) as Record<string, unknown>, previous);
            }
        } catch (error) { toastr.error(errorMessage(error)); }
    });
    panel.querySelector<HTMLElement>('#ste_helper_help')!.addEventListener('click', () => {
        const text = document.createElement('div');
        text.textContent = '当前支持：读取消息（含候选）；修改 message/data/extra/is_hidden；chat/message/global/script 变量；事件订阅及脚本按钮；常用变量斜杠命令；非流式 generate/generateRaw。同步宏支持 user、char、lastMessageId、getvar、getglobalvar；其余宏可 await steSubstituteMacros(text)。变量更新为同步快照，await flushHelperWrites() 等待落盘。脚本数据仅用于当前聊天，切换聊天会卸载。外部模块、jQuery、直接父页面 DOM、任意世界书 API、自定义连接与完整酒馆助手兼容不在当前范围。';
        void new Popup(text, POPUP_TYPE.TEXT).show();
    });
    helper.onChange(render); render();
}
