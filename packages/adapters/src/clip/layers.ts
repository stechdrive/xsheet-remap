import { check, externalId, utf8 } from './binary'
import { blob, ClipContainer, type Row } from './container'
import { attributeSize, decodeRaster, encodeRaster, reducePixels, type Pixels } from './raster'

export function mipmapChain(clip: ClipContainer, id: Row[string]): { info: Row; off: Row }[] {
  const mip = clip.row('Mipmap', id), result: { info: Row; off: Row }[] = [], visited = new Set()
  let next = mip.BaseMipmapInfo
  while (next) {
    check(!visited.has(next) && visited.size < 32, 'ミップマップの参照が循環しています。'); visited.add(next)
    const info = clip.row('MipmapInfo', next), off = clip.row('Offscreen', info.Offscreen)
    result.push({ info, off }); next = info.NextIndex
  }
  check(result.length, 'ミップマップが空です。'); return result
}
export function readLayerPixels(clip: ClipContainer, layer: Row, mask = false): Pixels {
  const off = mipmapChain(clip, mask ? layer.LayerLayerMaskMipmap : layer.LayerRenderMipmap)[0].off
  return decodeRaster(blob(off.Attribute), clip.body(off.BlockData))
}
export function writeMipmap(clip: ClipContainer, layer: Row, source: Pixels | { width: number; height: number }, seed: ClipContainer, template: Row, mask = false): number {
  const mipTemplate = seed.row('Mipmap', mask ? template.LayerLayerMaskMipmap : template.LayerRenderMipmap)
  const originals = mipmapChain(seed, mipTemplate.MainId), base = originals[0]
  let width = source.width, height = source.height, pixels = 'data' in source ? source : undefined, previous: Row | undefined, first: Row | undefined, count = 0
  while (true) {
    const encoded = pixels ? encodeRaster(pixels, blob(base.off.Attribute)) : undefined
    const off = clip.insert('Offscreen', base.off, { CanvasId: clip.rows('Canvas')[0].MainId, LayerId: layer.MainId, Attribute: encoded?.attribute ?? attributeSize(blob(base.off.Attribute), width, height), BlockData: encoded ? clip.addExternal(encoded.body) : utf8.encode(externalId()) })
    const info = clip.insert('MipmapInfo', base.info, { CanvasId: clip.rows('Canvas')[0].MainId, LayerId: layer.MainId, ThisScale: 100 / 2 ** count, Offscreen: off.MainId, NextIndex: 0 })
    if (previous) clip.update('MipmapInfo', previous.MainId, { NextIndex: info.MainId })
    first ??= info; previous = info; count++
    if (count > 1 && width <= 128 && height <= 128) break
    width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2))
    if (pixels) pixels = reducePixels(pixels, width, height)
  }
  return Number(clip.insert('Mipmap', mipTemplate, { CanvasId: clip.rows('Canvas')[0].MainId, LayerId: layer.MainId, MipmapCount: count, BaseMipmapInfo: first!.MainId }).MainId)
}
export function refreshCaches(clip: ClipContainer, width: number, height: number): void {
  for (const layer of clip.rows('Layer').filter(layer => layer.LayerFolder && layer.LayerRenderMipmap)) {
    for (const { off } of mipmapChain(clip, layer.LayerRenderMipmap)) clip.update('Offscreen', off.MainId, { BlockData: utf8.encode(externalId()) })
  }
  for (const thumb of clip.rows('LayerThumbnail')) {
    clip.update('Offscreen', thumb.ThumbnailOffscreen, { BlockData: utf8.encode(externalId()) })
    const fields = Object.keys(thumb).filter(key => key.includes('NeedRefresh')), revision = Math.max(0, ...fields.map(key => Number(thumb[key]))) + 1
    clip.update('LayerThumbnail', thumb.MainId, { ThumbnailCanvasWidth: width, ThumbnailCanvasHeight: height, ...Object.fromEntries(fields.map(key => [key, revision])) })
  }
}
export function appendChild(clip: ClipContainer, parentId: Row[string], childId: Row[string]): void {
  const parent = clip.row('Layer', parentId)
  let current = parent.LayerFirstChildIndex
  if (!current) { clip.update('Layer', parentId, { LayerFirstChildIndex: childId }); return }
  const visited = new Set()
  while (current) {
    check(!visited.has(current), 'レイヤーの参照が循環しています。'); visited.add(current)
    const row = clip.row('Layer', current)
    if (!row.LayerNextIndex) { clip.update('Layer', current, { LayerNextIndex: childId }); return }
    current = row.LayerNextIndex
  }
}
export function createLayer(clip: ClipContainer, seed: ClipContainer, options: { name: string; uuid: string; parentId: Row[string]; kind: 'folder' | 'animation' | 'raster'; width: number; height: number; pixels?: Pixels }): Row {
  const template = seed.rows('Layer').find(row => options.kind === 'raster' ? row.LayerType === 1 : row.AnimationFolder === 1)!
  const layer = clip.insert('Layer', template, { CanvasId: clip.rows('Canvas')[0].MainId, LayerName: options.name, LayerUuid: options.uuid,
    LayerType: options.kind === 'raster' ? 1 : 0, LayerFolder: options.kind === 'raster' ? 0 : 1, AnimationFolder: options.kind === 'animation' ? 1 : 0,
    LayerFirstChildIndex: 0, LayerNextIndex: 0, LayerSelect: 0, LayerOffsetX: 0, LayerOffsetY: 0, LayerRenderOffscrOffsetX: 0, LayerRenderOffscrOffsetY: 0 })
  // Missing externals are valid refreshable folder caches, but CSP reports a
  // damaged image when a new raster cel has no stored surface. Store transparent
  // pixels for material-unassigned cels as well.
  const pixels = options.pixels ?? (options.kind === 'raster'
    ? { width: options.width, height: options.height, channels: 4 as const, data: new Uint8Array(options.width * options.height * 4) }
    : options)
  const mip = writeMipmap(clip, layer, pixels, seed, template)
  const thumbTemplate = seed.row('LayerThumbnail', template.LayerRenderThumbnail)
  const offTemplate = seed.row('Offscreen', thumbTemplate.ThumbnailOffscreen)
  const off = clip.insert('Offscreen', offTemplate, { CanvasId: clip.rows('Canvas')[0].MainId, LayerId: layer.MainId, BlockData: utf8.encode(externalId()) })
  const thumb = clip.insert('LayerThumbnail', thumbTemplate, { CanvasId: clip.rows('Canvas')[0].MainId, LayerId: layer.MainId, ThumbnailOffscreen: off.MainId, ThumbnailCanvasWidth: options.width, ThumbnailCanvasHeight: options.height })
  clip.update('Layer', layer.MainId, { LayerRenderMipmap: mip, LayerRenderThumbnail: thumb.MainId })
  appendChild(clip, options.parentId, layer.MainId)
  return clip.row('Layer', layer.MainId)
}
