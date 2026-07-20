import {
  createProjectFromTemplate,
  sheetTemplatePresets,
  standardA3SheetTemplatePreset,
  type CutProject,
  type SheetTemplatePreset,
} from '@xsheet-remap/core'
import type { MainAppKind } from './app-foundation'

export function lastTemplatePresetStorageKey(appKind: MainAppKind): string {
  return `xsheet:${appKind}:last-template-preset`
}

export function preferredSheetTemplatePreset(
  appKind: MainAppKind,
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): SheetTemplatePreset {
  try {
    const presetId = storage?.getItem(lastTemplatePresetStorageKey(appKind))
    return sheetTemplatePresets.find(preset => preset.presetId === presetId) ?? standardA3SheetTemplatePreset
  } catch {
    return standardA3SheetTemplatePreset
  }
}

export function rememberSheetTemplatePreset(
  appKind: MainAppKind,
  presetId: string | undefined,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): SheetTemplatePreset | null {
  const preset = sheetTemplatePresets.find(candidate => candidate.presetId === presetId)
  if (!preset) return null
  try {
    storage?.setItem(lastTemplatePresetStorageKey(appKind), preset.presetId)
  } catch {
    // Preferences are optional in restricted browser contexts.
  }
  return preset
}

export function createPreferredProject(appKind: MainAppKind): { project: CutProject; preset: SheetTemplatePreset } {
  const preset = preferredSheetTemplatePreset(appKind)
  return {
    preset,
    project: createProjectFromTemplate(preset.sheetTemplate, {
      studioPresetId: preset.presetId,
      sheetTemplateId: preset.sheetTemplate.templateId,
    }),
  }
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}
