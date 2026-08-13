import { type CSSProperties, type FocusEvent, type PointerEvent } from 'react'
import { type AnnotationText } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { TEXT_FONT_SIZE_MAX_PX, TEXT_FONT_SIZE_MIN_PX, TEXT_FONT_SIZE_PRESETS, clampTextFontSizePx } from './sheetTextLayout'
import { annotationTextCssLayout, annotationTextLines, resolveAnnotationTextFontSizePx, type AnnotationTextPageSize } from './annotationTextLayout'
import { clampNumber } from './sheetInteraction'
import { TooltipTarget } from './Tooltip'
import { SheetSvgText } from './SheetSvgText'
import { sheetSvgTextX, sheetSvgTextY } from './sheetSvgTextGeometry'
import { ActionMenu, ScrubbableNumberInput } from './AppControls'
import { TextAnnotationUpdate } from './app-foundation'
import { CheckSmallIcon, CloseSmallIcon } from './app-navigation'
import { useInlineEditorSession } from './useInlineEditorSession'
import { SvgMultilineTspans } from './SvgMultilineTspans'
import { usePointerDragSession } from './usePointerDragSession'
import type { PageMemoTextRenderItem } from './pageMemoProjection'

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
  annotations: PageMemoTextRenderItem[]
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
      {annotations.map(item => (
        <AnnotationTextItem
          key={item.annotation.annotationId}
          annotation={item.annotation}
          renderX={item.x}
          renderY={item.y}
          regionId={item.target?.regionId}
          targetId={item.target?.targetId}
          selected={item.annotation.annotationId === selectedAnnotationId}
          editing={item.annotation.annotationId === editingAnnotationId}
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
  renderX,
  renderY,
  regionId,
  targetId,
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
  renderX: number
  renderY: number
  regionId?: string
  targetId?: string
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
  const { editorRef, commit, cancel, markCompleted } = useInlineEditorSession<HTMLTextAreaElement>({
    active: editing,
    sessionKey: annotation.annotationId,
    selectOnFocus: !annotation.text,
    onCommit: editor => onCommit(annotation.annotationId, editor?.value ?? annotation.text),
    onCancel: () => onCancel(annotation.annotationId),
  })
  const drag = usePointerDragSession<{
    pointerId: number
    startClientX: number
    startClientY: number
    startX: number
    startY: number
    x: number
    y: number
    moved: boolean
  }>({
    onUpdate: (current, point) => {
      const deltaX = point.clientX - current.startClientX
      const deltaY = point.clientY - current.startClientY
      const moved = current.moved || Math.hypot(deltaX, deltaY) >= 3
      if (!moved) return current
      const surfaceWidth = Math.max(1, pageSize.widthPx * Math.max(zoom, 0.001))
      const surfaceHeight = Math.max(1, pageSize.heightPx * Math.max(zoom, 0.001))
      return {
        ...current,
        x: clampNumber(
          current.startX + deltaX / surfaceWidth,
          annotation.coordinateSpace === 'memo-target' ? -1 : 0,
          annotation.coordinateSpace === 'memo-target' ? 2 : 1,
        ),
        y: clampNumber(
          current.startY + deltaY / surfaceHeight,
          annotation.coordinateSpace === 'memo-target' ? -1 : 0,
          annotation.coordinateSpace === 'memo-target' ? 2 : 1,
        ),
        moved: true,
      }
    },
    onFinish: (current, finish) => {
      if (finish.cancelled) return
      if (current.moved) onUpdate(annotation.annotationId, { x: current.x, y: current.y })
      onSelect(annotation.annotationId)
    },
  })
  const renderedX = renderX + ((drag.active?.x ?? annotation.x) - annotation.x)
  const renderedY = renderY + ((drag.active?.y ?? annotation.y) - annotation.y)
  const layout = annotationTextCssLayout(annotation, pageSize, zoom, { x: renderedX, y: renderedY })
  const commonStyle = {
    left: `${layout.leftPx}px`,
    top: `${layout.topPx}px`,
    maxWidth: `${layout.maxWidthPx}px`,
    color: annotation.color,
    fontSize: `${layout.fontSizePx}px`,
  } satisfies CSSProperties

  function commitDraftText() {
    commit()
  }

  function cancelDraftText() {
    cancel()
  }

  function handleEditorBlur(event: FocusEvent<HTMLTextAreaElement>) {
    if (event.currentTarget.dataset.commitHandled === 'true') {
      markCompleted()
      return
    }
    commit()
  }

  function handleDisplayPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(annotation.annotationId)
    drag.begin({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: annotation.x,
      startY: annotation.y,
      x: annotation.x,
      y: annotation.y,
      moved: false,
    }, event.currentTarget)
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
          data-workspace-keyboard-scope="editor"
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
      data-annotation-region-id={regionId ?? (annotation.anchor?.kind === 'view-surface' ? annotation.anchor.regionId : undefined)}
      data-annotation-target-id={targetId ?? (annotation.anchor?.kind === 'view-surface' ? annotation.anchor.targetId : undefined)}
      data-sheet-touch-interaction={selected ? 'direct' : undefined}
      data-dragging={drag.active ? 'true' : undefined}
      onPointerDown={handleDisplayPointerDown}
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
  position = annotation,
}: {
  annotation: AnnotationText
  pageSize: { widthPx: number; heightPx: number }
  position?: { x: number; y: number }
}) {
  const lines = annotationTextLines(annotation.text)
  if (lines.length === 0) return null
  const fontSizePx = resolveAnnotationTextFontSizePx(annotation, pageSize)
  return (
    <SheetSvgText
      className="annotationTextSvg"
      x={position.x}
      y={position.y}
      fill={annotation.color}
      fontSizePx={fontSizePx}
      pageSize={pageSize}
      dominantBaseline="hanging"
    >
      <SvgMultilineTspans
        lines={lines}
        xPx={sheetSvgTextX(position.x, pageSize)}
        yPx={sheetSvgTextY(position.y, pageSize)}
        lineHeightPx={fontSizePx * 1.25}
        keyPrefix={annotation.annotationId}
      />
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
