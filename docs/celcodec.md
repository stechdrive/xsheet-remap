# celcodecによるCLIP形式処理

CLIPの形式処理はcelcodec **0.7.0**へ集約する。読み込み・プレビュー・保存は公開文書セッションと編集操作を使い、セル・工程・カットの規則、UI、履歴、Worker・WASM・フォントの初期化はこのアプリが担当する。

## 固定した配布依存

依存所有者は [packages/adapters/package.json](../packages/adapters/package.json)。`vendor/celcodec-0.7.0-620b056b2636.tgz` をリポジトリ内のfile依存として固定する。単独cloneから `npm ci --ignore-scripts` で導入でき、兄弟checkoutの変更や公開レジストリの更新に依存しない。

- 提供元コミット: `f7b5c6235c2894350ece22d6ec6133bd53e2a42c`
- SHA-256: `620b056b26366efada9ed412b2c0882f6a280ee36ec2441fdc2018d2cf3cdcd6`
- ライブラリ配布内容: 公開JS・型・manifest・README・ライセンス・クレジットの214ファイル。CLIPや採取資料は含まない。

[固定依存の監査](../tools/checks/vendor-celcodec.mjs)がmanifest・lock・tarballの版、hash、ファイル一覧を検査する。symlinkや兄弟checkoutへの依存には切り替えない。

## 文書セッションとアプリの境界

[session.ts](../packages/adapters/src/clip/session.ts)がセッションの入力上限とキャンバス情報の変換を担当する。読み取り・保存・プレビューは各所有者がfinallyまたは明示的なcloseでセッションを解放する。入力bytesを変更しない。

- [reader.ts](../packages/adapters/src/clip/reader.ts): UUID・階層・保存属性・タイムラインをRemapのモデルへ変換する。保存タイミング自体は保持し、整数フレームのシートへ変換できないトラックは診断する。負数と再生範囲外の整数キーは残す。従来のFPS・期間・階層・入力サイズ上限を維持する。
- [registration-writer.ts](../packages/adapters/src/clip/registration-writer.ts): 管理フォルダーとセルの名前空間、再登録、各カットのセル指定を公開操作へ変換する。全タイムラインを作ってから音声を置換し、他カットに明示的な無音トラックを作る。
- [document-writer.ts](../packages/adapters/src/clip/document-writer.ts): 元CLIPの編集差分をrename・属性変更・追加・移動・削除・タイムライン操作へ変換する。未選択トラック、未知ラベル、外部データを保持し、無編集時は入力とバイト一致する。
- [writer.ts](../packages/adapters/src/clip/writer.ts): 読み込みまたは新規作成、planEdits、save、再読込を管理する。画像の整数配置、crop/expand、アプリの安全な書き込み条件を維持する。通常登録は同寸法の画像、文書編集は異なる寸法の追加画像にも対応する。
- [preview.ts](../packages/adapters/src/clip/preview.ts): 素材はprefer-original、フォルダーと動画は保存済み合成を読む。extent予算とvector予約を使い、アプリ側で単独プレビューのマスク・効果・診断を適用する。保存済み合成への効果の二重適用を避ける。OffscreenCanvasとWorkerの所有権はアプリに残す。

ACTION/CELL、工程、カット、入力セル名、対応付け、丸め、Undo/Redoはcoreに残す。celcodec-plan.tsは従来の `xsheet-remap:clip:1:` 名前空間によるUUIDと音声入力の変換だけを担当する。

通常レイヤーをアニメーションフォルダーへ移す既存操作は、ライブラリの `moveLayer.crossAnimationTracks: 'detach'` を明示する。既知トラックの連結を解除し、元の行・ラベル・外部データは残す。ライブラリの既定動作は拒否のまま、未知トラック種類も拒否する。名前によるセル再結合は `celReferences: 'follow-layer-order'` として明示する。ライブラリへRemapの工程モデルを持ち込まない。

## 空テンプレートと旧版の比較

[Worker](../packages/adapters/src/clip/clip-document.worker.ts)は、アプリが従来から保持している `packages/adapters/src/clip/blank.clip` をURLとして読み、createDocumentと編集計画へ渡す。廃止されたcelcodec/blank.clip exportは使わない。既存seedのSHA-256は `6fb3efa8066af90b2d0e042ddc3d2aee7572691e5cc658f89cdb02467e377a82`。今回新しいCLIPや採取値を追加していない。Pagesの内容監査もこの許可済みhashを検査する。

既存の `vendor/celcodec-0.2.0.tgz` は、固定した比較元・fixture生成専用のroot devDependency `celcodec-legacy` として残す。SHA-256は `7b658887da5e7d610f271c163cffa1ce61ec4a01dd65c575e3ae1ceca77764e0`。旧形式の低水準ラッパーはclip/test-support/へ隔離し、製品コードからの旧パッケージ・fixture・test-supportへのimportを構文ベースのarchitecture検査で拒否する。製品は0.7.0だけを使う。

旧writerで作ったCLIPに対して、現行readerとのモデル一致、無編集のバイト一致、セル並べ替え、レイヤー移動、選択タイムラインの編集、画像・音声の保持を検証する。既存のCSP採取値は独立した比較基準として維持する。ベクターの合成テスト用コントロールはネイティブの継続状態を含まないため、ゼロ埋め領域を実際のRNG・間隔リセットとして扱わない。ネイティブ継続記録の検証はライブラリ側の資料庫回帰で行う。

## 共同開発と検証

接続・検証・並行作業の正本はcelcodec側のdocs/linked-development.md。consumer名はxsheet-remap、登録時は `--workspace packages/adapters` を指定する。同期はこのconsumerだけを選ぶ。tarballはルートのvendor/、依存指定はfile:../../vendor/...、lockはルートに置く。登録は依存やAPIの移行を意味しない。

更新時は提供側の検証を完了し、tarball・この文書の来歴・固定依存監査を一緒に更新する。`npm run verify:importer` と全体checkに加え、Worker・WASM・入出力・プレビューの変更はPages候補とCLIPのブラウザーケース、Windowsの保存境界はRemapのbuildとWebView2で検証する。成功した候補をテスト途中に再生成しない。

Web容量はtools/pages/pages-cache-policy.mjsが所有する。seed許可hash、runtime/file上限、内容・生成物hashの監査を維持し、依存更新だけで予算を自動的に緩めない。

文書セッション導入直後のapp precacheは4,781,998 bytesで、既存上限4,653,056 bytesを超えた。CLIP入出力Workerは従来から操作時にだけ起動するため、固有のclip-document.worker名を付け、プレビューWorker・seed・WASMと同じ必要時の内容hashキャッシュへ分類した。初回のCLIP操作で取得し、その後のオフライン再利用と更新時のhash切り替えを検証する。未使用のCLIP機能が最初からオフラインで使えることは保証しない。

ライブラリの単体・公開API・画像検証、Remapの統合・ブラウザー・WebView2、CSP実機の確認は別の証拠として扱う。新しいCSP実機採取を行わずに完全互換と表現しない。クレジットはTHIRD_PARTY_NOTICES.mdに保持し、ライブラリ側のdocs/provenance.jsonが由来を記録する。各リポジトリの変更は個別にコミットし、外部公開は別の明示依頼がある場合に行う。
