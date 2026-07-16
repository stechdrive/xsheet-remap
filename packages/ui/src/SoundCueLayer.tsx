import type { PointerEvent } from 'react'
import type { SheetPage, SheetTemplate, SheetViewLayoutOverrides, TimedRangeCue } from '@xsheet-remap/core'
import { buildSoundCueTextLayout, soundCueSegmentsForPage } from './soundCueGeometry'
import type { SheetSelectionSurface } from './sheet-selection-visuals'

export type SoundCueDragMode = 'move' | 'resize-start' | 'resize-end'

export function SoundCueLayer({
  cues,
  template,
  page,
  paperTracks,
  layoutOverrides,
  pageSize,
  surface,
  selectedCueId,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  onPointerEnter,
  onPointerLeave,
}: {
  cues: TimedRangeCue[]
  template: SheetTemplate
  page: SheetPage
  paperTracks: string[]
  layoutOverrides?: SheetViewLayoutOverrides
  pageSize: { widthPx: number; heightPx: number }
  surface: SheetSelectionSurface
  selectedCueId: string | null
  onPointerDown: (event: PointerEvent<SVGElement>, cue: TimedRangeCue, mode: SoundCueDragMode) => void
  onPointerMove: (event: PointerEvent<SVGGElement>) => void
  onPointerUp: (event: PointerEvent<SVGGElement>) => void
  onPointerCancel: (event: PointerEvent<SVGGElement>) => void
  onDoubleClick: (cueId: string) => void
  onPointerEnter: (event: PointerEvent<SVGGElement>, cueId: string) => void
  onPointerLeave: () => void
}) {
  const edgeHeight = 8 / Math.max(1, surface.heightPx)
  return (
    <g className="soundCueLayer">
      {cues.flatMap(cue => soundCueSegmentsForPage(template, page, cue, { paperTracks, layoutOverrides }).map(segment => {
        const selected = selectedCueId === cue.cueId
        const typography = template.regions.find(region => region.regionId === segment.regionId)?.grid?.typography
        const textLayout = buildSoundCueTextLayout(
          segment.rect,
          pageSize,
          segment.startsCue ? cue.label : '',
          cue.text,
          { fontSizePx: typography?.cellFontSizePx, minFontSizePx: typography?.cellMinFontSizePx },
        )
        return (
          <g
            key={`${cue.cueId}:${segment.regionId}:${segment.frameStart}`}
            className={`soundCue${selected ? ' selected' : ''}`}
            data-sound-cue-id={cue.cueId}
            data-sound-lane-id={cue.laneId}
            data-frame-start={cue.frameStart}
            data-frame-end={cue.frameEnd}
            aria-label={`${cue.label || 'SOUND'} ${cue.frameStart}-${cue.frameEnd}`}
            onPointerEnter={event => onPointerEnter(event, cue.cueId)}
            onPointerLeave={onPointerLeave}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
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
            <g transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`} className={textLayout.overflowLabel ? 'soundCueText overflow' : 'soundCueText'}>
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
      }))}
    </g>
  )
}
