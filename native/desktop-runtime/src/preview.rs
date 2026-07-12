use super::*;
#[tauri::command(rename_all = "camelCase")]
pub(super) async fn open_asset_preview_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, AssetPreviewState>,
    payload: AssetPreviewPayload,
) -> Result<(), String> {
    {
        let mut latest_payload = state.0.lock().map_err(|error| error.to_string())?;
        *latest_payload = Some(payload.clone());
    }

    if let Some(window) = app.get_webview_window(ASSET_PREVIEW_WINDOW_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        app.emit_to(
            ASSET_PREVIEW_WINDOW_LABEL,
            ASSET_PREVIEW_UPDATE_EVENT,
            payload,
        )
        .map_err(|error| error.to_string())?;
        window
            .eval(ASSET_PREVIEW_REFRESH_SCRIPT)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let preview_window = tauri::WebviewWindowBuilder::new(
        &app,
        ASSET_PREVIEW_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html?window=asset-preview".into()),
    )
    .title("素材プレビュー")
    .inner_size(720.0, 720.0)
    .min_inner_size(320.0, 240.0)
    .resizable(true)
    .maximizable(true)
    .minimizable(true)
    .closable(true)
    .decorations(true)
    .focused(true)
    .disable_drag_drop_handler()
    .build()
    .map_err(|error| error.to_string())?;

    preview_window
        .emit(ASSET_PREVIEW_UPDATE_EVENT, payload)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn update_asset_preview_window_if_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, AssetPreviewState>,
    payload: AssetPreviewPayload,
) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(ASSET_PREVIEW_WINDOW_LABEL) else {
        return Ok(false);
    };

    {
        let mut latest_payload = state.0.lock().map_err(|error| error.to_string())?;
        *latest_payload = Some(payload.clone());
    }

    app.emit_to(
        ASSET_PREVIEW_WINDOW_LABEL,
        ASSET_PREVIEW_UPDATE_EVENT,
        payload,
    )
    .map_err(|error| error.to_string())?;
    window
        .eval(ASSET_PREVIEW_REFRESH_SCRIPT)
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn current_asset_preview_payload(
    state: tauri::State<'_, AssetPreviewState>,
) -> Result<Option<AssetPreviewPayload>, String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())
        .map(|latest_payload| latest_payload.clone())
}
