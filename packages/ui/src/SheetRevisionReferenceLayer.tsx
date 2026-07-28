import { useMemo } from 'react'
import { sheetAnnotationStrokes, sheetAnnotationTexts, timelineMemos, type CutProject, type SheetPage, type SheetTemplate } from '@xsheet-remap/core'
import { MetadataTextLayer, strokePath } from './app-sheet-layers'
import type { SheetEventRectRenderItem } from './sheet-layers-hit-geometry'
import type { SheetContinuationRenderItem, SheetRenderModelContext } from './sheetRenderModel'
import { SheetSvgText } from './SheetSvgText'
import { clampTextFontSizePx } from './sheetTextLayout'
import { SoundCueLayer } from './SoundCueLayer'
import { CameraCueLayer } from './CameraCueLayer'
import { TimelineMemoLayer } from './TimelineMemoLayer'
import { AnnotationSvgText } from './sheet-panel-annotation'
import { TimingEventSymbol } from './TimingEventSymbol'
import { sheetContinuationPathData } from './sheetRenderModel'

const noop = () => undefined

export function SheetRevisionReferenceLayer({
  project,
  template,
  page,
  paperTracks,
  pageSize,
  surface,
  context,
  opacity,
  events,
  continuationItems,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  paperTracks: string[]
  pageSize: { widthPx: number; heightPx: number }
  surface: { widthPx: number; heightPx: number }
  context: SheetRenderModelContext
  opacity: number
  events: SheetEventRectRenderItem[]
  continuationItems: SheetContinuationRenderItem[]
}) {
  const strokeRenderItems = useMemo(() => sheetAnnotationStrokes(project)
    .filter(annotation => annotation.pageId === page.pageId && annotation.tool === 'pen')
    .map(stroke => ({ stroke, path: strokePath(stroke) })), [page.pageId, project])
  const textAnnotations = useMemo(
    () => sheetAnnotationTexts(project).filter(annotation => annotation.pageId === page.pageId),
    [page.pageId, project],
  )
  return (
    <g className="sheetRevisionReferenceLayer" opacity={opacity} aria-label="元のシート">
      <MetadataTextLayer context={context} page={page} />
      {continuationItems.map(item => (
        <path
          key={`${item.eventId}:${item.paperTrack}:${item.path[0]?.x}:${item.path[0]?.y}`}
          className={`timingContinuationLine timingContinuation${item.kind === 'wave' ? 'Wave' : 'Straight'}`}
          d={sheetContinuationPathData(item.path)}
          strokeWidth={item.strokeWidth}
        />
      ))}
      <SoundCueLayer
        cues={project.timedRangeCues.filter(cue => cue.role === 'sound')}
        template={template}
        page={page}
        pages={context.pages}
        paperTracks={paperTracks}
        layoutOverrides={project.sheetView.layoutOverrides}
        pageSize={pageSize}
        surface={surface}
        selectedCueId={null}
        onPointerDown={noop}
        onPointerMove={noop}
        onPointerUp={noop}
        onPointerCancel={noop}
        onDoubleClick={noop}
        onPointerEnter={noop}
        onPointerLeave={noop}
      />
      <CameraCueLayer
        cues={project.timedRangeCues.filter(cue => cue.role === 'camera')}
        template={template}
        page={page}
        paperTracks={paperTracks}
        layoutOverrides={project.sheetView.layoutOverrides}
        pageSize={pageSize}
        surface={surface}
        selectedCueId={null}
        onPointerDown={noop}
        onPointerMove={noop}
        onPointerUp={noop}
        onPointerCancel={noop}
        onDoubleClick={noop}
        onPointerEnter={noop}
        onPointerLeave={noop}
      />
      {events.map(({ event, eventKind, displayLabel, rect, fontSizePx }) => (
        <g key={event.eventId}>
          <rect className="sheetRevisionReferenceEvent" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
          {displayLabel.trim() && (
            <SheetSvgText
              className="sheetRevisionReferenceText"
              x={rect.x + rect.w / 2}
              y={rect.y + rect.h / 2}
              textAnchor="middle"
              dominantBaseline="central"
              alignmentBaseline="central"
              fontSizePx={clampTextFontSizePx(fontSizePx)}
              pageSize={pageSize}
            >
              {displayLabel}
            </SheetSvgText>
          )}
          {eventKind !== 'cell' && <TimingEventSymbol kind={eventKind} rect={rect} />}
        </g>
      ))}
      <TimelineMemoLayer
        memos={timelineMemos(project)}
        template={template}
        page={page}
        paperTracks={paperTracks}
        layoutOverrides={project.sheetView.layoutOverrides}
        pageSize={pageSize}
        surface={surface}
        selectedMemoId={null}
        editMode="new"
        penColor="#c5525c"
        penWidth={1}
        eraserWidth={1}
        textFontSizePx={18}
        onAppendStroke={noop}
        onEraseStroke={noop}
        onUpsertText={noop}
        onUpdatePlacement={noop}
      />
      {strokeRenderItems.map(({ stroke, path }) => (
        <path key={stroke.annotationId} className="sheetRevisionReferenceStroke" d={path} strokeWidth={stroke.width} />
      ))}
      {textAnnotations.map(annotation => <AnnotationSvgText key={annotation.annotationId} annotation={{ ...annotation, color: '#b83f4d' }} pageSize={pageSize} />)}
    </g>
  )
}
