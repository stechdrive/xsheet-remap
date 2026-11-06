import { expect, test } from './fixtures'
import { standardA3SheetTemplate } from '@xsheet-remap/core'

test('Remap registers an imported paper page through its calibration loupe', async ({ page }) => {
  await page.goto('./?app=remap')
  await page.getByLabel('表示設定', { exact: true }).click()
  await page.getByRole('button', { name: 'A3標準', exact: true }).click()
  await page.keyboard.press('Escape')
  const underlay = standardA3SheetTemplate.defaultUnderlay!
  const asset = await page.request.get('./' + underlay.assetPath)
  expect(asset.ok()).toBe(true)
  const buffer = await asset.body()
  expect(buffer.byteLength).toBe(underlay.imageRef.size)
  await page.locator('summary[aria-label="紙シート"]').click()
  const menu = page.locator('.paperSheetRailMenu.actionMenuPortalContent')
  await menu.locator('input[type=file]').setInputFiles({ name: 'registered_sheet.png', mimeType: 'image/png', buffer })
  await expect(menu.getByRole('combobox', { name: '1ページの紙シート画像' })).toHaveValue(/.+/)
  await expect(menu.getByRole('option', { name: /registered_sheet.png/ })).toBeAttached()
  await menu.getByRole('button', { name: 'シート画像補正', exact: true }).click()
  const loupe = page.locator('.calibrationLoupeDialog')
  await expect(loupe).toContainText(/自動検出 \d+%/, { timeout: 25_000 })
  const overlay = page.locator('.autoCalibrationGuideOverlay').first()
  await expect(overlay).toHaveAttribute('data-method', 'reference-image')
  const points = await overlay.locator('polygon').evaluateAll(shapes => shapes.map(shape =>
    Array.from((shape as SVGPolygonElement).points).map(p => [p.x, p.y])))
  expect(points).toHaveLength(2)
  expect(points[0]).toHaveLength(4)
  for (let i = 0; i < 4; i++) {
    const dx = (points[0][i][0]-points[1][i][0])*standardA3SheetTemplate.page.widthPx
    const dy = (points[0][i][1]-points[1][i][1])*standardA3SheetTemplate.page.heightPx
    expect(Math.hypot(dx,dy)).toBeLessThan(1)
  }
  const calls = await page.evaluateHandle(async () => {
    type Operation = 'calcOpticalFlowPyrLK' | 'matchTemplate'
    type Runtime = Record<Operation, (...args: unknown[]) => unknown>
    const cv = await (window as Window & { cv: Promise<Runtime> | Runtime }).cv
    const counts = { calcOpticalFlowPyrLK: 0, matchTemplate: 0 }
    for (const op of ['calcOpticalFlowPyrLK', 'matchTemplate'] as const) {
      cv[op] = new Proxy(cv[op], { apply(target, receiver, args) {
        counts[op]++
        return Reflect.apply(target, receiver, args)
      } })
    }
    return counts
  })
  await loupe.getByRole('button', { name: '4点自動検出', exact: true }).click()
  await expect.poll(() => calls.jsonValue()).toEqual({ calcOpticalFlowPyrLK: 2, matchTemplate: 0 })
  await calls.dispose()
})

test('Corrector locates the registered frame on a tilted sheet with one covered corner', async ({ page }) => {
  await page.goto('./?app=sheet-corrector')
  const fixture = await page.evaluate(
    async ({ pageSize, bounds, path }) => {
      const original = new Image()
      original.src = new URL(path, document.baseURI).href
      await original.decode()
      const { widthPx: width, heightPx: height } = pageSize
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      const ctx = c.getContext('2d')!
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, width, height)
      const angle = (1.5 * Math.PI) / 180
      ctx.translate(width / 2, height / 2)
      ctx.rotate(angle)
      ctx.translate(-width / 2, -height / 2)
      ctx.drawImage(original, 0, 0)
      const matrix = ctx.getTransform()
      const corners = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([x, y]) => {
        const p = matrix.transformPoint({ x: (bounds.x + bounds.w * x) * width, y: (bounds.y + bounds.h * y) * height })
        return [p.x, p.y]
      })
      ctx.fillStyle = '#f3f2ed'
      ctx.fillRect(bounds.x * width - 55, bounds.y * height - 70, 220, 155)
      return { png: c.toDataURL().split(',')[1], corners, width, height }
    },
    {
      pageSize: standardA3SheetTemplate.page,
      bounds: standardA3SheetTemplate.calibration!.targetRect!,
      path: standardA3SheetTemplate.defaultUnderlay!.assetPath,
    },
  )
  await page.locator('input[type=file][accept*="image"]').setInputFiles({
    name: 'tilted_sheet.png',
    mimeType: 'image/png',
    buffer: Buffer.from(fixture.png, 'base64'),
  })
  await page.getByRole('button', { name: '画像補正', exact: true }).click()
  const loupe = page.locator('.calibrationLoupeDialog')
  await expect(loupe).toContainText('推定位置の左上', { timeout: 25_000 })
  for (const [i, label] of ['左上', '右上', '右下', '左下'].entries()) {
    const view = await loupe.getByLabel(label + 'の補正ルーペ').getAttribute('viewBox')
    const [x, y, w, h] = view!.split(' ').map(Number)
    const measured = [(x + w / 2) * fixture.width, (y + h / 2) * fixture.height]
    expect(Math.hypot(measured[0] - fixture.corners[i][0], measured[1] - fixture.corners[i][1]), label).toBeLessThan(2)
  }
  await loupe.getByRole('button', { name: '変形適用' }).click()
  await expect(loupe).toHaveCount(0)
  await expect(page.locator('.sheetCorrectorCorrectionHeader')).toContainText('推定位置の左上')
})

for (const scenario of ['shifted grid', 'missing horizontal rule', 'parallel pen stroke'] as const) {
  test(`Corrector aligns a ${scenario} using the registered print`, async ({ page }) => {
    await page.goto('./?app=sheet-corrector')
    const fixture = await page.evaluate(async ({ path, bounds, scenario }) => {
      const original = new Image()
      original.src = new URL(path, document.baseURI).href
      await original.decode()
      const canvas = document.createElement('canvas')
      const width = canvas.width = original.naturalWidth, height = canvas.height = original.naturalHeight
      const ctx = canvas.getContext('2d')!
      const x = Math.round((bounds.x + bounds.w) * width), y = Math.round((bounds.y + bounds.h) * height)
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(original, scenario === 'shifted grid' ? 7 : 0, scenario === 'shifted grid' ? 57 : 0)
      if (scenario === 'missing horizontal rule') {
        // Move the lower-right printed rules together, then obscure the horizontal arm.
        ctx.fillRect(x - 160, y - 160, 183, 180)
        ctx.drawImage(original, x - 160, y - 160, 180, 180, x - 157, y - 160, 180, 180)
        ctx.fillRect(x - 82, y - 9, 93, 18)
      } else if (scenario === 'parallel pen stroke') {
        ctx.fillRect(x - 82, y - 9, 89, 18)
        ctx.fillRect(x - 9, y - 154, 18, 160)
        ctx.fillStyle = '#444'
        ctx.fillRect(x + 2, y - 148, 2, 149)
      }
      return { png: canvas.toDataURL().split(',')[1], width, height, x, y }
    }, { path: standardA3SheetTemplate.defaultUnderlay!.assetPath, bounds: standardA3SheetTemplate.calibration!.targetRect!, scenario })
    await page.locator('input[type=file][accept*="image"]').setInputFiles({
      name: 'printed_sheet.png', mimeType: 'image/png', buffer: Buffer.from(fixture.png, 'base64'),
    })
    await page.getByRole('button', { name: '画像補正', exact: true }).click()
    const loupe = page.locator('.calibrationLoupeDialog')
    await expect(loupe).toContainText(scenario === 'shifted grid' ? '自動検出しました。' : '推定位置の右下', { timeout: 25_000 })
    const view = await loupe.getByLabel('右下の補正ルーペ').getAttribute('viewBox')
    const [left, top, width, height] = view!.split(' ').map(Number)
    const measuredX = (left + width / 2) * fixture.width, measuredY = (top + height / 2) * fixture.height
    const dx = scenario === 'shifted grid' ? 7 : scenario === 'missing horizontal rule' ? 3 : 0
    const dy = scenario === 'shifted grid' ? 57 : 0
    expect(Math.hypot(measuredX - fixture.x - dx, measuredY - fixture.y - dy)).toBeLessThan(1)
  })
}

for (const curved of [false, true]) {
  test(`Corrector ${curved ? 'applies a mesh to curved ink' : 'keeps flat registered ink on basic correction'}`, async ({ page }) => {
    await page.goto('./?app=sheet-corrector')
    const png = await page.evaluate(async ({ path, target, curved }) => {
      const source = new Image()
      source.src = new URL(path, document.baseURI).href
      await source.decode()
      const canvas = document.createElement('canvas')
      canvas.width = source.naturalWidth
      canvas.height = source.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const top = target.y * canvas.height, span = target.h * canvas.height
      for (let y = 0; y < canvas.height; y++) {
        const phase = Math.min(1, Math.max(0, (y - top) / span))
        const dx = curved ? 3 * Math.sin(Math.PI * phase) : 0
        ctx.drawImage(source, 0, y, canvas.width, 1, dx, y, canvas.width, 1)
      }
      return canvas.toDataURL().split(',')[1]
    }, { path: standardA3SheetTemplate.defaultUnderlay!.assetPath, target: standardA3SheetTemplate.calibration!.targetRect!, curved })
    await page.locator('input[type=file][accept*="image"]').setInputFiles({
      name: 'measured_sheet.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
    })
    await page.getByRole('button', { name: '画像補正', exact: true }).click()
    const loupe = page.locator('.calibrationLoupeDialog')
    await expect(loupe).toContainText('自動検出しました。', { timeout: 25_000 })
    await loupe.getByRole('button', { name: '変形適用' }).click()
    await expect(loupe).toHaveCount(0)
    await expect(page.locator('.sheetCorrectorStatus')).toHaveText(curved ? /テンプレート適応補正を適用しました。対応点/ : '通常補正を適用しました。')
  })
}
