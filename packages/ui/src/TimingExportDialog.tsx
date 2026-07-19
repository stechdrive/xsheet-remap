import type { SheetTemplate, SheetTimingRole, ValidationIssue } from '@xsheet-remap/core'
import { isTauriHost } from '@xsheet-remap/adapters'
import { issueMessage, severityLabel } from './i18n'
import type { TimingExportDialogState } from './appTypes'

export function TimingExportDialog({
  state,
  template,
  assetRootPath,
  issues,
  onChangeRole,
  onChangeOptions,
  onCancel,
  onConfirm,
}: {
  state: TimingExportDialogState
  template: SheetTemplate
  assetRootPath?: string
  issues: ValidationIssue[]
  onChangeRole: (role: SheetTimingRole) => void
  onChangeOptions: (updates: Partial<Pick<TimingExportDialogState, 'includeSound' | 'includeCamera'>>) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const blockingIssues = issues.filter(issue => issue.severity === 'error')
  const visibleIssues = issues.filter(issue => issue.severity !== 'info').slice(0, 8)
  const portableBrowserExport = state.kind === 'csp-import' && !isTauriHost()
  const rootMissing = state.kind === 'csp-import' && !portableBrowserExport && !assetRootPath
  const disabled = blockingIssues.length > 0 || rootMissing
  const actionLabel = template.style?.gridHeader?.labelOverrides?.action || 'ACTION'
  const cellLabel = template.style?.gridHeader?.labelOverrides?.cell || 'CELL'

  return (
    <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label={state.kind === 'csp-import' ? 'CSP自動登録データを書き出す…' : 'XDTSを書き出す…'} onPointerDown={onCancel}>
      <section className="timingExportDialog" onPointerDown={event => event.stopPropagation()}>
        <header>
          <strong>{state.kind === 'csp-import' ? 'CSP自動登録データを書き出す' : 'XDTSを書き出す'}</strong>
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
          {state.kind === 'xdts' && (
            <div className="xdtsImportOptions">
              <label><input type="checkbox" checked={state.includeSound} onChange={event => onChangeOptions({ includeSound: event.currentTarget.checked })} /> SOUNDを含める</label>
              <label><input type="checkbox" checked={state.includeCamera} onChange={event => onChangeOptions({ includeCamera: event.currentTarget.checked })} /> CAMERAを含める</label>
            </div>
          )}
          {state.kind === 'csp-import' && (
            <label className="timingExportPathField">
              <span>{portableBrowserExport ? '保存形式' : 'カットフォルダ'}</span>
              <input value={portableBrowserExport ? '素材同梱ZIP（ブラウザ保存）' : assetRootPath || '未設定'} readOnly />
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
