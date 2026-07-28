import { useId, useMemo, type PointerEvent } from 'react'
import type { SheetPage, SheetTemplate, SheetTemplateLayoutResolveOptions, SheetViewLayoutOverrides, TimedRangeCue } from '@xsheet-remap/core'
import { buildSoundCuePageTextLayouts, type SoundCuePageTextLayout } from './soundCueGeometry'
import type { SheetSelectionSurface } from './sheet-selection-visuals'
import { timedRangeCueColumnStyle } from './timedRangeCueAppearance'

export type SoundCueDragMode = 'move' | 'resize-start' | 'resize-end'

export function SoundCueLayer({
  cues,
  layouts,
  template,
  page,
  pages = [page],
  paperTracks,
  timelineLanes,
  layoutOverrides,
  pageSize,
  surface,
  selectedCueId,
  touchInteractive = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  onPointerEnter,
  onPointerLeave,
}: {
  cues: TimedRangeCue[]
  layouts?: SoundCuePageTextLayout[]
  template: SheetTemplate
  page: SheetPage
  pages?: SheetPage[]
  paperTracks: string[]
  timelineLanes?: SheetTemplateLayoutResolveOptions['timelineLanes']
  layoutOverrides?: SheetViewLayoutOverrides
  pageSize: { widthPx: number; heightPx: number }
  surface: SheetSelectionSurface
  selectedCueId: string | null
  touchInteractive?: boolean
  onPointerDown: (event: PointerEvent<SVGElement>, cue: TimedRangeCue, mode: SoundCueDragMode) => void
  onPointerMove: (event: PointerEvent<SVGGElement>) => void
  onPointerUp: (event: PointerEvent<SVGGElement>) => void
  onPointerCancel: (event: PointerEvent<SVGGElement>) => void
  onDoubleClick: (cueId: string) => void
  onPointerEnter: (event: PointerEvent<SVGGElement>, cueId: string) => void
  onPointerLeave: () => void
}) {
  const clipIdPrefix = `sound-cue-clip-${useId().replace(/:/g, '')}`
  const edgeHeight = 8 / Math.max(1, surface.heightPx)
  const segments = useMemo(
    () => layouts ?? buildSoundCuePageTextLayouts(template, pages, cues, pageSize, {
        paperTracks,
        timelineLanes,
        layoutOverrides,
      }).filter(entry => entry.pageId === page.pageId),
    [cues, layoutOverrides, layouts, page.pageId, pageSize, pages, paperTracks, template, timelineLanes],
  )
  const textClipIds = new Map<string, string>()
  segments.forEach(({ key }) => {
    textClipIds.set(key, `${clipIdPrefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`)
  })
  return (
    <g className="soundCueLayer">
      <defs>
        {segments.map(({ segment, key }) => (
          <clipPath key={key} id={textClipIds.get(key)} clipPathUnits="userSpaceOnUse">
            <rect
              className="soundCueHorizontalClip"
              data-region-id={segment.regionId}
              x={segment.regionRect.x}
              y={-1}
              width={segment.regionRect.w}
              height={3}
            />
          </clipPath>
        ))}
      </defs>
      {segments.map(({ cue, segment, key, textLayout }) => {
        const selected = selectedCueId === cue.cueId
        return (
          <g
            key={key}
            className={`soundCue${selected ? ' selected' : ''}`}
            style={timedRangeCueColumnStyle(template.theme, 'sound', segment.columnIndex)}
            data-sound-cue-id={cue.cueId}
            data-cue-column-index={segment.columnIndex}
            data-sound-lane-id={cue.laneId}
            data-frame-start={cue.frameStart}
            data-frame-end={cue.frameEnd}
            data-sheet-touch-interaction={touchInteractive ? 'direct' : undefined}
            aria-label={`${cue.label || cue.text || 'SOUND'} ${cue.frameStart}-${cue.frameEnd}`}
            onPointerEnter={event => onPointerEnter(event, cue.cueId)}
            onPointerLeave={onPointerLeave}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onPointerCancel}
            onDoubleClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onDoubleClick(cue.cueId)
            }}
          >
            <rect
              className="soundCueBody"
              x={segment.rect.x}
              y={segment.rect.y}
              width={segment.rect.w}
              height={segment.rect.h}
              onPointerDown={event => onPointerDown(event, cue, 'move')}
            />
            {segment.startsCue && <line className="soundCueCap" x1={segment.rect.x} y1={segment.rect.y} x2={segment.rect.x + segment.rect.w} y2={segment.rect.y} />}
            {segment.endsCue && <line className="soundCueCap" x1={segment.rect.x} y1={segment.rect.y + segment.rect.h} x2={segment.rect.x + segment.rect.w} y2={segment.rect.y + segment.rect.h} />}
            <g className="soundCueTextClip" clipPath={`url(#${textClipIds.get(key)})`}>
              <g
                transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`}
                className={`soundCueText ${textLayout.labelPlacement}${textLayout.overflowLabel ? ' overflow' : ''}`}
              >
                {textLayout.labelGlyphs.map((glyph, index) => (
                  <text
                    key={`label-${index}`}
                    className="soundCueLabel"
                    x={glyph.xPx}
                    y={glyph.yPx}
                    fontSize={textLayout.labelFontSizePx}
                    textAnchor="middle"
                  >{glyph.value}</text>
                ))}
                {textLayout.textGlyphs.map((glyph, index) => (
                  <text
                    key={`text-${index}`}
                    className="soundCueDialogue"
                    x={glyph.xPx}
                    y={glyph.yPx}
                    fontSize={textLayout.textFontSizePx}
                    textAnchor="middle"
                  >{glyph.value}</text>
                ))}
              </g>
            </g>
            {selected && segment.startsCue && (
              <rect
                className="soundCueEdgeHandle start"
                x={segment.rect.x}
                y={segment.rect.y - edgeHeight / 2}
                width={segment.rect.w}
                height={edgeHeight}
                onPointerDown={event => onPointerDown(event, cue, 'resize-start')}
              />
            )}
            {selected && segment.endsCue && (
              <rect
                className="soundCueEdgeHandle end"
                x={segment.rect.x}
                y={segment.rect.y + segment.rect.h - edgeHeight / 2}
                width={segment.rect.w}
                height={edgeHeight}
                onPointerDown={event => onPointerDown(event, cue, 'resize-end')}
              />
            )}
          </g>
        )
      })}
    </g>
  )
}
