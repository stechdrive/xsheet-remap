import { isTimelineProjectingSheetTemplateGridRegion, resolveSheetTemplateTextStyle, type SheetTemplate, type SheetTemplateGridTypography, type SheetTimingRole } from '@xsheet-remap/core'

export const TEXT_FONT_SIZE_MIN_PX = 6
export const TEXT_FONT_SIZE_MAX_PX = 256
export const DEFAULT_TEXT_FONT_SIZE_PX = 18
export const TEXT_FONT_SIZE_PRESETS = [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 96, 128, 192, 256]

export function clampTextFontSizePx(value: number): number {
  const safeValue = Number.isFinite(value) ? value : DEFAULT_TEXT_FONT_SIZE_PX
  return Math.max(TEXT_FONT_SIZE_MIN_PX, Math.min(TEXT_FONT_SIZE_MAX_PX, Math.round(safeValue)))
}

export function defaultTimingTextFontSizePx(template: SheetTemplate, role: SheetTimingRole | null | undefined = 'cell'): number {
  const grid = timingTextGridForRole(template, role)
  return clampTextFontSizePx(resolveGridTypographyFontSizes(template, template.page, grid?.typography).fontSizePx)
}

export function resolveGridTypographyFontSizes(
  template: SheetTemplate,
  pageSize: { widthPx: number; heightPx: number },
  typography: SheetTemplateGridTypography | undefined,
  defaults: { fontSizePx?: number; minFontSizePx?: number } = {},
): { fontSizePx: number; minFontSizePx: number } {
  const resolved = resolveSheetTemplateTextStyle(template, pageSize, {
    fontSize: typography?.cellFontSize,
    minFontSize: typography?.cellMinFontSize,
    fontSizePx: typography?.cellFontSizePx,
    minFontSizePx: typography?.cellMinFontSizePx,
  }, {
    fontSizePx: defaults.fontSizePx ?? DEFAULT_TEXT_FONT_SIZE_PX,
    minFontSizePx: defaults.minFontSizePx ?? TEXT_FONT_SIZE_MIN_PX,
  })
  return { fontSizePx: resolved.fontSizePx, minFontSizePx: resolved.minFontSizePx }
}

export function defaultTimingTextMinFontSizePx(template: SheetTemplate, role: SheetTimingRole | null | undefined = 'cell'): number {
  const grid = timingTextGridForRole(template, role)
  return clampTextFontSizePx(resolveGridTypographyFontSizes(template, template.page, grid?.typography).minFontSizePx)
}

export function resolveTimingTextFontSizePx(
  template: SheetTemplate,
  role: SheetTimingRole,
  eventFontSizePx: number | undefined,
): number {
  if (typeof eventFontSizePx === 'number' && Number.isFinite(eventFontSizePx)) {
    return clampTextFontSizePx(eventFontSizePx)
  }
  return defaultTimingTextFontSizePx(template, role)
}

function timingTextGridForRole(template: SheetTemplate, role: SheetTimingRole | null | undefined) {
  const targetRole = role ?? 'cell'
  return template.regions.find(region =>
    isTimelineProjectingSheetTemplateGridRegion(region)
    && region.grid.role === targetRole
    && (region.grid.typography?.cellFontSize !== undefined || typeof region.grid.typography?.cellFontSizePx === 'number'),
  )?.grid
    ?? template.regions.find(region =>
      isTimelineProjectingSheetTemplateGridRegion(region)
      && region.grid.role === targetRole,
    )?.grid
    ?? template.regions.find(region =>
      isTimelineProjectingSheetTemplateGridRegion(region)
      && (region.grid.role === 'cell' || region.grid.role === 'action')
      && (region.grid.typography?.cellFontSize !== undefined || typeof region.grid.typography?.cellFontSizePx === 'number'),
    )?.grid
}
