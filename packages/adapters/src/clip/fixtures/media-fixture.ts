import { readFileSync } from 'node:fs'
import type { SqlJsStatic } from 'sql.js'
import { ClipContainer, type Row } from '../container'
import { normalizedUuid } from '../layer-metadata'
const seed = new Uint8Array(readFileSync(new URL('../blank.clip', import.meta.url)))
const native = JSON.parse(readFileSync(new URL('./native-media.json', import.meta.url), 'utf8')) as { audioLayer: Row; videoLayer: Row; items: Row[]; objects: Row[]; mixer: { size: number; hex: string } }

/** Synthetic container around independently captured media metadata and native BINC. */
export function createMediaFixture(SQL: SqlJsStatic) {
  const clip = new ClipContainer(SQL, seed)
  for (const column of ['AudioLayer', 'BankItemUuid', 'LinkLayerItemUUID']) if (!Object.keys(clip.rows('Layer')[0]).includes(column)) clip.db.run(`ALTER TABLE Layer ADD COLUMN ${column}`)
  const raster = clip.rows('Layer').find(item => item.LayerType === 1)!, root = clip.rows('Layer').find(item => item.MainId === clip.rows('Canvas')[0].CanvasRootFolder)!
  clip.update('Layer', raster.MainId, { LayerName: 'probe-audio', LayerType: native.audioLayer.LayerType, AudioLayer: 1, LayerFirstChildIndex: 0 })
  const video = clip.insert('Layer', raster, { ...native.videoLayer, LayerUuid: native.videoLayer.LayerUuid, LayerNextIndex: 0, AudioLayer: 0, LayerFirstChildIndex: 0 })
  const originalFirst = root.LayerFirstChildIndex
  clip.update('Layer', video.MainId, { LayerNextIndex: originalFirst }); clip.update('Layer', root.MainId, { LayerFirstChildIndex: video.MainId })
  clip.db.run('DROP TABLE CanvasItem')
  clip.db.run('CREATE TABLE CanvasItem (MainId, BankId, ItemUuid, ItemType, ItemCaption, ItemBinaryMainIndex)')
  for (const item of native.items) clip.db.run('INSERT INTO CanvasItem VALUES (?,?,?,?,?,?)', [item.MainId, item.BankId, item.ItemUuid, item.ItemType, item.ItemCaption, item.ItemBinaryMainIndex])
  clip.db.run('CREATE TABLE CanvasItemBinary (MainId, BankId, ItemId, ItemBinaryData)')
  const wave = new Uint8Array(44 + 48000 * 3 * 2), view = new DataView(wave.buffer)
  wave.set(new TextEncoder().encode('RIFF')); view.setUint32(4, wave.length - 8, true); wave.set(new TextEncoder().encode('WAVEfmt '), 8)
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  wave.set(new TextEncoder().encode('data'), 36); view.setUint32(40, wave.length - 44, true)
  for (let i = 0; i < 48000 * 3; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * Math.PI * 2 * 440 / 48000) * 1000), true)
  const audioItem = native.items.find(item => item.ItemType === 'Audio')!
  clip.db.run('INSERT INTO CanvasItemBinary VALUES (1,?,?,?)', [audioItem.BankId, audioItem.MainId, clip.addExternal(wave)])
  clip.db.run('CREATE TABLE LayerObject (MainId, LayerId, ObjectUuid, BankItemUuid, ObjectVisibility, IsAudio)')
  const object = native.objects[0]
  clip.db.run('INSERT INTO LayerObject VALUES (1,?,?,?,?,1)', [raster.MainId, object.ObjectUuid, object.BankItemUuid, 1])
  const track = clip.rows('Track')[0]
  clip.update('Track', track.MainId, { TrackKind: 4001, LayerUuidWithTrack: Uint8Array.from(Buffer.from(normalizedUuid(raster.LayerUuid), 'hex')), TrackActionMixer: clip.addExternal(Buffer.from(native.mixer.hex, 'hex')), TrackActionMixerSize: native.mixer.size })
  return { clip, audioId: Number(raster.MainId), videoId: Number(video.MainId), timelineId: normalizedUuid(clip.rows('TimeLine')[0].TimeLineUuid) }
}
