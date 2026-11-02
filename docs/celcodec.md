# celcodecによるCLIP形式処理

CLIPの形式処理はローカルのcelcodec 0.2.0へ集約した。セルや工程の規則、出力計画、UI、履歴、Worker・WASM・フォントの初期化はこのアプリが担当する。

監査済みのcelcodec 0.2.0を `vendor/celcodec-0.2.0.tgz` に固定し、リポジトリ内のfile依存として使用する。単独cloneから `npm ci --ignore-scripts` で導入でき、隣の開発用チェックアウトの変更に影響されない。公開レジストリや外部Git参照は不要。tarballとlockfileのハッシュ、版、公開ファイル一覧を契約テストで検査する。

## 共同開発と移行の入口

接続・検証・並行作業の共通手順は、celcodec側の `docs/linked-development.md` を正本とする。この文書はRemapの固定依存、アプリとの責務、移行時に守る契約を担当する。各checkoutの開発指示、HEAD・branch・status、実際の依存manifestを確認して作業を始める。

consumer名は `xsheet-remap`、依存所有者は [packages/adapters/package.json](../packages/adapters/package.json)。登録時に `--workspace packages/adapters` を指定し、同期はこのconsumerだけを選ぶ。tarballはルートの `vendor/`、依存指定は `file:../../vendor/...`、lockはルートの `package-lock.json` に置く。ルートやcoreへ同じ依存を追加しない。Paperbackのルート依存とは別に扱う。

共同開発への登録と現行APIへの移行は別の作業である。現在の実装は0.2.0の公開入口を使っており、ライブラリ0.7系への更新、文書セッションAPIへの置換、空テンプレートの供給変更は未実施。文書・接続設定だけの変更でtarballや版番号を更新しない。Remap単独の改修は現在の固定依存で検証できる。

今後の移行は、次の境界を確かめながら進める。

1. [reader](../packages/adapters/src/clip/reader.ts)、[writer](../packages/adapters/src/clip/document-writer.ts)、[計画変換](../packages/adapters/src/clip/celcodec-plan.ts)と関連テストを読み、現在の公開型・名前空間・診断・読み書き結果を現行ライブラリの契約と比較する。0.2系の低水準exportがそのまま使えるとは仮定しない。
2. 新しい文書セッションと公開編集操作へアダプターを接続し、ACTION/CELL、工程、カット、入力セル名、対応付け、丸め・配置方針、Undo/Redoはcoreに残す。一般的な形式処理が不足すれば、その契約と回帰をcelcodec側で整える。
3. [Worker](../packages/adapters/src/clip/worker.ts)の `celcodec/blank.clip?url` は0.6以降で廃止されている。利用側が互換テンプレートを供給する方法と通常のテスト・CIの入力を先に具体化する。非公開のローカルテンプレートがあるだけで配布後も動くとは扱わず、新たなCLIP・採取値をGitやパッケージへ追加しない。既存seed・fixtureの扱いも依存箇所と保全先を確認してから決める。
4. 検証済みtarballを同期し、この文書の版・提供元コミット・SHA-256、manifest・lock、[固定依存の監査](../tools/checks/vendor-celcodec.mjs)とそのテストを同じ変更で更新する。現在の監査は0.2.0と旧seed同梱を固定しているため、同期だけでは移行完了にならない。不要な旧tarballは参照がなくなった後に整理する。
5. 関連するCLIPの単体回帰と `npm run verify:importer`、型検査・全体checkを行い、Worker・WASM・プレビュー・入出力に応じてPages候補と対象ブラウザケースを確認する。対象選択は `npm run verify:plan -- --base=<revision>` とローカル指示に従う。native/EXEやCSP実機が必要な変更はそれぞれ別の確認として扱う。

入力不変、無編集保存、変更対象外のトラック・未知ラベル・外部データ、負数・小数を含む保存タイミング、画素・アルファ・配置、キャンセルと資源解放を維持する。独立したCSP採取値と、自作writer/readerの往復は区別する。アプリの上限や命名をライブラリへ移して挙動を変えない。

ライブラリにもコード変更が必要なら同じ作業単位で契約と回帰を修正し、提供側の `dev:finish` を終えてから対象アプリの統合検証を行う。複数登録された他のアプリへ一括同期しない。変更のあるリポジトリだけを個別にコミットし、ライブラリ検証・Remap統合検証・実機確認・配布や公開の状態を分けて記録する。

## 残したアプリ処理

登録計画、ACTION/CELL、工程、カット、セル名/番号、Undo/Redoはcoreに残す。`celcodec-plan.ts`が文書のデータURLをbytesへ変換し、従来の `xsheet-remap:clip:1:` 名前空間と名前正規化を渡す。読み書き、native音声、未知データ保持はcelcodecを使う。

プレビューは `source: prefer-original`、extent512 MiBとvector予約を維持する。OffscreenCanvasとWorkerの所有権はアプリ。Workerの新規seedは `celcodec/blank.clip` から読み込む。ローカルの旧seedは既存fixture用として同じSHA-256を保持する。

## Web容量の確認

初回候補のapp precacheは4,606,159 bytesで、既存予算4,587,520 bytesを18,639 bytes超えた。fflateのdedupeを試しても生成物は同一だったため、その設定は残していない。共通の診断と0100/0110を含む安全な形式処理の分だけ、予算を64 KiB増やして4,653,056 bytesとした。runtime/file上限、seed許可hash、内容監査、生成物hashの検査は維持する。

既存のnative/AE処理には変更がない。CLIP importer相当のテストは全体checkにも含まれ、ブラウザは生成済みPages候補をそのまま使用する。CSP実機の開閉保存は別の確認である。

## 由来と検証

素材の元画像・マスクoffset、文字cache ID/変形後配置、用紙色の解釈は、celcodecに移した既存ネイティブ回帰で確認する。既存の近似・未対応診断は保持する。入力を直接変更せず、無編集保存と未対象データの保持を区別して検証する。

celcodecの単体画像・パッケージ検証とアプリの単体・ブラウザ検証は別記録である。クレジットはTHIRD_PARTY_NOTICES.mdに保持し、ライブラリ側のdocs/provenance.jsonが参照コミット・ファイルhashを記録する。

## 固定した配布依存

celcodec **0.2.0**、コミット `25921e45622824994c7724abcdc5252bc1b0d58d`。
監査済みtarball SHA-256: `7b658887da5e7d610f271c163cffa1ce61ec4a01dd65c575e3ae1ceca77764e0`。
この監査済みtarballのbytesを変更せず同梱する。0.3以降のAPIへの移行とは分け、アプリの既存の読み書き契約を維持する。

2026-10-29の統合検証: 全体checkは2,187件、native境界22件、最終mask/Pages policy関連24件が成功。CLIP preview/layers/processの48件がChromium・WebKitと各touchエミュレーションで成功。検査済みPages候補は `0.1.844-c5df9a2a70f54fec`、755ファイル。後続のコミット用バージョン準備は生成版番号だけを更新し、このWeb候補の再生成とは数えない。CSP実機・配布EXE更新・外部公開は実施していない。
