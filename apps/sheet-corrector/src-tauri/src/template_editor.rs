use std::ffi::OsString;
use std::path::Path;
use std::process::Command;

fn template_editor_command(current_executable: &Path) -> Result<Command, String> {
    let directory = current_executable
        .parent()
        .ok_or("Correctorの配置先を確認できません。")?;
    let executable = directory.join("xsheet-remap.exe");
    if !executable.is_file() {
        return Err("xsheet-remap.exeをCorrectorと同じフォルダーに置いてください。配布ZIPを全体で展開すると利用できます。".into());
    }
    let mut command = Command::new(executable);
    command.arg("--template").current_dir(directory);
    Ok(command)
}

// A diagnostic parent may override WebView2's profile. The editor is another
// application: sharing that override can prevent its WebView from starting.
// Normal launches without an override retain the persistent template profile.
fn isolate_overridden_webview(
    command: &mut Command,
    profile: Option<OsString>,
    arguments: Option<OsString>,
) {
    if let Some(profile) = profile {
        command.env(
            "WEBVIEW2_USER_DATA_FOLDER",
            Path::new(&profile).join("template-editor"),
        );
        if let Some(arguments) = arguments.and_then(|value| value.into_string().ok()) {
            if let Some(port) = arguments
                .split_whitespace()
                .find(|arg| arg.starts_with("--remote-debugging-port="))
            {
                command.env(
                    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                    arguments.replace(port, "--remote-debugging-port=0"),
                );
            }
        }
    }
}

#[tauri::command]
pub(super) async fn open_template_editor() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut command = template_editor_command(&executable)?;
    isolate_overridden_webview(
        &mut command,
        std::env::var_os("WEBVIEW2_USER_DATA_FOLDER"),
        std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"),
    );
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_child_has_its_own_profile_and_debug_port_without_rewriting_other_arguments() {
        let mut command = Command::new("never-executed");
        isolate_overridden_webview(&mut command, None, None);
        assert_eq!(command.get_envs().count(), 0);
        isolate_overridden_webview(
            &mut command,
            Some("isolated-profile".into()),
            Some("--remote-debugging-port=9123 --enable-automation --example=\"two words\"".into()),
        );
        let env: std::collections::HashMap<_, _> = command.get_envs().collect();
        assert_eq!(
            env[std::ffi::OsStr::new("WEBVIEW2_USER_DATA_FOLDER")],
            Some(
                Path::new("isolated-profile")
                    .join("template-editor")
                    .as_os_str()
            )
        );
        assert_eq!(
            env[std::ffi::OsStr::new("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")],
            Some(std::ffi::OsStr::new(
                "--remote-debugging-port=0 --enable-automation --example=\"two words\""
            ))
        );
    }

    #[test]
    fn opens_only_the_adjacent_remap_with_the_template_switch() {
        let directory =
            std::env::temp_dir().join(format!("xsheet-template-launch-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let executable = directory.join("xsheet-remap.exe");
        std::fs::write(&executable, b"fixture, never executed").unwrap();
        let command = template_editor_command(&directory.join("xsheet-corrector.exe")).unwrap();
        assert_eq!(command.get_program(), executable.as_os_str());
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["--template"]);
        assert_eq!(command.get_current_dir(), Some(directory.as_path()));
        std::fs::remove_file(&executable).unwrap();
        assert!(
            template_editor_command(&directory.join("xsheet-corrector.exe"))
                .unwrap_err()
                .contains("同じフォルダー")
        );
        std::fs::remove_dir(&directory).unwrap();
    }
}
