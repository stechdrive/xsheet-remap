import { unzlibSync } from 'fflate'
import type { ClipAudioTimeline } from '@xsheet-remap/core'
import { Mixer, packedMixer } from './animation'
import { check, identity, layerUuid } from './binary'
import { ClipContainer, type Row } from './container'
import { normalizedUuid } from './layer-metadata'

type Node = Mixer['root']
const node = (name: string, kind = 'null', values: Node['values'] = [], children: Node[] = [], attrs: Node['attrs'] = {}): Node => ({ name, kind, values, children, attrs })
const number = (name: string, value: number) => node(name, 'Double', [value])

/** Native CSP AudioPlayer/PlayTime representation, captured with generated WAV in CSP. */
export function audioMixer(template: Uint8Array, clips: { objectId: string; name: string; startFrame: number; sourceOffsetFrames: number; durationFrames: number; muted?: boolean }[], fps: number, secondary: boolean): Uint8Array {
  const mixer = new Mixer(unzlibSync(template.subarray(4)))
  mixer.secondary = secondary
  const numericArray = secondary ? 'Double[]' : 'Single[]'
  const curve = (type: string, frames: number[], values: number[], interpolation: string, tags?: string[]) => node('FCurve', 'null', [], [
    node('Frame', numericArray, frames), node('Value', numericArray, values),
    node('LeftSlope', numericArray, frames.map(() => 0)), node('RightSlope', numericArray, frames.map(() => 0)),
    node('Interp', 'String[]', frames.map(() => interpolation)), node('ReviseConstant', 'Byte[]', frames.map(() => 1)),
    ...(tags ? [node('Tag', 'String[]', tags)] : []),
  ], { Type: type })
  mixer.root = node('celsysdocument', 'null', [], [
    node('Version-Information', 'null', [], [node('Software', 'String', ['CLIP STUDIO']), node('Version', 'String', ['2.1.0'])]),
    node('General', 'null', [], clips.map(clip => {
      const start = clip.startFrame * 60 / fps, source = clip.sourceOffsetFrames * 60 / fps, duration = clip.durationFrames * 60 / fps
      return node('ActionNodeClip', 'null', [], [
        node('TimeClip', 'null', [], [number('Start', start), number('End', start + duration), number('Rate', 60)]),
        node('MotionClip', 'null', [], [number('Start', source), number('End', source + duration), number('Rate', 60)]),
        node('MotionBlend', 'null', [], [number('ShiftBlend', 0), number('NextBlend', 0), node('BlendEnable', 'Byte', [0])]),
        node('TimeInfo', 'null', [], [number('Rate', 60)]),
        node('AnimInfo', 'null', [], [
          node('Param', 'Int32', [2], [], { Name: 'AudioPlayer', Tag: clip.objectId }),
          curve('AudioPlayer', [0], [2], 'Constant', [clip.objectId]),
          node('Param', 'Double', [clip.muted ? 0 : 100], [], { Name: 'AudioVolume' }),
          node('Param', 'Double', [1 / 60000], [], { Name: 'PlayTime' }),
          curve('PlayTime', [0, source + duration], [0, (source + duration) / 60], 'Linear'),
        ]),
      ], { Name: clip.name })
    }), { Version: secondary ? '2.1.0' : '2.0.0' }),
  ], { version: '1.0.0' })
  return mixer.encode()
}

const schemas: Record<string, Record<string, string>> = {
  CanvasItemBank: { ModelBankMainIndex: 'INTEGER', BankRootItemMainIndex: 'INTEGER' },
  CanvasItem: { BankId: 'INTEGER', ItemUuid: 'TEXT', ItemType: 'TEXT', ItemCaption: 'TEXT', ItemImportYear: 'INTEGER', ItemImportMonth: 'INTEGER', ItemImportDay: 'INTEGER', ItemImportHour: 'INTEGER', ItemImportMinute: 'INTEGER', ItemImportSecond: 'INTEGER', ItemImportIndex: 'INTEGER', ItemVersion: 'INTEGER', ItemDataHoldMethod: 'TEXT', ItemNextItemMainIndex: 'INTEGER', ItemRegistedDirect: 'INTEGER', CanvasItemSourceIsMadeByCanvasItemMaker: 'INTEGER', ItemFileExtension: 'TEXT', ItemBinaryMainIndex: 'INTEGER' },
  CanvasItemBinary: { BankId: 'INTEGER', ItemId: 'INTEGER', ItemBinaryData: 'BLOB' },
  LayerObject: { CanvasId: 'INTEGER', LayerId: 'INTEGER', ObjectUuid: 'TEXT', BankItemUuid: 'TEXT', ObjectName: 'TEXT', ObjectLock: 'INTEGER', ObjectNext: 'INTEGER', ObjectVisibility: 'INTEGER', ObjectSelect: 'INTEGER', ObjectPickmask: 'INTEGER', IsAudio: 'INTEGER' },
  Layer: { AudioLayer: 'INTEGER', BankItemUuid: 'TEXT', FirstLayerObject: 'INTEGER', TimeLineLayerKeyFrameEnabled: 'INTEGER' },
}

function ensureAudioStorage(clip: ClipContainer) {
  for (const [table, fields] of Object.entries(schemas)) {
    if (!clip.db.exec('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?', [table]).length) {
      check(clip.rows('ElemScheme').some(row => row.TableName === table), `このCLIPには${table}の保存形式がありません。`)
      clip.db.run(`CREATE TABLE ${table} (_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, MainId INTEGER DEFAULT NULL)`)
    }
    const existing = clip.db.exec(`PRAGMA table_info(${table})`)[0].values.map(row => row[1])
    for (const [field, type] of Object.entries({ MainId: 'INTEGER', ...fields })) if (!existing.includes(field)) clip.db.run(`ALTER TABLE ${table} ADD COLUMN ${field} ${type} DEFAULT NULL`)
  }
}

/** Splits simultaneous placements into native layers without mixing/re-encoding their media. */
function lanes(clips: ClipAudioTimeline['tracks'][number]['clips']) {
  const result: typeof clips[] = []
  for (const clip of clips.slice().sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))) {
    let lane = result.find(items => items.at(-1)!.startFrame + items.at(-1)!.durationFrames <= clip.startFrame)
    if (!lane) { lane = []; result.push(lane) }
    lane.push(clip)
  }
  return result.length ? result : [[]]
}

export async function writeAudioTimeline(clip: ClipContainer, seed: ClipContainer, timeline: Row, audio: ClipAudioTimeline, projectId: string): Promise<void> {
  ensureAudioStorage(clip)
  const fps = Number(timeline.FrameRate), start = Number(timeline.StartFrame)
  check(Number.isFinite(fps) && fps > 0, '音声FPSが不正です。')
  const root = clip.row('Layer', clip.rows('Canvas')[0].CanvasRootFolder)
  let bank = clip.rows('CanvasItemBank')[0]
  if (!bank) bank = clip.insert('CanvasItemBank', {}, { ModelBankMainIndex: 0, BankRootItemMainIndex: 0 })
  const assetItems = new Map<string, Row>()
  for (const asset of audio.assets) {
    check(Number.isSafeInteger(asset.durationFrames) && asset.durationFrames > 0, '音声素材の長さが不正です。')
    const match = /^data:audio\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(asset.dataUrl)
    check(match, '音声素材は埋め込みWAVまたはMP3で保存してください。')
    const binary = Uint8Array.from(atob(match[1]), char => char.charCodeAt(0))
    const wave = new TextDecoder().decode(binary.subarray(0, 12))
    const extension = wave.startsWith('RIFF') && wave.slice(8) === 'WAVE' ? 'wav' : wave.startsWith('ID3') || binary[0] === 255 && (binary[1] & 224) === 224 ? 'mp3' : undefined
    check(extension, 'CLIPへの音声出力にはWAVまたはMP3を使用してください。')
    const uuid = asset.sourceItemId ?? normalizedUuid(layerUuid(await identity(projectId, `audio-asset:${asset.id}`)))
    let item = clip.rows('CanvasItem').find(row => normalizedUuid(row.ItemUuid) === uuid)
    if (item) {
      const stored = clip.rows('CanvasItemBinary').find(row => row.MainId === item!.ItemBinaryMainIndex && row.ItemId === item!.MainId && row.BankId === item!.BankId)
      const bytes = stored && clip.body(stored.ItemBinaryData)
      check(bytes && bytes.length === binary.length && bytes.every((byte, i) => byte === binary[i]), '元CLIPの音声素材と保存対象の音声が一致しません。')
    } else {
      const defaults = Object.fromEntries(Object.entries(schemas.CanvasItem).filter(([, type]) => type === 'INTEGER').map(([field]) => [field, 0]))
      item = clip.insert('CanvasItem', defaults, { BankId: bank.MainId, ItemUuid: uuid, ItemType: 'Audio', ItemCaption: asset.name, ItemDataHoldMethod: 'InternalFilePath', ItemFileExtension: extension })
      const stored = clip.insert('CanvasItemBinary', {}, { BankId: bank.MainId, ItemId: item.MainId, ItemBinaryData: clip.addExternal(binary) })
      clip.update('CanvasItem', item.MainId, { ItemBinaryMainIndex: stored.MainId })
      const last = clip.rows('CanvasItem').find(row => row.MainId !== item!.MainId && row.BankId === bank.MainId && !row.ItemNextItemMainIndex)
      if (last) clip.update('CanvasItem', last.MainId, { ItemNextItemMainIndex: item.MainId })
      else clip.update('CanvasItemBank', bank.MainId, { BankRootItemMainIndex: item.MainId })
    }
    assetItems.set(asset.id, item)
  }
  const baseTrack = seed.rows('Track').find(row => row.TrackKind === 2003)!
  const write = async (layer: Row, clips: ClipAudioTimeline['tracks'][number]['clips'], muted: boolean, key: string, target = timeline) => {
    const placements = []
    for (const placement of clips) {
      const asset = audio.assets.find(item => item.id === placement.assetId), item = assetItems.get(placement.assetId)
      check(asset && item && [placement.startFrame, placement.sourceOffsetFrames, placement.durationFrames].every(Number.isSafeInteger)
        && placement.sourceOffsetFrames >= 0 && placement.durationFrames > 0 && placement.sourceOffsetFrames + placement.durationFrames <= asset.durationFrames && placement.startFrame + start >= 0, '音声クリップの配置・素材範囲が不正です。')
      let object = clip.rows('LayerObject').find(row => row.LayerId === layer.MainId && normalizedUuid(row.BankItemUuid) === normalizedUuid(item.ItemUuid))
      if (!object) {
        object = clip.insert('LayerObject', {}, { CanvasId: layer.CanvasId, LayerId: layer.MainId, ObjectUuid: layerUuid(await identity(projectId, `audio-object:${key}:${placement.assetId}`)), BankItemUuid: item.ItemUuid, ObjectName: asset.name, ObjectLock: 0, ObjectVisibility: 1, ObjectSelect: 0, ObjectPickmask: 0, IsAudio: 1, ObjectNext: layer.FirstLayerObject ?? 0 })
        clip.update('Layer', layer.MainId, { FirstLayerObject: object.MainId, BankItemUuid: item.ItemUuid }); layer.FirstLayerObject = object.MainId
      }
      placements.push({ ...placement, startFrame: start + placement.startFrame, name: asset.name, objectId: String(object.ObjectUuid), muted: muted || placement.muted })
    }
    const attrs: Row = { TrackKind: 4001, TrackOptionFlag: 792, TrackOpen: 1, TrackContentOpen: 1 }
    // Native defaults when the playhead is outside an action clip: no player, 100%, time 0.
    attrs.TrackValueMap = Uint8Array.from('00000008000000030000002a0000000b0041007500640069006f0050006c00610079006500720000000000000002ffffffff0000002e0000000b0041007500640069006f0056006f006c0075006d00650000000000000000405900000000000000000028000000080050006c0061007900540069006d006500000000000000000000000000000000'.match(/../g)!, hex => parseInt(hex, 16))
    for (const field of ['TrackActionMixer', 'TrackActionMixer2']) {
      const raw = audioMixer(seed.body(baseTrack.TrackActionMixer)!, placements, fps, field.endsWith('2'))
      attrs[field] = clip.addExternal(packedMixer(raw)); attrs[`${field}Size`] = raw.length
    }
    const existing = clip.rows('Track').find(row => row.ItemId === target.MainId && row.BankId === target.BankId && normalizedUuid(row.LayerUuidWithTrack) === normalizedUuid(layer.LayerUuid))
    if (existing) clip.update('Track', existing.MainId, attrs)
    else {
      const last = clip.rows('Track').find(row => row.ItemId === target.MainId && row.BankId === target.BankId && !row.TrackNextIndex)
      const created = clip.insert('Track', baseTrack, { ...attrs, ItemId: target.MainId, BankId: target.BankId, TrackNextIndex: 0, TrackLabelFirstIndex: 0, TrackUuid: await identity(projectId, `audio-track:${target.MainId}:${key}`), LayerUuidWithTrack: Uint8Array.from(normalizedUuid(layer.LayerUuid).match(/../g)!, hex => parseInt(hex, 16)) })
      if (last) clip.update('Track', last.MainId, { TrackNextIndex: created.MainId })
      else clip.update('TimeLine', target.MainId, { FirstTrack: created.MainId })
    }
  }
  const usedSources = new Set<number>()
  for (const track of audio.tracks) {
    if (track.sourceLayerId !== undefined) { check(!usedSources.has(track.sourceLayerId), '同じ元音声レイヤーが複数のトラックに対応しています。'); usedSources.add(track.sourceLayerId) }
    for (const [index, placements] of lanes(track.clips).entries()) {
      const key = `${track.id}:${index}`
      const uuid = layerUuid(await identity(projectId, `audio-layer:${key}`))
      let layer = index === 0 && track.sourceLayerId !== undefined ? clip.row('Layer', track.sourceLayerId) : clip.rows('Layer').find(row => normalizedUuid(row.LayerUuid) === normalizedUuid(uuid))
      if (layer) check(Number(layer.AudioLayer) === 1, '書き戻し先は音声レイヤーではありません。')
      else {
        const raster = clip.rows('Layer').find(row => row.AudioLayer === 1) ?? seed.rows('Layer').find(row => row.LayerType === 1)!
        layer = clip.insert('Layer', raster, { CanvasId: root.CanvasId, LayerUuid: uuid, LayerType: 8720, AudioLayer: 1, LayerFolder: 0, AnimationFolder: 0, LayerFirstChildIndex: 0, LayerNextIndex: clip.row('Layer', root.MainId).LayerFirstChildIndex, LayerRenderMipmap: 0, LayerRenderThumbnail: 0, LayerLayerMaskMipmap: 0, LayerLayerMaskThumbnail: 0, FirstLayerObject: 0, LayerVisibility: 1, TimeLineLayerKeyFrameEnabled: 1 })
        clip.update('Layer', root.MainId, { LayerFirstChildIndex: layer.MainId })
        // A native audio object without a track can play as a full-length layer.
        // New per-cut layers must be explicitly empty in all other timelines.
        for (const other of clip.rows('TimeLine')) if (other.MainId !== timeline.MainId) await write(layer, [], false, key, other)
      }
      clip.update('Layer', layer.MainId, { LayerName: index ? `${track.name} (${index + 1})` : track.name })
      await write(layer, placements, track.muted, key)
    }
  }
  for (const id of audio.replacedLayerIds) if (!usedSources.has(id)) {
    const layer = clip.row('Layer', id)
    check(Number(layer.AudioLayer) === 1, '削除対象の元音声レイヤーが一致しません。')
    await write(layer, [], false, `removed:${id}`)
  }
}
