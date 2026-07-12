#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    xsheet_desktop_runtime::run(tauri::generate_context!());
}
