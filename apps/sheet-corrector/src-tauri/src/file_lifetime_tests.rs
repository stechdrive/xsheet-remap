use super::*;
use std::fs;
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

struct TestChild(Child);

impl Drop for TestChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn releases_launch_folder_and_files_while_preserving_output_defaults() {
    const CHILD_ROOT: &str = "XSHEET_CORRECTOR_FILE_LIFETIME_TEST";
    if let Some(root) = std::env::var_os(CHILD_ROOT) {
        exercise_input_and_output(&PathBuf::from(root));
        return;
    }

    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "xsheet-corrector-file-lifetime-{}-{id}",
        std::process::id()
    ));
    let input = root.join("入力 folder");
    let destination = root.join("destination");
    fs::create_dir_all(&input).unwrap();
    fs::create_dir(&destination).unwrap();
    fs::write(input.join("入力 sheet.png"), b"input bytes").unwrap();
    fs::write(input.join("broken.tga"), b"not a tga").unwrap();
    fs::write(root.join("absolute image.png"), b"absolute input").unwrap();

    // Changing the process-wide directory inside the shared test process would
    // race other tests. Run the real startup and file commands in a child.
    let mut child = TestChild(Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "file_lifetime_tests::releases_launch_folder_and_files_while_preserving_output_defaults", "--nocapture"])
        .current_dir(&input)
        .env(CHILD_ROOT, &root)
        .env("LOCALAPPDATA", root.join("app-data"))
        .stdin(Stdio::piped())
        .spawn().unwrap());
    let deadline = Instant::now() + Duration::from_secs(20);
    while !root.join("ready").is_file() {
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "startup/export child failed"
        );
        assert!(Instant::now() < deadline, "startup/export child timed out");
        std::thread::sleep(Duration::from_millis(10));
    }

    for name in [
        "入力 sheet.png",
        "broken.tga",
        "入力 sheet_corrected.png",
        "入力 sheet.psd",
    ] {
        // An exclusive open detects retained file handles even when they allow
        // deletion sharing, which a successful rename alone would not detect.
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(input.join(name))
            .expect("input/output handle must be closed");
        drop(file);
    }
    let renamed = root.join("renamed folder");
    fs::rename(&input, &renamed).expect("launch directory must be released while child is alive");
    let moved = destination.join("moved folder");
    fs::rename(&renamed, &moved).expect("completed input/output folder must be movable");
    assert_eq!(
        fs::read(moved.join("入力 sheet.png")).unwrap(),
        b"input bytes"
    );
    assert_eq!(
        fs::read(moved.join("入力 sheet_corrected.png")).unwrap(),
        b"input bytes"
    );
    assert_eq!(
        fs::read(moved.join("入力 sheet.psd")).unwrap(),
        [0, 1, 2, 253, 254, 255]
    );
    assert!(child.0.try_wait().unwrap().is_none());

    drop(child.0.stdin.take());
    while child.0.try_wait().unwrap().is_none() {
        assert!(
            Instant::now() < deadline,
            "child did not exit after releasing stdin"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(child.0.wait().unwrap().success());
    drop(child);
    fs::remove_dir_all(root).unwrap();
}

fn exercise_input_and_output(root: &Path) {
    let input = root.join("入力 folder");
    let source = input.join("入力 sheet.png");
    let absolute = root.join("absolute image.png");
    let paths = startup::prepare_launch_paths_from([
        ".".into(),
        "入力 sheet.png".into(),
        absolute.clone().into_os_string(),
        "missing.png".into(),
    ])
    .unwrap();
    assert_eq!(
        paths.0.iter().map(PathBuf::from).collect::<Vec<_>>(),
        [input.clone(), source.clone(), absolute]
    );
    assert_eq!(
        std::env::current_dir().unwrap(),
        root.join("app-data/local.xsheet-remap.sheet-corrector/working")
    );
    let inputs = collect_sheet_corrector_inputs(vec![paths.0[0].clone()]).unwrap();
    assert!(inputs.has_directory);
    assert_eq!(inputs.inputs.len(), 2);
    assert!(inputs
        .inputs
        .iter()
        .all(|entry| Path::new(&entry.path).is_absolute()));
    let data = sheet_corrector_image_data_url(paths.0[1].clone()).unwrap();
    let png = export_sheet_corrector_png(paths.0[1].clone(), data, None).unwrap();
    let psd = export_sheet_corrector_psd(paths.0[1].clone(), "AAEC/f7/".into(), None).unwrap();
    assert_eq!(Path::new(&png).parent(), Some(input.as_path()));
    assert_eq!(Path::new(&psd).parent(), Some(input.as_path()));
    let explicit_output = root.join("explicit output");
    let explicit = export_sheet_corrector_psd(
        paths.0[1].clone(),
        "AAEC/f7/".into(),
        Some(explicit_output.to_string_lossy().into_owned()),
    )
    .unwrap();
    assert_eq!(
        Path::new(&explicit).parent(),
        Some(explicit_output.as_path())
    );
    assert!(sheet_corrector_image_data_url(
        input.join("broken.tga").to_string_lossy().into_owned()
    )
    .is_err());
    assert!(export_sheet_corrector_png(paths.0[1].clone(), "invalid".into(), None).is_err());
    fs::write(
        root.join("ready"),
        b"file commands finished; child remains alive",
    )
    .unwrap();
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).unwrap();
}
