import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import {
  addOverlayPaperTrack, addTimelineLane, createDefaultProject, createKey, setEvent,
  createProjectDocumentFromCutProject, createProjectFromTemplate, digitalStandardSheetTemplate,
  projectSheetLayoutOptions, reprojectProjectToTemplate, resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize, updateLogicalSheetSettings,
} from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'

for (const source of ['digital', 'paper'] as const) {
  test(`PSD grid and numbers stay aligned after adding digital columns (${source} project)`, async ({ page }, info) => {
    const template = digitalStandardSheetTemplate
    let project = source === 'digital' ? createProjectFromTemplate(template) : reprojectProjectToTemplate(createDefaultProject(), template)
    project = updateLogicalSheetSettings(project, { durationFrames: 48 })
    while (project.logicalSheet.paperTracks.length < 12) {
      project = addOverlayPaperTrack(project, { insertAfterPaperTrack: project.logicalSheet.paperTracks.at(-1)!.paperTrack }).project
    }
    // SOUND/CAMERA also affect the sheet's total width and every normalized X coordinate.
    if (source === 'digital') {
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
    await page.goto('./?app=remap')
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

type RgbImage = { width: number; height: number; planes: Uint8Array }

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

// Read the merged PSD RGB planes independently of the application writer.
function readPsdComposite(bytes: Buffer): RgbImage {
  expect(bytes.toString('ascii', 0, 4)).toBe('8BPS')
  expect([bytes.readUInt16BE(4), bytes.readUInt16BE(12), bytes.readUInt16BE(22), bytes.readUInt16BE(24)]).toEqual([1, 3, 8, 3])
  const height = bytes.readUInt32BE(14), width = bytes.readUInt32BE(18)
  let offset = 26
  for (let section = 0; section < 3; section++) offset += 4 + bytes.readUInt32BE(offset)
  const compression = bytes.readUInt16BE(offset)
  offset += 2
  const planes = new Uint8Array(width * height * 3)
  if (compression === 0) {
    expect(bytes.length - offset).toBe(planes.length)
    planes.set(bytes.subarray(offset))
  } else {
    expect(compression).toBe(1)
    const lengths = Array.from({ length: height * 3 }, (_, row) => bytes.readUInt16BE(offset + row * 2))
    offset += lengths.length * 2
    for (const [row, length] of lengths.entries()) {
      const end = offset + length
      let target = row * width
      while (offset < end) {
        const header = bytes.readInt8(offset++)
        if (header >= 0) {
          planes.set(bytes.subarray(offset, offset + header + 1), target)
          offset += header + 1
          target += header + 1
        } else if (header !== -128) {
          planes.fill(bytes[offset++], target, target + 1 - header)
          target += 1 - header
        }
      }
      expect(offset).toBe(end)
      expect(target).toBe((row + 1) * width)
    }
    expect(offset).toBe(bytes.length)
  }
  return { width, height, planes }
}
