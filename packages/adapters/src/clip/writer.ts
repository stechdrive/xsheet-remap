import type { SqlJsStatic } from 'sql.js'
import { createDocument, type EditOperation, type Pixels } from 'celcodec/document'
import { ClipError } from 'celcodec'
import { clipImagePlacement, validateClipCanvas, type ClipCanvasSettings, type ClipImageFit, type ClipRegistrationPlan } from '@xsheet-remap/core'
import { codecCall } from './material/celcodec'
import { clipSourceBytes } from './document-data'
import { canvasSettings, flattenLayers, openClipSession, sessionOptions } from './session'
import { documentEdits } from './document-writer'
import { registrationEdits } from './registration-writer'
import { check } from './binary'

export interface ClipWriteOptions {
  plan: ClipRegistrationPlan; canvas: ClipCanvasSettings; fit: ClipImageFit
  images: Record<string, Pixels>; template?: Uint8Array
}
export interface ClipWriteResult { bytes: Uint8Array; canvas: ClipCanvasSettings; layers: number; timelines: number }

export function writeClip(SQL: SqlJsStatic, seed: Uint8Array, options: ClipWriteOptions, progress: (message: string) => void = () => {}): Promise<ClipWriteResult> {
  return codecCall(async () => {
    const { plan } = options
    check(plan.timelines.length <= 1000 && (plan.document || plan.timelines.length > 0) && plan.folders.length <= 2000, 'カット・フォルダー数が範囲外です。')
    for (const time of plan.timelines) {
      check(Number.isFinite(time.fps) && time.fps >= 1 && time.fps <= 120 && Number.isInteger(time.duration) && time.duration > 0 && time.duration <= 1_000_000, 'タイムラインの範囲が不正です。')
    }
    const images = Object.values(options.images)
    if (!plan.document) check(new Set(images.map(image => `${image.width}x${image.height}`)).size <= 1, '登録画像の寸法を揃えてください。')
    for (const image of images) check(image.channels === 4 && Number.isInteger(image.width) && Number.isInteger(image.height)
      && image.width > 0 && image.height > 0 && image.width * image.height <= 100_000_000 && image.data.length === image.width * image.height * 4, '画像データの長さが不正です。')
    const original = plan.document?.source ? clipSourceBytes(plan.document.source.dataUrl) : plan.document ? undefined : options.template
    let settings = original ? inspectClip(SQL, original) : { ...options.canvas }
    const edits: EditOperation[] = []
    if (!plan.document) for (const image of images) {
      const placement = clipImagePlacement(settings, image, options.fit)
      settings = { ...settings, width: placement.width, height: placement.height }
    }
    validateClipCanvas(settings)
    progress('キャンバスを準備しています')
    const session = original ? openClipSession(SQL, original) : await createDocument(SQL, seed, settings, sessionOptions)
    try {
      if (original && (settings.width !== session.document.canvas.width || settings.height !== session.document.canvas.height))
        edits.push({ type: 'resizeCanvas', width: settings.width, height: settings.height, anchor: 'center' })
      edits.push(...await (plan.document ? documentEdits(session, options, settings, progress) : registrationEdits(session, options, settings, progress)))
      const editPlan = await session.planEdits(edits, edits.length ? { seed } : {})
      if (!editPlan.allowed) { const issue = editPlan.diagnostics[0]; throw new ClipError(issue.code, issue.data) }
      const saved = await session.save(editPlan)
      const result = openClipSession(SQL, saved.bytes)
      try { return { bytes: saved.bytes, canvas: canvasSettings(result), layers: flattenLayers(result.document.layers).length + 1, timelines: result.document.timelines.length } }
      finally { result.dispose() }
    } finally { session.dispose() }
  })
}
export function inspectClip(SQL: SqlJsStatic, bytes: Uint8Array): ClipCanvasSettings {
  return codecCall(() => { const session = openClipSession(SQL, bytes); try { return canvasSettings(session) } finally { session.dispose() } })
}
