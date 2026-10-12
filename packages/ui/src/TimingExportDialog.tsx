import type { LogicalTimelineSection, SheetTimingRole, ValidationIssue } from '@xsheet-remap/core'
import { issueMessage, severityLabel, uiText } from './i18n'
import type { TimingExportDialogState } from './appTypes'

export function TimingExportDialog({
  state,
  timelineSections,
  issues,
  afterEffectsSending = false,
  onChangeRole,
  onChangeOptions,
  onCancel,
  onConfirm,
}: {
  state: TimingExportDialogState
  timelineSections: readonly LogicalTimelineSection[]
  issues: ValidationIssue[]
  afterEffectsSending?: boolean
  onChangeRole: (role: SheetTimingRole) => void
  onChangeOptions: (updates: Partial<Pick<TimingExportDialogState, 'includeSound' | 'includeCamera'>>) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const xdtsBlockingIssues = issues.filter(issue => issue.severity === 'error')
  const visibleXdtsIssues = issues.filter(issue => issue.severity !== 'info').slice(0, 8)
  const busy = state.kind === 'ae-send' && afterEffectsSending
  const disabled = busy || (state.kind === 'xdts' && xdtsBlockingIssues.length > 0)
  const dialogLabel = timingExportDialogLabel(state.kind)
  const actionLabel = timelineSectionLabel(timelineSections, 'action', 'ACTION')
  const soundLabel = timelineSectionLabel(timelineSections, 'sound', 'SOUND')
  const cellLabel = timelineSectionLabel(timelineSections, 'cell', 'CELL')
  const cameraLabel = timelineSectionLabel(timelineSections, 'camera', 'CAMERA')

  return (
    <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label={dialogLabel} onPointerDown={busy ? undefined : onCancel}>
      <section className="timingExportDialog" onPointerDown={event => event.stopPropagation()}>
        <header>
          <strong>{dialogLabel.replace(/…$/, '')}</strong>
          <button type="button" aria-label="閉じる" disabled={busy} onClick={onCancel}>×</button>
        </header>
        <div className="timingExportDialogBody">
          <fieldset>
            <legend>書き出すタイムライン</legend>
            <div className="segmented" role="group" aria-label="書き出すタイムライン">
              <button type="button" disabled={busy} className={state.timingSourceRole === 'action' ? 'active' : ''} aria-pressed={state.timingSourceRole === 'action'} onClick={() => onChangeRole('action')}>{actionLabel}</button>
              <button type="button" disabled={busy} className={state.timingSourceRole === 'cell' ? 'active' : ''} aria-pressed={state.timingSourceRole === 'cell'} onClick={() => onChangeRole('cell')}>{cellLabel}</button>
            </div>
          </fieldset>
          {state.kind === 'xdts' && (
            <div className="xdtsImportOptions">
              <label><input type="checkbox" checked={state.includeSound} onChange={event => onChangeOptions({ includeSound: event.currentTarget.checked })} /> {soundLabel}を含める</label>
              <label><input type="checkbox" checked={state.includeCamera} onChange={event => onChangeOptions({ includeCamera: event.currentTarget.checked })} /> {cameraLabel}を含める</label>
            </div>
          )}
          {(state.kind === 'ae-jsx' || state.kind === 'ae-send') && (
            <p>{state.kind === 'ae-send' ? uiText.afterEffects.sendDescription : uiText.afterEffects.jsxDescription}</p>
          )}
          {state.kind === 'xdts' && visibleXdtsIssues.length > 0 && (
            <div className="timingExportIssues">
              {visibleXdtsIssues.map(issue => (
                <div className={`issue ${issue.severity}`} key={issue.issueId}>
                  <strong>{severityLabel(issue.severity)}</strong>
                  <span>{issueMessage(issue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onCancel}>キャンセル</button>
          <button type="button" className="primary" disabled={disabled} onClick={onConfirm}>
            {busy ? (state.kind === 'ae-send' ? '送信中…' : '書き出し中…') : state.kind === 'ae-send' ? '送信する' : '書き出す'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function timingExportDialogLabel(kind: TimingExportDialogState['kind']): string {
  if (kind === 'ae-jsx') return uiText.actions.aeJsx
  if (kind === 'ae-send') return uiText.actions.aeSend
  return uiText.actions.xdts
}

function timelineSectionLabel(
  sections: readonly LogicalTimelineSection[],
  role: LogicalTimelineSection['role'],
  fallback: string,
): string {
  return sections.find(section => section.role === role)?.label.trim() || fallback
}
