import { parseSheetTemplate, SHEET_TEMPLATE_SCHEMA_VERSION, type SheetTemplate } from '@xsheet-remap/core'

export const TEMPLATE_DRAFT_RECOVERY_VERSION = 1 as const

export interface TemplateDraftRecovery {
  version: typeof TEMPLATE_DRAFT_RECOVERY_VERSION
  savedAt: number
  template: SheetTemplate
}

const DATABASE_NAME = 'xsheet-template-draft-recovery'
const DATABASE_VERSION = 1
const STORE_NAME = 'drafts'
const CURRENT_DRAFT_KEY = 'current'

/** Loads the most recent standalone template draft, or null when recovery is unavailable or invalid. */
export async function loadTemplateDraftRecovery(): Promise<TemplateDraftRecovery | null> {
  const database = await openRecoveryDatabase()
  if (!database) return null
  try {
    return parseRecoveryRecord(await readCurrentDraft(database))
  } catch {
    return null
  } finally {
    database.close()
  }
}

/** Stores a draft in IndexedDB. False means persistence was unavailable; no Web Storage fallback is attempted. */
export async function saveTemplateDraftRecovery(template: SheetTemplate): Promise<boolean> {
  const database = await openRecoveryDatabase()
  if (!database) return false
  const recovery: TemplateDraftRecovery = {
    version: TEMPLATE_DRAFT_RECOVERY_VERSION,
    savedAt: Date.now(),
    template,
  }
  try {
    return await writeCurrentDraft(database, recovery)
  } catch {
    return false
  } finally {
    database.close()
  }
}

/** Removes any saved draft. It is safe to call when IndexedDB is unavailable. */
export async function clearTemplateDraftRecovery(): Promise<void> {
  const database = await openRecoveryDatabase()
  if (!database) return
  try {
    await deleteCurrentDraft(database)
  } catch {
    // Draft cleanup must never prevent the caller from continuing.
  } finally {
    database.close()
  }
}

function openRecoveryDatabase(): Promise<IDBDatabase | null> {
  let factory: IDBFactory | undefined
  try {
    factory = globalThis.indexedDB
  } catch {
    return Promise.resolve(null)
  }
  if (!factory || typeof factory.open !== 'function') return Promise.resolve(null)

  return new Promise(resolve => {
    let request: IDBOpenDBRequest
    let settled = false
    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        database?.close()
        return
      }
      settled = true
      resolve(database)
    }

    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION)
    } catch {
      finish(null)
      return
    }

    request.onupgradeneeded = () => {
      try {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
      } catch {
        request.transaction?.abort()
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      finish(database)
    }
    request.onerror = () => finish(null)
    request.onblocked = () => finish(null)
  })
}

function readCurrentDraft(database: IDBDatabase): Promise<unknown> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: unknown) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(CURRENT_DRAFT_KEY)
      request.onsuccess = () => finish(request.result)
      request.onerror = () => finish(null)
      transaction.onabort = () => finish(null)
      transaction.onerror = () => finish(null)
    } catch {
      finish(null)
    }
  })
}

function writeCurrentDraft(database: IDBDatabase, recovery: TemplateDraftRecovery): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const finish = (saved: boolean) => {
      if (settled) return
      settled = true
      resolve(saved)
    }
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(recovery, CURRENT_DRAFT_KEY)
      transaction.oncomplete = () => finish(true)
      transaction.onabort = () => finish(false)
      transaction.onerror = () => finish(false)
    } catch {
      finish(false)
    }
  })
}

function deleteCurrentDraft(database: IDBDatabase): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(CURRENT_DRAFT_KEY)
      transaction.oncomplete = finish
      transaction.onabort = finish
      transaction.onerror = finish
    } catch {
      finish()
    }
  })
}

function parseRecoveryRecord(value: unknown): TemplateDraftRecovery | null {
  if (!isRecord(value)
    || value.version !== TEMPLATE_DRAFT_RECOVERY_VERSION
    || typeof value.savedAt !== 'number'
    || !Number.isFinite(value.savedAt)
    || value.savedAt < 0
    || !isRecord(value.template)
    || value.template.schemaVersion !== SHEET_TEMPLATE_SCHEMA_VERSION) return null
  try {
    return {
      version: TEMPLATE_DRAFT_RECOVERY_VERSION,
      savedAt: value.savedAt,
      template: parseRecoverableTemplateDraft(value.template),
    }
  } catch {
    return null
  }
}

/**
 * Recovery has a different completion boundary from import/save. An editor may
 * persist a correctly shaped draft while a text or numeric control is between
 * valid values. Validate the complete object graph with the canonical parser,
 * but relax only those authoring constraints on a separate validation clone so
 * the unfinished values themselves survive recovery and remain visible in the
 * review panel.
 */
function parseRecoverableTemplateDraft(input: unknown): SheetTemplate {
  const draft = structuredClone(input)
  const validationCandidate = structuredClone(draft)
  relaxIncompleteAuthoringValues(validationCandidate)
  parseSheetTemplate(validationCandidate)
  return draft as SheetTemplate
}

function relaxIncompleteAuthoringValues(input: unknown): void {
  if (!isRecord(input)) return
  replaceBlankString(input, 'templateId', 'draft-template')
  replaceBlankString(input, 'name', '未完成のテンプレート')

  if (isRecord(input.defaults)) {
    replaceNonPositiveFiniteNumber(input.defaults, 'fps', 1)
    replaceNonPositiveFiniteInteger(input.defaults, 'durationFrames', 1)
    if (Array.isArray(input.defaults.paperTracks)
      && input.defaults.paperTracks.every(track => typeof track === 'string')) {
      input.defaults.paperTracks = uniqueDraftStrings(input.defaults.paperTracks, 'セル')
    }
  }

  if (isRecord(input.calibration) && isRecord(input.calibration.targetRect)) {
    relaxNormalizedRect(input.calibration.targetRect)
  }

  if (Array.isArray(input.fields)) {
    for (const [index, field] of input.fields.entries()) {
      if (!isRecord(field)) continue
      replaceBlankString(field, 'label', `未完成の項目 ${index + 1}`)
      if (isRecord(field.builtinBinding)) replaceBlankString(field.builtinBinding, 'customKey', 'draft-key')
      const choices = field.choices
      if (field.valueType === 'choice'
        && Array.isArray(choices)
        && choices.every((choice): choice is string => typeof choice === 'string')) {
        const validationChoices = uniqueDraftStrings(choices, '選択肢')
        const normalizedChoices = validationChoices.length > 0 ? validationChoices : ['未完成の選択肢']
        field.choices = normalizedChoices
        if (typeof field.defaultValue === 'string' && !normalizedChoices.includes(field.defaultValue)) {
          field.defaultValue = normalizedChoices[0]
        }
      }
    }
  }

  if (!Array.isArray(input.regions)) return
  for (const [index, region] of input.regions.entries()) {
    if (!isRecord(region)) continue
    replaceBlankString(region, 'label', `未完成の領域 ${index + 1}`)
    replaceBlankString(region, 'authoringName', `未完成の領域 ${index + 1}`)
    if (isRecord(region.rect)) relaxNormalizedRect(region.rect)
    if (isRecord(region.binding)) {
      replaceBlankString(region.binding, 'customKey', 'draft-key')
      replaceBlankString(region.binding, 'layerId', 'draft-layer')
    }
    if (isRecord(region.grid)) {
      replaceNonPositiveFiniteInteger(region.grid, 'rowCount', 1)
      const frameStart = typeof region.grid.frameStart === 'number'
        ? region.grid.frameStart
        : isRecord(input.defaults) && typeof input.defaults.frameOrigin === 'number'
          ? input.defaults.frameOrigin
          : 1
      if (region.grid.frameProjection === undefined
        && typeof region.grid.frameEnd === 'number'
        && typeof region.grid.rowCount === 'number') {
        region.grid.frameEnd = frameStart + region.grid.rowCount - 1
      }
    }
    if (isRecord(region.form) && Array.isArray(region.form.cells)) {
      for (const [cellIndex, cell] of region.form.cells.entries()) {
        if (isRecord(cell) && cell.kind === 'label') {
          replaceBlankString(cell, 'label', `未完成の表示文字 ${cellIndex + 1}`)
        }
      }
    }
  }
}

function replaceBlankString(record: Record<string, unknown>, key: string, fallback: string): void {
  if (typeof record[key] === 'string' && !record[key].trim()) record[key] = fallback
}

function replaceNonPositiveFiniteNumber(record: Record<string, unknown>, key: string, fallback: number): void {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value) && value <= 0) record[key] = fallback
}

function replaceNonPositiveFiniteInteger(record: Record<string, unknown>, key: string, fallback: number): void {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || value <= 0)) record[key] = fallback
}

function uniqueDraftStrings(values: string[], label: string): string[] {
  const used = new Set<string>()
  return values.map((value, index) => {
    const base = value.trim() || `${label} ${index + 1}`
    let candidate = base
    let suffix = 2
    while (used.has(candidate)) {
      candidate = `${base} ${suffix}`
      suffix += 1
    }
    used.add(candidate)
    return candidate
  })
}

function relaxNormalizedRect(rect: Record<string, unknown>): void {
  if (![rect.x, rect.y, rect.w, rect.h].every(value => typeof value === 'number' && Number.isFinite(value))) return
  const x = Math.min(0.999999, Math.max(0, rect.x as number))
  const y = Math.min(0.999999, Math.max(0, rect.y as number))
  rect.x = x
  rect.y = y
  rect.w = Math.min(1 - x, Math.max(0.000001, rect.w as number))
  rect.h = Math.min(1 - y, Math.max(0.000001, rect.h as number))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
