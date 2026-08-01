import {
  memoAnchorPresentation,
  normalizeMemoAppearance,
  type SheetPage,
  type SheetTemplate,
  type SheetViewLayoutOverrides,
  type TimelineInkMemo,
  type TimelineMemoStroke,
} from '@xsheet-remap/core'
import {
  timelineMemoAnchorCellForPage,
  timelineMemoSegmentsForPage,
  timelineMemoStrokePath,
  type TimelineMemoSegment,
} from './timelineMemoGeometry'

export type TimelineMemoVisibleStrokeGroup = {
  key: string
  color: string
  width: number
  path: string
}

export type TimelineMemoSegmentRenderItem = TimelineMemoSegment & {
  hitPath: string
  visibleStrokeGroups: TimelineMemoVisibleStrokeGroup[]
}

export type TimelineMemoPageRenderItem = {
  memo: TimelineInkMemo
  appearance: ReturnType<typeof normalizeMemoAppearance>
  anchorCell: ReturnType<typeof timelineMemoAnchorCellForPage>
  anchorPresentation: ReturnType<typeof memoAnchorPresentation>
  segments: TimelineMemoSegmentRenderItem[]
}

type TimelineMemoRenderInput = {
  template: SheetTemplate
  page: SheetPage
  paperTracks: readonly string[]
  layoutOverrides?: SheetViewLayoutOverrides
}

type CacheEntry = TimelineMemoRenderInput & {
  memo: TimelineInkMemo
  value: TimelineMemoPageRenderItem
}

export type TimelineMemoRenderCache = ReturnType<typeof createTimelineMemoRenderCache>

export function createTimelineMemoRenderCache() {
  const entries = new Map<string, CacheEntry>()

  return {
    render(memos: readonly TimelineInkMemo[], input: TimelineMemoRenderInput): TimelineMemoPageRenderItem[] {
      const liveMemoIds = new Set<string>()
      const result = memos.map(memo => {
        liveMemoIds.add(memo.memoId)
        const cached = entries.get(memo.memoId)
        if (cached
          && cached.memo === memo
          && cached.template === input.template
          && cached.page === input.page
          && cached.layoutOverrides === input.layoutOverrides
          && sameStrings(cached.paperTracks, input.paperTracks)) {
          return cached.value
        }

        const value: TimelineMemoPageRenderItem = {
          memo,
          appearance: normalizeMemoAppearance(memo.appearance),
          anchorCell: timelineMemoAnchorCellForPage(input.template, input.page, memo, {
            paperTracks: [...input.paperTracks],
            layoutOverrides: input.layoutOverrides,
          }),
          anchorPresentation: memoAnchorPresentation(memo),
          segments: timelineMemoSegmentsForPage(input.template, input.page, memo, {
            paperTracks: [...input.paperTracks],
            layoutOverrides: input.layoutOverrides,
          }).map(segment => buildSegmentRenderItem(segment, memo.strokes)),
        }
        entries.set(memo.memoId, { ...input, memo, value })
        return value
      })

      for (const memoId of entries.keys()) {
        if (!liveMemoIds.has(memoId)) entries.delete(memoId)
      }
      return result
    },
  }
}

function buildSegmentRenderItem(
  segment: TimelineMemoSegment,
  strokes: readonly TimelineMemoStroke[],
): TimelineMemoSegmentRenderItem {
  const paths = strokes.map(stroke => ({ stroke, path: timelineMemoStrokePath(segment, stroke.points) }))
    .filter((item): item is { stroke: TimelineMemoStroke; path: string } => Boolean(item.path))
  const visibleStrokeGroups: TimelineMemoVisibleStrokeGroup[] = []

  for (const { stroke, path } of paths) {
    const width = stroke.widthUnits * segment.rowHeightY
    const previous = visibleStrokeGroups.at(-1)
    if (previous && previous.color === stroke.color && previous.width === width) {
      previous.key += `:${stroke.strokeId}`
      previous.path += ` ${path}`
    } else {
      visibleStrokeGroups.push({
        key: stroke.strokeId,
        color: stroke.color,
        width,
        path,
      })
    }
  }

  return {
    ...segment,
    hitPath: paths.map(item => item.path).join(' '),
    visibleStrokeGroups,
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left === right || (left.length === right.length && left.every((value, index) => value === right[index]))
}
