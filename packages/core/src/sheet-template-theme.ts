import type {
  SheetTemplateGridRowLineWeight,
  SheetTemplateTheme,
  SheetTemplateTimedRangeCueTheme,
} from './sheet-template-schema'
import type { TimedRangeRole } from './types'

export interface SheetTemplateThemePreset {
  presetId: string
  name: string
  theme: SheetTemplateTheme
}

export interface ResolvedTimedRangeCuePaint {
  fillColor: string
  fillOpacity: number
  hoverOpacity: number
  strokeColor: string
  textColor: string
}

export function createDefaultSheetTemplateTheme(): SheetTemplateTheme {
  return {
    presetId: 'soft-neutral',
    paper: {
      color: '#f7f7f4',
      secondBands: {
        enabled: true,
        color: '#627168',
        opacity: 0.045,
      },
    },
    ink: {
      text: '#1f2421',
      reference: '#416b5a',
      lines: {
        thin: '#8b908a',
        regular: '#646a64',
        medium: '#343b36',
        strong: '#101512',
        outer: '#2f3430',
      },
    },
    timedRangeCues: {
      sound: cueTheme('#25795e', '#a77024'),
      camera: cueTheme('#365f9d', '#8a5d91'),
    },
  }
}

export const sheetTemplateThemePresets: readonly SheetTemplateThemePreset[] = [
  {
    presetId: 'soft-neutral',
    name: 'ソフトニュートラル',
    theme: createDefaultSheetTemplateTheme(),
  },
  {
    presetId: 'warm-paper',
    name: 'ウォームペーパー',
    theme: {
      presetId: 'warm-paper',
      paper: {
        color: '#fbf3de',
        secondBands: { enabled: true, color: '#9b7135', opacity: 0.055 },
      },
      ink: {
        text: '#302a21',
        reference: '#6d6847',
        lines: {
          thin: '#a79d89',
          regular: '#7f7462',
          medium: '#51483b',
          strong: '#2e2922',
          outer: '#463e32',
        },
      },
      timedRangeCues: {
        sound: cueTheme('#34765d', '#a06c27'),
        camera: cueTheme('#4d6799', '#8c5e78'),
      },
    },
  },
  {
    presetId: 'cool-paper',
    name: 'クールペーパー',
    theme: {
      presetId: 'cool-paper',
      paper: {
        color: '#eef4f4',
        secondBands: { enabled: true, color: '#426d75', opacity: 0.05 },
      },
      ink: {
        text: '#1e2b2d',
        reference: '#3e6970',
        lines: {
          thin: '#85989b',
          regular: '#61777b',
          medium: '#344b50',
          strong: '#172a2e',
          outer: '#2b4246',
        },
      },
      timedRangeCues: {
        sound: cueTheme('#267b69', '#9a6f2d'),
        camera: cueTheme('#376ea2', '#845f9a'),
      },
    },
  },
]

export function sheetTemplateThemePreset(presetId: string): SheetTemplateThemePreset | null {
  return sheetTemplateThemePresets.find(preset => preset.presetId === presetId) ?? null
}

export function cloneSheetTemplateTheme(theme: SheetTemplateTheme): SheetTemplateTheme {
  return {
    ...theme,
    paper: {
      ...theme.paper,
      secondBands: { ...theme.paper.secondBands },
    },
    ink: {
      ...theme.ink,
      lines: { ...theme.ink.lines },
    },
    timedRangeCues: {
      sound: cloneCueTheme(theme.timedRangeCues.sound),
      camera: cloneCueTheme(theme.timedRangeCues.camera),
    },
  }
}

export function sheetTemplateLineColor(
  theme: SheetTemplateTheme,
  weight: SheetTemplateGridRowLineWeight | 'outer',
): string {
  return theme.ink.lines[weight]
}

export function timedRangeCuePaint(
  theme: SheetTemplateTheme,
  role: Extract<TimedRangeRole, 'sound' | 'camera'>,
  columnIndex: number,
): ResolvedTimedRangeCuePaint {
  const cueTheme = theme.timedRangeCues[role]
  const index = normalizedModulo(Math.trunc(columnIndex), cueTheme.columnColors.length)
  return {
    fillColor: cueTheme.columnColors[index]!,
    fillOpacity: cueTheme.fillOpacity,
    hoverOpacity: cueTheme.hoverOpacity,
    strokeColor: cueTheme.strokeColor,
    textColor: cueTheme.textColor,
  }
}

export function isSheetTemplateTheme(input: unknown): input is SheetTemplateTheme {
  if (!isRecord(input)) return false
  if (input.presetId !== undefined && typeof input.presetId !== 'string') return false
  if (!isRecord(input.paper) || !hexColor(input.paper.color) || !isSecondBands(input.paper.secondBands)) return false
  if (!isRecord(input.ink) || !hexColor(input.ink.text) || !hexColor(input.ink.reference) || !isLineColors(input.ink.lines)) return false
  return isRecord(input.timedRangeCues)
    && isCueTheme(input.timedRangeCues.sound)
    && isCueTheme(input.timedRangeCues.camera)
}

function cueTheme(first: string, second: string): SheetTemplateTimedRangeCueTheme {
  return {
    columnColors: [first, second],
    fillOpacity: 0.16,
    hoverOpacity: 0.24,
    strokeColor: '#195b46',
    textColor: '#173f32',
  }
}

function cloneCueTheme(theme: SheetTemplateTimedRangeCueTheme): SheetTemplateTimedRangeCueTheme {
  return { ...theme, columnColors: [...theme.columnColors] }
}

function isSecondBands(input: unknown): boolean {
  return isRecord(input)
    && typeof input.enabled === 'boolean'
    && hexColor(input.color)
    && unitInterval(input.opacity)
}

function isLineColors(input: unknown): boolean {
  return isRecord(input)
    && ['thin', 'regular', 'medium', 'strong', 'outer'].every(key => hexColor(input[key]))
}

function isCueTheme(input: unknown): boolean {
  return isRecord(input)
    && Array.isArray(input.columnColors)
    && input.columnColors.length === 2
    && input.columnColors.every(hexColor)
    && unitInterval(input.fillOpacity)
    && unitInterval(input.hoverOpacity)
    && input.hoverOpacity >= input.fillOpacity
    && hexColor(input.strokeColor)
    && hexColor(input.textColor)
}

function hexColor(input: unknown): input is string {
  return typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input)
}

function unitInterval(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 && input <= 1
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null
}

function normalizedModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
