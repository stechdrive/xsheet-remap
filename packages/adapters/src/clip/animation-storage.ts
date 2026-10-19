import { check } from './binary'
import type { ClipContainer } from './container'

/** CSP omits unused animation tables/columns from illustration documents. */
export function ensureAnimationStorage(clip: ClipContainer, seed: ClipContainer): void {
  const schemes = clip.rows('ElemScheme')
  for (const table of ['AnimationCutBank', 'TimeLine', 'Track']) {
    if (clip.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]).length) continue
    check(schemes.some(row => row.TableName === table), 'このCLIPにはアニメーションの保存形式がありません。')
    const sql = seed.db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", [table])[0]?.values[0]?.[0]
    check(typeof sql === 'string', 'アニメーションのひな形がありません。')
    clip.db.run(sql)
  }
}

export function ensureAnimationFolderStorage(clip: ClipContainer): void {
  const fields = clip.db.exec('PRAGMA table_info(Layer)')[0].values.map(row => row[1])
  if (fields.includes('AnimationFolder')) return
  check(clip.rows('ParamScheme').some(row => row.TableName === 'Layer' && row.LabelName === 'AnimationFolder'),
    'このCLIPにはアニメーションフォルダーの保存形式がありません。')
  clip.db.run('ALTER TABLE Layer ADD COLUMN AnimationFolder INTEGER DEFAULT NULL')
}
