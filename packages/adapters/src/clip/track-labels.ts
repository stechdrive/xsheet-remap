import type { ClipTrackLabel } from '@xsheet-remap/core'
import { check } from './binary'
import type { ClipContainer, Row } from './container'

// Recorded from CSP's native ○ / ● commands (fixtures/native-track-labels.json).
// LabelFrame is a zero-based frame number, unlike the mixer's 60 Hz time units.
export function ensureTrackLabelStorage(clip: ClipContainer): void {
  check(clip.rows('ElemScheme').some(row => row.TableName === 'TimeLineLabel')
    && clip.rows('ParamScheme').some(row => row.TableName === 'Track' && row.LabelName === 'TrackLabelFirstIndex'),
  'このCLIPはトラックラベルの保存形式に対応していません。')
  clip.db.run(`CREATE TABLE IF NOT EXISTS TimeLineLabel (
    _PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, MainId INTEGER DEFAULT NULL,
    BankId INTEGER DEFAULT NULL, ItemId INTEGER DEFAULT NULL, TrackId INTEGER DEFAULT NULL,
    LabelNextIndex INTEGER DEFAULT NULL, LabelName TEXT DEFAULT NULL, LabelFrame REAL DEFAULT NULL,
    LabelType INTEGER DEFAULT NULL, LabelLength NULL DEFAULT NULL)`)
  const fields = clip.db.exec('PRAGMA table_info(Track)')[0].values.map(row => row[1])
  if (!fields.includes('TrackLabelFirstIndex')) clip.db.run('ALTER TABLE Track ADD COLUMN TrackLabelFirstIndex INTEGER DEFAULT NULL')
}

export function writeTrackLabels(clip: ClipContainer, track: Row, labels: ClipTrackLabel[], duration: number): void {
  const ordered = [...labels].sort((a, b) => a.frame - b.frame)
  check(ordered.every((label, index) => Number.isSafeInteger(label.frame) && label.frame >= 0 && label.frame < duration
    && (label.kind === 'inbetween' || label.kind === 'reverse') && (!index || label.frame > ordered[index - 1].frame)),
  'トラックラベルの種類・フレーム位置が不正、または重複しています。')
  let previous: Row | undefined
  for (const label of ordered) {
    const row = clip.insert('TimeLineLabel', {}, { BankId: track.BankId, ItemId: track.ItemId, TrackId: track.MainId,
      LabelNextIndex: 0, LabelName: '', LabelFrame: label.frame, LabelType: label.kind === 'inbetween' ? 1 : 2, LabelLength: null })
    if (previous) clip.update('TimeLineLabel', previous.MainId, { LabelNextIndex: row.MainId })
    else clip.update('Track', track.MainId, { TrackLabelFirstIndex: row.MainId })
    previous = row
  }
}
