import { useEffect, useMemo, useRef, useState } from 'react'
import { buildClipRegistrationPlan, clipImagePlacement, validateClipCanvas, type ClipCanvasSettings, type ClipImageFit, type ClipRegistrationPlan, type CutGroupProjectDocument } from '@xsheet-remap/core'
import { generateClipFile, inspectClipFile, saveBinaryFile, type ClipImagePixels } from '@xsheet-remap/adapters'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'
import { loadClipImages } from './clipExportImages'
const defaults: ClipCanvasSettings = { width: 1754, height: 1240, dpi: 150, basisWidth: 1536, basisHeight: 864, offsetX: 0, offsetY: 0 }
const presetKey = 'xsheet:clip-canvas-preset:v1'
function rememberedCanvas(): ClipCanvasSettings {
  try { const value = JSON.parse(localStorage.getItem(presetKey) ?? 'null'); validateClipCanvas(value); return value } catch { return defaults }
}
export function ClipExportDialog({ document, initialRole, onClose, onSaved }: {
  document: CutGroupProjectDocument; initialRole: 'action' | 'cell'; onClose: () => void; onSaved: (message: string) => void
}) {
  const [role, setRole] = useState(initialRole), [canvas, setCanvas] = useState(rememberedCanvas)
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
    try { return { plan: buildClipRegistrationPlan(document, role, cutIds), error: '' } } catch (error) { return { plan: null, error: error instanceof Error ? error.message : String(error) } }
  }, [document, role, cutIds])
  useEffect(() => {
    const controller = new AbortController()
    const plan = planned.plan
    if (!withImages || !plan) return
    void loadClipImages(document, plan, controller.signal).then(images => {
      if (controller.signal.aborted) return
      if (new Set(Object.values(images).map(image => `${image.width}x${image.height}`)).size > 1) throw new Error('登録画像のピクセル寸法を揃えてください。')
      setLoaded({ plan, images, error: '' })
    }).catch(error => { if (!controller.signal.aborted) setLoaded({ plan, images: {}, error: String(error) }) })
    return () => controller.abort()
  }, [document, planned.plan, withImages])
  const images = withImages && loaded.plan === planned.plan ? loaded.images : {}
  const imageState = { loading: withImages && Boolean(planned.plan) && loaded.plan !== planned.plan, error: withImages && loaded.plan === planned.plan ? loaded.error : '' }
  const imageSize = Object.values(images)[0]
  const chosen = source === 'template' ? template?.canvas : canvas
  const placement = chosen && imageSize && withImages ? clipImagePlacement(chosen, imageSize, fit) : null
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
      const result = await generateClipFile({ plan: planned.plan, canvas: chosen, fit, images: withImages ? images : {}, ...(source === 'template' && template ? { template: template.bytes } : {}) }, setMessage, controller.signal)
      controller.signal.throwIfAborted(); setMessage('CLIPを保存しています…')
      const base = Array.from(planned.plan.timelines[0]?.name || 'xsheet-remap').map(character => (character.codePointAt(0) ?? 0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')
      const saved = await saveBinaryFile(result.bytes, `${base}_remap.clip`, 'application/octet-stream', { filterName: 'CLIP STUDIO FORMAT', extensions: ['clip'], defaultExtension: 'clip' })
      if (saved.saved) { onSaved(`CLIPを保存しました。${planned.plan.timelines.length}タイムライン / ${result.canvas.width} × ${result.canvas.height}px`); onClose() }
      else setMessage('保存をキャンセルしました。')
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label="CLIPを作成" ref={dialog}>
    <section className="timingExportDialog clipExportDialog">
      <header><strong>CLIPを作成</strong><button type="button" aria-label="閉じる" onClick={close}>×</button></header>
      <div className="timingExportDialogBody">
        <fieldset disabled={busy}><legend>作成元</legend><div className="segmented">
          <button type="button" aria-pressed={source === 'new'} onClick={() => setSource('new')}>設定から新規作成</button>
          <button type="button" aria-pressed={source === 'template'} onClick={() => setSource('template')}>テンプレートCLIPを使用</button>
        </div>
        {source === 'template' ? <label className="clipTemplatePicker">テンプレートCLIP<input type="file" accept=".clip" onChange={event => void chooseTemplate(event.target.files?.[0])} />{template && <span>{template.name} — {template.canvas.width} × {template.canvas.height}px / {template.canvas.dpi}dpi</span>}</label>
          : <><div className="clipCanvasFields">{([
            ['width', '作画サイズ 幅(px)'], ['height', '作画サイズ 高さ(px)'], ['dpi', 'DPI'], ['basisWidth', '基準フレーム 幅(px)'], ['basisHeight', '基準フレーム 高さ(px)'], ['offsetX', '基準フレーム X(px)'], ['offsetY', '基準フレーム Y(px)'],
          ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" step="1" value={canvas[key]} onChange={event => setCanvas({ ...canvas, [key]: Number(event.target.value) })} /></label>)}</div>
            <p>余白0。作画サイズをキャンバスサイズとして作成します。</p>
            <button type="button" onClick={() => { try { validateClipCanvas(canvas); localStorage.setItem(presetKey, JSON.stringify(canvas)); setMessage('新規作成の設定を保存しました。') } catch (error) { setError(String(error)) } }}>この設定を次回も使う</button></>}
        </fieldset>
        <fieldset disabled={busy}><legend>登録するタイムライン</legend><div className="segmented">
          {(['action', 'cell'] as const).map(value => <button type="button" key={value} aria-pressed={role === value} onClick={() => setRole(value)}>{value.toUpperCase()}</button>)}
        </div>
          {document.cuts.map(cut => { const timeline = planned.plan?.timelines.find(item => item.id === cut.cutId); return <label className="clipCutChoice" key={cut.cutId}><input type="checkbox" checked={cutIds.includes(cut.cutId)} onChange={event => setCutIds(event.target.checked ? [...cutIds, cut.cutId] : cutIds.filter(id => id !== cut.cutId))} />{timeline?.name || cut.metadata.cut || cut.cutId}{timeline && <span>{timeline.fps}fps / {timeline.duration}フレーム</span>}</label> })}
          <p>FPS・デュレーションは各カットのシート設定を使用します。</p>
        </fieldset>
        <fieldset disabled={busy}><legend>登録画像</legend>
          <label><input type="checkbox" checked={withImages} onChange={event => setWithImages(event.target.checked)} />割り当て済みの画像を登録する</label>
          <p>{withImages ? '画像未割り当てのセルは空セルとして作成します。' : 'セル名を持つ空セルとタイムラインを作成します。'}</p>
          <label>画像の収め方<select value={fit} disabled={!withImages} onChange={event => setFit(event.target.value as ClipImageFit)}>
            <option value="expand">画像全体を保持（必要な方向だけ拡張）</option><option value="crop">キャンバスサイズを固定（中央配置・はみ出しを切り取り）</option>
          </select></label>
          <p>画像は等倍で中央配置します。小さい画像でもキャンバスは縮めません。</p>
          {placement && <p>出力 {placement.width} × {placement.height}px／切り取り 左{placement.cropLeft}・右{placement.cropRight}・上{placement.cropTop}・下{placement.cropBottom}px</p>}
        </fieldset>
        {planned.plan && <details><summary>生成するレイヤー構造（{planned.plan.folders.length}フォルダー）</summary><ul>{planned.plan.folders.map(folder => <li key={folder.id}>xsheet-remap / {[...folder.path, folder.name].join(' / ')} — {folder.cels.length}セル</li>)}</ul></details>}
        {imageState.loading && <p role="status">登録画像の寸法を確認しています…</p>}
        {(error || planned.error || imageState.error) && <p role="alert" className="issue error">{error || planned.error || imageState.error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
      <footer><button type="button" onClick={close}>{busy ? '中止' : 'キャンセル'}</button><button type="button" className="primary" disabled={busy || imageState.loading || Boolean(imageState.error) || !planned.plan || !chosen} onClick={() => void generate()}>CLIPを作成して保存…</button></footer>
    </section>
  </div>
}
