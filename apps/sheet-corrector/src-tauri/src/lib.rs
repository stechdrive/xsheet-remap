use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const SHEET_CORRECTOR_BATCH_WINDOW_WIDTH: f64 = 520.0;
const SHEET_CORRECTOR_BATCH_WINDOW_HEIGHT: f64 = 390.0;
const SHEET_CORRECTOR_BATCH_WINDOW_MIN_WIDTH: f64 = 460.0;
const SHEET_CORRECTOR_BATCH_WINDOW_MIN_HEIGHT: f64 = 340.0;
const SHEET_CORRECTOR_MAIN_WINDOW_MIN_WIDTH: f64 = 900.0;
const SHEET_CORRECTOR_MAIN_WINDOW_MIN_HEIGHT: f64 = 620.0;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetCorrectorInput {
    path: String,
    name: String,
    extension: String,
    size: Option<u64>,
    matched: bool,
    source_kind: SheetCorrectorSourceKind,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetCorrectorInputCollection {
    inputs: Vec<SheetCorrectorInput>,
    has_directory: bool,
    has_file: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetCorrectorTemplateFile {
    path: String,
    contents: String,
}

#[derive(serde::Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
enum SheetCorrectorSourceKind {
    File,
    DirectoryEntry,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let has_launch_paths = sheet_corrector_launch_paths().len() > 0;
                if has_launch_paths {
                    window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                        width: SHEET_CORRECTOR_BATCH_WINDOW_MIN_WIDTH,
                        height: SHEET_CORRECTOR_BATCH_WINDOW_MIN_HEIGHT,
                    })))?;
                    window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                        width: SHEET_CORRECTOR_BATCH_WINDOW_WIDTH,
                        height: SHEET_CORRECTOR_BATCH_WINDOW_HEIGHT,
                    }))?;
                    window.center()?;
                    window.show()?;
                } else {
                    window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                        width: SHEET_CORRECTOR_MAIN_WINDOW_MIN_WIDTH,
                        height: SHEET_CORRECTOR_MAIN_WINDOW_MIN_HEIGHT,
                    })))?;
                    window.show()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_sheet_corrector_inputs,
            open_sheet_corrector_template,
            read_sheet_corrector_template,
            collect_sheet_corrector_inputs,
            sheet_corrector_image_data_url,
            export_sheet_corrector_png,
            export_sheet_corrector_psd,
            sheet_corrector_launch_paths,
            quit_sheet_corrector
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running xsheet-corrector")
}

#[tauri::command(rename_all = "camelCase")]
async fn open_sheet_corrector_inputs(
    window: tauri::WebviewWindow,
) -> Result<Vec<SheetCorrectorInput>, String> {
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("シート画像を追加")
        .add_filter(
            "Image",
            &["png", "jpg", "jpeg", "tif", "tiff", "tga", "bmp"],
        );

    if let Some(directory) = stable_file_dialog_directory() {
        dialog = dialog.set_directory(directory);
    }

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    dialog.pick_files(move |files| {
        let _ = tx.blocking_send(files);
    });
    let files = rx.recv().await.flatten().unwrap_or_default();

    let mut inputs = Vec::new();
    for file_path in files {
        let path = file_path.into_path().map_err(|error| error.to_string())?;
        if let Some(input) = sheet_corrector_input_from_path(&path, SheetCorrectorSourceKind::File)?
        {
            inputs.push(input);
        }
    }
    inputs.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
    });
    inputs.dedup_by(|a, b| a.path.eq_ignore_ascii_case(&b.path));
    Ok(inputs)
}

#[tauri::command(rename_all = "camelCase")]
async fn open_sheet_corrector_template(
    window: tauri::WebviewWindow,
) -> Result<Option<SheetCorrectorTemplateFile>, String> {
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("テンプレJSONを読み込み")
        .add_filter("JSON", &["json"]);

    if let Some(directory) = stable_file_dialog_directory() {
        dialog = dialog.set_directory(directory);
    }

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    dialog.pick_file(move |file| {
        let _ = tx.blocking_send(file);
    });
    let Some(file_path) = rx.recv().await.flatten() else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|error| error.to_string())?;
    read_sheet_corrector_template_path(path).map(Some)
}

#[tauri::command(rename_all = "camelCase")]
fn read_sheet_corrector_template(path: String) -> Result<SheetCorrectorTemplateFile, String> {
    read_sheet_corrector_template_path(std::path::PathBuf::from(path))
}

fn read_sheet_corrector_template_path(
    path: std::path::PathBuf,
) -> Result<SheetCorrectorTemplateFile, String> {
    if !path.is_file() {
        return Err("テンプレJSONファイルが見つかりません。".to_string());
    }
    let contents = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    Ok(SheetCorrectorTemplateFile {
        path: path.to_string_lossy().into_owned(),
        contents,
    })
}

#[tauri::command(rename_all = "camelCase")]
fn sheet_corrector_launch_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .map(std::path::PathBuf::from)
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
fn quit_sheet_corrector(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command(rename_all = "camelCase")]
fn collect_sheet_corrector_inputs(
    paths: Vec<String>,
) -> Result<SheetCorrectorInputCollection, String> {
    let mut inputs = Vec::new();
    let mut has_directory = false;
    let mut has_file = false;
    for raw_path in paths {
        let path = std::path::PathBuf::from(raw_path);
        if path.is_dir() {
            has_directory = true;
            for entry in std::fs::read_dir(&path).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                let entry_path = entry.path();
                if entry_path.is_file() {
                    if let Some(input) = sheet_corrector_input_from_path(
                        &entry_path,
                        SheetCorrectorSourceKind::DirectoryEntry,
                    )? {
                        inputs.push(input);
                    }
                }
            }
        } else if path.is_file() {
            has_file = true;
            if let Some(input) =
                sheet_corrector_input_from_path(&path, SheetCorrectorSourceKind::File)?
            {
                inputs.push(input);
            }
        }
    }
    inputs.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
    });
    inputs.dedup_by(|a, b| a.path.eq_ignore_ascii_case(&b.path));
    Ok(SheetCorrectorInputCollection {
        inputs,
        has_directory,
        has_file,
    })
}

#[tauri::command(rename_all = "camelCase")]
fn sheet_corrector_image_data_url(source_path: String) -> Result<String, String> {
    let source = std::path::PathBuf::from(source_path);
    let extension = source
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !is_supported_sheet_image_extension(&extension) {
        return Err("対応していない画像形式です。".to_string());
    }
    let bytes = std::fs::read(&source).map_err(|error| error.to_string())?;
    encode_sheet_image_data_url(&extension, bytes)
}

fn encode_sheet_image_data_url(extension: &str, bytes: Vec<u8>) -> Result<String, String> {
    let (mime_type, bytes) = if extension == "tga" {
        // WebView2 cannot display TGA data URLs, so hand the frontend a lossless PNG.
        ("image/png", convert_tga_to_png(&bytes)?)
    } else {
        (image_mime_type(extension), bytes)
    };
    use base64::Engine as _;
    let payload = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{payload}"))
}

fn convert_tga_to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Tga)
        .map_err(|error| format!("TGA画像を読み込めませんでした: {error}"))?;
    let mut png = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|error| format!("TGA画像をPNGへ変換できませんでした: {error}"))?;
    Ok(png.into_inner())
}

#[tauri::command(rename_all = "camelCase")]
fn export_sheet_corrector_png(
    source_path: String,
    png_data_url: String,
    output_dir: Option<String>,
) -> Result<String, String> {
    let bytes = decode_png_data_url(&png_data_url)?;
    let source = std::path::PathBuf::from(source_path);
    let output_parent = output_dir
        .filter(|value| !value.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| source.parent().map(std::path::Path::to_path_buf))
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    std::fs::create_dir_all(&output_parent).map_err(|error| error.to_string())?;
    let stem = source
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "sheet".to_string());
    let output_path = unique_corrected_path(&output_parent, &stem, "png");
    std::fs::write(&output_path, bytes).map_err(|error| error.to_string())?;
    Ok(output_path.to_string_lossy().into_owned())
}

#[tauri::command(rename_all = "camelCase")]
fn export_sheet_corrector_psd(
    source_path: String,
    psd_base64: String,
    output_dir: Option<String>,
) -> Result<String, String> {
    let bytes = decode_base64_payload(&psd_base64)?;
    let source = std::path::PathBuf::from(source_path);
    let output_parent = output_dir
        .filter(|value| !value.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| source.parent().map(std::path::Path::to_path_buf))
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    std::fs::create_dir_all(&output_parent).map_err(|error| error.to_string())?;
    let stem = source
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "sheet".to_string());
    let output_path = unique_named_path(&output_parent, &stem, "psd");
    std::fs::write(&output_path, bytes).map_err(|error| error.to_string())?;
    Ok(output_path.to_string_lossy().into_owned())
}

fn decode_png_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let Some((header, payload)) = data_url.split_once(',') else {
        return Err("PNGデータURLの形式が不正です。".to_string());
    };
    if !header.starts_with("data:image/png;base64") {
        return Err("PNGデータURLではありません。".to_string());
    }
    decode_base64_payload(payload)
}

fn decode_base64_payload(payload: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|error| error.to_string())
}

fn unique_corrected_path(
    parent: &std::path::Path,
    stem: &str,
    extension: &str,
) -> std::path::PathBuf {
    unique_path_with_name(parent, stem, extension, |stem, index| {
        if index == 1 {
            format!("{stem}_corrected")
        } else {
            format!("{stem}_corrected_{index}")
        }
    })
}

fn unique_named_path(parent: &std::path::Path, stem: &str, extension: &str) -> std::path::PathBuf {
    unique_path_with_name(parent, stem, extension, |stem, index| {
        if index == 1 {
            stem.to_string()
        } else {
            format!("{stem}_{index}")
        }
    })
}

fn unique_path_with_name<F>(
    parent: &std::path::Path,
    stem: &str,
    extension: &str,
    name_for_index: F,
) -> std::path::PathBuf
where
    F: Fn(&str, usize) -> String,
{
    let mut index = 1;
    loop {
        let file_name = format!("{}.{}", name_for_index(stem, index), extension);
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

fn stable_file_dialog_directory() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(|| std::env::current_dir().ok().filter(|path| path.is_dir()))
}

fn sheet_corrector_input_from_path(
    path: &std::path::Path,
    source_kind: SheetCorrectorSourceKind,
) -> Result<Option<SheetCorrectorInput>, String> {
    let Some(name) = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
    else {
        return Ok(None);
    };
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !is_supported_sheet_image_extension(&extension) {
        return Ok(None);
    }
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    Ok(Some(SheetCorrectorInput {
        matched: true,
        path: path.to_string_lossy().into_owned(),
        name,
        extension,
        size: Some(metadata.len()),
        source_kind,
    }))
}

fn is_supported_sheet_image_extension(extension: &str) -> bool {
    matches!(
        extension,
        "png" | "jpg" | "jpeg" | "tif" | "tiff" | "tga" | "bmp"
    )
}

fn image_mime_type(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "tga" => "image/x-tga",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use image::GenericImageView as _;

    #[test]
    fn converts_bottom_left_rle_true_color_tga_to_png_data_url() {
        let mut tga = vec![0_u8; 18];
        tga[2] = 10;
        tga[12..14].copy_from_slice(&2_u16.to_le_bytes());
        tga[14..16].copy_from_slice(&2_u16.to_le_bytes());
        tga[16] = 32;
        tga[17] = 0;
        tga.extend_from_slice(&[0x81, 0, 0, 255, 255]);
        tga.extend_from_slice(&[0x81, 0, 255, 0, 255]);

        let data_url = encode_sheet_image_data_url("tga", tga).expect("TGA conversion");
        let payload = data_url
            .strip_prefix("data:image/png;base64,")
            .expect("PNG data URL");
        let png = base64::engine::general_purpose::STANDARD
            .decode(payload)
            .expect("base64 payload");
        let decoded = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
            .expect("converted PNG");

        assert_eq!(decoded.dimensions(), (2, 2));
        assert_eq!(decoded.get_pixel(0, 0).0, [0, 255, 0, 255]);
        assert_eq!(decoded.get_pixel(0, 1).0, [255, 0, 0, 255]);
    }

    #[test]
    fn returns_a_tga_specific_error_for_invalid_data() {
        let error = encode_sheet_image_data_url("tga", b"not a tga".to_vec())
            .expect_err("invalid TGA must fail");

        assert!(error.starts_with("TGA画像を読み込めませんでした:"));
    }

    #[test]
    fn preserves_browser_supported_image_bytes() {
        let bytes = vec![1, 2, 3, 4];
        let data_url = encode_sheet_image_data_url("png", bytes).expect("PNG data URL");

        assert_eq!(data_url, "data:image/png;base64,AQIDBA==");
    }
}
