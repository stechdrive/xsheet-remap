import type { NormalizedRect } from '@xsheet-remap/core'
import type { PointerEventHandler } from 'react'

export type SheetTransformHandleKind = 'move' | 'resize'

const HANDLE_HIT_SIZE_PX = 16
const MOVE_VISUAL_WIDTH_PX = 10
const MOVE_VISUAL_HEIGHT_PX = 8
const RESIZE_VISUAL_SIZE_PX = 9
const RESIZE_VISUAL_INSET_PX = 2

export function SheetTransformHandle({
  rect,
  surface,
  kind,
  label,
  className,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  rect: NormalizedRect
  surface: { widthPx: number; heightPx: number }
  kind: SheetTransformHandleKind
  label: string
  className?: string
  onPointerDown: PointerEventHandler<SVGGElement>
  onPointerMove?: PointerEventHandler<SVGGElement>
  onPointerUp?: PointerEventHandler<SVGGElement>
  onPointerCancel?: PointerEventHandler<SVGGElement>
}) {
  const widthPx = Math.max(1, surface.widthPx)
  const heightPx = Math.max(1, surface.heightPx)
  const hitW = Math.min(rect.w, HANDLE_HIT_SIZE_PX / widthPx)
  const hitH = Math.min(rect.h, HANDLE_HIT_SIZE_PX / heightPx)
  const hitX = kind === 'move' ? rect.x : rect.x + rect.w - hitW
  const hitY = kind === 'move' ? rect.y : rect.y + rect.h - hitH
  const classes = ['sheetTransformHandle', kind, className].filter(Boolean).join(' ')

  if (kind === 'move') {
    const visualW = Math.min(hitW, MOVE_VISUAL_WIDTH_PX / widthPx)
    const visualH = Math.min(hitH, MOVE_VISUAL_HEIGHT_PX / heightPx)
    const visualX = hitX + Math.max(0, (hitW - visualW) / 2)
    const visualY = hitY + Math.max(0, (hitH - visualH) / 2)
    return (
      <g className={classes} aria-label={label} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
        <title>{label}</title>
        <rect className="sheetTransformHandleHitArea" x={hitX} y={hitY} width={hitW} height={hitH} />
        <rect className="sheetTransformHandleMoveVisual" x={visualX} y={visualY} width={visualW} height={visualH} rx={Math.min(visualW, visualH) * 0.34} />
        {[0.3, 0.5, 0.7].map(ratio => <line
          key={ratio}
          className="sheetTransformHandleMoveGrip"
          x1={visualX + visualW * 0.25}
          y1={visualY + visualH * ratio}
          x2={visualX + visualW * 0.75}
          y2={visualY + visualH * ratio}
        />)}
      </g>
    )
  }

  const visualW = Math.min(hitW, RESIZE_VISUAL_SIZE_PX / widthPx)
  const visualH = Math.min(hitH, RESIZE_VISUAL_SIZE_PX / heightPx)
  const right = rect.x + rect.w - Math.min(RESIZE_VISUAL_INSET_PX / widthPx, visualW * 0.2)
  const bottom = rect.y + rect.h - Math.min(RESIZE_VISUAL_INSET_PX / heightPx, visualH * 0.2)
  return (
    <g className={classes} aria-label={label} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      <title>{label}</title>
      <rect className="sheetTransformHandleHitArea" x={hitX} y={hitY} width={hitW} height={hitH} />
      <path className="sheetTransformHandleResizeVisual" d={`M ${right - visualW} ${bottom} H ${right} V ${bottom - visualH}`} />
    </g>
  )
}
