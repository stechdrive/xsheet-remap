import { readFileSync, writeFileSync } from 'node:fs'
import jsQR from 'jsqr'
import type { Download } from '@playwright/test'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { createProjectDocumentFromCutProject, createProjectFromTemplate, digitalStandardSheetTemplate,
  createRecognizedEvent, standardA3SheetTemplate, updateLogicalSheetSettings } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { buildTemplateChromeRenderModel } from '../../../packages/ui/src/templateEditorGeometry'
import { SHEET_LINK_PREFIX, decodeSheetLink } from '../../../packages/adapters/src/sheet-link/packet'
import { waitForPaperPaint } from '../paper-paint-contract'
import { channel, darkRowBands, readPng, type PixelRect, type Raster } from '../raster'

for (const kind of ['paper', 'digital'] as const) for (const custom of [false, true]) {
  test(`sheet branding survives GPU, print and PNG (${kind}, ${custom ? 'custom hidden' : 'standard'})`, async ({ page }, info) => {
    const base = kind === 'paper' ? standardA3SheetTemplate : digitalStandardSheetTemplate
    const template = structuredClone(base)
    if (custom) template.templateId += '-custom'
    let project = updateLogicalSheetSettings(createProjectFromTemplate(template), { durationFrames: 48 })
    project.cut = {title:'星',episode:'7',scene:'4',cut:'021'}
    project = createRecognizedEvent(project,'A',1,'action','7').project
    project = createRecognizedEvent(project,'B',2,'cell','B3').project
    const archive = await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template }))
    writeFileSync(info.outputPath('branding.xsr'), archive)
    await page.goto('./')
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({
      name: 'branding.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(archive),
    })
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await page.evaluate(() => document.fonts.ready)
    const model = buildTemplateChromeRenderModel(base, base.defaults.paperTracks, 48)
    const qr = headerScanArea(model, kind==='paper' && !custom)
    await page.locator('.sheetZoomFloatingPalette').hover()
    await activateControl(page, page.locator('.zoomResetButton'))
    await page.locator('.sheetViewport').evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = 0 })
    await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
    // A custom digital sheet uses this space for its worker field, so only the paper corner is blank.
    if (!custom || kind === 'paper') {
      const rect = await screenRect(page, qr)
      assertQr(await readPng(await page.screenshot({ path: info.outputPath('gpu.png') })), rect, !custom)
    }
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.sheetSvg').first()).toHaveCSS('opacity', '1')
    await expect(page.locator('.sheetTemplateBranding')).toHaveCount(custom ? 0 : 1)
    if (!custom) {
      const rect = await screenRect(page, qr)
      assertQr(await readPng(await page.screenshot({ path: info.outputPath('print.png') })), rect, true)
      await expect(page.locator('.sheetTemplateBranding text')).toHaveText('xsheet-remap')
    }
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
    await activateControl(page, page.getByRole('button', { name: 'タイムシート画像をPNG形式で書き出す', exact: true }))
    const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
    const pending = page.waitForEvent('download')
    await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
    const file = info.outputPath('sheet.png')
    await (await pending).saveAs(file)
    const image = await readPng(readFileSync(file))
    const rect = { x: qr.x * image.width, y: qr.y * image.height, width: qr.w * image.width, height: qr.h * image.height }
    const url = !custom || kind === 'paper' ? assertQr(image, rect, !custom) : undefined
    const name = model.branding!.name
    const nameInk = darkRowBands(image, { x: name.x * image.width - 160, y: name.y * image.height - name.fontSizePx,
      width: 160, height: name.fontSizePx + 4 })
    expect(nameInk.length > 0).toBe(!custom)
    if (url) {
      const packet = decodeSheetLink(new URL(url).hash.slice(3))
      expect(packet.sheet.columns.map(col=>col.points)).toEqual([[[1,'7']],[[2,'B3']]])
      const scanned = await page.context().newPage()
      await scanned.goto('./' + new URL(url).hash)
      await expect(scanned.getByText(/全1ページを復元しました/)).toBeVisible()
      await scanned.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
      await scanned.emulateMedia({media:'print'})
      await expect(scanned.locator('.sheetSvg').first()).toContainText('B3')
      await expect(scanned.locator('.sheetSvg').first()).toContainText('星')
      await scanned.close()
    }
  })
}

test('scans two exported pages with the second QR in MEMO and opens its editable cells', async ({page},info)=>{
  const template=standardA3SheetTemplate
  let project=createProjectFromTemplate(template)
  project.logicalSheet.durationFrames=288
  project=createRecognizedEvent(project,'A',1,'action','1').project
  let random=2031
  for (const track of template.defaults.paperTracks) for (const sheetRole of ['action','cell'] as const) {
    const used = new Set<string>()
    for (let frame=145;frame<=288;frame++) {
      random=(Math.imul(random,1664525)+1013904223)>>>0
      const label=String((random>>>22)%64), keyId=track+'-'+sheetRole+'-'+label
      if (!used.has(keyId)) {
        project.logicalSheet.keys.push({paperTrack:track,sheetRole,keyId,displayLabel:label,createdFrom:'manual'})
        used.add(keyId)
      }
      project.logicalSheet.events.push({paperTrack:track,sheetRole,keyId,frame,eventId:keyId+'-'+frame,valueKind:'cell'})
    }
  }
  project.sheetFormData.pages.page_2={'memo.body':{kind:'text',value:'左上に残すメモ'}}
  const archive=await encodeProjectArchive(createProjectDocumentFromCutProject(project,{sheetTemplate:template}))
  await page.goto('./')
  await activateControl(page,page.getByLabel('画面切替',{exact:true}))
  await page.getByRole('button',{name:'プロジェクトを開く…',exact:true}).setInputFiles({
    name:'two-pages.xsr',mimeType:'application/octet-stream',buffer:Buffer.from(archive),
  })
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state','active',{timeout:40_000})
  await activateControl(page,page.getByLabel('画面切替',{exact:true}))
  await activateControl(page,page.getByRole('button',{name:'書き出し ›',exact:true}))
  await activateControl(page,page.getByRole('button',{name:'タイムシート画像をPNG形式で書き出す',exact:true}))
  const downloads: Download[]=[]
  page.on('download',download=>downloads.push(download))
  await activateControl(page,page.getByRole('dialog',{name:'画像書き出し'}).getByRole('button',{name:'保存',exact:true}))
  await expect.poll(()=>downloads.length,{timeout:30_000}).toBe(2)
  const chrome=buildTemplateChromeRenderModel(template), regions=[headerScanArea(chrome,true),chrome.formFields.find(f=>f.fieldId==='memo.body')!.rect]
  const urls:string[]=[]
  for (const [i,download] of downloads.sort((a,b)=>a.suggestedFilename().localeCompare(b.suggestedFilename())).entries()) {
    const file=info.outputPath('sheet-page-'+(i+1)+'.png')
    await download.saveAs(file)
    const image=await readPng(readFileSync(file)), area=regions[i]!
    const left=Math.round(area.x*image.width),top=Math.round(area.y*image.height)
    const w=Math.round(area.w*image.width),h=Math.round(area.h*image.height)
    const crop=new Uint8ClampedArray(w*h*4)
    for(let y=0;y<h;y++) crop.set(image.data.subarray(((top+y)*image.width+left)*4,((top+y)*image.width+left+w)*4),y*w*4)
    const qr=jsQR(crop,w,h)
    expect(qr?.data).toMatch(/#s=\d+$/)
    if(i===1) expect(qr!.location.topLeftCorner.x).toBeGreaterThan(w/2)
    const url=new URL(qr!.data)
    const packet=decodeSheetLink(url.hash.slice(3))
    expect(packet.page).toBe(i+1)
    if (i===1) {
      const labels=new Map(project.logicalSheet.keys.map(k=>[k.keyId,k.displayLabel]))
      const expected=project.logicalSheet.events.filter(e=>e.frame>=145)
        .map(e=>[e.paperTrack,e.sheetRole,e.frame,labels.get(e.keyId)].join('/')).sort()
      const restored=packet.sheet.columns.flatMap(col=>col.points.filter(([frame])=>frame>=145)
        .map(([frame,label])=>[packet.sheet.names[col.index>>1],col.index%2 ? 'cell' : 'action',frame,label].join('/'))).sort()
      expect(restored).toEqual(expected)
    }
    urls.push(url.hash)
  }
  const scanned=await page.context().newPage()
  await scanned.setViewportSize({width:390,height:844})
  await scanned.goto('./'+urls[0])
  await expect(scanned.getByText(/全2ページ中1ページ/)).toBeVisible()
  await scanned.goto('./'+urls[1])
  await expect(scanned.getByText(/全2ページを復元/)).toBeVisible()
  await expect(scanned.getByRole('img',{name:'タイムシート入力 2ページ'})).toBeVisible()
  await expect(scanned.locator('[data-timeline-event-role="cell"][data-timeline-event-frame="145"]')).toHaveCount(template.defaults.paperTracks.length)
  await scanned.close()
})

function headerScanArea(chrome: ReturnType<typeof buildTemplateChromeRenderModel>, paper: boolean) {
  const rect=chrome.branding!.qrRect
  if (!paper) return rect
  const {widthPx,heightPx}=chrome.pageSize
  return {x:rect.x-10/widthPx,y:rect.y-15/heightPx,w:rect.w+30/widthPx,h:rect.h+30/heightPx}
}

async function screenRect(page: Page, rect: { x: number; y: number; w: number; h: number }): Promise<PixelRect> {
  return page.locator('.sheetSvg').first().evaluate((element, rect) => {
    const box = element.getBoundingClientRect(), dpr = devicePixelRatio
    return { x: (box.x + rect.x * box.width) * dpr, y: (box.y + rect.y * box.height) * dpr,
      width: rect.w * box.width * dpr, height: rect.h * box.height * dpr }
  }, rect)
}

function assertQr(image: Raster, rect: PixelRect, visible: boolean) {
  const side = Math.ceil(rect.width) * 3, pixels = new Uint8ClampedArray(side*side*4).fill(255)
  let dark = 0
  for (let y=0; y<side; y++) for (let x=0; x<side; x++) {
    const gray=channel(image,rect.x+(x+.5)*rect.width/side,rect.y+(y+.5)*rect.height/side,0)
    if (gray<128) dark++
    pixels.fill(gray,(y*side+x)*4,(y*side+x)*4+3)
  }
  if (!visible) { expect(dark).toBe(0); return }
  const link=jsQR(pixels,side,side)?.data
  expect(link).toMatch(/^https:\/\/stechdrive\.github\.io\/xsheet-remap\/#s=\d+$/u)
  expect(link!.startsWith(SHEET_LINK_PREFIX)).toBe(true)
  return link
}
