# xsheet-remap

xsheet-remapは、デジタルタイムシートの編集、紙シート画像の補正、テンプレート作成、CLIP STUDIO PAINT EXへの組み込みを扱うデスクトップアプリ群です。CSPはCLIP STUDIO PAINTのことです。

全機能版の`xsheet-editor`と、CSP組み込みに絞った`xsheet-remap`は同じプロジェクト・テンプレート・XDTS・CSP自動登録データの実装を共有しています。

## ダウンロードと起動

[GitHub Releasesの`latest`](https://github.com/stechdrive/xsheet-remap/releases/tag/latest)から`xsheet-remap.zip`をダウンロードし、ZIP全体を展開して使います。インストールは不要です。

迷った場合は、まず全機能版の`xsheet-editor.exe`を起動してください。CSP組み込み作業だけを行う場合は`xsheet-remap.exe`を使います。

| ファイル | 役割 | 使う場面 |
| --- | --- | --- |
| `xsheet-editor.exe` | デジタルタイムシート全機能版 | 紙シート読込、タイミング編集、素材管理、テンプレート編集、各種出力 |
| `xsheet-remap.exe` | CSP組み込み | 紙シート、素材、セル対応を整理し、XDTS・CSP自動登録データを出力 |
| `xsheet-template-editor.exe` | シートテンプレート編集 | 参照画像、罫線領域、情報欄、補正基準枠を編集してテンプレートを保存 |
| `xsheet-corrector.exe` | シート画像補正 | スキャンしたシート画像の一括補正とPSD出力 |
| `xsheet-csp-import-helper.bat` | CSP自動登録ヘルパー | 本体が出力した`.xci`と対象`.clip`を使い、CLIP STUDIO PAINTを自動操作 |
| `assets/xsheet-remap.laf` | 乗算オートアクション | CLIP STUDIO PAINTのオートアクションパレットから読み込むファイル。アプリではありません |
| `csp-import-helper/` | ヘルパー実行環境 | BATが使用する同梱ランタイム。直接起動せず、BATと同じ場所に置いたまま使います |

### 操作と起動するアプリ

| 操作 | 起動・実行されるもの |
| --- | --- |
| `xsheet-editor.exe`をダブルクリック | デジタルタイムシート全機能版が起動します |
| `xsheet-remap.exe`をダブルクリック | CSP組み込みに絞った画面が起動します |
| `xsheet-template-editor.exe`をダブルクリック | シートテンプレート専用エディタが起動します |
| `xsheet-corrector.exe`をダブルクリック | 補正内容を確認しながら処理する通常画面が起動します |
| 画像やカットフォルダを`xsheet-corrector.exe`へドロップ | 補正ツールがバッチモードで起動し、自動PSD出力を開始します |
| `xsheet-csp-import-helper.bat`をダブルクリック | CSP自動登録ヘルパーが起動します |
| `.xci`または`.clip`をBATへドロップ | そのファイルを選択した状態でヘルパーが起動します。もう一方のファイルは画面で指定します |
| ヘルパーで「開始」 | 対象`.clip`を開き、CLIP STUDIO PAINTの自動操作を開始します |
| `xsheet-editor`または`xsheet-remap`で「タイムシート/CSP自動登録」を出力 | 登録用ファイルを出力します。ヘルパーは自動起動しません |

`xsheet-csp-import-helper.bat`だけを別の場所へ移動すると動作しません。配布フォルダの構成を保ったまま使用してください。

## できること

- A3標準タイムシート画像を読み込み、下敷きとして表示する
- 紙シート画像を補正し、薄いスキャンを見やすくする
- 素材画像をプレビューしながら、CELL/ACTION/CAMERA欄へ割り当てる
- 登録セル名、CSPセル名、実ファイル名の対応を確認する
- 素材名をCSPで扱いやすい名前へ整える
- ペン注釈やテキスト注釈をシート上に追加する
- タイムシートをPNG/JPG/PSD/XDTSとして書き出す
- CSP自動登録ヘルパー用の登録ファイルとXDTSを出力する

## 基本の流れ

1. 紙タイムシートを指定dpiでスキャンします。
2. スキャンした作画素材を、必要に応じてタップ穴基準で位置合わせします。
3. `xsheet-editor`または`xsheet-remap`で紙シート画像を読み込みます。
4. 素材画像またはカットフォルダを素材ブラウザへ入れます。
5. 素材をシート上の該当セルへドラッグして、キーや工程へ割り当てます。
6. 登録セル、CSPセル名、素材ファイル名を確認します。
7. 必要な形式で書き出します。

## CSP自動登録

「タイムシート/CSP自動登録」を保存すると、CSP自動登録ヘルパー用の登録ファイル `csp-import.xci`、XDTS、素材参照が出力されます。

`csp-import.xci` はこのアプリ用のJSON系ファイルです。CLIP STUDIO PAINTで直接読み込むファイルではありません。CSPへ自動登録する場合は、同梱のCSP自動登録ヘルパーで `csp-import.xci` を選択します。

CSP自動登録ヘルパーを使う前に、CLIP STUDIO PAINTへ乗算オートアクションを用意してください。リリースZIPには `assets/xsheet-remap.laf` を同梱していますが、同じショートカットでレイヤー合成モードを乗算にする自作オートアクションでも使えます。

## シート画像補正

同梱のシート画像補正アプリでは、紙シート画像の四隅や内部基準点を合わせ、表示や認識に使いやすい状態へ補正できます。本体アプリでも、読み込んだ紙シート画像の補正値を扱えます。

## 出力

確認用にはPNG/JPG/PSD、CSP連携用にはXDTSまたはCSP自動登録出力を使います。CSP自動登録出力では素材画像そのものをコピーせず、登録ファイルからカットフォルダ内の既存素材を参照します。

## 開発用ビルドと配布

`npm run build:desktop`、`npm run build:csp-helper`、`npm run package:local`、`npm run build:all-local`は、成果物をリポジトリ内の`release-local/`に生成します。これらのコマンドは、`XSHEET_RELEASE_COPY_DIR`が設定されていても外部フォルダへコピーしません。

生成済みの配布ZIPとチェックサムを受け渡し先へコピーするときだけ、`npm run publish:handoff`を実行します。コピー先は`XSHEET_RELEASE_COPY_DIR`または`tools/release/publish-handoff.ps1`の`-DestinationDir`で指定します。このコマンドが外部へコピーするのは`xsheet-remap.zip`と`xsheet-remap.zip.sha256`だけです。

## ライセンス

このリポジトリの自作コードと自作ドキュメントはMIT Licenseです。第三者依存パッケージ、フォント、同梱ランタイムはそれぞれのライセンスに従います。概要は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を参照してください。
