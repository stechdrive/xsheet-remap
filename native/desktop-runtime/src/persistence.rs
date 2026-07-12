use super::*;
#[tauri::command(rename_all = "camelCase")]
pub(super) async fn save_text_file(
    window: tauri::WebviewWindow,
    file_name: String,
    contents: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
    default_extension: Option<String>,
    initial_directory: Option<String>,
) -> Result<Option<String>, String> {
    let Some(path) = pick_save_path(
        window,
        file_name,
        filter_name,
        extensions,
        default_extension,
        initial_directory,
    )
    .await?
    else {
        return Ok(None);
    };
    std::fs::write(&path, contents).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn save_binary_file(
    window: tauri::WebviewWindow,
    file_name: String,
    contents_base64: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
    default_extension: Option<String>,
    initial_directory: Option<String>,
) -> Result<Option<String>, String> {
    use base64::Engine as _;

    let Some(path) = pick_save_path(
        window,
        file_name,
        filter_name,
        extensions,
        default_extension,
        initial_directory,
    )
    .await?
    else {
        return Ok(None);
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64)
        .map_err(|error| error.to_string())?;
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

pub(super) async fn pick_save_path(
    window: tauri::WebviewWindow,
    file_name: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
    default_extension: Option<String>,
    initial_directory: Option<String>,
) -> Result<Option<std::path::PathBuf>, String> {
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Save file")
        .set_file_name(file_name);

    if let Some(directory) = initial_directory
        .as_deref()
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(stable_file_dialog_directory)
    {
        dialog = dialog.set_directory(directory);
    }

    let extensions = extensions.unwrap_or_default();
    if !extensions.is_empty() {
        let extension_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        dialog = dialog.add_filter(filter_name.as_deref().unwrap_or("File"), &extension_refs);
    }

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    dialog.save_file(move |file_path| {
        let _ = tx.blocking_send(file_path);
    });

    let Some(file_path) = rx.recv().await.flatten() else {
        return Ok(None);
    };

    let mut path = file_path.into_path().map_err(|error| error.to_string())?;
    if path.extension().is_none() {
        let extension = default_extension.or_else(|| extensions.first().cloned());
        if let Some(extension) = extension {
            path.set_extension(extension.trim_start_matches('.'));
        }
    }
    Ok(Some(path))
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err("保存先フォルダが見つかりません。".to_string());
        }
    }
    std::fs::write(&path, contents).map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn write_binary_file(path: String, contents_base64: String) -> Result<(), String> {
    use base64::Engine as _;

    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err("保存先フォルダが見つかりません。".to_string());
        }
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64)
        .map_err(|error| error.to_string())?;
    std::fs::write(&path, bytes).map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn write_csp_import_package(
    window: tauri::WebviewWindow,
    asset_root_path: String,
    output_directory_name: String,
    files: Vec<CspImportPackageFile>,
) -> Result<Option<WriteCspImportPackageResult>, String> {
    let asset_root = canonicalize_existing_path(std::path::Path::new(&asset_root_path))?;
    if !asset_root.is_dir() {
        return Err("カットフォルダが見つかりません。".to_string());
    }
    let output_directory_name = safe_single_path_component(&output_directory_name)?;
    let Some(selected_directory) =
        pick_csp_import_package_directory(window, &asset_root, &output_directory_name).await?
    else {
        return Ok(None);
    };
    let selected_directory = canonicalize_existing_path(&selected_directory)?;
    let output_directory = resolve_csp_import_output_directory(
        &asset_root,
        &selected_directory,
        &output_directory_name,
    );
    std::fs::create_dir_all(&output_directory).map_err(|error| error.to_string())?;
    let output_directory = output_directory
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !output_directory.starts_with(&asset_root) {
        return Err("CSP自動登録の出力先がカットフォルダの外にあります。".to_string());
    }

    for file in files {
        let file_path = safe_join_relative_path(&output_directory, &file.relative_path)?;
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(&file_path, file.contents).map_err(|error| error.to_string())?;
    }

    Ok(Some(WriteCspImportPackageResult {
        output_directory_path: output_directory.to_string_lossy().into_owned(),
    }))
}

pub(super) async fn pick_csp_import_package_directory(
    window: tauri::WebviewWindow,
    asset_root: &std::path::Path,
    output_directory_name: &std::path::Path,
) -> Result<Option<std::path::PathBuf>, String> {
    let suggested_directory = asset_root.join(output_directory_name);
    let initial_directory = if suggested_directory.is_dir() {
        suggested_directory
    } else {
        asset_root.to_path_buf()
    };
    let dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("CSP自動登録の書き出し先フォルダを選択")
        .set_directory(initial_directory);

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    dialog.pick_folder(move |folder| {
        let _ = tx.blocking_send(folder);
    });

    let Some(folder_path) = rx.recv().await.flatten() else {
        return Ok(None);
    };
    folder_path
        .into_path()
        .map(Some)
        .map_err(|error| error.to_string())
}

pub(super) fn resolve_csp_import_output_directory(
    asset_root: &std::path::Path,
    selected_directory: &std::path::Path,
    output_directory_name: &std::path::Path,
) -> std::path::PathBuf {
    if selected_directory == asset_root {
        asset_root.join(output_directory_name)
    } else {
        selected_directory.to_path_buf()
    }
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn stat_native_paths(paths: Vec<String>) -> Vec<NativePathStatus> {
    paths
        .into_iter()
        .map(|path| {
            let metadata = std::fs::metadata(&path).ok();
            NativePathStatus {
                path,
                exists: metadata.is_some(),
                is_directory: metadata.as_ref().is_some_and(|item| item.is_dir()),
                is_file: metadata.as_ref().is_some_and(|item| item.is_file()),
            }
        })
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn confirm_user_action(
    window: tauri::WebviewWindow,
    title: String,
    message: String,
    ok_label: Option<String>,
    cancel_label: Option<String>,
) -> Result<bool, String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    window
        .dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            ok_label.unwrap_or_else(|| "OK".to_string()),
            cancel_label.unwrap_or_else(|| "キャンセル".to_string()),
        ))
        .show(move |confirmed| {
            let _ = tx.blocking_send(confirmed);
        });
    Ok(rx.recv().await.unwrap_or(false))
}
