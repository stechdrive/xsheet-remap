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
| `xsheet-template.exe` | シートテンプレート編集 | 参照画像、罫線領域、情報欄、補正基準枠を編集してテンプレートを保存 |
| `xsheet-corrector.exe` | シート画像補正 | スキャンしたシート画像の一括補正とPSD出力 |
| `xsheet-importer.exe` | CSP自動登録 | 本体が出力した`.xci`と対象`.clip`を使い、CLIP STUDIO PAINTを自動操作 |
| `assets/xsheet-remap.laf` | 乗算オートアクション | CLIP STUDIO PAINTのオートアクションパレットから読み込むファイル。アプリではありません |
| `csp-import-helper/` | ヘルパー実行環境 | ヘルパーEXEが使用する同梱ランタイム。直接起動せず、EXEと同じ場所に置いたまま使います |

### 操作と起動するアプリ

| 操作 | 起動・実行されるもの |
| --- | --- |
| `xsheet-editor.exe`をダブルクリック | デジタルタイムシート全機能版が起動します |
| `xsheet-remap.exe`をダブルクリック | CSP組み込みに絞った画面が起動します |
| `xsheet-template.exe`をダブルクリック | シートテンプレート編集アプリが起動します |
| `xsheet-corrector.exe`をダブルクリック | 補正内容を確認しながら処理する通常画面が起動します |
| 画像やカットフォルダを`xsheet-corrector.exe`へドロップ | 補正ツールがバッチモードで起動し、自動PSD出力を開始します |
| `xsheet-importer.exe`をダブルクリック | CSP自動登録アプリが起動します |
| `.xci`または`.clip`を`xsheet-importer.exe`へドロップ | そのファイルを選択した状態で起動します。もう一方のファイルは画面で指定します |
| `xsheet-importer`で「開始」 | 対象`.clip`を開き、CLIP STUDIO PAINTの自動操作を開始します |
| `xsheet-editor`または`xsheet-remap`で「タイムシート/CSP自動登録」を出力 | 登録用ファイルを出力します。`xsheet-importer`は自動起動しません |

`xsheet-importer.exe`だけを別の場所へ移動すると動作しません。配布フォルダの構成を保ったまま使用してください。

## できること

- A3標準タイムシート画像を読み込み、下敷きとして表示する
- 紙シート画像を補正し、薄いスキャンを見やすくする
- 素材画像をプレビューしながら、CELL/ACTION/CAMERA欄へ割り当てる
- 登録セル名、CSPセル名、実ファイル名の対応を確認する
- 素材名をCSPで扱いやすい名前へ整える
- ペン注釈やテキスト注釈をシート上に追加する
- タイムシートをPNG/JPG/PSD/XDTSとして書き出す
- `xsheet-importer`用の登録ファイルとXDTSを出力する

## 基本の流れ

1. 紙タイムシートを指定dpiでスキャンします。
2. スキャンした作画素材を、必要に応じてタップ穴基準で位置合わせします。
3. `xsheet-editor`または`xsheet-remap`で紙シート画像を読み込みます。
4. 素材画像またはカットフォルダを素材ブラウザへ入れます。
5. 素材をシート上の該当セルへドラッグして、キーや工程へ割り当てます。
6. 登録セル、CSPセル名、素材ファイル名を確認します。
7. 必要な形式で書き出します。

## CSP自動登録

「タイムシート/CSP自動登録」を保存すると、`xsheet-importer`用の登録ファイル `csp-import.xci`、XDTS、素材参照が出力されます。

`csp-import.xci` はこのアプリ用のJSON系ファイルです。CLIP STUDIO PAINTで直接読み込むファイルではありません。CSPへ自動登録する場合は、同梱の`xsheet-importer`で `csp-import.xci` を選択します。

`xsheet-importer`を使う前に、CLIP STUDIO PAINTへ乗算オートアクションを用意してください。リリースZIPには `assets/xsheet-remap.laf` を同梱していますが、同じショートカットでレイヤー合成モードを乗算にする自作オートアクションでも使えます。

## シート画像補正

同梱のシート画像補正アプリでは、紙シート画像の四隅や内部基準点を合わせ、表示や認識に使いやすい状態へ補正できます。本体アプリでも、読み込んだ紙シート画像の補正値を扱えます。

## 出力

確認用にはPNG/JPG/PSD、CSP連携用にはXDTSまたはCSP自動登録出力を使います。CSP自動登録出力では素材画像そのものをコピーせず、登録ファイルからカットフォルダ内の既存素材を参照します。

PSDでは、紙シート画像、テンプレート罫線、テンプレートラベル、追加トラック、カット情報、ACTION/CELL入力、SOUND指示、CAMERA指示、通常の手描き注釈、タイムラインメモ、注釈文字を用途別レイヤーとして出力します。紙シート画像の表示不透明度は画素へ焼き込まずPSDレイヤー属性に保持するため、画像編集ソフトで100%へ戻せます。

## 開発用ビルドと配布

日常の実機テストでは、対象アプリだけをビルドしてリポジトリ内の`dev-local/`へ集約します。

```powershell
npm run build:dev:editor
npm run build:dev:remap
npm run build:dev:template
npm run build:dev:corrector
npm run build:dev:all
```

各コマンドは`dev-local/xsheet-*.exe`のうち対象だけを更新します。`dev-local/build-state.json`には、EXEごとのバージョン、コミット、ビルドセッション、SHA-256が記録されます。E2Eとデスクトップスモークテストも、既定ではこのフォルダのEXEを使用します。

`release-local/`は、全アプリが同じビルドセッションで作られた配布成果物専用です。`npm run build:desktop`は4本すべてを再ビルドして`release-local/`を更新し、同じ4本を`dev-local/`にも同期します。`npm run build:all-local`はさらにCSP Importerと配布ZIPを生成します。部分ビルド後に`npm run package:local`を直接実行しても、4本のビルド状態と実ファイルのハッシュが一致しなければ停止します。

4本のTauriアプリは`.cache/cargo-target/`のCargo成果物を共有します。各ビルド後には対象アプリの古いbuild-script出力を自動整理し、アプリ別`target/`への依存物重複とコミットごとのWebリソース蓄積を防ぎます。Cargoの並列数は既定で最大8に制限し、多コア環境での過剰な同時コンパイルも防ぎます（必要なら`CARGO_BUILD_JOBS`で上書きできます）。容量確認と手動クリーンアップには次を使います。

```powershell
npm run disk:report
npm run clean:generated            # 削除対象のプレビュー
npm run clean:generated:apply      # 旧targetと.tmpを削除
npm run clean:generated:all:apply  # 共有Cargoキャッシュも含めて削除
```

`.tmp/`は再生成可能なテスト成果物です。校正評価・精度比較も既定では`.tmp/`へ出力されます。長期保存する必要があるスクリーンショットや評価結果だけを、選別して`reference-local/`へ移してからクリーンアップします。

これらのコマンドは、`XSHEET_RELEASE_COPY_DIR`が設定されていても外部フォルダへコピーしません。

生成済みの配布ZIPとチェックサムを受け渡し先へコピーするときだけ、`npm run publish:handoff`を実行します。コピー先は`XSHEET_RELEASE_COPY_DIR`または`tools/release/publish-handoff.ps1`の`-DestinationDir`で指定します。このコマンドが外部へコピーするのは`xsheet-remap.zip`と`xsheet-remap.zip.sha256`だけです。

## ライセンス

このリポジトリの自作コードと自作ドキュメントはMIT Licenseです。第三者依存パッケージ、フォント、同梱ランタイムはそれぞれのライセンスに従います。概要は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を参照してください。
