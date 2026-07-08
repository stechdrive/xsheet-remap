import type { CSSProperties } from 'react'
import type { SheetHit, SheetImageAlignment, SheetPageImageRef, SheetTemplateGrid, SheetTemplateInputMode } from '@xsheet-remap/core'

export type Panel = 'sheet' | 'bindings' | 'slots' | 'template' | 'recognition' | 'export'
export type TemplateDetailTab = 'region' | 'display' | 'reference' | 'table' | 'json'
export type EditMode = 'new' | 'pen' | 'eraser' | 'text' | 'calibrate'
export type CalibrationPointKind = 'source' | 'target'
export type CalibrationStage = CalibrationPointKind
export type SheetImageSettings = SheetImageAlignment

export type WorkspaceStyle = CSSProperties & {
  '--sheet-left-dock-width'?: string
  '--sheet-right-dock-width'?: string
  '--template-dock-width'?: string
}

export interface SheetPageImage {
  imageUrl: string | null
  sourceId?: string
  imageRef?: SheetPageImageRef
  settings: SheetImageSettings
}

export interface Selection {
  hit: SheetHit | null
  keyId: string | null
}

export interface SheetRangeSelection {
  role: SheetTemplateGrid['role']
  inputMode: SheetTemplateInputMode
  frameStart: number
  frameEnd: number
  anchorFrame: number
  focusFrame: number
  columnId: string
  paperTracks: string[]
  paperTrack?: string
  flowGroupId?: string
  anchorHit: SheetHit
  focusHit: SheetHit
}

export interface TimingClipboard {
  role: 'action' | 'cell'
  sourcePaperTracks: string[]
  sourcePaperTrack: string
  spanFrames: number
  sourceFrameStart: number
  sourceFrameEnd: number
  mode: 'copy' | 'cut'
  items: Array<{
    paperTrackOffset: number
    offsetFrames: number
    kind: 'empty' | 'null' | 'key'
    keyId?: string
    displayLabel?: string
    fontSizePx?: number
  }>
}
