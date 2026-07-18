import type { SheetHit, SheetPage, TimedRangeCue, TimelineInkMemo } from '@xsheet-remap/core'
import type { SheetRangeSelection, TemplateRegionAnnotationTarget } from './appTypes'

export type SheetAnnotationTarget =
  | { kind: 'timeline-memo'; label: string; memo: TimelineInkMemo }
  | { kind: 'timed-cue'; label: string; cue: TimedRangeCue }
  | { kind: 'timeline-range'; label: string; hit: SheetHit; frameStart: number; frameEnd?: number }
  | { kind: 'template-region'; label: string; region: TemplateRegionAnnotationTarget }
  | { kind: 'page'; label: string; page: SheetPage | null }

export function resolveSheetAnnotationTarget(input: {
  activeMemo: TimelineInkMemo | null
  selectedCue: TimedRangeCue | null
  selectedHit: SheetHit | null
  rangeSelection: SheetRangeSelection | null
  selectedRegion: TemplateRegionAnnotationTarget | null
  activePage: SheetPage | null
  cues: readonly TimedRangeCue[]
}): SheetAnnotationTarget {
  if (input.activeMemo) {
    const linkedCue = input.activeMemo.anchor.cueId
      ? input.cues.find(cue => cue.cueId === input.activeMemo?.anchor.cueId) ?? null
      : null
    return {
      kind: 'timeline-memo',
      label: linkedCue ? timedCueTargetLabel(linkedCue) : timelineTargetLabel(
        input.activeMemo.anchor.role,
        input.activeMemo.anchor.paperTrack,
        input.activeMemo.anchor.frame,
      ),
      memo: input.activeMemo,
    }
  }
  if (input.selectedCue) {
    return { kind: 'timed-cue', label: timedCueTargetLabel(input.selectedCue), cue: input.selectedCue }
  }
  const hit = input.rangeSelection?.anchorHit ?? input.selectedHit
  if (hit && (hit.role === 'action' || hit.role === 'cell' || hit.role === 'sound' || hit.role === 'camera')) {
    const frameStart = input.rangeSelection
      ? Math.min(input.rangeSelection.frameStart, input.rangeSelection.frameEnd)
      : hit.frame
    const frameEnd = input.rangeSelection
      ? Math.max(input.rangeSelection.frameStart, input.rangeSelection.frameEnd)
      : undefined
    return {
      kind: 'timeline-range',
      label: timelineTargetLabel(hit.role, hit.paperTrack, frameStart, frameEnd),
      hit,
      frameStart,
      frameEnd,
    }
  }
  if (input.selectedRegion && (!input.activePage || input.selectedRegion.pageId === input.activePage.pageId)) {
    return { kind: 'template-region', label: input.selectedRegion.label, region: input.selectedRegion }
  }
  return {
    kind: 'page',
    label: input.activePage ? `${input.activePage.pageIndex + 1}ページ` : 'ページ',
    page: input.activePage,
  }
}

export function timedCueTargetLabel(cue: TimedRangeCue): string {
  const name = cue.label.trim() ? `「${cue.label.trim()}」` : ''
  return `${cue.role.toUpperCase()}${name} ${frameRangeLabel(cue.frameStart, cue.frameEnd)}`
}

function timelineTargetLabel(
  role: 'action' | 'cell' | 'sound' | 'camera',
  paperTrack: string | undefined,
  frameStart: number,
  frameEnd?: number,
): string {
  const track = paperTrack ? ` ${paperTrack}` : ''
  return `${role.toUpperCase()}${track} ${frameRangeLabel(frameStart, frameEnd)}`
}

function frameRangeLabel(frameStart: number, frameEnd?: number): string {
  return frameEnd === undefined || frameEnd === frameStart ? `${frameStart}F` : `${frameStart}-${frameEnd}F`
}
