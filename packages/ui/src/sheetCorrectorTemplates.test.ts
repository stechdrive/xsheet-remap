import { afterEach, describe, expect, it } from 'vitest'
import { digitalStandardSheetTemplate, standardA3SheetTemplate } from '@xsheet-remap/core'
import {
  SHEET_CORRECTOR_TEMPLATE_PATH_STORAGE_KEY,
  loadSheetCorrectorTemplateFile,
  loadStoredSheetCorrectorTemplatePath,
  parseSheetCorrectorTemplateJson,
  saveStoredSheetCorrectorTemplatePath,
  sheetCorrectorExternalTemplateLabel,
} from './sheetCorrectorTemplates'

afterEach(() => {
  window.localStorage.clear()
})

describe('sheet corrector templates', () => {
  it('accepts an image-correction capable template JSON', () => {
    const template = parseSheetCorrectorTemplateJson(JSON.stringify(standardA3SheetTemplate))
    expect(template.templateId).toBe(standardA3SheetTemplate.templateId)
  })

  it('rejects non-correction template JSON', () => {
    expect(() => parseSheetCorrectorTemplateJson(JSON.stringify(digitalStandardSheetTemplate))).toThrow('紙シート補正')
  })

  it('loads template files with their source path', () => {
    const loaded = loadSheetCorrectorTemplateFile({
      path: 'C:/templates/custom.json',
      contents: JSON.stringify({
        ...standardA3SheetTemplate,
        templateId: 'custom-paper',
        name: 'カスタム紙',
      }),
    })
    expect(loaded.path).toBe('C:/templates/custom.json')
    expect(loaded.template.templateId).toBe('custom-paper')
    expect(sheetCorrectorExternalTemplateLabel(loaded.template, loaded.path)).toBe('カスタム紙')
  })

  it('stores only the external template path', () => {
    saveStoredSheetCorrectorTemplatePath('C:/templates/custom.json')
    expect(window.localStorage.getItem(SHEET_CORRECTOR_TEMPLATE_PATH_STORAGE_KEY)).toBe('C:/templates/custom.json')
    expect(loadStoredSheetCorrectorTemplatePath()).toBe('C:/templates/custom.json')

    saveStoredSheetCorrectorTemplatePath(undefined)
    expect(loadStoredSheetCorrectorTemplatePath()).toBeNull()
  })
})
