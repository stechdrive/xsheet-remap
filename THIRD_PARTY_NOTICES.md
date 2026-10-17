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
| fflate 0.8.3 | MIT | Project ZIP compression and CLIP raster compression; license reproduced below |
| ag-psd 31.0.3 / base64-js 1.5.1 | MIT | Editable PSD text export; licenses reproduced below |
| pako 2.1.0 | MIT AND Zlib | Compression used by ag-psd; licenses reproduced below |
| LINE Seed JP via `@fontsource/line-seed-jp` | OFL-1.1 | Bundled UI font files and extracted vertical glyph outlines (copyright LY Corporation) |
| sql.js 1.14.2 / SQLite | MIT / Public domain | Direct CLIP database editing |

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

## sql.js

Version: 1.14.2. Source: https://github.com/sql-js/sql.js/tree/v1.14.2
The complete license from the distributed package follows, including its
Makefile attribution and SQLite public-domain notice.

MIT license
===========

Copyright (c) 2017 sql.js authors (see AUTHORS)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.



# Some portions of the Makefile taken from:
Copyright 2017 Ryusei Yamaguchi

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
SQLite is in the public domain: https://sqlite.org/copyright.html

## fflate

Version: 0.8.3. Source: https://github.com/101arrowz/fflate/tree/v0.8.3
License text from `fflate@0.8.3/LICENSE`:

```text
MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## CLIP format research acknowledgements

The CLIP support in `packages/adapters/src/clip` uses the following public
repositories as format and implementation references. These projects are
research references, not installed runtime dependencies. We acknowledge their
authors and reproduce their MIT license notices below. Links identify the
revisions used for this attribution.

### clipfile-rs

Source: https://github.com/Aodaruma/clipfile-rs/tree/bd88467fa80e63ad48c6c713fbfb5a8a116d798a

Reference for CLIP container, database and animation structures.

License: https://github.com/Aodaruma/clipfile-rs/blob/bd88467fa80e63ad48c6c713fbfb5a8a116d798a/LICENSE

```text
MIT License

Copyright (c) 2026 Aodaruma

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### clipparse

Source: https://github.com/wamsoft/clipparse/tree/322a273c0e059d1dee9132af78289efa12a59522

Reference for CLIP format documentation, BINC and animation TrackValueMap.

License: https://github.com/wamsoft/clipparse/blob/322a273c0e059d1dee9132af78289efa12a59522/LICENSE

```text
MIT License

Copyright (c) 2026 wamsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### clip-tools

Source: https://github.com/al3ks1s/clip-tools/tree/e1d3d7ed4701ac84e9220127daa73c2cf90dd803

Reference for CLIP container and SQLite extraction. The upstream copyright
line contains a year but no author name; it is reproduced without adding one.

License: https://github.com/al3ks1s/clip-tools/blob/e1d3d7ed4701ac84e9220127daa73c2cf90dd803/LICENCE

```text
MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Editable PSD export

ag-psd, pako and base64-js include the following MIT notices:

```text
The MIT License (MIT)

Copyright (c) 2016 Agamnentzar
Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn
Copyright (c) 2014 Jameson Little

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The ag-psd license also excludes its repository's image and brush files; those
files are not distributed with this application.

The zlib-derived code in pako carries this notice:

```text
(C) 1995-2013 Jean-loup Gailly and Mark Adler
(C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```
