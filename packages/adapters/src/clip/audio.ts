import type { SqlJsStatic } from 'sql.js'
import { unzlibSync } from 'fflate'
import { Mixer } from './animation'
import { check, view } from './binary'
import { ClipContainer } from './container'
import { normalizedUuid, optionalRows } from './layer-metadata'

export interface ClipAudioTiming { objectId: string; startFrame: number; sourceOffsetFrames: number; durationFrames: number; muted?: boolean }
export interface ClipAudioReadResult {
  fps: number
  clips: (ClipAudioTiming & { assetId: string })[]
  assets: { id: string; name: string; mimeType: string; bytes: Uint8Array }[]
}
type Node = Mixer['root']
const child = (node: Node, name: string) => node.children.find(item => item.name === name)
function number(node: Node, name: string) {
  const value = Number(child(node, name)?.values[0])
  check(Number.isFinite(value), `音声クリップの${name}が不正です。`)
  return value
}
function frame(value: number) {
  const rounded = Math.round(value)
  check(Number.isSafeInteger(rounded) && Math.abs(rounded - value) < 0.001 && Math.abs(rounded) <= 1_000_000, '音声の配置またはトリミングが整数フレームに一致しません。')
  return rounded
}

/** Only normal-speed, constant-volume clips are imported; unknown automation stays in the source CLIP. */
export function readAudioTiming(bytes: Uint8Array, size: number, fps: number, startFrame: number): ClipAudioTiming[] {
  check(bytes.length >= 5 && view(bytes).getUint32(0, true) === bytes.length - 4, '音声BINCサイズが不正です。')
  check(Number.isInteger(size) && size >= 16 && size < 16_000_000, '音声BINCの展開サイズが範囲外です。')
  const raw = unzlibSync(bytes.subarray(4), { out: new Uint8Array(size) })
  check(raw.length === size, '音声BINCの展開サイズが一致しません。')
  const mixer = new Mixer(raw), clips: ClipAudioTiming[] = []
  mixer.walk(node => {
    if (node.name !== 'ActionNodeClip') return
    const anim = child(node, 'AnimInfo')
    const player = anim?.children.find(item => item.name === 'Param' && item.attrs.Name === 'AudioPlayer')
    const playerCurve = anim?.children.find(item => item.name === 'FCurve' && item.attrs.Type === 'AudioPlayer')
    if (!player && !playerCurve) return
    const tags = playerCurve && child(playerCurve, 'Tag')?.values || [player?.attrs.Tag]
    const ids = tags.map(tag => normalizedUuid(String(tag ?? '')))
    check(ids.length > 0 && ids.every(id => /^[0-9a-f]{32}$/.test(id) && id === ids[0]), 'クリップ途中で音声素材が切り替わる形式には対応していません。')
    check(!player?.attrs.Tag || normalizedUuid(player.attrs.Tag) === ids[0], '音声素材の初期値と切り替えが一致しません。')
    check(!playerCurve || child(playerCurve, 'Frame')?.values.length === tags.length, '音声素材のカーブが破損しています。')
    check(!playerCurve || child(playerCurve, 'Interp')?.values.every(value => value === 'Constant'), '音声素材の切り替え形式に対応していません。')
    const volume = anim!.children.find(item => item.name === 'Param' && item.attrs.Name === 'AudioVolume')
    check(volume && [0, 100].includes(Number(volume.values[0])) && !anim!.children.some(item => item.name === 'FCurve' && item.attrs.Type === 'AudioVolume'), '音量変更・フェードのある音声は、元のCLIPで保持します。現在の音声取り込みには対応していません。')
    const time = child(node, 'TimeClip'), motion = child(node, 'MotionClip'), info = child(node, 'TimeInfo')
    check(time && motion && info, '音声クリップの時間情報がありません。')
    const timeRate = number(time, 'Rate'), motionRate = number(motion, 'Rate'), curveRate = number(info, 'Rate')
    check(timeRate > 0 && motionRate > 0 && curveRate > 0, '音声クリップの時間単位が不正です。')
    const timeStart = number(time, 'Start') / timeRate, timeEnd = number(time, 'End') / timeRate
    const motionStart = number(motion, 'Start') / motionRate, motionEnd = number(motion, 'End') / motionRate
    check(timeEnd > timeStart && motionEnd > motionStart, '音声クリップの再生範囲が不正です。')
    const blend = child(node, 'MotionBlend')
    check(!blend || !Number(child(blend, 'BlendEnable')?.values[0]), 'ブレンドされた音声クリップには対応していません。')
    const curve = anim!.children.find(item => item.name === 'FCurve' && item.attrs.Type === 'PlayTime')
    check(curve, '音声クリップの素材再生位置がありません。')
    const frames = child(curve, 'Frame')?.values.map(Number) ?? [], values = child(curve, 'Value')?.values.map(Number) ?? []
    const interp = child(curve, 'Interp')?.values ?? []
    check(frames.length >= 2 && frames.length === values.length && interp.length === frames.length && interp.every(value => value === 'Linear'), '音声の再生位置カーブに対応していません。')
    const rate = (motionEnd - motionStart) / (timeEnd - timeStart)
    for (let i = 0; i < frames.length; i++) {
      check(Number.isFinite(frames[i]) && Number.isFinite(values[i]), '音声の再生位置が不正です。')
      if (i) check(frames[i] > frames[i - 1] && Math.abs((values[i] - values[i - 1]) / ((frames[i] - frames[i - 1]) / curveRate) * rate - 1) < 0.0001, '速度変更された音声には対応していません。')
    }
    const offset = values[0] + (motionStart - frames[0] / curveRate) / rate
    const sourceOffsetFrames = frame(offset * fps), durationFrames = frame((timeEnd - timeStart) * fps)
    check(sourceOffsetFrames >= 0 && durationFrames > 0, '音声の素材範囲が不正です。')
    clips.push({ objectId: ids[0], startFrame: frame(timeStart * fps) - startFrame, sourceOffsetFrames, durationFrames, ...(Number(volume.values[0]) === 0 ? { muted: true } : {}) })
  })
  return clips.sort((a, b) => a.startFrame - b.startFrame)
}

function audioMimeType(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes.subarray(0, 12))
  if (text.startsWith('RIFF') && text.slice(8) === 'WAVE') return 'audio/wav'
  if (text.startsWith('ID3') || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  throw new Error('この内包音声形式には対応していません。WAVまたはMP3を使用してください。')
}

export function readClipAudio(SQL: SqlJsStatic, bytes: Uint8Array, layerId: number, timelineId: string): ClipAudioReadResult {
  const clip = new ClipContainer(SQL, bytes)
  try {
    const layer = clip.row('Layer', layerId), timeline = clip.rows('TimeLine').find(item => normalizedUuid(item.TimeLineUuid) === timelineId)
    check(Number(layer.AudioLayer) === 1 && timeline, '音声レイヤーとタイムラインを選択してください。')
    const tracks = clip.rows('Track').filter(item => item.TrackKind === 4001 && item.ItemId === timeline.MainId && item.BankId === timeline.BankId && normalizedUuid(item.LayerUuidWithTrack) === normalizedUuid(layer.LayerUuid))
    check(tracks.length === 1, '選択したタイムラインに音声トラックがないか、重複しています。')
    const track = tracks[0], field = clip.body(track.TrackActionMixer) ? 'TrackActionMixer' : 'TrackActionMixer2', body = clip.body(track[field])
    check(body, '音声トラックの再生情報がありません。')
    const fps = Number(timeline.FrameRate)
    check(Number.isFinite(fps) && fps >= 1 && fps <= 120 && Number.isSafeInteger(timeline.StartFrame), '音声タイムラインのFPSまたは開始位置が不正です。')
    const timing = readAudioTiming(body, Number(track[`${field}Size`]), fps, Number(timeline.StartFrame))
    const objects = optionalRows(clip, 'LayerObject').filter(item => item.LayerId === layerId && Number(item.IsAudio) === 1)
    const items = optionalRows(clip, 'CanvasItem'), binaries = optionalRows(clip, 'CanvasItemBinary')
    const assets = new Map<string, ClipAudioReadResult['assets'][number]>()
    const clips = timing.flatMap(placement => {
      const object = objects.find(item => normalizedUuid(item.ObjectUuid) === placement.objectId)
      check(object, '音声クリップの素材参照が見つかりません。')
      if (object.ObjectVisibility === 0) return []
      const id = normalizedUuid(object.BankItemUuid), item = items.find(item => normalizedUuid(item.ItemUuid) === id)
      check(item?.ItemType === 'Audio', '音声素材が見つかりません。')
      if (!assets.has(id)) {
        const binary = binaries.find(binary => binary.MainId === item.ItemBinaryMainIndex && binary.ItemId === item.MainId && binary.BankId === item.BankId)
        const data = binary && clip.body(binary.ItemBinaryData)
        check(data, '外部参照の音声、または素材のない音声です。元の音声ファイルをセリフ音声へ読み込んでください。')
        assets.set(id, { id, name: String(item.ItemCaption || layer.LayerName), mimeType: audioMimeType(data), bytes: data.slice() })
      }
      return [{ ...placement, assetId: id }]
    })
    check(clips.length > 0, '取り込める音声クリップがありません。')
    return { fps, clips, assets: [...assets.values()] }
  } finally { clip.close() }
}
