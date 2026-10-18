import type { ClipLayerNode } from '@xsheet-remap/core'
import type { ClipContainer, Row } from './container'

export const normalizedUuid = (value: Row[string]) => value instanceof Uint8Array
  ? Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')
  : String(value ?? '').replaceAll('-', '').toLowerCase()

/** Media tables are absent from older/plain raster documents. */
export function optionalRows(clip: ClipContainer, table: 'CanvasItem' | 'CanvasItemBinary' | 'LayerObject'): Row[] {
  return clip.db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`)[0] ? clip.rows(table) : []
}

export function clipLayerKind(layer: Row, items: Map<string, Row>): ClipLayerNode['kind'] {
  if (layer.AnimationFolder) return 'animation'
  if (layer.LayerFolder) return 'folder'
  if (Number(layer.AudioLayer) === 1) return 'audio'
  // Static file objects also use LayerType=0. A playback track alone is not proof of a movie.
  const item = items.get(normalizedUuid(layer.LinkLayerItemUUID)) ?? items.get(normalizedUuid(layer.BankItemUuid))
  if (item?.ItemType === 'Movie') return 'video'
  return (Number(layer.LayerType) & ~2) === 1 ? 'raster' : 'other'
}

export function clipLabelColor(layer: Row): string | undefined {
  if (!Number(layer.LayerUsePaletteColor)) return undefined
  const channels = [layer.LayerPaletteRed, layer.LayerPaletteGreen, layer.LayerPaletteBlue].map(Number)
  if (channels.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) return undefined
  // CSP stores each channel as a normalized unsigned 32-bit value.
  return '#' + channels.map(value => Math.round(value / 0x01010101).toString(16).padStart(2, '0')).join('')
}
