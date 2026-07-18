import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react'
import { type AnnotationText } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { TEXT_FONT_SIZE_MAX_PX, TEXT_FONT_SIZE_MIN_PX, TEXT_FONT_SIZE_PRESETS, clampTextFontSizePx } from './sheetTextLayout'
import { annotationTextCssLayout, annotationTextLines, resolveAnnotationTextFontSizePx, type AnnotationTextPageSize } from './annotationTextLayout'
import { clampNumber } from './sheetInteraction'
import { TooltipTarget } from './Tooltip'
import { SheetSvgText } from './SheetSvgText'
import { sheetSvgTextX } from './sheetSvgTextGeometry'
import { ActionMenu, ScrubbableNumberInput } from './AppControls'
import { TextAnnotationUpdate } from './app-foundation'
import { CheckSmallIcon, CloseSmallIcon } from './app-navigation'

export function AnnotationTextLayer({
  annotations,
  selectedAnnotationId,
  editingAnnotationId,
  inputBlocked = false,
  pageSize,
  zoom,
  onSelect,
  onEdit,
  onUpdate,
  onCommit,
  onCancel,
}: {
  annotations: AnnotationText[]
  selectedAnnotationId: string | null
  editingAnnotationId: string | null
  inputBlocked?: boolean
  pageSize: AnnotationTextPageSize
  zoom: number
  onSelect: (annotationId: string) => void
  onEdit: (annotationId: string) => void
  onUpdate: (annotationId: string, updates: TextAnnotationUpdate) => void
  onCommit: (annotationId: string, text: string) => void
  onCancel: (annotationId: string) => void
}) {
  return (
    <div className={inputBlocked ? 'annotationTextLayer inputBlocked' : 'annotationTextLayer'}>
      {annotations.map(annotation => (
        <AnnotationTextItem
          key={annotation.annotationId}
          annotation={annotation}
          selected={annotation.annotationId === selectedAnnotationId}
          editing={annotation.annotationId === editingAnnotationId}
          pageSize={pageSize}
          zoom={zoom}
          onSelect={onSelect}
          onEdit={onEdit}
          onUpdate={onUpdate}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      ))}
    </div>
  )
}

function AnnotationTextItem({
  annotation,
  selected,
  editing,
  pageSize,
  zoom,
  onSelect,
  onEdit,
  onUpdate,
  onCommit,
  onCancel,
}: {
  annotation: AnnotationText
  selected: boolean
  editing: boolean
  pageSize: AnnotationTextPageSize
  zoom: number
  onSelect: (annotationId: string) => void
  onEdit: (annotationId: string) => void
  onUpdate: (annotationId: string, updates: TextAnnotationUpdate) => void
  onCommit: (annotationId: string, text: string) => void
  onCancel: (annotationId: string) => void
}) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const closeHandledRef = useRef(false)
  const dragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startX: number
    startY: number
    x: number
    y: number
    moved: boolean
  } | null>(null)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const renderedX = dragPosition?.x ?? annotation.x
  const renderedY = dragPosition?.y ?? annotation.y
  const layout = annotationTextCssLayout(annotation, pageSize, zoom, { x: renderedX, y: renderedY })
  const commonStyle = {
    left: `${layout.leftPx}px`,
    top: `${layout.topPx}px`,
    maxWidth: `${layout.maxWidthPx}px`,
    color: annotation.color,
    fontSize: `${layout.fontSizePx}px`,
  } satisfies CSSProperties

  useEffect(() => {
    if (!editing) return
    const frame = window.requestAnimationFrame(() => {
      const editor = editorRef.current
      editor?.focus()
      if (editor && !editor.value) editor.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [annotation.annotationId, editing])

  function commitDraftText() {
    closeHandledRef.current = true
    onCommit(annotation.annotationId, editorRef.current?.value ?? annotation.text)
  }

  function cancelDraftText() {
    closeHandledRef.current = true
    onCancel(annotation.annotationId)
  }

  function handleEditorBlur(event: FocusEvent<HTMLTextAreaElement>) {
    if (closeHandledRef.current || event.currentTarget.dataset.commitHandled === 'true') return
    onCommit(annotation.annotationId, event.currentTarget.value)
  }

  function handleDisplayPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(annotation.annotationId)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: annotation.x,
      startY: annotation.y,
      x: annotation.x,
      y: annotation.y,
      moved: false,
    }
  }

  function handleDisplayPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const deltaX = event.clientX - drag.startClientX
    const deltaY = event.clientY - drag.startClientY
    const moved = drag.moved || Math.hypot(deltaX, deltaY) >= 3
    if (!moved) return
    const surfaceWidth = Math.max(1, pageSize.widthPx * Math.max(zoom, 0.001))
    const surfaceHeight = Math.max(1, pageSize.heightPx * Math.max(zoom, 0.001))
    const x = clampNumber(drag.startX + deltaX / surfaceWidth, 0, 1)
    const y = clampNumber(drag.startY + deltaY / surfaceHeight, 0, 1)
    dragRef.current = { ...drag, x, y, moved: true }
    setDragPosition({ x, y })
  }

  function handleDisplayPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    setDragPosition(null)
    if (drag.moved) {
      onUpdate(annotation.annotationId, { x: drag.x, y: drag.y })
    }
    onSelect(annotation.annotationId)
  }

  function handleDisplayPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragPosition(null)
  }

  if (editing) {
    return (
      <>
        <div
          className="annotationTextEditorActions"
          style={{
            left: `${layout.leftPx}px`,
            top: `${Math.max(0, layout.topPx - 30)}px`,
          }}
          onPointerDown={event => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <button type="button" aria-label={uiText.sheet.textAnnotationCommit} onClick={commitDraftText}>
            <CheckSmallIcon />
          </button>
          <button type="button" aria-label={uiText.sheet.textAnnotationCancel} onClick={cancelDraftText}>
            <CloseSmallIcon />
          </button>
        </div>
        <textarea
          key={`${annotation.annotationId}:${annotation.text}`}
          ref={editorRef}
          className="annotationTextEditor"
          data-annotation-id={annotation.annotationId}
          defaultValue={annotation.text}
          placeholder={uiText.sheet.textPlaceholder}
          style={{ ...commonStyle, width: `${layout.editorWidthPx}px`, minHeight: `${layout.editorHeightPx}px` }}
          onBlur={handleEditorBlur}
          onPointerDown={event => {
            event.stopPropagation()
            onSelect(annotation.annotationId)
          }}
          onKeyDown={event => {
            event.stopPropagation()
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              commitDraftText()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelDraftText()
            }
          }}
        />
        <div
          className="annotationTextCommitHint"
          style={{
            left: `${layout.leftPx + layout.editorWidthPx}px`,
            top: `${layout.topPx + layout.editorHeightPx}px`,
          }}
        >
          {uiText.sheet.textAnnotationCommitHint}
        </div>
      </>
    )
  }

  return (
    <button
      type="button"
      className={[
        'annotationTextDisplay',
        annotation.text.trim() ? '' : 'empty',
        selected ? 'selected' : '',
      ].filter(Boolean).join(' ')}
      style={commonStyle}
      aria-label={uiText.sheet.textTool}
      data-dragging={dragPosition ? 'true' : undefined}
      onPointerDown={handleDisplayPointerDown}
      onPointerMove={handleDisplayPointerMove}
      onPointerUp={handleDisplayPointerEnd}
      onPointerCancel={handleDisplayPointerCancel}
      onDoubleClick={event => {
        event.preventDefault()
        event.stopPropagation()
        onEdit(annotation.annotationId)
      }}
    >
      {annotation.text || uiText.sheet.textPlaceholder}
    </button>
  )
}

export function AnnotationSvgText({
  annotation,
  pageSize,
}: {
  annotation: AnnotationText
  pageSize: { widthPx: number; heightPx: number }
}) {
  const lines = annotationTextLines(annotation.text)
  if (lines.length === 0) return null
  const fontSizePx = resolveAnnotationTextFontSizePx(annotation, pageSize)
  return (
    <SheetSvgText
      className="annotationTextSvg"
      x={annotation.x}
      y={annotation.y}
      fill={annotation.color}
      fontSizePx={fontSizePx}
      pageSize={pageSize}
      dominantBaseline="hanging"
    >
      {lines.map((line, index) => (
        <tspan key={index} x={sheetSvgTextX(annotation.x, pageSize)} dy={index === 0 ? 0 : '1.25em'}>
          {line}
        </tspan>
      ))}
    </SheetSvgText>
  )
}

export function FontSizeControl({
  value,
  active,
  disabled = false,
  onChange,
  label = uiText.sheet.textFontSize,
  tooltip = uiText.sheet.textFontSizeTitle,
  compact = false,
}: {
  value: number
  active: boolean
  disabled?: boolean
  onChange: (value: number) => void
  label?: string
  tooltip?: string
  compact?: boolean
}) {
  const clampedValue = clampTextFontSizePx(value)

  return (
    <TooltipTarget label={tooltip}>
      {tooltipProps => (
        <div
          className={[
            'textFontSizeControl',
            compact ? 'compact' : '',
            active ? 'active' : '',
            disabled ? 'disabled' : '',
          ].filter(Boolean).join(' ')}
          aria-disabled={disabled}
          {...tooltipProps}
        >
          <span className="toolbarGroupLabel">{label}</span>
          <ScrubbableNumberInput
            className="fontSizeNumericInput"
            value={clampedValue}
            min={TEXT_FONT_SIZE_MIN_PX}
            max={TEXT_FONT_SIZE_MAX_PX}
            pixelsPerStep={4}
            ariaLabel={label}
            ariaValueText={size => `${size}px`}
            disabled={disabled}
            onChange={onChange}
          />
          <span className="fontSizeUnit">px</span>
          {!disabled && (
            <ActionMenu label={<span className="fontSizePresetTrigger" aria-hidden="true">▾</span>} ariaLabel={uiText.sheet.textFontSizePreset} className="fontSizePresetMenu" closeOnMenuItemClick>
              <div className="fontSizePresetList" aria-label={uiText.sheet.textFontSizePreset}>
                {TEXT_FONT_SIZE_PRESETS.map(size => (
                  <button
                    key={size}
                    type="button"
                    className={size === clampedValue ? 'active' : ''}
                    onClick={() => onChange(size)}
                  >
                    {size}px
                  </button>
                ))}
              </div>
            </ActionMenu>
          )}
        </div>
      )}
    </TooltipTarget>
  )
}
