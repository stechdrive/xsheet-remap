xsheet-remap 配布物の使い分け
================================

迷ったら、まず xsheet-remap.exe を起動してください。

■ xsheet-remap.exe
本体アプリです。
紙シートの読込、素材割当、タイミング編集、XDTS・CSP自動登録データの出力に使います。

■ xsheet-corrector.exe
シート画像補正アプリです。
ダブルクリックすると、補正結果を確認しながら処理できます。
画像やカットフォルダをこのEXEへドロップすると、バッチモードで自動PSD出力を開始します。

■ xsheet-csp-import-helper.bat
CSP自動登録ヘルパーです。
本体で「タイムシート/CSP自動登録」を出力した後に使います。
ヘルパー画面で csp-import.xci と対象の .clip を指定し、「開始」を押すとCLIP STUDIO PAINTを自動操作します。

■ assets\xsheet-remap.laf
乗算オートアクションです。アプリではありません。
CLIP STUDIO PAINTのオートアクションパレットから読み込みます。

重要
----
・ZIP全体を展開してから使用してください。
・xsheet-csp-import-helper.bat と csp-import-helper フォルダを分離しないでください。
・csp-import-helper フォルダ内のファイルは直接起動しません。
・csp-import.xci はCLIP STUDIO PAINTへ直接読み込むファイルではありません。
・詳しい操作と事前準備は、各アプリ内のヘルプを確認してください。

Windows SmartScreenが表示されたとき
----------------------------------
この配布物はコード署名されていないため、初回起動時にSmartScreenが表示されます。

1. GitHub ReleasesからダウンロードしたZIPを右クリックし、「プロパティ」を開きます。
2. 「全般」の下部に「許可する」または「ブロックの解除」があればチェックして「適用」を押します。
3. その後、ZIP全体を展開します。
4. 起動時に「WindowsによってPCが保護されました」と表示されたら、「詳細情報」を押します。
5. 表示されたファイル名を確認し、「実行」を押します。

この操作は、次の公式GitHub Releaseから取得したファイルにだけ行ってください。
https://github.com/stechdrive/xsheet-remap/releases/tag/latest

SmartScreenやWindowsのセキュリティ機能を全体で無効にする必要はありません。
