import type { CutProject, TimelineInkMemo, TimelineMemoPlacement, TimelineMemoPoint, TimelineMemoStroke } from './types'
import { splitPolylineByEraser } from './polyline-eraser'

export function addTimelineMemo(project: CutProject, memo: TimelineInkMemo): CutProject {
  return { ...project, timelineMemos: [...project.timelineMemos, memo] }
}

export function updateTimelineMemo(
  project: CutProject,
  memoId: string,
  updates: Partial<Pick<TimelineInkMemo, 'anchor' | 'placement' | 'strokes' | 'order'>>,
): CutProject {
  let changed = false
  const timelineMemos = project.timelineMemos.map(memo => {
    if (memo.memoId !== memoId) return memo
    changed = true
    return { ...memo, ...updates }
  })
  return changed ? { ...project, timelineMemos } : project
}

export function updateTimelineMemoPlacement(project: CutProject, memoId: string, placement: TimelineMemoPlacement): CutProject {
  return updateTimelineMemo(project, memoId, { placement: normalizeTimelineMemoPlacement(placement) })
}

export function appendTimelineMemoStroke(project: CutProject, memoId: string, stroke: TimelineMemoStroke): CutProject {
  const memo = project.timelineMemos.find(item => item.memoId === memoId)
  return memo ? updateTimelineMemo(project, memoId, { strokes: [...memo.strokes, normalizeTimelineMemoStroke(stroke, memo.placement)] }) : project
}

export function eraseTimelineMemoStrokes(
  project: CutProject,
  input: { memoId: string; points: TimelineMemoPoint[]; widthUnits: number },
): CutProject {
  if (input.points.length === 0 || input.widthUnits <= 0) return project
  const memo = project.timelineMemos.find(item => item.memoId === input.memoId)
  if (!memo) return project
  const existingIds = new Set(memo.strokes.map(stroke => stroke.strokeId))
  let changed = false
  const strokes = memo.strokes.flatMap(stroke => {
    const threshold = Math.max(0, input.widthUnits / 2 + stroke.widthUnits / 2)
    const parts = splitPolylineByEraser(stroke.points, input.points, threshold)
    if (parts === null) return [stroke]
    changed = true
    return parts.map((points, index) => ({
      ...stroke,
      strokeId: index === 0 ? stroke.strokeId : nextTimelineMemoStrokePartId(existingIds, stroke.strokeId, index),
      points,
    }))
  })
  return changed ? updateTimelineMemo(project, input.memoId, { strokes }) : project
}

export function clearTimelineMemoStrokes(project: CutProject, memoId: string): CutProject {
  const memo = project.timelineMemos.find(item => item.memoId === memoId)
  return memo?.strokes.length ? updateTimelineMemo(project, memoId, { strokes: [] }) : project
}

export function deleteTimelineMemo(project: CutProject, memoId: string): CutProject {
  const timelineMemos = project.timelineMemos.filter(memo => memo.memoId !== memoId)
  return timelineMemos.length === project.timelineMemos.length ? project : { ...project, timelineMemos }
}

export function nextTimelineMemoId(memos: readonly TimelineInkMemo[]): string {
  const used = new Set(memos.map(memo => memo.memoId))
  let index = memos.length + 1
  while (used.has(`timeline_memo_${index}`)) index += 1
  return `timeline_memo_${index}`
}

export function nextTimelineMemoStrokeId(memo: TimelineInkMemo): string {
  const used = new Set(memo.strokes.map(stroke => stroke.strokeId))
  let index = memo.strokes.length + 1
  while (used.has(`${memo.memoId}_stroke_${index}`)) index += 1
  return `${memo.memoId}_stroke_${index}`
}

function nextTimelineMemoStrokePartId(existingIds: Set<string>, baseId: string, partIndex: number): string {
  let serial = partIndex
  let candidate = `${baseId}_part_${serial}`
  while (existingIds.has(candidate)) {
    serial += 1
    candidate = `${baseId}_part_${serial}`
  }
  existingIds.add(candidate)
  return candidate
}

export function insertTimelineMemoAnchors(memos: readonly TimelineInkMemo[], atFrame: number, frameCount: number): TimelineInkMemo[] {
  return memos.map(memo => memo.anchor.frame >= atFrame
    ? { ...memo, anchor: { ...memo.anchor, frame: memo.anchor.frame + frameCount } }
    : memo)
}

export function deleteTimelineMemoAnchors(
  memos: readonly TimelineInkMemo[],
  frameStart: number,
  frameEnd: number,
  frameCount: number,
): TimelineInkMemo[] {
  return memos.flatMap(memo => {
    if (memo.anchor.frame >= frameStart && memo.anchor.frame <= frameEnd) return []
    return [memo.anchor.frame > frameEnd
      ? { ...memo, anchor: { ...memo.anchor, frame: memo.anchor.frame - frameCount } }
      : memo]
  })
}

function normalizeTimelineMemoPlacement(placement: TimelineMemoPlacement): TimelineMemoPlacement {
  return {
    frameOffset: Number.isFinite(placement.frameOffset) ? placement.frameOffset : 0,
    crossOffsetUnits: Number.isFinite(placement.crossOffsetUnits) ? placement.crossOffsetUnits : 0,
    widthUnits: Math.max(0.5, Number.isFinite(placement.widthUnits) ? placement.widthUnits : 1),
    heightFrames: Math.max(1, Number.isFinite(placement.heightFrames) ? placement.heightFrames : 1),
  }
}

function normalizeTimelineMemoStroke(stroke: TimelineMemoStroke, placement: TimelineMemoPlacement): TimelineMemoStroke {
  return {
    ...stroke,
    widthUnits: Math.max(0.02, Number.isFinite(stroke.widthUnits) ? stroke.widthUnits : 0.1),
    points: stroke.points.map(point => ({
      ...point,
      x: clamp(point.x, 0, placement.widthUnits),
      y: clamp(point.y, 0, placement.heightFrames),
    })),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
