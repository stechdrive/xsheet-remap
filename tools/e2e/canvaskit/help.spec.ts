import { expect, test } from './fixtures'
import { activateControl } from './input'

test('help opens a separate tab at the current chapter while the original editor remains usable', async ({ page, context }) => {
  await page.goto('./')
  for (const [topic, chapter, chapterId] of [
    ['シート編集', 'SOUND指示とセリフ音声', 'sound'],
    ['CLIP組み立て', '読み込みと書き出し', 'io'],
    ['テンプレート作成・編集', '保存・利用', 'save'],
  ]) {
    await activateControl(page, page.getByRole('button', { name: 'ヘルプ', exact: true }))
    const dialog = page.getByRole('dialog', { name: 'xsheet-remapの使い方' })
    await activateControl(page, dialog.getByRole('group', { name: 'ヘルプの対象' }).getByRole('button', { name: topic, exact: true }))
    await activateControl(page, dialog.getByRole('tab', { name: '詳しい使い方' }))
    await activateControl(page, dialog.getByRole('navigation').getByRole('button', { name: new RegExp(chapter) }))
    const opened = context.waitForEvent('page')
    await activateControl(page, dialog.getByRole('button', { name: '別タブで開く' }))
    const help = await opened
    await expect(help).toHaveTitle('xsheet-remap ヘルプ')
    await expect(help.getByRole('heading', { name: chapter, exact: true })).toBeVisible()
    expect(new URL(help.url()).pathname).toBe('/xsheet-remap/')
    expect(new URL(help.url()).searchParams.get('chapter')).toBe(chapterId)
    expect(await help.evaluate(() => window.opener === null)).toBe(true)
    await expect(help.locator('.sheetSvg, .templateEditorApp')).toHaveCount(0)
    await expect(dialog).toHaveCount(0)
    await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
    await expect(page.getByRole('tree', { name: 'CLIPレイヤーツリー', exact: true })).toBeVisible()
    await expect(help.getByRole('heading', { name: chapter, exact: true })).toBeVisible()
    await help.reload()
    await expect(help.getByRole('heading', { name: chapter, exact: true })).toBeVisible()
    await help.setViewportSize({ width: 390, height: 844 })
    const geometry = await help.locator('.remapHelpDialog').evaluate(element => ({
      right: element.getBoundingClientRect().right, bottom: element.getBoundingClientRect().bottom,
      overflow: element.scrollWidth - element.clientWidth,
    }))
    expect(geometry.right).toBeLessThanOrEqual(390)
    expect(geometry.bottom).toBeLessThanOrEqual(844)
    expect(geometry.overflow).toBeLessThanOrEqual(1)
    await help.close()
    await activateControl(page, page.getByRole('button', { name: 'シート編集', exact: true }))
  }
})

test('unified help follows the current workspace and leaves the work mode unchanged', async ({ page }) => {
  await page.goto('./')
  const help = page.getByRole('button', { name: 'ヘルプ', exact: true })
  const dialog = page.getByRole('dialog', { name: 'xsheet-remapの使い方' })
  const topics = dialog.getByRole('group', { name: 'ヘルプの対象' })
  await activateControl(page, help)
  await expect(dialog.getByRole('heading', { name: 'タイムシートを作って保存する' })).toBeVisible()
  await activateControl(page, topics.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  await expect(dialog.getByRole('heading', { name: '素材とタイミングからCLIPを作る' })).toBeVisible()
  await activateControl(page, dialog.getByRole('button', { name: '閉じる' }))
  await expect(page.getByRole('button', { name: 'シート編集', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  await activateControl(page, help)
  await expect(topics.getByRole('button', { name: 'CLIP組み立て', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('heading', { name: '素材とタイミングからCLIPを作る' })).toBeVisible()
  await activateControl(page, dialog.getByRole('button', { name: '閉じる' }))

  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'シートテンプレ', exact: true }))
  await activateControl(page, help)
  await expect(topics.getByRole('button', { name: 'テンプレート作成・編集' })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('heading', { name: '最短でテンプレートを完成させる' })).toBeVisible()
})

test('unified help exposes every manual from template entry and fits desktop and narrow screens', async ({ page }) => {
  await page.goto('./?app=template-editor')
  await activateControl(page, page.getByRole('button', { name: 'ヘルプ', exact: true }))
  const dialog = page.getByRole('dialog', { name: 'xsheet-remapの使い方' })
  const topics = dialog.getByRole('group', { name: 'ヘルプの対象' })
  await expect(dialog.getByRole('heading', { name: '最短でテンプレートを完成させる' })).toBeVisible()
  await activateControl(page, dialog.getByRole('tab', { name: '詳しい使い方' }))

  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 844 })
    for (const [topic, chapter] of [
      ['シート編集', 'SOUND指示とセリフ音声'],
      ['CLIP組み立て', 'CLIPレイヤーと素材'],
      ['テンプレート作成・編集', '参照画像と補正基準枠'],
    ]) {
      await activateControl(page, topics.getByRole('button', { name: topic, exact: true }))
      await activateControl(page, dialog.getByRole('navigation').getByRole('button', { name: new RegExp(chapter) }))
      await expect(dialog.getByRole('heading', { name: chapter, exact: true })).toBeVisible()
      const boxes = await dialog.locator('.remapHelpDialog, .editorHelpToc, .editorHelpChapter').evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect()
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
      }))
      expect(boxes).toHaveLength(3)
      for (const box of boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(width)
        expect(box.bottom).toBeLessThanOrEqual(844)
        expect(box.width).toBeGreaterThan(200)
        expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1)
      }
      expect(boxes[2].height).toBeGreaterThan(140)
      await activateControl(page, dialog.getByRole('button', { name: '次の章 →' }))
      await expect(dialog.getByRole('heading', { name: chapter, exact: true })).toHaveCount(0)
    }
  }
  await activateControl(page, dialog.getByRole('tab', { name: 'ライセンス・謝辞' }))
  await expect(dialog.getByRole('article', { name: 'ライセンス・謝辞' })).toBeVisible()
  await activateControl(page, topics.getByRole('button', { name: 'シート編集', exact: true }))
  await expect(dialog.getByRole('heading', { name: 'タイムシートを作って保存する' })).toBeVisible()
  await activateControl(page, dialog.getByRole('button', { name: '閉じる' }))
  await expect(page.getByRole('button', { name: '標準用紙を調整（おすすめ）' })).toBeVisible()
})
