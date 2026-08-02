from __future__ import annotations

import html


def build_web_gui_html(line_seed_font_css: str, workspace_asset_url: str, olm_peg_hole_stabilizer_url: str) -> str:
    return (
        HTML_TEMPLATE.replace("/* __LINE_SEED_FONT_FACE_CSS__ */", line_seed_font_css)
        .replace("__WORKSPACE_ASSET_URL__", html.escape(workspace_asset_url, quote=True))
        .replace("__OLM_PEG_HOLE_STABILIZER_URL__", html.escape(olm_peg_hole_stabilizer_url, quote=True))
    )


HTML_TEMPLATE = r"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    /* __LINE_SEED_FONT_FACE_CSS__ */
    :root {
      color-scheme: light;
      font-family: "LINE Seed JP", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif;
      background: #eef1f5;
      color: #202633;
      --panel: #ffffff;
      --line: #d8dee8;
      --muted: #667285;
      --text: #202633;
      --blue: #1d63c8;
      --green: #21845a;
      --amber: #c77614;
      --red: #bd382d;
      --ink: #111827;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef1f5; }
    button, input, select { font: inherit; }
    input[type="text"], select { line-height: 1.45; }
    .app { min-height: 100vh; padding: 14px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 12px; }
    .top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .top-actions { display: inline-flex; align-items: center; gap: 8px; }
    h1 { margin: 0; font-size: 20px; line-height: 1.15; letter-spacing: 0; }
    .version { margin-top: 3px; color: var(--muted); font-size: 12px; }
    .badge { min-width: 112px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: 1px solid #cfd7e4; background: #fff; color: #334155; font-weight: 700; font-size: 12px; }
    .badge.running { border-color: #f1bd71; background: #fff6e8; color: #7a4300; }
    .badge.ready { border-color: #a7d2bd; background: #ebf8f0; color: #145f3c; }
    .badge.error { border-color: #efb2ab; background: #fff0ef; color: #8f2219; }
    .workspace { min-height: 0; display: grid; grid-template-columns: minmax(420px, 1.1fr) minmax(330px, .9fr); gap: 12px; }
    .column { min-width: 0; display: grid; gap: 12px; align-content: start; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; box-shadow: 0 1px 2px rgba(20, 28, 40, .05); }
    .panel-title { margin: 0 0 10px; font-size: 13px; color: #3a4556; font-weight: 800; }
    .drop-stack { display: grid; gap: 8px; }
    .drop-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 58px; padding: 10px; background: #f8fafc; border: 1px solid #e0e6ef; border-radius: 8px; }
    .drop-card.ready { background: #f5fbf8; border-color: #b8dcca; }
    .drop-active .drop-card { border-color: var(--blue); box-shadow: 0 0 0 2px rgba(29, 99, 200, .14); }
    .file-kind { color: #3b4657; font-size: 12px; font-weight: 800; }
    .path { margin-top: 4px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .path.empty { color: #8a94a5; }
    .save-row { margin-top: 10px; display: grid; grid-template-columns: 86px minmax(0, 1fr) auto; gap: 8px; align-items: center; }
    .label { color: #3a4556; font-weight: 800; font-size: 13px; }
    select, input[type="text"] { height: 32px; border: 1px solid #cbd4e1; border-radius: 6px; padding: 4px 8px; background: #fff; color: var(--text); min-width: 0; }
    button { height: 32px; padding: 0 12px; border: 1px solid #c5cedd; background: #fff; border-radius: 6px; color: #202838; cursor: pointer; font-weight: 700; }
    button:hover:not(:disabled) { background: #f3f6fa; }
    button:disabled { opacity: .45; cursor: default; }
    button.primary { background: var(--blue); border-color: var(--blue); color: #fff; }
    button.primary:hover:not(:disabled) { background: #174f9f; }
    button.stop { color: #9d1b1b; border-color: #e1b8b8; background: #fffafa; }
    .icon-button { width: 32px; min-width: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .icon-button svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .metric { min-height: 64px; padding: 9px 10px; border: 1px solid #e0e6ef; border-radius: 8px; background: #fbfcfe; }
    .metric-label { color: var(--muted); font-size: 11px; font-weight: 800; }
    .metric-value { margin-top: 4px; color: var(--ink); font-size: 24px; line-height: 1; font-weight: 800; font-variant-numeric: tabular-nums; }
    .cuts { margin-top: 10px; color: #566173; min-height: 20px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .option-grid { display: grid; grid-template-columns: minmax(0, 1fr) 176px; gap: 8px; align-items: center; }
    .option-grid #speed { width: 100%; }
    .check { min-width: 0; display: flex; align-items: center; gap: 6px; white-space: normal; color: #303a4c; }
    .actions { margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .progress-shell { display: grid; gap: 10px; }
    .progress-head { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .stream { position: relative; width: 98px; height: 22px; overflow: hidden; border-radius: 6px; background: #f3f6fa; border: 1px solid #e0e6ef; color: var(--amber); font-family: "LINE Seed JP", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif; font-weight: 800; }
    .stream::before { content: ">>>"; position: absolute; top: 1px; left: -34px; opacity: 0; animation: stream 1.05s linear infinite; }
    .stream.idle::before { animation: none; opacity: 0; }
    @keyframes stream { 0% { transform: translateX(0); opacity: 0; } 8% { opacity: 1; } 74% { opacity: 1; } 100% { transform: translateX(132px); opacity: 0; } }
    .status { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { color: #596579; font-variant-numeric: tabular-nums; font-weight: 800; }
    .blocks { height: 20px; display: grid; gap: 2px; }
    .block { background: #e5ebf3; border-radius: 2px; overflow: hidden; position: relative; }
    .block.done { background: var(--blue); }
    .block.active { background: #f2bb46; }
    .block.error { background: var(--red); }
    .block.active::after { content: ""; position: absolute; inset: 2px auto 2px 0; width: 34%; background: rgba(255,255,255,.65); animation: sweep .9s linear infinite; }
    @keyframes sweep { from { transform: translateX(-120%); } to { transform: translateX(320%); } }
    .detail { color: #3f4a5c; min-height: 21px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .error-reason { display: none; max-height: 168px; overflow: auto; padding: 8px 10px; border: 1px solid #efb2ab; border-left-width: 4px; border-radius: 6px; background: #fff8f7; color: #651f18; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .error-reason.show { display: block; }
    .error-reason-label { display: block; margin-bottom: 3px; color: #8f2219; font-size: 11px; font-weight: 800; }
    .logs { min-height: 58px; padding: 8px 10px; background: #f8fafc; border: 1px solid #e0e6ef; border-radius: 6px; color: #354052; white-space: pre-line; line-height: 1.45; }
    .footer { color: #8a1f11; font-weight: 800; background: #fff4d6; border: 1px solid #efd28a; border-radius: 6px; padding: 8px 10px; line-height: 1.45; white-space: pre-line; }
    .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(14, 22, 35, .35); align-items: center; justify-content: center; padding: 24px; }
    .modal-backdrop.show { display: flex; }
    .modal { width: min(720px, 100%); max-height: calc(100vh - 48px); overflow: auto; background: #fff; border-radius: 8px; border: 1px solid #d4dbe7; box-shadow: 0 12px 36px rgba(0,0,0,.22); padding: 16px; }
    .modal h2 { margin: 0 0 12px; font-size: 17px; }
    .help-modal { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; width: min(860px, 100%); padding: 0; overflow: hidden; }
    .help-modal header, .help-modal footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e1e6ef; }
    .help-modal footer { display: block; border-top: 1px solid #e1e6ef; border-bottom: 0; }
    .help-modal header div { min-width: 0; }
    .help-modal header .icon-button { flex: 0 0 auto; align-self: flex-start; }
    .help-modal h2 { margin: 0 0 3px; }
    .help-modal header p, .help-modal footer p { margin: 0; color: #607086; font-size: 12px; line-height: 1.5; }
    .help-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid #e1e6ef; background: #f8fafc; }
    .help-tab { height: 36px; border: 0; border-bottom: 3px solid transparent; border-radius: 6px 6px 0 0; background: transparent; color: #5a687c; }
    .help-tab[aria-selected="true"] { border-bottom-color: var(--blue); background: #fff; color: #174f9f; }
    .help-panel { min-height: 0; overflow: auto; }
    .help-panel[hidden] { display: none; }
    .help-panel-detailed { overflow: hidden; }
    .help-content { display: grid; gap: 10px; padding: 14px 16px; }
    .help-lead { padding: 12px; border-radius: 8px; background: #eef5ff; color: #26364d; font-size: 12px; line-height: 1.6; }
    .help-manual { display: grid; grid-template-columns: 230px minmax(0, 1fr); height: 100%; min-height: 0; }
    .help-toc { min-height: 0; overflow: auto; padding: 12px; border-right: 1px solid #e1e6ef; background: #f8fafc; }
    .help-toc > div { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 9px; color: #536176; font-size: 11px; }
    .help-toc > div strong { color: #1f2a3a; font-size: 12px; }
    .help-toc nav { display: grid; gap: 4px; }
    .help-chapter-button { height: auto; min-height: 34px; padding: 7px 9px; border-color: transparent; background: transparent; color: #445268; text-align: left; line-height: 1.35; }
    .help-chapter-button[aria-current="page"] { border-color: #b8c9e4; background: #eef5ff; color: #174f9f; }
    .help-chapter-button span { display: inline-block; width: 26px; color: #6b788a; font-size: 10px; }
    .help-chapters { min-height: 0; overflow: auto; align-content: start; }
    .help-chapter[hidden] { display: none; }
    .help-section { padding: 12px; border: 1px solid #dce3ed; border-radius: 8px; background: #fbfcfe; }
    .help-section.warning { border-color: #e5c572; background: #fffaf0; }
    .help-section h3 { margin: 0 0 6px; color: #1f2a3a; font-size: 14px; }
    .help-section p { margin: 0 0 8px; color: #4d5b70; font-size: 12px; line-height: 1.55; }
    .help-section ol, .help-section ul { display: grid; gap: 7px; margin: 0; padding-left: 22px; }
    .help-section li { color: #303a4c; font-size: 12px; line-height: 1.55; }
    .help-section li.critical, .help-section li.critical strong { color: #8a1f11; }
    .help-section li::marker { color: var(--blue); font-weight: 800; }
    .help-section strong { color: #172033; }
    .help-links { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 0; }
    .help-link { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border: 1px solid #b8c9e4; border-radius: 6px; background: #f5f9ff; color: #174f9f; font-size: 12px; font-weight: 800; text-decoration: none; }
    .help-link:hover { background: #edf4ff; }
    .help-link::after { content: "↗"; font-size: 11px; line-height: 1; }
    .help-inline-link { color: #174f9f; text-decoration: underline; text-underline-offset: 2px; }
    .help-inline-link:hover { color: #0d3d82; }
    .shortcut-grid { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 8px 12px; align-items: center; }
    .shortcut-grid input { width: 180px; }
    .shortcut-grid input.capturing { border-color: var(--blue); box-shadow: 0 0 0 2px rgba(29,95,209,.16); }
    .modal-footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; }
    @media (max-width: 820px) {
      .workspace { grid-template-columns: 1fr; }
      .save-row { grid-template-columns: 1fr; }
      .option-grid, .actions { grid-template-columns: 1fr; }
      .help-manual { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
      .help-toc { overflow: hidden; border-right: 0; border-bottom: 1px solid #e1e6ef; }
      .help-toc > div { margin-bottom: 6px; }
      .help-toc nav { display: flex; overflow-x: auto; }
      .help-chapter-button { flex: 0 0 auto; white-space: nowrap; }
    }
  </style>
</head>
<body>
  <main class="app" id="app">
    <section class="top">
      <div>
        <h1>xsheet-importer</h1>
        <div class="version" id="version"></div>
      </div>
      <div class="top-actions">
        <button class="icon-button" id="helpButton" type="button" aria-label="ヘルプを開く" title="ヘルプ">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"></path>
            <path d="M12 17h.01"></path>
          </svg>
        </button>
        <div class="badge" id="runBadge">待機中</div>
      </div>
    </section>

    <section class="workspace">
      <div class="column">
        <section class="panel">
          <h2 class="panel-title">入力ファイル</h2>
          <div class="drop-stack">
            <div class="drop-card" id="manifestCard" title="xsheet-remapの「CSP自動登録データを書き出す」で作成した .xci を指定します。">
              <div>
                <div class="file-kind">CSP自動登録ファイル (.xci)</div>
                <div class="path empty" id="manifestPath"></div>
              </div>
              <button id="chooseManifest">選択</button>
            </div>
            <div class="drop-card" id="clipCard" title="操作対象のクリスタファイルを指定します。">
              <div>
                <div class="file-kind">クリスタファイル (.clip)</div>
                <div class="path empty" id="clipPath"></div>
              </div>
              <button id="chooseClip">選択</button>
            </div>
          </div>
          <div class="save-row">
            <div class="label">保存先</div>
            <input id="savePath" type="text" title="処理完了後に別名保存するCLIPファイルです。ファイル名込みで指定します。">
            <button id="chooseSave">変更</button>
          </div>
        </section>

        <section class="panel">
          <h2 class="panel-title">工程</h2>
          <div class="progress-shell">
            <div class="progress-head">
              <div class="stream idle" id="activity"></div>
              <div class="status" id="progressStatus">待機中</div>
              <div class="count" id="progressCount">0 / 0</div>
            </div>
            <div class="blocks" id="blocks"></div>
            <div class="detail" id="progressDetail"></div>
            <div class="error-reason" id="progressErrorReason"><span class="error-reason-label">停止理由</span><span id="progressErrorReasonText"></span></div>
            <div class="logs" id="progressLogs"></div>
          </div>
        </section>
      </div>

      <div class="column">
        <section class="panel">
          <h2 class="panel-title">読み込み内容</h2>
          <div class="metrics">
            <div class="metric"><div class="metric-label">カット</div><div class="metric-value" id="metricCuts">0</div></div>
            <div class="metric"><div class="metric-label">素材</div><div class="metric-value" id="metricAssets">0</div></div>
            <div class="metric"><div class="metric-label">セル列</div><div class="metric-value" id="metricTracks">0</div></div>
          </div>
          <div class="cuts" id="cutSummary"></div>
        </section>

        <section class="panel">
          <h2 class="panel-title">実行</h2>
          <div class="option-grid">
            <label class="check"><input id="closeAfterSave" type="checkbox">保存後にCLIPを閉じる</label>
            <select id="speed" title="通常は最速を推奨します。失敗時はCLIPを初期状態へ戻し、高速または標準で再実行してください。">
              <option value="turbo">最速（推奨）</option>
              <option value="fast">高速</option>
              <option value="standard">標準（安定優先）</option>
            </select>
          </div>
          <div class="actions">
            <button id="profileButton" title="クリスタ側ショートカットとヘルパー設定を合わせます。">設定</button>
            <button class="primary" id="startButton">開始</button>
            <button class="stop" id="cancelButton">停止</button>
          </div>
        </section>

        <button id="closeButton">終了</button>
      </div>
    </section>

    <section class="footer" id="emergency">自動登録中はマウス・キーボード操作禁止。クリスタを前面のままにしてください。
既存のアニメーションフォルダーは全て非表示、または親フォルダを非表示にしてから開始してください。
非常停止: Ctrl+Alt+F12 / Ctrl+Alt+Pause</section>
  </main>

  <div class="modal-backdrop" id="helpModal">
    <div class="modal help-modal" role="dialog" aria-modal="true" aria-label="xsheet-importerの使い方">
      <header>
        <div>
          <h2>xsheet-importerの使い方</h2>
          <p>CSPはCLIP STUDIO PAINT、つまりクリスタのことです。このアプリはクリスタを自動操作して、XDTSと画像素材を組み込みます。</p>
        </div>
        <button class="icon-button" id="helpClose" type="button" aria-label="ヘルプを閉じる" title="閉じる">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M18 6 6 18"></path>
            <path d="m6 6 12 12"></path>
          </svg>
        </button>
      </header>
      <div class="help-tabs" role="tablist" aria-label="ヘルプの表示">
        <button class="help-tab" id="helpQuickTab" type="button" role="tab" aria-selected="true" aria-controls="helpQuickPanel">クイックガイド</button>
        <button class="help-tab" id="helpDetailedTab" type="button" role="tab" aria-selected="false" aria-controls="helpDetailedPanel">詳しい使い方</button>
      </div>
      <div class="help-panel" id="helpQuickPanel" role="tabpanel" aria-labelledby="helpQuickTab">
        <div class="help-content">
          <div class="help-lead">目的は、xsheet-remap / Editorで決めたタイミングと画像素材を、指定したCLIPへまとめて登録することです。初回準備が済んでいれば、毎回の操作は次の5手順です。</div>
          <section class="help-section">
            <h3>すぐ登録する5手順</h3>
            <ol>
              <li><strong>初回だけ、クリスタのワークスペース、オートアクション、ショートカットを合わせます。</strong> すでに設定済みなら次へ進みます。</li>
              <li><strong>xsheet-remapまたはEditorで「CSP自動登録データを書き出す」を実行します。</strong> PWA版のZIPは展開し、中にあるcsp-import.xciを使います。</li>
              <li><strong>csp-import.xciと登録先の.clipを選びます。</strong> 2ファイルを同時にこのウィンドウへドロップしても構いません。</li>
              <li><strong>保存先、カット・素材・セル列の件数を確認します。</strong> 登録先CLIPのアニメーションフォルダーを非表示にし、タイムライン編集を有効にします。速度は通常「最速（推奨）」のままで開始できます。</li>
              <li><strong>「開始」を押し、完了までマウスとキーボードに触れません。</strong> 終了後、保存されたCLIPを開いてタイムラインと素材を確認します。</li>
            </ol>
          </section>
          <section class="help-section warning">
            <h3>開始できない／途中で止まったら</h3>
            <ul>
              <li>「開始」が押せないときは、.xci、.clip、ファイル名を含む保存先の3点を確認します。</li>
              <li>途中で止まったときは、処理前のCLIPへ戻してから再実行します。入力の速さが原因なら「高速」、それでも不安定なら「標準」を選びます。</li>
              <li>画面の「停止」は操作できるときに使います。クリスタが前面で戻れないときはCtrl+Alt+F12またはCtrl+Alt+Pauseで停止を要求します。</li>
            </ul>
          </section>
        </div>
      </div>
      <div class="help-panel help-panel-detailed" id="helpDetailedPanel" role="tabpanel" aria-labelledby="helpDetailedTab" hidden>
        <div class="help-manual">
          <aside class="help-toc">
            <div><strong>詳しい使い方</strong><span>全9章</span></div>
            <nav aria-label="xsheet-importerの詳しい使い方の目次">
              <button class="help-chapter-button" type="button" data-help-chapter-target="0" aria-current="page"><span>01</span>このアプリで得られるもの</button>
              <button class="help-chapter-button" type="button" data-help-chapter-target="1"><span>02</span>初回だけのCSP準備</button>
              <button class="help-chapter-button" type="button" data-help-chapter-target="2"><span>03</span>自動登録データの作成</button>
              <button class="help-chapter-button" type="button" data-help-chapter-target="3"><span>04</span>入力ファイルと保存先</button>
              <button class="help-chapter-button" type="button" data-help-chapter-target="4"><span>05</span>読み込み内容と複数カット</button>
              <button class="help-chapter-button" type="button" data-help-chapter-target="5"><span>06</span>速度・終了・設定</button>
              <button class="help-chapter-button" type="button" data-help-chapter-target="6"><span>07</span>実行前確認・進行・停止</button>
              <button class="help-chapter-button" type="button" data-help-chapter-target="7"><span>08</span>完了確認と再実行</button>
              <button class="help-chapter-button" type="button" data-help-chapter-target="8"><span>09</span>紙素材の準備</button>
            </nav>
          </aside>
          <main class="help-content help-chapters">
          <section class="help-section help-chapter" data-help-chapter="0">
            <h3>01｜このアプリで得られるもの</h3>
            <p>xsheet-importerはクリスタを自動操作し、各カットのXDTS、セル列ごとの画像素材、保存までを一続きで行います。csp-import.xciは登録内容を伝えるxsheet-importer用ファイルで、クリスタへ直接読み込むファイルではありません。</p>
            <ul>
              <li>「入力ファイル」で登録内容の.xciと登録先.clip、「保存先」で結果を残す別名保存先を決めます。</li>
              <li>「読み込み内容」のカット・素材・セル列とタイムライン名で、始める前に対象を確認できます。</li>
              <li>「工程」には現在の作業、完了数、停止理由が出ます。進まないときの判断材料にしてください。</li>
            </ul>
          </section>
          <section class="help-section help-chapter" data-help-chapter="1" hidden>
            <h3>02｜初回のみ：クリスタ側の準備</h3>
            <p>xsheet-remap用ワークスペースをAssetsからダウンロードします。クリスタの［ウィンドウ］＞［素材］から素材パレットを表示し、ダウンロードしたワークスペースをキャンバスへドラッグ＆ドロップして読み込みます。</p>
            <div class="help-links">
              <a class="help-link external-link" href="__WORKSPACE_ASSET_URL__" data-external-url="__WORKSPACE_ASSET_URL__" target="_blank" rel="noopener noreferrer">ワークスペースをAssetsで開く</a>
            </div>
            <ul>
              <li>同梱のassets/xsheet-remap.lafを使う場合は、オートアクションパレットのメニューから「オートアクションセットを読み込み」を選び、xsheet-remap.lafを読み込みます。</li>
              <li>乗算オートアクションを読み込んだ後、ファイル &gt; ショートカットキー設定から、設定領域 &gt; オートアクションを選び、読み込んだxsheet-remapオートアクションの「乗算」にCtrl+Alt+Lを割り当てます。ワークスペース読み込みだけではオートアクションのショートカットは自動設定されません。</li>
              <li>同じ内容のオートアクションを自分で作っている場合も、「設定」の「乗算オートアクション」と同じショートカットなら使えます。</li>
            </ul>
          </section>
          <section class="help-section help-chapter" data-help-chapter="2" hidden>
            <h3>03｜CSP自動登録データを作る</h3>
            <p>xsheet-remapまたはEditorで「CSP自動登録データを書き出す」を実行します。</p>
            <ul>
              <li>デスクトップ版は、カットフォルダ内のxsheet-csp-importへcsp-import.xciとXDTSを作り、画像素材は元のカットフォルダを参照します。</li>
              <li>PWA版ではZIP内にcsp-import.xci、XDTS、取得できた実際の画像素材がまとめられます。ZIPを展開してからcsp-import.xciを選びます。</li>
            </ul>
          </section>
          <section class="help-section help-chapter" data-help-chapter="3" hidden>
            <h3>04｜入力ファイルと保存先</h3>
            <ol>
              <li><strong>xsheet-importer用ファイル(.xci)と操作対象のクリスタファイル(.clip)を選びます。</strong> 個別に「選択」を押すほか、両方を同時にウィンドウへドロップできます。</li>
              <li><strong>保存先を確認します。</strong> .xciを読み込むと候補が入ります。必要なら「変更」を押し、ファイル名込みの.clipパスにします。フォルダだけでは保存できません。</li>
              <li><strong>処理後に作業中のCLIPファイルも閉じる場合だけ「保存後にCLIPを閉じる」をオンにします。</strong> 続けて結果を確認するならオフにします。</li>
            </ol>
          </section>
          <section class="help-section help-chapter" data-help-chapter="4" hidden>
            <h3>05｜読み込まれる内容と複数カット</h3>
            <p>「読み込み内容」でカット数、画像素材数、セル列数を照合します。複数カットの.xciでは、カットごとにタイムラインを作成して名前を付け、それぞれのXDTSを読み込みます。その後、画像素材をセル列ごとに登録します。</p>
            <p>想定と件数やタイムライン名が違うときは開始せず、xsheet-remap / Editor側の有効なカットと素材割り当てを直して書き出し直します。</p>
          </section>
          <section class="help-section help-chapter" data-help-chapter="5" hidden>
            <h3>06｜速度・終了方法・ショートカット設定</h3>
            <ul>
              <li>通常は「最速」を使います。選んだ速度は次回にも引き継がれます。失敗したら処理前のCLIPへ戻し、「高速」または「標準」で最初から再実行します。</li>
              <li>「設定」には自動操作で使う13種類のショートカットがあります。各欄を選び、クリスタ側で割り当てた実際のキーを押して入力し、「適用」で保存します。迷ったときは「ショートカットを既定に戻す」を使います。</li>
              <li>「アニメーションフォルダを乗算にする」をオンにすると、登録した各フォルダーへ乗算オートアクションを実行します。必要なときだけオンにし、対応するクリスタ側ショートカットも合わせます。</li>
            </ul>
          </section>
          <section class="help-section warning help-chapter" data-help-chapter="6" hidden>
            <h3>07｜実行前確認・進行・停止</h3>
            <ul>
              <li class="critical"><strong>最重要：素材の自動登録先となるCLIPファイル内で、既存のアニメーションフォルダーがすべて非表示になるようにしてください。</strong> アニメーションフォルダーを1つずつ非表示にする必要はありません。それらを含む親フォルダーを非表示にしても構いません。表示されたままのアニメーションフォルダーがあると、自動登録時のフォルダーの積み込みが崩れます。</li>
              <li><strong>同じCLIPファイルで、タイムライン編集が有効になっていることを確認してください。</strong> xsheet-importerはタイムライン編集が有効な状態を前提に処理を開始します。</li>
              <li>クリスタは起動していなくても構いません。起動済みなら作業対象以外のドキュメントを閉じ、確認・保存などのダイアログがない状態にします。.clipファイルをダブルクリックしてクリスタで開ける状態なら、インストール先は問いません。</li>
              <li><strong>自動登録中はマウス・キーボードを触らないでください。</strong> クリスタを前面にして自動操作するため、別の入力をすると操作先がずれます。</li>
              <li>画面の「停止」は、次の安全なチェック地点で止める通常の方法です。クリスタが前面でボタンへ戻れないときは、Ctrl+Alt+F12またはCtrl+Alt+Pauseで同じ停止要求を送れます。</li>
            </ul>
          </section>
          <section class="help-section help-chapter" data-help-chapter="7" hidden>
            <h3>08｜完了確認と失敗時のやり直し</h3>
            <ul>
              <li>完了後は保存された.clipを開き、セル名、各カットのタイムライン、BG/BOOK、撮影指示、メモの積み順を確認します。</li>
              <li>不明なクリスタのモーダルが出た場合、xsheet-importerは無理に進めず停止します。停止理由とクリスタ画面を確認し、原因を解消します。</li>
              <li>失敗後の途中状態から続けず、処理前のCLIPを使って最初から再実行します。操作待ちが原因なら速度を一段ずつ下げます。</li>
            </ul>
          </section>
          <section class="help-section help-chapter" data-help-chapter="8" hidden>
            <h3>09｜紙で作画された素材を扱うときのTips</h3>
            <p>紙で作画された素材は、スキャン後にタップ穴を基準に位置を揃えておくと、クリスタへ登録した際の位置が安定します。</p>
            <ol>
              <li><strong>Kodakのドキュメントスキャナで登録画像をスキャンします。</strong> 紙シート、動画用紙、セル画像は同じ前提のスキャン画像として扱います。</li>
              <li><strong><a class="help-inline-link external-link" href="__OLM_PEG_HOLE_STABILIZER_URL__" data-external-url="__OLM_PEG_HOLE_STABILIZER_URL__" target="_blank" rel="noopener noreferrer">OLMペグホールスタビライザー</a>でタップ穴基準に位置合わせします。</strong> オートフィードで生じたタップ穴のずれを、登録前にまとめて補正できます。</li>
            </ol>
          </section>
          </main>
        </div>
      </div>
      <footer>
        <p>csp-import.xciはxsheet-importer用の登録ファイルであり、クリスタへ直接読み込むファイルではありません。必ずxsheet-importerから実行してください。</p>
      </footer>
    </div>
  </div>

  <div class="modal-backdrop" id="profileModal">
    <div class="modal">
      <h2>ショートカット設定</h2>
      <div class="shortcut-grid" id="shortcutGrid"></div>
      <label class="check" style="margin-top:12px;"><input id="setMultiply" type="checkbox">アニメーションフォルダを乗算にする</label>
      <div class="modal-footer">
        <button id="resetShortcuts">ショートカットを既定に戻す</button>
        <div>
          <button id="profileCancel">キャンセル</button>
          <button class="primary" id="profileSave">適用</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const state = { latest: null, profileFields: [], dragDepth: 0 };
    const $ = (id) => document.getElementById(id);

    function invoke(name, ...args) {
      return window.pywebview.api[name](...args).then(applyState);
    }

    function pathClass(value, hint) {
      return value && value !== hint ? "path" : "path empty";
    }

    function applyState(next) {
      if (!next) return;
      state.latest = next;
      $("version").textContent = `v${next.version}`;
      renderBadge(next);
      renderFiles(next);
      renderMetrics(next);
      renderControls(next);
      renderProgress(next.progress || {});
    }
    window.xsheetApplyState = applyState;

    function renderBadge(next) {
      const badge = $("runBadge");
      const progress = next.progress || {};
      const text = progress.error ? "要確認" : (next.running ? "実行中" : (next.canStart ? "準備完了" : "待機中"));
      badge.textContent = text;
      badge.className = `badge ${progress.error ? "error" : next.running ? "running" : next.canStart ? "ready" : ""}`;
    }

    function renderFiles(next) {
      const metrics = next.metrics || {};
      const manifestReady = (metrics.cuts || 0) > 0;
      const clipReady = !!next.clipPath;
      $("manifestPath").textContent = next.manifestPathDisplay || "";
      $("manifestPath").className = pathClass(next.manifestPathDisplay, ".xci をドロップ、または選択");
      $("manifestCard").classList.toggle("ready", manifestReady);
      $("clipPath").textContent = next.clipPathDisplay || "";
      $("clipPath").className = pathClass(next.clipPathDisplay, ".clip をドロップ、または選択");
      $("clipCard").classList.toggle("ready", clipReady);
      $("savePath").value = next.savePath || "";
      $("cutSummary").textContent = next.cutSummary || "";
    }

    function renderMetrics(next) {
      const metrics = next.metrics || {};
      $("metricCuts").textContent = metrics.cuts || 0;
      $("metricAssets").textContent = metrics.assets || 0;
      $("metricTracks").textContent = metrics.tracks || 0;
    }

    function renderControls(next) {
      $("closeAfterSave").checked = !!next.closeAfterSave;
      $("speed").value = next.speedMode || "standard";
      $("startButton").disabled = !next.canStart;
      $("cancelButton").disabled = !next.running;
      $("chooseManifest").disabled = !!next.running;
      $("chooseClip").disabled = !!next.running;
      $("chooseSave").disabled = !!next.running;
      $("savePath").disabled = !!next.running;
      $("profileButton").disabled = !!next.running;
      $("helpButton").disabled = !!next.running;
      const emergency = next.emergencyStatus || "非常停止: Ctrl+Alt+F12 / Ctrl+Alt+Pause";
      $("emergency").textContent = `自動登録中はマウス・キーボード操作禁止。クリスタを前面のままにしてください。\n既存のアニメーションフォルダーは全て非表示、または親フォルダを非表示にしてから開始してください。\n${emergency}`;
    }

    function renderProgress(progress) {
      $("progressStatus").textContent = progress.status || "待機中";
      $("progressDetail").textContent = progress.detail || "";
      const errorReason = progress.errorReason || "";
      $("progressErrorReason").classList.toggle("show", !!errorReason);
      $("progressErrorReasonText").textContent = errorReason;
      $("progressErrorReason").title = errorReason;
      $("progressCount").textContent = `${progress.done || 0} / ${progress.total || 0}`;
      $("progressLogs").textContent = (progress.logs || []).join("\n") || "";
      $("activity").classList.toggle("idle", !progress.activity);
      renderBlocks(progress);
    }

    function renderBlocks(progress) {
      const total = progress.total || 0;
      const done = progress.done || 0;
      const blocks = $("blocks");
      blocks.style.gridTemplateColumns = total ? `repeat(${total}, minmax(4px, 1fr))` : "1fr";
      blocks.innerHTML = "";
      if (!total) {
        const block = document.createElement("div");
        block.className = "block";
        blocks.appendChild(block);
        return;
      }
      for (let i = 0; i < total; i += 1) {
        const block = document.createElement("div");
        let cls = "block";
        if (progress.error && i >= done) cls += " error";
        else if (i < done) cls += " done";
        else if (i === done && progress.activity) cls += " active";
        block.className = cls;
        blocks.appendChild(block);
      }
    }

    function syncOptions() {
      if (!state.latest || state.latest.running) return;
      invoke("set_options", {
        closeAfterSave: $("closeAfterSave").checked,
        speedMode: $("speed").value,
        savePath: $("savePath").value,
      });
    }

    function shortcutFromEvent(event) {
      if (event.metaKey) return null;
      const key = event.key;
      const modifierOnly = ["Control", "Shift", "Alt", "Meta", "OS"].includes(key);
      if (modifierOnly) return null;
      if (!event.ctrlKey && !event.shiftKey && !event.altKey) return null;
      const parts = [];
      if (event.ctrlKey) parts.push("Ctrl");
      if (event.shiftKey) parts.push("Shift");
      if (event.altKey) parts.push("Alt");
      const names = { " ": "SPACE", "Escape": "ESC", "Enter": "ENTER", "ArrowUp": "UP", "ArrowDown": "DOWN", "ArrowLeft": "LEFT", "ArrowRight": "RIGHT", "PageUp": "PAGEUP", "PageDown": "PAGEDOWN" };
      const displayKey = names[key] || key.toUpperCase();
      if (!displayKey || displayKey.length > 16) return null;
      parts.push(displayKey);
      return parts.join("+");
    }

    async function openProfileModal() {
      const settings = await window.pywebview.api.get_profile_settings();
      state.profileFields = settings.fields || [];
      const grid = $("shortcutGrid");
      grid.innerHTML = "";
      for (const field of state.profileFields) {
        const label = document.createElement("label");
        label.textContent = field.label;
        const input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        input.dataset.key = field.key;
        input.dataset.defaultValue = field.defaultValue || "";
        input.value = field.value || "";
        input.addEventListener("focus", () => input.classList.add("capturing"));
        input.addEventListener("blur", () => input.classList.remove("capturing"));
        input.addEventListener("keydown", (event) => {
          event.preventDefault();
          const shortcut = shortcutFromEvent(event);
          if (shortcut) input.value = shortcut;
        });
        grid.appendChild(label);
        grid.appendChild(input);
      }
      $("setMultiply").checked = !!settings.setMultiply;
      $("profileModal").classList.add("show");
    }

    function closeProfileModal() {
      $("profileModal").classList.remove("show");
    }

    function setHelpView(view) {
      const showDetailed = view === "detailed";
      $("helpQuickTab").setAttribute("aria-selected", String(!showDetailed));
      $("helpDetailedTab").setAttribute("aria-selected", String(showDetailed));
      $("helpQuickPanel").hidden = showDetailed;
      $("helpDetailedPanel").hidden = !showDetailed;
    }

    function setHelpChapter(index) {
      const chapterIndex = String(index);
      document.querySelectorAll("[data-help-chapter-target]").forEach((button) => {
        if (button.dataset.helpChapterTarget === chapterIndex) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      document.querySelectorAll("[data-help-chapter]").forEach((chapter) => {
        chapter.hidden = chapter.dataset.helpChapter !== chapterIndex;
      });
      $("helpDetailedPanel").querySelector(".help-chapters").scrollTop = 0;
    }

    function openHelpModal() {
      setHelpView("quick");
      setHelpChapter(0);
      $("helpModal").classList.add("show");
      $("helpQuickTab").focus();
    }

    function closeHelpModal() {
      $("helpModal").classList.remove("show");
    }

    async function openExternalLink(event) {
      const url = event.currentTarget.dataset.externalUrl;
      if (!url) return;
      event.preventDefault();
      try {
        await window.pywebview.api.open_external_url(url);
      } catch (_error) {
        window.open(url, "_blank", "noopener");
      }
    }

    async function saveProfileModal() {
      const shortcuts = {};
      document.querySelectorAll("#shortcutGrid input").forEach((input) => {
        shortcuts[input.dataset.key] = input.value;
      });
      const next = await window.pywebview.api.save_profile_settings({
        shortcuts,
        setMultiply: $("setMultiply").checked,
      });
      closeProfileModal();
      applyState(next);
    }

    function resetProfileFields() {
      document.querySelectorAll("#shortcutGrid input").forEach((input) => {
        input.value = input.dataset.defaultValue || "";
      });
    }

    function bindUi() {
      $("chooseManifest").addEventListener("click", () => invoke("choose_manifest"));
      $("chooseClip").addEventListener("click", () => invoke("choose_clip"));
      $("chooseSave").addEventListener("click", () => invoke("choose_save_path"));
      $("closeAfterSave").addEventListener("change", syncOptions);
      $("speed").addEventListener("change", syncOptions);
      $("savePath").addEventListener("change", syncOptions);
      $("startButton").addEventListener("click", () => invoke("start_import"));
      $("cancelButton").addEventListener("click", () => invoke("request_cancel"));
      $("closeButton").addEventListener("click", () => invoke("close_window"));
      $("helpButton").addEventListener("click", openHelpModal);
      $("helpClose").addEventListener("click", closeHelpModal);
      $("helpQuickTab").addEventListener("click", () => setHelpView("quick"));
      $("helpDetailedTab").addEventListener("click", () => setHelpView("detailed"));
      document.querySelectorAll("[data-help-chapter-target]").forEach((button) => {
        button.addEventListener("click", () => setHelpChapter(button.dataset.helpChapterTarget));
      });
      document.querySelectorAll(".external-link").forEach((link) => {
        link.addEventListener("click", openExternalLink);
      });
      $("helpModal").addEventListener("click", (event) => {
        if (event.target === $("helpModal")) closeHelpModal();
      });
      $("profileButton").addEventListener("click", openProfileModal);
      $("profileCancel").addEventListener("click", closeProfileModal);
      $("profileSave").addEventListener("click", saveProfileModal);
      $("resetShortcuts").addEventListener("click", resetProfileFields);
      document.addEventListener("dragenter", (event) => {
        event.preventDefault();
        state.dragDepth += 1;
        document.body.classList.add("drop-active");
      });
      document.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      document.addEventListener("dragleave", () => {
        state.dragDepth = Math.max(0, state.dragDepth - 1);
        if (state.dragDepth === 0) document.body.classList.remove("drop-active");
      });
      document.addEventListener("drop", (event) => {
        event.preventDefault();
        state.dragDepth = 0;
        document.body.classList.remove("drop-active");
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeHelpModal();
      });
    }

    function bootWhenApiIsReady() {
      if (state.booted) return;
      if (!window.pywebview || !window.pywebview.api) {
        setTimeout(bootWhenApiIsReady, 50);
        return;
      }
      state.booted = true;
      bindUi();
      window.pywebview.api.initialize().then(applyState);
    }

    window.addEventListener("pywebviewready", bootWhenApiIsReady);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootWhenApiIsReady);
    } else {
      bootWhenApiIsReady();
    }
  </script>
</body>
</html>
"""
