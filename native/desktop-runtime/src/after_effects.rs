use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const JSX_TEMPLATE: &str = include_str!("../../../packages/core/src/after-effects-template.jsx");
const CONFIG_PLACEHOLDER: &str = "__XSHEET_AE_CONFIG__";
const CONFIG_SCHEMA: &str = "xsheet-remap-after-effects-remap-v1";
const TEMP_FILE_PREFIX: &str = "xsheet-remap-ae-remap-";
const MAX_CONFIG_BYTES: usize = 8 * 1024 * 1024;
const MAX_COLUMNS: usize = 256;
const MAX_TOTAL_KEYS: usize = 250_000;
const MAX_DURATION_FRAMES: u32 = 1_000_000;
const STALE_TEMP_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const TEMP_FILE_LIFETIME: Duration = Duration::from_secs(15);
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
struct AfterEffectsProcess {
    pid: u32,
    executable_path: Option<PathBuf>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AeRemapJsxConfig {
    schema: String,
    plan: AeRemapPlan,
    options: AeRemapOptions,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AeRemapPlan {
    comp_fps: f64,
    source_fps: f64,
    duration_frames: u32,
    columns: Vec<AeRemapColumn>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AeRemapColumn {
    id: String,
    name: String,
    keys: Vec<AeRemapKey>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AeRemapKey {
    frame: u32,
    empty: bool,
    cell_number: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AeRemapOptions {
    dialog_title: String,
    undo_group_name: String,
    managed_blank_effect_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfterEffectsSendResult {
    accepted: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub fn send_after_effects_remap(
    app: tauri::AppHandle,
    config: Value,
) -> Result<AfterEffectsSendResult, String> {
    let config = validate_config(config)?;
    let script = render_script(&config)?;

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, script);
        Err("After Effectsへの直接送信はWindows版でのみ利用できます。".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("一時ファイルの保存先を取得できませんでした: {error}"))?
            .join("after-effects");
        send_after_effects_remap_windows(&script, &cache_dir)
    }
}

fn validate_config(value: Value) -> Result<AeRemapJsxConfig, String> {
    let encoded = serde_json::to_vec(&value)
        .map_err(|error| format!("After Effects用データを確認できませんでした: {error}"))?;
    if encoded.len() > MAX_CONFIG_BYTES {
        return Err("After Effects用データが大きすぎます。".to_string());
    }
    let config: AeRemapJsxConfig = serde_json::from_value(value)
        .map_err(|error| format!("After Effects用データの形式が不正です: {error}"))?;
    if config.schema != CONFIG_SCHEMA {
        return Err("対応していないAfter Effects用データです。".to_string());
    }
    if !config.plan.comp_fps.is_finite()
        || config.plan.comp_fps <= 0.0
        || config.plan.comp_fps > 1_000.0
    {
        return Err("After Effects用データのフレームレートが不正です。".to_string());
    }
    if !config.plan.source_fps.is_finite()
        || config.plan.source_fps <= 0.0
        || config.plan.source_fps > 1_000.0
    {
        return Err("After Effects用データの素材フレームレートが不正です。".to_string());
    }
    if config.plan.duration_frames == 0 || config.plan.duration_frames > MAX_DURATION_FRAMES {
        return Err("After Effects用データの尺が範囲外です。".to_string());
    }
    if config.plan.columns.is_empty() || config.plan.columns.len() > MAX_COLUMNS {
        return Err("After Effects用データの列数が範囲外です。".to_string());
    }

    let mut ids = HashSet::new();
    let mut total_keys = 0usize;
    for column in &config.plan.columns {
        validate_text(&column.id, 256, "列ID")?;
        validate_text(&column.name, 256, "列名")?;
        if !ids.insert(column.id.as_str()) {
            return Err(format!(
                "After Effects用データに重複した列IDがあります: {}",
                column.id
            ));
        }
        if column.keys.is_empty() {
            return Err(format!("{}列にリマップキーがありません。", column.name));
        }
        total_keys = total_keys
            .checked_add(column.keys.len())
            .ok_or_else(|| "After Effects用データのキー数が大きすぎます。".to_string())?;
        if total_keys > MAX_TOTAL_KEYS {
            return Err("After Effects用データのキー数が大きすぎます。".to_string());
        }
        let mut previous_frame = None;
        for key in &column.keys {
            if key.frame >= config.plan.duration_frames {
                return Err(format!("{}列に尺外のキーがあります。", column.name));
            }
            if previous_frame.is_some_and(|frame| key.frame <= frame) {
                return Err(format!(
                    "{}列のキーがフレーム順ではありません。",
                    column.name
                ));
            }
            if key.empty {
                if key.cell_number.is_some() {
                    return Err(format!(
                        "{}列の空セルキーにセル番号が含まれています。",
                        column.name
                    ));
                }
            } else if !key
                .cell_number
                .is_some_and(|cell_number| cell_number > 0 && cell_number <= 9_007_199_254_740_991)
            {
                return Err(format!("{}列のセル番号が不正です。", column.name));
            }
            previous_frame = Some(key.frame);
        }
        if column.keys[0].frame != 0 {
            return Err(format!(
                "{}列の先頭キーは0フレームである必要があります。",
                column.name
            ));
        }
    }

    validate_text(&config.options.dialog_title, 128, "ダイアログ名")?;
    validate_text(&config.options.undo_group_name, 128, "Undo名")?;
    validate_text(
        &config.options.managed_blank_effect_name,
        128,
        "空セル用エフェクト名",
    )?;
    Ok(config)
}

fn validate_text(value: &str, max_bytes: usize, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(format!("After Effects用データの{label}が不正です。"));
    }
    Ok(())
}

fn render_script(config: &AeRemapJsxConfig) -> Result<String, String> {
    if JSX_TEMPLATE.matches(CONFIG_PLACEHOLDER).count() != 1 {
        return Err("After Effects固定テンプレートの設定箇所が不正です。".to_string());
    }
    let json = serde_json::to_string(config)
        .map_err(|error| format!("After Effects用データを生成できませんでした: {error}"))?;
    Ok(JSX_TEMPLATE.replace(CONFIG_PLACEHOLDER, &ascii_json_literal(&json)))
}

fn ascii_json_literal(json: &str) -> String {
    let mut escaped = String::with_capacity(json.len());
    for character in json.chars() {
        if character.is_ascii() {
            escaped.push(character);
            continue;
        }
        let mut units = [0u16; 2];
        for unit in character.encode_utf16(&mut units) {
            let _ = write!(escaped, "\\u{unit:04x}");
        }
    }
    escaped
}

#[cfg(target_os = "windows")]
fn send_after_effects_remap_windows(
    script: &str,
    cache_dir: &Path,
) -> Result<AfterEffectsSendResult, String> {
    fs::create_dir_all(cache_dir)
        .map_err(|error| format!("一時JSXフォルダを作成できませんでした: {error}"))?;
    cleanup_stale_temp_scripts(cache_dir);
    let processes = enumerate_after_effects_processes()?;
    let target = choose_after_effects_process(&processes)?;
    let executable_path = target
        .executable_path
        .as_ref()
        .ok_or_else(|| "起動中のAfter Effectsの実行ファイルを確認できませんでした。".to_string())?;
    let temp_path = write_temp_script(cache_dir, script)?;

    let mut child = match Command::new(executable_path)
        .arg("-r")
        .arg(&temp_path)
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("After Effectsへ送信できませんでした: {error}"));
        }
    };

    thread::spawn(move || {
        let deadline = SystemTime::now() + TEMP_FILE_LIFETIME;
        loop {
            if child.try_wait().ok().flatten().is_some() || SystemTime::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        let _ = fs::remove_file(temp_path);
    });

    Ok(AfterEffectsSendResult { accepted: true })
}

fn choose_after_effects_process(
    processes: &[AfterEffectsProcess],
) -> Result<AfterEffectsProcess, String> {
    match processes {
        [] => Err("起動中のAfter Effectsが見つかりません。先にAfter Effectsを起動してください。".to_string()),
        [process] if process.executable_path.is_some() => Ok(process.clone()),
        [..] if processes.len() > 1 => Err("After Effectsが複数起動しています。誤送信を避けるため、対象以外を終了してから再実行してください。".to_string()),
        _ => Err("起動中のAfter Effectsの実行ファイルを確認できませんでした。".to_string()),
    }
}

fn write_temp_script(cache_dir: &Path, script: &str) -> Result<PathBuf, String> {
    for _ in 0..16 {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = cache_dir.join(format!(
            "{TEMP_FILE_PREFIX}{}-{stamp}-{sequence}.jsx",
            std::process::id()
        ));
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("一時JSXファイルを作成できませんでした: {error}"));
            }
        };
        let write_result = file
            .write_all(&[0xEF, 0xBB, 0xBF])
            .and_then(|_| file.write_all(script.as_bytes()))
            .and_then(|_| file.flush());
        if let Err(error) = write_result {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(format!("一時JSXファイルを書き込めませんでした: {error}"));
        }
        return Ok(path);
    }
    Err("一時JSXファイル名を確保できませんでした。".to_string())
}

fn cleanup_stale_temp_scripts(cache_dir: &Path) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_ours = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(TEMP_FILE_PREFIX) && name.ends_with(".jsx"));
        if !is_ours {
            continue;
        }
        let is_stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .and_then(|modified| {
                SystemTime::now()
                    .duration_since(modified)
                    .map_err(std::io::Error::other)
            })
            .is_ok_and(|age| age >= STALE_TEMP_AGE);
        if is_stale {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(target_os = "windows")]
fn enumerate_after_effects_processes() -> Result<Vec<AfterEffectsProcess>, String> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err("After Effectsの起動状態を確認できませんでした。".to_string());
        }

        let mut entry: PROCESSENTRY32W = zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut processes = Vec::new();
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let name = wide_string(&entry.szExeFile);
                if name.eq_ignore_ascii_case("AfterFX.exe") {
                    let executable_path = process_executable_path(
                        entry.th32ProcessID,
                        OpenProcess,
                        QueryFullProcessImageNameW,
                        CloseHandle,
                        PROCESS_QUERY_LIMITED_INFORMATION,
                    );
                    processes.push(AfterEffectsProcess {
                        pid: entry.th32ProcessID,
                        executable_path,
                    });
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        processes.sort_by_key(|process| process.pid);
        Ok(processes)
    }
}

#[cfg(target_os = "windows")]
unsafe fn process_executable_path(
    pid: u32,
    open_process: unsafe extern "system" fn(u32, i32, u32) -> *mut core::ffi::c_void,
    query_path: unsafe extern "system" fn(*mut core::ffi::c_void, u32, *mut u16, *mut u32) -> i32,
    close_handle: unsafe extern "system" fn(*mut core::ffi::c_void) -> i32,
    access: u32,
) -> Option<PathBuf> {
    let process = unsafe { open_process(access, 0, pid) };
    if process.is_null() {
        return None;
    }
    let mut buffer = vec![0u16; 32_768];
    let mut length = buffer.len() as u32;
    let succeeded = unsafe { query_path(process, 0, buffer.as_mut_ptr(), &mut length) } != 0;
    unsafe { close_handle(process) };
    succeeded.then(|| PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize])))
}

#[cfg(target_os = "windows")]
fn wide_string(buffer: &[u16]) -> String {
    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..length])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_value() -> Value {
        json!({
            "schema": CONFIG_SCHEMA,
            "plan": {
                "compFps": 24,
                "sourceFps": 24,
                "durationFrames": 48,
                "columns": [{
                    "id": "A",
                    "name": "A列",
                    "keys": [
                        { "frame": 0, "empty": false, "cellNumber": 1 },
                        { "frame": 12, "empty": true, "cellNumber": null }
                    ]
                }]
            },
            "options": {
                "dialogTitle": "XSHEET Remap - Map Layers",
                "undoGroupName": "Apply XSHEET Time Remap",
                "managedBlankEffectName": "XSHEET Remap Blank"
            }
        })
    }

    fn process(pid: u32, path: Option<&str>) -> AfterEffectsProcess {
        AfterEffectsProcess {
            pid,
            executable_path: path.map(PathBuf::from),
        }
    }

    #[test]
    fn validates_and_renders_only_structured_remap_data() {
        let config = validate_config(valid_value()).unwrap();
        let script = render_script(&config).unwrap();
        assert!(script.starts_with("// xsheet-remap After Effects remap JSX v1"));
        assert!(!script.contains(CONFIG_PLACEHOLDER));
        assert!(script.contains(r#""schema":"xsheet-remap-after-effects-remap-v1""#));
        assert!(script.contains(r#""name":"A\u5217""#));
        assert!(script.contains("if (!layer.timeRemapEnabled) layer.timeRemapEnabled = true;"));
        assert!(script.contains("layer.outPoint = SHEET_DURATION_SECONDS;"));
        assert!(!script.contains("layer.timeRemapEnabled = false;"));
    }

    #[test]
    fn json_strings_cannot_break_out_of_the_fixed_template() {
        let mut value = valid_value();
        value["plan"]["columns"][0]["name"] = json!("\"); system.callSystem('danger'); //\u{2028}");
        let config = validate_config(value).unwrap();
        let script = render_script(&config).unwrap();
        assert!(!script.contains("//\u{2028}"));
        assert!(script.contains(r#""name":"\"); system.callSystem('danger'); //\u2028""#));
        assert_eq!(script.matches("system.callSystem").count(), 1);
    }

    #[test]
    fn rejects_unknown_fields_and_invalid_key_sequences() {
        let mut unknown = valid_value();
        unknown["script"] = json!("alert('no')");
        assert!(validate_config(unknown).is_err());

        let mut unordered = valid_value();
        unordered["plan"]["columns"][0]["keys"][1]["frame"] = json!(0);
        assert!(validate_config(unordered).is_err());

        let mut invalid_source_fps = valid_value();
        invalid_source_fps["plan"]["sourceFps"] = json!(0);
        assert!(validate_config(invalid_source_fps).is_err());

        let mut invalid_cell_number = valid_value();
        invalid_cell_number["plan"]["columns"][0]["keys"][0]["cellNumber"] = json!(0);
        assert!(validate_config(invalid_cell_number).is_err());
    }

    #[test]
    fn chooses_only_one_identifiable_after_effects_process() {
        assert_eq!(
            choose_after_effects_process(&[process(42, Some(r"C:\Adobe\AfterFX.exe"))])
                .unwrap()
                .pid,
            42
        );
        assert!(choose_after_effects_process(&[]).is_err());
        assert!(choose_after_effects_process(&[process(42, None)]).is_err());
        assert!(choose_after_effects_process(&[
            process(10, Some(r"C:\Adobe 2025\AfterFX.exe")),
            process(20, Some(r"C:\Adobe 2026\AfterFX.exe")),
        ])
        .is_err());
    }
}
