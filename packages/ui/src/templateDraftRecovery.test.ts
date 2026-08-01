import { afterEach, describe, expect, it, vi } from 'vitest'
import { standardA3SheetTemplate, type SheetTemplate } from '@xsheet-remap/core'
import {
  TEMPLATE_DRAFT_RECOVERY_VERSION,
  clearTemplateDraftRecovery,
  loadTemplateDraftRecovery,
  saveTemplateDraftRecovery,
} from './templateDraftRecovery'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('template draft recovery', () => {
  it('returns null or no-op when IndexedDB is unavailable without using localStorage', async () => {
    const localStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('indexedDB', undefined)
    vi.stubGlobal('localStorage', localStorage)

    await expect(loadTemplateDraftRecovery()).resolves.toBeNull()
    await expect(saveTemplateDraftRecovery(cloneTemplate())).resolves.toBe(false)
    await expect(clearTemplateDraftRecovery()).resolves.toBeUndefined()
    expect(localStorage.getItem).not.toHaveBeenCalled()
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(localStorage.removeItem).not.toHaveBeenCalled()
  })

  it('round-trips a draft with a large reference-image data URL and records version and time', async () => {
    const factory = new FakeIndexedDbFactory()
    vi.stubGlobal('indexedDB', factory as unknown as IDBFactory)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T02:30:00.000Z'))
    const template = cloneTemplate()
    template.name = ''
    template.defaultUnderlay = {
      ...template.defaultUnderlay!,
      assetPath: `data:image/png;base64,${'A'.repeat(64_000)}`,
      imageRef: {
        ...template.defaultUnderlay!.imageRef,
        assetPath: `data:image/png;base64,${'B'.repeat(64_000)}`,
      },
    }

    await expect(saveTemplateDraftRecovery(template)).resolves.toBe(true)
    const recovery = await loadTemplateDraftRecovery()

    expect(recovery).toMatchObject({
      version: TEMPLATE_DRAFT_RECOVERY_VERSION,
      savedAt: Date.parse('2026-08-01T02:30:00.000Z'),
      template: { name: '' },
    })
    expect(recovery?.template.defaultUnderlay?.assetPath).toHaveLength('data:image/png;base64,'.length + 64_000)
    expect(factory.rawRecord()).toMatchObject({
      version: TEMPLATE_DRAFT_RECOVERY_VERSION,
      savedAt: Date.parse('2026-08-01T02:30:00.000Z'),
    })
  })

  it('clears the current recovery record', async () => {
    const factory = new FakeIndexedDbFactory()
    vi.stubGlobal('indexedDB', factory as unknown as IDBFactory)

    expect(await saveTemplateDraftRecovery(cloneTemplate())).toBe(true)
    expect(await loadTemplateDraftRecovery()).not.toBeNull()

    await clearTemplateDraftRecovery()

    expect(await loadTemplateDraftRecovery()).toBeNull()
  })

  it('treats unsupported versions and malformed templates as corrupt', async () => {
    const factory = new FakeIndexedDbFactory()
    vi.stubGlobal('indexedDB', factory as unknown as IDBFactory)

    factory.seed({ version: 999, savedAt: Date.now(), template: cloneTemplate() })
    expect(await loadTemplateDraftRecovery()).toBeNull()

    factory.seed({ version: TEMPLATE_DRAFT_RECOVERY_VERSION, savedAt: Date.now(), template: { regions: 'broken' } })
    expect(await loadTemplateDraftRecovery()).toBeNull()

    factory.seed({ version: TEMPLATE_DRAFT_RECOVERY_VERSION, savedAt: Number.NaN, template: cloneTemplate() })
    expect(await loadTemplateDraftRecovery()).toBeNull()
  })

  it('fails safely when opening IndexedDB throws', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('denied') } })

    await expect(loadTemplateDraftRecovery()).resolves.toBeNull()
    await expect(saveTemplateDraftRecovery(cloneTemplate())).resolves.toBe(false)
    await expect(clearTemplateDraftRecovery()).resolves.toBeUndefined()
  })
})

function cloneTemplate(): SheetTemplate {
  return structuredClone(standardA3SheetTemplate)
}

class FakeIndexedDbFactory {
  private value: unknown
  private storeExists = false

  open(): IDBOpenDBRequest {
    const request = createRequest<IDBDatabase>() as IDBOpenDBRequest
    queueMicrotask(() => {
      const database = this.createDatabase()
      setRequestResult(request, database)
      if (!this.storeExists) {
        request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
        this.storeExists = true
      }
      request.onsuccess?.(new Event('success'))
    })
    return request
  }

  seed(value: unknown): void {
    this.value = structuredClone(value)
    this.storeExists = true
  }

  rawRecord(): unknown {
    return structuredClone(this.value)
  }

  private createDatabase(): IDBDatabase {
    return {
      objectStoreNames: { contains: () => this.storeExists } as unknown as DOMStringList,
      createObjectStore: () => {
        this.storeExists = true
        return {} as IDBObjectStore
      },
      transaction: () => createTransaction(this),
      close: vi.fn(),
      onversionchange: null,
    } as unknown as IDBDatabase
  }

  getValue(): unknown {
    return structuredClone(this.value)
  }

  setValue(value: unknown): void {
    this.value = structuredClone(value)
  }

  deleteValue(): void {
    this.value = undefined
  }
}

function createTransaction(factory: FakeIndexedDbFactory): IDBTransaction {
  const transaction: {
    oncomplete: ((event: Event) => void) | null
    onabort: ((event: Event) => void) | null
    onerror: ((event: Event) => void) | null
    objectStore: () => IDBObjectStore
  } = {
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: () => ({
      get: () => {
        const request = createRequest<unknown>()
        queueMicrotask(() => {
          setRequestResult(request, factory.getValue())
          request.onsuccess?.(new Event('success'))
        })
        return request
      },
      put: (value: unknown) => {
        const request = createRequest<IDBValidKey>()
        factory.setValue(value)
        queueMicrotask(() => {
          transaction.oncomplete?.(new Event('complete'))
        })
        return request
      },
      delete: () => {
        const request = createRequest<undefined>()
        factory.deleteValue()
        queueMicrotask(() => {
          transaction.oncomplete?.(new Event('complete'))
        })
        return request
      },
    }) as unknown as IDBObjectStore,
  }
  return transaction as unknown as IDBTransaction
}

function createRequest<T>(): IDBRequest<T> {
  return {
    result: undefined as T,
    error: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBRequest<T>
}

function setRequestResult<T>(request: IDBRequest<T>, value: T): void {
  Object.defineProperty(request, 'result', { configurable: true, value })
}
