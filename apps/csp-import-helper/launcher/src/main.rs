#![cfg_attr(windows, windows_subsystem = "windows")]

use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{self, Command};

const HELPER_MODULE: &str = "csp_import_helper";
const RUNTIME_DIRECTORY: &str = "csp-import-helper";

fn main() {
    let arguments = env::args_os().skip(1).collect::<Vec<_>>();
    if let Err(message) = launch(&arguments) {
        show_error(&message);
        process::exit(1);
    }
}

fn launch(arguments: &[OsString]) -> Result<(), String> {
    let launcher = env::current_exe()
        .map_err(|error| format!("起動ファイルの場所を確認できません。\n\n{error}"))?;
    let launcher_directory = launcher
        .parent()
        .ok_or_else(|| "起動ファイルのフォルダーを確認できません。".to_owned())?;
    let runtime_root = launcher_directory.join(RUNTIME_DIRECTORY);
    let python_directory = runtime_root.join("python");
    let cli = is_cli_invocation(arguments);
    let python = python_directory.join(if cli { "python.exe" } else { "pythonw.exe" });

    if !python.is_file() {
        return Err(format!(
            "xsheet-importerの実行環境が見つかりません。\n\n{}\n\nEXEとcsp-import-helperフォルダーを同じ場所に置いてください。",
            python.display(),
        ));
    }
    if runtime_is_blocked(&runtime_root) {
        return Err(
            "ダウンロードしたZIPのブロックが実行環境に残っています。\n\nZIPのプロパティで「許可する」または「ブロックの解除」を有効にしてから、ZIP全体を展開し直してください。"
                .to_owned(),
        );
    }

    let mut command = helper_command(&python, launcher_directory, arguments);
    if cli {
        let status = command
            .status()
            .map_err(|error| format!("xsheet-importerを起動できません。\n\n{error}"))?;
        process::exit(status.code().unwrap_or(1));
    }

    command
        .spawn()
        .map_err(|error| format!("xsheet-importerを起動できません。\n\n{error}"))?;
    Ok(())
}

fn helper_command(python: &Path, working_directory: &Path, arguments: &[OsString]) -> Command {
    let mut command = Command::new(python);
    command
        .current_dir(working_directory)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONUTF8", "1")
        .arg("-m")
        .arg(HELPER_MODULE)
        .args(arguments);
    command
}

fn is_cli_invocation(arguments: &[OsString]) -> bool {
    if arguments.is_empty() {
        return false;
    }
    if arguments.iter().any(|argument| {
        let value = argument.to_string_lossy();
        value.eq_ignore_ascii_case("--gui") || value.eq_ignore_ascii_case("--gui-auto-start")
    }) {
        return false;
    }
    arguments
        .iter()
        .any(|argument| argument.to_string_lossy().starts_with('-'))
}

fn runtime_is_blocked(runtime_root: &Path) -> bool {
    let probe = runtime_root.join("site-packages/pythonnet/runtime/Python.Runtime.dll");
    alternate_data_stream_exists(&probe, "Zone.Identifier")
}

#[cfg(windows)]
fn alternate_data_stream_exists(path: &Path, stream: &str) -> bool {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    let mut stream_path = path.as_os_str().encode_wide().collect::<Vec<_>>();
    stream_path.extend(OsString::from(format!(":{stream}")).encode_wide());
    PathBuf::from(OsString::from_wide(&stream_path)).is_file()
}

#[cfg(not(windows))]
fn alternate_data_stream_exists(_path: &Path, _stream: &str) -> bool {
    false
}

#[cfg(windows)]
fn show_error(message: &str) {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            window: *mut c_void,
            text: *const u16,
            caption: *const u16,
            kind: u32,
        ) -> i32;
    }

    let text = OsString::from(message)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let caption = OsString::from("xsheet-importer")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            0x0000_0010,
        );
    }
}

#[cfg(not(windows))]
fn show_error(message: &str) {
    eprintln!("{message}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn double_click_and_file_drop_use_the_gui_runtime() {
        assert!(!is_cli_invocation(&[]));
        assert!(!is_cli_invocation(&args(&[r"D:\cuts\C001\csp-import.xci"])));
        assert!(!is_cli_invocation(&args(&[r"D:\cuts\C001.clip"])));
    }

    #[test]
    fn explicit_gui_mode_stays_windowed() {
        assert!(!is_cli_invocation(&args(&["--gui"])));
        assert!(!is_cli_invocation(&args(&[
            "--gui-auto-start",
            "--manifest",
            r"D:\cuts\C001\csp-import.xci",
        ])));
    }

    #[test]
    fn diagnostic_flags_use_the_console_runtime() {
        assert!(is_cli_invocation(&args(&["--version"])));
        assert!(is_cli_invocation(&args(&["--help"])));
        assert!(is_cli_invocation(&args(&[
            "--manifest",
            r"D:\cuts\C001\csp-import.xci",
        ])));
    }
}
