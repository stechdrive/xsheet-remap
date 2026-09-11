import CanvasKitInit, { type CanvasKit, type TypefaceFontProvider } from 'canvaskit-wasm'
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url'
import { fontRangeIncludes, type SceneText } from './canvasKitScene'

export type CanvasKitRuntime = { kit: CanvasKit; fonts: CanvasKitFonts }
let runtime: Promise<CanvasKitRuntime> | null = null

export function loadCanvasKit(): Promise<CanvasKitRuntime> {
  // Own network errors here: Emscripten's internal fetch fallback can also reject an unobserved promise.
  runtime ??= fetch(wasmUrl).then(async response => {
    if (!response.ok) throw new Error(`Paper runtime HTTP ${response.status}`)
    const options = { locateFile: () => wasmUrl, wasmBinary: await response.arrayBuffer() }
    const kit = await CanvasKitInit(options)
    return { kit, fonts: new CanvasKitFonts(kit) }
  })
    .catch(error => { runtime = null; throw error })
  return runtime
}

type Face = { url: string; range: string; weight: number; alias: string }

/** Share the existing, content-cached font subsets with Skia; never request a CDN. */
export class CanvasKitFonts {
  readonly provider: TypefaceFontProvider
  private faces: Face[] | null = null
  private loaded = new Map<string, Face>()
  private pending = new Map<string, Promise<void>>()
  private familyCache = new Map<number, string[]>()
  private coverage = new Map<number, boolean>()
  constructor(private kit: CanvasKit) { this.provider = kit.TypefaceFontProvider.Make() }

  async ensure(texts: readonly SceneText[]): Promise<void> {
    this.faces ??= fontFaces()
    const requests = new Map<number, Set<number>>()
    for (const text of texts) {
      const weight = text.weight >= 750 ? 800 : text.weight >= 550 ? 700 : 400
      const codes = requests.get(weight) ?? new Set<number>()
      for (const char of text.value) codes.add(char.codePointAt(0)!)
      requests.set(weight, codes)
    }
    const needed = this.faces.filter(face => {
      const codes = requests.get(face.weight)
      return codes && [...codes].some(code => fontRangeIncludes(face.range, code))
    })
    if (texts.length && !this.faces.length) throw new Error('Paper fonts are unavailable')
    await Promise.all(needed.map(face => this.load(face)))
  }

  families(weight: number): string[] {
    let families = this.familyCache.get(weight)
    if (!families) {
      families = [...this.loaded.values()].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight)).map(face => face.alias)
      this.familyCache.set(weight, families)
    }
    return families
  }

  supports(text: SceneText): boolean {
    return [...text.value].every(char => {
      const code = char.codePointAt(0)!
      if (/\s/u.test(char) || (code >= 0x200b && code <= 0x200f) || (code >= 0xfe00 && code <= 0xfe0f)) return true
      let supported = this.coverage.get(code)
      if (supported === undefined) {
        supported = [...this.loaded.values()].some(face => fontRangeIncludes(face.range, code))
        this.coverage.set(code, supported)
      }
      return supported
    })
  }

  private load(face: Face): Promise<void> {
    if (this.loaded.has(face.url)) return Promise.resolve()
    const existing = this.pending.get(face.url)
    if (existing) return existing
    const promise = fetch(face.url).then(async response => {
      if (!response.ok) throw new Error(`Paper font HTTP ${response.status}`)
      const bytes = await response.arrayBuffer()
      const probe = this.kit.Typeface.MakeFreeTypeFaceFromData(bytes)
      if (!probe) throw new Error('CanvasKit could not decode a paper font')
      probe.delete()
      this.provider.registerFont(bytes, face.alias)
      this.loaded.set(face.url, face)
      this.familyCache.clear(); this.coverage.clear()
    }).finally(() => this.pending.delete(face.url))
    this.pending.set(face.url, promise)
    return promise
  }
}

function fontFaces(): Face[] {
  const faces = new Map<string, Face>()
  function visit(sheet: CSSStyleSheet) {
    let rules: CSSRuleList
    try { rules = sheet.cssRules } catch { return }
    for (const rule of rules) {
      if (rule instanceof CSSImportRule && rule.styleSheet) visit(rule.styleSheet)
      if (!(rule instanceof CSSFontFaceRule)) continue
      if (!rule.style.getPropertyValue('font-family').includes('LINE Seed JP')) continue
      const source = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)/)?.[1]
      if (!source) continue
      const url = new URL(source, sheet.href || document.baseURI).href
      if (!faces.has(url)) faces.set(url, {
        url, range: rule.style.getPropertyValue('unicode-range') || 'U+0-10FFFF',
        weight: Number(rule.style.getPropertyValue('font-weight')) || 400,
        alias: `paper-subset-${faces.size}`,
      })
    }
  }
  for (const sheet of document.styleSheets) visit(sheet)
  return [...faces.values()]
}
