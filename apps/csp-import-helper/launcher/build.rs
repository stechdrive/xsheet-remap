use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=../../../VERSION");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=launcher.manifest");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .ancestors()
        .nth(3)
        .expect("launcher must stay under apps/csp-import-helper")
        .to_path_buf();
    let version = fs::read_to_string(repo_root.join("VERSION"))
        .expect("read VERSION")
        .trim()
        .to_owned();
    let numeric_version = resource_numeric_version(&version);
    let output = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let resource_path = output.join("launcher.rc");
    let icon_path = resource_path_literal(&manifest_dir.join("icons/icon.ico"));
    let manifest_path = resource_path_literal(&manifest_dir.join("launcher.manifest"));
    let resource = format!(
        r#"#pragma code_page(65001)
1 ICON "{icon_path}"
1 24 "{manifest_path}"
1 VERSIONINFO
FILEVERSION {numeric_version}
PRODUCTVERSION {numeric_version}
FILEFLAGSMASK 0x3fL
FILEFLAGS 0x0L
FILEOS 0x40004L
FILETYPE 0x1L
FILESUBTYPE 0x0L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "041104B0"
    BEGIN
      VALUE "CompanyName", "xsheet-remap contributors\0"
      VALUE "FileDescription", "CSP自動登録\0"
      VALUE "FileVersion", "{version}\0"
      VALUE "InternalName", "xsheet-importer\0"
      VALUE "LegalCopyright", "MIT License\0"
      VALUE "OriginalFilename", "xsheet-importer.exe\0"
      VALUE "ProductName", "xsheet-importer\0"
      VALUE "ProductVersion", "{version}\0"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x0411, 1200
  END
END
"#,
    );
    fs::write(&resource_path, resource).expect("write launcher.rc");
    embed_resource::compile(&resource_path, embed_resource::NONE)
        .manifest_required()
        .expect("compile launcher resources");
}

fn resource_numeric_version(version: &str) -> String {
    let mut parts = version
        .split(['.', '-', '+'])
        .take(3)
        .map(|part| part.parse::<u16>().unwrap_or(0))
        .collect::<Vec<_>>();
    while parts.len() < 3 {
        parts.push(0);
    }
    format!("{},{},{},0", parts[0], parts[1], parts[2])
}

fn resource_path_literal(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "\\\\")
}
