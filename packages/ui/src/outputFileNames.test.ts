import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '@xsheet-remap/core'
import { projectFileName, projectOutputPrefix, sheetImageFileName, sheetXdtsFileName } from './outputFileNames'

describe('output file names', () => {
  it('uses title, episode, and cut number as the main app output prefix', () => {
    const project = {
      ...createDefaultProject(),
      cut: { title: 'SAMPLE', episode: '05', cut: '237' },
    }

    expect(projectOutputPrefix(project)).toBe('SAMPLE_05_237')
    expect(projectFileName(project)).toBe('SAMPLE_05_237.xsr.json')
    expect(sheetXdtsFileName(project)).toBe('SAMPLE_05_237_sheet.xdts')
    expect(sheetImageFileName(project, 'jpg', 0, 12)).toBe('SAMPLE_05_237_sheet01.jpg')
    expect(sheetImageFileName(project, 'psd', 11, 12)).toBe('SAMPLE_05_237_sheet12.psd')
  })

  it('sanitizes file-system reserved characters and falls back to cut', () => {
    const project = {
      ...createDefaultProject(),
      cut: { title: 'SAMPLE/05', episode: 'ep:01', cut: 'C*001' },
    }
    const blank = {
      ...createDefaultProject(),
      cut: {},
    }

    expect(projectOutputPrefix(project)).toBe('SAMPLE_05_ep_01_C_001')
    expect(projectOutputPrefix(blank)).toBe('_000')
  })

  it('omits blank title and episode while keeping the cut prefix separator', () => {
    const project = {
      ...createDefaultProject(),
      cut: { title: '', episode: '', cut: '237' },
    }

    expect(projectOutputPrefix(project)).toBe('_237')
    expect(sheetXdtsFileName(project)).toBe('_237_sheet.xdts')
  })
})
