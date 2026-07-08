import type { CutProject } from '@xsheet-remap/core'

type SheetImageExportFormat = 'jpg' | 'png' | 'psd'

export function projectFileName(project: CutProject): string {
  return `${projectOutputPrefix(project)}.xsr.json`
}

export function sheetXdtsFileName(project: CutProject): string {
  return `${projectOutputPrefix(project)}_sheet.xdts`
}

export function aeRemapFileName(project: CutProject): string {
  return `${projectOutputPrefix(project)}_ae-remap.tsv`
}

export function sheetImageFileName(project: CutProject, format: SheetImageExportFormat, pageIndex: number, totalPages: number): string {
  const digits = Math.max(2, String(Math.max(1, totalPages)).length)
  return `${projectOutputPrefix(project)}_sheet${String(pageIndex + 1).padStart(digits, '0')}.${format}`
}

export function projectOutputPrefix(project: Pick<CutProject, 'cut'>): string {
  const title = safeFileNameSegment(project.cut.title)
  const episode = safeFileNameSegment(project.cut.episode)
  const cut = safeFileNameSegment(project.cut.cut) || '000'
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
