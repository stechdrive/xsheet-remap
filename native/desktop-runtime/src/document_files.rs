use super::*;
use std::io::Read as _;

fn document_limit(kind: &str) -> Result<u64, String> {
    match kind {
        "xsr" => Ok(1024 * 1024 * 1024),
        "clip" => Ok(512 * 1024 * 1024),
        _ => Err("対応していない文書形式です。".to_string()),
    }
}

fn read_document_bytes(path: &std::path::Path, kind: &str) -> Result<Vec<u8>, String> {
    let limit = document_limit(kind)?;
    if !path.is_absolute() || !path.extension().and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case(kind)) {
        return Err("文書の絶対パスと拡張子を確認してください。".to_string());
    }
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("文書ファイルが大きすぎるか、通常のファイルではありません。".to_string());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit { return Err("文書ファイルが大きすぎます。".to_string()); }
    Ok(bytes)
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn read_document_file(path: String, kind: String) -> Result<tauri::ipc::Response, String> {
    read_document_bytes(std::path::Path::new(&path), &kind).map(tauri::ipc::Response::new)
}

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn open_document_file(
    window: tauri::WebviewWindow, kind: String, initial_directory: Option<String>,
) -> Result<Option<String>, String> {
    document_limit(&kind)?;
    let mut dialog = window.dialog().file().set_parent(&window)
        .set_title(if kind == "xsr" { "プロジェクトを開く" } else { "CLIPを読み込む" })
        .add_filter(if kind == "xsr" { "XSR project" } else { "CLIP STUDIO FORMAT" }, &[kind.as_str()]);
    if let Some(directory) = initial_directory.as_deref().map(std::path::PathBuf::from)
        .filter(|path| path.is_dir()).or_else(stable_file_dialog_directory) {
        dialog = dialog.set_directory(directory);
    }
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    dialog.pick_file(move |path| { let _ = tx.blocking_send(path); });
    rx.recv().await.flatten().map(|path| {
        let path = path.into_path().map_err(|error| error.to_string())?;
        canonicalize_existing_path(&path).map(|path| public_path_string(&path))
    }).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_documents_preserve_bytes_and_reject_wrong_kind_or_missing_files() {
        let directory = std::env::temp_dir().join(format!("xsheet-document-{}-{}", std::process::id(), persistence::next_atomic_write_id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("日本語 project.XSR");
        std::fs::write(&path, [0, 127, 255]).unwrap();
        assert_eq!(read_document_bytes(&path, "xsr").unwrap(), vec![0, 127, 255]);
        assert!(read_document_bytes(&path, "clip").is_err());
        assert!(read_document_bytes(&directory.join("missing.xsr"), "xsr").is_err());
        assert!(read_document_bytes(std::path::Path::new("relative.xsr"), "xsr").is_err());
        assert!(document_limit("exe").is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
