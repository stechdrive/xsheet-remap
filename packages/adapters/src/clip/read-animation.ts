import { unzlibSync } from 'fflate'
import type { ExportTrackFrame } from '@xsheet-remap/core'
import { Mixer } from './animation'
import { check, view } from './binary'

type Node = Mixer['root']
const child = (node: Node, name: string) => node.children.find(item => item.name === name)
function number(node: Node, name: string): number {
  const value = Number(child(node, name)?.values[0])
  check(Number.isFinite(value), `タイミングの${name}が不正です。`)
  return value
}
function frameNumber(value: number): number {
  const rounded = Math.round(value)
  check(Number.isSafeInteger(rounded) && Math.abs(value - rounded) < 0.001, 'セル指定が整数フレームに一致しません。')
  return rounded
}

/** Retain active cel assignments outside playback, relative to the playback start. */
export function readAnimation(bytes: Uint8Array, unpackedSize: number, fps: number, start: number, end: number): ExportTrackFrame[] {
  check(bytes.length >= 5 && view(bytes).getUint32(0, true) === bytes.length - 4, '圧縮BINCサイズが不正です。')
  check(Number.isInteger(unpackedSize) && unpackedSize >= 16 && unpackedSize < 16_000_000, '展開BINCサイズが範囲外です。')
  const raw = unzlibSync(bytes.subarray(4), { out: new Uint8Array(unpackedSize) })
  check(raw.length === unpackedSize, '展開BINCサイズが一致しません。')
  const mixer = new Mixer(raw)
  const clips: { start: number; end: number; keys: ExportTrackFrame[] }[] = []
  mixer.walk(node => {
    if (node.name !== 'ActionNodeClip') return
    const anim = child(node, 'AnimInfo')
    const curve = anim?.children.find(item => item.name === 'FCurve' && item.attrs.Type === 'ImageCelName')
    const param = anim?.children.find(item => item.name === 'Param' && item.attrs.Name === 'ImageCelName')
    if (!curve && !param) return
    const time = child(node, 'TimeClip'), motion = child(node, 'MotionClip'), info = child(node, 'TimeInfo')
    check(time && motion && info, 'セル指定クリップの時間情報がありません。')
    const timeRate = number(time, 'Rate'), motionRate = number(motion, 'Rate'), curveRate = number(info, 'Rate')
    check(timeRate > 0 && motionRate > 0 && curveRate > 0, 'セル指定クリップの時間単位が不正です。')
    const timeStart = number(time, 'Start') / timeRate, timeEnd = number(time, 'End') / timeRate
    const motionStart = number(motion, 'Start') / motionRate, motionEnd = number(motion, 'End') / motionRate
    check(timeEnd > timeStart && motionEnd > motionStart, 'セル指定クリップの範囲が不正です。')
    const clipStart = frameNumber(timeStart * fps), clipEnd = frameNumber(timeEnd * fps)
    const blend = child(node, 'MotionBlend')
    check(!blend || !Number(child(blend, 'BlendEnable')?.values[0]), 'ブレンドされたセル指定には対応していません。')
    const frames = curve && child(curve, 'Frame')?.values || []
    const tags = curve && child(curve, 'Tag')?.values || []
    const interp = curve && child(curve, 'Interp')?.values || []
    check(frames.length === tags.length && (!interp.length || interp.length === frames.length && interp.every(value => value === 'Constant')), '未対応のセル指定カーブです。')
    const keys: ExportTrackFrame[] = []
    let carry: string | null = param?.attrs.Tag || null
    let previousTime = -Infinity
    for (let i = 0; i < frames.length; i++) {
      const localTime = Number(frames[i]) / curveRate
      check(Number.isFinite(localTime) && localTime > previousTime && typeof tags[i] === 'string', 'セル指定の順序または値が不正です。')
      previousTime = localTime
      const value = String(tags[i]) || null
      if (localTime <= motionStart) carry = value
      if (localTime < motionStart || localTime >= motionEnd) continue
      const frame = frameNumber((timeStart + (localTime - motionStart) * (timeEnd - timeStart) / (motionEnd - motionStart)) * fps)
      keys.push({ frame, value })
    }
    if (!keys.length || keys[0].frame > clipStart) keys.unshift({ frame: clipStart, value: carry })
    clips.push({ start: clipStart, end: clipEnd, keys })
  })
  clips.sort((a, b) => a.start - b.start)
  check(clips.every((clip, i) => i === 0 || clips[i - 1].end <= clip.start), '重なったセル指定クリップには対応していません。')
  const workStart = Math.min(start, clips[0]?.start ?? start)
  const workEnd = clips.reduce((last, clip) => Math.max(last, clip.keys.at(-1)!.frame + 1), end)
  check(workEnd - workStart <= 1_000_000, 'ダミーコマを含むセル指定の範囲が広すぎます。')
  const events = new Map<number, string | null>([[workStart, null]])
  for (const clip of clips) {
    for (const key of clip.keys) events.set(key.frame, key.value)
    // Preserve gaps, without expanding dummy frames to a long clip's empty tail.
    if (clip.end < workEnd) events.set(clip.end, null)
  }
  return [...events].sort(([a], [b]) => a - b).map(([frame, value]) => ({ frame: frame - start, value }))
}
