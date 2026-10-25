import { digitalStandardSheetTemplate, standardA3SheetTemplate, withSheetTemplatePaperTracks,
  type NormalizedRect, type SheetTemplate, type SheetTemplatePageSize } from '@xsheet-remap/core'
import { APP_LINK_QR_MODULE_COUNT, APP_LINK_QR_RUNS, APP_LINK_URL } from './appLinkQr'

export type SheetTemplateBranding = {
  url: string
  qrRect: NormalizedRect
  qrPath: string
  name: { text: string; x: number; y: number; fontSizePx: number; color: string }
}

const standardKinds = new WeakMap<SheetTemplate, 'paper' | 'digital' | null>()

/** Templates are immutable. Copies authored by the user have their own ID; also reject
 * externally edited definitions that retained a built-in ID. Logical track changes are data.
 */
function standardKind(template: SheetTemplate): 'paper' | 'digital' | null {
  if (standardKinds.has(template)) return standardKinds.get(template)!
  const base = [standardA3SheetTemplate, digitalStandardSheetTemplate].find(item => item.templateId === template.templateId)
  const kind = base && (base === template || sameDefinition(
    comparableDefinition(template), comparableDefinition(withSheetTemplatePaperTracks(base, template.defaults.paperTracks)),
  )) ? base === standardA3SheetTemplate ? 'paper' : 'digital' : null
  standardKinds.set(template, kind)
  return kind
}

function comparableDefinition(template: SheetTemplate) {
  // Applying an untouched paper preset quantizes its rectangles to page pixels.
  const rect = (r: NormalizedRect) => [Math.round(r.x * template.page.widthPx), Math.round(r.y * template.page.heightPx),
    Math.round(r.w * template.page.widthPx), Math.round(r.h * template.page.heightPx)]
  return { ...template,
    calibration: template.calibration && { ...template.calibration,
      targetRect: template.calibration.targetRect && rect(template.calibration.targetRect) },
    regions: template.regions.map(region => ({ ...region, rect: rect(region.rect) })),
  }
}

function sameDefinition(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left).filter(key => left[key] !== undefined)
  return keys.length === Object.keys(right).filter(key => right[key] !== undefined).length
    && keys.every(key => sameDefinition(left[key], right[key]))
}

/** Keep the full-width memo and timing area; reserve only the digital metadata row's end. */
export function reserveSheetBrandingSpace(template: SheetTemplate, regionId: string,
  rect: NormalizedRect, pageSize: SheetTemplatePageSize): NormalizedRect {
  return regionId === 'digital_metadata_form' && standardKind(template) === 'digital'
    ? { ...rect, w: rect.w - (APP_LINK_QR_MODULE_COUNT * 3 + 12) / pageSize.widthPx }
    : rect
}

export function buildSheetTemplateBranding(template: SheetTemplate, pageSize: SheetTemplatePageSize): SheetTemplateBranding | null {
  const kind = standardKind(template)
  if (!kind) return null
  const { widthPx, heightPx } = pageSize
  const pitch = kind === 'paper' ? 2 : 3
  const size = APP_LINK_QR_MODULE_COUNT * pitch
  const right = widthPx - (kind === 'paper' ? 36 : 32)
  const left = right - size, top = kind === 'paper' ? 47 : 24
  return {
    url: APP_LINK_URL,
    qrRect: { x: left / widthPx, y: top / heightPx, w: size / widthPx, h: size / heightPx },
    qrPath: APP_LINK_QR_RUNS.map(run => {
      const x = (left + run.x * pitch) / widthPx, y = (top + run.y * pitch) / heightPx
      const w = run.width * pitch / widthPx, h = pitch / heightPx
      return `M${x} ${y}h${w}v${h}h${-w}z`
    }).join(''),
    name: { text: 'xsheet-remap', x: right / widthPx, y: (heightPx - (kind === 'paper' ? 32 : 40)) / heightPx,
      fontSizePx: kind === 'paper' ? 14 : 18, color: '#657067' },
  }
}
