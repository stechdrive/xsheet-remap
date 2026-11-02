import { useRef, useState, type PointerEvent } from 'react'
import { clampTextFontSizePx } from './sheetTextLayout'
import { usePointerDragSession } from './usePointerDragSession'

type Scrub = { pointerId: number; startX: number; start: number; value: number; moved: boolean; shift: boolean }

/** A typing/scrub gesture creates one history entry; cancellation never commits. */
export function TextSizeNumberInput({ value, label, disabled, onChange }: {
  value: number | null; label: string; disabled?: boolean; onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const edit = (text: string | null) => { draftRef.current = text; setDraft(text) }
  const drag = usePointerDragSession<Scrub>({
    onPointerEvent: event => {
      if (drag.activeRef.current) drag.activeRef.current.shift = event.shiftKey
    },
    onUpdate: (session, point) => {
      const moved = session.moved || Math.abs(point.clientX - session.startX) >= 3
      return { ...session, moved, value: moved
        ? clampTextFontSizePx(session.start + Math.round((point.clientX - session.startX) / 4) * (session.shift ? 10 : 1))
        : session.start }
    },
    onFinish: (session, finish) => {
      if (session.moved) {
        edit(null)
        if (!disabled && !finish.cancelled && session.value !== value) onChange(session.value)
      }
    },
  })
  const commit = () => {
    const text = draftRef.current
    edit(null)
    if (!disabled && text !== null && text.trim() && Number.isFinite(Number(text))) {
      const next = clampTextFontSizePx(Number(text))
      if (next !== value) onChange(next)
    }
  }
  function startDrag(event: PointerEvent<HTMLInputElement>) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
    const start = value ?? 18
    drag.begin({ pointerId: event.pointerId, startX: event.clientX, start, value: start, moved: false, shift: event.shiftKey }, event.currentTarget)
  }
  return <input type="number" min={6} max={256} step={1} className="fontSizeNumericInput scrubbableNumberInput"
    aria-label={label} placeholder={value === null ? '混在' : undefined} disabled={disabled}
    value={drag.active?.moved ? String(drag.active.value) : draft ?? (value === null ? '' : String(Math.round(value)))} inputMode="numeric"
    onChange={event => edit(event.currentTarget.value)} onBlur={commit} onPointerDown={startDrag}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape') { event.preventDefault(); edit(null); drag.cancel(); event.currentTarget.blur() }
    }} />
}
