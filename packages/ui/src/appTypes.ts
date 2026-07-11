import type { CSSProperties } from 'react'
import type { MaterialState, SheetHit, SheetImageAlignment, SheetPageImageRef, SheetTemplateGrid, SheetTemplateInputMode, TimingKey } from '@xsheet-remap/core'

export type Panel = 'sheet' | 'bindings' | 'slots' | 'template' | 'export'
export type TemplateDetailTab = 'region' | 'display' | 'reference' | 'table' | 'json'
export type EditMode = 'new' | 'pen' | 'eraser' | 'text' | 'calibrate'
export type CalibrationPointKind = 'source' | 'target'
export type CalibrationStage = CalibrationPointKind
export type SheetImageSettings = SheetImageAlignment

export type WorkspaceStyle = CSSProperties & {
  '--sheet-left-dock-width'?: string
  '--sheet-right-dock-width'?: string
  '--sheet-left-resizer-width'?: string
  '--sheet-right-resizer-width'?: string
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
    paperToken?: string
    createdFrom?: TimingKey['createdFrom']
    bindings?: Array<{
      sourceSlotId: string
      sourceSlotPaperTrack: string
      sourceSlotStageId?: string
      sourceSlotCorrectionLayerId?: string
      sourceSlotOccurrenceIndex: number
      sourceSlotTrackNo: number
      cspCellName: string
      assetId?: string
      materialState: MaterialState
    }>
    fontSizePx?: number
  }>
}
