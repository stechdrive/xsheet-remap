export interface XdtsFrame {
  frameIndex: number
  cellName: string | null
  valueKind: 'cell' | 'blank' | 'inbetween' | 'reverse'
}

export interface XdtsTrack {
  name: string
  trackNo: number
  cellNames: string[]
  frames: XdtsFrame[]
}

export type XdtsKnownFieldId = 0 | 3 | 5

export interface XdtsRangeCue {
  fieldId: 3 | 5
  name: string
  trackNo: number
  frameStart: number
  frameEnd: number
  values: string[]
}

export interface XdtsUnknownField {
  fieldId: number
  names: string[]
  tracks: Array<{
    trackNo: number
    frames: Array<{ frameIndex: number; values: string[] }>
  }>
}

export interface XdtsTimeTable {
  name: string
  duration: number
  fps: number
  tracks: XdtsTrack[]
  dialogueCues: XdtsRangeCue[]
  cameraCues: XdtsRangeCue[]
  unknownFields: XdtsUnknownField[]
}

export interface XdtsData {
  tracks: XdtsTrack[]
  version: number
  header: { cut: string; scene: string }
  timeTableName: string
  duration: number
  fps: number
  timeTables: XdtsTimeTable[]
}

export const XDTS_TEXT_HEADER = 'exchangeDigitalTimeSheet Save Data'
export const SYMBOL_NULL_CELL = 'SYMBOL_NULL_CELL'
export const SYMBOL_HYPHEN = 'SYMBOL_HYPHEN'
export const SYMBOL_TICK_1 = 'SYMBOL_TICK_1'
export const SYMBOL_TICK_2 = 'SYMBOL_TICK_2'
