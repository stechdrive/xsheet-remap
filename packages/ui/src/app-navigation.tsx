import { type CutMetadataFieldId, type CutProject, type NormalizedRect, type SheetImageAlignment, type SheetCalibrationPointPair, type SheetSource, type SheetTemplate, type SheetTimingRole, type RecognitionCandidate, getSheetViewLayout, sheetTimingRoleForEvent } from '@xsheet-remap/core'
import { isTauriHost } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { type Panel } from './appTypes'
import { type SheetImageExportFormat } from './cleanSheetExport'
import { calibrationTargetRectForTemplate } from './sheetImages'
import { Tooltip, TooltipTarget } from './Tooltip'
import { ActionMenu } from './AppControls'
import { CalibrationPointKind, RegisteredCellSortDirection, type MainAppKind } from './app-foundation'
import { gridHeaderLabelForRole } from './templateEditorGeometry'
import { DurationFrameControl } from './DurationFrameControl'

export function RecognitionActionMenu({
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
    region.type === 'exposure-grid' && region.grid?.role === role,
  ))
  return (
    <ActionMenu
      label={<span>OCR</span>}
      ariaLabel={uiText.recognition.menu}
      tooltipLabel={uiText.recognition.menuTitle}
      className="sheetRecognitionMenu"
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

export function TrashIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 14h8l1-14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
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
    <svg className="topIconSvg displayTemplateIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="2" width="21" height="20" rx="1.8" />
      <path d="M1.5 7.7h21" />
      <path d="M6.75 7.7v14.3" />
      <path d="M12 7.7v14.3" />
      <path d="M17.25 7.7v14.3" />
      <path d="M1.5 12.5h21" />
      <path d="M1.5 17.3h21" />
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
  return (
    <div className="appHelpBackdrop" role="dialog" aria-modal="true" aria-label={`${appName}の使い方`}>
      <section className="appHelpDialog">
        <header>
          <div>
            <strong>{appName}の使い方</strong>
            <span>{isEditor
              ? 'デジタルタイムシートの作成、編集、保存と、紙シートを下絵に使う流れを説明します。'
              : 'CSPはCLIP STUDIO PAINT、つまりクリスタのことです。ここでは主な作業の流れを説明します。'}</span>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="appHelpBody">
          {isEditor ? <EditorHelpContent /> : <RemapHelpContent appName={appName} />}
        </div>
        <footer>
          <p>{isEditor
            ? 'PWA版ではプロジェクトや出力物をブラウザのダウンロードとして保存します。OCRとネイティブのファイルパスを必要とする処理はデスクトップ版専用です。'
            : 'CSP自動登録は、同梱のxsheet-importerがクリスタを操作して行います。csp-import.xciはxsheet-importer用の登録ファイルであり、クリスタへ直接読み込むファイルではありません。'}</p>
        </footer>
      </section>
    </div>
  )
}

function EditorHelpContent() {
  return <>
    <article className="appHelpWorkflow">
      <h2>デジタルタイムシートを作成・保存する</h2>
      <p>カット情報と尺を設定し、ACTION、CELL、CAMERA、SOUNDの各欄へタイミングを入力します。</p>
      <ol>
        <li><strong>カット情報と尺を設定する</strong><span>上部のカット情報から作品名、話数、シーン、カット番号、尺を入力します。尺を変更すると、シートの作業範囲とページ数へ反映されます。</span></li>
        <li><strong>フレームまたは範囲を選んで入力する</strong><span>セルをクリックして文字を入力するか、右クリックメニューからキー、カラセル、中割、逆シートを設定します。ドラッグした範囲にはコピー、切り取り、貼り付け、リピート貼り付けを使えます。</span></li>
        <li><strong>兼用カットとシート履歴を管理する</strong><span>「兼用」の＋で同じ登録セルと素材を共有するカットを追加します。選択中のカットはゴミ箱から削除でき、最後の1カットは安全のため削除できません。右側のシート履歴では修正シートを追加・切替できます。</span></li>
        <li><strong>プロジェクトを保存する</strong><span>メニューの「保存」または「名前を付けて保存」で.xsrプロジェクトを保存します。デスクトップ版は選択した場所へ保存し、PWA版はブラウザからダウンロードします。</span></li>
      </ol>
    </article>
    <article className="appHelpWorkflow appHelpWorkflowPrep">
      <h2>紙タイムシートを下絵に使う（任意）</h2>
      <p>紙シートがなくても入力できます。読み込む場合は、テンプレートに合うdpiでスキャンした画像を使います。</p>
      <ol>
        <li><strong>紙シート画像を読み込む</strong><span>上部の「紙シート」から「読込」を選びます。複数ページもまとめて追加できます。</span></li>
        <li><strong>四隅と濃さを補正する</strong><span>「補正」または「四隅拡大」で罫線を合わせ、「レベル補正」と画像不透明度で入力内容を見やすくします。この下絵補正はOCRを使わず、PWA版でも利用できます。</span></li>
        <li><strong>必要なら認識結果を採用する</strong><span>OCRによる文字認識はデスクトップ版だけの補助機能です。PWA版では無効ですが、紙シートの表示・補正と手入力はそのまま使えます。</span></li>
      </ol>
    </article>
    <article className="appHelpWorkflow">
      <h2>表示・テンプレート・書き出し</h2>
      <ol>
        <li><strong>見やすい表示と注釈を使う</strong><span>全体表示、連続/見開き表示、罫線・下絵の表示切替、ペン・テキスト注釈を使って確認しやすい状態にします。</span></li>
        <li><strong>シートテンプレートを編集する</strong><span>「シートテンプレ」ワークスペースで既存テンプレートを複製し、情報欄、入力欄、罫線、文字、ページ寸法を調整して適用します。</span></li>
        <li><strong>用途に合わせて書き出す</strong><span>確認用にはJPG/PNG/PSD、他ソフトとの連携にはXDTSを使います。CSP自動登録データは、デスクトップ版では選択した保存先へ、PWA版ではZIPとしてダウンロードします。</span></li>
      </ol>
    </article>
  </>
}

function RemapHelpContent({ appName }: { appName: string }) {
  return <>
    <article className="appHelpWorkflow appHelpWorkflowPrep">
      <h2>必ず先に準備すること</h2>
      <p>CSPはCLIP STUDIO PAINT、つまりクリスタのことです。クリスタへ組み込む前に、紙シート画像と作画素材を用意します。</p>
      <ol>
        <li><strong>タイムシート画像を指定dpiでスキャンする</strong><span>紙タイムシートを読み込む場合は、使用する表示テンプレートに合わせたdpiでスキャンしてください。紙シート画像を下敷きにして、シート上のキーや登録内容を確認できるようになります。</span></li>
        <li><strong>作画素材をOLMペグホールスタビライザーで揃える</strong><span>スキャンした作画素材は、読み込み前にタップ穴基準の位置合わせを済ませてください。位置合わせ後の画像をこのアプリへ読み込みます。</span></li>
        <li><strong>作画素材を読み込める場所にまとめる</strong><span>作画素材はカットフォルダなどにまとめます。素材ブラウザのクイックビューで中身を確認し、該当するシート上のキーへ置くことで素材とタイムシートを紐づけます。</span></li>
      </ol>
    </article>
    <article className="appHelpWorkflow">
      <h2>CSP組み込み用シートを作る</h2>
      <p>{appName}でタイムシートと素材対応を作り、ヘルパーでCLIP STUDIO PAINT（クリスタ）へ登録します。</p>
      <ol>
        <li><strong>紙シート画像を読み込む</strong><span>上部の「紙シート」から「読込」を押します。必要なら「補正」で四隅を合わせ、「レベル補正」で薄いスキャンを見やすくします。</span></li>
        <li><strong>画像素材を素材ブラウザへ入れる</strong><span>カットフォルダまたは画像ファイルを右側の素材ブラウザへドロップします。素材カードからプレビューを確認できます。</span></li>
        <li><strong>素材をセル欄へドラッグしてキーを作る</strong><span>素材カードをシート上のCELL/ACTION/CAMERA欄へ置きます。範囲選択してから素材を置くと、開始位置へまとめて割り当てできます。</span></li>
        <li><strong>CSPレイヤー構成を確認する</strong><span>左のCSPレイヤー構成で、工程、CSPセル名、重ね順を確認します。BG/BOOKやメモも同じツリーで管理します。</span></li>
        <li><strong>クリスタ用の名前を整える</strong><span>必要に応じて、登録セル名・クリスタセル名・実ファイル名をまとめて整えます。クリスタはファイル名をセル名として扱うため、ここを揃えるのが重要です。</span></li>
        <li><strong>CSP自動登録データを書き出す</strong><span>書き出すとxsheet-importer用の登録ファイル（csp-import.xci）、XDTS、素材参照が作られます。csp-import.xciはクリスタではなく、xsheet-importerで選択します。</span></li>
      </ol>
    </article>
  </>
}

export function AppNavigationMenu({
  appName,
  appVersion,
  panels,
  panel,
  onSelect,
  onLoadProject,
  onLoadXdts,
  onLoadTemplate,
  onSaveProject,
  onSaveProjectAs,
  onSaveTemplate,
  onResetApp,
  onOpenSheetImageExport,
  onSaveXdts,
  onSaveCspImportPackage,
}: {
  appName: string
  appVersion: string
  panels: Panel[]
  panel: Panel
  onSelect: (panel: Panel) => void
  onLoadProject: (files: FileList | null) => void
  onLoadXdts: (files: FileList | null) => void
  onLoadTemplate: (files: FileList | null) => void
  onSaveProject: () => void
  onSaveProjectAs: () => void
  onSaveTemplate: () => void
  onResetApp: () => void
  onOpenSheetImageExport: (format: SheetImageExportFormat) => void
  onSaveXdts: () => void
  onSaveCspImportPackage: () => void
}) {
  return (
    <ActionMenu label={<MenuIcon />} ariaLabel={uiText.nav.menu} tooltipLabel={uiText.nav.menuTitle} className="appNavMenu iconActionMenu" closeOnMenuItemClick>
      <div className="appNavFlyout">
        <Tooltip label="プロジェクトの新規作成・読込・保存">
          <button type="button" className="appNavMenuItem appNavFlyoutTrigger" data-action-menu-keep-open>
            プロジェクト
          </button>
        </Tooltip>
        <div className="appNavFlyoutMenu">
          <Tooltip label={uiText.actions.resetAppTitle}>
            <button type="button" className="appNavMenuItem" onClick={onResetApp}>新規プロジェクト</button>
          </Tooltip>
          <TooltipTarget label={uiText.actions.loadProjectTitle}>
            {tooltipProps => (
              <label className="fileButton appNavMenuItem" {...tooltipProps}>
                プロジェクトを開く…
                <input type="file" accept=".json,application/json" onChange={event => { onLoadProject(event.currentTarget.files); event.currentTarget.value = '' }} />
              </label>
            )}
          </TooltipTarget>
          <Tooltip label={uiText.actions.saveProjectTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveProject}>{uiText.actions.saveProject}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.projectJsonTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveProjectAs}>名前を付けて保存…</button>
          </Tooltip>
        </div>
      </div>
      <div className="appNavFlyout">
        <Tooltip label="外部データを現在のプロジェクトへ読み込む">
          <button type="button" className="appNavMenuItem appNavFlyoutTrigger" data-action-menu-keep-open>読み込み</button>
        </Tooltip>
        <div className="appNavFlyoutMenu">
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
                <input type="file" accept=".json,application/json" onChange={event => { onLoadTemplate(event.currentTarget.files); event.currentTarget.value = '' }} />
              </label>
            )}
          </TooltipTarget>
        </div>
      </div>
      <div className="appNavFlyout">
        <Tooltip label={uiText.actions.exportMenuTitle}>
          <button type="button" className="appNavMenuItem appNavFlyoutTrigger" data-action-menu-keep-open>
            {uiText.actions.exportMenu}
          </button>
        </Tooltip>
        <div className="appNavFlyoutMenu appNavExportFlyoutMenu">
          <div className="imageExportMenuGroup appNavImageExportGroup" aria-label={uiText.actions.imageExportMenuTitle}>
            <div className="imageExportMenuLabel">タイムシート画像</div>
            <div className="imageExportFormatButtons">
              {(['jpg', 'png', 'psd'] as SheetImageExportFormat[]).map(format => {
                const label = format.toUpperCase()
                return (
                  <Tooltip key={format} label={uiText.actions.imageExportFormatTitle(label)}>
                    <button type="button" onClick={() => onOpenSheetImageExport(format)}>
                      {label}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </div>
          <Tooltip label={uiText.actions.xdtsTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveXdts}>XDTSを書き出す…</button>
          </Tooltip>
          <Tooltip label={uiText.actions.cspImportPackageTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveCspImportPackage}>CSP自動登録データを書き出す…</button>
          </Tooltip>
          <Tooltip label={uiText.actions.templateJsonTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveTemplate}>シートテンプレート（JSON）を書き出す…</button>
          </Tooltip>
        </div>
      </div>
      <div className="appNavSectionLabel">ワークスペース</div>
      {panels.map(item => (
        <Tooltip key={item} label={uiText.nav.workspaceItemTitle(panelLabel(item))}>
          <button
            type="button"
            className={item === panel ? 'appNavMenuItem active' : 'appNavMenuItem'}
            aria-current={item === panel ? 'page' : undefined}
            onClick={() => onSelect(item)}
          >
            {panelLabel(item)}
          </button>
        </Tooltip>
      ))}
      <div className="appNavVersionLabel" aria-label={`${appName} バージョン ${appVersion}`}>
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
