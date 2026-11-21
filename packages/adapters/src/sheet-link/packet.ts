import type { CameraInstructionPoint } from '@xsheet-remap/core'
import { bytesFromDigits, digitsFromBytes, invalid, MAX_FRAMES, MAX_LINK_BYTES, MAX_LINK_EVENTS, MAX_RECORD_BYTES, packLink, Reader, SHEET_LINK_PREFIX, unpackLink, Writer } from './bytes'
import type { LinkColumn, LinkCue, SheetLinkPage, TextField } from './model'
import { readPoints, writePoints } from './timing'

const shapes = ['range', 'fade-in', 'fade-out', 'overlap'] as const
const roles = ['start', 'intermediate', 'end'] as const
const fieldKinds = ['text', 'choice', 'date', 'number', 'boolean', 'duration'] as const
const MAX_TRACKS = 128
export const MAX_LINK_PAGES = 1024
const trackName = (i: number) => String.fromCharCode(65 + i)
const safeKey = (key: string) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype'

function checksum(bytes: Uint8Array) {
  let value = 0xffff
  for (const byte of bytes) {
    value ^= byte << 8
    for (let i = 0; i < 8; i++) value = (value << 1 ^ (value & 0x8000 ? 0x1021 : 0)) & 0xffff
  }
  return value
}

export function encodeSheetLink(packet: SheetLinkPage): string | undefined {
  const s = packet.sheet, out = new Writer()
  if (!s.names.length || s.names.length > MAX_TRACKS || packet.pages > MAX_LINK_PAGES ||
    s.duration + s.pre + s.post > MAX_FRAMES || s.columns.reduce((n, c) => n + c.points.length + c.marks.length, 0) > MAX_LINK_EVENTS) return
  out.append(s.group)
  out.uint(Number(s.digital) + 2 * Number(packet.whole) + 4 * packet.omitted)
  for (const value of [s.title, s.episode, s.scene, s.cut]) out.text(value)
  out.uint(s.fps)
  out.int(s.origin)
  out.uint(s.duration)
  out.uint(s.pre)
  out.uint(s.post)
  out.uint(packet.page)
  out.uint(packet.pages)
  out.int(packet.from - s.origin)
  out.uint(packet.to - packet.from)
  const simple = s.names.length <= 26 && s.names.every((name, i) => name === trackName(i))
  out.uint(s.names.length * 2 + Number(simple))
  if (!simple) for (const name of s.names) out.text(name)
  out.uint(s.vacant.length)
  for (const i of s.vacant) out.uint(i)
  out.uint(s.columns.length)
  for (const col of s.columns) {
    out.uint(col.index)
    writePoints(out, col.points, packet.from)
    out.uint(col.marks.length)
    for (const [frame, shape] of col.marks) {
      out.int(frame - packet.from)
      out.uint(Number(shape === 'circle'))
    }
  }
  out.uint(s.cues.length)
  for (const cue of s.cues) {
    out.uint(cue.id)
    out.uint(cue.lane * 2 + Number(cue.role === 'camera'))
    out.int(cue.frameStart - packet.from)
    out.uint(cue.frameEnd - cue.frameStart)
    out.text(cue.laneName)
    out.text(cue.label)
    out.text(cue.text)
    out.uint(cue.camera ? 1 + shapes.indexOf(cue.camera.shape) : 0)
    if (cue.camera) {
      const points = cue.camera.points ?? []
      out.uint(points.length)
      for (const p of points) {
        out.uint(roles.indexOf(p.role))
        out.uint(p.frameOffset)
        out.text(p.label)
      }
    }
  }
  out.uint(s.fields.length)
  for (const [scope, key, value, kind] of s.fields) {
    out.uint(fieldKinds.indexOf(kind ?? 'text'))
    out.text(scope)
    out.text(key)
    out.text(value)
  }
  const raw = out.finish()
  if (raw.length > MAX_RECORD_BYTES - 2) return
  const crc = checksum(raw)
  out.append([crc >> 8, crc & 255])
  const packed = packLink(out.finish())
  if (packed.length <= MAX_LINK_BYTES) return digitsFromBytes(packed)
}

export function decodeSheetLink(digits: string): SheetLinkPage {
  const checked = unpackLink(bytesFromDigits(digits)), raw = checked.subarray(0, -2)
  if (checked.length < 12 || checksum(raw) !== (checked.at(-2)! << 8 | checked.at(-1)!)) invalid()
  const r = new Reader(raw), group = r.take(8), flags = r.uint(15)
  const title = r.text(), episode = r.text(), scene = r.text(), cut = r.text()
  const fps = r.uint(1000), origin = r.int(MAX_FRAMES), duration = r.uint(MAX_FRAMES), pre = r.uint(MAX_FRAMES), post = r.uint(MAX_FRAMES)
  const page = r.uint(MAX_LINK_PAGES), pages = r.uint(MAX_LINK_PAGES), from = origin + r.int(), to = from + r.uint(MAX_FRAMES)
  if (!fps || !duration || duration + pre + post > MAX_FRAMES || !page || page > pages || from < origin - pre || to >= origin + duration + post) invalid()
  const trackCode = r.uint(MAX_TRACKS * 2 + 1), count = Math.floor(trackCode / 2)
  if (!count || (trackCode % 2 && count > 26)) invalid()
  const names = Array.from({ length: count }, (_, i) => trackCode % 2 ? trackName(i) : r.text())
  if (names.some(n => !n.trim() || !safeKey(n)) || new Set(names).size !== count) invalid()
  const vacant = Array.from({ length: r.uint(MAX_TRACKS) }, () => r.uint(MAX_TRACKS * 2))
  const columns: LinkColumn[] = [], seen = new Set<number>()
  for (let n = r.uint(count * 2); n; n--) {
    const index = r.uint(count * 2 - 1)
    if (seen.has(index)) invalid()
    seen.add(index)
    const points = readPoints(r, from)
    if (points.some(([frame], i) => Math.abs(frame - origin) > MAX_FRAMES * 2 || i > 0 && frame <= points[i - 1]![0])) invalid()
    const numMarks = r.uint(MAX_LINK_EVENTS)
    r.events(numMarks)
    const marks: LinkColumn['marks'] = Array.from({ length: numMarks }, () => [from + r.int(), r.uint(1) ? 'circle' : 'triangle'])
    columns.push({ index, points, marks })
  }
  const cues: LinkCue[] = []
  for (let n = r.uint(4096); n; n--) {
    const id = r.uint(MAX_LINK_EVENTS), slot = r.uint(255), frameStart = from + r.int(), frameEnd = frameStart + r.uint(MAX_FRAMES)
    const laneName = r.text(), label = r.text(), text = r.text(), shape = r.uint(shapes.length)
    const cue: LinkCue = { id, role: slot % 2 ? 'camera' : 'sound', lane: slot >> 1, laneName, frameStart, frameEnd, label, text }
    if (shape) {
      const points: CameraInstructionPoint[] = Array.from({ length: r.uint(4096) }, (_, i) => ({
        pointId: 'point_' + i, role: roles[r.uint(2)]!, frameOffset: r.uint(frameEnd - frameStart), label: r.text(),
      }))
      cue.camera = { shape: shapes[shape - 1]!, points }
    }
    cues.push(cue)
  }
  const fields: TextField[] = []
  for (let n = r.uint(8192); n; n--) {
    const kind = fieldKinds[r.uint(fieldKinds.length - 1)]!
    const scope = r.text(), key = r.text(), value = r.text()
    if (!['worker', 'custom', 'cut', 'revision', 'production'].includes(scope) &&
      !/^(?:note\.)?page_[1-9][0-9]{0,3}$|^note@-?\d{1,6}$/u.test(scope) || !safeKey(key)) invalid()
    if ((kind === 'duration' || kind === 'number') && !Number.isFinite(Number(value)) ||
      kind === 'boolean' && value !== 'true' && value !== 'false') invalid()
    fields.push([scope, key, value, kind])
  }
  r.end()
  return {
    sheet: { group, title, episode, scene, cut, fps, origin, duration, pre, post, digital: !!(flags & 1), names, vacant, columns, cues, fields },
    page, pages, from, to, whole: !!(flags & 2), omitted: flags >> 2
  }
}

export { SHEET_LINK_PREFIX }
