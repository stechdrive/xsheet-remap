// Functional expectations are independent of the input mechanism. Keep the two
// Explorer/OS receipt cases separate from WebView2 protocol interaction.
export const webviewScenarios = [
  ['corrector-entry', 'Correctorからテンプレート編集を開き、名前の編集が下書きに保存される'],
  ['draft-recovery', 'テストで起動した編集プロセスだけを終了して開き直し、下書きを復元できる。Correctorの選択は変わらない'],
  ['remap-entry', 'Remapのメニューからテンプレート編集を開ける。元のシートウィンドウも残る'],
  ['timeline-drag-history', 'タイムラインを移動し、表示更新と1回のUndo/Redoを確認する'],
  ['memo-drag-history', 'MEMO領域を移動し、Undoとキャンバス外でのハンドル非表示を確認する'],
  ['numeric-drag-history', '数値入力後のドラッグが正しい領域に作用し、入力とドラッグを個別にUndoできる'],
  ['quick-look', '登録画像のクイックルックが表示され、Escapeで現在のCLIPツリーへ戻れる'],
  ['layer-assignment-history', '右CLIPツリーからセルへドラッグし、割当と直後のUndo/Redoを確認する。元画像は残る'],
  ['range-outside', '範囲を無効な領域へドラッグして離し、内容と履歴が変わらず次の操作ができる'],
  ['range-history', '範囲移動を確定し、範囲全体が1回のUndo/Redoで戻る。プレビュー中に元データは変わらない'],
  ['mode-return', 'シート編集からCLIP組み立てへ戻っても右CLIPツリーの元レイヤーが保持される'],
]
export const explorerScenarios = [
  ['folder-drop', '通常起動からCLIP組み立てへ切り替え、Explorerのフォルダを右CLIPツリーへ1回ドロップして全画像を登録する'],
  ['multiple-file-drop', 'Explorerで複数画像を選択して1回ドロップし、選択した全ファイルだけが登録される'],
]
export const scenarioApp = id => ['corrector-entry', 'draft-recovery'].includes(id) ? 'corrector' : 'remap'
export const extraWebviewScreenshots = ['corrector-editor', 'recovered-editor', 'quick-look-open',
  'timeline-drag-history-held', 'memo-drag-history-held', 'numeric-drag-history-held', 'range-outside-held', 'range-history-held']
