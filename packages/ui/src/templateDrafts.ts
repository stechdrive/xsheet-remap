import { digitalStandardSheetTemplate, standardA3SheetTemplate, type SheetTemplate } from '@xsheet-remap/core'
import { uiText } from './i18n'

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
  imageSize: { width: number; height: number } | null,
): SheetTemplate {
  const template = createTemplateDraftFromBase(standardA3SheetTemplate, {
    idBase: fileNameStem(file.name) || 'paper-template',
    name: uiText.template.draftNames.paperFromImage(fileNameStem(file.name) || file.name),
  })
  return {
    ...template,
    page: imageSize
      ? {
          ...template.page,
          widthPx: imageSize.width,
          heightPx: imageSize.height,
        }
      : template.page,
    defaultUnderlay: {
      sourceId: `template_reference_${Date.now().toString(36)}`,
      label: file.name,
      assetPath: dataUrl,
      imageRef: {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        assetPath: dataUrl,
      },
    },
  }
}

export function cloneSheetTemplate(template: SheetTemplate): SheetTemplate {
  return structuredClone(template)
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
  return isModifiedBuiltInSheetTemplate(template)
    ? ensureEditableTemplateDraft(template)
    : cloneSheetTemplate(template)
}

export function readImageDimensionsFromDataUrl(dataUrl: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise(resolve => {
    const image = new Image()
    let settled = false
    const timeout = globalThis.setTimeout(() => finish(null), 1500)
    function finish(size: { width: number; height: number } | null) {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      resolve(size && size.width > 0 && size.height > 0 ? size : null)
    }
    image.onload = () => finish({
      width: Math.max(1, Math.round(image.naturalWidth || image.width)),
      height: Math.max(1, Math.round(image.naturalHeight || image.height)),
    })
    image.onerror = () => finish(null)
    image.src = dataUrl
  })
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
