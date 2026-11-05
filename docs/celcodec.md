# celcodecによるCLIP形式処理

CLIPの形式処理はcelcodec **0.8.10**へ集約する。読み込み・プレビュー・保存は公開文書セッションと編集操作を使い、セル・工程・カットの規則、UI、履歴、Worker・WASM・フォントの初期化はこのアプリが担当する。

## 固定した配布依存

依存所有者は [packages/adapters/package.json](../packages/adapters/package.json)。`vendor/celcodec-0.8.10-5638eb4d5a9b.tgz` をリポジトリ内のfile依存として固定する。単独cloneから `npm ci --ignore-scripts` で導入でき、兄弟checkoutの変更や公開レジストリの更新に依存しない。

- 提供元コミット: `2bcecef2546acee59bad349098962a6b62dac972`
- SHA-256: `5638eb4d5a9b360e8ad9cb2618391af68c621649d254d96fbbc005d19bc3ad7b`
- ライブラリ配布内容: 公開JS・型・manifest・README・ライセンス・クレジットの248ファイル。CLIPや採取資料は含まない。

[固定依存の監査](../tools/checks/vendor-celcodec.mjs)がmanifest・lock・tarballの版、hash、ファイル一覧を検査する。symlinkや兄弟checkoutへの依存には切り替えない。

## 文書セッションとアプリの境界

[session.ts](../packages/adapters/src/clip/session.ts)がセッションの入力上限とキャンバス情報の変換を担当する。読み取り・保存・プレビューは各所有者がfinallyまたは明示的なcloseでセッションを解放する。入力bytesを変更しない。

Quick Lookは同一の元データについてWorker内の文書セッションを再利用する。メインスレッドの保存・Undo用データはtransferせず、Workerへ複製された入力だけをborrowする。保持対象は元データ1件で、PNGの完成画像はキャッシュしない。使用していないセッションは30秒で破棄し、元データが64 MiBを超える場合は使用終了時に即座に破棄する。元データ変更、ビューを閉じる、アンマウントでも破棄する。まだ処理中の選択を中止して利用者がいなくなった場合はWorkerを終了し、次の選択を古い処理の後ろに待たせない。

- [reader.ts](../packages/adapters/src/clip/reader.ts): UUID・階層・保存属性・タイムラインをRemapのモデルへ変換する。保存タイミング自体は保持し、整数フレームのシートへ変換できないトラックは診断する。負数と再生範囲外の整数キーは残す。従来のFPS・期間・階層・入力サイズ上限を維持する。
- [registration-writer.ts](../packages/adapters/src/clip/registration-writer.ts): 管理フォルダーとセルの名前空間、再登録、各カットのセル指定を公開操作へ変換する。全タイムラインを作ってから音声を置換し、他カットに明示的な無音トラックを作る。
- [document-writer.ts](../packages/adapters/src/clip/document-writer.ts): 元CLIPの編集差分をrename・属性変更・追加・移動・削除・タイムライン操作へ変換する。未選択トラック、未知ラベル、外部データを保持し、無編集時は入力とバイト一致する。
- [writer.ts](../packages/adapters/src/clip/writer.ts): 読み込みまたは新規作成、planEdits、save、再読込を管理する。画像の整数配置、crop/expand、アプリの安全な書き込み条件を維持する。通常登録は同寸法の画像、文書編集は異なる寸法の追加画像にも対応する。
- [preview.ts](../packages/adapters/src/clip/preview.ts): 素材はprefer-original、フォルダーと動画は保存済み合成を読む。extent予算とvector予約を使い、アプリ側で単独プレビューのマスク・効果・診断を適用する。保存済み合成への効果の二重適用を避ける。OffscreenCanvasとWorkerの所有権はアプリに残す。

ACTION/CEL、工程、カット、入力セル名、対応付け、丸め、Undo/Redoはcoreに残す。celcodec-plan.tsは従来の `xsheet-remap:clip:1:` 名前空間によるUUIDと音声入力の変換だけを担当する。

通常レイヤーをアニメーションフォルダーへ移す既存操作は、ライブラリの `moveLayer.crossAnimationTracks: 'detach'` を明示する。既知トラックの連結を解除し、元の行・ラベル・外部データは残す。ライブラリの既定動作は拒否のまま、未知トラック種類も拒否する。名前によるセル再結合は `celReferences: 'follow-layer-order'` として明示する。ライブラリへRemapの工程モデルを持ち込まない。

## 空テンプレートと旧版の比較

[Worker](../packages/adapters/src/clip/clip-document.worker.ts)は、アプリが従来から保持している `packages/adapters/src/clip/blank.clip` をURLとして読み、createDocumentと編集計画へ渡す。廃止されたcelcodec/blank.clip exportは使わない。既存seedのSHA-256は `6fb3efa8066af90b2d0e042ddc3d2aee7572691e5cc658f89cdb02467e377a82`。今回新しいCLIPや採取値を追加していない。Pagesの内容監査もこの許可済みhashを検査する。

既存の `vendor/celcodec-0.2.0.tgz` は、固定した比較元・fixture生成専用のroot devDependency `celcodec-legacy` として残す。SHA-256は `7b658887da5e7d610f271c163cffa1ce61ec4a01dd65c575e3ae1ceca77764e0`。旧形式の低水準ラッパーはclip/test-support/へ隔離し、製品コードからの旧パッケージ・fixture・test-supportへのimportを構文ベースのarchitecture検査で拒否する。製品は0.8.10だけを使う。

旧writerで作ったCLIPに対して、現行readerとのモデル一致、無編集のバイト一致、セル並べ替え、レイヤー移動、選択タイムラインの編集、画像・音声の保持を検証する。既存のCSP採取値は独立した比較基準として維持する。ベクターの合成テスト用コントロールはネイティブの継続状態を含まないため、ゼロ埋め領域を実際のRNG・間隔リセットとして扱わない。ネイティブ継続記録の検証はライブラリ側の資料庫回帰で行う。

## 共同開発と検証

0.8.10では画像先端の最小幅・方向、押印間隔、紙質の座標・階調の改善を取り込んだ。複数先端・色・未解明入力などの未対応は原因別の案内を表示し、近似診断を維持する。独立CSP採取値による描画回帰は提供側で検証し、Remapの合成テストをその代わりにはしない。

合成ベクターの細線・紙質周期・継続状態のテストは、同じライブラリを使うPaperbackの`4cc3c0ab2cc39f10e9f6b9e546887b8d68ff8ed7`にある`src/test/engine/clip-vector-image.test.ts`と`clip-vector-texture.test.ts`を参照して更新した。ゼロ埋めの合成制御点を保存済み継続状態と扱わず、新しい形状として検証する。既存のCSP画像goldenと許容差は変更しない。

接続・検証・並行作業の正本はcelcodec側のdocs/linked-development.md。consumer名はxsheet-remap、登録時は `--workspace packages/adapters` を指定する。同期はこのconsumerだけを選ぶ。tarballはルートのvendor/、依存指定はfile:../../vendor/...、lockはルートに置く。登録は依存やAPIの移行を意味しない。

更新時は提供側の検証を完了し、tarball・この文書の来歴・固定依存監査を一緒に更新する。`npm run verify:importer` と全体checkに加え、Worker・WASM・入出力・プレビューの変更はPages候補とCLIPのブラウザーケース、Windowsの保存境界はRemapのbuildとWebView2で検証する。成功した候補をテスト途中に再生成しない。

Web容量はtools/pages/pages-cache-policy.mjsが所有する。seed許可hash、runtime/file上限、内容・生成物hashの監査を維持し、依存更新だけで予算を自動的に緩めない。

文書セッション導入直後のapp precacheは4,781,998 bytesで、既存上限4,653,056 bytesを超えた。CLIP入出力Workerは従来から操作時にだけ起動するため、固有のclip-document.worker名を付け、プレビューWorker・seed・WASMと同じ必要時の内容hashキャッシュへ分類した。初回のCLIP操作で取得し、その後のオフライン再利用と更新時のhash切り替えを検証する。未使用のCLIP機能が最初からオフラインで使えることは保証しない。

ライブラリの単体・公開API・画像検証、Remapの統合・ブラウザー・WebView2、CSP実機の確認は別の証拠として扱う。新しいCSP実機採取を行わずに完全互換と表現しない。クレジットはTHIRD_PARTY_NOTICES.mdに保持し、ライブラリ側のdocs/provenance.jsonが由来を記録する。各リポジトリの変更は個別にコミットし、外部公開は別の明示依頼がある場合に行う。

## CSP実機で確認した範囲

2026-11-02にWindowsのCSP EX 5.1.5で、0.7.0移行時のPages候補（0.1.847）の実際の読み込み・編集・保存UIから出力した検証用CLIPを確認した。これは公開版やEXEの追加検証ではない。

CSPで保存済みの64×64、24fps・24コマ、赤青2セルの文書では、Remapで1・5・13コマ目へ指定したセルをCSPで表示できた。CSPの再保存後もレイヤーのUUID・属性・順序、セルのRGBA・配置、トラック・ラベル・セル指定を保持し、CSP書き出し動画の全24コマも赤4・青8・赤12コマで一致した。

CSPで読み込んだ440Hzの検証音をRemapで9コマ目開始・12コマ長に編集したケースでは、CSP再保存・再読み込み後も埋め込み音声と保存タイミングを保持した。CSPだけで同じ移動・トリミングを行った対照と、CSPから書き出したWAVもバイト一致した。波形末尾が区間終端より約8ミリ秒早く無音になる挙動も対照と同じだった。スピーカーからの実音を聴取したという証拠ではない。

初回に残った2件は、未編集入力・旧版出力・現行出力をCSPで比較した。入れ子の工程文書のタイムライン空欄は0.7.0の新規作成だけで発生した。通常フォルダーの祖先トラックが欠けていたため、celcodec 0.7.1で不足分だけを補うよう修正した。既存トラックの内容は保持する。修正出力ではCSPのタイムライン表示と再保存を確認し、CSPの操作で新しく作ったフォルダートラックとの比較をライブラリの回帰テストへ追加した。

修正版0.7.1を取り込んだPages候補（0.1.848）でも、Remapの実UIから音声付き文書と入れ子の工程文書を保存し、CSPで開く・別名保存・閉じる・再読み込みを確認した。音声文書の元8レイヤー、入れ子文書の元11レイヤーと6トラックを保持し、作画Aの1・5・13コマと確認Aの1・9コマを区別して表示した。CSPによる作品情報レイヤーの追加は元レイヤーと分けて記録した。440Hz音声の書き出しも独立対照と再びバイト一致した。両入力のハッシュは変化していない。この最終確認もEXE検証や公開版の検証ではない。

`createMediaFixture`のクラッシュは未編集入力と旧版・現行の両出力すべてで同じ位置に再現した。このfixtureはセルを音声へ差し替え、旧セル参照や素材本体を欠く動画情報を含む解析・保持テスト用の合成データで、正常なCSP文書とは確認されていない。移行による回帰や音声互換性の失敗として数えず、CSP実機確認には正常に保存された対照を使う。クラッシュを起こす最小条件や、すべてのCSP操作で作成不可能な構造かまでは確定していない。

音声対照の準備時には、既存の合成無音素材がCSPの音声追加・保存後、Remapへ渡す前から欠落していることも確認した。この素材は維持成功に数えず、診断の保持と新しくCSPで埋め込んだ検証音の一致を分けて記録した。原本・検証コピー・再保存CLIP・画面・測定結果は非公開のresearch collectionへ保全し、公開ソースへ採取値を追加していない。
