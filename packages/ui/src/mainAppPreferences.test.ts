import { afterEach, describe, expect, it } from 'vitest'
import { digitalStandardSheetTemplate, standardA3SheetTemplate } from '@xsheet-remap/core'
import {
  createPreferredProject,
  lastTemplatePresetStorageKey,
  preferredSheetTemplatePreset,
  rememberSheetTemplatePreset,
} from './mainAppPreferences'

afterEach(() => window.localStorage.clear())

describe('main application template preferences', () => {
  it('keeps editor and remap preferences independent and falls back to A3', () => {
    expect(preferredSheetTemplatePreset('editor').sheetTemplate.templateId).toBe(standardA3SheetTemplate.templateId)

    rememberSheetTemplatePreset('editor', 'digital-standard')

    expect(preferredSheetTemplatePreset('editor').sheetTemplate.templateId).toBe(digitalStandardSheetTemplate.templateId)
    expect(preferredSheetTemplatePreset('remap').sheetTemplate.templateId).toBe(standardA3SheetTemplate.templateId)
  })

  it('ignores removed or custom preset identifiers', () => {
    window.localStorage.setItem(lastTemplatePresetStorageKey('editor'), 'missing-preset')

    expect(preferredSheetTemplatePreset('editor').presetId).toBe('standard-a3-default')
    expect(rememberSheetTemplatePreset('editor', 'custom-template')).toBeNull()
  })

  it('creates a matching blank project from the remembered preset', () => {
    rememberSheetTemplatePreset('remap', 'digital-standard')

    const { project, preset } = createPreferredProject('remap')

    expect(preset.presetId).toBe('digital-standard')
    expect(project.studioPresetId).toBe('digital-standard')
    expect(project.sheetTemplateId).toBe(digitalStandardSheetTemplate.templateId)
    expect(project.logicalSheet.fps).toBe(digitalStandardSheetTemplate.defaults.fps)
  })
})
