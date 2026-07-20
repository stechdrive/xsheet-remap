import { digitalStandardSheetTemplate, standardA3SheetTemplate, type SheetTemplate, type SheetTemplateUnderlayPlacement } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { quantizeNormalizedRectToPagePixels } from './templateEditorGeometry'
import type { TemplateImageMetadata } from './templateImageMetadata'

export { readImageDimensionsFromDataUrl } from './templateImageMetadata'

export type TemplateDraftKind = 'paper-standard' | 'digital-standard' | 'duplicate-current'

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('FileReader did not return a data URL.'))
      }
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read file.')))
    reader.readAsDataURL(file)
  })
}

export function createTemplateDraft(kind: TemplateDraftKind, currentTemplate: SheetTemplate): SheetTemplate {
  if (kind === 'digital-standard') {
    return createTemplateDraftFromBase(digitalStandardSheetTemplate, {
      idBase: 'digital-template',
      name: uiText.template.draftNames.digital,
    })
  }
  if (kind === 'duplicate-current') {
    return createTemplateDraftFromBase(currentTemplate, {
      idBase: `${currentTemplate.templateId}-copy`,
      name: uiText.template.draftNames.copy(currentTemplate.name),
    })
  }
  return createTemplateDraftFromBase(standardA3SheetTemplate, {
    idBase: 'paper-template',
    name: uiText.template.draftNames.paperStandard,
  })
}

export function createPaperTemplateDraftFromImage(
  file: File,
  dataUrl: string,
  imageSize: TemplateImageMetadata | null,
): SheetTemplate {
  const template = createTemplateDraftFromBase(standardA3SheetTemplate, {
    idBase: fileNameStem(file.name) || 'paper-template',
    name: uiText.template.draftNames.paperFromImage(fileNameStem(file.name) || file.name),
  })
  return {
    ...template,
    page: template.page,
    defaultUnderlay: {
      sourceId: `template_reference_${Date.now().toString(36)}`,
      label: file.name,
      assetPath: dataUrl,
      imageRef: {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        assetPath: dataUrl,
        ...(imageSize ? {
          pixelWidth: imageSize.width,
          pixelHeight: imageSize.height,
          ppiX: imageSize.ppiX,
          ppiY: imageSize.ppiY,
        } : {}),
      },
      ...(imageSize ? { placement: resolvePixelExactUnderlayPlacement(template.page.widthPx, template.page.heightPx, imageSize, imageSize) } : {}),
    },
  }
}

export function resolvePixelExactUnderlayPlacement(
  pageWidthPx: number,
  pageHeightPx: number,
  image: TemplateImageMetadata,
  density: Pick<TemplateImageMetadata, 'ppiX' | 'ppiY'> = image,
): SheetTemplateUnderlayPlacement {
  const offsetXPx = centeredIntegerOffset(pageWidthPx, image.width)
  const offsetYPx = centeredIntegerOffset(pageHeightPx, image.height)
  return {
    mode: 'pixel-exact',
    sourceWidthPx: image.width,
    sourceHeightPx: image.height,
    offsetXPx,
    offsetYPx,
    renderedWidthPx: image.width,
    renderedHeightPx: image.height,
    ...(density.ppiX ? { ppiX: density.ppiX } : {}),
    ...(density.ppiY ? { ppiY: density.ppiY } : {}),
  }
}

export function templateImageDensityMatches(templatePpi: number | undefined, metadata: TemplateImageMetadata, tolerance = 0.002): boolean | null {
  if (!templatePpi || !metadata.ppiX || !metadata.ppiY) return null
  return relativeDifference(templatePpi, metadata.ppiX) <= tolerance
    && relativeDifference(templatePpi, metadata.ppiY) <= tolerance
}

export function cloneSheetTemplate(template: SheetTemplate): SheetTemplate {
  return structuredClone(template)
}

export function removeTemplateRegion(template: SheetTemplate, regionId: string): SheetTemplate {
  const deletedRegion = template.regions.find(region => region.regionId === regionId)
  if (!deletedRegion) return template
  if (template.regions.length <= 1) throw new Error(uiText.template.cannotDeleteLastRegion)

  const regions = template.regions.filter(region => region.regionId !== regionId)
  const deletedFieldIds = new Set((deletedRegion.form?.cells ?? []).flatMap(cell => cell.fieldId ? [cell.fieldId] : []))
  const remainingFieldIds = new Set(regions.flatMap(region =>
    (region.form?.cells ?? []).flatMap(cell => cell.fieldId ? [cell.fieldId] : []),
  ))
  const fields = template.fields?.filter(field =>
    !deletedFieldIds.has(field.fieldId) || remainingFieldIds.has(field.fieldId),
  )
  const auxiliaryBands = template.auxiliaryBands
    ?.map(band => ({
      ...band,
      anchorRegionIds: band.anchorRegionIds.filter(id => id !== regionId),
      slotRegionIds: band.slotRegionIds.filter(id => id !== regionId),
    }))
    .filter(band => band.anchorRegionIds.length > 0 && band.slotRegionIds.length > 0)
  const horizontalFlowRegionIds = template.horizontalFlow?.regionIds.filter(id => id !== regionId)

  return {
    ...template,
    regions,
    fields: fields?.length ? fields : undefined,
    auxiliaryBands: auxiliaryBands?.length ? auxiliaryBands : undefined,
    horizontalFlow: template.horizontalFlow && horizontalFlowRegionIds?.length
      ? { ...template.horizontalFlow, regionIds: horizontalFlowRegionIds }
      : undefined,
  }
}

export function isBuiltInSheetTemplate(template: Pick<SheetTemplate, 'templateId'>): boolean {
  return builtInSheetTemplateForId(template.templateId) !== null
}

export function isModifiedBuiltInSheetTemplate(template: SheetTemplate): boolean {
  const builtInTemplate = builtInSheetTemplateForId(template.templateId)
  return Boolean(builtInTemplate && JSON.stringify(template) !== JSON.stringify(builtInTemplate))
}

export function ensureEditableTemplateDraft(template: SheetTemplate): SheetTemplate {
  if (!isBuiltInSheetTemplate(template)) return template
  return createTemplateDraftFromBase(template, {
    idBase: `${template.templateId}-custom`,
    name: editableTemplateDraftName(template),
  })
}

export function finalizeTemplateDraftForApply(template: SheetTemplate): SheetTemplate {
  const finalized = isModifiedBuiltInSheetTemplate(template)
    ? ensureEditableTemplateDraft(template)
    : cloneSheetTemplate(template)
  return quantizeTemplateGeometry(finalized)
}

export function quantizeTemplateGeometry(template: SheetTemplate): SheetTemplate {
  if (template.templateKind === 'digital-native') return template
  return {
    ...template,
    calibration: template.calibration?.targetRect
      ? { ...template.calibration, targetRect: quantizeNormalizedRectToPagePixels(template.calibration.targetRect, template.page) }
      : template.calibration,
    regions: template.regions.map(region => ({
      ...region,
      rect: quantizeNormalizedRectToPagePixels(region.rect, template.page),
    })),
  }
}

export function templateJsonFileName(template: SheetTemplate): string {
  const baseName = safeFileName(template.name || template.templateId || 'template')
  return `${baseName}.template.json`
}

function createTemplateDraftFromBase(baseTemplate: SheetTemplate, options: { idBase: string; name: string }): SheetTemplate {
  const template = cloneSheetTemplate(baseTemplate)
  return {
    ...template,
    templateId: `${safeTemplateIdSegment(options.idBase)}-${Date.now().toString(36)}`,
    name: options.name,
  }
}

function builtInSheetTemplateForId(templateId: string): SheetTemplate | null {
  if (templateId === standardA3SheetTemplate.templateId) return standardA3SheetTemplate
  if (templateId === digitalStandardSheetTemplate.templateId) return digitalStandardSheetTemplate
  return null
}

function editableTemplateDraftName(template: SheetTemplate): string {
  const builtInTemplate = builtInSheetTemplateForId(template.templateId)
  if (builtInTemplate && template.name && template.name !== builtInTemplate.name) return template.name
  return uiText.template.draftNames.editableCopy(template.name)
}

function safeTemplateIdSegment(value: string): string {
  const safe = safeFileName(value)
    .toLocaleLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return safe || 'template'
}

function fileNameStem(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  return (dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName).trim()
}

function safeFileName(value: string): string {
  const safe = Array.from(value.trim(), char => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char)) ? '_' : char).join('').replace(/[. ]+$/g, '')
  return safe || 'template'
}

function centeredIntegerOffset(pageSize: number, imageSize: number): number {
  const offset = imageSize >= pageSize
    ? -Math.floor((imageSize - pageSize) / 2)
    : Math.floor((pageSize - imageSize) / 2)
  return offset === 0 ? 0 : offset
}

function relativeDifference(expected: number, actual: number): number {
  return Math.abs(actual - expected) / Math.max(1, Math.abs(expected))
}
