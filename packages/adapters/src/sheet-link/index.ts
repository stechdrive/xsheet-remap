import qrcode from 'qrcode-generator'
import type { CutProject, SheetPage, SheetTemplate } from '@xsheet-remap/core'
import { collectLinkSheet, selectLinkPage, type LinkSheet } from './model'
import { encodeSheetLink, SHEET_LINK_PREFIX } from './packet'

export { openSheetLink, readBrowserSheetLink, type OpenedSheetLink } from './restore'
export { SHEET_LINK_PREFIX }

// QR Model 2 data codewords, medium error correction, versions 1 through 40.
const codewords = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453, 507, 563, 627, 669,
  714, 782, 860, 914, 1000, 1062, 1128, 1193, 1267, 1373, 1455, 1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334]

export interface SheetQrCandidate { digits: string; modules: number; whole: boolean; omitted: number }

function moduleCount(length: number) {
  const numericBits = Math.floor(length / 3) * 10 + [0, 4, 7][length % 3]!
  const version = codewords.findIndex((capacity, i) =>
    4 + (i < 9 ? 8 : 16) + SHEET_LINK_PREFIX.length * 8 + 4 + (i < 9 ? 10 : i < 26 ? 12 : 14) + numericBits <= capacity * 8) + 1
  return version ? 17 + 4 * version + 8 : 0
}

const sheets = new WeakMap<CutProject, { template: SheetTemplate; scope: string; sheet: LinkSheet; pages: Map<string, SheetQrCandidate[]> }>()

export function* sheetQrCandidates(project: CutProject, template: SheetTemplate, page: SheetPage, count: number, scope = ''): Generator<SheetQrCandidate[]> {
  let cached = sheets.get(project)
  if (!cached || cached.template !== template || cached.scope !== scope) {
    cached = { template, scope, sheet: collectLinkSheet(project, template, scope), pages: new Map() }
    sheets.set(project, cached)
  }
  const source = cached.sheet
  for (const tier of [3, 2, 1]) {
    if (tier === 2 && !source.fields.length || tier === 1 && !source.cues.length) continue
    const key = [count, page.pageIndex, page.frameStart, page.frameEnd, tier].join('/')
    const previous = cached.pages.get(key)
    if (previous) {
      if (previous.length) yield previous
      continue
    }
    const candidates: SheetQrCandidate[] = []
    for (const whole of count === 1 ? [true] : [true, false]) {
      const packet = selectLinkPage(source, page, count, whole, tier)
      let digits: string | undefined
      try { digits = encodeSheetLink(packet) } catch { continue }
      const modules = digits && moduleCount(digits.length)
      if (digits && modules) candidates.push({ digits, modules, whole, omitted: packet.omitted })
    }
    if (cached.pages.size >= 64) cached.pages.delete(cached.pages.keys().next().value!)
    cached.pages.set(key, candidates)
    if (candidates.length) yield candidates
  }
}

export function sheetQrRuns(candidate: SheetQrCandidate) {
  const qr = qrcode(((candidate.modules - 25) / 4) as Parameters<typeof qrcode>[0], 'M')
  qr.addData(SHEET_LINK_PREFIX, 'Byte')
  qr.addData(candidate.digits, 'Numeric')
  qr.make()
  const runs: { x: number; y: number; width: number }[] = []
  for (let row = 0; row < qr.getModuleCount(); row++) {
    for (let col = 0; col < qr.getModuleCount();) {
      if (!qr.isDark(row, col)) {
        col++
        continue
      }
      const start = col
      do { col++ } while (col < qr.getModuleCount() && qr.isDark(row, col))
      runs.push({ x: start + 4, y: row + 4, width: col - start })
    }
  }
  return runs
}
