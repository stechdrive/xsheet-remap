import type { SqlJsStatic } from 'sql.js'
import { ClipContainer, type Row } from './container'
import { png } from './raster'
import { check } from './binary'
import { clipLayerKind, normalizedUuid, optionalRows } from './layer-metadata'
import { createMaterialDecoder, materialOffscreen, type MaterialTables } from './material/material'
import { readAttribute, readRaster } from './material/raster'
import { num } from './material/records'
import { previewMaterialImage } from './material/preview-image'
import type { ClipDiagnostic, ClipLayer } from './material/types'

export interface ClipLayerPreview {
  bytes: Uint8Array; width: number; height: number; storedComposite: boolean
  reconstructed?: boolean
  warnings?: string[]
}

export async function readClipLayerPreview(SQL: SqlJsStatic, bytes: Uint8Array, layerId: number): Promise<ClipLayerPreview> {
  const clip = new ClipContainer(SQL, bytes)
  try {
    // Decode only the requested material; Quick Look must not rasterize all source layers.
    const rows = (table: string): Row[] => clip.db.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [table]).length ? clip.rows(table) : []
    const keyed = (table: string) => new Map(rows(table).map(row => [num(row, 'MainId'), row]))
    const tables: MaterialTables = { mipmaps: keyed('Mipmap'), mipInfos: keyed('MipmapInfo'), offscreens: keyed('Offscreen'),
      thumbnails: rows('LayerThumbnail'), external: clip.external, vectors: keyed('VectorObjectList'), brushes: keyed('BrushStyle'),
      brushGraphs: keyed('BrushEffectorGraphData'), brushPatterns: keyed('BrushPatternStyle'), brushImages: keyed('BrushPatternImage') }
    const row = clip.row('Layer', layerId), canvas = clip.rows('Canvas')[0]
    const root = clip.row('Layer', canvas.CanvasRootFolder), rootSurface = materialOffscreen(tables, root, 'LayerRenderMipmap')
    const rootAttribute = rootSurface?.Attribute instanceof Uint8Array ? readAttribute(rootSurface.Attribute) : undefined
    const width = rootAttribute?.width ?? num(canvas, 'CanvasWidth'), height = rootAttribute?.height ?? num(canvas, 'CanvasHeight')
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width * height <= 64 * 1024 * 1024, 'キャンバス寸法が範囲外です。')
    check(rootAttribute || !num(canvas, 'CanvasUnit'), 'キャンバスのピクセル寸法が取得できません。')
    const kind = clipLayerKind(row, new Map(optionalRows(clip, 'CanvasItem').map(item => [normalizedUuid(item.ItemUuid), item])))
    const folder = Boolean(num(row, 'LayerFolder') & 1), savedOnly = folder || kind === 'video'
    const vector = num(row, 'VectorNormalStrokeIndex') || [...tables.vectors!.values()].some(vector => num(vector, 'LayerId') === layerId)
    const material: ClipLayer = { id: normalizedUuid(row.LayerUuid), name: String(row.LayerName), isFolder: folder,
      isAnimationFolder: Boolean(row.AnimationFolder), expanded: true, hidden: false, opacity: 1, clipping: false, children: [],
      kind: folder ? 'folder' : row.FilterLayerInfo ? 'adjustment' : num(row, 'Manager3D') || num(row, 'Manager3DOd') ? '3d'
        : row.TextLayerString != null || row.TextLayerStringArray != null ? 'text' : row.ResizableImageInfo ? 'image-material' : vector ? 'vector' : 'raster' }
    const diagnostics: ClipDiagnostic[] = []
    const decode = createMaterialDecoder(tables, width, height, num(canvas, 'CanvasResolution', 72), diagnostics)
    if (savedOnly) {
      const surface = materialOffscreen(tables, row, 'LayerRenderMipmap'), body = surface && clip.body(surface.BlockData)
      check(body && surface?.Attribute instanceof Uint8Array, kind === 'video'
        ? 'この動画レイヤーには保存済み画像がありません。元のCLIPで動画を確認してください。' : 'フォルダーの保存済み合成画像がありません。')
      // A saved folder/movie composite already contains its drawing effects.
      material.isFolder = true
      await decode(material, row)
      material.effects = undefined
      material.pixels = await readRaster(readAttribute(surface.Attribute), body, false)
      if (material.pixels) { material.pixels.left += num(row, 'LayerOffsetX') + num(row, 'LayerRenderOffscrOffsetX'); material.pixels.top += num(row, 'LayerOffsetY') + num(row, 'LayerRenderOffscrOffsetY') }
      material.materialSource = 'render'
    } else await decode(material, row)
    check(material.pixels || material.fragments?.length || material.text?.length, diagnostics.map(issue => issue.message).join('\n') || 'このレイヤーの画像を復元できません。')
    const pixels = previewMaterialImage(material, width, height)
    const reconstructed = ['vector', 'text', 'gradient', 'fill'].includes(material.materialSource ?? '')
    return { bytes: png({ width: pixels.width, height: pixels.height, channels: 4, data: new Uint8Array(pixels.rgba.buffer, pixels.rgba.byteOffset, pixels.rgba.byteLength) }),
      width: pixels.width, height: pixels.height, storedComposite: savedOnly || !reconstructed && (num(row, 'LayerType') & ~2) !== 1,
      reconstructed, warnings: diagnostics.map(issue => issue.message) }
  } finally { clip.close() }
}
