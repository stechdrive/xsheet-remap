import { useEffect, useMemo, useRef, useState } from 'react'
import { buildClipRegistrationPlan, clipImagePlacement, validateClipCanvas, type ClipCanvasSettings, type ClipImageFit, type ClipRegistrationPlan, type CutGroupProjectDocument } from '@xsheet-remap/core'
import { generateClipFile, inspectClipFile, saveBinaryFile, type ClipImagePixels } from '@xsheet-remap/adapters'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'
import { loadClipImages } from './clipExportImages'
import { withDialogueAudioPlan } from './clipAudioExportPlan'
const defaults: ClipCanvasSettings = { width: 1754, height: 1240, dpi: 150, basisWidth: 1536, basisHeight: 864, offsetX: 0, offsetY: 0 }
const presetKey = 'xsheet:clip-canvas-preset:v1'
function rememberedCanvas(): ClipCanvasSettings {
  try { const value = JSON.parse(localStorage.getItem(presetKey) ?? 'null'); validateClipCanvas(value); return value } catch { return defaults }
}
export function ClipExportDialog({ document, initialRole, onClose, onSaved, onCanvasSaved }: {
  document: CutGroupProjectDocument; initialRole: 'action' | 'cell'; onClose: () => void; onSaved: (message: string) => void; onCanvasSaved?: (canvas: ClipCanvasSettings) => void
}) {
  const [role, setRole] = useState(initialRole), [canvas, setCanvas] = useState(() => document.clipDocument?.canvas ?? rememberedCanvas())
  const [template, setTemplate] = useState<{ name: string; bytes: Uint8Array; canvas: ClipCanvasSettings } | null>(null)
  const [source, setSource] = useState<'new' | 'template'>('new'), [fit, setFit] = useState<ClipImageFit>('expand')
  const [withImages, setWithImages] = useState(true), [cutIds, setCutIds] = useState(() => document.cuts.map(cut => cut.cutId))
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [loaded, setLoaded] = useState<{ plan: ClipRegistrationPlan | null; images: Record<string, ClipImagePixels>; error: string }>({ plan: null, images: {}, error: '' })
  const operation = useRef<AbortController | null>(null)
  const close = () => { operation.current?.abort(); onClose() }
  const dialog = useModalDialogKeyboardBoundary<HTMLDivElement>(close)
  useEffect(() => () => operation.current?.abort(), [])
  const planned = useMemo(() => {
    try { return { plan: withDialogueAudioPlan(document, buildClipRegistrationPlan(document, role, cutIds)), error: '' } } catch (error) { return { plan: null, error: error instanceof Error ? error.message : String(error) } }
  }, [document, role, cutIds])
  const layerWorkspace = Boolean(document.clipDocument)
  const hasAssignedImages = layerWorkspace ? Boolean(document.clipDocument?.nodes.some(node => node.sourceLayerId === undefined && (node.assetId || node.imageDataUrl))) : Boolean(planned.plan?.folders.some(folder => folder.cels.some(cel => cel.assetId)))
  const registerImages = withImages && hasAssignedImages
  useEffect(() => {
    const controller = new AbortController()
    const plan = planned.plan
    if (!registerImages || !plan) return
    void loadClipImages(document, plan, controller.signal).then(images => {
      if (controller.signal.aborted) return
      if (!layerWorkspace && new Set(Object.values(images).map(image => `${image.width}x${image.height}`)).size > 1) throw new Error('登録画像のピクセル寸法を揃えてください。')
      setLoaded({ plan, images, error: '' })
    }).catch(error => { if (!controller.signal.aborted) setLoaded({ plan, images: {}, error: String(error) }) })
    return () => controller.abort()
  }, [document, planned.plan, registerImages, layerWorkspace])
  const images = registerImages && loaded.plan === planned.plan ? loaded.images : {}
  const imageState = { loading: registerImages && loaded.plan !== planned.plan, error: registerImages && loaded.plan === planned.plan ? loaded.error : '' }
  const imageSize = Object.values(images)[0]
  const chosen = document.clipDocument?.source ? document.clipDocument.canvas : source === 'template' ? template?.canvas : canvas
  const placement = !layerWorkspace && chosen && imageSize ? clipImagePlacement(chosen, imageSize, fit) : null
  let canvasError = ''
  try { if (chosen) { validateClipCanvas(chosen); if (placement) validateClipCanvas({ ...chosen, width: placement.width, height: placement.height }) } } catch (error) { canvasError = error instanceof Error ? error.message : String(error) }
  async function chooseTemplate(file?: File) {
    if (!file) return
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller
    setTemplate(null); setBusy(true); setError(''); setMessage('テンプレートを確認しています…')
    try {
      if (file.size > 512 * 1024 * 1024) throw new Error('テンプレートCLIPは512MB以内にしてください。')
      const bytes = new Uint8Array(await file.arrayBuffer()), canvas = await inspectClipFile(bytes, controller.signal)
      controller.signal.throwIfAborted(); setTemplate({ name: file.name, bytes, canvas }); setMessage('')
    } catch (error) { if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : String(error)); setMessage('') } }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function generate() {
    if (!planned.plan || !chosen || operation.current && busy) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setMessage('登録画像を確認しています…')
    try {
      validateClipCanvas(chosen)
      const result = await generateClipFile({ plan: planned.plan, canvas: chosen, fit: layerWorkspace ? 'crop' : fit, images: withImages ? images : {}, ...(source === 'template' && template ? { template: template.bytes } : {}) }, setMessage, controller.signal)
      controller.signal.throwIfAborted(); setMessage('CLIPを保存しています…')
      const base = Array.from(planned.plan.timelines[0]?.name || 'xsheet-remap').map(character => (character.codePointAt(0) ?? 0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')
      const saved = await saveBinaryFile(result.bytes, `${base}_remap.clip`, 'application/octet-stream', { filterName: 'CLIP STUDIO FORMAT', extensions: ['clip'], defaultExtension: 'clip' })
      if (saved.saved) { onCanvasSaved?.(result.canvas); onSaved(`CLIPを保存しました。${result.timelines}タイムライン / ${result.canvas.width} × ${result.canvas.height}px`); onClose() }
      else setMessage('保存をキャンセルしました。')
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label="CLIPを作成" ref={dialog}>
    <section className="timingExportDialog clipExportDialog">
      <header><strong>CLIPを作成</strong><button type="button" aria-label="閉じる" onClick={close}>×</button></header>
      <div className="timingExportDialogBody">
        <fieldset disabled={busy || Boolean(document.clipDocument?.source)}><legend>キャンバス</legend>{document.clipDocument?.source && <p>{document.clipDocument.source.fileName} のレイヤー構造・画像・未編集のタイムラインを保持します。</p>}{!layerWorkspace && <div className="segmented">
          <button type="button" aria-pressed={source === 'new'} onClick={() => setSource('new')}>設定から新規作成</button>
          <button type="button" aria-pressed={source === 'template'} onClick={() => setSource('template')}>テンプレートCLIPを使用</button>
        </div>}
        {source === 'template' ? <label className="clipTemplatePicker">テンプレートCLIP<input type="file" accept=".clip" onChange={event => void chooseTemplate(event.target.files?.[0])} />{template && <span>{template.name} — {template.canvas.width} × {template.canvas.height}px / {template.canvas.dpi}dpi</span>}</label>
          : <>{([
            ['作画サイズ（用紙サイズ）', [['width', '幅（px）'], ['height', '高さ（px）']]],
            ['基準サイズ（撮影フレーム）', [['basisWidth', '幅（px）'], ['basisHeight', '高さ（px）']]],
            ['オフセット（中央基準）', [['offsetX', '横 X（px）'], ['offsetY', '縦 Y（px）']]],
          ] as const).map(([group, fields]) => <fieldset key={group}><legend>{group}</legend><div className="clipCanvasFields">{fields.map(([key, label]) => {
            const limit = key === 'offsetX' ? Math.floor((canvas.width - canvas.basisWidth) / 2) : key === 'offsetY' ? Math.floor((canvas.height - canvas.basisHeight) / 2) : null
            return <label key={key}>{label}<input aria-label={`${group} ${label}`} type="number" step="1" min={limit === null ? 1 : -Math.max(0, limit)} max={limit === null ? 30000 : Math.max(0, limit)} value={canvas[key]} onChange={event => setCanvas({ ...canvas, [key]: Number(event.target.value) })} /></label>
          })}</div></fieldset>)}
            <label>DPI<input type="number" min="1" max="1200" value={canvas.dpi} onChange={event => setCanvas({ ...canvas, dpi: Number(event.target.value) })} /></label>
            {canvasError && <p role="alert" className="issue error">{canvasError}</p>}
            <button type="button" onClick={() => { try { validateClipCanvas(canvas); localStorage.setItem(presetKey, JSON.stringify(canvas)); setMessage('新規作成の設定を保存しました。') } catch (error) { setError(String(error)) } }}>この設定を次回も使う</button></>}
        </fieldset>
        <fieldset disabled={busy}><legend>登録するタイムライン</legend><div className="segmented">
          {(['action', 'cell'] as const).map(value => <button type="button" key={value} aria-pressed={role === value} onClick={() => setRole(value)}>{value.toUpperCase()}</button>)}
        </div>
          {document.cuts.map(cut => { const timeline = planned.plan?.timelines.find(item => item.id === cut.cutId); return <label className="clipCutChoice" key={cut.cutId}><input type="checkbox" checked={cutIds.includes(cut.cutId)} onChange={event => setCutIds(event.target.checked ? [...cutIds, cut.cutId] : cutIds.filter(id => id !== cut.cutId))} />{timeline?.name || cut.metadata.cut || cut.cutId}{timeline && <span>{timeline.fps}fps / {timeline.duration}フレーム</span>}</label> })}
          <p>FPS・デュレーションは各カットのシート設定を使用します。</p>
        </fieldset>
        {hasAssignedImages && !layerWorkspace && <fieldset disabled={busy}><legend>登録画像</legend>
          <label><input type="checkbox" checked={withImages} onChange={event => setWithImages(event.target.checked)} />画像も登録する</label>
          {withImages && <><label><input type="checkbox" checked={fit === 'expand'} onChange={event => setFit(event.target.checked ? 'expand' : 'crop')} />キャンバスサイズを自動拡張</label>
            <p>{fit === 'expand' ? '大きい画像に合わせて、中央を基準にキャンバスを広げます。' : 'キャンバスサイズを固定し、中央配置した画像のはみ出した部分を切り捨てます。'}</p></>}
          {placement && chosen && (placement.width !== chosen.width || placement.height !== chosen.height) && <p>出力サイズ：{chosen.width} × {chosen.height} → {placement.width} × {placement.height}px</p>}
          {placement && (placement.cropLeft + placement.cropRight + placement.cropTop + placement.cropBottom > 0) && <p>切り捨て：左{placement.cropLeft}・右{placement.cropRight}・上{placement.cropTop}・下{placement.cropBottom}px</p>}
        </fieldset>}
        {source === 'template' && canvasError && <p role="alert" className="issue error">{canvasError}</p>}
        {layerWorkspace && <p>画像はキャンバスの中央へ配置します。範囲外は切り捨てるため、必要な用紙サイズを指定してください。</p>}
        {planned.plan && !layerWorkspace && <details><summary>生成するレイヤー構造（{planned.plan.folders.length}フォルダー）</summary><ul>{planned.plan.folders.map(folder => <li key={folder.id}>xsheet-remap / {[...folder.path, folder.name].join(' / ')} — {folder.cels.length}セル</li>)}</ul></details>}
        {imageState.loading && <p role="status">登録画像の寸法を確認しています…</p>}
        {(error || planned.error || imageState.error) && <p role="alert" className="issue error">{error || planned.error || imageState.error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
      <footer><button type="button" onClick={close}>{busy ? '中止' : 'キャンセル'}</button><button type="button" className="primary" disabled={busy || imageState.loading || Boolean(imageState.error || canvasError) || !planned.plan || !chosen} onClick={() => void generate()}>CLIPを作成して保存…</button></footer>
    </section>
  </div>
}
