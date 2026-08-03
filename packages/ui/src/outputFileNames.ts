import type { CutGroupProjectDocument, CutProject } from '@xsheet-remap/core'
import { XSR_PROJECT_FILE_EXTENSION } from '@xsheet-remap/adapters'

type SheetImageExportFormat = 'jpg' | 'png' | 'psd'

export function projectFileName(document: CutGroupProjectDocument): string {
  const productionPrefix = [safeFileNameSegment(document.production.title), safeFileNameSegment(document.production.episode)].filter(Boolean).join('_')
  const cuts = document.cuts
    .map(cut => [safeFileNameSegment(cut.metadata.scene), safeFileNameSegment(cut.metadata.cut)].filter(Boolean).join('-'))
    .filter(Boolean)
  const group = cuts.join('_') || 'cut-group'
  return `${productionPrefix ? `${productionPrefix}_${group}` : group}${XSR_PROJECT_FILE_EXTENSION}`
}

export function sheetXdtsFileName(project: CutProject): string {
  return `${projectOutputPrefix(project)}_sheet.xdts`
}

export function aeRemapJsxFileName(project: CutProject): string {
  return `${projectOutputPrefix(project)}_ae-remap.jsx`
}

export function sheetImageFileName(project: CutProject, format: SheetImageExportFormat, pageIndex: number, totalPages: number): string {
  const digits = Math.max(2, String(Math.max(1, totalPages)).length)
  return `${projectOutputPrefix(project)}_sheet${String(pageIndex + 1).padStart(digits, '0')}.${format}`
}

export function correctedSheetImageFileName(project: CutProject, format: SheetImageExportFormat, pageIndex: number, totalPages: number): string {
  const digits = Math.max(2, String(Math.max(1, totalPages)).length)
  return `${projectOutputPrefix(project)}_paper-sheet${String(pageIndex + 1).padStart(digits, '0')}_corrected.${format}`
}

export function projectOutputPrefix(project: Pick<CutProject, 'cut'>): string {
  const title = safeFileNameSegment(project.cut.title)
  const episode = safeFileNameSegment(project.cut.episode)
  const scene = safeFileNameSegment(project.cut.scene)
  const cut = [scene, safeFileNameSegment(project.cut.cut) || '000'].filter(Boolean).join('-')
  const productionPrefix = [title, episode].filter(Boolean).join('_')
  return productionPrefix ? `${productionPrefix}_${cut}` : `_${cut}`
}

function safeFileNameSegment(value: string | undefined): string {
  return Array.from((value ?? '').trim(), char => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char)) ? '_' : char)
    .join('')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_. ]+|[_. ]+$/g, '')
}
