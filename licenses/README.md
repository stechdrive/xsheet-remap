# アプリ内ライセンス情報

`catalog.json`は両アプリの「ヘルプ → ライセンス・謝辞」に組み込むライセンス全文、著作権表示、バージョンと出典です。リリースZIPへ独立したファイルとしてコピーしません。

通常の`npm run check`とGitHub Releaseの公開処理は`npm run check:licenses`を実行します。実行時のnpm依存関係、Windows版のCargo manifest/lock、同梱モデル、補足ライセンスの変更や、本文の欠落・改変を検出します。検証だけならCargoのソースキャッシュは不要です。

依存関係や同梱素材を変更したときは、実際のライセンス条件・著作権表示・出典を確認した上で次の順に更新します。

1. lockfileと一致するnpmパッケージ、および両WindowsアプリのCargo依存ソースを用意します。
2. パッケージに不足する本文や同梱素材の情報は`upstream/`と`supplemental.json`へ追加します。補足本文には取得元を記録し、バージョンまたはコミットを固定します。
3. `node tools/checks/license-notices.mjs --update`でカタログを再生成します。Cargo metadataはWindows x64向けにオフラインで読み取り、ビルドに使う依存関係も収録します。
4. 差分を確認し、`npm run check:licenses`、該当する単体テスト、Pages候補上の`licenses.spec.ts`で表示とオフライン再表示を検証します。

自動収集はパッケージのルートにあるLICENSE/COPYING/NOTICE等を対象にします。同梱WASM・モデルや複数のライセンス条件は別途確認が必要です。形式研究・移植元の謝辞はルートの`THIRD_PARTY_NOTICES.md`を維持します。
