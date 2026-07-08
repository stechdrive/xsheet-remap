import type {
  CutProject,
  SheetImageAlignment,
  SheetPageImageRef,
  SheetSource,
  SheetViewState,
} from './types'
import {
  getSheetViewLayout,
  standardA3SheetTemplate,
  type SheetTemplate,
} from './sheet-template'
import { sameSheetImageRef } from './assets'
import { nextId, withoutUndefined } from './core-utils'

export function defaultSheetImageAlignment(): SheetImageAlignment {
  return {
    opacity: 0.94,
    x: 0,
    y: 0,
    scale: 1,
    corners: {
      tl: { x: 0, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    },
  }
}

export function createDefaultSheetViewState(templateInput: string | Pick<SheetTemplate, 'templateId' | 'viewLayout' | 'pageModel' | 'defaultUnderlay'>): SheetViewState {
  const templateId = typeof templateInput === 'string' ? templateInput : templateInput.templateId
  const underlay = typeof templateInput === 'string' ? undefined : templateInput.defaultUnderlay
  const viewLayout = typeof templateInput === 'string' ? undefined : getSheetViewLayout(templateInput)
  return {
    templateId,
    viewMode: viewLayout?.defaultViewMode ?? 'continuous',
    activePageId: 'page_1',
    sources: [],
    pages: [
      {
        pageId: 'page_1',
        alignment: underlay?.alignment ? mergeSheetImageAlignment(defaultSheetImageAlignment(), underlay.alignment) : defaultSheetImageAlignment(),
      },
    ],
  }
}

export function updateSheetViewState(project: CutProject, updates: Partial<Omit<SheetViewState, 'pages'>>): CutProject {
  return {
    ...project,
    sheetTemplateId: updates.templateId ?? project.sheetTemplateId,
    sheetView: {
      ...project.sheetView,
      ...withoutUndefined(updates),
    },
  }
}

export function updateSheetPageViewState(
  project: CutProject,
  pageId: string,
  updates: {
    sourceId?: string | null
    imageRef?: SheetPageImageRef | null
    alignment?: Partial<SheetImageAlignment>
  },
): CutProject {
  const existing = project.sheetView.pages.find(page => page.pageId === pageId) ?? { pageId, alignment: defaultSheetImageAlignment() }
  const nextPage = {
    ...existing,
    sourceId: updates.sourceId === undefined ? existing.sourceId : updates.sourceId ?? undefined,
    imageRef: updates.imageRef === undefined ? existing.imageRef : updates.imageRef ?? undefined,
    alignment: updates.alignment ? mergeSheetImageAlignment(existing.alignment, updates.alignment) : existing.alignment,
  }
  return {
    ...project,
    sheetView: {
      ...project.sheetView,
      activePageId: pageId,
      pages: [...project.sheetView.pages.filter(page => page.pageId !== pageId), nextPage].sort((a, b) =>
        a.pageId.localeCompare(b.pageId, undefined, { numeric: true }),
      ),
    },
  }
}

export function assignSheetSourceToPage(project: CutProject, pageId: string, sourceId: string | null): CutProject {
  const source = sourceId ? project.sheetView.sources.find(item => item.sourceId === sourceId) : undefined
  if (sourceId && !source) {
    throw new Error(`sheet source not found: ${sourceId}`)
  }
  if (source && source.kind !== 'sheet-scan') {
    throw new Error(`sheet source is not assignable to pages: ${sourceId}`)
  }

  const updated = updateSheetPageViewState(project, pageId, { sourceId, imageRef: null })
  return {
    ...updated,
    sheetView: {
      ...updated.sheetView,
      sources: updated.sheetView.sources.map(source => {
        if (source.assignedPageId === pageId && source.sourceId !== sourceId) {
          return { ...source, assignedPageId: undefined }
        }
        if (source.sourceId === sourceId) {
          return { ...source, assignedPageId: pageId }
        }
        return source
      }),
    },
  }
}

export function migrateSheetView(input: Partial<SheetViewState> | undefined, templateId: string): SheetViewState {
  const base = createDefaultSheetViewStateForTemplateId(templateId)
  const sources: SheetSource[] = [...(input?.sources ?? base.sources)].filter(source => source.kind === 'sheet-scan')
  const pages = (input?.pages?.length ? input.pages : base.pages).map(page => {
    let sourceId = page.sourceId
    if (sourceId && !sources.some(source => source.sourceId === sourceId)) {
      sourceId = undefined
    }
    if (!sourceId && page.imageRef) {
      const existing = sources.find(source => sameSheetImageRef(source.imageRef, page.imageRef!))
      if (existing) {
        sourceId = existing.sourceId
      } else {
        sourceId = nextId('sheet_source', sources.map(source => source.sourceId))
        sources.push({
          sourceId,
          kind: 'sheet-scan',
          imageRef: page.imageRef,
          assignedPageId: page.pageId,
        })
      }
    }
    return {
      ...page,
      sourceId,
      alignment: mergeSheetImageAlignment(defaultSheetImageAlignment(), page.alignment ?? {}),
    }
  })
  return {
    ...base,
    ...input,
    templateId: input?.templateId ?? templateId,
    sources,
    pages,
  }
}

export function mergeSheetImageAlignment(base: SheetImageAlignment, updates: Partial<SheetImageAlignment>): SheetImageAlignment {
  return {
    ...base,
    ...withoutUndefined(updates),
    corners: {
      ...base.corners,
      ...(updates.corners ?? {}),
    },
    calibration: updates.calibration ?? base.calibration,
    levelCorrection: updates.levelCorrection ? {
      enabled: updates.levelCorrection.enabled ?? base.levelCorrection?.enabled ?? false,
      inputBlack: updates.levelCorrection.inputBlack ?? base.levelCorrection?.inputBlack ?? 0,
      inputWhite: updates.levelCorrection.inputWhite ?? base.levelCorrection?.inputWhite ?? 255,
      gamma: updates.levelCorrection.gamma ?? base.levelCorrection?.gamma ?? 1,
    } : base.levelCorrection,
  }
}

function createDefaultSheetViewStateForTemplateId(templateId: string): SheetViewState {
  return templateId === standardA3SheetTemplate.templateId
    ? createDefaultSheetViewState(standardA3SheetTemplate)
    : createDefaultSheetViewState(templateId)
}
