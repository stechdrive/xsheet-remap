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

#[tauri::command]
pub(super) async fn open_template_editor() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    template_editor_command(&executable)?
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
