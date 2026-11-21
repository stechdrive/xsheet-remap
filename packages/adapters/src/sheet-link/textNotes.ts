import { type CutProject, type SheetMemo } from '@xsheet-remap/core'
import { invalid } from './bytes'
import type { TextField } from './model'

export function noteFields(project: CutProject): TextField[] {
  const result: TextField[] = []
  for (const [index, memo] of project.memos.entries()) {
    if (!memo.texts?.some(t => t.text)) continue
    const id = String(index)
    if (memo.kind === 'page') {
      const target = memo.target
      const texts = memo.texts.map(t => [t.text, t.x, t.y, t.fontSizePx, t.color, t.writingMode === 'vertical', t.coordinateSpace === 'memo-target'])
      result.push(['note.' + target.pageId, id, JSON.stringify([target.regionId, target.targetId, target.templateId, texts])])
    } else {
      const anchor = memo.anchor, place = memo.placement, style = memo.appearance?.text
      const lane = project.logicalSheet.timelineSections.find(s => s.role === anchor.role)?.lanes?.findIndex(l => l.laneId === anchor.laneId)
      result.push(['note@' + anchor.frame, id, JSON.stringify([anchor.role, anchor.frame, anchor.paperTrack, lane,
      place.frameOffset, place.pageOffsetYUnits, place.crossOffsetUnits, place.widthUnits, place.heightFrames,
      style?.color, style?.fontSizeUnits, style?.writingMode === 'vertical', memo.texts.map(t => [t.text, t.x, t.y])])])
    }
  }
  return result
}

const str = (v: unknown): string => typeof v === 'string' ? v : invalid()
const optional = (v: unknown) => v == null ? undefined : str(v)
const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1_000_000 ? v : invalid()
function list(v: unknown): unknown[] { return Array.isArray(v) && v.length <= 4096 ? v : invalid() }

export function restoreTextNote(scope: string, key: string, value: string, project: CutProject): SheetMemo {
  const data = list(JSON.parse(value)), memoId = 'qr-note-' + key, order = num(Number(key))
  if (scope.startsWith('note.')) {
    const pageId = scope.slice(5), regionId = optional(data[0]), targetId = optional(data[1]), templateId = optional(data[2])
    return {
      kind: 'page', memoId, order, target: { kind: regionId || targetId ? 'template-region' : 'page', pageId, regionId, targetId, templateId }, strokes: [],
      texts: list(data[3]).map((entry, i) => {
        const [text, x, y, font, color, vertical, relative] = list(entry)
        return {
          annotationId: memoId + '-' + i, kind: 'text', pageId, text: str(text), x: num(x), y: num(y), fontSizePx: num(font), color: str(color),
          writingMode: vertical ? 'vertical' : 'horizontal', coordinateSpace: relative ? 'memo-target' : 'view-surface'
        }
      })
    }
  }
  const [role, frame, paperTrack, lane, frameOffset, pageOffset, crossOffset, width, height, color, font, vertical, texts] = data
  if (role !== 'action' && role !== 'cell' && role !== 'camera' && role !== 'sound') invalid()
  const laneId = lane == null ? undefined : project.logicalSheet.timelineSections.find(s => s.role === role)?.lanes?.[num(lane)]?.laneId
  return {
    kind: 'timeline', memoId, order, anchor: { role, frame: num(frame), paperTrack: optional(paperTrack), laneId },
    placement: { frameOffset: num(frameOffset), pageOffsetYUnits: pageOffset == null ? undefined : num(pageOffset), crossOffsetUnits: num(crossOffset), widthUnits: num(width), heightFrames: num(height) },
    strokes: [], texts: list(texts).map((entry, i) => {
      const [text, x, y] = list(entry)
      return { textId: memoId + '-' + i, text: str(text), x: num(x), y: num(y) }
    }),
    appearance: {
      inkOpacity: 1, textOpacity: 1, background: { enabled: false, color: '#fff', opacity: 0 },
      text: { color: optional(color) ?? '#000000', fontSizeUnits: font == null ? 1 : num(font), writingMode: vertical ? 'vertical' : 'horizontal' }
    }
  }
}
