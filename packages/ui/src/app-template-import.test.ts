import { describe, expect, it } from 'vitest'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { loadSheetTemplate, SHEET_TEMPLATE_FILE_ACCEPT } from './app-template-import'

describe('sheet template import contract', () => {
  it('uses JSON without accepting XSR projects', () => {
    expect(SHEET_TEMPLATE_FILE_ACCEPT).toBe('.json,application/json')
  })

  it('parses and validates a JSON template', async () => {
    const file = new File([JSON.stringify(standardA3SheetTemplate)], 'studio-template.json', { type: 'application/json' })
    const loaded = await loadSheetTemplate(asFileList(file))
    expect(loaded?.templateId).toBe(standardA3SheetTemplate.templateId)
  })

  it('rejects an XSR file before attempting template parsing', async () => {
    const file = new File(['not-a-template'], 'project.xsr', { type: 'application/vnd.xsheet-remap.project' })
    await expect(loadSheetTemplate(asFileList(file))).rejects.toThrow('シートテンプレートはJSONファイルを選択してください')
  })
})

function asFileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (index: number) => index === 0 ? file : null,
  } as unknown as FileList
}
