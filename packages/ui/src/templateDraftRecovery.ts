import type { SheetTemplate } from '@xsheet-remap/core'

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
    || !isRecoverableTemplate(value.template)) return null
  return value as unknown as TemplateDraftRecovery
}

function isRecoverableTemplate(value: unknown): value is SheetTemplate {
  if (!isRecord(value)
    || !Number.isInteger(value.schemaVersion)
    || typeof value.templateId !== 'string'
    || typeof value.name !== 'string'
    || !isRecord(value.theme)
    || !isRecord(value.page)
    || typeof value.page.widthPx !== 'number'
    || !Number.isFinite(value.page.widthPx)
    || typeof value.page.heightPx !== 'number'
    || !Number.isFinite(value.page.heightPx)
    || value.page.coordinateSpace !== 'normalized'
    || !isRecord(value.defaults)
    || typeof value.defaults.fps !== 'number'
    || !Number.isFinite(value.defaults.fps)
    || typeof value.defaults.durationFrames !== 'number'
    || !Number.isFinite(value.defaults.durationFrames)
    || typeof value.defaults.frameOrigin !== 'number'
    || !Number.isFinite(value.defaults.frameOrigin)
    || !Array.isArray(value.defaults.paperTracks)
    || !value.defaults.paperTracks.every(track => typeof track === 'string')
    || !Array.isArray(value.regions)) return false

  return value.regions.every(region => isRecord(region)
    && typeof region.regionId === 'string'
    && typeof region.label === 'string'
    && isRecord(region.rect)
    && finiteNumber(region.rect.x)
    && finiteNumber(region.rect.y)
    && finiteNumber(region.rect.w)
    && finiteNumber(region.rect.h)
    && typeof region.usage === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
