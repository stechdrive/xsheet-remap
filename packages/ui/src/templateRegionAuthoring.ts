import type { NormalizedRect, SheetTemplate } from '@xsheet-remap/core'

const REGION_OFFSET_PX = 12

export function duplicateTemplateRegion(
  template: SheetTemplate,
  regionId: string,
): { template: SheetTemplate; regionId: string } | null {
  const sourceIndex = template.regions.findIndex(region => region.regionId === regionId)
  const source = template.regions[sourceIndex]
  if (!source) return null

  const nextRegionId = uniqueTemplateRegionId(template, `${source.regionId}_copy`)
  const copy = structuredClone(source)
  copy.regionId = nextRegionId
  copy.label = `${source.label || '領域'} コピー`
  copy.rect = offsetRegionRect(source.rect, template, sourceIndex + 1)

  const regions = [...template.regions]
  regions.splice(sourceIndex + 1, 0, copy)
  return { template: { ...template, regions }, regionId: nextRegionId }
}

export function moveTemplateRegion(
  template: SheetTemplate,
  regionId: string,
  direction: -1 | 1,
): SheetTemplate {
  const sourceIndex = template.regions.findIndex(region => region.regionId === regionId)
  const targetIndex = sourceIndex + direction
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= template.regions.length) return template
  const regions = [...template.regions]
  const [region] = regions.splice(sourceIndex, 1)
  regions.splice(targetIndex, 0, region)
  return { ...template, regions }
}

export function placeNewTemplateRegion(
  template: SheetTemplate,
  rect: NormalizedRect,
): NormalizedRect {
  const offsetX = REGION_OFFSET_PX / Math.max(1, template.page.widthPx)
  const offsetY = REGION_OFFSET_PX / Math.max(1, template.page.heightPx)
  let candidate = clampRect(rect)

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!template.regions.some(region => substantiallyOverlaps(candidate, region.rect))) return candidate
    candidate = clampRect({ ...candidate, x: candidate.x + offsetX, y: candidate.y + offsetY })
  }
  return candidate
}

function offsetRegionRect(rect: NormalizedRect, template: SheetTemplate, salt: number): NormalizedRect {
  const offsetX = (REGION_OFFSET_PX * Math.max(1, salt % 4)) / Math.max(1, template.page.widthPx)
  const offsetY = (REGION_OFFSET_PX * Math.max(1, salt % 4)) / Math.max(1, template.page.heightPx)
  return clampRect({ ...rect, x: rect.x + offsetX, y: rect.y + offsetY })
}

export function uniqueTemplateRegionId(template: SheetTemplate, base: string): string {
  const ids = new Set(template.regions.map(region => region.regionId))
  if (!ids.has(base)) return base
  let suffix = 2
  while (ids.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

function substantiallyOverlaps(a: NormalizedRect, b: NormalizedRect): boolean {
  const intersectionWidth = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const intersectionHeight = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  if (intersectionWidth === 0 || intersectionHeight === 0) return false
  const smallerArea = Math.min(a.w * a.h, b.w * b.h)
  return smallerArea > 0 && (intersectionWidth * intersectionHeight) / smallerArea >= 0.85
}

function clampRect(rect: NormalizedRect): NormalizedRect {
  const w = Math.min(1, Math.max(0.0001, rect.w))
  const h = Math.min(1, Math.max(0.0001, rect.h))
  return {
    x: Math.min(1 - w, Math.max(0, rect.x)),
    y: Math.min(1 - h, Math.max(0, rect.y)),
    w,
    h,
  }
}
