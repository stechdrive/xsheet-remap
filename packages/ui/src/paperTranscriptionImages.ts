import { buildPaperTranscriptionPrompt, type CutProject, type PaperTranscriptionRequest, type PaperTranscriptionTarget, type SheetTemplate } from '@xsheet-remap/core'
import { createPortableArchive, type PortableArchiveFile } from '@xsheet-remap/adapters'
import { renderCorrectedSheetImageExport } from './correctedSheetImageExport'
import { getSheetPageImage, loadImage } from './sheetImages'

export async function paperTranscriptionPagePng(sheetView: CutProject['sheetView'], template: SheetTemplate, urls: Record<string, string>, pageId: string): Promise<Uint8Array | null> {
  const image = getSheetPageImage(sheetView, urls, pageId, template)
  if (!image.sourceId || !image.imageUrl) return null
  const rendered = await renderCorrectedSheetImageExport({
    sourceName: 'paper.png', imageUrl: image.imageUrl, imageSettings: image.settings, template, format: 'png',
  })
  return rendered.bytes
}

export function paperTranscriptionCrop(target: PaperTranscriptionTarget, from = target.from, to = target.to) {
  const rowHeight = target.rect.h / (target.to - target.from + 1)
  const x = Math.max(0, target.rect.x - Math.max(target.rect.w * 0.75, 0.02))
  const y = Math.max(0, target.rect.y + (from - target.from - 2) * rowHeight)
  return {
    x, y,
    w: Math.min(1, target.rect.x + target.rect.w + Math.max(target.rect.w * 0.75, 0.02)) - x,
    h: Math.min(1, target.rect.y + (to - target.from + 3) * rowHeight) - y,
  }
}

export async function paperTranscriptionImageArchive(project: CutProject, template: SheetTemplate, urls: Record<string, string>, request: PaperTranscriptionRequest): Promise<Uint8Array> {
  const files: PortableArchiveFile[] = [
    { relativePath: '解析プロンプト.txt', contents: buildPaperTranscriptionPrompt(request) },
    { relativePath: '画像の渡し方.txt', contents: 'ZIPを展開し、解析プロンプト.txtと対象ページの全体画像・拡大画像をAIチャットに添付してください。拡大画像は前後2コマと隣列を含みます。左余白のコマ番号と青い括弧が読み取り対象です。画像中の手書きには補助線を重ねていません。\n' },
  ]
  const pages = [...new Set(request.targets.map(target => target.pageId))]
  let bytesTotal = 0
  for (const pageId of pages) {
    const targets = request.targets.filter(target => target.pageId === pageId)
    const bytes = await paperTranscriptionPagePng(project.sheetView, template, urls, pageId)
    if (!bytes) throw new Error(`${targets[0]!.pageNumber}ページの紙シート画像がありません。手元のスキャンを直接チャットへ添付するか、紙シートメニューで画像を登録してください。`)
    const pageName = `page-${String(targets[0]!.pageNumber).padStart(3, '0')}`
    files.push({ relativePath: `${pageName}-全体.png`, contents: bytes })
    bytesTotal += bytes.byteLength
    if (bytesTotal > 128_000_000) throw new Error('画像セットが大きすぎます。ページや列を分けてください。')
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
    try {
      const image = await loadImage(url)
      for (const target of targets) for (let from = target.from; from <= target.to; from += 48) {
        const to = Math.min(target.to, from + 47)
        const crop = paperTranscriptionCrop(target, from, to)
        const padding = 92, heading = 48
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(crop.w * image.width) + padding
        canvas.height = Math.ceil(crop.h * image.height) + heading
        const context = canvas.getContext('2d')
        if (!context) throw new Error('拡大画像の描画に失敗しました。')
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, crop.x * image.width, crop.y * image.height, crop.w * image.width, crop.h * image.height, padding, heading, crop.w * image.width, crop.h * image.height)
        context.fillStyle = '#172c36'; context.font = '14px sans-serif'
        context.fillText(`${target.targetId} / ${target.role.toUpperCase()} / ${target.column}`, 8, 18)
        context.fillText(`${from}–${to} F`, 8, 38)
        const rowHeight = target.rect.h / (target.to - target.from + 1)
        context.textAlign = 'right'
        for (let frame = from; frame <= to; frame++) {
          const y = heading + (target.rect.y + (frame - target.from + 0.5) * rowHeight - crop.y) * image.height
          context.fillText(`${frame} F`, padding - 10, y + 4)
        }
        // Guide stays in the new margin above the ink.
        const left = padding + (target.rect.x - crop.x) * image.width
        context.strokeStyle = '#166b96'; context.lineWidth = 2
        context.beginPath(); context.moveTo(left, heading - 8); context.lineTo(left + target.rect.w * image.width, heading - 8); context.stroke()
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNGを書き出せませんでした。')), 'image/png'))
        const imageBytes = new Uint8Array(await blob.arrayBuffer())
        bytesTotal += imageBytes.byteLength
        if (bytesTotal > 128 * 1024 * 1024) throw new Error('画像が大きすぎます。ページや列を分けて保存してください。')
        files.push({ relativePath: `${pageName}-${target.targetId}-${from}-${to}.png`, contents: imageBytes })
      }
    } finally { URL.revokeObjectURL(url) }
  }
  return createPortableArchive(files)
}
