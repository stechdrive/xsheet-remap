import type { SqlJsStatic } from 'sql.js'
import { clipChildren, validateClipDocument, type ClipLayerNode, type ClipTimeline } from '@xsheet-remap/core'
import { ClipContainer, type Row } from './container'
import { check, identity, layerUuid } from './binary'
import { createLayer, refreshCaches } from './layers'
import { inspectCanvas, resizeCanvas } from './canvas'
import { placePixels } from './raster'
import { animationMixer, packedMixer, trackValueMap } from './animation'
import { readAnimation } from './read-animation'
import { ensureTrackLabelStorage } from './track-labels'
import { clipSourceBytes } from './document-data'
import type { ClipWriteOptions, ClipWriteResult } from './writer'
import { optionalRows } from './layer-metadata'
import { ensureAnimationFolderStorage, ensureAnimationStorage } from './animation-storage'

const uuidText = (value: Row[string]) => value instanceof Uint8Array ? Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('') : String(value).replaceAll('-', '').toLowerCase()
const uuidBytes = (value: Row[string]) => Uint8Array.from(uuidText(value).match(/../g)!, hex => parseInt(hex, 16))

export async function writeClipDocument(SQL: SqlJsStatic, seedBytes: Uint8Array, options: ClipWriteOptions, progress: (message: string) => void): Promise<ClipWriteResult> {
  const state = validateClipDocument(options.plan.document!), originalBytes = state.source ? clipSourceBytes(state.source.dataUrl) : undefined
  const clip = new ClipContainer(SQL, originalBytes ?? seedBytes), seed = new ClipContainer(SQL, seedBytes)
  try {
    let changed = !originalBytes
    const originals = clip.rows('Layer'), root = originals.find(row => row.MainId === clip.rows('Canvas')[0].CanvasRootFolder)!
    const paper = originals.find(row => row.LayerType === 1584)
    const originalOrder = new Map<number, number>(), originalParents = new Map<number, number>()
    for (const parent of originals) {
      let next = parent.LayerFirstChildIndex, index = 0; const seen = new Set()
      while (next) {
        check(!seen.has(next), 'レイヤー参照が循環しています。'); seen.add(next)
        originalParents.set(Number(next), Number(parent.MainId)); originalOrder.set(Number(next), index++)
        next = clip.row('Layer', next).LayerNextIndex
      }
    }
    const originalAncestors = (id: number): Row[] => {
      const result: Row[] = [], seen = new Set<number>()
      let parentId = originalParents.get(id)
      while (parentId !== undefined) {
        check(!seen.has(parentId), '元CLIPの親子関係が循環しています。'); seen.add(parentId)
        const parent = originals.find(row => row.MainId === parentId)!
        result.push(parent); parentId = originalParents.get(parentId)
      }
      return result
    }
    const sourceInsideCel = new Set(originals.filter(row => originalAncestors(Number(row.MainId)).some(parent => parent.AnimationFolder)).map(row => Number(row.MainId)))
    const originallyReachable = new Set(originals.filter(row => originalAncestors(Number(row.MainId)).some(parent => parent.MainId === root.MainId)).map(row => Number(row.MainId)))
    if (!originalBytes) {
      ensureTrackLabelStorage(clip)
      clip.db.run('DELETE FROM Layer WHERE MainId NOT IN (?,?)', [root.MainId, paper!.MainId])
      clip.update('Layer', root.MainId, { LayerFirstChildIndex: paper!.MainId }); clip.update('Layer', paper!.MainId, { LayerNextIndex: 0 })
      clip.db.run('DELETE FROM TimeLineLabel'); clip.db.run('DELETE FROM Track'); clip.db.run('DELETE FROM TimeLine')
      clip.update('AnimationCutBank', clip.rows('AnimationCutBank')[0].MainId, { FirstTimeLine: 0, CurrentIndex: 0 })
      resizeCanvas(clip, options.canvas, true)
    }
    const canvas = inspectCanvas(clip), rows = new Map<string, Row>()
    if (state.nodes.some(node => node.sourceLayerId === undefined && node.kind === 'animation')) ensureAnimationFolderStorage(clip)
    const pending = [...state.nodes]
    while (pending.length) {
      const index = pending.findIndex(node => node.parentId === null || rows.has(node.parentId))
      check(index >= 0, 'レイヤーの親が見つかりません。')
      const node = pending.splice(index, 1)[0], parent = node.parentId ? rows.get(node.parentId)! : root
      let row: Row
      if (node.sourceLayerId !== undefined) {
        row = clip.row('Layer', node.sourceLayerId)
        check(uuidText(row.LayerUuid) === node.id, '元CLIPのレイヤーIDが一致しません。')
        const attrs = { LayerName: node.name, LayerVisibility: (Number(row.LayerVisibility) & ~1) | Number(node.visible), LayerOpacity: Math.round(node.opacity * 256), LayerComposite: node.blendMode }
        if (Object.entries(attrs).some(([key, value]) => row[key] !== value)) { clip.update('Layer', row.MainId, attrs); changed = true }
      } else {
        check(node.kind === 'folder' || node.kind === 'animation' || node.kind === 'raster', 'この種類のレイヤーは新規作成できません。元のCLIPから読み込んでください。')
        const image = options.images[node.id] ?? (node.assetId ? options.images[node.assetId] : undefined)
        const pixels = image && placePixels(image, canvas.width, canvas.height, Math.ceil((canvas.width - image.width) / 2), Math.ceil((canvas.height - image.height) / 2))
        row = createLayer(clip, seed, { name: node.name, uuid: layerUuid(await identity(options.plan.projectId, node.id)), parentId: parent.MainId, kind: node.kind, width: canvas.width, height: canvas.height, pixels })
        const [red, green, blue] = (node.labelColor?.slice(1).match(/../g) ?? ['00', '00', '00']).map(channel => parseInt(channel, 16) * 0x01010101)
        clip.update('Layer', row.MainId, { LayerVisibility: Number(node.visible), LayerOpacity: Math.round(node.opacity * 256), LayerComposite: node.blendMode,
          LayerUsePaletteColor: Number(Boolean(node.labelColor)), LayerPaletteRed: red, LayerPaletteGreen: green, LayerPaletteBlue: blue })
        changed = true
      }
      rows.set(node.id, row)
    }
    const retained = new Set([Number(root.MainId), ...[...rows.values()].map(row => Number(row.MainId)), ...(!originalBytes && paper ? [Number(paper.MainId)] : [])])
    const removedUuids = new Set<string>()
    for (const row of clip.rows('Layer')) if (!retained.has(Number(row.MainId)) && originallyReachable.has(Number(row.MainId))) {
      removedUuids.add(uuidText(row.LayerUuid)); clip.db.run('DELETE FROM Layer WHERE MainId=?', [row.MainId]); changed = true
    }
    for (const parent of [null, ...state.nodes.filter(node => node.kind === 'folder' || node.kind === 'animation').map(node => node.id)]) {
      const parentRow = parent === null ? root : rows.get(parent)!
      const children = clipChildren(state, parent).map(node => rows.get(node.id)!).reverse()
      if (parent === null && !originalBytes && paper) children.unshift(paper)
      if (clip.row('Layer', parentRow.MainId).LayerFirstChildIndex !== (children[0]?.MainId ?? 0)) changed = true
      clip.update('Layer', parentRow.MainId, { LayerFirstChildIndex: children[0]?.MainId ?? 0 })
      children.forEach((child, index) => {
        const next = children[index + 1]?.MainId ?? 0
        if (clip.row('Layer', child.MainId).LayerNextIndex !== next) changed = true
        clip.update('Layer', child.MainId, { LayerNextIndex: next })
      })
    }
    const originalCel = (folder: ClipLayerNode, name: string) => originals.filter(row => originalParents.get(Number(row.MainId)) === folder.sourceLayerId && row.LayerName === name)
      .sort((a, b) => (originalOrder.get(Number(a.MainId)) ?? 0) - (originalOrder.get(Number(b.MainId)) ?? 0))[0]
    let bank = optionalRows(clip, 'AnimationCutBank')[0]
    const timelines: { row: Row; definition?: ClipTimeline }[] = optionalRows(clip, 'TimeLine').map(row => ({ row, definition: options.plan.timelines.find(timeline => timeline.sourceTimelineId === uuidText(row.TimeLineUuid)) }))
    for (const definition of options.plan.timelines.filter(timeline => !timeline.sourceTimelineId)) {
      if (originalBytes && !definition.tracks.some(track => track.frames.length)) continue
      ensureAnimationStorage(clip, seed)
      if (!bank) {
        bank = clip.insert('AnimationCutBank', seed.rows('AnimationCutBank')[0], { FirstTimeLine: 0, CurrentIndex: 0, Enable: 1 })
        clip.db.run('UPDATE Project SET ProjectCutBank=?', [bank.MainId])
      }
      const row = clip.insert('TimeLine', seed.rows('TimeLine')[0], { BankId: bank.MainId, TimeLineUuid: await identity(options.plan.projectId, `timeline:${definition.id}`), TimeLineName: definition.name, FrameRate: definition.fps, StartFrame: 0, EndFrame: definition.duration, SmallestStartFrame: 0, BiggestEndFrame: definition.duration, FirstTrack: 0, NextTimeLine: 0 })
      const last = clip.rows('TimeLine').find(item => item.MainId !== row.MainId && item.BankId === bank.MainId && item.NextTimeLine === 0)
      if (last) clip.update('TimeLine', last.MainId, { NextTimeLine: row.MainId }); else clip.update('AnimationCutBank', bank.MainId, { FirstTimeLine: row.MainId })
      timelines.push({ row, definition }); changed = true
    }
    for (const { row: timeline, definition } of timelines) {
      progress(`タイムラインを保存しています: ${timeline.TimeLineName}`)
      const before = clip.rows('Track').filter(track => track.ItemId === timeline.MainId && track.BankId === timeline.BankId)
      const ordered: Row[] = []; let next = timeline.FirstTrack; const seen = new Set()
      while (next) { check(!seen.has(next), 'トラック参照が循環しています。'); seen.add(next); const track = before.find(item => item.MainId === next); check(track, 'トラックがありません。'); ordered.push(track); next = track.TrackNextIndex }
      const start = Number(timeline.StartFrame), fps = definition?.fps ?? Number(timeline.FrameRate), end = definition ? start + definition.duration : Number(timeline.EndFrame)
      const newlyInsideCel = new Set(state.nodes.filter(node => node.sourceLayerId !== undefined && !sourceInsideCel.has(node.sourceLayerId)).filter(node => {
        let parent = state.nodes.find(item => item.id === node.parentId)
        while (parent) { if (parent.kind === 'animation') return true; const id = parent.parentId; parent = state.nodes.find(item => item.id === id) }
        return false
      }).map(node => node.id))
      for (const track of [...ordered]) if (removedUuids.has(uuidText(track.LayerUuidWithTrack)) || newlyInsideCel.has(uuidText(track.LayerUuidWithTrack))) {
        if (clip.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='TimeLineLabel'")[0]) clip.db.run('DELETE FROM TimeLineLabel WHERE TrackId=? AND ItemId=? AND BankId=?', [track.MainId, timeline.MainId, timeline.BankId])
        clip.db.run('DELETE FROM Track WHERE MainId=?', [track.MainId]); ordered.splice(ordered.indexOf(track), 1); changed = true
      }
      for (const node of state.nodes) {
        let ancestor = state.nodes.find(item => item.id === node.parentId)
        let insideCel = false
        while (ancestor) { if (ancestor.kind === 'animation') insideCel = true; const parentId = ancestor.parentId; ancestor = state.nodes.find(item => item.id === parentId) }
        if (insideCel) continue
        const layer = rows.get(node.id)!, layerUuidText = uuidText(layer.LayerUuid)
        let track = ordered.find(item => uuidText(item.LayerUuidWithTrack) === layerUuidText)
        const target = definition?.tracks.find(item => item.folderId === node.id)
        let frames = target && !target.preserve ? target.frames.map(frame => ({ ...frame, frame: frame.frame + start })) : undefined
        if (node.kind === 'animation' && track && !frames) {
          const source = state.sourceTimelines?.find(item => item.id === uuidText(timeline.TimeLineUuid))?.tracks.find(item => item.layerId === node.id)
          const cellNamesChanged = originals.some(item => originalParents.get(Number(item.MainId)) === node.sourceLayerId && (!state.nodes.some(current => current.sourceLayerId === item.MainId && current.parentId === node.id && current.name === item.LayerName)))
          if (cellNamesChanged) {
            check(!source?.error, '未対応のタイムラインで使用するセルの改名・削除はできません。')
            const field = clip.body(track.TrackActionMixer) ? 'TrackActionMixer' : 'TrackActionMixer2'
            frames = readAnimation(clip.body(track[field])!, Number(track[`${field}Size`]), fps, start, end).map(frame => {
              const original = frame.value === null ? undefined : originalCel(node, frame.value)
              const current = original && state.nodes.find(item => item.sourceLayerId === original.MainId && item.parentId === node.id)
              return { frame: frame.frame + start, value: original ? current?.name ?? null : frame.value }
            })
          }
        }
        if (!frames && (track || node.sourceLayerId !== undefined && !sourceInsideCel.has(node.sourceLayerId))) continue
        const template = seed.rows('Track').find(item => item.TrackKind === (node.kind === 'animation' ? 2000 : 2003))!
        if (!track) {
          track = clip.insert('Track', template, { BankId: timeline.BankId, ItemId: timeline.MainId, LayerUuidWithTrack: uuidBytes(layer.LayerUuid), TrackUuid: await identity(options.plan.projectId, `track:${timeline.MainId}:${node.id}`), TrackKind: node.kind === 'animation' ? 2000 : node.kind === 'folder' ? 1000 : 2003, TrackNextIndex: 0, TrackLabelFirstIndex: 0 })
          ordered.push(track)
        }
        frames ??= [{ frame: 0, value: null }]
        frames = frames.slice().sort((a, b) => a.frame - b.frame)
        if (!frames.length || frames[0].frame > 0) frames.unshift({ frame: 0, value: null })
        check(frames.every((frame, index) => Number.isInteger(frame.frame) && (!index || frame.frame > frames[index - 1].frame)), 'セル指定のフレームが不正です。')
        const attrs: Row = { TrackValueMap: trackValueMap(frames[0].value) }
        for (const field of ['TrackActionMixer', 'TrackActionMixer2']) {
          const raw = animationMixer(seed.body(template[field])!, frames, Math.max(end, ...frames.map(frame => frame.frame + 1)), fps)
          attrs[field] = clip.addExternal(packedMixer(raw)); attrs[`${field}Size`] = raw.length
        }
        clip.update('Track', track.MainId, attrs)
        if (node.kind === 'animation' && target?.labels?.length && !target.preserve) {
          ensureTrackLabelStorage(clip)
          // Native labels are not projected into sheet events: preserve their raw
          // fields, including unknown types. Only explicit new sheet markers merge.
          const labels = clip.rows('TimeLineLabel').filter(label => label.TrackId === track.MainId && label.ItemId === timeline.MainId && label.BankId === timeline.BankId)
          for (const marker of target.labels) {
            const frame = marker.frame + start
            check(Number.isSafeInteger(frame) && frame >= 0 && frame < end, 'トラックラベルが再生範囲外です。')
            const existing = labels.find(label => label.LabelFrame === frame)
            const type = marker.kind === 'inbetween' ? 1 : 2
            if (existing) {
              check((existing.LabelType === 1 || existing.LabelType === 2) && !existing.LabelName, '同じコマに未対応の既存ラベルがあります。')
              clip.update('TimeLineLabel', existing.MainId, { LabelType: type })
            } else labels.push(clip.insert('TimeLineLabel', {}, { BankId: track.BankId, ItemId: track.ItemId, TrackId: track.MainId, LabelNextIndex: 0, LabelName: '', LabelFrame: frame, LabelType: type, LabelLength: null }))
          }
          labels.sort((a, b) => Number(a.LabelFrame) - Number(b.LabelFrame))
          labels.forEach((label, index) => clip.update('TimeLineLabel', label.MainId, { LabelNextIndex: labels[index + 1]?.MainId ?? 0 }))
          clip.update('Track', track.MainId, { TrackLabelFirstIndex: labels[0]?.MainId ?? 0 })
        }
        changed = true
      }
      ordered.forEach((track, index) => clip.update('Track', track.MainId, { TrackNextIndex: ordered[index + 1]?.MainId ?? 0 }))
      clip.update('TimeLine', timeline.MainId, { FirstTrack: ordered[0]?.MainId ?? 0 })
      if (definition && (Number(timeline.FrameRate) !== fps || Number(timeline.EndFrame) !== end)) {
        clip.update('TimeLine', timeline.MainId, { FrameRate: fps, EndFrame: end, BiggestEndFrame: Math.max(end, Number(timeline.BiggestEndFrame)) }); changed = true
      }
    }
    if (!changed && originalBytes) return { bytes: originalBytes, canvas, layers: originals.length, timelines: timelines.length }
    if (bank && timelines.length) clip.update('AnimationCutBank', bank.MainId, { Enable: 1 })
    const currentLayer = clip.rows('Canvas')[0].CanvasCurrentLayer
    if (!retained.has(Number(currentLayer))) clip.update('Canvas', clip.rows('Canvas')[0].MainId, { CanvasCurrentLayer: root.MainId })
    refreshCaches(clip, canvas.width, canvas.height)
    return { bytes: clip.bytes(), canvas, layers: clip.rows('Layer').length, timelines: timelines.length }
  } finally { clip.close(); seed.close() }
}
