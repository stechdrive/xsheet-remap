use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const ASSET_PREVIEW_WINDOW_LABEL: &str = "asset-preview";
const ASSET_PREVIEW_UPDATE_EVENT: &str = "asset-preview:update";
const ASSET_PREVIEW_REFRESH_SCRIPT: &str =
    "window.dispatchEvent(new Event('asset-preview:refresh'))";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileRef {
    name: String,
    size: Option<u64>,
    last_modified: Option<u64>,
    path: String,
    root_path: Option<String>,
    relative_path: Option<String>,
    content_hash: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetRootCandidate {
    label: String,
    path: String,
    from_directory_drop: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetPathCollection {
    roots: Vec<AssetRootCandidate>,
    files: Vec<OpenFileRef>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetDirectoryEntry {
    name: String,
    path: String,
    relative_path: String,
    kind: String,
    is_supported_image: bool,
    size: Option<u64>,
    last_modified: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetDirectoryListing {
    root_path: String,
    current_path: String,
    parent_path: Option<String>,
    entries: Vec<AssetDirectoryEntry>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetPreviewPayload {
    display_name: String,
    image_url: Option<String>,
    detail_text: Option<String>,
    items: Option<Vec<AssetPreviewItemPayload>>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetPreviewItemPayload {
    label: String,
    image_url: Option<String>,
    detail_text: Option<String>,
    process_label: Option<String>,
}

struct AssetPreviewState(Mutex<Option<AssetPreviewPayload>>);

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameFileOperation {
    asset_id: String,
    current_path: String,
    next_path: String,
    next_file_name: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameFileResult {
    asset_id: String,
    renamed: bool,
    next_path: Option<String>,
    next_file_name: Option<String>,
    error: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CspImportPackageFile {
    relative_path: String,
    contents: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteCspImportPackageResult {
    output_directory_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePathStatus {
    path: String,
    exists: bool,
    is_directory: bool,
    is_file: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2eConfig {
    scenario: String,
    root: String,
    assets: String,
    exports: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AssetPreviewState(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .on_window_event(|window, event| {
            if window.label() == ASSET_PREVIEW_WINDOW_LABEL {
                return;
            }
            if !matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                return;
            }
            if let Some(preview_window) = window
                .app_handle()
                .get_webview_window(ASSET_PREVIEW_WINDOW_LABEL)
            {
                let _ = preview_window.close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_image_files,
            image_file_refs_from_paths,
            open_asset_root_directory,
            collect_asset_paths,
            list_asset_directory,
            open_asset_preview_window,
            update_asset_preview_window_if_open,
            current_asset_preview_payload,
            save_text_file,
            save_binary_file,
            write_text_file,
            write_binary_file,
            write_csp_import_package,
            stat_native_paths,
            confirm_user_action,
            rename_material_files,
            desktop_e2e_config,
            list_desktop_e2e_asset_files,
            write_desktop_e2e_artifact
        ])
        .run(tauri::generate_context!())
        .expect("error while running xsheet-remap")
}

#[tauri::command(rename_all = "camelCase")]
async fn open_image_files(
    window: tauri::WebviewWindow,
    initial_directory: Option<String>,
) -> Result<Vec<OpenFileRef>, String> {
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("画像素材追加")
        .add_filter(
            "Image",
            &[
                "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "tga",
            ],
        );

    if let Some(directory) = initial_directory
        .as_deref()
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(stable_file_dialog_directory)
    {
        dialog = dialog.set_directory(directory);
    }

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    dialog.pick_files(move |files| {
        let _ = tx.blocking_send(files);
    });
    let files = rx.recv().await.flatten().unwrap_or_default();

    files
        .into_iter()
        .map(|file_path| {
            let path = file_path.into_path().map_err(|error| error.to_string())?;
            open_file_ref_from_path(&path)
        })
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
fn image_file_refs_from_paths(paths: Vec<String>) -> Result<Vec<OpenFileRef>, String> {
    let mut refs = Vec::new();
    for path in paths {
        let path = std::path::PathBuf::from(path);
        if path.is_file() {
            if is_supported_image_file(&path) {
                refs.push(open_file_ref_from_path(&path)?);
            }
            continue;
        }
        if path.is_dir() {
            let mut child_paths = std::fs::read_dir(&path)
                .map_err(|error| error.to_string())?
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .filter(|child| child.is_file() && is_supported_image_file(child))
                .collect::<Vec<_>>();
            child_paths.sort_by(|a, b| {
                a.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default()
                    .cmp(
                        &b.file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                    )
            });
            for child in child_paths {
                refs.push(open_file_ref_from_path(&child)?);
            }
        }
    }
    Ok(refs)
}

#[tauri::command(rename_all = "camelCase")]
async fn open_asset_root_directory(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("カットフォルダを選択");

    if let Some(directory) = stable_file_dialog_directory() {
        dialog = dialog.set_directory(directory);
    }

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    dialog.pick_folder(move |folder| {
        let _ = tx.blocking_send(folder);
    });

    let Some(folder_path) = rx.recv().await.flatten() else {
        return Ok(None);
    };
    let path = folder_path.into_path().map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command(rename_all = "camelCase")]
fn collect_asset_paths(
    paths: Vec<String>,
    recursive: bool,
    root_path: Option<String>,
) -> Result<AssetPathCollection, String> {
    let mut roots = Vec::new();
    let mut files = Vec::new();
    let mut loose_files = Vec::new();
    let preferred_root = root_path
        .as_deref()
        .map(std::path::Path::new)
        .map(canonicalize_existing_path)
        .transpose()?;

    for raw_path in paths {
        let path = std::path::PathBuf::from(raw_path);
        if path.is_dir() {
            let root_path = canonicalize_existing_path(&path)?;
            let asset_root = preferred_root
                .as_ref()
                .filter(|root| root_path.starts_with(root))
                .unwrap_or(&root_path);
            roots.push(asset_root_candidate(asset_root, preferred_root.is_none()));
            let child_paths = if recursive {
                list_files_recursive(&root_path)?
            } else {
                list_files_shallow(&root_path)?
            };
            for child in child_paths {
                if is_supported_image_file(&child) {
                    files.push(open_file_ref_from_path_with_root(&child, Some(asset_root))?);
                }
            }
            continue;
        }
        if path.is_file() {
            if is_supported_image_file(&path) {
                loose_files.push(canonicalize_existing_path(&path)?);
            }
        }
    }

    if !loose_files.is_empty() {
        if let Some(root) = preferred_root
            .as_ref()
            .filter(|root| loose_files.iter().all(|file| file.starts_with(root)))
        {
            roots.push(asset_root_candidate(root, false));
            for file in loose_files {
                files.push(open_file_ref_from_path_with_root(&file, Some(root))?);
            }
        } else if let Some(parent) = common_parent_directory(&loose_files) {
            roots.push(asset_root_candidate(&parent, false));
            for file in loose_files {
                files.push(open_file_ref_from_path_with_root(&file, Some(&parent))?);
            }
        } else {
            for file in loose_files {
                files.push(open_file_ref_from_path_with_root(&file, None)?);
            }
        }
    }

    roots.sort_by(|a, b| naturalish_cmp(&a.label, &b.label).then_with(|| a.path.cmp(&b.path)));
    roots.dedup_by(|a, b| path_key(&a.path) == path_key(&b.path));
    files.sort_by(|a, b| {
        naturalish_cmp(
            &a.relative_path.clone().unwrap_or_else(|| a.name.clone()),
            &b.relative_path.clone().unwrap_or_else(|| b.name.clone()),
        )
    });
    Ok(AssetPathCollection { roots, files })
}

#[tauri::command(rename_all = "camelCase")]
fn list_asset_directory(
    root_path: String,
    current_path: String,
) -> Result<AssetDirectoryListing, String> {
    let root = canonicalize_existing_path(std::path::Path::new(&root_path))?;
    let current = canonicalize_existing_path(std::path::Path::new(&current_path))?;
    if !current.starts_with(&root) {
        return Err("現在フォルダがカットフォルダの外にあります。".to_string());
    }
    if !current.is_dir() {
        return Err("現在フォルダが見つかりません。".to_string());
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative_path = relative_path_string(&path, &root).unwrap_or_else(|| name.clone());
        let is_dir = metadata.is_dir();
        let is_file = metadata.is_file();
        entries.push(AssetDirectoryEntry {
            name,
            path: path.to_string_lossy().into_owned(),
            relative_path,
            kind: if is_dir { "directory" } else { "file" }.to_string(),
            is_supported_image: is_file && is_supported_image_file(&path),
            size: if is_file { Some(metadata.len()) } else { None },
            last_modified: modified_at_millis(&metadata),
        });
    }
    entries.sort_by(|a, b| {
        let kind_order_a = if a.kind == "directory" { 0 } else { 1 };
        let kind_order_b = if b.kind == "directory" { 0 } else { 1 };
        kind_order_a
            .cmp(&kind_order_b)
            .then_with(|| naturalish_cmp(&a.name, &b.name))
            .then_with(|| a.path.cmp(&b.path))
    });

    let parent_path = current
        .parent()
        .filter(|parent| current != root && parent.starts_with(&root))
        .map(|parent| parent.to_string_lossy().into_owned());

    Ok(AssetDirectoryListing {
        root_path: root.to_string_lossy().into_owned(),
        current_path: current.to_string_lossy().into_owned(),
        parent_path,
        entries,
    })
}

fn is_supported_image_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "tga"
            )
        })
        .unwrap_or(false)
}

fn stable_file_dialog_directory() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(|| std::env::current_dir().ok().filter(|path| path.is_dir()))
}

#[tauri::command(rename_all = "camelCase")]
async fn open_asset_preview_window(
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
async fn update_asset_preview_window_if_open(
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
fn current_asset_preview_payload(
    state: tauri::State<'_, AssetPreviewState>,
) -> Result<Option<AssetPreviewPayload>, String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())
        .map(|latest_payload| latest_payload.clone())
}

#[tauri::command(rename_all = "camelCase")]
async fn save_text_file(
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
async fn save_binary_file(
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

async fn pick_save_path(
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
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err("保存先フォルダが見つかりません。".to_string());
        }
    }
    std::fs::write(&path, contents).map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn write_binary_file(path: String, contents_base64: String) -> Result<(), String> {
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
async fn write_csp_import_package(
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

async fn pick_csp_import_package_directory(
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

fn resolve_csp_import_output_directory(
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
fn stat_native_paths(paths: Vec<String>) -> Vec<NativePathStatus> {
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
async fn confirm_user_action(
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

fn open_file_ref_from_path(path: &std::path::Path) -> Result<OpenFileRef, String> {
    open_file_ref_from_path_with_root(path, None)
}

fn open_file_ref_from_path_with_root(
    path: &std::path::Path,
    root: Option<&std::path::Path>,
) -> Result<OpenFileRef, String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| "ファイル名を取得できません。".to_string())?;
    let canonical_path = canonicalize_existing_path(path)?;
    let canonical_root = root.and_then(|root_path| canonicalize_existing_path(root_path).ok());

    Ok(OpenFileRef {
        name,
        size: Some(metadata.len()),
        last_modified: modified_at_millis(&metadata),
        path: canonical_path.to_string_lossy().into_owned(),
        root_path: canonical_root
            .as_ref()
            .map(|root_path| root_path.to_string_lossy().into_owned()),
        relative_path: canonical_root
            .as_ref()
            .and_then(|root_path| relative_path_string(&canonical_path, root_path)),
        content_hash: sha256_file(&canonical_path).ok(),
    })
}

fn canonicalize_existing_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    path.canonicalize().map_err(|error| error.to_string())
}

fn modified_at_millis(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn list_files_shallow(root: &std::path::Path) -> Result<Vec<std::path::PathBuf>, String> {
    Ok(std::fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file())
        .collect())
}

fn common_parent_directory(paths: &[std::path::PathBuf]) -> Option<std::path::PathBuf> {
    let first_parent = paths.first()?.parent()?.to_path_buf();
    if paths.iter().all(|path| {
        path.parent()
            .map(|parent| {
                path_key(parent.to_string_lossy().as_ref())
                    == path_key(first_parent.to_string_lossy().as_ref())
            })
            .unwrap_or(false)
    }) {
        Some(first_parent)
    } else {
        None
    }
}

fn asset_root_candidate(path: &std::path::Path, from_directory_drop: bool) -> AssetRootCandidate {
    AssetRootCandidate {
        label: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        path: path.to_string_lossy().into_owned(),
        from_directory_drop,
    }
}

fn relative_path_string(path: &std::path::Path, root: &std::path::Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .filter(|relative| !relative.is_empty())
}

fn safe_single_path_component(value: &str) -> Result<std::path::PathBuf, String> {
    if value.trim().is_empty() {
        return Err("フォルダ名が空です。".to_string());
    }
    let path = std::path::Path::new(value);
    let mut components = path.components();
    let Some(std::path::Component::Normal(component)) = components.next() else {
        return Err("フォルダ名には相対名だけを指定できます。".to_string());
    };
    if components.next().is_some() {
        return Err("フォルダ名には区切り文字を含められません。".to_string());
    }
    Ok(std::path::PathBuf::from(component))
}

fn safe_join_relative_path(
    base: &std::path::Path,
    relative_path: &str,
) -> Result<std::path::PathBuf, String> {
    if relative_path.trim().is_empty() {
        return Err("出力ファイル名が空です。".to_string());
    }
    let relative = std::path::Path::new(relative_path);
    let mut path = base.to_path_buf();
    for component in relative.components() {
        match component {
            std::path::Component::Normal(part) => path.push(part),
            std::path::Component::CurDir => {}
            _ => return Err("出力ファイルパスには安全な相対パスだけを指定できます。".to_string()),
        }
    }
    if !path.starts_with(base) {
        return Err("出力ファイルパスが出力フォルダの外にあります。".to_string());
    }
    Ok(path)
}

fn path_key(path: &str) -> String {
    path.replace('\\', "/").to_ascii_lowercase()
}

fn naturalish_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut a_chars = a.chars().peekable();
    let mut b_chars = b.chars().peekable();
    loop {
        match (a_chars.peek(), b_chars.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(a_char), Some(b_char)) if a_char.is_ascii_digit() && b_char.is_ascii_digit() => {
                let a_number = take_ascii_digit_run(&mut a_chars);
                let b_number = take_ascii_digit_run(&mut b_chars);
                let a_trimmed = a_number.trim_start_matches('0');
                let b_trimmed = b_number.trim_start_matches('0');
                let by_number = a_trimmed
                    .len()
                    .cmp(&b_trimmed.len())
                    .then_with(|| a_trimmed.cmp(b_trimmed))
                    .then_with(|| a_number.len().cmp(&b_number.len()));
                if by_number != std::cmp::Ordering::Equal {
                    return by_number;
                }
            }
            (Some(_), Some(_)) => {
                let a_char = a_chars.next().unwrap().to_ascii_lowercase();
                let b_char = b_chars.next().unwrap().to_ascii_lowercase();
                let by_char = a_char.cmp(&b_char);
                if by_char != std::cmp::Ordering::Equal {
                    return by_char;
                }
            }
        }
    }
}

fn take_ascii_digit_run(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut value = String::new();
    while chars
        .peek()
        .is_some_and(|character| character.is_ascii_digit())
    {
        value.push(chars.next().unwrap());
    }
    value
}

fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

#[tauri::command(rename_all = "camelCase")]
async fn rename_material_files(
    operations: Vec<RenameFileOperation>,
) -> Result<Vec<RenameFileResult>, String> {
    let mut results = Vec::with_capacity(operations.len());
    for operation in operations {
        let current_path = std::path::PathBuf::from(&operation.current_path);
        let next_path = std::path::PathBuf::from(&operation.next_path);
        let result = assert_e2e_material_rename_is_safe(&current_path, &next_path)
            .and_then(|()| rename_material_file(&current_path, &next_path))
            .map(|()| RenameFileResult {
                asset_id: operation.asset_id.clone(),
                renamed: true,
                next_path: Some(next_path.to_string_lossy().into_owned()),
                next_file_name: Some(operation.next_file_name.clone()),
                error: None,
            })
            .unwrap_or_else(|error| RenameFileResult {
                asset_id: operation.asset_id,
                renamed: false,
                next_path: None,
                next_file_name: None,
                error: Some(error),
            });
        results.push(result);
    }
    Ok(results)
}

fn rename_material_file(
    current_path: &std::path::Path,
    next_path: &std::path::Path,
) -> Result<(), String> {
    if current_path == next_path {
        return Ok(());
    }
    if !current_path.exists() {
        return Err("元ファイルが見つかりません。".to_string());
    }
    if next_path.exists() {
        return Err("変更後ファイル名が既に存在します。".to_string());
    }
    std::fs::rename(current_path, next_path).map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn desktop_e2e_config() -> Result<Option<DesktopE2eConfig>, String> {
    read_desktop_e2e_config()
}

#[tauri::command(rename_all = "camelCase")]
fn list_desktop_e2e_asset_files() -> Result<Vec<OpenFileRef>, String> {
    let Some(config) = read_desktop_e2e_config()? else {
        return Ok(Vec::new());
    };
    let asset_root = std::path::PathBuf::from(config.assets);
    let mut refs = Vec::new();
    for path in list_files_recursive(&asset_root)? {
        if is_e2e_generated_artifact(&path) {
            continue;
        }
        refs.push(open_file_ref_from_path_with_root(&path, Some(&asset_root))?);
    }
    refs.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));
    Ok(refs)
}

#[tauri::command(rename_all = "camelCase")]
fn write_desktop_e2e_artifact(relative_path: String, contents: String) -> Result<String, String> {
    let Some(config) = read_desktop_e2e_config()? else {
        return Err("desktop e2e mode is not enabled".to_string());
    };
    let root = std::path::PathBuf::from(config.root);
    let path = safe_join_e2e_artifact_path(&root, &relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn read_desktop_e2e_config() -> Result<Option<DesktopE2eConfig>, String> {
    if std::env::var("XSHEET_REMAP_E2E").ok().as_deref() != Some("1") {
        return Ok(None);
    }
    let scenario =
        std::env::var("XSHEET_REMAP_E2E_SCENARIO").unwrap_or_else(|_| "launch".to_string());
    let root = required_env_path("XSHEET_REMAP_E2E_ROOT")?;
    let assets = required_env_path("XSHEET_REMAP_E2E_ASSETS")?;
    let exports = required_env_path("XSHEET_REMAP_E2E_EXPORTS")?;
    Ok(Some(DesktopE2eConfig {
        scenario,
        root,
        assets,
        exports,
    }))
}

fn required_env_path(name: &str) -> Result<String, String> {
    std::env::var(name)
        .map_err(|_| format!("{name} is required in desktop e2e mode"))
        .and_then(|value| {
            let path = std::path::PathBuf::from(&value);
            std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
            path.canonicalize()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|error| error.to_string())
        })
}

fn safe_join_e2e_artifact_path(
    root: &std::path::Path,
    relative_path: &str,
) -> Result<std::path::PathBuf, String> {
    let relative = std::path::Path::new(relative_path);
    if relative.is_absolute() {
        return Err("desktop e2e artifact path must be relative".to_string());
    }
    if relative.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err("desktop e2e artifact path must stay inside the run root".to_string());
    }
    Ok(root.join(relative))
}

fn list_files_recursive(root: &std::path::Path) -> Result<Vec<std::path::PathBuf>, String> {
    let mut files = Vec::new();
    if !root.exists() {
        return Ok(files);
    }
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_dir() {
                pending.push(path);
            } else if file_type.is_file() {
                files.push(path);
            }
        }
    }
    Ok(files)
}

fn is_e2e_generated_artifact(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".error.txt"))
        .unwrap_or(false)
}

fn assert_e2e_material_rename_is_safe(
    current_path: &std::path::Path,
    next_path: &std::path::Path,
) -> Result<(), String> {
    let Some(config) = read_desktop_e2e_config()? else {
        return Ok(());
    };
    let asset_root = std::path::PathBuf::from(config.assets)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let current = current_path
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let next_parent = next_path
        .parent()
        .ok_or_else(|| "変更後ファイル名の親フォルダーが取得できません。".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !current.starts_with(&asset_root) || !next_parent.starts_with(&asset_root) {
        return Err("E2E中の素材リネームは隔離assetsフォルダー配下だけ許可されます。".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csp_import_output_uses_default_child_when_asset_root_is_selected() {
        let asset_root = std::path::Path::new(r"D:\cuts\C001");
        let output_name = std::path::Path::new("xsheet-csp-import");

        let output = resolve_csp_import_output_directory(asset_root, asset_root, output_name);

        assert_eq!(output, asset_root.join(output_name));
    }

    #[test]
    fn csp_import_output_uses_selected_child_directory_directly() {
        let asset_root = std::path::Path::new(r"D:\cuts\C001");
        let selected = asset_root.join("custom-csp-import");
        let output_name = std::path::Path::new("xsheet-csp-import");

        let output = resolve_csp_import_output_directory(asset_root, &selected, output_name);

        assert_eq!(output, selected);
    }
}
