export async function installPackageControls(host) {
    const { Popup, POPUP_TYPE } = await import('/scripts/popup.js');
    const panel = document.createElement('div'); panel.className = 'extension_container'; panel.id = 'ste_story_package_settings';
    panel.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>完整故事包</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content"><small>包含全部分支、角色、关联资产、文件记忆和恢复记录。连接凭据与安装脚本不随包迁移。</small>
        <button class="menu_button" id="ste_story_export">导出完整故事包</button><label class="menu_button">导入故事包<input type="file" id="ste_story_import" accept=".ste-play" style="max-width:100%"></label></div></div>`;
    document.querySelector('#extensions_settings')?.append(panel);
    async function request(path, body) { const response = await host.request(path, body), data = await response.json(); if (!response.ok) throw new Error(data.error?.message ?? '故事包操作失败'); return data; }
    const exportButton = panel.querySelector('#ste_story_export');
    exportButton.addEventListener('click', async () => {
        exportButton.disabled = true;
        try {
            await window.__STE_TAVERN_FLUSH__();
            const result = await request('/ste/story-package/export');
            if (result.result !== 'cancelled') toastr.success(result.result === 'downloaded' ? '已开始下载完整故事包' : '完整故事包已导出');
        } catch (error) { toastr.error(error.message); } finally { exportButton.disabled = false; }
    });
    panel.querySelector('#ste_story_import').addEventListener('change', async event => {
        const file = event.target.files?.[0]; if (!file) return;
        event.target.disabled = true;
        try {
            if (file.size > 64 * 1024 * 1024) throw new Error('故事包不能超过 64 MiB');
            const { token, preview } = await request('/ste/story-package/preview', { text: await file.text() });
            const box = document.createElement('div'); const title = document.createElement('b'); title.textContent = preview.story.title; box.append(title);
            const labels = { create: '新增', identical: '已有相同内容', conflict: '存在冲突' };
            for (const record of preview.records) { const row = document.createElement('p'); row.textContent = `${record.title}：${labels[record.action]}`; box.append(row); }
            const files = document.createElement('p'); files.textContent = `记忆与记录：${preview.files.length} 个文件`; box.append(files);
            if (preview.omissions.length) {
                const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = `未包含的内容（${preview.omissions.length} 项）`; details.append(summary);
                for (const item of preview.omissions) { const row = document.createElement('p'); row.textContent = `${item.name ?? item.field}：${item.reason === 'credential' ? '连接凭据' : item.reason === 'executable' ? '脚本请另行安装' : '本机外部文件或路径'}`; details.append(row); } box.append(details);
            }
            for (const conflict of preview.conflicts) { const row = document.createElement('p'); row.textContent = conflict; box.append(row); }
            const accepted = await new Popup(box, preview.canApply ? POPUP_TYPE.CONFIRM : POPUP_TYPE.TEXT, '', { wide: true, okButton: preview.canApply ? '确认导入' : '关闭' }).show();
            if (accepted && preview.canApply) {
                await window.__STE_TAVERN_FLUSH__();
                const result = await request('/ste/story-package/import', { token });
                toastr.success(result.status === 'identical' ? '已存在相同故事' : '完整故事已导入');
                await request('/ste/open-story', { storyId: result.storyId });
            }
        } catch (error) { toastr.error(error.message); } finally { event.target.value = ''; event.target.disabled = false; }
    });
}
