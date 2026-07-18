import {
  SYMBOL_HYPHEN,
  SYMBOL_NULL_CELL,
  SYMBOL_TICK_1,
  SYMBOL_TICK_2,
  type XdtsData,
  type XdtsFrame,
  type XdtsRangeCue,
  type XdtsTimeTable,
  type XdtsUnknownField,
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
  const version = data.version ?? 5
  const timeTables: XdtsTimeTable[] = (data.timeTables ?? []).map((timeTable, tableIndex) => {
    const headerMap = new Map<number, string[]>()
    for (const header of timeTable.timeTableHeaders ?? []) {
      if (typeof header.fieldId === 'number') headerMap.set(header.fieldId, header.names ?? [])
    }
    const tracks: XdtsData['tracks'] = []
    const dialogueCues: XdtsRangeCue[] = []
    const cameraCues: XdtsRangeCue[] = []
    const unknownFields: XdtsUnknownField[] = []
    for (const field of timeTable.fields ?? []) {
      const fieldId = field.fieldId ?? -1
      const names = headerMap.get(fieldId) ?? []
      if (fieldId !== 0 && fieldId !== 3 && fieldId !== 5) {
        unknownFields.push({
          fieldId,
          names,
          tracks: (field.tracks ?? []).map(track => ({
            trackNo: track.trackNo ?? 0,
            frames: rawFrames(track).map(frame => ({ frameIndex: frame.frame, values: frame.values })),
          })),
        })
        continue
      }
      for (const track of field.tracks ?? []) {
        const trackNo = track.trackNo ?? 0
        if (fieldId === 3 || fieldId === 5) {
          const cues = rangeCuesFromTrack(fieldId, names[trackNo] ?? `${fieldId === 3 ? 'SOUND' : 'CAMERA'}${trackNo + 1}`, trackNo, track)
          if (fieldId === 3) dialogueCues.push(...cues)
          else cameraCues.push(...cues)
          continue
        }
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
          name: names[trackNo] ?? `Track${trackNo}`,
          trackNo,
          cellNames: unique(frames.flatMap(frame => (frame.cellName ? [frame.cellName] : []))),
          frames,
        })
      }
    }
    return {
      name: timeTable.name ?? `タイムライン${tableIndex + 1}`,
      duration: positiveInteger(timeTable.duration, 72),
      fps: positiveNumber(timeTable.frameRate, 24),
      tracks,
      dialogueCues: dialogueCues.sort(compareRangeCues),
      cameraCues: cameraCues.sort(compareRangeCues),
      unknownFields,
    }
  })

  const primaryTable = timeTables[0] ?? {
    name: 'タイムライン1', duration: 72, fps: 24, tracks: [], dialogueCues: [], cameraCues: [], unknownFields: [],
  }

  return {
    tracks: primaryTable.tracks,
    version,
    header: {
      cut: String(data.header?.cut ?? '1'),
      scene: String(data.header?.scene ?? '1'),
    },
    timeTableName: primaryTable.name,
    duration: primaryTable.duration,
    fps: primaryTable.fps,
    timeTables,
  }
}

function rangeCuesFromTrack(fieldId: 3 | 5, name: string, trackNo: number, track: RawTrack): XdtsRangeCue[] {
  const frames = rawFrames(track)
  const cues: XdtsRangeCue[] = []
  let current: XdtsRangeCue | null = null
  for (const frame of frames) {
    const first = frame.values[0]
    if (first === SYMBOL_HYPHEN) {
      if (current) current.frameEnd = Math.max(current.frameEnd, frame.frame)
      continue
    }
    if (first === SYMBOL_TICK_1 || first === SYMBOL_TICK_2 || first === SYMBOL_NULL_CELL || !first) {
      current = null
      continue
    }
    current = { fieldId, name, trackNo, frameStart: frame.frame, frameEnd: frame.frame, values: frame.values }
    cues.push(current)
  }
  return cues
}

function rawFrames(track: RawTrack): Array<{ frame: number; values: string[] }> {
  return (track.frames ?? [])
    .flatMap(frame => {
      const values = frame.data?.[0]?.values
      return Array.isArray(values) && values.length > 0
        ? [{ frame: Number.isFinite(frame.frame) ? Math.round(frame.frame!) : 0, values: values.map(String) }]
        : []
    })
    .sort((left, right) => left.frame - right.frame)
}

function compareRangeCues(left: XdtsRangeCue, right: XdtsRangeCue): number {
  return left.trackNo - right.trackNo || left.frameStart - right.frameStart || left.frameEnd - right.frameEnd
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
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
