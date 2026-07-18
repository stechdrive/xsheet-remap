import type { SheetTemplate } from '@xsheet-remap/core'
import { summarizeXdtsImport, type XdtsImportOptions } from '@xsheet-remap/xdts'
import type { XdtsImportDialogState } from './appTypes'

export function XdtsImportDialog({
  state,
  template,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: XdtsImportDialogState
  template: SheetTemplate
  onChange: (updates: Partial<XdtsImportDialogState>) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const options: XdtsImportOptions = {
    tableIndex: state.tableIndex,
    targetRole: state.targetRole,
    includeSound: state.includeSound,
    includeCamera: state.includeCamera,
    conflictMode: state.conflictMode,
    applyCutIdentity: state.applyCutIdentity,
    expandDuration: state.expandDuration,
  }
  const summary = summarizeXdtsImport(state.data, options)
  const actionLabel = template.style?.gridHeader?.labelOverrides?.action || 'ACTION'
  const cellLabel = template.style?.gridHeader?.labelOverrides?.cell || 'CELL'
  const hasSound = summary.table.dialogueCues.length > 0
  const hasCamera = summary.table.cameraCues.length > 0

  return (
    <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label="XDTSを読み込む" onPointerDown={onCancel}>
      <section className="timingExportDialog xdtsImportDialog" onPointerDown={event => event.stopPropagation()}>
        <header>
          <div><strong>XDTSを読み込む</strong><span>{state.fileName}</span></div>
          <button type="button" aria-label="閉じる" onClick={onCancel}>×</button>
        </header>
        <div className="timingExportDialogBody">
          {state.data.timeTables.length > 1 && (
            <label className="timingExportPathField">
              <span>タイムテーブル</span>
              <select value={state.tableIndex} onChange={event => onChange({ tableIndex: Number(event.currentTarget.value) })}>
                {state.data.timeTables.map((table, index) => (
                  <option value={index} key={`${table.name}:${index}`}>{table.name}（{table.duration}F / {table.fps}fps）</option>
                ))}
              </select>
            </label>
          )}
          <fieldset>
            <legend>キーの読み込み先</legend>
            <div className="segmented" role="group" aria-label="キーの読み込み先">
              <button type="button" className={state.targetRole === 'action' ? 'active' : ''} aria-pressed={state.targetRole === 'action'} onClick={() => onChange({ targetRole: 'action' })}>{actionLabel}</button>
              <button type="button" className={state.targetRole === 'cell' ? 'active' : ''} aria-pressed={state.targetRole === 'cell'} onClick={() => onChange({ targetRole: 'cell' })}>{cellLabel}</button>
            </div>
          </fieldset>
          <fieldset>
            <legend>同じ位置に既存データがある場合</legend>
            <div className="segmented" role="group" aria-label="競合時の処理">
              <button type="button" className={state.conflictMode === 'replace' ? 'active' : ''} aria-pressed={state.conflictMode === 'replace'} onClick={() => onChange({ conflictMode: 'replace' })}>上書き</button>
              <button type="button" className={state.conflictMode === 'empty-only' ? 'active' : ''} aria-pressed={state.conflictMode === 'empty-only'} onClick={() => onChange({ conflictMode: 'empty-only' })}>空きだけ</button>
            </div>
          </fieldset>
          <div className="xdtsImportOptions">
            <label><input type="checkbox" checked={state.includeSound && hasSound} disabled={!hasSound} onChange={event => onChange({ includeSound: event.currentTarget.checked })} /> SOUNDを読み込む（{summary.table.dialogueCues.length}件）</label>
            <label><input type="checkbox" checked={state.includeCamera && hasCamera} disabled={!hasCamera} onChange={event => onChange({ includeCamera: event.currentTarget.checked })} /> CAMERAを読み込む（{summary.table.cameraCues.length}件）</label>
            <label><input type="checkbox" checked={state.expandDuration} onChange={event => onChange({ expandDuration: event.currentTarget.checked })} /> 必要ならカット尺を{summary.table.duration}Fまで延長</label>
            <label><input type="checkbox" checked={state.applyCutIdentity} onChange={event => onChange({ applyCutIdentity: event.currentTarget.checked })} /> シーン・カット番号を反映（{state.data.header.scene} / {state.data.header.cut}）</label>
          </div>
          <p className="xdtsImportSummary">キー {summary.cellEventCount}件 / SOUND {summary.soundCueCount}件 / CAMERA {summary.cameraCueCount}件</p>
          {summary.warnings.map(message => <div className="issue warning" key={message}><strong>注意</strong><span>{message}</span></div>)}
        </div>
        <footer>
          <button type="button" onClick={onCancel}>キャンセル</button>
          <button type="button" className="primary" onClick={onConfirm}>読み込む</button>
        </footer>
      </section>
    </div>
  )
}
