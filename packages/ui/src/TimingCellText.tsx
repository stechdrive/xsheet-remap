import { useId } from 'react'
import type { NormalizedRect } from '@xsheet-remap/core'
import { SheetSvgText } from './SheetSvgText'
import type { TimingCellTextLayout } from './timingCellTextLayout'

export function TimingCellText({ layout, rect, pageSize, className = 'eventText' }: {
  layout: TimingCellTextLayout; rect: NormalizedRect; pageSize: { widthPx: number; heightPx: number }; className?: string
}) {
  const clipId = useId()
  const clip = layout.clipRect
  return <g>
    <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><rect x={clip.x} y={clip.y} width={clip.w} height={clip.h} /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      <SheetSvgText className={className} x={layout.textPosition?.x ?? rect.x + rect.w / 2} y={layout.textPosition?.y ?? rect.y + rect.h / 2}
        textAnchor="middle" dominantBaseline={layout.baseline ?? 'central'} alignmentBaseline={layout.baseline ?? 'central'}
        style={layout.outlineWidthPx ? { dominantBaseline: layout.baseline, stroke: '#fff', strokeWidth: layout.outlineWidthPx, paintOrder: 'stroke fill', strokeLinejoin: 'round' } : undefined}
        fontSizePx={layout.fontSizePx} pageSize={pageSize} aria-label={layout.fullText}
        data-full-text={layout.fullText} data-text-overflow={layout.overflow ? 'true' : undefined}>
        {layout.text}
      </SheetSvgText>
    </g>
  </g>
}
