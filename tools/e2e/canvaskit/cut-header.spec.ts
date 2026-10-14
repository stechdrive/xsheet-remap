import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { activeCutProjectFromDocument, addBlankSharedCutToProjectDocument, createProjectDocumentFromCutProject, createProjectFromTemplate, digitalStandardSheetTemplate, standardA3SheetTemplate } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { waitForPaperPaint } from '../paper-paint-contract'

for (const kind of ['paper', 'digital', 'custom'] as const) test(`shared cut header stays bounded in GPU, print and PNG (${kind})`, async ({ page }, info) => {
  const template = structuredClone(kind === 'paper' ? standardA3SheetTemplate : digitalStandardSheetTemplate)
  if (kind === 'custom') {
    const field = template.regions.flatMap(region => region.form?.cells ?? []).find(cell => cell.fieldId === 'digital.cut')!
    field.textStyle = { ...field.textStyle, fontSize: { value: 48, unit: 'px' }, lineHeight: { value: 64, unit: 'px' } }
  }
  let document = createProjectDocumentFromCutProject(createProjectFromTemplate(template), { sheetTemplate: template })
  for (const cut of ['002', '003', '004', '005', '006']) document = addBlankSharedCutToProjectDocument(document, activeCutProjectFromDocument(document), { cut: { cut } })
  document.activeCutId = document.cuts[0].cutId
  const archive = Buffer.from(await encodeProjectArchive(document))
  await page.goto('./?app=remap')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'shared-cuts.xsr', mimeType: 'application/octet-stream', buffer: archive })
  const svg = page.locator('.sheetSvg').first()
  await expect(svg).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await activateControl(page, page.getByLabel('兼用カットを切り替える', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '兼用カットを追加', exact: true }))
  await page.getByLabel('追加する兼用カット名', { exact: true }).fill('007')
  await activateControl(page, page.getByRole('button', { name: '兼用カットを作成', exact: true }))
  await page.getByRole('combobox', { name: '兼用カット', exact: true }).selectOption(document.cuts[0].cutId)
  const primaryId = kind === 'paper' ? 'top_cut_field' : 'digital_metadata_form:digital_cut_box'
  const sharedId = kind === 'paper' ? 'top_shared_cut_numbers_field' : `${primaryId}__shared_cut_numbers`
  const shared = page.locator(`.metadataFieldText[data-region-id="${sharedId}"]`)
  await expect(shared).toContainText('007')
  await activateControl(page, page.getByLabel('兼用カット名', { exact: true }))
  await expect(shared).toHaveCount(0)
  await activateControl(page, page.getByLabel('兼用カット名', { exact: true }))
  await expect(shared).toContainText('007')
  await activateControl(page, page.getByLabel('兼用カットを切り替える', { exact: true }))
  await page.evaluate(() => document.fonts.ready)
  await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  const lines = await page.locator(`.metadataFieldText[data-region-id="${primaryId}"], .metadataFieldText[data-region-id="${sharedId}"]`).evaluateAll(elements => {
    const context = document.createElement('canvas').getContext('2d')!
    return elements.flatMap(element => {
      const style = getComputedStyle(element)
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      return Array.from(element.querySelectorAll('tspan')).map(line => {
        const metrics = context.measureText(line.textContent ?? '')
        const y = Number(line.getAttribute('y'))
        return { value: line.textContent ?? '', x: Number(line.getAttribute('x')), y, font: context.font,
          top: y - metrics.actualBoundingBoxAscent, bottom: y + metrics.actualBoundingBoxDescent, baseline: style.dominantBaseline }
      })
    })
  })
  expect(lines.length).toBeGreaterThanOrEqual(2)
  for (const [index, line] of lines.entries()) {
    expect(line.baseline).toBe('alphabetic')
    if (index) expect(line.top).toBeGreaterThan(lines[index - 1].bottom)
  }
  await page.screenshot({ path: info.outputPath(`${kind}-gpu.png`) })
  await page.emulateMedia({ media: 'print' })
  await expect(shared).toContainText('007')
  await page.screenshot({ path: info.outputPath(`${kind}-print.png`) })
  await page.emulateMedia({ media: 'screen' })
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'タイムシート画像をPNG形式で書き出す', exact: true }))
  const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
  // The batch renders all seven cuts before starting any download. WebKit needs
  // about 11 seconds here, beyond the default timeout for a single UI action.
  const download = page.waitForEvent('download', { timeout: 30_000 })
  await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
  const saved = info.outputPath(`${kind}-001.png`)
  await (await download).saveAs(saved)
  await expect(dialog).toHaveCount(0)
  // Inspect exported pixels independently: each visible row must occupy its own
  // band, with blank rows separating the main number from the shared-cut list.
  const bands = await page.evaluate(async ({ base64, lines, primaryId, sharedId }) => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    const main = document.querySelector<SVGTextElement>(`.metadataFieldText[data-region-id="${primaryId}"]`)!
    const shared = document.querySelector<SVGTextElement>(`.metadataFieldText[data-region-id="${sharedId}"]`)!
    const x = Number(main.getAttribute('x'))
    const last = lines.at(-1)!
    const width = Math.max(main.getBBox().width, shared.getBBox().width) + 4
    const left = Math.floor(x - width / 2), top = Math.floor(lines[0].top) - 2
    const rowBands = () => {
      const pixels = context.getImageData(left, top, Math.ceil(width), Math.ceil(last.bottom) - top + 3)
      const runs: Array<{ top: number; bottom: number }> = []
      for (let y = 0; y < pixels.height; y++) {
        let ink = false
        for (let x = 0; x < pixels.width; x++) { const p = (y * pixels.width + x) * 4; if (pixels.data[p] < 150 && pixels.data[p + 1] < 150 && pixels.data[p + 2] < 150) { ink = true; break } }
        if (ink) { const current = runs.at(-1); if (current && current.bottom === y + top - 1) current.bottom++; else runs.push({ top: y + top, bottom: y + top }) }
      }
      return runs
    }
    const exported = rowBands()
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#1f2421'; context.textAlign = 'center'; context.textBaseline = 'alphabetic'
    for (const line of lines) { context.font = line.font; context.fillText(line.value, line.x, line.y) }
    return { exported, reference: rowBands() }
  }, { base64: readFileSync(saved).toString('base64'), lines, primaryId, sharedId })
  expect(bands.exported).toHaveLength(lines.length)
  expect(bands.exported, 'exported ink agrees with independently rasterized SVG line positions').toEqual(bands.reference)
})
