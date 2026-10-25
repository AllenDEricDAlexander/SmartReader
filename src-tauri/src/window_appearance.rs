use tauri::{window::Color, Theme, WebviewWindow};

#[tauri::command]
pub async fn set_window_background_color(
    window: WebviewWindow,
    color: Color,
    theme: Option<Theme>,
) -> Result<(), String> {
    // Native title text and controls must match the page's explicit color scheme.
    if let Some(theme) = theme {
        window
            .set_theme(Some(theme))
            .map_err(|error| error.to_string())?;
    }
    window
        .set_background_color(Some(color))
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| {
                let _ = sender.send(fill_macos_backing_layers(webview, color));
            })
            .map_err(|error| error.to_string())?;
        receiver
            .await
            .map_err(|_| "Window closed before its background could be updated".to_string())??;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn fill_macos_backing_layers(
    webview: tauri::webview::PlatformWebview,
    color: Color,
) -> Result<(), String> {
    use objc2_app_kit::{NSColor, NSView, NSWindow};
    use objc2_quartz_core::CATransaction;

    // with_webview runs on the main thread and keeps both native handles alive.
    let window = unsafe { &*webview.ns_window().cast::<NSWindow>() };
    let view = unsafe { &*webview.inner().cast::<NSView>() };
    let content_view = window
        .contentView()
        .ok_or_else(|| "Window content view is unavailable".to_string())?;
    content_view.setWantsLayer(true);
    view.setWantsLayer(true);
    let content_layer = content_view
        .layer()
        .ok_or_else(|| "Window content backing layer is unavailable".to_string())?;
    let webview_layer = view
        .layer()
        .ok_or_else(|| "WebView backing layer is unavailable".to_string())?;
    let color = NSColor::colorWithSRGBRed_green_blue_alpha(
        f64::from(color.0) / 255.0,
        f64::from(color.1) / 255.0,
        f64::from(color.2) / 255.0,
        f64::from(color.3) / 255.0,
    )
    .CGColor();

    // AppKit can expose these layers before WKWebView presents its resized page.
    // Fill them before acknowledging the update, without an implicit color fade.
    CATransaction::begin();
    CATransaction::setDisableActions(true);
    content_layer.setBackgroundColor(Some(&color));
    webview_layer.setBackgroundColor(Some(&color));
    CATransaction::commit();
    Ok(())
}
