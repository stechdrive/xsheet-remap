import { readFileSync } from 'node:fs'
import type { SqlJsStatic } from 'sql.js'
import { ClipContainer } from '../container'
import { writeClip } from '../writer'
import { vectorBytes } from './clip-vector'
import { writeMipmap } from '../layers'

/** Small generated CLIP with nested saved disclosure and a cache-free vector cel. */
export async function createPreviewFixture(SQL: SqlJsStatic) {
  const seed = new Uint8Array(readFileSync(new URL('../blank.clip', import.meta.url)))
  const result = await writeClip(SQL, seed, { canvas: { width: 32, height: 24, dpi: 150, basisWidth: 24, basisHeight: 16, offsetX: 0, offsetY: 0 }, fit: 'crop', images: {},
    plan: { projectId: 'preview', folders: [
      { id: 'A', name: 'A', path: ['作画 '], cels: [{ name: 'vector-cel' }] },
      { id: 'fix', name: 'A', path: ['修正'], cels: [{ name: '1' }] },
    ], timelines: [{ id: 't', name: 'C001', fps: 24, duration: 24, tracks: [{ folderId: 'A', frames: [{ frame: 0, value: 'vector-cel' }] }] }] } })
  const clip = new ClipContainer(SQL, result.bytes)
  const vector = clip.rows('Layer').find(row => row.LayerName === 'vector-cel')!
  clip.update('Layer', vector.MainId, { LayerRenderMipmap: 0, TimeLineOriginalMipmap: 0, ResizableOriginalMipmap: 0,
    LayerOffsetX: 2, LayerOffsetY: 3, LayerOpacity: 128, LayerUsePaletteColor: 1, LayerPaletteRed: 0xffffffff })
  clip.db.run("UPDATE Layer SET LayerFolder = LayerFolder | 16 WHERE LayerName = 'A'")
  // The LayerId fallback is necessary for files with no VectorNormalStrokeIndex column.
  clip.db.run('DROP TABLE IF EXISTS VectorObjectList')
  clip.db.run('CREATE TABLE VectorObjectList (MainId, LayerId, VectorData)')
  clip.db.run('INSERT INTO VectorObjectList VALUES (1,?,?)', [vector.MainId, clip.addExternal(vectorBytes({ diameter: 7 }))])
  clip.db.run('DROP TABLE IF EXISTS BrushStyle')
  clip.db.run('CREATE TABLE BrushStyle (MainId, AntiAlias, Hardness, CompositeMode, ThicknessBase)')
  clip.db.run('INSERT INTO BrushStyle VALUES (7,1,1,0,1)')
  return { clip, vectorId: Number(vector.MainId) }
}

/** Synthetic saved material; deliberately broken vector data must never be decoded. */
export async function createCachedPreviewFixture(SQL: SqlJsStatic, kind: 'vector' | '3d', saved = true) {
  const fixture = await createPreviewFixture(SQL), { clip, vectorId } = fixture
  const row = clip.row('Layer', vectorId)
  for (const [name, type] of [['TimeLineOriginalMipmap', 'INTEGER DEFAULT 0'], ['LayerEffectAttached', 'INTEGER DEFAULT 0'], ['LayerEffectInfo', 'BLOB']]) {
    if (!(name in row)) clip.db.run(`ALTER TABLE Layer ADD COLUMN ${name} ${type}`)
  }
  if (!('CanvasRenderMipmapForceSaved' in clip.rows('Canvas')[0])) clip.db.run('ALTER TABLE Canvas ADD COLUMN CanvasRenderMipmapForceSaved INTEGER DEFAULT 0')
  clip.db.run('UPDATE Canvas SET CanvasRenderMipmapForceSaved=1')
  clip.db.run('UPDATE VectorObjectList SET VectorData=?', [clip.addExternal(new Uint8Array([1, 2, 3]))])
  if (kind === '3d') {
    if (!('Manager3DOd' in row)) clip.db.run('ALTER TABLE Layer ADD COLUMN Manager3DOd INTEGER DEFAULT 0')
    clip.update('Layer', vectorId, { Manager3DOd: 1, LayerName: '3D-cel' })
    clip.db.run('DELETE FROM VectorObjectList')
  }
  if (saved) {
    const template = clip.rows('Layer').find(r => r.LayerName === '1' && r.LayerRenderMipmap)!
    const mip = writeMipmap(clip, row, { width: 2, height: 1, channels: 4, data: new Uint8Array([24, 80, 160, 255, 160, 80, 24, 128]) }, clip, template)
    clip.update('Layer', vectorId, { LayerRenderMipmap: mip })
  }
  return fixture
}
