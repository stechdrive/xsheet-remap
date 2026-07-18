import type { AnnotationStroke, AnnotationText, CutProject, SheetPage, SheetTemplate } from '@xsheet-remap/core'
import { MetadataTextLayer, eventRectsForPage, isAnnotationStroke, strokePath } from './app-sheet-layers'
import type { SheetRenderModelContext } from './sheetRenderModel'
import { SheetSvgText } from './SheetSvgText'
import { clampTextFontSizePx } from './sheetTextLayout'
import { SoundCueLayer } from './SoundCueLayer'
import { CameraCueLayer } from './CameraCueLayer'
import { TimelineMemoLayer } from './TimelineMemoLayer'
import { AnnotationSvgText } from './sheet-panel-annotation'

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
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  paperTracks: string[]
  pageSize: { widthPx: number; heightPx: number }
  surface: { widthPx: number; heightPx: number }
  context: SheetRenderModelContext
  opacity: number
}) {
  const events = eventRectsForPage(project, template, page)
  const strokes = project.annotations.filter((annotation): annotation is AnnotationStroke =>
    isAnnotationStroke(annotation) && annotation.pageId === page.pageId && annotation.tool === 'pen')
  const textAnnotations = project.annotations.filter((annotation): annotation is AnnotationText =>
    annotation.kind === 'text' && annotation.pageId === page.pageId)
  return (
    <g className="sheetRevisionReferenceLayer" opacity={opacity} aria-label="元のシート">
      <MetadataTextLayer context={context} page={page} />
      <SoundCueLayer
        cues={project.timedRangeCues.filter(cue => cue.role === 'sound')}
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
      {events.map(({ event, displayLabel, rect, fontSizePx }) => (
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
        </g>
      ))}
      <TimelineMemoLayer
        memos={project.timelineMemos}
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
        onAppendStroke={noop}
        onEraseStroke={noop}
        onUpdatePlacement={noop}
      />
      {strokes.map(stroke => (
        <path key={stroke.annotationId} className="sheetRevisionReferenceStroke" d={strokePath(stroke)} strokeWidth={stroke.width} />
      ))}
      {textAnnotations.map(annotation => <AnnotationSvgText key={annotation.annotationId} annotation={{ ...annotation, color: '#b83f4d' }} pageSize={pageSize} />)}
    </g>
  )
}
