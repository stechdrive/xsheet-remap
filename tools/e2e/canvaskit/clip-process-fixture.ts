import { readFileSync } from 'node:fs'
import type { SqlJsStatic } from 'sql.js'
import { writeClip } from '../../../packages/adapters/src/clip/writer'
import type { ClipRegistrationPlan } from '../../../packages/core/src/index'

export async function createProcessClipFixture(SQL: SqlJsStatic) {
  const plan: ClipRegistrationPlan = {
    projectId: 'nested-process-fixture',
    folders: ['作画', '確認'].map((name, index) => ({ id: `A${index}`, name: 'A', path: ['LO', name], cels: [{ name: '001' }, { name: '002' }] })),
    timelines: [{ id: 'cut', name: 'C001', fps: 24, duration: 24, tracks: [0, 1].map(index => ({ folderId: `A${index}`, frames: [{ frame: 0, value: '001' }, { frame: index ? 8 : 4, value: '002' }] })) }],
  }
  return (await writeClip(SQL, new Uint8Array(readFileSync(new URL('../../../packages/adapters/src/clip/blank.clip', import.meta.url))), {
    plan, canvas: { width: 64, height: 48, dpi: 150, basisWidth: 64, basisHeight: 48, offsetX: 0, offsetY: 0 }, fit: 'crop', images: {},
  })).bytes
}

export async function createOverflowClipFixture(SQL: SqlJsStatic) {
  const names = Array.from({ length: 12 }, (_, index) => String.fromCharCode(65 + index))
  const plan: ClipRegistrationPlan = {
    projectId: 'overflow-fixture',
    folders: names.map(name => ({ id: name, name, path: ['作画'], cels: [{ name: '001' }] })),
    timelines: [{ id: 'cut', name: 'C001', fps: 24, duration: 24, tracks: names.map(name => ({ folderId: name, frames: [{ frame: 0, value: '001' }] })) }],
  }
  return (await writeClip(SQL, new Uint8Array(readFileSync(new URL('../../../packages/adapters/src/clip/blank.clip', import.meta.url))), {
    plan, canvas: { width: 64, height: 48, dpi: 150, basisWidth: 64, basisHeight: 48, offsetX: 0, offsetY: 0 }, fit: 'crop', images: {},
  })).bytes
}
