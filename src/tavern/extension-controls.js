/** Installs the unmodified, version-verified upstream browser package in this vault. */
export async function installExtensionControls(host, st) {
    const info = await (await host.request('/ste/extensions')).json();
    const panel = document.createElement('div'); panel.className = 'extension_container'; panel.id = 'ste_original_extensions';
    panel.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>原版扩展 · 酒馆助手</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
      <div class="inline-drawer-content"><p class="ste_original_status"></p><p>安装原版酒馆助手后，使用其完整的脚本库、前端渲染与助手面板；内置精简助手会停止运行。安装到当前资料库，重新打开聊天后生效。</p>
      <p><a class="ste_original_download" target="_blank" rel="noopener noreferrer">下载已验证的 4.11.3 原版 ZIP</a> · <a href="https://github.com/N0VI028/JS-Slash-Runner" target="_blank" rel="noopener noreferrer">原项目与说明</a></p>
      <label class="menu_button">安装 ZIP<input class="ste_original_zip" type="file" accept=".zip" style="max-width:220px"></label><button class="menu_button ste_original_remove">移除原版助手</button>
      <small>原版扩展及其脚本可以操作酒馆页面、聊天和设定，请使用你信任的脚本。底层文件操作、创建/导入角色卡仍由 STE 资产管理承接。</small></div></div>`;
    panel.querySelector('.ste_original_download').href = `https://codeload.github.com/N0VI028/JS-Slash-Runner/zip/${info.helperSupported.commit}`;
    for (const link of panel.querySelectorAll('a[href]')) {
        link.addEventListener('click', async event => {
            event.preventDefault();
            try {
                const response = await host.request('/ste/open-url', { url: link.href });
                if (!response.ok) throw new Error((await response.json()).error?.message ?? '打开链接失败');
            } catch (error) { toastr.error(error.message); }
        });
    }
    panel.querySelector('.ste_original_status').textContent = info.helper ? `已安装 ${info.helper.version}` : '尚未安装 · 当前使用内置助手';
    panel.querySelector('.ste_original_remove').disabled = !info.helper;
    const reload = async () => { await st.flushDebouncedChatSave(); await host.flush(); location.reload(); };
    panel.querySelector('.ste_original_zip').addEventListener('change', async event => {
        const file = event.target.files?.[0]; if (!file) return;
        try {
            if (file.size > 25 * 1024 * 1024) throw new Error('插件 ZIP 需小于 25 MB');
            event.target.disabled = true;
            await st.flushDebouncedChatSave(); await host.flush();
            const response = await host.request('/ste/extensions/helper/install', { bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
            if (!response.ok) throw new Error((await response.json()).error?.message ?? '安装失败');
            toastr.success('原版酒馆助手已保存，正在重新加载聊天'); await reload();
        } catch (error) { toastr.error(error.message); event.target.disabled = false; event.target.value = ''; }
    });
    panel.querySelector('.ste_original_remove').addEventListener('click', async () => {
        try {
            const response = await host.request('/ste/extensions/helper/remove');
            if (!response.ok) throw new Error((await response.json()).error?.message ?? '移除失败');
            await reload();
        } catch (error) { toastr.error(error.message); }
    });
    document.querySelector('#extensions_settings')?.prepend(panel);
}
