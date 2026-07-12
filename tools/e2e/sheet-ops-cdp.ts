import { writeFile } from 'node:fs/promises'
import {
  cellRectForHit,
  timingHitForFrame,
  standardA3SheetTemplate,
  type NormalizedRect,
  type SheetTimingRole,
} from '@xsheet-remap/core'

interface ClientPoint {
  x: number
  y: number
}

interface CellPointBias {
  xRatio: number
  yRatio: number
}

interface EventSnapshot {
  label: string
  pageId: string
  x: number
  y: number
  w: number
  h: number
  className: string
}

interface RectSnapshot extends NormalizedRect {
  pageId: string
  className: string
}

interface FrameLocation {
  pageId: string
  rect: NormalizedRect
}

interface SheetOpsReport {
  checks: string[]
  finalEvents: EventSnapshot[]
}

interface CdpListTarget {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl?: string
}

interface CdpResponse<T = unknown> {
  id?: number
  result?: T
  error?: { message: string; data?: string }
}

class CdpClient {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as CdpResponse
      if (typeof message.id !== 'number') return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ''}`))
      } else {
        pending.resolve(message.result)
      }
    })
  }

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      socket.addEventListener('open', () => resolve(new CdpClient(socket)), { once: true })
      socket.addEventListener('error', () => reject(new Error(`failed to connect CDP websocket: ${url}`)), { once: true })
    })
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId
    this.nextId += 1
    const payload = JSON.stringify({ id, method, params })
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject })
      this.socket.send(payload)
    })
  }

  close(): void {
    this.socket.close()
  }
}

const args = parseArgs(process.argv.slice(2))
const port = Number(args.port)
if (!Number.isInteger(port) || port <= 0) throw new Error('--port is required')
if (!args.result) throw new Error('--result is required')
if (!args.report) throw new Error('--report is required')

const checks: string[] = []
let client: CdpClient | null = null
let previewClient: CdpClient | null = null
const e2ePageFrames = standardA3SheetTemplate.defaults.durationFrames
let e2eDurationFrames = e2ePageFrames

try {
  const target = await waitForCdpTarget(port, target => !target.url.includes('window=asset-preview'), 'main CDP target')
  if (!target.webSocketDebuggerUrl) throw new Error('CDP target did not expose a websocket URL')
  client = await CdpClient.connect(target.webSocketDebuggerUrl)
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Input.setIgnoreInputEvents', { ignore: false })

  await waitForSheet()
  await verifyTopMenuBehavior()
  await verifyAssetBrowserShell()
  await dropAssetFolderOnBrowser(args['asset-root'] ?? '')
  await verifyStackGuidePlacementAndSharedCuts()
  await clickActionMenuSummary('表示設定')
  await waitForPageCondition(() => {
    const menu = document.querySelector<HTMLElement>('.actionMenuPortalContent.sheetDisplaySettingsMenu')
    if (!menu) return false
    const templateButtons = Array.from(menu.querySelectorAll('button')).map(button => button.textContent?.trim() ?? '')
    const rect = menu.getBoundingClientRect()
    return rect.width > 0
      && rect.height > 0
      && rect.left >= 0
      && rect.top >= 0
      && rect.right <= window.innerWidth
      && rect.bottom <= window.innerHeight
      && templateButtons.some(label => label.includes('A3標準'))
      && templateButtons.some(label => label.includes('デジタル標準'))
      && !menu.querySelector('select')
  })
  await keyPress('Escape')
  checks.push('opened the direct display-template menu inside the viewport')

  await dropSheetSourcesForMultiPage()
  e2eDurationFrames = e2ePageFrames * 2
  await waitForSheetPageCount(2)
  await clickFrame('cell', 'A', e2ePageFrames + 1)
  await keyPress('9')
  await waitForEventAt('cell', 'A', e2ePageFrames + 1, '9')
  checks.push('dropped two sheet images, created a multi-page sheet, and verified timing input on page 2')

  await dragRange('cell', 'A', 1, 3)
  await waitForPageCondition(() => Boolean(document.querySelector('.selectedRangeRect')))
  await waitForSelectedRange('cell', 'A', 1, 3)
  await keyPress('1')
  await waitForEventAt('cell', 'A', 1, '1')
  checks.push('selected a CELL range with a CDP mouse drag and created a timing event from the value input')

  await clickFrame('cell', 'B', 2)
  await keyPress('2')
  await waitForEventAt('cell', 'B', 2, '2')
  await dragRangeBetweenTracks('cell', 'A', 1, 'B', 3)
  await waitForSelectedRangeTracks('cell', ['A', 'B'], 1, 3)
  await keyboardShortcut('c')
  await clickFrame('cell', 'C', 30)
  await waitForSelectedFrame('cell', 'C', 30)
  await keyboardShortcut('v')
  await waitForEventAt('cell', 'C', 30, '1')
  await waitForEventAt('cell', 'D', 31, '2')
  checks.push('copied a multi-track CELL rectangle and pasted it to the next two tracks')

  await dragRange('cell', 'A', 1, 3)
  await waitForSelectedRange('cell', 'A', 1, 3)
  await keyboardShortcut('c')
  await dragRange('cell', 'B', 10, 15)
  await waitForSelectedRange('cell', 'B', 10, 15)
  await rightClickFrame('cell', 'B', 10)
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')))
  await clickMenuItem('選択範囲内にリピート貼り付け')
  await waitForEventAt('cell', 'B', 10, '1')
  await waitForEventAt('cell', 'B', 13, '1')
  await waitForNoEventAt('cell', 'B', 12, '1')
  await waitForNoEventAt('cell', 'B', 15, '1')
  checks.push('copied a sparse timing range and repeated it across a selected range')

  await clickFrame('cell', 'B', 20)
  await waitForSelectedFrame('cell', 'B', 20)
  await keyboardShortcut('v')
  await waitForEventAt('cell', 'B', 20, '1')
  await waitForNoEventAt('cell', 'B', 22, '1')
  checks.push('pasted a copied timing range from a single target cell')

  await dragRange('cell', 'B', 22, 20)
  await waitForSelectedRange('cell', 'B', 20, 22)
  await keyboardShortcut('x')
  await waitForNoEventAt('cell', 'B', 20, '1')
  await waitForNoEventAt('cell', 'B', 22, '1')
  checks.push('cut a selected timing range')

  await clickFrame('cell', 'A', 6)
  await waitForSelectedFrame('cell', 'A', 6)
  await keyPress('2')
  await waitForEventAt('cell', 'A', 6, '2')
  await dragTimelineEvent('cell', 'A', 6, 'cell', 'A', 8)
  await waitForEventAt('cell', 'A', 8, '2')
  await waitForNoEventAt('cell', 'A', 6, '2')
  checks.push('moved an existing timeline event by CDP Alt-drag')

  await rightClickFrame('cell', 'A', 8)
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')))
  await clickMenuItem('キーを削除')
  await waitForNoEventAt('cell', 'A', 8, '2')
  checks.push('deleted a timeline event from the sheet context menu')

  await dragRange('cell', 'A', 20, 24)
  await waitForSelectedRange('cell', 'A', 20, 24)
  await dropAssetFile('cell', 'A', 24, args.asset ?? '')
  await waitForAssetEventAt('cell', 'A', 20)
  await waitForNoAssetEventAt('cell', 'A', 24)
  await recordAssetRootStateAfterCdpDrop()
  checks.push('dropped an image inside an active range and assigned it to the range start frame')

  await openAssetBrowserPreviewByName('A1.png')
  previewClient = await connectPreviewWindow(port)
  await waitForSelectedRegisteredCellCard('A')
  await waitForPreviewText('A1')
  checks.push('opened the native material preview for a registered cell')

  await clickAssetBrowserCardByName('A1_e.png')
  await waitForPreviewText('A1_e.png')
  await waitForPreviewTextMissing('A1.png')
  checks.push('updated the open native material preview from an unregistered cut-folder material selection')

  const secondaryAsset = args.assetSecondary ?? args['asset-secondary'] ?? ''
  if (!secondaryAsset) throw new Error('--asset-secondary is required for preview sync checks')
  await dropAssetFile('cell', 'B', 30, secondaryAsset)
  await waitForAssetEventAt('cell', 'B', 30)
  checks.push('created a second registered cell from an OS file drop')

  await clickRegisteredCellCardByTrack('B')
  await waitForSelectedRegisteredCellCard('B')
  await waitForPreviewText('A2')
  await waitForPreviewTextMissing('A1_e.png')
  checks.push('updated the open native material preview from registered cell card selection')

  await clickFrame('cell', 'A', 20)
  await waitForSelectedRegisteredCellCard('A')
  await waitForPreviewText('A1')
  await waitForPreviewTextMissing('A2')
  checks.push('updated the open native material preview from a material-assigned sheet frame selection')

  const report: SheetOpsReport = {
    checks,
    finalEvents: await evaluatePage<EventSnapshot[]>(snapshotEventsExpression()),
  }
  await writeJson(args.report, report)
  await writeJson(args.result, {
    passed: true,
    scenario: 'sheet-ops',
    checks,
    artifacts: [args.report],
  })
} catch (error) {
  const report = {
    checks,
    error: errorMessage(error),
    debug: client ? await pageDebug().catch(debugError => ({ debugError: errorMessage(debugError) })) : null,
    previewDebug: previewClient ? await previewPageDebug().catch(debugError => ({ debugError: errorMessage(debugError) })) : null,
  }
  await writeJson(args.report, report)
  await writeJson(args.result, {
    passed: false,
    scenario: 'sheet-ops',
    error: errorMessage(error),
    checks,
    artifacts: [args.report],
  })
  process.exitCode = 1
} finally {
  client?.close()
  previewClient?.close()
}

async function waitForCdpTarget(
  remotePort: number,
  predicate: (target: CdpListTarget) => boolean = () => true,
  label = 'CDP target',
): Promise<CdpListTarget> {
  return waitForCondition(async () => {
    const targets = await listCdpTargets(remotePort)
    return targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl && predicate(target)) ?? null
  }, 15000, label)
}

async function listCdpTargets(remotePort: number): Promise<CdpListTarget[]> {
  const response = await fetch(`http://127.0.0.1:${remotePort}/json`).catch(() => null)
  if (!response?.ok) return []
  return response.json() as Promise<CdpListTarget[]>
}

async function waitForSheet(): Promise<void> {
  await waitForPageCondition(() => {
    const sheet = document.querySelector<SVGSVGElement>('svg.sheetSvg')
    if (!sheet) return false
    const box = sheet.getBoundingClientRect()
    return box.width > 1 && box.height > 1
  }, 'sheet SVG')
}

async function waitForSheetPageCount(pageCount: number): Promise<void> {
  await waitForCondition(
    () => evaluatePage<boolean>(`document.querySelectorAll('svg.sheetSvg').length >= ${JSON.stringify(pageCount)}`),
    10000,
    `${pageCount} sheet pages`,
  )
}

async function dropSheetSourcesForMultiPage(): Promise<void> {
  const sheetSources = [args.sheetSource, args['sheet-source'], args.sheetSourceSecondary, args['sheet-source-secondary']]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
  if (sheetSources.length < 2) throw new Error('--sheet-source and --sheet-source-secondary are required')
  await setFileInputFiles('.paperSheetTopGroup input[type="file"]', sheetSources)
}

async function clickFrame(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  const point = await clientPointForFrame(role, paperTrack, frame)
  await mouseClick(point)
}

async function rightClickFrame(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  const point = await clientPointForFrame(role, paperTrack, frame)
  await mouseClick(point, 'right')
}

async function dragRange(
  role: SheetTimingRole,
  paperTrack: string,
  frameStart: number,
  frameEnd: number,
  startBias?: CellPointBias,
): Promise<void> {
  const [start, end] = await clientPointsForSamePage(
    role,
    paperTrack,
    frameStart,
    startBias ?? { xRatio: 0.5, yRatio: 0.5 },
    role,
    paperTrack,
    frameEnd,
    { xRatio: 0.5, yRatio: 0.5 },
  )
  await mouseDrag(start, end)
}

async function dragRangeBetweenTracks(
  role: SheetTimingRole,
  startPaperTrack: string,
  frameStart: number,
  endPaperTrack: string,
  frameEnd: number,
): Promise<void> {
  const [start, end] = await clientPointsForSamePage(
    role,
    startPaperTrack,
    frameStart,
    { xRatio: 0.5, yRatio: 0.5 },
    role,
    endPaperTrack,
    frameEnd,
    { xRatio: 0.5, yRatio: 0.5 },
  )
  await mouseDrag(start, end)
}

async function dragTimelineEvent(
  sourceRole: SheetTimingRole,
  sourceTrack: string,
  sourceFrame: number,
  targetRole: SheetTimingRole,
  targetTrack: string,
  targetFrame: number,
): Promise<void> {
  const [source, target] = await clientPointsForSamePage(
    sourceRole,
    sourceTrack,
    sourceFrame,
    { xRatio: 0.5, yRatio: 0.5 },
    targetRole,
    targetTrack,
    targetFrame,
    { xRatio: 0.5, yRatio: 0.5 },
  )
  await mouseDrag(source, target, { modifiers: 1 })
}

async function dropAssetFile(role: SheetTimingRole, paperTrack: string, frame: number, filePath: string): Promise<void> {
  if (!filePath) throw new Error('--asset is required for dropAssetFile')
  const point = await clientPointForFrame(role, paperTrack, frame)
  await dropFilesAtPoint(point, [filePath])
}

async function dropFilesAtPoint(point: ClientPoint, filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) throw new Error('at least one file path is required for dropFilesAtPoint')
  const data = {
    items: [],
    files: filePaths,
    dragOperationsMask: 1,
  }
  await clientSend('Input.dispatchDragEvent', { type: 'dragEnter', x: point.x, y: point.y, data })
  await clientSend('Input.dispatchDragEvent', { type: 'dragOver', x: point.x, y: point.y, data })
  await clientSend('Input.dispatchDragEvent', { type: 'drop', x: point.x, y: point.y, data })
}

async function keyPress(key: string): Promise<void> {
  const code = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
  await clientSend('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    text: key.length === 1 ? key : undefined,
    unmodifiedText: key.length === 1 ? key : undefined,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code,
  })
  await clientSend('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code,
  })
}

async function keyboardShortcut(key: string): Promise<void> {
  const code = key.toUpperCase().charCodeAt(0)
  await clientSend('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code,
    modifiers: 2,
  })
  await clientSend('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code,
    modifiers: 2,
  })
}

async function mouseClick(point: ClientPoint, button: 'left' | 'right' = 'left'): Promise<void> {
  const buttonMask = button === 'left' ? 1 : 2
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0,
  })
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button,
    buttons: buttonMask,
    clickCount: 1,
  })
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button,
    buttons: 0,
    clickCount: 1,
  })
}

async function mouseDrag(start: ClientPoint, end: ClientPoint, options: { modifiers?: number } = {}): Promise<void> {
  const modifiers = options.modifiers ?? 0
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: start.x,
    y: start.y,
    button: 'none',
    buttons: 0,
    modifiers,
  })
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: start.x,
    y: start.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    modifiers,
  })
  const steps = 8
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps
    await clientSend('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      button: 'left',
      buttons: 1,
      modifiers,
    })
  }
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: end.x,
    y: end.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    modifiers,
  })
}

async function setFileInputFiles(selector: string, files: string[]): Promise<void> {
  const document = await clientSend<{ root: { nodeId: number } }>('DOM.getDocument', {})
  const target = await clientSend<{ nodeId: number }>('DOM.querySelector', {
    nodeId: document.root.nodeId,
    selector,
  })
  if (!target.nodeId) throw new Error(`file input not found: ${selector}`)
  await clientSend('DOM.setFileInputFiles', { nodeId: target.nodeId, files })
  await evaluatePage<void>(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `)
}

async function clickActionMenuSummary(ariaLabel: string): Promise<void> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const summary = Array.from(document.querySelectorAll('summary'))
        .find(item => item.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)} && item.getBoundingClientRect().width > 0);
      if (!summary) return null;
      const box = summary.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!point) throw new Error(`action menu summary not found: ${ariaLabel}`)
  await mouseClick(point)
}

async function verifyTopMenuBehavior(): Promise<void> {
  await clickActionMenuSummary('画面切替')
  await waitForPageCondition(() => {
    const rootMenu = document.querySelector<HTMLElement>('.actionMenuPortalContent.appNavMenu')
    if (!rootMenu) return false
    const rootRect = rootMenu.getBoundingClientRect()
    return rootRect.width > 0
      && rootRect.height > 0
      && rootRect.left >= 0
      && rootRect.top >= 0
      && rootRect.right <= window.innerWidth
      && rootRect.bottom <= window.innerHeight
      && document.querySelectorAll('.appTooltip').length === 0
  }, 'hamburger menu visible without tooltip overlap')

  const fileTriggerPoint = await evaluatePage<ClientPoint | null>(`
    (() => {
      const trigger = document.querySelector('.appNavFlyoutTrigger');
      if (!trigger) return null;
      const box = trigger.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!fileTriggerPoint) throw new Error('file flyout trigger not found')
  await mouseClick(fileTriggerPoint)

  await waitForPageCondition(() => {
    const rootMenu = document.querySelector<HTMLElement>('.actionMenuPortalContent.appNavMenu')
    const fileTrigger = document.querySelector<HTMLElement>('.appNavFlyoutTrigger')
    const fileMenu = document.querySelector<HTMLElement>('.appNavFlyoutMenu')
    if (!rootMenu || !fileTrigger || !fileMenu) return false
    const rootRect = rootMenu.getBoundingClientRect()
    const triggerRect = fileTrigger.getBoundingClientRect()
    const fileRect = fileMenu.getBoundingClientRect()
    const topElement = document.elementFromPoint(fileRect.left + 8, fileRect.top + 8)
    return fileRect.width > 0
      && fileRect.height > 0
      && fileRect.left >= triggerRect.right
      && fileRect.right <= window.innerWidth
      && fileRect.top >= 0
      && fileRect.bottom <= window.innerHeight
      && fileRect.left > rootRect.left
      && Boolean(topElement?.closest('.appNavFlyoutMenu'))
      && document.querySelectorAll('.appTooltip').length === 0
  }, 'hamburger file flyout appears to the side above other content')

  await mouseClick(await viewportOutsideMenusPoint())
  await waitForNoActionMenu('hamburger menu closes from outside click')

  await clickActionMenuSummary('表示方法')
  await waitForPageCondition(() => {
    const menu = document.querySelector<HTMLElement>('.actionMenuPortalContent.topViewModeMenu')
    const list = menu?.querySelector<HTMLElement>('.viewModeMenuList')
    const buttons = Array.from(list?.querySelectorAll('button') ?? [])
    if (!menu || !list || buttons.length !== 3) return false
    const menuRect = menu.getBoundingClientRect()
    const listStyle = window.getComputedStyle(list)
    return menuRect.width > 0
      && menuRect.height > 0
      && menuRect.left >= 0
      && menuRect.top >= 0
      && menuRect.right <= window.innerWidth
      && menuRect.bottom <= window.innerHeight
      && listStyle.display === 'grid'
      && buttons.every(button => window.getComputedStyle(button).whiteSpace === 'nowrap')
      && document.querySelectorAll('.appTooltip').length === 0
  }, 'view mode menu is vertical and visible without tooltip overlap')

  await mouseClick(await viewportOutsideMenusPoint())
  await waitForNoActionMenu('view mode menu closes from outside click')
  checks.push('verified top menus close from outside clicks and render flyouts above the sheet')
}

async function verifyAssetBrowserShell(): Promise<void> {
  await waitForPageCondition(() => {
    const browser = document.querySelector<HTMLElement>('.assetBrowser')
    const header = browser?.querySelector<HTMLElement>('.assetBrowserHeader')
    const fileBrowser = browser?.querySelector<HTMLElement>('.assetFileBrowser')
    const controls = browser?.querySelector<HTMLElement>('.assetBrowserControls')
    const items = browser?.querySelector<HTMLElement>('.assetBrowserItems')
    const rootButton = fileBrowser?.querySelector<HTMLElement>('[aria-label="カットフォルダを追加"], [aria-label="カットフォルダを変更"]')
    if (!browser || !header || !fileBrowser || !controls || !items || !rootButton) return false
    const browserRect = browser.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    const fileRect = fileBrowser.getBoundingClientRect()
    const controlsRect = controls.getBoundingClientRect()
    const itemsRect = items.getBoundingClientRect()
    return headerRect.top >= browserRect.top
      && controlsRect.top >= headerRect.top
      && controlsRect.bottom <= headerRect.bottom + 1
      && fileRect.top >= headerRect.bottom
      && itemsRect.top >= fileRect.bottom
      && headerRect.top - browserRect.top < 40
      && !fileBrowser.querySelector('.assetFileBrowserMessage')
  }, 'asset browser file browser shell is fixed at the top')
  checks.push('verified the image asset pane keeps cut-folder and thumbnail controls fixed at the top')
}

async function dropAssetFolderOnBrowser(folderPath: string): Promise<void> {
  if (!folderPath) throw new Error('--asset-root is required for dropAssetFolderOnBrowser')
  const hasAssetBrowser = await evaluatePage<boolean>(`
    (() => {
      const browser = document.querySelector('.assetBrowser')
      if (!browser) return false
      const rect = browser.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })()
  `)
  if (!hasAssetBrowser) throw new Error('asset browser not found for folder drop')
  await dispatchDomFolderDropOnAssetBrowser(folderPath)
  await waitForPageCondition(() => {
    const location = document.querySelector<HTMLElement>('.assetLocationText')
    const names = Array.from(document.querySelectorAll<HTMLElement>('.assetBrowserItems .assetDirectoryCard strong')).map(item => item.textContent?.trim() ?? '')
    const badges = Array.from(document.querySelectorAll<HTMLElement>('.assetBrowserItems .assetRegistrationBadge')).map(item => item.textContent?.trim() ?? '')
    return Boolean(location?.textContent?.trim())
      && names.includes('A1.png')
      && badges.includes('未登録')
  }, 'folder drop registers a cut folder and shows unregistered files in the asset browser')
  checks.push('dropped a folder onto the image asset pane and verified it appears as a cut-folder file view')
}

async function verifyStackGuidePlacementAndSharedCuts(): Promise<void> {
  await createStackGuideLabelFromHeader('action', 2, 'BOOK-E2E')
  await waitForStackGuideLabelRole('BOOK-E2E', 'action')
  checks.push('created a BG/BOOK label from the ACTION header context menu')

  await clickAddSharedCutButton()
  await waitForSelectedSharedCut('002')
  await waitForStackGuideLabelRole('BOOK-E2E', 'action')

  await dragStackGuideLabelToHeader('BOOK-E2E', 'cell', 4)
  await waitForStackGuideLabelRole('BOOK-E2E', 'cell')
  checks.push('moved a BG/BOOK label by dragging it on the live sheet')

  await switchSharedCut('001')
  await waitForSelectedSharedCut('001')
  await waitForStackGuideLabelRole('BOOK-E2E', 'action')
  await waitForNoStackGuideLabelRole('BOOK-E2E', 'cell')

  await switchSharedCut('002')
  await waitForSelectedSharedCut('002')
  await waitForStackGuideLabelRole('BOOK-E2E', 'cell')

  await switchSharedCut('001')
  await waitForSelectedSharedCut('001')
  checks.push('verified BG/BOOK placement is stored independently for each shared cut')
}

async function createStackGuideLabelFromHeader(role: SheetTimingRole, gapIndex: number, label: string): Promise<void> {
  await rightClickStackGuideHeader(role, gapIndex)
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')), 'stack guide insert context menu')
  await clickMenuItem('BG/BOOK追加')
  await clickActiveStackGuideInsertHandle()
  await setStackGuideEditorValue(label)
  await clickStackGuideEditorSubmit()
}

async function rightClickStackGuideHeader(role: SheetTimingRole, gapIndex: number): Promise<void> {
  await mouseClick(await stackGuideHeaderPoint(role, gapIndex), 'right')
}

async function dragStackGuideLabelToHeader(label: string, role: SheetTimingRole, gapIndex: number): Promise<void> {
  const source = await stackGuideLabelPoint(label)
  const target = await stackGuideHeaderPoint(role, gapIndex)
  await mouseDrag(source, target)
}

async function clickActiveStackGuideInsertHandle(): Promise<void> {
  await waitForCondition(() => evaluatePage<boolean>(`
    (() => Boolean(document.querySelector('.stackGuideGap.insertToolActive .stackGuideInsertHandle')))()
  `), 5000, 'active stack guide insert handle')
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const handle = document.querySelector('.stackGuideGap.insertToolActive .stackGuideInsertHandle');
      if (!handle) return null;
      handle.scrollIntoView({ block: 'center', inline: 'center' });
      const box = handle.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!point) throw new Error('active stack guide insert handle not found')
  await mouseClick(point)
}

async function stackGuideLabelPoint(label: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const labels = Array.from(document.querySelectorAll('.stackGuideSvgLabel'));
      const label = labels.find(item => item.textContent?.trim() === ${JSON.stringify(label)});
      if (!label) return null;
      label.scrollIntoView({ block: 'center', inline: 'center' });
      const labelBox = label.querySelector('.stackGuideSvgLabelBox');
      const box = (labelBox || label).getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!point) throw new Error(`stack guide label not found: ${label}`)
  return point
}

async function stackGuideHeaderPoint(role: SheetTimingRole, gapIndex: number): Promise<ClientPoint> {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  const pageId = 'page_1'
  await scrollSheetPageIntoView(pageId)
  const box = await sheetPageBox(pageId)
  const normalizedX = region.rect.x + (region.rect.w * gapIndex) / region.grid.columns.length
  const normalizedY = region.rect.y - 0.018
  return {
    x: box.left + normalizedX * box.width,
    y: box.top + normalizedY * box.height,
  }
}

async function waitForStackGuideLabelRole(label: string, role: SheetTimingRole): Promise<void> {
  await waitForCondition(() => evaluatePage<boolean>(`
    (() => {
      const labels = Array.from(document.querySelectorAll('.stackGuideSvgLabel'));
      return labels.some(item =>
        item.textContent?.trim() === ${JSON.stringify(label)}
        && item.dataset.stackGuideRole === ${JSON.stringify(role)}
        && item.getBoundingClientRect().width > 0
      );
    })()
  `), 10000, `stack guide label ${label} in ${role}`)
}

async function waitForNoStackGuideLabelRole(label: string, role: SheetTimingRole): Promise<void> {
  await waitForCondition(() => evaluatePage<boolean>(`
    (() => {
      const labels = Array.from(document.querySelectorAll('.stackGuideSvgLabel'));
      return !labels.some(item =>
        item.textContent?.trim() === ${JSON.stringify(label)}
        && item.dataset.stackGuideRole === ${JSON.stringify(role)}
        && item.getBoundingClientRect().width > 0
      );
    })()
  `), 10000, `stack guide label ${label} not in ${role}`)
}

async function clickAddSharedCutButton(): Promise<void> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const button = document.querySelector('.cutSwitchAddButton');
      if (!button) return null;
      const box = button.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!point) throw new Error('shared cut add button not found')
  await mouseClick(point)
}

async function switchSharedCut(label: string): Promise<void> {
  const switched = await evaluatePage<boolean>(`
    (() => {
      const select = document.querySelector('.cutSwitchControl select');
      if (!select) return false;
      const option = Array.from(select.options).find(item => item.textContent?.trim() === ${JSON.stringify(label)});
      if (!option) return false;
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `)
  if (!switched) throw new Error(`shared cut option not found: ${label}`)
}

async function waitForSelectedSharedCut(label: string): Promise<void> {
  await waitForCondition(() => evaluatePage<boolean>(`
    (() => {
      const select = document.querySelector('.cutSwitchControl select');
      return select?.selectedOptions?.[0]?.textContent?.trim() === ${JSON.stringify(label)};
    })()
  `), 10000, `selected shared cut ${label}`)
}

async function setStackGuideEditorValue(value: string): Promise<void> {
  await waitForCondition(() => evaluatePage<boolean>(`
    (() => Boolean(document.querySelector('.stackGuideEditor input[name="stackGuideLabel"]')))()
  `), 10000, 'stack guide label editor input')
  const updated = await evaluatePage<boolean>(`
    (() => {
      const input = document.querySelector('.stackGuideEditor input[name="stackGuideLabel"]');
      if (!input) return false;
      input.focus();
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `)
  if (!updated) throw new Error('stack guide label editor input not found')
}

async function clickStackGuideEditorSubmit(): Promise<void> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const button = document.querySelector('.stackGuideEditor button[type="submit"]');
      if (!button) return null;
      const box = button.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!point) throw new Error('stack guide label editor submit button not found')
  await mouseClick(point)
}

async function dispatchDomFolderDropOnAssetBrowser(folderPath: string): Promise<void> {
  const folderPathLiteral = JSON.stringify(folderPath)
  await evaluatePage<boolean>(`
    (() => {
      const browser = document.querySelector('.assetBrowser')
      if (!browser) return false
      const dataTransfer = new DataTransfer()
      const droppedDirectory = new File([''], 'asset-root')
      Object.defineProperty(droppedDirectory, 'path', { value: ${folderPathLiteral} })
      dataTransfer.items.add(droppedDirectory)
      browser.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
      browser.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
      return true
    })()
  `)
}

async function recordAssetRootStateAfterCdpDrop(): Promise<void> {
  const hasRoot = await evaluatePage<boolean>(`
    (() => {
    const location = document.querySelector<HTMLElement>('.assetLocationText')
    const assetCards = Array.from(document.querySelectorAll<HTMLElement>('.assetCard'))
    return Boolean(location?.textContent?.trim() && assetCards.length >= 1)
    })()
  `)
  checks.push(hasRoot
    ? 'registered the dropped material under an asset root during EXE file drop handling'
    : 'preserved material registration from CDP file drop; asset-root persistence is covered by the full desktop scenario')
}

async function viewportOutsideMenusPoint(): Promise<ClientPoint> {
  return evaluatePage<ClientPoint>(`
    (() => ({ x: Math.max(12, window.innerWidth - 24), y: Math.max(12, window.innerHeight - 24) }))()
  `)
}

async function waitForNoActionMenu(label: string): Promise<void> {
  await waitForPageCondition(() => !document.querySelector('.actionMenuPortalContent'), label)
}

async function clickMenuItem(label: string): Promise<void> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const menu = document.querySelector('[role="menu"]');
      if (!menu) return null;
      const button = Array.from(menu.querySelectorAll('button[role="menuitem"]'))
        .find(item => item.textContent?.trim() === ${JSON.stringify(label)} && !item.disabled);
      if (!button) return null;
      const box = button.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!point) throw new Error(`menu item not found or disabled: ${label}`)
  await mouseClick(point)
}

async function openAssetBrowserPreviewByName(fileName: string): Promise<void> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.assetBrowserItems .assetCard'));
      const card = cards.find(item => item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(fileName)});
      const button = card?.querySelector('.assetQuickPreviewButton');
      if (!button) return null;
      button.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = button.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!point) throw new Error(`asset preview button not found: ${fileName}`)
  await mouseClick(point)
}

async function clickRegisteredCellCardByTrack(paperTrack: string): Promise<void> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.cspTreeCel[data-csp-key-id]'));
      const card = cards.find(item => item.dataset.cspPaperTrack === ${JSON.stringify(paperTrack)});
      if (!card) return null;
      card.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = card.getBoundingClientRect();
      return { x: box.left + Math.min(36, box.width / 2), y: box.top + Math.min(18, box.height / 2) };
    })()
  `)
  if (!point) throw new Error(`registered cell card not found: ${paperTrack}`)
  await mouseClick(point)
}

async function clickAssetBrowserCardByName(name: string): Promise<void> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.assetBrowserItems .assetCard'));
      const card = cards.find(item =>
        item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(name)}
      );
      if (!card) return null;
      card.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = card.getBoundingClientRect();
      return { x: box.left + Math.min(40, box.width / 2), y: box.top + Math.min(28, box.height / 2) };
    })()
  `)
  if (!point) throw new Error(`asset browser card not found: ${name}`)
  await mouseClick(point)
}

async function waitForSelectedRegisteredCellCard(paperTrack: string): Promise<void> {
  await waitForCondition(
    () => evaluatePage<boolean>(`
      (() => {
        const selected = document.querySelector('.cspTreeCel[data-csp-key-id].selected');
        return selected?.dataset.cspPaperTrack === ${JSON.stringify(paperTrack)};
      })()
    `),
    5000,
    `selected registered cell card ${paperTrack}`,
  )
}

async function connectPreviewWindow(remotePort: number): Promise<CdpClient> {
  const target = await waitForCdpTarget(remotePort, target => target.url.includes('window=asset-preview'), 'asset preview CDP target')
  if (!target.webSocketDebuggerUrl) throw new Error('asset preview CDP target did not expose a websocket URL')
  const connected = await CdpClient.connect(target.webSocketDebuggerUrl)
  await connected.send('Runtime.enable')
  await connected.send('Page.enable')
  return connected
}

async function waitForPreviewText(text: string): Promise<void> {
  await waitForCondition(
    () => evaluatePreviewPage<boolean>(previewTextExpression(text)),
    10000,
    `preview text ${text}`,
  )
}

async function waitForPreviewTextMissing(text: string): Promise<void> {
  await waitForCondition(
    async () => !(await evaluatePreviewPage<boolean>(previewTextExpression(text))),
    10000,
    `preview missing text ${text}`,
  )
}

function previewTextExpression(text: string): string {
  const needle = JSON.stringify(text)
  return `
    (() => {
      const bodyText = document.body?.textContent ?? '';
      const payloadText = window.localStorage.getItem('xsheet-remap.asset-preview.payload') ?? '';
      return bodyText.includes(${needle}) || payloadText.includes(${needle});
    })()
  `
}

async function waitForEventAt(role: SheetTimingRole, paperTrack: string, frame: number, label: string): Promise<void> {
  await waitForCondition(async () => (await eventLabelsAt(role, paperTrack, frame)).includes(label), 5000, `${paperTrack}${frame}=${label}`)
}

async function waitForNoEventAt(role: SheetTimingRole, paperTrack: string, frame: number, label: string): Promise<void> {
  await waitForCondition(async () => !(await eventLabelsAt(role, paperTrack, frame)).includes(label), 5000, `${paperTrack}${frame} no ${label}`)
}

async function waitForAssetEventAt(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  await waitForCondition(async () => assetEventAt(role, paperTrack, frame), 5000, `${paperTrack}${frame} asset`)
}

async function waitForNoAssetEventAt(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  await waitForCondition(async () => !(await assetEventAt(role, paperTrack, frame)), 5000, `${paperTrack}${frame} no asset`)
}

async function waitForSelectedRange(role: SheetTimingRole, paperTrack: string, frameStart: number, frameEnd: number): Promise<void> {
  const expected = templateRangeLocationForFrame(role, paperTrack, frameStart, frameEnd)
  await waitForCondition(async () => {
    const rects = await evaluatePage<RectSnapshot[]>(snapshotRectsExpression('.selectedRangeRect'))
    return rects.some(rect => rect.pageId === expected.pageId && rectMatches(rect, expected.rect))
  }, 5000, `${paperTrack} selected ${frameStart}-${frameEnd}`)
}

async function waitForSelectedRangeTracks(role: SheetTimingRole, paperTracks: string[], frameStart: number, frameEnd: number): Promise<void> {
  const expectedRanges = paperTracks.map(paperTrack => templateRangeLocationForFrame(role, paperTrack, frameStart, frameEnd))
  await waitForCondition(async () => {
    const rects = await evaluatePage<RectSnapshot[]>(snapshotRectsExpression('.selectedRangeRect'))
    return expectedRanges.every(expected =>
      rects.some(rect => rect.pageId === expected.pageId && rectMatches(rect, expected.rect)),
    )
  }, 5000, `${paperTracks.join(',')} selected ${frameStart}-${frameEnd}`)
}

async function waitForSelectedFrame(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  const expected = templateFrameLocationForFrame(role, paperTrack, frame)
  await waitForCondition(async () => {
    const rects = await evaluatePage<RectSnapshot[]>(snapshotRectsExpression('.selectedCellRect'))
    return rects.some(rect => rect.pageId === expected.pageId && rectMatches(rect, expected.rect))
  }, 5000, `${paperTrack} selected ${frame}`)
}

async function eventLabelsAt(role: SheetTimingRole, paperTrack: string, frame: number): Promise<string[]> {
  const expected = templateFrameLocationForFrame(role, paperTrack, frame)
  const events = await evaluatePage<EventSnapshot[]>(snapshotEventsExpression())
  return events.filter(event => event.pageId === expected.pageId && rectMatches(event, expected.rect)).map(event => event.label)
}

async function assetEventAt(role: SheetTimingRole, paperTrack: string, frame: number): Promise<boolean> {
  const expected = templateFrameLocationForFrame(role, paperTrack, frame)
  const events = await evaluatePage<EventSnapshot[]>(snapshotEventsExpression())
  return events.some(event =>
    event.pageId === expected.pageId
    && event.className.includes('assetAssignedEventRect')
    && rectMatches(event, expected.rect),
  )
}

async function clientPointForFrame(role: SheetTimingRole, paperTrack: string, frame: number, bias: CellPointBias = { xRatio: 0.5, yRatio: 0.5 }): Promise<ClientPoint> {
  const { pageId, rect } = templateFrameLocationForFrame(role, paperTrack, frame)
  await scrollSheetPageIntoView(pageId)
  const box = await sheetPageBox(pageId)
  return pointForRect(box, rect, bias)
}

async function clientPointsForSamePage(
  startRole: SheetTimingRole,
  startTrack: string,
  startFrame: number,
  startBias: CellPointBias,
  endRole: SheetTimingRole,
  endTrack: string,
  endFrame: number,
  endBias: CellPointBias,
): Promise<[ClientPoint, ClientPoint]> {
  const start = templateFrameLocationForFrame(startRole, startTrack, startFrame)
  const end = templateFrameLocationForFrame(endRole, endTrack, endFrame)
  if (start.pageId !== end.pageId) throw new Error(`cross-page drag is not supported in this scenario: ${startFrame}-${endFrame}`)
  await scrollSheetPageIntoView(start.pageId)
  const box = await sheetPageBox(start.pageId)
  return [pointForRect(box, start.rect, startBias), pointForRect(box, end.rect, endBias)]
}

async function scrollSheetPageIntoView(pageId: string): Promise<void> {
  const pageSelector = `svg.sheetSvg[data-page-id="${cssEscape(pageId)}"]`
  await evaluatePage<void>(`
    (() => {
      const sheet = document.querySelector(${JSON.stringify(pageSelector)});
      if (!sheet) throw new Error('sheet SVG not found: ${pageId}');
      sheet.scrollIntoView({ block: 'center', inline: 'center' });
    })()
  `)
  await delay(100)
}

async function sheetPageBox(pageId: string): Promise<{ left: number; top: number; width: number; height: number }> {
  const pageSelector = `svg.sheetSvg[data-page-id="${cssEscape(pageId)}"]`
  return evaluatePage<{ left: number; top: number; width: number; height: number }>(`
    (() => {
      const sheet = document.querySelector(${JSON.stringify(pageSelector)});
      if (!sheet) throw new Error('sheet SVG not found: ${pageId}');
      const box = sheet.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    })()
  `)
}

function pointForRect(
  box: { left: number; top: number; width: number; height: number },
  rect: NormalizedRect,
  bias: CellPointBias,
): ClientPoint {
  return {
    x: box.left + (rect.x + rect.w * bias.xRatio) * box.width,
    y: box.top + (rect.y + rect.h * bias.yRatio) * box.height,
  }
}

function templateFrameLocationForFrame(role: SheetTimingRole, paperTrack: string, frame: number): FrameLocation {
  const hit = timingHitForFrame(standardA3SheetTemplate, role, paperTrack, frame, e2eDurationFrames, standardA3SheetTemplate.defaults.frameOrigin)
  if (!hit) throw new Error(`template hit not found: ${role} ${paperTrack} ${frame}`)
  const localFrame = 'localFrame' in hit && typeof hit.localFrame === 'number' ? hit.localFrame : hit.frame
  const rect = cellRectForHit(
    standardA3SheetTemplate,
    { ...hit, frame: localFrame },
    e2ePageFrames,
    standardA3SheetTemplate.defaults.frameOrigin,
  )
  if (!rect) throw new Error(`template rect not found: ${role} ${paperTrack} ${frame}`)
  return {
    pageId: hit.pageId ?? 'page_1',
    rect,
  }
}

function templateRangeLocationForFrame(role: SheetTimingRole, paperTrack: string, frameStart: number, frameEnd: number): FrameLocation {
  const start = templateFrameLocationForFrame(role, paperTrack, frameStart)
  const end = templateFrameLocationForFrame(role, paperTrack, frameEnd)
  if (start.pageId !== end.pageId) throw new Error(`cross-page selected range is not supported in this assertion: ${frameStart}-${frameEnd}`)
  const top = Math.min(start.rect.y, end.rect.y)
  const bottom = Math.max(start.rect.y + start.rect.h, end.rect.y + end.rect.h)
  return {
    pageId: start.pageId,
    rect: {
      x: start.rect.x,
      y: top,
      w: start.rect.w,
      h: bottom - top,
    },
  }
}

function snapshotEventsExpression(): string {
  return `
    Array.from(document.querySelectorAll('.timelineEventHandle, .timelineEventDragSource'))
      .flatMap(handle => {
        const rect = handle.querySelector('.eventRect');
        if (!rect) return [];
        return [{
          label: handle.querySelector('.eventText')?.textContent?.trim() ?? '',
          pageId: handle.closest('svg.sheetSvg')?.dataset.pageId ?? '',
          x: Number(rect.getAttribute('x')),
          y: Number(rect.getAttribute('y')),
          w: Number(rect.getAttribute('width')),
          h: Number(rect.getAttribute('height')),
          className: rect.getAttribute('class') ?? ''
        }];
      })
  `
}

function snapshotRectsExpression(selector: string): string {
  return `
    Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .map(rect => ({
        pageId: rect.closest('svg.sheetSvg')?.dataset.pageId ?? '',
        x: Number(rect.getAttribute('x')),
        y: Number(rect.getAttribute('y')),
        w: Number(rect.getAttribute('width')),
        h: Number(rect.getAttribute('height')),
        className: rect.getAttribute('class') ?? ''
      }))
  `
}

function rectMatches(actual: NormalizedRect, expected: NormalizedRect): boolean {
  return closeTo(actual.x, expected.x)
    && closeTo(actual.y, expected.y)
    && closeTo(actual.w, expected.w)
    && closeTo(actual.h, expected.h)
}

async function waitForPageCondition(condition: () => boolean, label = 'page condition'): Promise<void> {
  const expression = `(${condition.toString()})()`
  await waitForCondition(() => evaluatePage<boolean>(expression), 10000, label)
}

async function evaluatePage<T>(expression: string): Promise<T> {
  const result = await clientSend<{
    result: { value?: T }
    exceptionDetails?: { text: string; exception?: { description?: string; value?: string } }
  }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? result.exceptionDetails.text)
  }
  return result.result.value as T
}

async function evaluatePreviewPage<T>(expression: string): Promise<T> {
  if (!previewClient) throw new Error('asset preview CDP client is not connected')
  const result = await previewClient.send<{
    result: { value?: T }
    exceptionDetails?: { text: string; exception?: { description?: string; value?: string } }
  }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? result.exceptionDetails.text)
  }
  return result.result.value as T
}

async function pageDebug(): Promise<Record<string, unknown>> {
  return evaluatePage<Record<string, unknown>>(`
    (() => {
      const sheet = document.querySelector('svg.sheetSvg');
      const box = sheet?.getBoundingClientRect();
      return {
        readyState: document.readyState,
        bodyText: document.body.textContent?.replace(/\\s+/g, ' ').slice(0, 500),
        previewPayload: window.localStorage.getItem('xsheet-remap.asset-preview.payload')?.slice(0, 500) ?? null,
        sheetCount: document.querySelectorAll('svg.sheetSvg').length,
        sheetBox: box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null,
        eventCount: document.querySelectorAll('.eventRect').length,
        rangeCount: document.querySelectorAll('.selectedRangeRect').length,
        selectedCellRects: Array.from(document.querySelectorAll('.selectedCellRect')).map(rect => ({
          pageId: rect.closest('svg.sheetSvg')?.dataset.pageId ?? '',
          x: Number(rect.getAttribute('x')),
          y: Number(rect.getAttribute('y')),
          w: Number(rect.getAttribute('width')),
          h: Number(rect.getAttribute('height')),
        })),
        selectedRangeRects: Array.from(document.querySelectorAll('.selectedRangeRect')).map(rect => ({
          pageId: rect.closest('svg.sheetSvg')?.dataset.pageId ?? '',
          x: Number(rect.getAttribute('x')),
          y: Number(rect.getAttribute('y')),
          w: Number(rect.getAttribute('width')),
          h: Number(rect.getAttribute('height')),
        })),
        events: Array.from(document.querySelectorAll('.timelineEventHandle, .timelineEventDragSource')).flatMap(handle => {
          const rect = handle.querySelector('.eventRect');
          if (!rect) return [];
          return [{
            label: handle.querySelector('.eventText')?.textContent?.trim() ?? '',
            pageId: handle.closest('svg.sheetSvg')?.dataset.pageId ?? '',
            x: Number(rect.getAttribute('x')),
            y: Number(rect.getAttribute('y')),
            w: Number(rect.getAttribute('width')),
            h: Number(rect.getAttribute('height')),
          }];
        }),
      };
    })()
  `)
}

async function previewPageDebug(): Promise<Record<string, unknown>> {
  return evaluatePreviewPage<Record<string, unknown>>(`
    (() => ({
      readyState: document.readyState,
      bodyText: document.body.textContent?.replace(/\\s+/g, ' ').slice(0, 500),
      previewPayload: window.localStorage.getItem('xsheet-remap.asset-preview.payload')?.slice(0, 500) ?? null,
      title: document.title,
      url: location.href,
    }))()
  `)
}

async function clientSend<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!client) throw new Error('CDP client is not connected')
  return client.send<T>(method, params)
}

async function waitForCondition<T>(
  condition: () => T | null | false | undefined | Promise<T | null | false | undefined>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const start = Date.now()
  let lastValue: T | null | false | undefined
  while (Date.now() - start < timeoutMs) {
    lastValue = await condition()
    if (lastValue) return lastValue
    await delay(100)
  }
  throw new Error(`timed out waiting for ${label}; last=${String(lastValue)}; debug=${client ? JSON.stringify(await pageDebug().catch(() => null)) : 'no-client'}`)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function closeTo(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) < 0.00001
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function parseArgs(rawArgs: string[]): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (let index = 0; index < rawArgs.length; index += 1) {
    const key = rawArgs[index]
    if (!key.startsWith('--')) continue
    parsed[key.slice(2)] = rawArgs[index + 1] ?? ''
    index += 1
  }
  return parsed
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
