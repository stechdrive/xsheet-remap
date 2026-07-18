# Third-Party Notices

This project is licensed under the MIT License. It also uses third-party
packages and assets under their own licenses.

## Direct Runtime Dependencies

| Component | License | Notes |
| --- | --- | --- |
| React / React DOM | MIT | UI runtime |
| Tauri API and Tauri Rust crates | Apache-2.0 OR MIT | Desktop runtime |
| OpenCV.js package | Apache-2.0 | Image processing in the UI |
| PaddleOCR.js | Apache-2.0 | Browser OCR pipeline |
| PP-OCRv5 mobile detection and recognition models | Apache-2.0 | Bundled ONNX OCR models |
| ONNX Runtime Web | MIT | Bundled WebAssembly inference runtime |
| fflate | MIT | Project container ZIP compression and extraction |
| LINE Seed JP via `@fontsource/line-seed-jp` | OFL-1.1 | Bundled UI font files |
| pywinauto / pyperclip / Pillow / pywebview | permissive OSS licenses | CSP helper runtime dependencies |

## Transitive Dependencies

The npm and Cargo dependency graphs include permissive licenses such as MIT,
Apache-2.0, BSD, ISC, Zlib, Unicode-3.0, and Unlicense. They also include a few
notice-bearing dependencies such as MPL-2.0 packages and CC-BY-4.0 data.

Before publishing a binary release, regenerate or review the dependency
license list from the lockfiles and include the required third-party license
texts with the release package.

Relevant lockfiles and manifests:

- `package-lock.json`
- `apps/desktop/src-tauri/Cargo.lock`
- `apps/sheet-corrector/src-tauri/Cargo.lock`
- `apps/csp-import-helper/requirements/*.txt`
