/** Poll only while the retained chat is visible or generating; never overlap requests. */
export function installStatusPolling(host, poll, page = window, delay = 1500) {
    let timer, stopped = false, pending = false, refreshAgain = false;
    const needed = () => !stopped && (host.isGenerating() || (host.isForeground() && page.document.visibilityState !== 'hidden'));
    const clear = () => { if (timer !== undefined) page.clearTimeout(timer); timer = undefined; };
    async function run() {
        clear();
        if (!needed()) return;
        if (pending) { refreshAgain = true; return; }
        pending = true;
        try { await poll(); } catch { /* Status failure must not affect generation or saving. */ }
        finally {
            pending = false;
            if (needed()) {
                if (refreshAgain) { refreshAgain = false; void run(); }
                else timer = page.setTimeout(() => { void run(); }, delay);
            } else refreshAgain = false;
        }
    }
    function changed() { clear(); if (needed()) void run(); }
    const unsubscribe = host.subscribeActivity(changed);
    page.document.addEventListener('visibilitychange', changed);
    function close() {
        stopped = true; clear(); unsubscribe();
        page.document.removeEventListener('visibilitychange', changed);
        page.removeEventListener('pagehide', close);
    }
    page.addEventListener('pagehide', close, { once: true });
    void run();
    return close;
}
