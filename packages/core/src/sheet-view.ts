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
import { normalizeNativeFileSystemPath } from './native-paths'
import { defaultSheetImageAlignment, mergeSheetImageAlignment } from './sheet-image-alignment'

export { defaultSheetImageAlignment } from './sheet-image-alignment'

export function createDefaultSheetViewState(templateInput: string | Pick<SheetTemplate, 'templateId' | 'viewLayout' | 'pageModel' | 'defaultUnderlay'>): SheetViewState {
  const templateId = typeof templateInput === 'string' ? templateInput : templateInput.templateId
  const underlay = typeof templateInput === 'string' ? undefined : templateInput.defaultUnderlay
  const viewLayout = typeof templateInput === 'string' ? undefined : getSheetViewLayout(templateInput)
  return {
    templateId,
    viewMode: viewLayout?.defaultViewMode ?? 'continuous',
    activePageId: 'page_1',
    sources: [],
    metadataDisplay: {
      sharedCutNumbers: true,
    },
    continuationDisplay: {
      action: true,
      cell: true,
    },
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
  const assignedProject = updates.sourceId === undefined ? project : assignSheetSourceToPage(project, pageId, updates.sourceId)
  const existing = assignedProject.sheetView.pages.find(page => page.pageId === pageId) ?? { pageId, alignment: defaultSheetImageAlignment() }
  const nextSourceId = existing.sourceId
  const source = nextSourceId ? assignedProject.sheetView.sources.find(item => item.sourceId === nextSourceId) : undefined
  const baseAlignment = source?.alignment ?? existing.alignment
  const nextPage = {
    ...existing,
    sourceId: nextSourceId,
    imageRef: updates.imageRef === undefined ? existing.imageRef : updates.imageRef ?? undefined,
    alignment: updates.alignment ? mergeSheetImageAlignment(baseAlignment, updates.alignment) : baseAlignment,
  }
  return {
    ...assignedProject,
    sheetView: {
      ...assignedProject.sheetView,
      activePageId: pageId,
      sources: assignedProject.sheetView.sources.map(item => item.sourceId === nextSourceId
        ? { ...item, alignment: nextPage.alignment }
        : item),
      pages: [...assignedProject.sheetView.pages.filter(page => page.pageId !== pageId), nextPage].sort((a, b) =>
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

  const existing = project.sheetView.pages.find(page => page.pageId === pageId) ?? { pageId, alignment: defaultSheetImageAlignment() }
  const targetPage = {
    ...existing,
    sourceId: source?.sourceId,
    imageRef: undefined,
    alignment: source?.alignment ?? existing.alignment,
  }
  const pages = [...project.sheetView.pages.filter(page => page.pageId !== pageId), targetPage]
    .map(page => sourceId && page.pageId !== pageId && page.sourceId === sourceId
      ? { ...page, sourceId: undefined, imageRef: undefined }
      : page)
    .sort((a, b) => a.pageId.localeCompare(b.pageId, undefined, { numeric: true }))
  return {
    ...project,
    sheetView: {
      ...project.sheetView,
      activePageId: pageId,
      pages,
      sources: project.sheetView.sources.map(item => {
        if (item.assignedPageId === pageId && item.sourceId !== sourceId) {
          return { ...item, assignedPageId: undefined }
        }
        if (item.sourceId === sourceId) {
          return { ...item, assignedPageId: pageId }
        }
        return item
      }),
    },
  }
}

export function removeSheetSource(project: CutProject, sourceId: string): CutProject {
  if (!project.sheetView.sources.some(source => source.sourceId === sourceId)) return project
  return {
    ...project,
    sheetView: {
      ...project.sheetView,
      sources: project.sheetView.sources.filter(source => source.sourceId !== sourceId),
      pages: project.sheetView.pages.map(page => page.sourceId === sourceId
        ? { ...page, sourceId: undefined, imageRef: undefined }
        : page),
    },
  }
}

export function migrateSheetView(input: Partial<SheetViewState> | undefined, templateId: string): SheetViewState {
  const base = createDefaultSheetViewStateForTemplateId(templateId)
  const sourcesWithStoredAlignment = new Set((input?.sources ?? [])
    .filter(source => Boolean((source as Partial<SheetSource>).alignment))
    .map(source => source.sourceId))
  const sources: SheetSource[] = [...(input?.sources ?? base.sources)]
    .filter(source => source.kind === 'sheet-scan')
    .map(source => ({
      ...source,
      imageRef: normalizeSheetImageRefNativePath(source.imageRef),
      alignment: mergeSheetImageAlignment(defaultSheetImageAlignment(), (source as Partial<SheetSource>).alignment ?? {}),
    }))
  const migratedPages = (input?.pages?.length ? input.pages : base.pages).map(inputPage => {
    const page = inputPage.imageRef
      ? { ...inputPage, imageRef: normalizeSheetImageRefNativePath(inputPage.imageRef) }
      : inputPage
    const alignment = mergeSheetImageAlignment(defaultSheetImageAlignment(), page.alignment ?? {})
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
          alignment,
        })
        sourcesWithStoredAlignment.add(sourceId)
      }
    }
    return {
      ...page,
      sourceId,
      alignment,
    }
  })
  const resolvedSources = [...sources]
  const resolvedPageSource = new Map<string, { sourceId: string; alignment: SheetImageAlignment }>()
  for (const source of sources) {
    const candidates = migratedPages.filter(page => page.sourceId === source.sourceId)
    const assignedPage = candidates.find(page => page.pageId === source.assignedPageId) ?? candidates[0]
    if (!assignedPage) {
      source.assignedPageId = undefined
      continue
    }
    const alignmentForPage = (page: typeof assignedPage) => sourcesWithStoredAlignment.has(source.sourceId) ? source.alignment : page.alignment
    source.assignedPageId = assignedPage.pageId
    source.alignment = alignmentForPage(assignedPage)
    resolvedPageSource.set(assignedPage.pageId, { sourceId: source.sourceId, alignment: source.alignment })
    for (const duplicatePage of candidates.filter(page => page.pageId !== assignedPage.pageId)) {
      const sourceId = nextId('sheet_source', resolvedSources.map(item => item.sourceId))
      const alignment = alignmentForPage(duplicatePage)
      resolvedSources.push({ ...source, sourceId, assignedPageId: duplicatePage.pageId, alignment })
      resolvedPageSource.set(duplicatePage.pageId, { sourceId, alignment })
    }
  }
  const pages = migratedPages.map(page => {
    if (!page.sourceId) return page
    const resolved = resolvedPageSource.get(page.pageId)
    return resolved
      ? { ...page, sourceId: resolved.sourceId, imageRef: undefined, alignment: resolved.alignment }
      : { ...page, sourceId: undefined, imageRef: undefined }
  })
  return {
    ...base,
    ...input,
    templateId: input?.templateId ?? templateId,
    sources: resolvedSources,
    pages,
    metadataDisplay: {
      ...base.metadataDisplay,
      ...(input?.metadataDisplay ?? {}),
    },
    continuationDisplay: {
      ...base.continuationDisplay,
      ...(input?.continuationDisplay ?? {}),
    },
  }
}

function normalizeSheetImageRefNativePath(imageRef: SheetPageImageRef): SheetPageImageRef {
  return imageRef.path ? { ...imageRef, path: normalizeNativeFileSystemPath(imageRef.path) } : imageRef
}

function createDefaultSheetViewStateForTemplateId(templateId: string): SheetViewState {
  return templateId === standardA3SheetTemplate.templateId
    ? createDefaultSheetViewState(standardA3SheetTemplate)
    : createDefaultSheetViewState(templateId)
}
