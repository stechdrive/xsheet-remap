export interface XdtsFrame {
  frameIndex: number
  cellName: string | null
}

export interface XdtsTrack {
  name: string
  trackNo: number
  cellNames: string[]
  frames: XdtsFrame[]
}

export interface XdtsData {
  tracks: XdtsTrack[]
  version: number
  header: { cut: string; scene: string }
  timeTableName: string
  duration: number
  fps: number
}

export const XDTS_TEXT_HEADER = 'exchangeDigitalTimeSheet Save Data'
export const SYMBOL_NULL_CELL = 'SYMBOL_NULL_CELL'
export const SYMBOL_HYPHEN = 'SYMBOL_HYPHEN'
export const SYMBOL_TICK_1 = 'SYMBOL_TICK_1'
export const SYMBOL_TICK_2 = 'SYMBOL_TICK_2'
