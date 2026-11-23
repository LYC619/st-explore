use tauri::Manager;
use webview2_com::WindowCloseRequestedEventHandler;

/// Wry closes the child WebView HWND for JavaScript window.close(), but Tauri's
/// outer window can remain visible. Close that shell only after WebView2 accepts
/// the page's close request (including beforeunload), without requesting it twice.
pub fn close_native_shell_with_webview(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    window.with_webview(move |webview| {
        let close_app = app.clone();
        let close_label = label.clone();
        // SAFETY: with_webview runs on the window's UI thread. The COM event owns
        // its callback; the callback resolves the label instead of retaining the
        // WebView/controller that owns it.
        let registered = unsafe {
            webview.controller().CoreWebView2().and_then(|core| {
                core.add_WindowCloseRequested(
                    &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                        if let Some(window) = close_app.get_webview_window(&close_label) {
                            if let Err(error) = window.destroy() {
                                log::error!("Unable to close detached window shell: {error}");
                            }
                        }
                        Ok(())
                    })),
                    &mut 0,
                )
            })
        };
        if let Err(error) = registered {
            log::error!("Unable to register WebView2 close handler: {error}");
            if let Some(window) = app.get_webview_window(&label) {
                if let Err(error) = window.destroy() {
                    log::error!("Unable to discard detached window: {error}");
                }
            }
        }
    })
}
