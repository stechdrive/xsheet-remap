import { useState } from 'react'
import type { ActionCellTransferPlan } from '@xsheet-remap/core'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'

export function ActionCellTransferPreview({ plan, onCancel, onApply }: { plan: ActionCellTransferPlan; onCancel: () => void; onApply: () => void }) {
  const boundary = useModalDialogKeyboardBoundary<HTMLDivElement>(onCancel)
  const [error, setError] = useState('')
  const ready = plan.columns.filter(column => column.status === 'ready')
  const skipped = plan.columns.filter(column => column.status !== 'ready' && column.status !== 'empty')
  const hasNotes = ready.some(column => column.openIntervals.length || column.additionalFrames.length
    || column.duplicateNumberFrames.length || !column.usesNumericOrder && column.drawingCount > 0)
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
    {(skipped.length > 0 || hasNotes) && <details>
      <summary>{skipped.length ? `${skipped.length}列は転記対象外` : '採番についての確認事項'}</summary>
      {skipped.map(column => <p key={column.paperTrack}>{column.paperTrack}：{column.reason}</p>)}
      {ready.filter(column => column.additionalFrames.length).map(column => <p key={`additional-${column.paperTrack}`}>
        {column.paperTrack}：{column.additionalFrames.join('、')}コマの絵は、原画番号の間へ一意に並べられないため、後ろに追加採番しています。
      </p>)}
      {ready.filter(column => column.duplicateNumberFrames.length).map(column => <p key={`duplicate-${column.paperTrack}`}>
        {column.paperTrack}：{column.duplicateNumberFrames.join('、')}コマに数値が同じ複数のセルがあります。別の絵として採番しています。
      </p>)}
      {ready.filter(column => !column.usesNumericOrder && column.drawingCount > 0).map(column => <p key={`appearance-${column.paperTrack}`}>
        {column.paperTrack}：数字の原画がないため、初出順で採番しています。
      </p>)}
      {ready.filter(column => column.openIntervals.length).map(column => <p key={column.paperTrack}>
        {column.paperTrack}：{column.openIntervals.join('、')}コマからの中割には原画の端点がありません。
      </p>)}
    </details>}
    {error && <p role="alert">{error}</p>}
  </div>
}
