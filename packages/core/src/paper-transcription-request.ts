import type { CutProject } from './types'
import type { SheetTemplate } from './sheet-template-schema'
import { createSheetPages, getSheetViewLayout, resolveSheetTemplateGridLayout } from './sheet-template-layout'
import { isInteractiveSheetTemplateGridRegion } from './sheet-template-schema'
import { logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameStart } from './logical-sheet'
import { projectSheetLayoutOptions } from './project-model'
import type { PaperTranscriptionRequest, PaperTranscriptionTarget } from './paper-transcription-types'

export function createPaperTranscriptionRequest(
  project: CutProject, template: SheetTemplate, scopeKey: string,
  selection: PaperTranscriptionRequest['selection'], requestId: string,
): PaperTranscriptionRequest {
  if (!requestId || requestId.length > 100) throw new Error('解析依頼IDが不正です。')
  const displayFrom = logicalSheetDisplayFrameStart(project.logicalSheet)
  const duration = logicalSheetDisplayDurationFrames(project.logicalSheet)
  if (!Number.isSafeInteger(selection.from) || !Number.isSafeInteger(selection.to)
    || selection.from < displayFrom || selection.to >= displayFrom + duration || selection.from > selection.to) {
    throw new Error('読み取り範囲を現在のシートのコマ範囲内で指定してください。')
  }
  if (!selection.roles.length || selection.roles.some(role => role !== 'action' && role !== 'cell')) throw new Error('ACTIONまたはCELLを選択してください。')
  if (!selection.columns.length || selection.columns.some(column => !project.logicalSheet.paperTracks.some(track => track.paperTrack === column))) throw new Error('読み取る列を選択してください。')
  if (selection.to - selection.from >= 20000) throw new Error('一回の読み取りは20,000コマ以内に分けてください。')
  const layoutOptions = projectSheetLayoutOptions(project, template)
  const continuous = ['continuous', 'infinite'].includes(getSheetViewLayout(template).frameAxis?.type ?? '')
  const targets: PaperTranscriptionTarget[] = []
  for (const page of createSheetPages(template, duration, displayFrom)) {
    if (page.frameEnd < selection.from || page.frameStart > selection.to) continue
    for (const region of template.regions) {
      if (!isInteractiveSheetTemplateGridRegion(region) || (region.grid.role !== 'action' && region.grid.role !== 'cell')
        || !selection.roles.includes(region.grid.role)) continue
      const layout = resolveSheetTemplateGridLayout(template, region, layoutOptions)
      if (!layout) continue
      const first = continuous ? layout.frames.frameStart : page.frameStart + layout.frames.frameStart - template.defaults.frameOrigin
      const from = Math.max(first, page.frameStart, selection.from)
      const to = Math.min(first + layout.frames.rowCount - 1, page.frameEnd, selection.to)
      if (from > to) continue
      for (const column of layout.columns) {
        if (!column.paperTrack || !selection.columns.includes(column.paperTrack)) continue
        const rect = { x: column.x, y: layout.rect.y + (from - first) * layout.frames.rowHeight, w: column.w, h: (to - from + 1) * layout.frames.rowHeight }
        if (rect.x < 0 || rect.x + rect.w > 1.00001 || rect.y < 0 || rect.y + rect.h > 1.00001) continue
        targets.push({
          targetId: `t${String(targets.length + 1).padStart(3, '0')}`,
          pageId: page.pageId, pageNumber: page.pageIndex + 1, regionId: region.regionId,
          role: region.grid.role, label: region.grid.header?.label ?? region.label,
          column: column.paperTrack, columnLabel: column.label || column.paperTrack, from, to, firstRow: from - first + 1, rect,
        })
      }
    }
  }
  if (!targets.length) throw new Error('選択範囲に読み取り可能なACTION／CELL欄がありません。')
  if (targets.length > 128) throw new Error('対象が多すぎます。ページまたは列を分けてください。')
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
    const a = targets[i]!, b = targets[j]!
    if (a.role === b.role && a.column === b.column && a.from <= b.to && b.from <= a.to) throw new Error('同じ列・コマを指すテンプレート欄が重複しています。対象のテンプレートを確認してください。')
  }
  for (const role of selection.roles) for (const column of selection.columns) {
    const ranges = targets.filter(target => target.role === role && target.column === column).sort((a, b) => a.from - b.from)
    let next = selection.from
    for (const range of ranges) {
      if (range.from !== next) break
      next = range.to + 1
    }
    if (next !== selection.to + 1) throw new Error(`${role.toUpperCase()} ${column}列 ${next}F以降の紙面上の位置が見つかりません。テンプレートにある欄・列・コマ範囲を選択してください。`)
  }
  const pageIds = new Set(targets.map(target => target.pageId))
  const pages = project.sheetView.pages.filter(page => pageIds.has(page.pageId))
  const sourceIds = new Set(pages.map(page => page.sourceId))
  const context = JSON.stringify({
    projectId: project.projectId, scopeKey, processId: project.logicalSheet.processTimings?.activeProcessId,
    templateId: template.templateId, fps: project.logicalSheet.fps, displayFrom, duration, targets,
    pages,
    sources: project.sheetView.sources.filter(source => sourceIds.has(source.sourceId)),
  })
  return {
    format: 'xsheet-remap.paper-transcription-request', version: 1, requestId, context,
    templateName: template.name, fps: project.logicalSheet.fps,
    selection: { ...selection, roles: [...selection.roles], columns: [...selection.columns] }, targets,
  }
}

export function assertPaperTranscriptionContext(request: PaperTranscriptionRequest, project: CutProject, template: SheetTemplate, scopeKey: string): void {
  const current = createPaperTranscriptionRequest(project, template, scopeKey, request.selection, request.requestId)
  if (request.context !== current.context || JSON.stringify(request.targets) !== JSON.stringify(current.targets)) {
    throw new Error('解析依頼後にカット・シート・工程・テンプレート・画像割付が変わっています。元の状態に戻すか、新しい依頼を作成してください。')
  }
}
