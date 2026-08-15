import { ActionMenu, ToolbarGroup } from './AppControls'
import { uiText } from './i18n'
import type { PaperTimelineAlignment } from './paperTimelineAuthoring'
import { PaperRegionAlignmentControls } from './template-workspace-paper-controls'
import { TemplateEditorViewControls } from './TemplateEditorViewControls'
import type { TemplateEditorViewStore } from './templateEditorViewStore'
import { Tooltip, TooltipTarget } from './Tooltip'

export function TemplateDocumentToolbar({
  mode,
  templateName,
  draftStatus,
  dirty,
  saveNotice,
  canComplete,
  errorCount,
  onReturnToStart,
  onReview,
  onSave,
  onApply,
  onCancel,
  onCreate,
  onLoad,
  onShowJson,
  onOpenProcessSettings,
}: {
  mode: 'project' | 'standalone'
  templateName: string
  draftStatus: string
  dirty: boolean
  saveNotice: string | null
  canComplete: boolean
  errorCount: number
  onReturnToStart?: () => void
  onReview: () => void
  onSave: () => void
  onApply: () => void
  onCancel: () => void
  onCreate: () => void
  onLoad: (files: FileList | null) => void
  onShowJson: () => void
  onOpenProcessSettings: () => void
}) {
  return <div className="toolRow templateToolbar templateDocumentToolbar">
    <ToolbarGroup className="templateDocumentIdentity">
      {mode === 'standalone' && onReturnToStart && <button type="button" onClick={onReturnToStart}>作り方へ戻る</button>}
      <strong className="templateDocumentTitle">{templateName}</strong>
      <span className={`templateDraftStatus ${dirty ? 'dirty' : ''}`.trim()}>{draftStatus}</span>
      {saveNotice && <span className="templateSaveNotice" role="status">{saveNotice}</span>}
    </ToolbarGroup>
    <ToolbarGroup className="templateDocumentActions">
      <button type="button" className={canComplete ? '' : 'templateReviewBlocked'} onClick={onReview}>確認 {errorCount > 0 ? `(${errorCount})` : '✓'}</button>
      <button type="button" className={mode === 'standalone' ? 'primary' : ''} onClick={onSave}>{mode === 'standalone' ? '確認して保存' : 'テンプレートJSONを保存'}</button>
      {mode === 'project' && <><button type="button" className="primary" disabled={!dirty || !canComplete} onClick={onApply}>プロジェクトへ反映</button><button type="button" disabled={!dirty} onClick={onCancel}>変更を取り消す</button></>}
      <ActionMenu label="その他" ariaLabel="テンプレートのその他の操作" tooltipLabel="新規作成、JSONを開く、JSON表示" closeOnMenuItemClick>
        <button type="button" onClick={onCreate}>新しいテンプレート</button>
        <TooltipTarget label={uiText.actions.loadTemplateJsonTitle}>{tooltipProps => <label className="fileButton actionMenuFileButton" {...tooltipProps}>{uiText.actions.loadTemplateJson}<input type="file" accept=".json,application/json" onChange={event => { onLoad(event.currentTarget.files); event.currentTarget.value = '' }} /></label>}</TooltipTarget>
        <button type="button" onClick={onShowJson}>JSONを表示</button>
      </ActionMenu>
    </ToolbarGroup>
    {mode === 'project' && <ToolbarGroup className="templateProcessToolbarGroup"><Tooltip label={uiText.sheet.processSettingsTitle}><button type="button" className="processSettingsOpenButton" onClick={onOpenProcessSettings}>工程設定</button></Tooltip></ToolbarGroup>}
  </div>
}

export function TemplateRegionAddMenu({ managedTimeline, onAddMetadata, onAddForm, onAddGrid, onAddDecorative }: {
  managedTimeline: boolean
  onAddMetadata: () => void
  onAddForm: () => void
  onAddGrid: (role: 'action' | 'sound' | 'cell' | 'camera') => void
  onAddDecorative: () => void
}) {
  return <ActionMenu label="＋ 要素" ariaLabel="要素を追加" tooltipLabel="テンプレートへ要素を追加" closeOnMenuItemClick>
    <button type="button" onClick={onAddMetadata}>{uiText.actions.addMetadataRegion}</button>
    <button type="button" onClick={onAddForm}>入力表を追加</button>
    {!managedTimeline && <><button type="button" onClick={() => onAddGrid('action')}>{uiText.actions.addActionRegion}</button><button type="button" onClick={() => onAddGrid('sound')}>{uiText.actions.addSoundRegion}</button><button type="button" onClick={() => onAddGrid('cell')}>{uiText.actions.addCellRegion}</button><button type="button" onClick={() => onAddGrid('camera')}>{uiText.actions.addCameraRegion}</button></>}
    <button type="button" onClick={onAddDecorative}>{uiText.actions.addDecorativeGridRegion}</button>
  </ActionMenu>
}

export function TemplateCanvasToolbar({ store, hasReferenceImage, canAlign, onFit, onAlign }: {
  store: TemplateEditorViewStore
  hasReferenceImage: boolean
  canAlign: boolean
  onFit: () => void
  onAlign: (alignment: PaperTimelineAlignment, target: 'page' | 'timeline') => void
}) {
  return <>
    {canAlign && <ActionMenu label="整列" ariaLabel="選択要素を整列" tooltipLabel="用紙または6秒表へ揃える">
      <div className="templateAlignmentMenuGroup"><strong>用紙へ揃える</strong><div><PaperRegionAlignmentControls onAlign={alignment => onAlign(alignment, 'page')} /></div></div>
      <div className="templateAlignmentMenuGroup"><strong>6秒表へ揃える</strong><div><PaperRegionAlignmentControls onAlign={alignment => onAlign(alignment, 'timeline')} /></div></div>
    </ActionMenu>}
    <TemplateEditorViewControls store={store} hasReferenceImage={hasReferenceImage} onFit={onFit} />
  </>
}
