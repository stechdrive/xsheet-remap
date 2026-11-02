# celcodecによるCLIP形式処理

CLIPの形式処理はローカルのcelcodec 0.2.0へ集約した。セルや工程の規則、出力計画、UI、履歴、Worker・WASM・フォントの初期化はこのアプリが担当する。

監査済みのcelcodec 0.2.0を `vendor/celcodec-0.2.0.tgz` に固定し、リポジトリ内のfile依存として使用する。単独cloneから `npm ci --ignore-scripts` で導入でき、隣の開発用チェックアウトの変更に影響されない。公開レジストリや外部Git参照は不要。tarballとlockfileのハッシュ、版、公開ファイル一覧を契約テストで検査する。

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
