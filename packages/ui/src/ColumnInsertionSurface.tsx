import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { ColumnInsertionTarget } from './sheetColumnModel'

/** Shared placement session for guides, cell columns and timed-range lanes. No project edits until confirm. */
export function ColumnInsertionSurface<T>({ targets, initialId, label, describe, onConfirm, onCancel, onTargetChange, allowOutsideColumns = false }: {
  targets: ColumnInsertionTarget<T>[]
  initialId?: string
  label: string
  describe?: (target: ColumnInsertionTarget<T>) => string
  onConfirm: (target: ColumnInsertionTarget<T>, client: { x: number; y: number }) => void
  onCancel: () => void
  onTargetChange?: (target: ColumnInsertionTarget<T>) => void
  allowOutsideColumns?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? targets[0]?.id ?? null)
  const [caption, setCaption] = useState<{ x: number; y: number } | null>(null)
  const selected = targets.find(target => target.id === selectedId)
  const description = selected && describe?.(selected)
  useEffect(() => { root.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      onCancel()
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', onCancel)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', onCancel) }
  }, [onCancel])
  const choose = (id: string | null) => {
    setSelectedId(id)
    const target = targets.find(item => item.id === id)
    if (target) onTargetChange?.(target)
    return target
  }
  const fromPoint = (clientX: number, clientY: number) => {
    const box = root.current?.getBoundingClientRect()
    if (!box?.width || !box.height) return undefined
    const x = (clientX - box.left) / box.width, y = (clientY - box.top) / box.height
    setCaption({ x: Math.max(8, Math.min(clientX - box.left + 14, box.width - 260)), y: Math.max(8, Math.min(clientY - box.top + 18, box.height - 120)) })
    const candidates = targets.filter(target => allowOutsideColumns || (x >= target.area.x - 0.002 && x <= target.area.x + target.area.w + 0.002 && y >= target.area.y && y <= target.area.y + target.area.h))
    const nearest = candidates.reduce<ColumnInsertionTarget<T> | undefined>((best, target) => {
      const score = (item: ColumnInsertionTarget<T>) => Math.abs(x - item.x) * 0.65
        + Math.max(item.area.x - x, x - item.area.x - item.area.w, 0) * 0.35
        + Math.max(item.area.y - y, y - item.area.y - item.area.h, 0) * 1.8
      return !best || score(target) < score(best) ? target : best
    }, undefined)
    return choose(nearest?.id ?? null)
  }
  const confirm = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const target = fromPoint(event.clientX, event.clientY)
    if (target) onConfirm(target, { x: event.clientX, y: event.clientY })
  }
  return <div ref={root} className="columnInsertionSurface" role="group" aria-label={`${label}の挿入位置を選択`} tabIndex={0}
    data-workspace-keyboard-scope="editor" data-sheet-touch-interaction="direct"
    onPointerDown={event => { event.stopPropagation(); if (event.button === 0) root.current?.focus({ preventScroll: true }) }}
    onPointerMove={event => { event.stopPropagation(); fromPoint(event.clientX, event.clientY) }}
    onPointerCancel={event => { event.stopPropagation(); onCancel() }}
    onClick={confirm} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onCancel() }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation()
        const index = targets.findIndex(target => target.id === selectedId)
        choose(targets[Math.max(0, Math.min(targets.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))]?.id ?? null)
      }
      if (event.key === 'Enter' && selected) {
        event.preventDefault(); event.stopPropagation()
        const box = root.current!.getBoundingClientRect()
        onConfirm(selected, { x: box.left + selected.x * box.width, y: box.top + selected.top * box.height })
      }
    }}>
    {selected && <div className="columnInsertionMarker" data-insertion-target={selected.id}
      style={{ left: `${selected.x * 100}%`, top: `${selected.top * 100}%`, height: `${(selected.bottom - selected.top) * 100}%` }} />}
    <div className="columnInsertionCaption" role="status" style={caption ? { left: caption.x, top: caption.y } : { left: `${Math.min(selected?.x ?? 0, 0.7) * 100}%`, top: `${Math.max(0, (selected?.top ?? 0) * 100 - 4)}%` }}>
      <strong>{selected?.label ?? `${label}の欄内で位置を選択`}</strong>
      {description && <span>{description}</span>}
      <span>クリックで追加位置を確定 · Escでキャンセル</span>
    </div>
  </div>
}
