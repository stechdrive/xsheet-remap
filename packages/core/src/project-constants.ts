import type { CspCellNamePolicy, SheetTimingRole } from './types'

export const DEFAULT_SHEET_TIMING_ROLE: SheetTimingRole = 'cell'
export const DEFAULT_EXPORT_TIMING_ROLE: SheetTimingRole = 'action'
export const DEFAULT_CSP_CELL_NAME_POLICY: CspCellNamePolicy = { mode: 'binding-or-paper-track-label' }
export const DEFAULT_IMPORT_STACK_START_SEPARATOR_NAME = '===== XSHEET IMPORT START ====='
export const DEFAULT_IMPORT_STACK_END_SEPARATOR_NAME = '===== XSHEET IMPORT END ====='
export const MAX_CORRECTION_LAYERS = 10
export const PROJECT_DOCUMENT_KIND = 'xsheet-remap-cut-group-project'
export const PROJECT_DOCUMENT_SCHEMA_VERSION = 4
