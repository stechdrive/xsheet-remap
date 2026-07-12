use super::*;
use crate::file_utils::*;
#[cfg(test)]
use crate::persistence::*;
#[tauri::command(rename_all = "camelCase")]
pub(super) async fn rename_material_files(
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

pub(super) fn rename_material_file(
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
pub(super) fn desktop_e2e_config() -> Result<Option<DesktopE2eConfig>, String> {
    read_desktop_e2e_config()
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn list_desktop_e2e_asset_files() -> Result<Vec<OpenFileRef>, String> {
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
pub(super) fn write_desktop_e2e_artifact(
    relative_path: String,
    contents: String,
) -> Result<String, String> {
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

pub(super) fn read_desktop_e2e_config() -> Result<Option<DesktopE2eConfig>, String> {
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

pub(super) fn required_env_path(name: &str) -> Result<String, String> {
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

pub(super) fn safe_join_e2e_artifact_path(
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

pub(super) fn is_e2e_generated_artifact(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".error.txt"))
        .unwrap_or(false)
}

pub(super) fn assert_e2e_material_rename_is_safe(
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
