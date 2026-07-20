use super::*;
use std::io::Write as _;

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn save_project_file(
    window: tauri::WebviewWindow,
    file_name: String,
    contents_base64: String,
    initial_directory: Option<String>,
) -> Result<Option<String>, String> {
    use base64::Engine as _;

    let Some(path) = pick_save_path(
        window,
        file_name,
        Some("xsheet-remap project".to_string()),
        Some(vec!["xsr".to_string()]),
        Some("xsr".to_string()),
        initial_directory,
    )
    .await?
    else {
        return Ok(None);
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64)
        .map_err(|error| error.to_string())?;
    atomic_write_project_file(&path, &bytes)?;
    Ok(Some(public_path_string(&path)))
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn write_project_file(path: String, contents_base64: String) -> Result<(), String> {
    use base64::Engine as _;

    let path = std::path::PathBuf::from(path);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64)
        .map_err(|error| error.to_string())?;
    atomic_write_project_file(&path, &bytes)
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn read_project_backup(path: String) -> Result<Option<String>, String> {
    use base64::Engine as _;

    let backup_path = project_backup_path(std::path::Path::new(&path))?;
    if !backup_path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(backup_path).map_err(|error| error.to_string())?;
    Ok(Some(
        base64::engine::general_purpose::STANDARD.encode(bytes),
    ))
}

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
    Ok(Some(public_path_string(&path)))
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
    Ok(Some(public_path_string(&path)))
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

fn atomic_write_project_file(path: &std::path::Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| "保存先フォルダが見つかりません。".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "保存先ファイル名が不正です。".to_string())?
        .to_string_lossy();
    let temp_path = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        next_atomic_write_id()
    ));

    let write_result = (|| -> Result<(), String> {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| error.to_string())?;
        file.write_all(contents)
            .map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        replace_project_file(path, &temp_path)
    })();

    if temp_path.exists() {
        let _ = std::fs::remove_file(&temp_path);
    }
    write_result
}

fn next_atomic_write_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

fn project_backup_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let file_name = path
        .file_name()
        .ok_or_else(|| "保存先ファイル名が不正です。".to_string())?;
    let mut backup_name = file_name.to_os_string();
    backup_name.push(".bak");
    Ok(path.with_file_name(backup_name))
}

#[cfg(windows)]
fn replace_project_file(path: &std::path::Path, temp_path: &std::path::Path) -> Result<(), String> {
    if !path.exists() {
        return std::fs::rename(temp_path, path).map_err(|error| error.to_string());
    }

    use std::os::windows::ffi::OsStrExt as _;
    let backup_path = project_backup_path(path)?;
    if backup_path.exists() {
        std::fs::remove_file(&backup_path).map_err(|error| error.to_string())?;
    }
    let path_wide = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let temp_wide = temp_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let backup_wide = backup_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            path_wide.as_ptr(),
            temp_wide.as_ptr(),
            backup_wide.as_ptr(),
            0x0000_0001,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        return Err(format!(
            "プロジェクトファイルを安全に置換できませんでした: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(windows)]
#[link(name = "Kernel32")]
extern "system" {
    fn ReplaceFileW(
        replaced_file_name: *const u16,
        replacement_file_name: *const u16,
        backup_file_name: *const u16,
        replace_flags: u32,
        exclude: *mut std::ffi::c_void,
        reserved: *mut std::ffi::c_void,
    ) -> i32;
}

#[cfg(not(windows))]
fn replace_project_file(path: &std::path::Path, temp_path: &std::path::Path) -> Result<(), String> {
    if path.exists() {
        std::fs::copy(path, project_backup_path(path)?).map_err(|error| error.to_string())?;
    }
    std::fs::rename(temp_path, path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod project_file_tests {
    use super::*;

    #[test]
    fn atomic_project_save_keeps_the_previous_complete_file_as_backup() {
        let root = std::env::temp_dir().join(format!(
            "xsheet-remap-project-save-test-{}-{}",
            std::process::id(),
            next_atomic_write_id()
        ));
        std::fs::create_dir_all(&root).expect("create test directory");
        let project = root.join("sample.xsr");

        atomic_write_project_file(&project, b"first-complete-project").expect("first save");
        assert_eq!(
            std::fs::read(&project).expect("read first save"),
            b"first-complete-project"
        );
        assert!(!project_backup_path(&project).expect("backup path").exists());

        atomic_write_project_file(&project, b"second-complete-project").expect("second save");
        assert_eq!(
            std::fs::read(&project).expect("read current save"),
            b"second-complete-project"
        );
        assert_eq!(
            std::fs::read(project_backup_path(&project).expect("backup path"))
                .expect("read backup"),
            b"first-complete-project"
        );

        std::fs::remove_dir_all(root).expect("remove test directory");
    }
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
        output_directory_path: public_path_string(&output_directory),
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
