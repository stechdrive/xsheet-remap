import type { Mat, KeyPointVector, ORB } from '@techstark/opencv-js'
import opencvScriptUrl from '@techstark/opencv-js/dist/opencv.js?url'

type BrowserOpenCv = typeof import('@techstark/opencv-js')
type BrowserOrb = ORB & {
  setMaxFeatures(n: number): void
  setNLevels(n: number): void
  setEdgeThreshold(n: number): void
  setFastThreshold(n: number): void
  detect(gray: Mat, points: KeyPointVector, mask: Mat): void
}

export type OpenCvRuntime = Omit<BrowserOpenCv, 'ORB'> & {
  ORB: new () => BrowserOrb
  onRuntimeInitialized?: () => void
}

let openCvPromise: Promise<{ cv: OpenCvRuntime }> | null = null

export async function loadOpenCv(): Promise<OpenCvRuntime> {
  if (!openCvPromise) {
    openCvPromise = loadOpenCvScript().catch(error => {
      openCvPromise = null
      throw error
    })
  }
  const loaded = await openCvPromise
  return loaded.cv
}

function loadOpenCvScript(): Promise<{ cv: OpenCvRuntime }> {
  const existing = globalOpenCvValue()
  if (existing) return resolveOpenCvModule(existing)
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-xsheet-opencv]')
    const script = existingScript ?? document.createElement('script')
    script.dataset.xsheetOpencv = 'true'
    script.async = true
    script.onload = () => {
      const loaded = globalOpenCvValue()
      if (!loaded) {
        script.remove()
        reject(new Error('OpenCV script loaded without a runtime'))
        return
      }
      resolveOpenCvModule(loaded).then(resolve, reject)
    }
    script.onerror = () => {
      script.remove()
      reject(new Error('OpenCV script failed to load'))
    }
    if (!existingScript) {
      script.src = opencvScriptUrl
      document.head.appendChild(script)
    }
  })
}

function resolveOpenCvModule(loaded: unknown): Promise<{ cv: OpenCvRuntime }> {
  if (isOpenCvRuntimeCandidate(loaded)) return waitForOpenCvRuntime(loaded)
  const then = isObjectRecord(loaded) ? loaded.then : undefined
  if (typeof then === 'function') {
    return new Promise((resolve, reject) => {
      try {
        then.call(
          loaded,
          (value: unknown) => {
            resolveOpenCvValue(value).then(resolve, reject)
          },
          (error: unknown) => reject(error),
        )
      } catch (error) {
        const fallback = isOpenCvRuntimeCandidate(loaded)
          ? loaded
          : globalOpenCvCandidate()
        if (fallback) {
          waitForOpenCvRuntime(fallback).then(resolve, reject)
        } else {
          reject(error)
        }
      }
    })
  }
  return resolveOpenCvValue(loaded)
}

function resolveOpenCvValue(value: unknown): Promise<{ cv: OpenCvRuntime }> {
  if (isOpenCvRuntimeCandidate(value)) return waitForOpenCvRuntime(value)
  const fallback = globalOpenCvCandidate()
  if (fallback) return waitForOpenCvRuntime(fallback)
  return Promise.reject(new Error('OpenCV runtime was not initialized'))
}

function waitForOpenCvRuntime(cv: OpenCvRuntime): Promise<{ cv: OpenCvRuntime }> {
  const runtime = cv as Partial<OpenCvRuntime>
  if (typeof runtime.Mat === 'function' && typeof runtime.imread === 'function') {
    return Promise.resolve({ cv: sanitizeOpenCvRuntime(cv) })
  }
  return new Promise(resolve => {
    const previous = cv.onRuntimeInitialized
    cv.onRuntimeInitialized = () => {
      previous?.()
      resolve({ cv: sanitizeOpenCvRuntime(cv) })
    }
  })
}

function isOpenCvRuntimeCandidate(value: unknown): value is OpenCvRuntime {
  if (!isObjectRecord(value)) return false
  return typeof value.Mat === 'function' ||
    typeof value.imread === 'function' ||
    'onRuntimeInitialized' in value
}

function globalOpenCvCandidate(): OpenCvRuntime | null {
  const value = globalOpenCvValue()
  return isOpenCvRuntimeCandidate(value) ? value : null
}

function globalOpenCvValue(): unknown {
  return (globalThis as typeof globalThis & { cv?: unknown }).cv
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
}

function sanitizeOpenCvRuntime(cv: OpenCvRuntime): OpenCvRuntime {
  const maybeThenable = cv as OpenCvRuntime & { then?: unknown }
  if ('then' in maybeThenable) {
    try {
      Object.defineProperty(maybeThenable, 'then', {
        value: undefined,
        configurable: true,
        writable: true,
      })
    } catch {
      try {
        delete maybeThenable.then
      } catch {
        const runtime = Object.create(cv) as OpenCvRuntime & { then?: unknown }
        Object.defineProperty(runtime, 'then', {
          value: undefined,
          configurable: true,
          writable: true,
        })
        return runtime
      }
    }
  }
  return cv
}
