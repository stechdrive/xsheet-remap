// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import type { SqlValue } from 'sql.js'

export type ClipRow = Record<string, SqlValue>
export const num = (row: ClipRow, key: string, fallback = 0): number => typeof row[key] === 'number' ? row[key] : fallback
export const str = (value: SqlValue | undefined): string => value instanceof Uint8Array ? new TextDecoder().decode(value) : typeof value === 'string' ? value : ''
export const errorMessage = (e: unknown): string => e instanceof Error ? e.message : String(e)
