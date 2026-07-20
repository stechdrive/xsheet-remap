import type { LogicalTimelineSection, SheetTimingRole, ValidationIssue } from '@xsheet-remap/core'
import { issueMessage, severityLabel } from './i18n'
import type { TimingExportDialogState } from './appTypes'
import type { CspImportExportState } from './useCspImportExportPlan'

export function TimingExportDialog({
  state,
  timelineSections,
  issues,
  cspImportState,
  onChangeRole,
  onChangeOptions,
  onReconnectAssetRoot,
  onCancel,
  onConfirm,
}: {
  state: TimingExportDialogState
  timelineSections: readonly LogicalTimelineSection[]
  issues: ValidationIssue[]
  cspImportState: CspImportExportState
  onChangeRole: (role: SheetTimingRole) => void
  onChangeOptions: (updates: Partial<Pick<TimingExportDialogState, 'includeSound' | 'includeCamera'>>) => void
  onReconnectAssetRoot: () => void | Promise<unknown>
  onCancel: () => void
  onConfirm: () => void
}) {
  const xdtsBlockingIssues = issues.filter(issue => issue.severity === 'error')
  const visibleXdtsIssues = issues.filter(issue => issue.severity !== 'info').slice(0, 8)
  const cspPlan = cspImportState.plan
  const cspBlockingIssues = cspPlan?.blockingIssues ?? []
  const disabled = state.kind === 'csp-import'
    ? cspImportState.phase !== 'ready' || cspBlockingIssues.length > 0
    : xdtsBlockingIssues.length > 0
  const actionLabel = timelineSectionLabel(timelineSections, 'action', 'ACTION')
  const soundLabel = timelineSectionLabel(timelineSections, 'sound', 'SOUND')
  const cellLabel = timelineSectionLabel(timelineSections, 'cell', 'CELL')
  const cameraLabel = timelineSectionLabel(timelineSections, 'camera', 'CAMERA')

  return (
    <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label={state.kind === 'csp-import' ? 'CSP自動登録データを書き出す…' : 'XDTSを書き出す…'} onPointerDown={onCancel}>
      <section className="timingExportDialog" onPointerDown={event => event.stopPropagation()}>
        <header>
          <strong>{state.kind === 'csp-import' ? 'CSP自動登録データを書き出す' : 'XDTSを書き出す'}</strong>
          <button type="button" aria-label="閉じる" disabled={cspImportState.phase === 'writing'} onClick={onCancel}>×</button>
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
              <label><input type="checkbox" checked={state.includeSound} onChange={event => onChangeOptions({ includeSound: event.currentTarget.checked })} /> {soundLabel}を含める</label>
              <label><input type="checkbox" checked={state.includeCamera} onChange={event => onChangeOptions({ includeCamera: event.currentTarget.checked })} /> {cameraLabel}を含める</label>
            </div>
          )}
          {state.kind === 'csp-import' && <CspImportPlanSummary state={cspImportState} onReconnectAssetRoot={onReconnectAssetRoot} />}
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
          <button type="button" disabled={cspImportState.phase === 'writing'} onClick={onCancel}>キャンセル</button>
          <button type="button" className="primary" disabled={disabled} onClick={onConfirm}>
            {cspImportState.phase === 'writing' ? '書き出し中…' : '書き出す'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function CspImportPlanSummary({
  state,
  onReconnectAssetRoot,
}: {
  state: CspImportExportState
  onReconnectAssetRoot: () => void | Promise<unknown>
}) {
  if (state.phase === 'idle' || state.phase === 'preparing') {
    return <p className="cspImportPreparing" role="status">書き出し内容を確認しています…</p>
  }
  if (!state.plan) {
    return <div className="issue error"><strong>エラー</strong><span>{state.error || '書き出し内容を確認できませんでした。'}</span></div>
  }
  const { plan } = state
  const target = plan.target
  const outputFiles = plan.files.map(file => file.relativePath)
  const xdtsFiles = outputFiles.filter(path => path.toLowerCase().endsWith('.xdts'))
  return (
    <div className="cspImportPlanSummary">
      {target.mode === 'native-root-unavailable' ? (
        <section className="cspImportReconnect">
          <strong>カットフォルダの場所を確認できません</strong>
          <p>{target.reason}</p>
          {target.rootPath && <code title={target.rootPath}>{target.rootPath}</code>}
          <p>素材一式が入っているフォルダを選ぶと、既存のカード割り当てを維持して再接続します。</p>
          <button type="button" onClick={() => void onReconnectAssetRoot()}>カットフォルダを選び直す…</button>
        </section>
      ) : (
        <section className="cspImportDestination">
          <span>{target.mode === 'portable-zip' ? '保存形式' : '書き出し先'}</span>
          <strong>{target.mode === 'portable-zip' ? target.archiveFileName : finalPathName(target.outputDirectoryPath)}</strong>
          {target.mode === 'native-cut-folder' && <code title={target.outputDirectoryPath}>{target.outputDirectoryPath}</code>}
        </section>
      )}

      <section className="cspImportContents">
        <strong>作成されるもの</strong>
        <ul>
          <li><code>csp-import.xci</code>（xsheet-importerで選択）</li>
          <li>XDTS {xdtsFiles.length}件{xdtsFiles.length > 0 && <span> — {xdtsFiles.join('、')}</span>}</li>
          <li>{target.mode === 'portable-zip' ? '取得できた画像素材をZIPへ同梱' : '画像素材はカットフォルダ内の元ファイルを参照'}</li>
        </ul>
      </section>

      <section className="cspImportMaterialSummary">
        <strong>登録内容</strong>
        <span>画像付き {plan.materialSummary.availableCount}件</span>
        <span>キーのみ {plan.materialSummary.keyOnlyCount}件</span>
      </section>

      {plan.advisories.length > 0 && (
        <div className="timingExportIssues">
          {plan.advisories.slice(0, 8).map(issue => (
            <div className="issue warning" key={issue.issueId}>
              <strong>要確認</strong>
              <span>{issueMessage(issue)}</span>
            </div>
          ))}
        </div>
      )}
      {plan.blockingIssues.filter(issue => issue.code !== 'cspImport.assetRoot.unavailable' && issue.code !== 'cspImport.assetRoot.required').map(issue => (
        <div className="issue error" key={issue.issueId}>
          <strong>エラー</strong>
          <span>{issueMessage(issue)}</span>
        </div>
      ))}
      {state.phase === 'error' && <div className="issue error"><strong>エラー</strong><span>{state.error}</span></div>}

      {target.mode !== 'native-root-unavailable' && (
        <section className="cspImportNextStep">
          <strong>書き出した後</strong>
          <p>{target.mode === 'portable-zip' ? 'ZIPを展開し、' : ''}<code>xsheet-csp-import{target.mode === 'portable-zip' ? '/' : '\\'}csp-import.xci</code>をxsheet-importerへ選択またはドロップしてください。</p>
        </section>
      )}
    </div>
  )
}

function finalPathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function timelineSectionLabel(
  sections: readonly LogicalTimelineSection[],
  role: LogicalTimelineSection['role'],
  fallback: string,
): string {
  return sections.find(section => section.role === role)?.label.trim() || fallback
}
