import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ChapteredHelp, type HelpChapter } from './ChapteredHelp'
import { Tooltip } from './Tooltip'
import { LevelCorrectionFilterDefinition } from './LevelCorrectionFilter'
import { levelCorrectionFilterUrl, useLevelCorrectionFilterId } from './levelCorrectionFilterModel'
import { type LevelCorrectionSettings } from './levelCorrection'
import { DEFAULT_SHEET_IMPORT_RULE_PATTERN, activeSheetCorrectorImportPatterns, type SheetCorrectorImportRule } from './sheetCorrectorImportRules'
import type { QueueState, SheetCorrectionDraft, SheetCorrectorInput, SheetCorrectorProgressDialogState } from './sheet-corrector-types'
import { clampPreviewZoom, queueItemStateLabel } from './sheet-corrector-model'

type SheetCorrectorQueueIconName =
  | 'add'
  | 'export'
  | 'help'
  | 'remove'
  | 'stop'

export function SheetCorrectorQueueIcon({ name }: { name: SheetCorrectorQueueIconName }) {
  if (name === 'add') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    )
  }
  if (name === 'export') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 15v4h14v-4" />
      </svg>
    )
  }
  if (name === 'stop') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h10v10H7Z" />
      </svg>
    )
  }
  if (name === 'help') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
        <path d="M9.5 9a2.6 2.6 0 0 1 5 1c0 1.7-1.4 2.2-2.2 3.2-.3.3-.3.6-.3 1" />
        <path d="M12 17h.01" />
      </svg>
    )
  }
  if (name === 'remove') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    )
  }
  return (
    <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10v10H7Z" />
    </svg>
  )
}

const sheetCorrectorHelpChapters: HelpChapter[] = [
  {
    id: 'automatic-output',
    number: '01',
    title: '画像からすぐPSDを作る',
    summary: 'エクスプローラーから画像やフォルダを渡すだけで、補正からPSD作成まで進められます。',
    sections: [
      {
        title: '編集画面を開かずに使う',
        items: [
          { term: '画像を直接ドロップ', description: 'PNG、JPG、JPEG、TIF、TIFF、TGA、BMPのタイムシート画像を、xsheet-corrector.exeまたは自分で作成したショートカットへドロップします。複数画像も一度に渡せます。' },
          { term: 'フォルダをドロップ', description: 'カットフォルダ内の対象画像をまとめて処理します。どのファイル名を拾うかは、編集画面の「取込条件」で変更できます。' },
          { term: '進捗を確認', description: '処理中は小さな進捗画面が開き、完了・要確認・エラーの件数を確認できます。通常は完了まで待つだけです。' },
          { term: '結果を開く', description: 'PSDは元画像と同じフォルダに作られます。要確認やエラーがあるときは「アプリで確認」から編集画面を開き、対象画像を調整します。' },
        ],
      },
      {
        title: '編集画面を使う判断',
        items: [
          { term: '自動結果を確認したい', description: '四隅の位置や濃淡を見てから出力したいときは、画像をアプリ画面へドロップしてプレビューします。' },
          { term: '独自の用紙を使う', description: 'A3標準以外の用紙では、その用紙に合わせて作ったテンプレートJSONを先に選びます。' },
        ],
      },
    ],
  },
  {
    id: 'queue',
    number: '02',
    title: '画像を追加・選択・整理する',
    summary: '左の「キュー」で、今回処理する画像と処理範囲を決めます。',
    sections: [
      {
        title: '画像を追加する',
        items: [
          { term: '画面へドロップ', description: '画像またはフォルダをウィンドウへドロップすると一覧へ追加されます。左上の「キュー追加」から複数画像を選ぶこともできます。' },
          { term: '対応画像', description: 'PNG、JPG、JPEG、TIF、TIFF、TGA、BMPを読み込めます。対応していないファイルは処理対象になりません。' },
        ],
      },
      {
        title: '処理する範囲を選ぶ',
        items: [
          { term: '1件を選ぶ', description: '一覧の画像をクリックすると、右側にその画像と現在の補正状態が表示されます。' },
          { term: '複数を選ぶ', description: 'Ctrlを押しながらクリックすると個別に追加・解除でき、Shiftを押しながらクリックすると直前の選択から範囲選択できます。' },
          { term: '一覧から外す', description: '各画像の削除ボタンで、今回の処理一覧からだけ外します。元の画像ファイルは削除されません。' },
          { term: '1件だけ出力', description: '各画像の出力ボタンは、その1件だけを補正してPSDにします。まとめて処理する前の試し出力にも使えます。' },
        ],
      },
    ],
  },
  {
    id: 'folder-rules',
    number: '03',
    title: 'フォルダの取込条件を決める',
    summary: 'フォルダ内から、タイムシートらしい名前の画像だけを拾う条件を設定します。',
    sections: [
      {
        title: '条件が使われる場面',
        items: [
          { term: 'フォルダを追加したとき', description: '「取込条件」に合う名前の画像だけを一覧へ追加します。初期状態では *sheet*.jpg と *_ts*.jpg が用意されています。' },
          { term: '画像を直接追加したとき', description: '直接選んだ画像や直接ドロップした画像には、ファイル名条件を適用しません。名前に関係なく、対応形式なら追加できます。' },
        ],
      },
      {
        title: '条件を編集する',
        items: [
          { term: '複数の条件', description: '有効な条件のどれか1つに合えば取り込みます。命名規則が複数ある現場では、規則ごとに条件を追加します。' },
          { term: '* と ?', description: '* は0文字以上の任意の文字列、? は任意の1文字を表します。拡張子まで含めて、実際のファイル名に合う形で入力します。' },
          { term: '有効・無効と削除', description: '一時的に使わない条件はチェックを外します。不要な条件は削除でき、「初期値に戻す」で標準の2条件へ戻せます。' },
        ],
      },
    ],
  },
  {
    id: 'template',
    number: '04',
    title: '用紙テンプレートを選ぶ',
    summary: '元画像と同じ用紙のテンプレートを選ぶと、四隅補正と出力罫線が正しく合います。',
    sections: [
      {
        title: 'テンプレートの選び方',
        items: [
          { term: '組み込みテンプレート', description: '標準のA3タイムシートなら、用紙に合う組み込みテンプレートを選びます。' },
          { term: 'テンプレJSONを読み込み', description: '独自の紙タイムシートは、xsheet-templateで参照画像と補正基準枠を合わせて保存したJSONを読み込みます。一度読み込んだテンプレートは次回も選べます。' },
          { term: '変更するタイミング', description: '画像を補正する前に選びます。別のテンプレートへ変えたときは、その用紙に合わせて自動補正または四隅調整をやり直します。' },
        ],
      },
      {
        title: '赤い罫線で重なりを確認する',
        items: [
          { term: '表示', description: '選択中テンプレートの罫線を赤く重ね、元画像の罫線とずれていないか確認します。横のスライダーで見やすい濃さにします。' },
          { term: 'PSDへの影響', description: '「表示」と濃さはプレビューだけの設定です。PSDには、選択中テンプレートの罫線が編集できる別レイヤーとして入ります。' },
        ],
      },
    ],
  },
  {
    id: 'correction',
    number: '05',
    title: '四隅を合わせて補正する',
    summary: '傾きや遠近を直し、用紙の記入欄をテンプレートの位置へ合わせます。',
    sections: [
      {
        title: '自動で合わせる',
        items: [
          { term: '選択を補正', description: '選択中の画像だけを自動補正し、PSDを作らず結果を準備します。補正済みの画像はそのまま維持されます。' },
          { term: '一括補正', description: '一覧内の未補正画像をまとめて補正します。結果を確認してから一括出力したいときに使います。' },
          { term: '未補正のまま出力', description: '「選択を出力」「全件を出力」を選んだ場合も、未補正画像は出力前に自動で補正されます。' },
        ],
      },
      {
        title: '四隅を手動で直す',
        items: [
          { term: '画像補正', description: '四隅の拡大確認画面を開きます。自動検出された点を確認し、ずれている点だけをドラッグして用紙の基準位置へ合わせます。' },
          { term: '再検出', description: '四隅をもう一度自動で探します。別のテンプレートを選んだ後や、最初の候補が大きく外れたときに使います。' },
          { term: '変形適用', description: '調整した四隅で補正を確定します。点を動かしただけでは出力へ反映されないため、プレビューを確認して必ず「変形適用」を押します。' },
          { term: '用紙内のずれも整える', description: '四隅を合わせた後、テンプレートの罫線と画像内の罫線を照合して細かなずれも整えます。結果が不自然なら、テンプレートと四隅の選択が元画像に合っているかを先に確認します。' },
        ],
      },
    ],
  },
  {
    id: 'preview-levels',
    number: '06',
    title: 'プレビューと濃淡を調整する',
    summary: '細部を見やすくして、鉛筆線や印刷罫線が読みやすいPSDに整えます。',
    sections: [
      {
        title: 'プレビューを動かす',
        items: [
          { term: '拡大・縮小', description: 'プレビュー上でホイールを回して拡大・縮小します。四隅や細い記入線を確認するときに拡大します。' },
          { term: '表示位置を移動', description: '拡大中はプレビューをドラッグして見たい場所へ移動できます。ダブルクリックすると全体が見える初期表示へ戻ります。' },
        ],
      },
      {
        title: 'レベル補正',
        items: [
          { term: '使う／使わない', description: '「レベル補正」のチェックで、プレビューとPSDの両方へ濃淡調整を反映するか切り替えます。' },
          { term: '黒・中間・白', description: '黒点で濃い線を締め、ガンマで中間の鉛筆線を見やすくし、白点で紙の地色を白へ寄せます。細い記入が消れない範囲で調整します。' },
          { term: '初期値・補正なし', description: '迷ったときは初期値へ戻します。元画像の濃淡をそのまま残す必要がある場合は補正なしを選びます。' },
        ],
      },
    ],
  },
  {
    id: 'output',
    number: '07',
    title: 'PSDを出力して編集する',
    summary: '補正した画像とテンプレート罫線を、あとから編集できるレイヤーに分けて保存します。',
    sections: [
      {
        title: '出力する',
        items: [
          { term: '選択を出力', description: '現在選択している画像だけをPSDにします。CtrlやShiftで複数選択している場合は、その選択分を処理します。' },
          { term: '全件を出力', description: '一覧内の全画像をまとめてPSDにします。未補正画像は先に自動補正され、すでに手動調整した結果は維持されます。' },
          { term: '保存先と名前', description: '元画像と同じフォルダへ、元画像と同じ名前を基にしたPSDを保存します。同名PSDがある場合は _2 などの番号を付け、既存ファイルを上書きしません。' },
        ],
      },
      {
        title: 'PSDのレイヤー',
        items: [
          { term: '白地', description: '背景を白く保つレイヤーです。スキャン画像の下に置かれます。' },
          { term: 'テンプレ', description: '選択したテンプレートの罫線です。別レイヤーなので、作業先で表示・非表示や濃さを調整できます。' },
          { term: '元画像名のレイヤー', description: '補正済みのスキャン画像です。鉛筆線や手書き指示を、罫線とは分けて編集できます。' },
        ],
      },
    ],
  },
  {
    id: 'status',
    number: '08',
    title: '要確認・エラー・停止',
    summary: '一覧と進捗画面の表示を手掛かりに、処理できなかった画像だけを直します。',
    sections: [
      {
        title: '状態を見分ける',
        items: [
          { term: '未処理', description: 'まだ補正や出力をしていません。補正だけを先に行うか、そのまま出力を始められます。' },
          { term: '補正済み・出力完了', description: '補正済みは結果が準備できた状態、出力完了はPSDの保存まで終わった状態です。' },
          { term: '要確認', description: '自動では確実に合わせられなかった画像です。その画像を選び、「画像補正」で四隅を確認して「変形適用」してから出力します。' },
          { term: 'エラー', description: '画像の読込または保存に失敗しています。元画像が開けるか、保存先へ書き込めるかを確認し、その1件を再実行します。' },
        ],
      },
      {
        title: '処理を止める',
        items: [
          { term: '停止', description: '停止を押すと、現在処理中の1件を安全に終えてから止まります。完了済みのPSDと補正結果は残るため、一覧を確認して残りを再開できます。' },
        ],
      },
    ],
  },
]

export function SheetCorrectorHelpDialog({ onClose }: { onClose: () => void }) {
  const [helpView, setHelpView] = useState<'quick' | 'detailed'>('quick')

  return (
    <div className="sheetCorrectorModalBackdrop" role="dialog" aria-modal="true" aria-label="シート画像補正の使い方">
      <section className="sheetCorrectorHelpDialog appHelpDialogTabbed">
        <header>
          <div>
            <strong>シート画像補正の使い方</strong>
            <span>{helpView === 'quick' ? '編集画面を開かず、画像から補正済みPSDを作る最短手順です。' : '画像の追加から補正・PSD出力まで、すべての操作を目的別に説明します。'}</span>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>

        <div className="appHelpTabs" role="tablist" aria-label="ヘルプの種類">
          <button type="button" role="tab" aria-selected={helpView === 'quick'} className={helpView === 'quick' ? 'active' : ''} onClick={() => setHelpView('quick')}>
            クイックガイド
          </button>
          <button type="button" role="tab" aria-selected={helpView === 'detailed'} className={helpView === 'detailed' ? 'active' : ''} onClick={() => setHelpView('detailed')}>
            詳しい使い方
          </button>
        </div>

        <div className={`sheetCorrectorHelpBody ${helpView === 'detailed' ? 'sheetCorrectorHelpBodyDetailed' : ''}`}>
          {helpView === 'quick' ? <SheetCorrectorQuickGuide /> : <SheetCorrectorDetailedHelp />}
        </div>
        <footer>
          <p>{helpView === 'quick' ? 'PSDは元画像と同じフォルダへ作られ、同名ファイルは上書きしません。' : '迷ったときは「要確認」の画像だけを選び、テンプレートと四隅から確認してください。'}</p>
        </footer>
      </section>
    </div>
  )
}

function SheetCorrectorQuickGuide() {
  const steps = [
    { title: 'タイムシート画像を選ぶ', description: 'エクスプローラーで対応画像を選びます。複数画像や、カットフォルダごとでもかまいません。' },
    { title: 'EXEまたはショートカットへドロップ', description: 'xsheet-corrector.exe、または自分で作成したショートカットへ重ねてドロップします。' },
    { title: '進捗画面で完了を待つ', description: '補正とPSD作成が自動で進みます。途中で止めるときは「停止」を押します。' },
    { title: '同じフォルダのPSDを確認', description: '元画像と同じフォルダに補正済みPSDができます。既存PSDがある場合は番号付きの別名になります。' },
  ]

  return (
    <div className="sheetCorrectorHelpWorkflows">
      <article className="sheetCorrectorHelpWorkflow sheetCorrectorHelpWorkflowPrimary">
        <span className="sheetCorrectorHelpEyebrow">QUICK GUIDE</span>
        <h2>画像をドロップしてPSDを作る</h2>
        <p>通常は編集画面を開く必要はありません。画像の傾きと遠近を整え、罫線とスキャン画像を分けたPSDまで自動で作成します。</p>
        <ol>
          {steps.map(step => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.description}</span>
            </li>
          ))}
        </ol>
        <p className="sheetCorrectorHelpNotice">要確認やエラーが表示されたときは、進捗画面の「アプリで確認」で対象画像を開けます。</p>
      </article>
      <article className="sheetCorrectorHelpWorkflow">
        <h2>編集画面を使うのはこんなとき</h2>
        <ul>
          <li>四隅や補正結果を見てからPSDを作りたい</li>
          <li>「要確認」になった画像の四隅を直したい</li>
          <li>鉛筆線が読みやすい濃淡にしたい</li>
          <li>独自用紙のテンプレートJSONを使いたい</li>
          <li>フォルダから拾うファイル名を変えたい</li>
        </ul>
        <h3>画面での最短手順</h3>
        <p>画像を画面へドロップ → 用紙に合う「テンプレ」を選ぶ → 必要なら「画像補正」で四隅を直して「変形適用」 → 「選択を出力」の順です。</p>
      </article>
    </div>
  )
}

function SheetCorrectorDetailedHelp() {
  return (
    <ChapteredHelp
      chapters={sheetCorrectorHelpChapters}
      tocTitle="補正とPSD出力の全機能"
      navigationLabel="シート画像補正の詳しい使い方の目次"
      idPrefix="sheet-corrector-help"
      className="sheetCorrectorHelpManual"
    />
  )
}

export function SheetCorrectorImportRulesControl({
  rules,
  tooltipLabel,
  onAdd,
  onReset,
  onToggle,
  onChange,
  onRemove,
}: {
  rules: SheetCorrectorImportRule[]
  tooltipLabel: string
  onAdd: () => void
  onReset: () => void
  onToggle: (id: string, enabled: boolean) => void
  onChange: (id: string, pattern: string) => void
  onRemove: (id: string) => void
}) {
  const activePatterns = activeSheetCorrectorImportPatterns(rules)
  return (
    <section className="sheetCorrectorFolderFilter" aria-label="取込条件">
      <header className="sheetCorrectorFolderFilterHeader">
        <span>取込条件</span>
        <Tooltip label={tooltipLabel}>
          <span className="sheetCorrectorFolderFilterScope">フォルダ</span>
        </Tooltip>
      </header>
      <div className="sheetCorrectorImportRuleList">
        {rules.length === 0 ? (
          <p>フィルターなし</p>
        ) : rules.map((rule, index) => (
          <div className="sheetCorrectorImportRuleRow" key={rule.id}>
            <Tooltip label={rule.enabled ? '条件を無効化' : '条件を有効化'}>
              <label className="sheetCorrectorImportRuleToggle">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  aria-label={`取込条件 ${index + 1}を有効化`}
                  onChange={event => onToggle(rule.id, event.currentTarget.checked)}
                />
              </label>
            </Tooltip>
            <Tooltip label={tooltipLabel}>
              <input
                className="sheetCorrectorFolderFilterInput"
                value={rule.pattern}
                placeholder={DEFAULT_SHEET_IMPORT_RULE_PATTERN}
                aria-label={`取込条件 ${index + 1}`}
                onChange={event => onChange(rule.id, event.currentTarget.value)}
              />
            </Tooltip>
            <Tooltip label="削除">
              <button type="button" className="sheetCorrectorImportRuleRemove" aria-label={`取込条件 ${index + 1}を削除`} onClick={() => onRemove(rule.id)}>
                <SheetCorrectorQueueIcon name="remove" />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
      <div className="sheetCorrectorImportRuleActions">
        <button type="button" onClick={onAdd}>条件を追加</button>
        <button type="button" onClick={onReset}>初期条件</button>
      </div>
      <div className="sheetCorrectorImportSummary">
        <span>{activePatterns.length === 0 ? 'フィルターなし' : `${activePatterns.length}条件`}</span>
        {activePatterns.slice(0, 2).map((pattern, index) => (
          <span key={`${pattern}:${index}`}>{pattern}</span>
        ))}
        {activePatterns.length > 2 && <span>他 {activePatterns.length - 2}</span>}
      </div>
    </section>
  )
}

export function SheetCorrectorProgressDialog({
  state,
  queueRunning,
  onStop,
  onClose,
}: {
  state: SheetCorrectorProgressDialogState
  queueRunning: boolean
  onStop: () => void
  onClose: () => void
}) {
  return (
    <div className="sheetCorrectorModalBackdrop" role="dialog" aria-modal="true" aria-label={state.title}>
      <SheetCorrectorProgressPanel
        state={state}
        queueRunning={queueRunning}
        onStop={onStop}
        stopLabel="停止"
      >
        <button type="button" className="primary" disabled={!state.canClose} onClick={onClose}>
          閉じる
        </button>
      </SheetCorrectorProgressPanel>
    </div>
  )
}

export function SheetCorrectorBatchProgress({
  state,
  queueRunning,
  onStop,
  onClose,
  onOpenApp,
}: {
  state: SheetCorrectorProgressDialogState
  queueRunning: boolean
  onStop: () => void
  onClose: () => void
  onOpenApp: () => void
}) {
  const hasAttentionItems = state.review > 0 || state.error > 0
  return (
    <SheetCorrectorProgressPanel
      state={state}
      queueRunning={queueRunning}
      onStop={onStop}
      stopLabel="キャンセル"
    >
      {state.canClose && (
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      )}
      <button type="button" className="primary" disabled={!state.canClose} onClick={onOpenApp}>
        {hasAttentionItems ? 'アプリで確認' : 'アプリで開く'}
      </button>
    </SheetCorrectorProgressPanel>
  )
}

function SheetCorrectorProgressPanel({
  state,
  queueRunning,
  onStop,
  stopLabel,
  children,
}: {
  state: SheetCorrectorProgressDialogState
  queueRunning: boolean
  onStop: () => void
  stopLabel: string
  children: ReactNode
}) {
  const progressPercent = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0
  return (
    <section className="sheetCorrectorProgressDialog">
      <header>
        <div>
          <strong>{state.title}</strong>
          <span>{state.message}</span>
        </div>
      </header>
      <div className="sheetCorrectorProgressMeter" aria-label="処理進捗">
        <div>
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <strong>{state.total > 0 ? `${state.processed}/${state.total}` : '-'}</strong>
      </div>
      <dl className="sheetCorrectorProgressStats">
        <div>
          <dt>PSD出力</dt>
          <dd>{state.exported}</dd>
        </div>
        <div>
          <dt>要確認</dt>
          <dd>{state.review}</dd>
        </div>
        <div>
          <dt>エラー</dt>
          <dd>{state.error}</dd>
        </div>
      </dl>
      <footer>
        {queueRunning && (
          <button type="button" onClick={onStop}>{stopLabel}</button>
        )}
        {children}
      </footer>
    </section>
  )
}

export function SheetCorrectorItemList({
  items,
  selectedPaths,
  primarySelectedPath,
  queueStates,
  correctionDrafts,
  actionsDisabled,
  emptyText,
  onSelect,
  onExport,
  onRemove,
}: {
  items: SheetCorrectorInput[]
  selectedPaths: string[]
  primarySelectedPath: string | null
  queueStates: Record<string, QueueState>
  correctionDrafts: Record<string, SheetCorrectionDraft>
  actionsDisabled: boolean
  emptyText: string
  onSelect: (path: string, event: MouseEvent<HTMLButtonElement>) => void
  onExport: (path: string) => void
  onRemove: (path: string) => void
}) {
  return (
    <section className="sheetCorrectorList">
      <header>
        <strong>ファイル</strong>
        <span>{items.length}件</span>
      </header>
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ol>
          {items.map(item => {
            const exportLabel = correctionDrafts[item.path]?.applied
              ? `PSD出力: ${item.name}`
              : `自動補正してPSD出力: ${item.name}`
            const exportAriaLabel = correctionDrafts[item.path]?.applied
              ? `${item.name}をPSD出力`
              : `${item.name}を自動補正してPSD出力`
            return (
              <li key={item.path}>
                <Tooltip label={`${item.name}を選択`}>
                  <button
                    type="button"
                    className={[
                      'sheetCorrectorQueueSelect',
                      selectedPaths.includes(item.path) ? 'selected' : '',
                      item.path === primarySelectedPath ? 'primary' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={event => onSelect(item.path, event)}
                  >
                    <span>{item.name}</span>
                    <em className={`sheetCorrectorQueueState ${queueStates[item.path] ?? 'idle'}`}>
                      {queueItemStateLabel(queueStates[item.path])}
                    </em>
                  </button>
                </Tooltip>
                <div className="sheetCorrectorQueueItemActions">
                  <Tooltip label={exportLabel}>
                    <button
                      type="button"
                      className="sheetCorrectorQueueItemAction"
                      disabled={actionsDisabled}
                      aria-label={exportAriaLabel}
                      onClick={() => onExport(item.path)}
                    >
                      <SheetCorrectorQueueIcon name="export" />
                    </button>
                  </Tooltip>
                  <Tooltip label={`${item.name}をキューから外す`}>
                    <button
                      type="button"
                      className="sheetCorrectorQueueItemAction"
                      disabled={actionsDisabled}
                      aria-label={`${item.name}をキューから外す`}
                      onClick={() => onRemove(item.path)}
                    >
                      <SheetCorrectorQueueIcon name="remove" />
                    </button>
                  </Tooltip>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export function SheetCorrectorSourcePreview({
  imageUrl,
  viewKey,
  levelCorrection,
  templateImageUrl,
  overlayEnabled,
  overlayOpacity,
}: {
  imageUrl: string | null
  viewKey: string | null
  levelCorrection: LevelCorrectionSettings
  templateImageUrl: string | null
  overlayEnabled: boolean
  overlayOpacity: number
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previewPanRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const [previewZoomState, setPreviewZoomState] = useState<{ viewKey: string | null; zoom: number }>({ viewKey: null, zoom: 1 })
  const [isPreviewPanning, setIsPreviewPanning] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const previewZoom = previewZoomState.viewKey === viewKey ? previewZoomState.zoom : 1
  const levelCorrectionFilterId = useLevelCorrectionFilterId('sheetCorrectorLevelCorrection')
  const levelCorrectionFilter = levelCorrectionFilterUrl(levelCorrectionFilterId, levelCorrection)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const updateSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      })
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const previewBaseSize = useMemo(() => {
    if (!imageSize || viewportSize.width <= 0 || viewportSize.height <= 0) return null
    const availableWidth = Math.max(1, viewportSize.width - 20)
    const availableHeight = Math.max(1, viewportSize.height - 20)
    const fitScale = Math.min(availableWidth / imageSize.width, availableHeight / imageSize.height)
    const scale = Math.min(1, Math.max(0.02, fitScale))
    return {
      width: imageSize.width * scale,
      height: imageSize.height * scale,
    }
  }, [imageSize, viewportSize.height, viewportSize.width])

  const handlePreviewWheel = useCallback((event: globalThis.WheelEvent) => {
    if (!imageUrl) return
    if (event.cancelable) event.preventDefault()
    event.stopPropagation()
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const anchor = {
      x: event.clientX - rect.left + viewport.scrollLeft,
      y: event.clientY - rect.top + viewport.scrollTop,
    }
    const cursor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    setPreviewZoomState(currentState => {
      const current = currentState.viewKey === viewKey ? currentState.zoom : 1
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
      const next = clampPreviewZoom(current * factor)
      if (next === current) return currentState.viewKey === viewKey ? currentState : { viewKey, zoom: current }
      window.requestAnimationFrame(() => {
        const ratio = next / current
        viewport.scrollLeft = anchor.x * ratio - cursor.x
        viewport.scrollTop = anchor.y * ratio - cursor.y
      })
      return { viewKey, zoom: next }
    })
  }, [imageUrl, viewKey])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    viewport.addEventListener('wheel', handlePreviewWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handlePreviewWheel)
  }, [handlePreviewWheel])

  function beginPreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageUrl || event.button !== 0) return
    const viewport = viewportRef.current
    if (!viewport) return
    event.preventDefault()
    previewPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsPreviewPanning(true)
  }

  function movePreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = previewPanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    const viewport = viewportRef.current
    if (!viewport) return
    event.preventDefault()
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX)
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY)
  }

  function endPreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = previewPanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    previewPanRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsPreviewPanning(false)
  }

  return (
    <section className="sheetCorrectorPreviewPanel">
      <div
        ref={viewportRef}
        className={[
          'sheetCorrectorImageViewport',
          imageUrl ? 'panEnabled' : '',
          isPreviewPanning ? 'panning' : '',
        ].filter(Boolean).join(' ')}
        onDoubleClick={() => setPreviewZoomState({ viewKey, zoom: 1 })}
        onPointerDown={beginPreviewPan}
        onPointerMove={movePreviewPan}
        onPointerUp={endPreviewPan}
        onPointerCancel={endPreviewPan}
      >
        {imageUrl ? (
          <div
            className="sheetCorrectorPreviewStack"
            style={previewBaseSize ? {
              width: `${previewBaseSize.width * previewZoom}px`,
              height: `${previewBaseSize.height * previewZoom}px`,
            } : undefined}
          >
            {levelCorrectionFilter && (
              <svg className="levelCorrectionFilterSvg" aria-hidden="true">
                <defs>
                  <LevelCorrectionFilterDefinition id={levelCorrectionFilterId} settings={levelCorrection} />
                </defs>
              </svg>
            )}
            <img
              className="sheetCorrectorPreviewImage"
              src={imageUrl}
              alt=""
              draggable={false}
              style={levelCorrectionFilter ? { filter: levelCorrectionFilter } : undefined}
              onLoad={event => {
                const image = event.currentTarget
                const width = image.naturalWidth || image.width
                const height = image.naturalHeight || image.height
                if (width > 0 && height > 0) setImageSize({ width, height })
              }}
            />
            {overlayEnabled && templateImageUrl && (
              <svg
                className="sheetCorrectorTemplateOverlay"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                style={{ opacity: overlayOpacity }}
                aria-hidden="true"
              >
                <defs>
                  <filter id="sheetCorrectorTemplateTint" colorInterpolationFilters="sRGB">
                    <feColorMatrix
                      in="SourceGraphic"
                      result="darknessMask"
                      type="matrix"
                      values="
                        0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        -0.2126 -0.7152 -0.0722 0 1
                      "
                    />
                    <feComposite in="darknessMask" in2="SourceAlpha" operator="in" result="visibleDarkness" />
                    <feFlood floodColor="#ff1f12" result="overlayColor" />
                    <feComposite in="overlayColor" in2="visibleDarkness" operator="in" />
                  </filter>
                </defs>
                <image
                  href={templateImageUrl}
                  x="0"
                  y="0"
                  width="1"
                  height="1"
                  preserveAspectRatio="none"
                  filter="url(#sheetCorrectorTemplateTint)"
                />
              </svg>
            )}
          </div>
        ) : (
          <div className="sheetCorrectorPreviewPlaceholder">
            <strong>フォルダまたはシート画像をドロップ</strong>
            <span>フォルダは候補を確認してからキューに追加します。</span>
          </div>
        )}
      </div>
    </section>
  )
}
