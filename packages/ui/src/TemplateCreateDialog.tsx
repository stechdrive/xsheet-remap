import { useMemo, useRef, useState } from 'react'
import { TEMPLATE_PAPER_FORMATS, templatePaperPixelSize, type TemplatePaperFormat, type TemplatePaperOrientation } from './templatePaper'

export type PaperTemplateCreateOptions = {
  name: string
  format: TemplatePaperFormat
  orientation: TemplatePaperOrientation
  ppi: number
  file: File | null
}

export type DigitalTemplateCreateOptions = {
  name: string
  fps: number
  durationFrames: number
  trackCount: number
}

export function TemplateCreateDialog({
  onClose,
  onCreatePaper,
  onCreateDigital,
  onDuplicateCurrent,
}: {
  onClose: () => void
  onCreatePaper: (options: PaperTemplateCreateOptions) => void | Promise<void>
  onCreateDigital: (options: DigitalTemplateCreateOptions) => void | Promise<void>
  onDuplicateCurrent: () => void | Promise<void>
}) {
  const [kind, setKind] = useState<'paper' | 'digital'>('paper')
  const [name, setName] = useState('新しい紙タイムシート')
  const [format, setFormat] = useState<TemplatePaperFormat>('A3')
  const [orientation, setOrientation] = useState<TemplatePaperOrientation>('portrait')
  const [ppi, setPpi] = useState(150)
  const [file, setFile] = useState<File | null>(null)
  const [fps, setFps] = useState(24)
  const [durationFrames, setDurationFrames] = useState(144)
  const [trackCount, setTrackCount] = useState(9)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const page = useMemo(() => templatePaperPixelSize(format, orientation, ppi), [format, orientation, ppi])

  async function submit(action: () => void | Promise<void>) {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      await action()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="assetQuickPreviewBackdrop templateCreateBackdrop" role="dialog" aria-modal="true" aria-label="新しいテンプレート" aria-busy={submitting} onPointerDown={() => { if (!submittingRef.current) onClose() }}>
      <div className="templateCreateDialog" onPointerDown={event => event.stopPropagation()}>
        <div className="templateCreateKindTabs" role="tablist" aria-label="テンプレート種別">
          <button type="button" role="tab" disabled={submitting} aria-selected={kind === 'paper'} className={kind === 'paper' ? 'active' : ''} onClick={() => { setKind('paper'); setName('新しい紙タイムシート') }}>紙タイムシート</button>
          <button type="button" role="tab" disabled={submitting} aria-selected={kind === 'digital'} className={kind === 'digital' ? 'active' : ''} onClick={() => { setKind('digital'); setName('新しいデジタルタイムシート') }}>デジタルタイムシート</button>
        </div>
        <fieldset disabled={submitting}>
          <label>名前<input value={name} onChange={event => setName(event.currentTarget.value)} /></label>
          {kind === 'paper' ? (
            <>
              <div className="templateCreateFields">
                <label>用紙サイズ<select value={format} onChange={event => setFormat(event.currentTarget.value as TemplatePaperFormat)}>{Object.keys(TEMPLATE_PAPER_FORMATS).map(value => <option key={value}>{value}</option>)}</select></label>
                <label>向き<select value={orientation} onChange={event => setOrientation(event.currentTarget.value as TemplatePaperOrientation)}><option value="portrait">縦</option><option value="landscape">横</option></select></label>
                <label>PPI<input type="number" min="1" value={ppi} onChange={event => setPpi(Math.max(1, Number(event.currentTarget.value)))} /></label>
              </div>
              <output className="templateCreatePixelSize">{page.widthPx} × {page.heightPx}px</output>
              <label>参照画像（任意）<input type="file" accept="image/*" onChange={event => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
              <p className="muted">同一PPIの画像は拡大縮小せず、整数pxで中央配置して余剰だけをトリムします。</p>
            </>
          ) : (
            <div className="templateCreateFields">
              <label>FPS<input type="number" min="1" value={fps} onChange={event => setFps(Math.max(1, Number(event.currentTarget.value)))} /></label>
              <label>初期フレーム数<input type="number" min="1" value={durationFrames} onChange={event => setDurationFrames(Math.max(1, Number(event.currentTarget.value)))} /></label>
              <label>セル列数（ACTION/CELL共通）<input type="number" min="1" value={trackCount} onChange={event => setTrackCount(Math.max(1, Number(event.currentTarget.value)))} /></label>
            </div>
          )}
        </fieldset>
        <div className="toolRow templateCreateActions">
          <button type="button" disabled={submitting} onClick={onClose}>キャンセル</button>
          <button type="button" disabled={submitting} onClick={() => void submit(onDuplicateCurrent)}>現在から複製</button>
          <button type="button" className="primary" disabled={submitting} onClick={() => void submit(() => kind === 'paper'
            ? onCreatePaper({ name: name.trim() || '紙タイムシート', format, orientation, ppi, file })
            : onCreateDigital({ name: name.trim() || 'デジタルタイムシート', fps, durationFrames, trackCount }))}>{submitting ? '作成中…' : '作成'}</button>
        </div>
      </div>
    </div>
  )
}
