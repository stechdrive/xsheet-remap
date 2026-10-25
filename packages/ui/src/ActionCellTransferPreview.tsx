import { useState } from 'react'
import type { ActionCellTransferPlan } from '@xsheet-remap/core'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'

export function ActionCellTransferPreview({ plan, onCancel, onApply }: { plan: ActionCellTransferPlan; onCancel: () => void; onApply: () => void }) {
  const boundary = useModalDialogKeyboardBoundary<HTMLDivElement>(onCancel)
  const [error, setError] = useState('')
  const ready = plan.columns.filter(column => column.status === 'ready')
  const skipped = plan.columns.filter(column => column.status !== 'ready' && column.status !== 'empty')
  return <div className="actionCellTransferPreview" role="region" aria-label="ACTION→CELLの転記プレビュー" ref={boundary} tabIndex={-1}>
    <div className="actionCellTransferSummary" role="status">
      <strong>CELLに仮表示中</strong>
      <span>{ready.length ? `対象：${ready.map(column => column.paperTrack).join('・')}（${ready.length}列）` : '転記できる列がありません'}</span>
      <small>非表示の前後ダミーも採番に含みます</small>
    </div>
    <div className="actionCellTransferActions">
      <button onClick={onCancel}>キャンセル</button>
      <button className="primary" disabled={!ready.length} onClick={() => {
        try { onApply() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
      }}>OK</button>
    </div>
    {(skipped.length > 0 || ready.some(column => column.openIntervals.length)) && <details>
      <summary>{skipped.length ? `${skipped.length}列は転記対象外` : '端点のない中割があります'}</summary>
      {skipped.map(column => <p key={column.paperTrack}>{column.paperTrack}：{column.reason}</p>)}
      {ready.filter(column => column.openIntervals.length).map(column => <p key={column.paperTrack}>
        {column.paperTrack}：{column.openIntervals.join('、')}コマからの中割には原画の端点がありません。
      </p>)}
    </details>}
    {error && <p role="alert">{error}</p>}
  </div>
}
