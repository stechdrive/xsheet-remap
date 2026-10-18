import { readFileSync } from 'node:fs'
import type { SqlJsStatic } from 'sql.js'
import { ClipContainer } from '../container'
import { writeClip } from '../writer'
import { vectorBytes } from './clip-vector'

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
