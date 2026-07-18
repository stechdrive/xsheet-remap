use std::sync::Mutex;
mod e2e;
mod file_utils;
mod persistence;
mod preview;

use file_utils::*;
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

pub fn run(context: tauri::Context<tauri::Wry>) {
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
            preview::open_asset_preview_window,
            preview::update_asset_preview_window_if_open,
            preview::current_asset_preview_payload,
            persistence::save_project_file,
            persistence::write_project_file,
            persistence::read_project_backup,
            persistence::save_text_file,
            persistence::save_binary_file,
            persistence::write_text_file,
            persistence::write_binary_file,
            persistence::write_csp_import_package,
            persistence::stat_native_paths,
            persistence::confirm_user_action,
            e2e::rename_material_files,
            e2e::desktop_e2e_config,
            e2e::list_desktop_e2e_asset_files,
            e2e::write_desktop_e2e_artifact
        ])
        .run(context)
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
