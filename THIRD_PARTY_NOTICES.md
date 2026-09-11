# Third-Party Notices

This project is licensed under the MIT License. It also uses third-party
packages and assets under their own licenses.

## Direct Runtime Dependencies

| Component | License | Notes |
| --- | --- | --- |
| React / React DOM | MIT | UI runtime |
| CanvasKit / Skia (`canvaskit-wasm` 0.42.0) | BSD-3-Clause | GPU paper rendering; license reproduced below |
| Tauri API and Tauri Rust crates | Apache-2.0 OR MIT | Desktop runtime |
| OpenCV.js package | Apache-2.0 | Image processing in the UI |
| PaddleOCR.js | Apache-2.0 | Browser OCR pipeline |
| PP-OCRv5 mobile detection and recognition models | Apache-2.0 | Bundled ONNX OCR models |
| ONNX Runtime Web | MIT | Bundled WebAssembly inference runtime |
| Silero VAD 16k OP15 model | MIT | Bundled dialogue voice-activity detection model from Silero VAD 6.2.0 |
| Mediabunny / `@mediabunny/mp3-encoder` | MPL-2.0 | Browser media writer and MP3 encoder integration |
| LAME 3.100 | LGPL | WebAssembly MP3 encoder bundled by `@mediabunny/mp3-encoder` |
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

## MP3 encoder

MP3 export uses Mediabunny and its MP3 encoder extension. Their source code and
MPL-2.0 license are available at https://github.com/Vanilagy/mediabunny.
The extension includes a WebAssembly build of LAME 3.100, which is distributed
under the LGPL. LAME source and license information are available at
https://lame.sourceforge.io/ and https://lame.sourceforge.io/license.txt.

The source code for this application, including its audio export integration,
is available at https://github.com/stechdrive/xsheet-remap.

## Silero VAD model

The bundled `apps/web/public/vad/models/silero_vad.onnx` file comes from
`silero_vad-6.2.0-py3-none-any.whl` (`silero_vad/data/silero_vad_16k_op15.onnx`).
The model is distributed by the Silero Team under the MIT License:
https://github.com/snakers4/silero-vad

## CanvasKit / Skia

Copyright (c) 2011 Google Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
