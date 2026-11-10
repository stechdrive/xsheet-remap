use std::ffi::OsString;
#[cfg(windows)]
use std::path::PathBuf;

pub(super) struct LaunchPaths(pub Vec<String>);

pub(super) fn prepare_launch_paths() -> std::io::Result<LaunchPaths> {
    prepare_launch_paths_from(std::env::args_os().skip(1))
}

pub(super) fn prepare_launch_paths_from(
    arguments: impl IntoIterator<Item = OsString>,
) -> std::io::Result<LaunchPaths> {
    // Resolve relative launch arguments before releasing the inherited working
    // directory. Output defaults continue to use each source image's parent.
    let paths = arguments
        .into_iter()
        .filter_map(|argument| std::path::absolute(argument).ok())
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned())
        .collect();

    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(std::env::temp_dir);
        let working_directory = base
            .join("local.xsheet-remap.sheet-corrector")
            .join("working");
        std::fs::create_dir_all(&working_directory)?;
        // This runs before Tauri/WebView2 starts any threads or child processes.
        // Windows keeps the current directory open even after all file I/O ends.
        std::env::set_current_dir(working_directory)?;
    }

    Ok(LaunchPaths(paths))
}
