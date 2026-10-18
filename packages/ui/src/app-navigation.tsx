import { requestTemplateEditor } from './template-editor-entry'
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { type CutMetadataFieldId, type CutProject, type NormalizedRect, type SheetImageAlignment, type SheetCalibrationPointPair, type SheetSource, type SheetTemplate, type SheetTimingRole, type RecognitionCandidate, getSheetViewLayout, isInteractiveSheetTemplateGridRegion, sheetTimingRoleForEvent } from '@xsheet-remap/core'
import { isTauriHost, XSR_PROJECT_FILE_ACCEPT } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { type Panel } from './appTypes'
import { type SheetImageExportFormat } from './cleanSheetExport'
import { calibrationTargetRectForTemplate } from './sheetImages'
import { Tooltip, TooltipTarget } from './Tooltip'
import { ActionMenu } from './AppControls'
import { CalibrationPointKind, RegisteredCellSortDirection, type MainAppKind } from './app-foundation'
import { gridHeaderLabelForRole } from './templateEditorGeometry'
import { DurationFrameControl } from './DurationFrameControl'
import { EditorDetailedHelp } from './EditorDetailedHelp'
import { LicenseNotices, licenseHelpDescription } from './LicenseNotices'
import { SHEET_TEMPLATE_FILE_ACCEPT } from './app-template-import'
import { type CorrectedSheetImageExportFormat } from './correctedSheetImageExport'
import { type DialogueAudioTrackExportFormat } from './dialogueAudioExport'

export function RecognitionActionMenu({
  label = <span>OCR</span>,
  className = '',
  placement = 'bottom-start',
  candidates,
  sheetRole,
  running,
  progress,
  message,
  project,
  template,
  disabled,
  onSheetRoleChange,
  onDetect,
  onAccept,
  onAcceptAll,
  onUpdateLabel,
  onRemove,
  onClear,
}: {
  label?: ReactNode
  className?: string
  placement?: 'bottom-start' | 'right-start'
  candidates: RecognitionCandidate[]
  sheetRole: SheetTimingRole
  running: boolean
  progress: { completed: number; total: number } | null
  message: string | null
  project: CutProject
  template: SheetTemplate
  disabled: boolean
  onSheetRoleChange: (sheetRole: SheetTimingRole) => void
  onDetect: () => void
  onAccept: (candidate: RecognitionCandidate) => void
  onAcceptAll: () => void
  onUpdateLabel: (candidateId: string, value: string) => void
  onRemove: (candidateId: string) => void
  onClear: () => void
}) {
  const readyCount = candidates.filter(candidate => !recognitionCandidateHasConflict(project, candidate)).length
  const availableRoles = (['action', 'cell'] as const).filter(role => template.regions.some(region =>
    isInteractiveSheetTemplateGridRegion(region) && region.grid.role === role,
  ))
  return (
    <ActionMenu
      label={label}
      ariaLabel={uiText.recognition.menu}
      tooltipLabel={uiText.recognition.menuTitle}
      className={`sheetRecognitionMenu ${className}`.trim()}
      placement={placement}
    >
      <div className="recognitionMenuBody">
        <div className="recognitionRoleControl" role="group" aria-label={uiText.recognition.targetField}>
          {availableRoles.map(role => (
            <button
              key={role}
              type="button"
              className={sheetRole === role ? 'active' : ''}
              aria-pressed={sheetRole === role}
              disabled={running}
              onClick={() => onSheetRoleChange(role)}
            >
              {gridHeaderLabelForRole(template, role)}
            </button>
          ))}
        </div>
        <button type="button" className="recognitionRunButton" disabled={disabled || running} onClick={onDetect}>
          {running ? uiText.recognition.running : uiText.actions.runOcrAllPages}
        </button>
        {running && progress && (
          <progress
            className="recognitionProgress"
            max={Math.max(1, progress.total)}
            value={progress.completed}
            aria-label={uiText.recognition.running}
          />
        )}
        <div className="recognitionMenuActions">
          <button type="button" disabled={readyCount === 0 || running} onClick={onAcceptAll}>{uiText.actions.acceptAll}</button>
          <button type="button" disabled={candidates.length === 0 || running} onClick={onClear}>{uiText.recognition.clearCandidates}</button>
        </div>
        {disabled && <p className="muted">{uiText.recognition.disabled}</p>}
        {message && <p className="recognitionMessage" role="status">{message}</p>}
        <div className="recognitionMenuCandidateHeader">
          <strong>{uiText.recognition.candidates}</strong>
          <span>{uiText.recognition.candidateCount(candidates.length)}</span>
        </div>
        {candidates.length > 0 && (
          <div className="candidateList recognitionMenuCandidateList">
            {candidates.map(candidate => {
              const conflict = recognitionCandidateHasConflict(project, candidate)
              return (
                <div key={candidate.candidateId} className={conflict ? 'candidateItem conflict' : 'candidateItem'}>
                  <div className="candidateItemMeta">
                    <strong>{candidate.paperTrack} {candidate.frame}F</strong>
                    <span>{Math.round(candidate.confidence * 100)}%</span>
                  </div>
                  <input
                    value={candidate.normalizedLabel}
                    aria-label={uiText.recognition.candidateLabel(candidate.paperTrack, candidate.frame)}
                    onChange={event => onUpdateLabel(candidate.candidateId, event.currentTarget.value)}
                  />
                  {conflict && <span className="candidateConflictLabel">{uiText.recognition.existingEvent}</span>}
                  <div className="candidateItemActions">
                    <button type="button" disabled={conflict || !candidate.normalizedLabel.trim()} onClick={() => onAccept(candidate)}>{uiText.recognition.accept}</button>
                    <button type="button" onClick={() => onRemove(candidate.candidateId)}>{uiText.actions.remove}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </ActionMenu>
  )
}

function recognitionCandidateHasConflict(project: CutProject, candidate: RecognitionCandidate): boolean {
  const event = project.logicalSheet.events.find(item =>
    item.paperTrack === candidate.paperTrack
    && item.frame === candidate.frame
    && sheetTimingRoleForEvent(item) === candidate.sheetRole,
  )
  if (!event) return false
  const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
  return key?.displayLabel.trim().normalize('NFKC') !== candidate.normalizedLabel.trim().normalize('NFKC')
}

export function CutMetadataActionMenu({
  project,
  template,
  onMetadataChange,
  onDurationChange,
}: {
  project: CutProject
  template: SheetTemplate
  onMetadataChange: (field: CutMetadataFieldId, value: string, customKey?: string) => void
  onDurationChange: (frames: number) => void
}) {
  const cutLabel = project.cut.cut?.trim() || '---'
  const summary = cutLabel
  const customFields = Array.from(new Map(template.regions.flatMap(region =>
    region.binding?.target === 'cut-metadata'
    && region.binding.field === 'custom'
    && region.binding.customKey
      ? [[region.binding.customKey, region.label] as const]
      : [],
  )).entries())

  return (
    <ActionMenu
      label={<span className="cutMetadataSummary">{summary}</span>}
      ariaLabel={uiText.sheet.cutMetadata}
      tooltipLabel={uiText.sheet.cutMetadataTitle}
      className="cutMetadataMenu"
    >
      <div className="cutMetadataMenuForm">
        <label className="cutMetadataMenuField cutMetadataMenuTitleField">
          <span>タイトル</span>
          <input
            value={project.cut.title ?? ''}
            onChange={event => onMetadataChange('title', event.currentTarget.value)}
          />
        </label>
        <div className="cutMetadataMenuFieldRow">
          <label className="cutMetadataMenuField">
            <span>話数</span>
            <input
              value={project.cut.episode ?? ''}
              onChange={event => onMetadataChange('episode', event.currentTarget.value)}
            />
          </label>
          <label className="cutMetadataMenuField">
            <span>シーン</span>
            <input
              value={project.cut.scene ?? ''}
              onChange={event => onMetadataChange('scene', event.currentTarget.value)}
            />
          </label>
          <label className="cutMetadataMenuField">
            <span>カット</span>
            <input
              value={project.cut.cut ?? ''}
              onChange={event => onMetadataChange('cut', event.currentTarget.value)}
            />
          </label>
        </div>
        <label className="cutMetadataMenuField">
          <span>作業者</span>
          <input
            value={project.cut.worker ?? ''}
            onChange={event => onMetadataChange('worker', event.currentTarget.value)}
          />
        </label>
        {customFields.map(([customKey, label]) => (
          <label key={customKey} className="cutMetadataMenuField">
            <span>{label}</span>
            <input
              value={project.cut.custom?.[customKey] ?? ''}
              onChange={event => onMetadataChange('custom', event.currentTarget.value, customKey)}
            />
          </label>
        ))}
        <DurationFrameControl
          frames={project.logicalSheet.durationFrames}
          fps={project.logicalSheet.fps}
          onChange={onDurationChange}
        />
      </div>
    </ActionMenu>
  )
}

export function RegisteredCellSortIcon({ direction }: { direction: RegisteredCellSortDirection }) {
  return (
    <svg className="assetSortIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'asc' ? 'M8 18V6m0 0L4.5 9.5M8 6l3.5 3.5' : 'M8 6v12m0 0l-3.5-3.5M8 18l3.5-3.5'} />
      <path d="M14 7h6M14 12h4.5M14 17h3" />
    </svg>
  )
}

export function NormalizeNamesIcon() {
  return (
    <svg className="assetBrowserIcon registeredCellNormalizeIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 6.5h6M14.5 6.5h6" />
      <path d="M3.5 12h11M19.5 12h1" />
      <path d="M3.5 17.5h4.5M13 17.5h7.5" />
      <circle cx="12" cy="6.5" r="2.6" />
      <circle cx="17" cy="12" r="2.6" />
      <circle cx="10.5" cy="17.5" r="2.6" />
    </svg>
  )
}

export function RegisteredCellDetailViewIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  )
}

export function RegisteredCellListViewIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  )
}

export function PaneChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  )
}

export function UndoIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h9a6 6 0 0 1 0 12h-1" />
    </svg>
  )
}

export function RedoIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9h-9a6 6 0 0 0 0 12h1" />
    </svg>
  )
}

export function HelpIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.7 1.2c0 1.8-2.2 2.2-2.2 4" />
      <path d="M12 17.5h.01" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

export function PenToolIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15.5 4.5 4 4" />
      <path d="M4 20l4.5-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  )
}

export function TextToolIcon() {
  return (
    <span className="textToolIconBox" aria-hidden="true">
      <svg className="textToolIconSvg" viewBox="0 0 18 18" focusable="false">
        <path d="M3 2h12v4h-4v10H7V6H3z" />
      </svg>
    </span>
  )
}

export function TextSizeIcon() {
  return (
    <svg className="topIconSvg textSizeIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 19 8 6l4.5 13M5.2 14h5.6" />
      <path d="M19.5 19v-6.2c0-1.5-1.1-2.4-2.7-2.4-1.4 0-2.4.7-2.8 1.8M19.5 15.1h-2.3c-2 0-3.2.8-3.2 2.1 0 1.2 1 2 2.4 2 1.8 0 3.1-1.2 3.1-2.7" />
    </svg>
  )
}

export function CheckSmallIcon() {
  return (
    <svg className="smallInlineIcon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.2 6.4 11.5 13 4.5" />
    </svg>
  )
}

export function CloseSmallIcon() {
  return (
    <svg className="smallInlineIcon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  )
}

export function EraserToolIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 21-4-4 9.5-9.5a3 3 0 0 1 4.2 0l1.8 1.8a3 3 0 0 1 0 4.2L11 21H7Z" />
      <path d="m9.5 10.5 5 5" />
      <path d="M14 21h7" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  )
}

export function ViewModeIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="7" height="14" rx="1" />
      <rect x="13.5" y="5" width="7" height="14" rx="1" />
      <path d="M7 8.5h.01M7 12h.01M7 15.5h.01" />
      <path d="M17 8.5h.01M17 12h.01M17 15.5h.01" />
    </svg>
  )
}

export function DisplaySettingsIcon() {
  return (
    <svg className="topIconSvg displayTemplateIcon pageDisplayIcon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M9.6 3.5h4.8l.5 2.1c.6.2 1.2.6 1.7 1l2.1-.6 2.4 4.1-1.6 1.5v.8l1.6 1.5-2.4 4.1-2.1-.6c-.5.4-1.1.8-1.7 1l-.5 2.1H9.6l-.5-2.1c-.6-.2-1.2-.6-1.7-1l-2.1.6-2.4-4.1 1.6-1.5v-.8l-1.6-1.5L5.3 6l2.1.6c.5-.4 1.1-.8 1.7-1z" />
    </svg>
  )
}

export function PaperSheetIcon() {
  return (
    <svg className="topIconSvg paperSheetIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 2.5h8.7l4.3 4.3v14.7h-13z" />
      <path d="M14.2 2.5v4.3h4.3" />
      <path
        d="M12 20.5V10.2M7.8 14.4 12 10.2l4.2 4.2"
        stroke="#fff"
        strokeWidth="5.4"
      />
      <path
        d="M12 20.5V10.2M7.8 14.4 12 10.2l4.2 4.2"
        stroke="currentColor"
        strokeWidth="2.45"
      />
    </svg>
  )
}

export function SharedCutIcon() {
  return (
    <svg className="topIconSvg sharedCutIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5h17v12.5h-17z" />
      <path d="M3.5 7.5V4.8L19.7 2l.8 5.5z" />
      <path d="M8 4 6.8 7.5M13 3.2l-1.2 4.3M18 2.5l-1.2 5" />
      <path d="M6.5 14h4.2M10.7 14l4-3M10.7 14l4 3M14.7 9.8v2.4M14.7 15.8v2.4" />
    </svg>
  )
}

export function AppHelpDialog({
  appName,
  appKind,
  onClose,
}: {
  appName: string
  appKind: MainAppKind
  onClose: () => void
}) {
  const isEditor = appKind === 'editor'
  const [helpView, setHelpView] = useState<'quick' | 'detailed' | 'licenses'>('quick')
  const isDetailedHelp = helpView === 'detailed'
  return (
    <div className="appHelpBackdrop" role="dialog" aria-modal="true" aria-label={`${appName}の使い方`}>
      <section className="appHelpDialog appHelpDialogTabbed">
        <header>
          <div>
            <strong>{appName} ヘルプ</strong>
            <span>{helpView === 'licenses' ? licenseHelpDescription : isDetailedHelp
              ? 'やりたいことから、必要な機能と画面操作を章ごとに確認できます。'
              : isEditor
                ? 'タイムシートを作って保存・受け渡しするまでの最短手順です。'
                : 'いまある資料から照合を始め、CSPへ登録するまでの最短手順です。'}</span>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="appHelpTabs" role="tablist" aria-label="ヘルプの種類">
          <button
            type="button"
            role="tab"
            aria-selected={helpView === 'quick'}
            className={helpView === 'quick' ? 'active' : ''}
            onClick={() => setHelpView('quick')}
          >
            クイックガイド
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={helpView === 'detailed'}
            className={helpView === 'detailed' ? 'active' : ''}
            onClick={() => setHelpView('detailed')}
          >
            詳しい使い方
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={helpView === 'licenses'}
            className={helpView === 'licenses' ? 'active' : ''}
            onClick={() => setHelpView('licenses')}
          >
            ライセンス・謝辞
          </button>
        </div>
        <div className={`appHelpBody${isDetailedHelp ? ' appHelpBodyDetailed' : ''}`}>
          {helpView === 'licenses' ? <LicenseNotices /> : isDetailedHelp
            ? <EditorDetailedHelp remap={!isEditor} />
            : isEditor ? <EditorHelpContent /> : <RemapHelpContent />}
        </div>
        {helpView !== 'licenses' && <footer>
          <p>{isEditor
            ? 'まずクイックガイドで1本作り、細かな編集や判断に迷ったときは「詳しい使い方」の該当章を開いてください。'
            : '「CLIPを作成」から、画像とタイムラインを登録したCLIPを直接保存できます。'}</p>
        </footer>}
      </section>
    </div>
  )
}

function EditorHelpContent() {
  return <>
    <article className="appHelpWorkflow">
      <h2>タイムシートを作って保存する</h2>
      <p>最初は次の順番だけで、入力を再開できる.xsrプロジェクトまで作れます。</p>
      <ol>
        <li><strong>カット情報と尺を決める</strong><span>上部の「カット情報」を開き、作品名、話数、カット番号、尺を入力します。ページ数と入力できる最終フレームがここで決まります。</span></li>
        <li><strong>ACTIONまたはCELLへタイミングを入れる</strong><span>入力したいマスを選び、番号を入力してEnterで確定します。記号は半角の x がカラセル、/ が中割記号○、. が中割記号●で、同じくEnterで確定します。連続範囲はドラッグし、右クリックまたは「…」からコピー・貼り付け・リピートを選びます。</span></li>
        <li><strong>必要な指示を加える</strong><span>台詞やSEはSOUND、撮影処理はCAMERAを区間選択して入力します。自由な申し送りはメモ、紙面への書き込みはペン・テキスト注釈を使います。</span></li>
        <li><strong>全体を見直す</strong><span>「全体表示」や連続表示で先頭から末尾まで確認します。紙シートを使う場合は、先に画像を読み込んで四隅を合わせると転記しやすくなります。</span></li>
        <li><strong>.xsrで保存する</strong><span>画面切替メニューの「プロジェクト」→「保存」を選びます。.xsrにはタイミング、指示、注釈、素材対応、テンプレート、音声編集がまとめて保持されます。</span></li>
      </ol>
    </article>
    <article className="appHelpWorkflow">
      <h2>やりたいことに合わせて仕上げる</h2>
      <p>基本入力の後は、渡し先と素材の有無で使う機能を選びます。</p>
      <ol>
        <li><strong>セリフ音声からSOUNDを作る</strong><span>下部の「音声」を開き、録音または音声ファイルを追加します。発話候補を選んで「音響指示へ割付…」を押すと、波形の位置に合うSOUNDを作れます。</span></li>
        <li><strong>紙タイムシートを転記する</strong><span>シート作業レールの「紙シート」→「読込」で画像を入れ、「補正」で罫線を合わせます。文字認識は候補を確認してから採用し、読みにくい箇所は手入力します。</span></li>
        <li><strong>CSPへ素材を組み込む</strong><span>左右ペインを開き、右の画像素材をキーへ割り付け、左で工程・セル名・重ね順を確認します。「CLIPを作成」で新規設定またはテンプレートを選び、画像とタイムラインを登録したCLIPを保存します。画像なしでも作成できます。</span></li>
        <li><strong>他ソフトへタイミングを渡す</strong><span>確認画像はJPG／PNG／PSD、交換用はXDTSを選びます。After Effectsは1列なら列見出しの「AE用データをコピー」、複数列ならJSXまたはWindows版の直接送信を使います。1列コピーでは、0フレームへ貼り付けるとAE 2026のタイムリマップが自動で有効になります。貼り付け後はタイムリマップのキーをHOLDにし、カラセルがある場合はブラインドのキーもHOLDにします。レイヤーは手動でカット終端まで伸ばします。操作手順は「詳しい使い方」のAfter Effectsの項目を参照してください。</span></li>
      </ol>
    </article>
  </>
}

function RemapHelpContent() {
  return <>
    <article className="appHelpWorkflow appHelpWorkflowPrep">
      <h2>照合結果をCSPへ登録する</h2>
      <p>紙タイムシートや画像素材がなくても始められます。手元にある資料から、次の順番で進めてください。</p>
      <ol>
        <li><strong>始め方を選ぶ</strong><span>続きの作業は「プロジェクト」→「プロジェクトを開く」で.xsrを開きます。既存タイミングは「読み込み」→「XDTSを読み込む」、何もない場合は「新規プロジェクト」から始めます。</span></li>
        <li><strong>カットと入力先を確認する</strong><span>上部の「カット情報」で作品名、カット番号、尺を確認します。原画側のタイミングはACTION、動画・セル番号はCELLを使い、読み込みや書き出しでも同じ側を選びます。記号はマスを選び、半角の x でカラセル、/ で中割記号○、. で中割記号●を入力し、Enterで確定します。</span></li>
        <li><strong>CLIPと登録先を決める</strong><span>既存のCLIPを開くか、既定のレイヤー構造から始めます。CLIPを開くと現在のシートとUndo履歴はリセットされます。右のレイヤーで工程・セル列とアニメーションフォルダーの対応を指定します。</span></li>
        <li><strong>必要な資料だけ追加する</strong><span>紙を転記するときは「紙シート」→「読込」で画像を入れ、「補正」で罫線を合わせます。作画画像は左のレイヤーツリーへ一括追加できます。クイックルックで確認し、該当するACTION／CELLのコマへドラッグします。OSからシートへ画像を直接ドロップすると、選択工程・列の登録先にも追加されます。</span></li>
        <li><strong>CSPへ渡す内容を見直す</strong><span>左でセル名、フォルダー、重ね順、不透明度、合成モードを確認します。BG／BOOK・メモ用の素材は通常フォルダーにも保管できます。シート上の表示フラグとCLIPの保存先は別々に指定します。</span></li>
        <li><strong>.xsrを保存する</strong><span>「プロジェクト」→「保存」で、紙シート、タイミング、素材対応、CSP構成を作業ファイルへ保存します。外部ソフトへ渡す前に保存しておくと、同じ状態から修正を再開できます。</span></li>
        <li><strong>CLIPを作成する</strong><span>「書き出し」→「CLIPを作成」でACTION／CELLと対象カットを選びます。左のレイヤー構造をそのまま保存します。既存CLIPの用紙サイズは維持し、新規CLIPでは用紙サイズを指定できます。画像は中央に配置し、用紙の外側は切り取ります。</span></li>
      </ol>
    </article>
    <article className="appHelpWorkflow">
      <h2>目的が違うときの選び方</h2>
      <ol>
        <li><strong>紙の文字を転記したい</strong><span>デスクトップ版の「文字認識」でACTIONまたはCELLを選び、候補を修正してから個別または一括で採用します。迷う候補は採用せず、シートへ直接入力します。</span></li>
        <li><strong>紙に列が収まらない</strong><span>入力は消えていません。欄外ラベルで位置を確認するか、表示テンプレートをデジタルへ切り替えるとすべての列を確認できます。</span></li>
        <li><strong>確認用のシートを渡したい</strong><span>JPG／PNGはすぐ見られる画像、PSDは表示内容をあとから調整できるレイヤー付き画像です。タイミングを対応ソフトへ渡す場合はXDTSを使います。</span></li>
        <li><strong>After Effectsへ渡したい</strong><span>1列だけなら列見出しの「AE用データをコピー」、複数列ならAfter Effects JSX、Windowsで起動中のAEへ渡すなら直接送信を選びます。1列コピーはAE側でタイムリマップ有効化とレイヤー延長を行い、JSXと直接送信は自動で行います。</span></li>
      </ol>
    </article>
  </>
}

type AppNavigationSubmenu = 'project' | 'import' | 'export'

function AppNavigationFlyout({
  submenu,
  label,
  tooltip,
  activeSubmenu,
  onActivate,
  menuClassName = '',
  children,
}: {
  submenu: AppNavigationSubmenu
  label: ReactNode
  tooltip: string
  activeSubmenu: AppNavigationSubmenu | null
  onActivate: (submenu: AppNavigationSubmenu | null) => void
  menuClassName?: string
  children: ReactNode
}) {
  const menuId = useId()
  const suppressFocusActivationRef = useRef(false)
  const open = activeSubmenu === submenu

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const trigger = event.currentTarget.querySelector<HTMLElement>('.appNavFlyoutTrigger')
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      if (!open) return
      event.preventDefault()
      event.stopPropagation()
      onActivate(null)
      if (trigger && document.activeElement !== trigger) {
        suppressFocusActivationRef.current = true
        trigger.focus()
        suppressFocusActivationRef.current = false
      }
      return
    }
    if ((event.key === 'ArrowRight' || event.key === 'ArrowDown') && event.target === trigger) {
      event.preventDefault()
      onActivate(submenu)
    }
  }

  return (
    <div
      className={open ? 'appNavFlyout submenuOpen' : 'appNavFlyout'}
      data-app-nav-submenu={submenu}
      onPointerEnter={() => onActivate(submenu)}
      onKeyDown={handleKeyDown}
    >
      <Tooltip label={tooltip}>
        <button
          type="button"
          className="appNavMenuItem appNavFlyoutTrigger"
          aria-controls={menuId}
          aria-expanded={open}
          data-action-menu-keep-open
          onClick={() => onActivate(submenu)}
          onFocus={() => {
            if (suppressFocusActivationRef.current) return
            onActivate(submenu)
          }}
        >
          {label}
        </button>
      </Tooltip>
      <div
        id={menuId}
        className={`appNavFlyoutMenu ${menuClassName}`.trim()}
      >
        {children}
      </div>
    </div>
  )
}

export function AppNavigationMenu({
  appName,
  appVersion,
  panels,
  panel,
  onSelect,
  onLoadProject,
  onLoadXdts,
  onLoadClip,
  onLoadTemplate,
  onSaveProject,
  onSaveProjectAs,
  onSaveTemplate,
  onResetApp,
  onOpenSheetImageExport,
  correctedSheetImagePageCount,
  correctedSheetImageExportSaving,
  onSaveCorrectedSheetImages,
  dialogueAudioExportSaving,
  onSaveDialogueAudioTracks,
  onSaveXdts,
  onSaveAeJsx,
  onSendAfterEffects,
  onCreateClip,
}: {
  appName: string
  appVersion: string
  panels: Panel[]
  panel: Panel
  onSelect: (panel: Panel) => void
  onLoadProject: (files: FileList | null) => void
  onLoadXdts: (files: FileList | null) => void
  onLoadClip?: (files: FileList | null) => void
  onLoadTemplate: (files: FileList | null) => void
  onSaveProject: () => void
  onSaveProjectAs: () => void
  onSaveTemplate: () => void
  onResetApp: () => void
  onOpenSheetImageExport: (format: SheetImageExportFormat) => void
  correctedSheetImagePageCount: number
  correctedSheetImageExportSaving: CorrectedSheetImageExportFormat | null
  onSaveCorrectedSheetImages?: (format: CorrectedSheetImageExportFormat) => void
  dialogueAudioExportSaving: DialogueAudioTrackExportFormat | null
  onSaveDialogueAudioTracks?: (format: DialogueAudioTrackExportFormat) => void
  onSaveXdts: () => void
  onSaveAeJsx: () => void
  onSendAfterEffects?: () => void
  onCreateClip: () => void
}) {
  const [activeSubmenu, setActiveSubmenu] = useState<AppNavigationSubmenu | null>(null)

  return (
    <ActionMenu
      label={<MenuIcon />}
      ariaLabel={uiText.nav.menu}
      tooltipLabel={uiText.nav.menuTitle}
      className="appNavMenu iconActionMenu"
      closeOnMenuItemClick
      onOpenChange={open => {
        if (!open) setActiveSubmenu(null)
      }}
    >
      <AppNavigationFlyout
        submenu="project"
        label="プロジェクト"
        tooltip="プロジェクトの新規作成・読込・保存"
        activeSubmenu={activeSubmenu}
        onActivate={setActiveSubmenu}
      >
          <Tooltip label={uiText.actions.resetAppTitle}>
            <button type="button" className="appNavMenuItem" onClick={onResetApp}>新規プロジェクト</button>
          </Tooltip>
          <TooltipTarget label={uiText.actions.loadProjectTitle}>
            {tooltipProps => (
              <label className="fileButton appNavMenuItem" {...tooltipProps}>
                プロジェクトを開く…
                <input type="file" accept={XSR_PROJECT_FILE_ACCEPT} onChange={event => { onLoadProject(event.currentTarget.files); event.currentTarget.value = '' }} />
              </label>
            )}
          </TooltipTarget>
          <Tooltip label={uiText.actions.saveProjectTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveProject}>{uiText.actions.saveProject}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.saveProjectAsTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveProjectAs}>名前を付けて保存…</button>
          </Tooltip>
      </AppNavigationFlyout>
      <AppNavigationFlyout
        submenu="import"
        label="読み込み"
        tooltip="外部データを現在のプロジェクトへ読み込む"
        activeSubmenu={activeSubmenu}
        onActivate={setActiveSubmenu}
      >
          {onLoadClip && <label className="fileButton appNavMenuItem">CLIPを読み込む…<input type="file" accept=".clip" onChange={event => { onLoadClip(event.currentTarget.files); event.currentTarget.value = '' }} /></label>}
          <TooltipTarget label="XDTSのキーと任意のSOUND/CAMERA指示を読み込む">
            {tooltipProps => (
              <label className="fileButton appNavMenuItem" {...tooltipProps}>
                XDTSを読み込む…
                <input type="file" accept=".xdts,text/plain,application/json" onChange={event => { onLoadXdts(event.currentTarget.files); event.currentTarget.value = '' }} />
              </label>
            )}
          </TooltipTarget>
          <TooltipTarget label="検証したシートテンプレートJSONを現在のプロジェクトへ適用する">
            {tooltipProps => (
              <label className="fileButton appNavMenuItem" {...tooltipProps}>
                シートテンプレートを読み込む…
                <input type="file" accept={SHEET_TEMPLATE_FILE_ACCEPT} onChange={event => { onLoadTemplate(event.currentTarget.files); event.currentTarget.value = '' }} />
              </label>
            )}
          </TooltipTarget>
      </AppNavigationFlyout>
      <AppNavigationFlyout
        submenu="export"
        label={uiText.actions.exportMenu}
        tooltip={uiText.actions.exportMenuTitle}
        activeSubmenu={activeSubmenu}
        onActivate={setActiveSubmenu}
        menuClassName="appNavExportFlyoutMenu"
      >
          <div className="imageExportMenuGroup appNavImageExportGroup" role="group" aria-label={uiText.actions.imageExportMenuTitle}>
            <div className="imageExportMenuLabel">タイムシート画像</div>
            <div className="imageExportFormatButtons">
              {(['jpg', 'png', 'psd'] as SheetImageExportFormat[]).map(format => {
                const label = format.toUpperCase()
                return (
                  <Tooltip key={format} label={uiText.actions.imageExportFormatTitle(label)}>
                    <button type="button" aria-label={`タイムシート画像を${label}形式で書き出す`} onClick={() => onOpenSheetImageExport(format)}>
                      {label}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </div>
          {onSaveCorrectedSheetImages && correctedSheetImagePageCount > 0 && (
            <div
              className="imageExportMenuGroup appNavCorrectedSheetExportGroup"
              role="group"
              aria-label={uiText.actions.correctedSheetImageExportLabel(correctedSheetImagePageCount)}
            >
              <div className="imageExportMenuLabel">{uiText.actions.correctedSheetImageExportLabel(correctedSheetImagePageCount)}</div>
              <div className="imageExportFormatButtons">
                {(['jpg', 'png', 'psd'] as CorrectedSheetImageExportFormat[]).map(format => {
                  const label = format.toUpperCase()
                  const accessibleLabel = uiText.actions.correctedSheetImageExportFormatTitle(label, correctedSheetImagePageCount)
                  return (
                    <Tooltip key={format} label={accessibleLabel}>
                      <button
                        type="button"
                        aria-label={accessibleLabel}
                        data-export-format={format}
                        disabled={correctedSheetImageExportSaving !== null}
                        onClick={() => onSaveCorrectedSheetImages(format)}
                      >
                        {correctedSheetImageExportSaving === format ? '保存中…' : label}
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
              <span className="appNavCorrectedSheetExportHint">{uiText.actions.correctedSheetImageExportTitle}</span>
            </div>
          )}
          {onSaveDialogueAudioTracks && (
            <div className="imageExportMenuGroup appNavDialogueAudioExportGroup" role="group" aria-label={uiText.actions.dialogueAudioExport}>
              <div className="imageExportMenuLabel">{uiText.actions.dialogueAudioExport}</div>
              <div className="imageExportFormatButtons">
                {(['wav', 'mp3'] as DialogueAudioTrackExportFormat[]).map(format => {
                  const label = format.toUpperCase()
                  const accessibleLabel = uiText.actions.dialogueAudioExportFormatTitle(label)
                  return (
                    <Tooltip key={format} label={accessibleLabel}>
                      <button
                        type="button"
                        aria-label={accessibleLabel}
                        data-export-format={format}
                        disabled={dialogueAudioExportSaving !== null}
                        onClick={() => onSaveDialogueAudioTracks(format)}
                      >
                        {dialogueAudioExportSaving === format ? '保存中…' : label}
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          )}
          <Tooltip label={uiText.actions.xdtsTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveXdts}>{uiText.actions.xdts}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.aeJsxTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveAeJsx}>{uiText.actions.aeJsx}</button>
          </Tooltip>
          {onSendAfterEffects && (
            <Tooltip label={uiText.actions.aeSendTitle}>
              <button type="button" className="appNavMenuItem" onClick={onSendAfterEffects}>{uiText.actions.aeSend}</button>
            </Tooltip>
          )}
          <Tooltip label={uiText.actions.cspImportPackageTitle}>
            <button type="button" className="appNavMenuItem" onClick={onCreateClip}>CLIPを作成…</button>
          </Tooltip>
          <Tooltip label={uiText.actions.templateJsonTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveTemplate}>シートテンプレート（JSON）を書き出す…</button>
          </Tooltip>
      </AppNavigationFlyout>
      <button type="button" className="appNavMenuItem" onClick={requestTemplateEditor} onFocus={() => setActiveSubmenu(null)} onPointerEnter={() => setActiveSubmenu(null)}>テンプレートを作成・編集…</button>
      <div className="appNavSectionLabel" onPointerEnter={() => setActiveSubmenu(null)}>ワークスペース</div>
      {panels.map(item => (
        <Tooltip key={item} label={uiText.nav.workspaceItemTitle(panelLabel(item))}>
          <button
            type="button"
            className={item === panel ? 'appNavMenuItem active' : 'appNavMenuItem'}
            aria-current={item === panel ? 'page' : undefined}
            onClick={() => onSelect(item)}
            onFocus={() => setActiveSubmenu(null)}
            onPointerEnter={() => setActiveSubmenu(null)}
          >
            {panelLabel(item)}
          </button>
        </Tooltip>
      ))}
      <div className="appNavVersionLabel" aria-label={`${appName} バージョン ${appVersion}`} onPointerEnter={() => setActiveSubmenu(null)}>
        {appName} v{appVersion}
      </div>
    </ActionMenu>
  )
}

function panelLabel(panel: Panel): string {
  switch (panel) {
    case 'sheet':
      return uiText.nav.sheet
    case 'template':
      return uiText.nav.template
  }
}

export function sheetSourceLabel(source: SheetSource): string {
  return source.imageRef.name
}

export function calibrationCornersForTemplate(template: Pick<SheetTemplate, 'regions'>): SheetImageAlignment['corners'] | null {
  const rect = calibrationTargetRectForTemplate(template)
  if (!rect) return null
  return cornersFromRect(rect)
}

export function shouldAutoCalibrateImportedSheetSources(template: SheetTemplate): boolean {
  if (!isTauriHost()) return false
  const layout = getSheetViewLayout(template)
  return layout.surface?.type === 'fixed-page' && Boolean(calibrationTargetRectForTemplate(template))
}

export function calibrationCornersFromPoints(
  points: SheetCalibrationPointPair[],
  kind: CalibrationPointKind,
): SheetImageAlignment['corners'] | null {
  if (points.length < 4) return null
  return {
    tl: { ...points[0][kind] },
    tr: { ...points[1][kind] },
    br: { ...points[2][kind] },
    bl: { ...points[3][kind] },
  }
}

function cornersFromRect(rect: NormalizedRect): SheetImageAlignment['corners'] {
  return {
    tl: { x: rect.x, y: rect.y },
    tr: { x: rect.x + rect.w, y: rect.y },
    br: { x: rect.x + rect.w, y: rect.y + rect.h },
    bl: { x: rect.x, y: rect.y + rect.h },
  }
}

export function imageExportFilterName(format: SheetImageExportFormat): string {
  switch (format) {
    case 'jpg':
      return 'JPEG'
    case 'png':
      return 'PNG'
    case 'psd':
      return 'PSD'
  }
}
