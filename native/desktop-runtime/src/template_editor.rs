use tauri::Manager;

const WINDOW_LABEL: &str = "template-editor";
const TITLE: &str = "xsheet-remap - Template";

pub(super) fn is_template_launch(args: impl IntoIterator<Item = std::ffi::OsString>) -> bool {
    args.into_iter().any(|argument| argument == "--template")
}

pub(super) fn create_window(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::App("index.html?app=template-editor".into()),
    )
    .title(TITLE)
    .inner_size(1440.0, 900.0)
    .min_inner_size(1024.0, 720.0);
    // Keep the former Template WebView profile, including its IndexedDB draft.
    // Do not copy a live Chromium database into Remap's sheet profile.
    #[cfg(target_os = "windows")]
    let builder = builder.data_directory(
        app.path()
            .local_data_dir()
            .map_err(|error| error.to_string())?
            .join("local.xsheet-remap.template-editor"),
    );
    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(super) async fn open_template_editor(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    create_window(&app, WINDOW_LABEL)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_explicit_switch_selects_template_authoring() {
        assert!(is_template_launch(["--template".into()]));
        assert!(!is_template_launch([]));
        assert!(!is_template_launch(["sample.template.json".into()]));
        assert!(!is_template_launch(["--template-other".into()]));
    }
}
