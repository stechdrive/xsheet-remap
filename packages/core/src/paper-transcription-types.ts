import type { NormalizedRect } from './sheet-template-schema'
import type { SheetTimingRole } from './types'

export const PAPER_TRANSCRIPTION_FORMAT = 'xsheet-remap.paper-transcription'
export const PAPER_TRANSCRIPTION_VERSION = 1
export const PAPER_TRANSCRIPTION_KINDS = ['cell', 'empty', 'hold', 'blank', 'inbetween', 'reverse', 'uncertain', 'unread'] as const
export type PaperTranscriptionKind = typeof PAPER_TRANSCRIPTION_KINDS[number]

/** A run describes observed paper marks, not an exposure duration. Bounds are inclusive. */
export interface PaperTranscriptionRun {
  from: number
  to: number
  kind: PaperTranscriptionKind
  raw: string
  value?: string
  note?: string
  frameCandidates?: number[]
  valueCandidates?: string[]
}

export interface PaperTranscriptionResult {
  format: typeof PAPER_TRANSCRIPTION_FORMAT
  version: typeof PAPER_TRANSCRIPTION_VERSION
  requestId: string
  targets: { targetId: string; runs: PaperTranscriptionRun[] }[]
}

export interface PaperTranscriptionTarget {
  targetId: string
  pageId: string
  pageNumber: number
  regionId: string
  role: SheetTimingRole
  label: string
  column: string
  columnLabel: string
  from: number
  to: number
  firstRow: number
  rect: NormalizedRect
}

export interface PaperTranscriptionRequest {
  format: 'xsheet-remap.paper-transcription-request'
  version: 1
  requestId: string
  context: string
  templateName: string
  fps: number
  selection: { roles: SheetTimingRole[]; columns: string[]; from: number; to: number }
  targets: PaperTranscriptionTarget[]
}

export const paperTranscriptionKindLabels: Record<PaperTranscriptionKind, string> = {
  cell: 'セル番号', empty: '記入なし', hold: '継続線',
  blank: 'カラセル', inbetween: '中割', reverse: '逆シート',
  uncertain: '要確認', unread: '未読',
}
