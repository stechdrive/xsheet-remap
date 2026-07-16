import type { CSSProperties } from 'react'
import type { MaterialState, NormalizedRect, SheetHit, SheetImageAlignment, SheetPageImageRef, SheetTemplateGrid, SheetTemplateInputMode, TimedRangeCue, TimingKey } from '@xsheet-remap/core'

export type Panel = 'sheet' | 'template'
export type TimingExportKind = 'xdts' | 'csp-import'
export interface TimingExportDialogState {
  kind: TimingExportKind
  timingSourceRole: 'action' | 'cell'
}
export type TemplateDetailTab = 'region' | 'display' | 'reference' | 'table' | 'json'
export type EditMode = 'new' | 'pen' | 'eraser' | 'text' | 'calibrate'
export type CalibrationPointKind = 'source' | 'target'
export type CalibrationStage = CalibrationPointKind
export type SheetPrecisionWarpDiagnostics = {
  totalAnchorCount: number
  matchedAnchorCount: number
  inlierCount: number
  coverage: number
  confidence: number
  rmsBeforePx: number
  rmsAfterPx: number
  maxDisplacementPx: number
  /** Maximum inverse-warp displacement relative to the template's local x/y grid pitch. */
  maxDisplacementPitchRatio?: number
}

export type SheetPrecisionWarp = {
  version: 1
  bounds: NormalizedRect
  columns: number
  rows: number
  /** Interleaved normalized x/y inverse-warp offsets, row-major by control point. */
  offsets: number[]
  diagnostics: SheetPrecisionWarpDiagnostics
}

export type SheetImageSettings = SheetImageAlignment & {
  precisionWarp?: SheetPrecisionWarp
}

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

export type SheetSelection =
  | { kind: 'none' }
  | { kind: 'cell'; hit: SheetHit }
  | { kind: 'range'; range: SheetRangeSelection }
  | { kind: 'cue'; cueId: string }

export interface SoundCueClipboard {
  role: 'sound'
  sourceLaneId: string
  sourceFrameStart: number
  sourceFrameEnd: number
  spanFrames: number
  mode: 'copy' | 'cut'
  sourceCueIds: string[]
  items: Array<{
    frameStartOffset: number
    frameEndOffset: number
    label: string
    text: string
    source?: TimedRangeCue['source']
  }>
}

export interface SoundCueDialogState {
  mode: 'create' | 'edit'
  cueId?: string
  laneId: string
  frameStart: number
  frameEnd: number
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
