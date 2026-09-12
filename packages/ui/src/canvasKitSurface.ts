import type { GrDirectContext, SkPicture, Surface, WebGLContextHandle } from 'canvaskit-wasm'
import { CanvasKitImages } from './canvasKitImages'
import { paintCanvasKitPicture, recordCanvasKitScene } from './canvasKitPainter'
import { loadCanvasKit, type CanvasKitRuntime } from './canvasKitRuntime'
import { captureSvgScene } from './canvasKitSvgScene'
import { CanvasKitSceneCache } from './canvasKitSceneCache'
import { CanvasKitPictureCache } from './canvasKitPictureCache'
import { registerPaperGpu, unregisterPaperGpu } from './canvasKitResourceBudget'
import { intersectSceneRects, sceneTextRequests, type SceneRect } from './canvasKitScene'
import { planPaperViewport, type PaperViewportPlan } from './canvasKitViewport'
import { notifyPaperModel } from './canvasKitDirectModel'

/** One bounded retained slice per semantic surface. No full-page Retina backing allocation. */
export class CanvasKitPaperSurface {
  private canvas: HTMLCanvasElement
  private surface: Surface | null = null
  private gpu: GrDirectContext | null = null
  private context: WebGLContextHandle | null = null
  private picture: SkPicture | null = null
  private images: CanvasKitImages | null = null
  private runtime: CanvasKitRuntime | null = null
  private frame: number | null = null
  private dirty = true
  private busy = false
  private disposed = false
  private failed = false
  private contextLost = false
  private width = 0
  private height = 0
  private observer: MutationObserver
  private resize: ResizeObserver
  private intersection: IntersectionObserver
  private hoverTarget: EventTarget | null = null
  private sceneCache: CanvasKitSceneCache
  private pictureCache = new CanvasKitPictureCache()
  private viewportPlan: PaperViewportPlan | null = null

  constructor(private source: SVGSVGElement) {
    this.sceneCache = new CanvasKitSceneCache(source)
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'canvasKitPaperCanvas'
    this.canvas.setAttribute('aria-hidden', 'true')
    this.canvas.width = this.canvas.height = 1
    source.after(this.canvas)
    this.observer = new MutationObserver(records => {
      const content = records.filter(record => !record.attributeName?.startsWith('data-canvaskit'))
      if (content.length) {
        if (content.some(record => record.attributeName === 'data-paper-model-mode')) notifyPaperModel(source)
        this.sceneCache.invalidate(content)
        this.dirty = true
        this.failed = false
        this.invalidate()
      }
    })
    this.observer.observe(source, { attributes: true, childList: true, characterData: true, subtree: true })
    this.resize = new ResizeObserver(() => this.invalidate(true))
    this.resize.observe(source)
    this.intersection = new IntersectionObserver(() => this.invalidate(), { rootMargin: '64px' })
    this.intersection.observe(source)
    source.addEventListener('pointermove', this.onPointer)
    source.addEventListener('pointerleave', this.onPointer)
    this.canvas.addEventListener('webglcontextlost', this.onContextLost)
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    this.invalidate()
  }

  invalidate(content = false) {
    if (this.disposed) return
    if (content) { this.dirty = true; this.failed = false; this.sceneCache.clear() }
    if (this.failed || this.contextLost) return
    this.source.dataset.canvaskitState = 'pending'
    if (this.busy || this.frame !== null) return
    this.frame = requestAnimationFrame(() => { this.frame = null; void this.draw() })
  }

  private onPointer = (event: PointerEvent) => {
    const target = event.type === 'pointerleave' || !(event.target instanceof Element) ? null
      : event.target.closest('.soundCue, .cameraCue, .cameraCueLabel, .sheetTransformHandle')
    if (target === this.hoverTarget) return
    this.hoverTarget = target
    // Native :hover paint styles are not DOM mutations.
    this.invalidate(true)
  }
  private onContextLost = (event: Event) => {
    event.preventDefault()
    this.contextLost = true
    if (this.frame !== null) { cancelAnimationFrame(this.frame); this.frame = null }
    this.restoreSource('context-lost')
    this.surface?.delete(); this.surface = null
    if (this.gpu) { unregisterPaperGpu(this.gpu); this.gpu.releaseResourcesAndAbandonContext(); this.gpu.delete(); this.gpu = null }
    if (this.context !== null && this.runtime) this.runtime.kit.deleteContext(this.context)
    this.context = null
  }
  private onContextRestored = () => { this.contextLost = false; this.invalidate(true) }

  private async draw() {
    if (this.disposed || this.busy) return
    let bounds = this.source.getBoundingClientRect()
    let visible = visiblePaperRect(this.source, bounds)
    if (!visible || document.hidden) { this.release(); return }
    this.busy = true
    try {
      const loading = !this.runtime
      this.runtime ??= await loadCanvasKit()
      if (this.disposed || this.contextLost) return
      const { kit, fonts } = this.runtime
      let pictureChanged = false
      if (this.dirty || !this.picture) {
        this.dirty = false
        const started = performance.now()
        const scene = captureSvgScene(this.source, this.sceneCache)
        this.source.dataset.canvaskitCaptureMs = (performance.now() - started).toFixed(2)
        this.images ??= new CanvasKitImages(kit)
        await Promise.all([fonts.ensure(sceneTextRequests(scene)), this.images.ensure(scene)])
        if (this.disposed || this.contextLost) return
        const recordingStarted = performance.now()
        const picture = recordCanvasKitScene(kit, fonts, this.images, scene, this.pictureCache)
        this.source.dataset.canvaskitRecordMs = (performance.now() - recordingStarted).toFixed(2)
        this.source.dataset.canvaskitCapturedNodes = String(this.sceneCache.capturedNodes)
        this.source.dataset.canvaskitReusedPictures = String(this.pictureCache.reusedPictures)
        this.source.dataset.canvaskitRecordedPictures = String(this.pictureCache.recordedPictures)
        this.source.dataset.canvaskitPictureBytes = String(this.pictureCache.retainedBytes)
        this.source.dataset.canvaskitParagraphs = String(this.pictureCache.paragraphs.size)
        this.source.dataset.canvaskitShapedParagraphs = String(this.pictureCache.paragraphs.built)
        this.source.dataset.canvaskitReusedParagraphs = String(this.pictureCache.paragraphs.reused)
        this.source.dataset.canvaskitImageBytes = String(this.images.imageBytes)
        this.source.dataset.canvaskitSourceBytes = String(this.images.sourceBytes)
        this.picture?.delete(); this.picture = picture
        pictureChanged = true
        this.width = scene.width; this.height = scene.height
        this.source.dataset.canvaskitSceneBuilds = String(Number(this.source.dataset.canvaskitSceneBuilds ?? 0) + 1)
      }
      // Re-measure only after asynchronous resource work, which may span several frames.
      if (loading || pictureChanged) {
        bounds = this.source.getBoundingClientRect()
        visible = visiblePaperRect(this.source, bounds)
      }
      if (!visible || !this.picture) { this.release(); return }
      const scaleX = bounds.width / this.width, scaleY = bounds.height / this.height
      const plan = planPaperViewport({
        x: (visible.x - bounds.left) / scaleX, y: (visible.y - bounds.top) / scaleY,
        width: visible.width / scaleX, height: visible.height / scaleY,
      }, this.width, this.height, scaleX, scaleY, window.devicePixelRatio || 1, this.viewportPlan,
      !!this.source.closest('[data-touch-pinch-preview="true"], [data-paper-transform-preview="true"]'))
      const retainedVisible = { x: bounds.left + plan.rect.x * scaleX, y: bounds.top + plan.rect.y * scaleY,
        width: plan.rect.width * scaleX, height: plan.rect.height * scaleY }
      if (plan === this.viewportPlan && !pictureChanged && this.surface) {
        positionPaperCanvas(this.canvas, this.source, retainedVisible)
        this.source.dataset.canvaskitState = this.dirty ? 'pending' : 'active'
        this.source.dataset.canvaskitRetainedFrames = String(Number(this.source.dataset.canvaskitRetainedFrames ?? 0) + 1)
        return
      }
      const { ratio, backingWidth, backingHeight } = plan
      if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
        // WebKit can retain an obsolete front buffer even with a new SkSurface/GrContext.
        // Keep a fresh presentation target on real resizes; zoom previews retain the old raster.
        this.resetGraphics()
        this.canvas.width = backingWidth; this.canvas.height = backingHeight
        this.source.dataset.canvaskitResizes = String(Number(this.source.dataset.canvaskitResizes ?? 0) + 1)
      }
      if (!this.surface) {
        if (!this.gpu) {
          // Paper redraws only on changes. WebKit must retain the last frame while idle.
          if (!this.context) {
            this.context = kit.GetWebGLContext(this.canvas, { alpha: 1, antialias: 0, preserveDrawingBuffer: 1 }) || null
            this.source.dataset.canvaskitContexts = String(Number(this.source.dataset.canvaskitContexts ?? 0) + 1)
          }
          this.gpu = this.context ? kit.MakeGrContext(this.context) : null
          if (this.gpu) registerPaperGpu(this.gpu, this.source)
        }
        this.surface = this.gpu ? kit.MakeOnScreenGLSurface(this.gpu, backingWidth, backingHeight, kit.ColorSpace.SRGB) : null
        if (!this.surface) throw new Error('GPU paper surface is unavailable')
      }
      positionPaperCanvas(this.canvas, this.source, retainedVisible)
      paintCanvasKitPicture(kit, this.surface.getCanvas(), this.picture,
        -plan.rect.x * plan.scaleX, -plan.rect.y * plan.scaleY, plan.scaleX, plan.scaleY, ratio)
      this.surface.flush()
      this.viewportPlan = plan
      this.source.dataset.canvaskitReady = 'true'
      notifyPaperModel(this.source)
      this.source.dataset.canvaskitState = this.dirty ? 'pending' : 'active'
      this.canvas.hidden = false
      this.canvas.dataset.canvasKitDraws = String(Number(this.canvas.dataset.canvasKitDraws ?? 0) + 1)
    } catch (error) {
      if (this.contextLost) return
      this.failed = true
      this.release()
      this.restoreSource('fallback')
      console.warn('[paper-renderer] CanvasKit unavailable; retaining the interactive paper surface.', error)
    } finally {
      this.busy = false
      if (this.disposed) this.release()
      else if (this.dirty && !this.failed) this.invalidate()
    }
  }

  private restoreSource(state: string) {
    delete this.source.dataset.canvaskitReady
    notifyPaperModel(this.source)
    this.source.dataset.canvaskitState = state
    this.canvas.hidden = true
  }
  private release() {
    this.restoreSource('suspended')
    this.resetGraphics()
    this.picture?.delete(); this.picture = null
    this.pictureCache.clear(); this.sceneCache.clear()
    this.viewportPlan = null
    this.images?.dispose(); this.images = null
    for (const field of ['canvaskitPictureBytes', 'canvaskitParagraphs', 'canvaskitImageBytes', 'canvaskitSourceBytes']) this.source.dataset[field] = '0'
    this.canvas.width = this.canvas.height = 1
    this.dirty = true
  }
  private resetGraphics() {
    this.surface?.delete(); this.surface = null
    if (this.gpu) { unregisterPaperGpu(this.gpu); this.gpu.delete(); this.gpu = null }
    if (this.context !== null && this.runtime) {
      this.runtime.kit.deleteContext(this.context)
      // A suspended page must not consume a browser WebGL context slot.
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
      this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
      const context = this.canvas.getContext('webgl2') ?? this.canvas.getContext('webgl')
      context?.getExtension('WEBGL_lose_context')?.loseContext()
      const replacement = this.canvas.cloneNode(false) as HTMLCanvasElement
      replacement.width = replacement.height = 1
      this.canvas.replaceWith(replacement)
      this.canvas = replacement
      this.canvas.addEventListener('webglcontextlost', this.onContextLost)
      this.canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    }
    this.context = null
  }
  dispose() {
    this.disposed = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.observer.disconnect(); this.resize.disconnect(); this.intersection.disconnect()
    this.source.removeEventListener('pointermove', this.onPointer)
    this.source.removeEventListener('pointerleave', this.onPointer)
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.release(); this.canvas.remove()
  }
}

export function visiblePaperRect(source: SVGSVGElement, bounds = source.getBoundingClientRect()): SceneRect | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null
  let rect: SceneRect | null = intersectSceneRects(
    { x: bounds.left - 4, y: bounds.top - 4, width: bounds.width + 8, height: bounds.height + 8 },
    { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
  )
  for (let parent = source.parentElement; parent && rect; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    if (style.display === 'none' || style.visibility === 'hidden') return null
    const clipX = /auto|scroll|hidden|clip/.test(style.overflowX)
    const clipY = /auto|scroll|hidden|clip/.test(style.overflowY)
    if (!clipX && !clipY) continue
    const b = parent.getBoundingClientRect()
    rect = intersectSceneRects(rect, {
      x: clipX ? b.left : rect.x, y: clipY ? b.top : rect.y,
      width: clipX ? b.width : rect.width, height: clipY ? b.height : rect.height,
    })
  }
  return rect
}

function positionPaperCanvas(canvas: HTMLCanvasElement, source: SVGSVGElement, visible: SceneRect) {
  const parent = (canvas.offsetParent ?? source.parentElement) as HTMLElement
  const bounds = parent.getBoundingClientRect()
  const scaleX = bounds.width / Math.max(1, parent.offsetWidth)
  const scaleY = bounds.height / Math.max(1, parent.offsetHeight)
  const style = {
    left: `${(visible.x - bounds.left) / scaleX + parent.scrollLeft - parent.clientLeft}px`,
    top: `${(visible.y - bounds.top) / scaleY + parent.scrollTop - parent.clientTop}px`,
    width: `${visible.width / scaleX}px`, height: `${visible.height / scaleY}px`,
    zIndex: getComputedStyle(source).zIndex,
  }
  for (const [name, value] of Object.entries(style)) {
    const property = name as 'left' | 'top' | 'width' | 'height' | 'zIndex'
    if (canvas.style[property] !== value) canvas.style[property] = value
  }
}
