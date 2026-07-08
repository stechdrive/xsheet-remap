import {
  SYMBOL_HYPHEN,
  SYMBOL_NULL_CELL,
  SYMBOL_TICK_1,
  SYMBOL_TICK_2,
  type XdtsData,
  type XdtsFrame,
} from './types'

interface RawXdtsData {
  version?: number
  header?: { cut?: unknown; scene?: unknown }
  timeTables?: RawTimeTable[]
}

interface RawTimeTable {
  name?: string
  duration?: number
  frameRate?: number
  timeTableHeaders?: Array<{ fieldId?: number; names?: string[] }>
  fields?: RawField[]
}

interface RawField {
  fieldId?: number
  tracks?: RawTrack[]
}

interface RawTrack {
  trackNo?: number
  frames?: RawFrame[]
}

interface RawFrame {
  frame?: number
  data?: Array<{ values?: string[] }>
}

export function parseXdts(text: string): XdtsData {
  const jsonText = stripXdtsHeader(text)
  const data = JSON.parse(jsonText.trim()) as RawXdtsData
  const firstTable = data.timeTables?.[0]
  const version = data.version ?? 5
  const tracks: XdtsData['tracks'] = []

  for (const timeTable of data.timeTables ?? []) {
    const headerMap = new Map<number, string[]>()
    for (const header of timeTable.timeTableHeaders ?? []) {
      if (typeof header.fieldId === 'number') headerMap.set(header.fieldId, header.names ?? [])
    }
    const cellNames = headerMap.get(0) ?? []
    for (const field of timeTable.fields ?? []) {
      if (field.fieldId !== 0) continue
      for (const track of field.tracks ?? []) {
        const trackNo = track.trackNo ?? 0
        const frames: XdtsFrame[] = []
        for (const frame of track.frames ?? []) {
          const rawValue = frame.data?.[0]?.values?.[0]
          if (rawValue === undefined) continue
          if (rawValue === SYMBOL_HYPHEN || rawValue === SYMBOL_TICK_1 || rawValue === SYMBOL_TICK_2) continue
          frames.push({
            frameIndex: frame.frame ?? 0,
            cellName: rawValue === SYMBOL_NULL_CELL ? null : rawValue,
          })
        }
        frames.sort((a, b) => a.frameIndex - b.frameIndex)
        tracks.push({
          name: cellNames[trackNo] ?? `Track${trackNo}`,
          trackNo,
          cellNames: unique(frames.flatMap(frame => (frame.cellName ? [frame.cellName] : []))),
          frames,
        })
      }
    }
  }

  return {
    tracks,
    version,
    header: {
      cut: String(data.header?.cut ?? '1'),
      scene: String(data.header?.scene ?? '1'),
    },
    timeTableName: firstTable?.name ?? 'タイムライン1',
    duration: firstTable?.duration ?? 72,
    fps: firstTable?.frameRate ?? 24,
  }
}

export function resolveCellsAtFrameByTrackNo(tracks: XdtsData['tracks'], frameIndex: number): Map<number, string | null> {
  const result = new Map<number, string | null>()
  for (const track of tracks) {
    let value: string | null | undefined
    for (let index = track.frames.length - 1; index >= 0; index -= 1) {
      const frame = track.frames[index]
      if (frame.frameIndex <= frameIndex) {
        value = frame.cellName
        break
      }
    }
    result.set(track.trackNo, value ?? null)
  }
  return result
}

function stripXdtsHeader(text: string): string {
  const newlineIndex = text.indexOf('\n')
  if (newlineIndex === -1) return text
  const firstLine = text.slice(0, newlineIndex).trim()
  return firstLine.startsWith('exchangeDigitalTimeSheet') ? text.slice(newlineIndex + 1) : text
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
