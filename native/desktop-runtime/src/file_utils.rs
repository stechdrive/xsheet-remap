use super::*;
pub(super) fn open_file_ref_from_path(path: &std::path::Path) -> Result<OpenFileRef, String> {
    open_file_ref_from_path_with_root(path, None)
}

pub(super) fn open_file_ref_from_path_with_root(
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
        path: public_path_string(&canonical_path),
        root_path: canonical_root
            .as_ref()
            .map(|root_path| public_path_string(root_path)),
        relative_path: canonical_root
            .as_ref()
            .and_then(|root_path| relative_path_string(&canonical_path, root_path)),
        content_hash: sha256_file(&canonical_path).ok(),
    })
}

pub(super) fn canonicalize_existing_path(
    path: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    path.canonicalize().map_err(|error| error.to_string())
}

/// Keep canonical paths internally, but never expose the Windows device
/// namespace prefix to the UI or persist it in project data.
pub(super) fn public_path_string(path: &std::path::Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest);
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    value.into_owned()
}

pub(super) fn modified_at_millis(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

pub(super) fn list_files_shallow(
    root: &std::path::Path,
) -> Result<Vec<std::path::PathBuf>, String> {
    Ok(std::fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file())
        .collect())
}

pub(super) fn common_parent_directory(paths: &[std::path::PathBuf]) -> Option<std::path::PathBuf> {
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

pub(super) fn asset_root_candidate(
    path: &std::path::Path,
    from_directory_drop: bool,
) -> AssetRootCandidate {
    AssetRootCandidate {
        label: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| public_path_string(path)),
        path: public_path_string(path),
        from_directory_drop,
    }
}

#[cfg(test)]
mod tests {
    use super::public_path_string;
    use std::path::Path;

    #[test]
    fn public_paths_remove_windows_device_prefixes() {
        assert_eq!(
            public_path_string(Path::new(r"\\?\C:\cuts\C001")),
            r"C:\cuts\C001"
        );
        assert_eq!(
            public_path_string(Path::new(r"\\?\UNC\server\share\C001")),
            r"\\server\share\C001"
        );
    }

    #[test]
    fn public_paths_leave_ordinary_paths_unchanged() {
        assert_eq!(
            public_path_string(Path::new(r"C:\cuts\C001")),
            r"C:\cuts\C001"
        );
        assert_eq!(
            public_path_string(Path::new("/projects/C001")),
            "/projects/C001"
        );
    }
}

pub(super) fn relative_path_string(
    path: &std::path::Path,
    root: &std::path::Path,
) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .filter(|relative| !relative.is_empty())
}

pub(super) fn safe_single_path_component(value: &str) -> Result<std::path::PathBuf, String> {
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

pub(super) fn safe_join_relative_path(
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

pub(super) fn path_key(path: &str) -> String {
    path.replace('\\', "/").to_ascii_lowercase()
}

pub(super) fn naturalish_cmp(a: &str, b: &str) -> std::cmp::Ordering {
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

pub(super) fn take_ascii_digit_run(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut value = String::new();
    while chars
        .peek()
        .is_some_and(|character| character.is_ascii_digit())
    {
        value.push(chars.next().unwrap());
    }
    value
}

pub(super) fn sha256_file(path: &std::path::Path) -> Result<String, String> {
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

pub(super) fn list_files_recursive(
    root: &std::path::Path,
) -> Result<Vec<std::path::PathBuf>, String> {
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
