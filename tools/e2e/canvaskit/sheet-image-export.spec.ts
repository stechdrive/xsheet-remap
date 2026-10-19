import { readFileSync } from 'node:fs'
import { readPsdComposite, type RgbImage } from '../psd-composite'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import {
  addOverlayPaperTrack, addTimelineLane, createDefaultProject, createKey, setEvent,
  createProjectDocumentFromCutProject, createProjectFromTemplate, digitalStandardSheetTemplate,
  projectSheetLayoutOptions, reprojectProjectToTemplate, resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize, updateLogicalSheetSettings,
} from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'

for (const source of ['digital', 'paper', 'extra-lanes'] as const) {
  test(`PSD grid and numbers stay aligned after adding digital columns (${source} project)`, async ({ page }, info) => {
    const template = digitalStandardSheetTemplate
    let project = source === 'paper' ? reprojectProjectToTemplate(createDefaultProject(), template) : createProjectFromTemplate(template)
    const initialSize = resolveSheetTemplatePageSize(template, undefined, projectSheetLayoutOptions(project, template))
    project = updateLogicalSheetSettings(project, { durationFrames: 48 })
    while (project.logicalSheet.paperTracks.length < 12) {
      project = addOverlayPaperTrack(project, { insertAfterPaperTrack: project.logicalSheet.paperTracks.at(-1)!.paperTrack }).project
    }
    // SOUND/CAMERA also affect the sheet's total width and every normalized X coordinate.
    if (source === 'extra-lanes') {
      project = addTimelineLane(project, { role: 'sound' }).project
      project = addTimelineLane(project, { role: 'camera' }).project
    }
    for (const role of ['action', 'cell'] as const) {
      for (const track of project.logicalSheet.paperTracks) {
        const created = createKey(project, track.paperTrack, '8', 'manual', undefined, role)
        project = setEvent(created.project, track.paperTrack, 1, created.key.keyId, role)
      }
    }
    const archive = await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template }))
    await page.goto('./')
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'expanded-digital.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await expect(page.locator('[data-timeline-event-role="cell"][data-timeline-event-frame="1"]')).toHaveCount(12)
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
    await activateControl(page, page.getByRole('button', { name: 'タイムシート画像をPSD形式で書き出す', exact: true }))
    const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
    const pending = page.waitForEvent('download')
    await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
    const saved = info.outputPath('expanded-digital.psd')
    await (await pending).saveAs(saved)
    const image = readPsdComposite(readFileSync(saved))
    const options = projectSheetLayoutOptions(project, template)
    const size = resolveSheetTemplatePageSize(template, options.durationFrames, options)
    expect([image.width, image.height]).toEqual([size.widthPx, size.heightPx])
    expect(image.width).toBeGreaterThan(initialSize.widthPx)

    for (const role of ['action', 'cell'] as const) {
      const region = template.regions.find(item => item.grid?.role === role)!
      const grid = resolveSheetTemplateGridLayout(template, region, options)!
      expect(grid.columns).toHaveLength(12)
      const top = grid.rect.y * image.height
      const rowHeight = grid.frames.rowHeight * image.height
      for (const column of grid.columns) {
        const left = column.x * image.width, width = column.w * image.width
        // Inspect actual serialized pixels in an empty row, away from horizontal rules.
        for (const x of [left, left + width]) {
          expect(darkPixels(image, x - 2, top + rowHeight * 2.25, 5, rowHeight / 2, 220).length,
            `${role}/${column.paperTrack}: vertical grid at ${x}`).toBeGreaterThan(3)
        }
        const ink = darkPixels(image, left + 4, top + 2, width - 8, rowHeight - 4)
        expect(ink.length, `${role}/${column.paperTrack}: exported number`).toBeGreaterThan(8)
        const center = (Math.min(...ink.map(pixel => pixel.x)) + Math.max(...ink.map(pixel => pixel.x))) / 2
        expect(Math.abs(center - (left + width / 2)), `${role}/${column.paperTrack}: centered number`).toBeLessThan(3)
      }
    }
    await expect(dialog).toHaveCount(0)
  })
}



function darkPixels(image: RgbImage, x: number, y: number, width: number, height: number, threshold = 180) {
  const pixels: Array<{ x: number; y: number }> = []
  const planeSize = image.width * image.height
  for (let py = Math.ceil(y); py < y + height; py++) {
    for (let px = Math.ceil(x); px < x + width; px++) {
      const index = py * image.width + px
      if (image.planes[index] < threshold && image.planes[index + planeSize] < threshold && image.planes[index + planeSize * 2] < threshold) pixels.push({ x: px, y: py })
    }
  }
  return pixels
}
