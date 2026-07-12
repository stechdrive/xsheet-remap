import type { SheetTemplate, SheetTimingRole, ValidationIssue } from '@xsheet-remap/core'
import { issueMessage, severityLabel } from './i18n'
import type { TimingExportDialogState } from './appTypes'

export function TimingExportDialog({
  state,
  template,
  assetRootPath,
  issues,
  onChangeRole,
  onCancel,
  onConfirm,
}: {
  state: TimingExportDialogState
  template: SheetTemplate
  assetRootPath?: string
  issues: ValidationIssue[]
  onChangeRole: (role: SheetTimingRole) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const blockingIssues = issues.filter(issue => issue.severity === 'error')
  const visibleIssues = issues.filter(issue => issue.severity !== 'info').slice(0, 8)
  const rootMissing = state.kind === 'csp-import' && !assetRootPath
  const disabled = blockingIssues.length > 0 || rootMissing
  const actionLabel = template.style?.gridHeader?.labelOverrides?.action || 'ACTION'
  const cellLabel = template.style?.gridHeader?.labelOverrides?.cell || 'CELL'

  return (
    <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label={state.kind === 'csp-import' ? 'タイムシート/CSP自動登録' : 'XDTS書き出し'} onPointerDown={onCancel}>
      <section className="timingExportDialog" onPointerDown={event => event.stopPropagation()}>
        <header>
          <strong>{state.kind === 'csp-import' ? 'タイムシート/CSP自動登録' : 'XDTS書き出し'}</strong>
          <button type="button" aria-label="閉じる" onClick={onCancel}>×</button>
        </header>
        <div className="timingExportDialogBody">
          <fieldset>
            <legend>書き出すタイムライン</legend>
            <div className="segmented" role="group" aria-label="書き出すタイムライン">
              <button type="button" className={state.timingSourceRole === 'action' ? 'active' : ''} aria-pressed={state.timingSourceRole === 'action'} onClick={() => onChangeRole('action')}>{actionLabel}</button>
              <button type="button" className={state.timingSourceRole === 'cell' ? 'active' : ''} aria-pressed={state.timingSourceRole === 'cell'} onClick={() => onChangeRole('cell')}>{cellLabel}</button>
            </div>
          </fieldset>
          {state.kind === 'csp-import' && (
            <label className="timingExportPathField">
              <span>カットフォルダ</span>
              <input value={assetRootPath || '未設定'} readOnly />
            </label>
          )}
          {rootMissing && <div className="issue error"><strong>エラー</strong><span>画像素材ペインでカットフォルダを設定してください。</span></div>}
          {visibleIssues.length > 0 && (
            <div className="timingExportIssues">
              {visibleIssues.map(issue => (
                <div className={`issue ${issue.severity}`} key={issue.issueId}>
                  <strong>{severityLabel(issue.severity)}</strong>
                  <span>{issueMessage(issue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer>
          <button type="button" onClick={onCancel}>キャンセル</button>
          <button type="button" className="primary" disabled={disabled} onClick={onConfirm}>書き出し</button>
        </footer>
      </section>
    </div>
  )
}
