import { useEffect, useState } from 'react'
import type { CutProject, PaperTranscriptionRun, PaperTranscriptionTarget, SheetTemplate } from '@xsheet-remap/core'
import { paperTranscriptionCrop, paperTranscriptionPagePng } from './paperTranscriptionImages'

export function PaperTranscriptionPreview({ project, template, urls, target, run }: {
  project: CutProject; template: SheetTemplate; urls: Record<string, string>
  target: PaperTranscriptionTarget; run?: PaperTranscriptionRun
}) {
  const [image, setImage] = useState<{ key: string; url: string } | null>(null)
  const [reference, setReference] = useState<{ name: string; url: string } | null>(null)
  const [error, setError] = useState('')
  const [wholePage, setWholePage] = useState(false)
  const pageId = target.pageId
  useEffect(() => {
    let cancelled = false, url: string | undefined
    void paperTranscriptionPagePng(project.sheetView, template, urls, pageId).then(bytes => {
      if (cancelled) return
      url = bytes ? URL.createObjectURL(new Blob([new Uint8Array(bytes)])) : undefined
      setImage(url ? { key: pageId, url } : null); setError('')
    }).catch(reason => { if (!cancelled) { setImage(null); setError(String(reason)) } })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [project.sheetView, template, urls, pageId]) // timing edits do not re-render the scan
  useEffect(() => {
    return () => { if (reference) URL.revokeObjectURL(reference.url) }
  }, [reference])
  const alignedUrl = image?.key === pageId ? image.url : null
  const crop = wholePage ? { x: 0, y: 0, w: 1, h: 1 } : paperTranscriptionCrop(target, run?.from, run?.to)
  const width = template.page.widthPx, height = template.page.heightPx
  const rowHeight = target.rect.h / (target.to - target.from + 1)
  const highlight = run ? {
    ...target.rect, y: target.rect.y + (run.from - target.from) * rowHeight,
    h: (run.to - run.from + 1) * rowHeight,
  } : target.rect
  return <aside className="paperAiPreview" aria-label="原画像との照合">
    <strong>{target.pageNumber}ページ / {target.label} {target.columnLabel}列</strong>
    <p>{run ? `${run.from}〜${run.to}` : `${target.from}〜${target.to}`} F</p>
    {alignedUrl ? <>
      <label><input type="checkbox" checked={wholePage} onChange={event => setWholePage(event.target.checked)} /> ページ全体を表示</label>
      <svg viewBox={`${crop.x * width} ${crop.y * height} ${crop.w * width} ${crop.h * height}`} aria-label="紙シートと選択範囲">
        <image href={alignedUrl} width={width} height={height} />
        <rect x={highlight.x * width} y={highlight.y * height} width={highlight.w * width} height={highlight.h * height} fill="none" stroke="#147daf" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </> : <>
      <p className="muted">原画像を選ぶと、読み取り結果と見比べられます。位置を重ねる場合は、紙シートメニューで画像を登録・補正してください。</p>
      <label className="fileButton">照合する画像を選ぶ<input type="file" accept="image/*" onChange={event => {
        const file = event.target.files?.[0]
        if (file) setReference({ name: file.name, url: URL.createObjectURL(file) })
      }} /></label>
      {reference && <><p>参照画像：{reference.name}（位置未補正）</p><div className="paperAiReference"><img src={reference.url} alt="ユーザーが選択した紙シートの参照画像" /></div></>}
    </>}
    {error && <p role="alert">{error}</p>}
  </aside>
}
