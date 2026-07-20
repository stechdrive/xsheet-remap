import { execFile } from 'node:child_process'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  cellRectForHit,
  resolveSheetTemplateGridLayout,
  timingHitForFrame,
  standardA3SheetTemplate,
  type NormalizedRect,
  type SheetTimingRole,
} from '@xsheet-remap/core'

interface ClientPoint {
  x: number
  y: number
}

interface ScreenPoint {
  x: number
  y: number
}

type MouseButton = 'left' | 'right'

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

interface ViewportMetrics {
  screenX: number
  screenY: number
  outerWidth: number
  outerHeight: number
  innerWidth: number
  innerHeight: number
  devicePixelRatio: number
}

interface WindowClientMetrics {
  ok: boolean
  command: string
  client: { x: number; y: number; width: number; height: number }
  window: { left: number; top: number; right: number; bottom: number }
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

const execFileAsync = promisify(execFile)
const args = parseArgs(process.argv.slice(2))
const port = Number(args.port)
if (!Number.isInteger(port) || port <= 0) throw new Error('--port is required')
if (!args.result) throw new Error('--result is required')
if (!args.report) throw new Error('--report is required')
if (!args.python) throw new Error('--python is required')
if (!args['app-pid']) throw new Error('--app-pid is required')
if (!args['test-case']) throw new Error('--test-case is required')
if (!args['scenario-id']) throw new Error('--scenario-id is required')
if (!args['screenshot-root']) throw new Error('--screenshot-root is required')
if (!['registered-cell', 'explorer-import', 'csp-pane', 'full'].includes(args['test-case'])) throw new Error(`unsupported --test-case: ${args['test-case']}`)
if (args['test-case'] !== 'registered-cell') {
  if (!args.folder) throw new Error('--folder is required')
  if (!args['allowed-root']) throw new Error('--allowed-root is required')
}
if (args['test-case'] === 'full' && !args['multi-folder']) throw new Error('--multi-folder is required')

const checks: string[] = []
const diagnostics: Record<string, unknown> = {}
const screenshots: string[] = []
let client: CdpClient | null = null

try {
  const target = await waitForCdpTarget(port, target => !target.url.includes('window=asset-preview'), 'main CDP target')
  if (!target.webSocketDebuggerUrl) throw new Error('CDP target did not expose a websocket URL')
  client = await CdpClient.connect(target.webSocketDebuggerUrl)
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await waitForSheet()
  await evaluatePage<void>('window.__xsheetDropDiagnostics = []')
  diagnostics.interactiveDesktop = await runMouseOpJson([
    'desktop-preflight',
    '--app-pid', args['app-pid'] as string,
  ])
  checks.push('confirmed an interactive Windows desktop and foreground input before running real-mouse assertions')

  if (args['test-case'] === 'registered-cell') {
    await runRegisteredCellRealDndScenario()
  } else if (args['test-case'] === 'explorer-import') {
    await runExplorerImportScenario()
  } else if (args['test-case'] === 'csp-pane' && args.mode === 'remap') {
    await runRemapCspPaneRealDndScenario()
  } else if (args.mode === 'remap') {
    await runRemapRealDndScenario()
  } else {
  await ensurePaneExpandedWithRealMouse('sheet-left-pane')
  await ensurePaneExpandedWithRealMouse('sheet-right-pane')
  await setSheetZoomForRealMouse(60)
  const folderDropClient = await assetBrowserDropPoint()
  const folderDropScreen = await clientToScreen(folderDropClient)
  diagnostics.folderDropClient = folderDropClient
  diagnostics.folderDropScreen = folderDropScreen
  await runExplorerDropAndWait(
    args.folder as string,
    folderDropScreen,
    () => waitForAssetBrowserFile('A1.png'),
    'asset browser folder import',
  )
  checks.push('dragged a real Windows folder from Explorer onto the asset browser and verified the cut-folder view')

  const assetClient = await assetCardPoint('A1.png')
  const assetScreen = await clientToScreen(assetClient)
  const assetGhostMoveScreen = await clientToScreen({ x: assetClient.x + 90, y: assetClient.y + 22 })
  await verifyPointerDragGhost(assetScreen, assetGhostMoveScreen, '.internalDragPreviewShell.pointerDragGhost .internalDragPreview', 'asset pointer drag ghost')
  checks.push('showed a real-mouse asset drag ghost while dragging an asset card')

  const frameClient = await framePoint('cell', 'A', 1)
  const frameScreen = await clientToScreen(frameClient)
  diagnostics.assetClient = assetClient
  diagnostics.assetScreen = assetScreen
  diagnostics.frameClient = frameClient
  diagnostics.frameScreen = frameScreen
  await realMouseDragInternalToSheet(assetScreen, frameScreen, frameClient, 'asset sheet drop', 'asset')
  await waitForAssetEventAt('cell', 'A', 1)
  checks.push('dragged an asset card with real mouse input and verified a registered material frame')

  const cardDropAssetClient = await assetCardPoint('A1_e.png')
  const cardDropAssetScreen = await clientToScreen(cardDropAssetClient)
  const registeredCellAssetTargetClient = await registeredCellCardPoint('A')
  const registeredCellAssetTargetScreen = await clientToScreen(registeredCellAssetTargetClient)
  diagnostics.cardDropAssetClient = cardDropAssetClient
  diagnostics.cardDropAssetScreen = cardDropAssetScreen
  diagnostics.registeredCellAssetTargetClient = registeredCellAssetTargetClient
  diagnostics.registeredCellAssetTargetScreen = registeredCellAssetTargetScreen
  await realMouseDrag(cardDropAssetScreen, registeredCellAssetTargetScreen)
  await waitForRegisteredCellCardAsset('A', 'A1_e.png')
  checks.push('dragged an asset card with real mouse input onto a CSP layer cell and assigned it to that process')

  const registeredCellClient = await registeredCellCardPoint('A')
  const registeredCellScreen = await clientToScreen(registeredCellClient)
  const registeredCellGhostMoveScreen = await clientToScreen({ x: registeredCellClient.x + 90, y: registeredCellClient.y + 22 })
  await verifyPointerDragGhost(registeredCellScreen, registeredCellGhostMoveScreen, '.internalDragPreviewShell.pointerDragGhost .internalDragPreview', 'registered cell pointer drag ghost')
  checks.push('showed a real-mouse registered-cell card drag ghost while dragging a registered cell card')

  const registeredCellTargetClient = await framePoint('cell', 'B', 1)
  const registeredCellTargetScreen = await clientToScreen(registeredCellTargetClient)
  diagnostics.registeredCellClient = registeredCellClient
  diagnostics.registeredCellScreen = registeredCellScreen
  diagnostics.registeredCellTargetClient = registeredCellTargetClient
  diagnostics.registeredCellTargetScreen = registeredCellTargetScreen
  await realMouseDragInternalToSheet(
    registeredCellScreen,
    registeredCellTargetScreen,
    registeredCellTargetClient,
    'registered-cell sheet drop',
    'registered-cell',
  )
  await waitForAssetEventAt('cell', 'B', 1)
  checks.push('dragged a registered cell card with real mouse input and verified a cloned material frame')

  const directFileClient = await framePoint('cell', 'B', 2, { yFraction: 0.75 })
  const directFileScreen = await clientToScreen(directFileClient)
  const directFilePath = args['direct-file'] ?? join(args.folder as string, 'A2.png')
  diagnostics.directFileClient = directFileClient
  diagnostics.directFileScreen = directFileScreen
  await runExplorerDrop(directFilePath, directFileScreen)
  await waitForAssetEventAt('cell', 'B', 2)
  checks.push('dragged a real Windows image file from Explorer directly onto a sheet frame')

  await verifyAssetDropOnlyRepeatPasteWithRealMouse()
  checks.push('repeated a material-drop-only registered frame into a selected range through the real EXE context menu')

  await dragSelectSheetRange('cell', 'A', 20, 24, 'range')
  checks.push('created a sheet timing range with real mouse dragging')

  const rangeDropAssetClient = await assetCardPoint('A2.png')
  const rangeDropAssetScreen = await clientToScreen(rangeDropAssetClient)
  const rangeDropTargetClient = await framePoint('cell', 'A', 24)
  const rangeDropTargetScreen = await clientToScreen(rangeDropTargetClient)
  diagnostics.rangeDropAssetClient = rangeDropAssetClient
  diagnostics.rangeDropAssetScreen = rangeDropAssetScreen
  diagnostics.rangeDropTargetClient = rangeDropTargetClient
  diagnostics.rangeDropTargetScreen = rangeDropTargetScreen
  await realMouseDragInternalToSheet(
    rangeDropAssetScreen,
    rangeDropTargetScreen,
    rangeDropTargetClient,
    'asset selected-range sheet drop',
    'asset',
  )
  await waitForAssetEventAt('cell', 'A', 20)
  await waitForNoAssetEventAt('cell', 'A', 24)
  checks.push('dragged an asset card into an active real-mouse range and verified assignment to the range start')

  await createStackGuideLabelFromHeader('action', 2, 'BOOK-REAL')
  await waitForStackGuideLabelRole('BOOK-REAL', 'action')
  const stackGuideCardAssetClient = await assetCardPoint('A2.png')
  const stackGuideCardAssetScreen = await clientToScreen(stackGuideCardAssetClient)
  const stackGuideCardClient = await stackGuideCardPoint('BOOK-REAL')
  const stackGuideCardScreen = await clientToScreen(stackGuideCardClient)
  diagnostics.stackGuideCardAssetClient = stackGuideCardAssetClient
  diagnostics.stackGuideCardAssetScreen = stackGuideCardAssetScreen
  diagnostics.stackGuideCardClient = stackGuideCardClient
  diagnostics.stackGuideCardScreen = stackGuideCardScreen
  await realMouseDrag(stackGuideCardAssetScreen, stackGuideCardScreen)
  await waitForStackGuideCardAsset('BOOK-REAL', 'A2.png')
  checks.push('dragged an asset card with real mouse input onto an additional CSP track')

  const stackGuideMovePoints = await stackGuideLabelToGridRolePoints('BOOK-REAL', 'cell')
  const stackGuideLabelClient = stackGuideMovePoints.label
  const stackGuideLabelScreen = await clientToScreen(stackGuideLabelClient)
  const stackGuideTargetClient = stackGuideMovePoints.target
  const stackGuideTargetScreen = await clientToScreen(stackGuideTargetClient)
  diagnostics.stackGuideLabelClient = stackGuideLabelClient
  diagnostics.stackGuideLabelScreen = stackGuideLabelScreen
  diagnostics.stackGuideTargetClient = stackGuideTargetClient
  diagnostics.stackGuideTargetScreen = stackGuideTargetScreen
  await realMouseDragStackGuideLabel('BOOK-REAL', stackGuideLabelScreen, stackGuideTargetScreen)
  await waitForStackGuideLabelRole('BOOK-REAL', 'cell')
  await waitForNoStackGuideLabelRole('BOOK-REAL', 'action')
  checks.push('dragged an additional-track label with real mouse input and verified its sheet placement moved')

  await normalizeSelectedRegisteredCellWithRealAssetFileName('A', 'A_02.png')
  checks.push('normalized a registered cell with real material filename renaming in the desktop EXE')
  }

  const scenario = args['scenario-id'] as string
  await writeJson(args.report, { passed: true, testCase: args['test-case'], checks, diagnostics })
  await writeJson(args.result, { passed: true, scenario, testCase: args['test-case'], checks, artifacts: [args.report, ...screenshotArtifacts()] })
} catch (error) {
  if (client) {
    await captureScreenshot('failure').catch(screenshotError => {
      diagnostics.failureScreenshotError = errorMessage(screenshotError)
    })
  }
  const kind = failureKind(error)
  const report = {
    passed: false,
    testCase: args['test-case'],
    failureKind: kind,
    checks,
    diagnostics,
    error: errorMessage(error),
    debug: client ? await pageDebug().catch(debugError => ({ debugError: errorMessage(debugError) })) : null,
  }
  await writeJson(args.report, report)
  const scenario = args['scenario-id'] as string
  await writeJson(args.result, { passed: false, scenario, testCase: args['test-case'], failureKind: kind, error: errorMessage(error), checks, artifacts: [args.report, ...screenshotArtifacts()] })
  process.exitCode = 1
} finally {
  client?.close()
}

async function runRegisteredCellRealDndScenario(): Promise<void> {
  await ensurePaneExpandedWithRealMouse('sheet-left-pane')
  await setSheetZoomForRealMouse(50)
  await waitForPageCondition(
    () => evaluatePage<boolean>(`Boolean(document.querySelector('.cspLayerTree .cspTreeCel[data-csp-paper-track="A"] .cspTreeCelName'))`),
    'registered-cell real DnD fixture',
  )

  const sourceState = await registeredCellCardState('A')
  diagnostics.registeredCellSourceState = sourceState
  if (sourceState.cursor !== 'grab') {
    throw new Error(`registered cell drag affordance should use a grab cursor, got ${JSON.stringify(sourceState.cursor)}`)
  }

  const targetClient = await framePoint('action', 'A', 1)
  if (await timelineEventAt('action', 'A', 1)) {
    throw new Error('registered-cell fixture unexpectedly already has an event at action A frame 1')
  }
  diagnostics.registeredCellTarget = { client: targetClient, screen: await clientToScreen(targetClient) }
  await captureScreenshot('registered-cell-before')

  const ghostSourceClient = await registeredCellCardPoint('A')
  const ghostSourceScreen = await clientToScreen(ghostSourceClient)
  const ghostMoveScreen = await clientToScreen({ x: ghostSourceClient.x + 56, y: ghostSourceClient.y + 18 })
  await verifyPointerDragGhost(
    ghostSourceScreen,
    ghostMoveScreen,
    '.internalDragPreviewShell.pointerDragGhost .internalDragPreview',
    'registered cell pointer drag ghost',
  )
  checks.push('showed and cleaned up the compact registered-cell drag ghost with real mouse input')

  const sourceClient = await registeredCellCardPoint('A')
  const sourceScreen = await clientToScreen(sourceClient)
  const targetScreen = await clientToScreen(targetClient)
  diagnostics.registeredCellSource = { client: sourceClient, screen: sourceScreen }
  diagnostics.registeredCellTarget = { client: targetClient, screen: targetScreen }
  await realMouseDragRegisteredCellToSheet(sourceScreen, targetScreen, targetClient)
  await waitForTimelineEventAt('action', 'A', 1)
  await waitForInternalPointerDragCleanup()
  await captureScreenshot('registered-cell-after')
  checks.push('dragged a fixture-backed CSP registered-cell card onto action A frame 1 at 50% zoom with the real mouse')
}

async function runExplorerImportScenario(): Promise<void> {
  await ensurePaneExpandedWithRealMouse('sheet-right-pane')
  const folderDropClient = await assetBrowserDropPoint()
  const folderDropScreen = await clientToScreen(folderDropClient)
  diagnostics.folderDropClient = folderDropClient
  diagnostics.folderDropScreen = folderDropScreen
  await captureScreenshot('explorer-import-before')
  await runExplorerDropAndWait(
    args.folder as string,
    folderDropScreen,
    () => waitForAssetBrowserFile('A1.png'),
    'asset browser folder import',
  )
  await captureScreenshot('explorer-import-after')
  checks.push('dragged a real Windows folder from Explorer onto the asset browser and verified A1.png independently of CSP card dragging')
}

async function runRemapRealDndScenario(): Promise<void> {
  await ensurePaneExpandedWithRealMouse('sheet-left-pane')
  await ensurePaneExpandedWithRealMouse('sheet-right-pane')
  await setSheetZoomForRealMouse(60)
  await waitForPageCondition(
    () => evaluatePage<boolean>(`Boolean(document.querySelector('.cspLayerTree') && document.querySelector('[aria-label^="BG1（"]') && document.querySelector('[aria-label^="SL1（"]') && document.querySelector('[aria-label^="MEMO1（"]'))`),
    'remap CSP layer tree fixture',
  )

  const folderDropClient = await assetBrowserDropPoint()
  const folderDropScreen = await clientToScreen(folderDropClient)
  diagnostics.folderDropClient = folderDropClient
  diagnostics.folderDropScreen = folderDropScreen
  await runExplorerDropAndWait(
    args.folder as string,
    folderDropScreen,
    () => waitForAssetBrowserFile('A1.png'),
    'remap asset browser folder import',
  )
  checks.push('dragged a real Windows folder from Explorer onto the remap asset browser')

  const firstAssetScreen = await clientToScreen(await assetCardPoint('A1.png'))
  const middleAssetScreen = await clientToScreen(await assetCardPoint('A1_e.png'))
  const lastAssetScreen = await clientToScreen(await assetCardPoint('A2.png'))
  await realMouseClick(firstAssetScreen)
  await realMouseClick(lastAssetScreen, 'left', true, ['shift'])
  await waitForAssetBrowserSelection(['A1.png', 'A1_e.png', 'A2.png'])
  await realMouseClick(middleAssetScreen, 'left', true, ['ctrl'])
  await waitForAssetBrowserSelection(['A1.png', 'A2.png'])
  await realMouseClick(middleAssetScreen, 'left', true, ['ctrl'])
  await waitForAssetBrowserSelection(['A1.png', 'A1_e.png', 'A2.png'])
  checks.push('selected project-catalog assets with real Shift and Ctrl clicks')
  await realMouseClick(firstAssetScreen)
  await waitForAssetBrowserSelection(['A1.png'])

  await runExplorerMultiDrop([
    join(args['multi-folder'] as string, 'Multi_A1.png'),
    join(args['multi-folder'] as string, 'Multi_A2.png'),
  ], folderDropScreen)
  await waitForAssetBrowserFilesMaterialized(['Multi_A1.png', 'Multi_A2.png'])
  await navigateAssetCatalogUp()
  await waitForAssetBrowserFile('A1.png')
  checks.push('dragged multiple real Windows image files from Explorer onto the asset browser and registered every file')

  const assetClient = await assetCardPoint('A1.png')
  const assetScreen = await clientToScreen(assetClient)
  const ghostScreen = await clientToScreen({ x: assetClient.x - 80, y: assetClient.y + 24 })
  await verifyPointerDragGhost(assetScreen, ghostScreen, '.internalDragPreviewShell.pointerDragGhost .internalDragPreview', 'remap asset pointer drag ghost')
  checks.push('showed and cleaned up the remap asset drag ghost with real mouse input')

  await dragAssetToCspTrack('A1.png', 'BG1')
  await waitForCspTrackAssigned('BG1')
  checks.push('dragged an asset onto the BG/BOOK CSP track with the real mouse')

  await dragAssetToCspTrack('A1_e.png', 'SL1')
  await waitForCspTrackAssigned('SL1')
  checks.push('dragged an asset onto the camera-note CSP track with the real mouse')

  await dragAssetToCspTrack('A2.png', 'MEMO1')
  await waitForCspTrackAssigned('MEMO1')
  checks.push('dragged an asset onto the memo CSP track with the real mouse')

  await dragAssetToCspTrack('A1.png', 'A')
  await waitForCspTrackAssigned('A')
  const cspCellClient = await cspTrackCelPoint('A')
  const cspCellScreen = await clientToScreen(cspCellClient)
  const cspGhostScreen = await clientToScreen({ x: cspCellClient.x - 40, y: cspCellClient.y + 8 })
  await verifyPointerDragGhost(cspCellScreen, cspGhostScreen, '.internalDragPreviewShell.pointerDragGhost .internalDragPreview', 'remap CSP cell pointer drag ghost')
  const cspDropCellClient = await cspTrackCelPoint('A')
  const cspDropCellScreen = await clientToScreen(cspDropCellClient)
  const frameClient = await framePoint('action', 'A', 1)
  const frameScreen = await clientToScreen(frameClient)
  diagnostics.cspCellDropSource = { client: cspDropCellClient, screen: cspDropCellScreen }
  diagnostics.cspCellDropTarget = { client: frameClient, screen: frameScreen }
  await realMouseDragRegisteredCellToSheet(cspDropCellScreen, frameScreen, frameClient)
  await waitForAssetEventAt('action', 'A', 1)
  checks.push('dragged a CSP layer-tree card onto a sheet frame with the real mouse and created the event')

  const paneToggleClient = await paneTogglePoint('sheet-left-pane')
  await realMouseClick(await clientToScreen(paneToggleClient))
  await waitForPaneExpanded('sheet-left-pane', false)
  await focusPaneToggleWithRealKeyboard('sheet-left-pane')
  await realKeyPress('{SPACE}', true)
  await waitForPaneExpanded('sheet-left-pane', true)
  checks.push('closed the CSP layer pane with the real mouse and reopened it with real keyboard input')

  await runCspPaneRefactorScenario()
}

async function runRemapCspPaneRealDndScenario(): Promise<void> {
  await ensurePaneExpandedWithRealMouse('sheet-left-pane')
  await ensurePaneExpandedWithRealMouse('sheet-right-pane')
  await setSheetZoomForRealMouse(60)
  await waitForPageCondition(
    () => evaluatePage<boolean>(`Boolean(document.querySelector('.cspLayerTree') && document.querySelector('[aria-label^="BG1（"]') && document.querySelector('[aria-label^="SL1（"]') && document.querySelector('[aria-label^="MEMO1（"]'))`),
    'remap CSP layer tree fixture',
  )

  await registerAssetFolderWithNativeDialog()
  await waitForAssetBrowserFilesMaterialized(['A1.png', 'A1_e.png', 'A2.png'])
  checks.push('registered a generated image-material folder through the real Windows folder-selection UI')

  await dragAssetToCspTrack('A1.png', 'BG1')
  await waitForCspTrackAssigned('BG1')
  await dragAssetToCspTrack('A1_e.png', 'SL1')
  await waitForCspTrackAssigned('SL1')
  await dragAssetToCspTrack('A2.png', 'MEMO1')
  await waitForCspTrackAssigned('MEMO1')
  checks.push('assigned real image materials to BG/BOOK, camera-note, and memo tracks with real mouse drags')

  await dragAssetToCspTrack('A1.png', 'A')
  await waitForCspTrackAssigned('A')
  const cspCellClient = await cspTrackCelPoint('A')
  const frameClient = await framePoint('action', 'A', 1)
  await realMouseDragRegisteredCellToSheet(
    await clientToScreen(cspCellClient),
    await clientToScreen(frameClient),
    frameClient,
  )
  await waitForAssetEventAt('action', 'A', 1)
  checks.push('registered a cell material and dropped its CSP card onto the sheet with the real mouse')

  await runCspPaneRefactorScenario()
}

async function registerAssetFolderWithNativeDialog(): Promise<void> {
  const buttonClient = await elementCenterPoint('[aria-label="カットフォルダを追加"]')
  await realMouseClick(await clientToScreen(buttonClient))
  const result = await runMouseOpJson<{ ok: boolean; path: string; dialogTitle: string }>([
    'choose-folder-dialog',
    '--path', args.folder as string,
    '--allowed-root', args['allowed-root'] as string,
    '--app-pid', args['app-pid'] as string,
  ])
  diagnostics.nativeAssetFolderDialog = result
  await waitForAssetBrowserFile('A1.png')
}

async function runCspPaneRefactorScenario(): Promise<void> {
  const createdLabel = 'BG_FOOTER_LONG_REFERENCE_02'
  const renamedLabel = 'BOOK_FOOTER_LONG_REFERENCE_03'
  await verifyFixedCspPaneFooter()
  checks.push('kept the CSP layer operation footer fixed while only the layer tree body scrolled')

  await selectCspRegistrationTargetWithRealMouse('演出')
  await selectCspRegistrationTargetWithRealMouse('作画')
  checks.push('changed the active registration destination from the CSP pane and verified its header badge and fixed-footer status')

  await createStackGuideFromCspPaneFooter('作画', createdLabel)
  await waitForStackGuideLabelRole(createdLabel, 'action')
  await dragAssetToCspTrack('A2.png', createdLabel)
  await waitForCspTrackAssigned(createdLabel)
  checks.push('created a long BG/BOOK label from the fixed footer and assigned a real image asset')

  await swapCspPaneTrackWithRealMouse(createdLabel, 'BG1')
  checks.push('reordered CSP pane tracks with the real mouse and observed the insertion line before drop')

  await renameCspPaneTrackWithRealMouse(createdLabel, renamedLabel)
  await waitForStackGuideLabelRole(renamedLabel, 'action')
  checks.push('renamed the selected auxiliary track with the real mouse and keyboard without truncating its sheet label')

  await dragCspPaneTrackToSheetWithRealMouse(renamedLabel, 'cell')
  await waitForStackGuideLabelRole(renamedLabel, 'cell')
  await waitForNoStackGuideLabelRole(renamedLabel, 'action')
  checks.push('dragged the CSP pane track itself onto the sheet and verified its insertion placement moved')

  await deleteSelectedCspPaneTrackAndUndo(renamedLabel)
  await waitForStackGuideLabelRole(renamedLabel, 'cell')
  checks.push('deleted the selected track from the fixed footer and restored it through application Undo')
  await captureScreenshot('remap-csp-pane-refactor-after')
}

async function selectCspRegistrationTargetWithRealMouse(label: string): Promise<void> {
  await realMouseClick(await clientToScreen(await cspSummaryLabelPoint(label)))
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => {
        const activeSummary = document.querySelector('.cspTreeLayer > summary.cspRegistrationTarget');
        const activeLabel = activeSummary?.querySelector('.cspTreeSummaryLabel')?.textContent?.trim();
        const footer = document.querySelector('.cspRegistrationTargetStatus');
        return activeLabel === ${JSON.stringify(label)}
          && footer?.textContent?.replace(/\\s+/g, '') === ${JSON.stringify(`登録先:${label}`)};
      })()
    `),
    `CSP registration destination ${label}`,
  )
}

async function dragCspPaneTrackToSheetWithRealMouse(label: string, role: SheetTimingRole): Promise<void> {
  // Use the template grid point rather than an insert-tool handle. Multiple
  // overlapping guide handles can share a snap index, while the grid point
  // unambiguously exercises the requested ACTION/CELL role.
  const targetClient = (await stackGuideLabelToGridRolePoints(label, role)).target
  const sourceClient = await cspTrackNamePoint(label)
  const sourceScreen = await clientToScreen(sourceClient)
  const targetScreen = await clientToScreen(targetClient)
  diagnostics.cspPaneSheetDropPoints = { sourceClient, sourceScreen, targetClient, targetScreen }
  await evaluatePage<void>(`window.__cspPaneDragEvents = []`)
  let mouseIsDown = false
  try {
    await runMouseOp(['mouse-down-screen', '--x', String(sourceScreen.x), '--y', String(sourceScreen.y), '--app-pid', args['app-pid'] as string])
    mouseIsDown = true
    await runMouseOp(['mouse-move-screen', '--x', String(targetScreen.x), '--y', String(targetScreen.y), '--duration', '0.8'])
    await waitForPageCondition(
      () => evaluatePage<boolean>(`document.body.dataset.internalDragKind === 'csp-pane-node'`),
      `CSP pane track ${label} drag start`,
      3000,
    )
    diagnostics.cspPaneSheetDropDuringDrag = await evaluatePage(`
      (() => ({
        validity: document.body.dataset.internalDragValidity || '',
        preview: Boolean(document.querySelector('.stackGuideDropPreview')),
        ghost: document.querySelector('.internalDragPreview')?.textContent?.trim() || '',
      }))()
    `)
    await captureScreenshot('remap-csp-pane-sheet-drop')
  } finally {
    if (mouseIsDown) await runMouseOp(['mouse-up-screen', '--x', String(targetScreen.x), '--y', String(targetScreen.y)])
  }
  diagnostics.cspPaneSheetDragEvents = await evaluatePage(`window.__cspPaneDragEvents || []`)
}

async function verifyFixedCspPaneFooter(): Promise<void> {
  const geometry = await evaluatePage<{
    beforeTop: number
    afterTop: number
    paneBottom: number
    footerBottom: number
    scrollable: boolean
  }>(`
    (() => {
      const pane = document.querySelector('.cspLayerTree');
      const body = document.querySelector('.cspLayerTreeBody');
      const footer = document.querySelector('.cspLayerTreeFooter');
      if (!(pane instanceof HTMLElement) || !(body instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
        throw new Error('CSP pane layout elements not found');
      }
      const beforeTop = footer.getBoundingClientRect().top;
      const scrollable = body.scrollHeight > body.clientHeight;
      body.scrollTop = body.scrollHeight;
      const afterTop = footer.getBoundingClientRect().top;
      const paneRect = pane.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return { beforeTop, afterTop, paneBottom: paneRect.bottom, footerBottom: footerRect.bottom, scrollable };
    })()
  `)
  diagnostics.cspPaneFooterGeometry = geometry
  if (Math.abs(geometry.beforeTop - geometry.afterTop) > 1 || geometry.footerBottom > geometry.paneBottom + 1) {
    throw new Error(`CSP pane footer moved with the scroll body: ${JSON.stringify(geometry)}`)
  }
}

async function createStackGuideFromCspPaneFooter(
  correctionLayerLabel: string,
  label: string,
): Promise<void> {
  await realMouseClick(await clientToScreen(await cspSummaryLabelPoint(correctionLayerLabel)))
  await realMouseClick(await clientToScreen(await elementCenterPoint('[aria-label="CSPレイヤー項目を追加"]')))
  const menuPoint = await evaluatePage<ClientPoint | null>(`
    (() => {
      const button = Array.from(document.querySelectorAll('.cspPaneFooterAddMenu.actionMenuPortalContent button'))
        .find(item => item.textContent?.trim() === 'BG／BOOK' && !item.disabled);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `)
  if (!menuPoint) throw new Error('CSP pane BG/BOOK add command not found')
  await realMouseClick(await clientToScreen(menuPoint), 'left', false)
  await waitForPageCondition(
    () => evaluatePage<boolean>(`document.activeElement?.matches('input[aria-label="BG／BOOK名"]') === true`),
    'CSP pane BG/BOOK draft keyboard focus',
  )
  await realKeyPress(`^a${label}{ENTER}`, true)
  await waitForCspTrack(label)
}

async function swapCspPaneTrackWithRealMouse(sourceLabel: string, referenceLabel: string): Promise<void> {
  const before = await cspPaneTrackScopeOrder(sourceLabel)
  const sourceIndex = before.indexOf(sourceLabel)
  const referenceIndex = before.indexOf(referenceLabel)
  if (sourceIndex < 0 || referenceIndex < 0) throw new Error(`CSP pane reorder fixture not found: ${before.join(', ')}`)
  const edge: 'before' | 'after' = sourceIndex < referenceIndex ? 'after' : 'before'
  const { source: sourceClient, target: targetClient } = await cspTrackReorderPoints(sourceLabel, referenceLabel, edge)
  const sourceScreen = await clientToScreen(sourceClient)
  const targetScreen = await clientToScreen(targetClient)
  await evaluatePage<void>(`
    (() => {
      window.__cspPaneDragEvents = [];
      if (!window.__cspPaneDragListenerInstalled) {
        window.addEventListener('xsheet-remap:internal-drag', event => {
          const detail = event.detail;
          if (detail?.payload?.kind === 'csp-pane-node') {
            window.__cspPaneDragEvents.push({
              phase: detail.phase,
              clientX: detail.clientX,
              clientY: detail.clientY,
              payload: detail.payload,
            });
          }
        });
        window.__cspPaneDragListenerInstalled = true;
      }
    })()
  `)
  let mouseIsDown = false
  try {
    await runMouseOp(['mouse-down-screen', '--x', String(sourceScreen.x), '--y', String(sourceScreen.y), '--app-pid', args['app-pid'] as string])
    mouseIsDown = true
    await runMouseOp(['mouse-move-screen', '--x', String(targetScreen.x), '--y', String(targetScreen.y), '--duration', '0.8'])
    await waitForPageCondition(
      () => evaluatePage<boolean>(`Boolean(document.querySelector(${JSON.stringify(edge === 'before' ? '.cspPaneDropBefore' : '.cspPaneDropAfter')}))`),
      `CSP pane ${edge} insertion line`,
    )
    await captureScreenshot('remap-csp-pane-reorder-line')
  } finally {
    if (mouseIsDown) await runMouseOp(['mouse-up-screen', '--x', String(targetScreen.x), '--y', String(targetScreen.y)])
  }
  diagnostics.cspPaneDragEvents = await evaluatePage(`window.__cspPaneDragEvents || []`)
  diagnostics.cspPaneOrderAfterDrop = await cspPaneTrackScopeOrder(sourceLabel)
  try {
    await waitForPageCondition(async () => {
      const after = await cspPaneTrackScopeOrder(sourceLabel)
      const nextSource = after.indexOf(sourceLabel)
      const nextReference = after.indexOf(referenceLabel)
      return edge === 'before' ? nextSource < nextReference : nextSource > nextReference
    }, `CSP pane reordered ${sourceLabel} ${edge} ${referenceLabel}`)
  } finally {
    diagnostics.cspPaneOrderAfterWait = await cspPaneTrackScopeOrder(sourceLabel)
  }
}

async function cspTrackReorderPoints(
  sourceLabel: string,
  referenceLabel: string,
  edge: 'before' | 'after',
): Promise<{ source: ClientPoint; target: ClientPoint }> {
  return evaluatePage<{ source: ClientPoint; target: ClientPoint }>(`
    (() => {
      const rows = Array.from(document.querySelectorAll('.cspTreeTrackRow'));
      const rowFor = label => rows.find(row => row.querySelector('.cspTreeTrackName')?.textContent?.trim() === label);
      const sourceRow = rowFor(${JSON.stringify(sourceLabel)});
      const targetRow = rowFor(${JSON.stringify(referenceLabel)});
      if (!(sourceRow instanceof HTMLElement) || !(targetRow instanceof HTMLElement)) {
        throw new Error('CSP pane reorder rows not found');
      }
      sourceRow.scrollIntoView({ block: 'center', inline: 'nearest' });
      const sourceRect = sourceRow.getBoundingClientRect();
      const targetRect = targetRow.getBoundingClientRect();
      const xFor = rect => rect.left + Math.min(Math.max(rect.width / 2, 24), rect.width - 8);
      return {
        source: { x: xFor(sourceRect), y: sourceRect.top + sourceRect.height / 2 },
        target: {
          x: xFor(targetRect),
          y: ${JSON.stringify(edge)} === 'before' ? targetRect.top + 2 : targetRect.bottom - 2,
        },
      };
    })()
  `)
}

async function renameCspPaneTrackWithRealMouse(currentLabel: string, nextLabel: string): Promise<void> {
  const point = await clientToScreen(await cspTrackNamePoint(currentLabel))
  await realMouseClick(point, 'left', true, [], 2)
  await waitForPageCondition(
    () => evaluatePage<boolean>(`document.activeElement?.getAttribute('aria-label') === ${JSON.stringify(`${currentLabel}の追加トラック名`)}`),
    `CSP pane rename input ${currentLabel}`,
  )
  await realKeyPress(`^a${nextLabel}{ENTER}`, true)
  await waitForCspTrack(nextLabel)
}

async function deleteSelectedCspPaneTrackAndUndo(label: string): Promise<void> {
  await realMouseClick(await clientToScreen(await cspTrackRowPoint(label)))
  const deletePoint = await elementCenterPoint(`[aria-label=${JSON.stringify(`${label}を削除`)}]`)
  await realMouseClick(await clientToScreen(deletePoint))
  await waitForNoCspTrack(label)
  await realMouseClick(await clientToScreen(await elementCenterPoint('[aria-label="元に戻す"]')))
  await waitForCspTrack(label)
}

async function dragAssetToCspTrack(fileName: string, trackLabel: string): Promise<void> {
  const assetClient = await assetCardPoint(fileName)
  const assetScreen = await clientToScreen(assetClient)
  let mouseIsDown = false
  let targetScreen = assetScreen
  try {
    await runMouseOp([
      'mouse-down-screen',
      '--x', String(assetScreen.x),
      '--y', String(assetScreen.y),
      '--app-pid', args['app-pid'] as string,
    ])
    mouseIsDown = true
    await runMouseOp([
      'mouse-move-screen',
      '--x', String(assetScreen.x - 24),
      '--y', String(assetScreen.y + 8),
      '--duration', '0.25',
    ])
    await waitForPageCondition(
      () => evaluatePage<boolean>(`Boolean(document.querySelector('.cspTreeAssetDropZone.active'))`),
      'CSP asset drop zones visible',
      3000,
    )
    const targetClient = await cspTrackAssetDropZonePoint(trackLabel)
    targetScreen = await clientToScreen(targetClient)
    diagnostics[`csp:${trackLabel}:asset`] = { client: assetClient, screen: assetScreen, fileName }
    diagnostics[`csp:${trackLabel}:target`] = { client: targetClient, screen: targetScreen }
    await runMouseOp([
      'mouse-move-screen',
      '--x', String(targetScreen.x),
      '--y', String(targetScreen.y),
      '--duration', '0.8',
    ])
    await waitForCspAssetDropZoneHover(trackLabel)
  } finally {
    if (mouseIsDown) {
      await runMouseOp([
        'mouse-up-screen',
        '--x', String(targetScreen.x),
        '--y', String(targetScreen.y),
      ])
    }
  }
}

async function cspTrackAssetDropZonePoint(trackLabel: string): Promise<ClientPoint> {
  return evaluatePage<ClientPoint>(`
    (() => {
      const tracks = Array.from(document.querySelectorAll('.cspTreeTrack'));
      const track = tracks.find(item => item.querySelector('.cspTreeTrackNameInput')?.value === ${JSON.stringify(trackLabel)})
        || tracks.find(item => item.querySelector('.cspTreeTrackName')?.textContent?.trim() === ${JSON.stringify(trackLabel)});
      if (!track) throw new Error('CSP track not found: ${escapeForSingleQuotedError(trackLabel)}');
      const dropZone = track.querySelector('.cspTreeAssetDropZone.active');
      if (!dropZone) throw new Error('CSP asset drop zone not active: ${escapeForSingleQuotedError(trackLabel)}');
      dropZone.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = dropZone.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `)
}

async function waitForCspAssetDropZoneHover(trackLabel: string): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => {
        const tracks = Array.from(document.querySelectorAll('.cspTreeTrack'));
        const track = tracks.find(item => item.querySelector('.cspTreeTrackNameInput')?.value === ${JSON.stringify(trackLabel)})
          || tracks.find(item => item.querySelector('.cspTreeTrackName')?.textContent?.trim() === ${JSON.stringify(trackLabel)});
        return Boolean(track?.querySelector('.cspTreeAssetDropZone.assetDragOver'));
      })()
    `),
    `CSP track ${trackLabel} asset drop target`,
    3000,
  )
}

async function cspTrackCelPoint(trackLabel: string): Promise<ClientPoint> {
  return evaluatePage<ClientPoint>(`
    (() => {
      const tracks = Array.from(document.querySelectorAll('.cspTreeTrack[data-csp-drop-kind="track"]'));
      const track = tracks.find(item => item.querySelector('.cspTreeTrackNameInput')?.value === ${JSON.stringify(trackLabel)})
        || tracks.find(item => item.querySelector('.cspTreeTrackName')?.textContent?.trim() === ${JSON.stringify(trackLabel)});
      const cel = track?.querySelector('.cspTreeCel[data-csp-key-id]');
      if (!cel) throw new Error('registered CSP cell not found: ${escapeForSingleQuotedError(trackLabel)}');
      cel.scrollIntoView({ block: 'center', inline: 'nearest' });
      const dragHandle = cel.querySelector('.cspTreeCelName') || cel;
      const rect = dragHandle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `)
}

async function waitForCspTrackAssigned(trackLabel: string): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => {
        const tracks = Array.from(document.querySelectorAll('.cspTreeTrack'));
        const track = tracks.find(item => item.querySelector('.cspTreeTrackNameInput')?.value === ${JSON.stringify(trackLabel)})
          || tracks.find(item => item.querySelector('.cspTreeTrackName')?.textContent?.trim() === ${JSON.stringify(trackLabel)});
        return Boolean(track?.querySelector('.cspTreeCel.assigned'));
      })()
    `),
    `CSP track ${trackLabel} assigned asset`,
  )
}

async function waitForCspTrack(trackLabel: string): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      Array.from(document.querySelectorAll('.cspTreeTrackName')).some(item => item.textContent?.trim() === ${JSON.stringify(trackLabel)})
    `),
    `CSP track ${trackLabel}`,
  )
}

async function waitForNoCspTrack(trackLabel: string): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      !Array.from(document.querySelectorAll('.cspTreeTrackName')).some(item => item.textContent?.trim() === ${JSON.stringify(trackLabel)})
    `),
    `CSP track ${trackLabel} removed`,
  )
}

async function cspTrackNamePoint(trackLabel: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const label = Array.from(document.querySelectorAll('.cspTreeTrackName'))
        .find(item => item.textContent?.trim() === ${JSON.stringify(trackLabel)});
      if (!label) return null;
      label.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = label.getBoundingClientRect();
      return { x: rect.left + Math.min(Math.max(rect.width / 2, 12), rect.width - 4), y: rect.top + rect.height / 2 };
    })()
  `)
  if (!point) throw new Error(`CSP track label not found: ${trackLabel}`)
  return point
}

async function cspTrackRowPoint(trackLabel: string): Promise<ClientPoint> {
  return cspTrackRowEdgePoint(trackLabel, 'center')
}

async function cspTrackRowEdgePoint(trackLabel: string, edge: 'before' | 'after' | 'center'): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const label = Array.from(document.querySelectorAll('.cspTreeTrackName'))
        .find(item => item.textContent?.trim() === ${JSON.stringify(trackLabel)});
      const row = label?.closest('.cspTreeTrackRow');
      if (!row) return null;
      row.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = row.getBoundingClientRect();
      const edge = ${JSON.stringify(edge)};
      return {
        x: rect.left + Math.min(Math.max(rect.width / 2, 24), rect.width - 8),
        y: edge === 'before' ? rect.top + 2 : edge === 'after' ? rect.bottom - 2 : rect.top + rect.height / 2,
      };
    })()
  `)
  if (!point) throw new Error(`CSP track row not found: ${trackLabel}`)
  return point
}

async function cspPaneTrackScopeOrder(trackLabel: string): Promise<string[]> {
  return evaluatePage<string[]>(`
    (() => {
      const label = Array.from(document.querySelectorAll('.cspTreeTrackName'))
        .find(item => item.textContent?.trim() === ${JSON.stringify(trackLabel)});
      const row = label?.closest('.cspTreeTrackRow');
      const scope = row?.dataset.cspPaneReorderScope;
      if (!scope) return [];
      return Array.from(document.querySelectorAll('.cspTreeTrackRow'))
        .filter(item => item.dataset.cspPaneReorderScope === scope)
        .map(item => item.querySelector('.cspTreeTrackName')?.textContent?.trim() || '')
        .filter(Boolean);
    })()
  `)
}

async function cspSummaryLabelPoint(label: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const target = Array.from(document.querySelectorAll('.cspTreeSummaryLabel'))
        .find(item => item.textContent?.trim() === ${JSON.stringify(label)});
      if (!target) return null;
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = target.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `)
  if (!point) throw new Error(`CSP correction layer summary not found: ${label}`)
  return point
}

async function elementCenterPoint(selector: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `)
  if (!point) throw new Error(`element not found: ${selector}`)
  return point
}

async function paneTogglePoint(controls: string): Promise<ClientPoint> {
  return evaluatePage<ClientPoint>(`
    (() => {
      const button = document.querySelector('button[aria-controls=${JSON.stringify(controls)}]');
      if (!button) throw new Error('pane toggle not found: ${escapeForSingleQuotedError(controls)}');
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `)
}

async function waitForPaneExpanded(controls: string, expanded: boolean): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      document.querySelector('button[aria-controls=${JSON.stringify(controls)}]')?.getAttribute('aria-expanded') === ${JSON.stringify(String(expanded))}
    `),
    `${controls} expanded=${expanded}`,
  )
}

async function ensurePaneExpandedWithRealMouse(controls: string): Promise<void> {
  const expanded = await evaluatePage<boolean>(`
    document.querySelector('button[aria-controls=${JSON.stringify(controls)}]')?.getAttribute('aria-expanded') === 'true'
  `)
  if (!expanded) {
    const toggleClient = await paneTogglePoint(controls)
    await realMouseClick(await clientToScreen(toggleClient))
    await waitForPaneExpanded(controls, true)
  }
  diagnostics[`pane:${controls}`] = await evaluatePage(`
    (() => {
      const button = document.querySelector('button[aria-controls=${JSON.stringify(controls)}]');
      const pane = document.getElementById(${JSON.stringify(controls)});
      const rect = pane?.getBoundingClientRect();
      return {
        expanded: button?.getAttribute('aria-expanded'),
        rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      };
    })()
  `)
}

async function focusPaneToggleWithRealKeyboard(controls: string): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    const focused = await evaluatePage<boolean>(`
      document.activeElement?.matches('button[aria-controls=${JSON.stringify(controls)}]') === true
    `)
    if (focused) {
      diagnostics.paneToggleKeyboardTabs = index
      return
    }
    await realKeyPress('{TAB}', true)
  }
  throw new Error(`pane toggle was not reached by real keyboard tab navigation: ${controls}`)
}

async function realKeyPress(keys: string, preserveFocus = false): Promise<void> {
  await runMouseOp([
    'key-press',
    '--keys', keys,
    '--app-pid', args['app-pid'] as string,
    ...(preserveFocus ? ['--preserve-focus'] : []),
  ])
}

async function realMouseDragRegisteredCellToSheet(
  from: ScreenPoint,
  to: ScreenPoint,
  targetClient: ClientPoint,
): Promise<void> {
  await realMouseDragInternalToSheet(from, to, targetClient, 'registered cell sheet drop', 'registered-cell')
}

async function realMouseDragInternalToSheet(
  from: ScreenPoint,
  to: ScreenPoint,
  targetClient: ClientPoint,
  diagnosticKey: string,
  expectedKind: 'asset' | 'registered-cell',
): Promise<void> {
  let mouseIsDown = false
  try {
    await runMouseOp([
      'mouse-down-screen',
      '--x', String(from.x),
      '--y', String(from.y),
      '--app-pid', args['app-pid'] as string,
    ])
    mouseIsDown = true
    await runMouseOp([
      'mouse-move-screen',
      '--x', String(to.x),
      '--y', String(to.y),
      '--duration', '0.8',
    ])
    await waitForPageCondition(
      () => evaluatePage<boolean>(`Boolean(document.querySelector('.internalDragPreviewShell.pointerDragGhost .internalDragPreview'))`),
      `${diagnosticKey} ghost at sheet target`,
      3000,
    )
    await waitForPageCondition(
      () => evaluatePage<boolean>(`document.body.dataset.internalDragValidity === 'valid'`),
      `${diagnosticKey} valid sheet drop target`,
      3000,
    )
    const state = await currentInternalDragVisualState(targetClient)
    diagnostics[diagnosticKey] = state
    if (state.dragKind !== expectedKind) {
      throw new Error(`${diagnosticKey} used the wrong drag kind: ${JSON.stringify(state)}`)
    }
    if (state.sourceCursor !== 'crosshair') {
      throw new Error(`${diagnosticKey} should use the shared valid-target cursor: ${JSON.stringify(state)}`)
    }
    if (state.targetCursor !== 'crosshair') {
      throw new Error(`${diagnosticKey} should expose the shared cursor over the actual sheet target: ${JSON.stringify(state)}`)
    }
    assertGhostDoesNotCoverPoint(state.ghostRect, targetClient, diagnosticKey)
  } finally {
    if (mouseIsDown) {
      await runMouseOp([
        'mouse-up-screen',
        '--x', String(to.x),
        '--y', String(to.y),
      ])
    }
  }
}

async function runMouseOp(mouseArgs: string[]): Promise<void> {
  await runMouseOpJson(mouseArgs)
}

async function realMouseDrag(from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await runMouseOp([
    'drag-screen',
    '--from-x', String(from.x),
    '--from-y', String(from.y),
    '--to-x', String(to.x),
    '--to-y', String(to.y),
    '--app-pid', args['app-pid'],
  ])
}

async function realMouseClick(
  point: ScreenPoint,
  button: MouseButton = 'left',
  focusApp = true,
  modifiers: Array<'ctrl' | 'shift'> = [],
  clickCount: 1 | 2 = 1,
): Promise<void> {
  await runMouseOp([
    'click-screen',
    '--x', String(point.x),
    '--y', String(point.y),
    '--button', button,
    '--click-count', String(clickCount),
    ...modifiers.flatMap(modifier => ['--modifier', modifier]),
    ...(focusApp ? ['--app-pid', args['app-pid'] as string] : []),
  ])
}

async function dragAssetCardToFrame(
  fileName: string,
  role: SheetTimingRole,
  paperTrack: string,
  frame: number,
  diagnosticKey: string,
): Promise<void> {
  const assetClient = await assetCardPoint(fileName)
  const assetScreen = await clientToScreen(assetClient)
  const targetClient = await framePoint(role, paperTrack, frame)
  const targetScreen = await clientToScreen(targetClient)
  diagnostics[`${diagnosticKey}AssetClient`] = assetClient
  diagnostics[`${diagnosticKey}AssetScreen`] = assetScreen
  diagnostics[`${diagnosticKey}TargetClient`] = targetClient
  diagnostics[`${diagnosticKey}TargetScreen`] = targetScreen
  await realMouseDragInternalToSheet(assetScreen, targetScreen, targetClient, diagnosticKey, 'asset')
  await waitForAssetEventAt(role, paperTrack, frame)
}

async function dragSelectSheetRange(
  role: SheetTimingRole,
  paperTrack: string,
  anchorFrame: number,
  focusFrame: number,
  diagnosticKey: string,
): Promise<void> {
  const anchorClient = await framePoint(role, paperTrack, anchorFrame)
  const focusClient = await framePoint(role, paperTrack, focusFrame)
  const anchorScreen = await clientToScreen(anchorClient)
  const focusScreen = await clientToScreen(focusClient)
  diagnostics[`${diagnosticKey}AnchorClient`] = anchorClient
  diagnostics[`${diagnosticKey}FocusClient`] = focusClient
  diagnostics[`${diagnosticKey}AnchorScreen`] = anchorScreen
  diagnostics[`${diagnosticKey}FocusScreen`] = focusScreen
  await realMouseDrag(anchorScreen, focusScreen)
  await waitForSelectedRange(role, paperTrack, Math.min(anchorFrame, focusFrame), Math.max(anchorFrame, focusFrame))
}

async function clickSheetContextMenuItemAtFrame(
  role: SheetTimingRole,
  paperTrack: string,
  frame: number,
  menuItemText: string,
  diagnosticKey: string,
): Promise<void> {
  const frameClient = await framePoint(role, paperTrack, frame)
  const frameScreen = await clientToScreen(frameClient)
  diagnostics[`${diagnosticKey}ContextClient`] = frameClient
  diagnostics[`${diagnosticKey}ContextScreen`] = frameScreen
  await realMouseClick(frameScreen, 'right')
  await clickMenuItemWithRealMouse(menuItemText, diagnosticKey)
}

async function clickMenuItemWithRealMouse(label: string, diagnosticKey: string): Promise<void> {
  const menuClient = await menuItemPoint(label)
  const menuScreen = await clientToScreen(menuClient)
  diagnostics[`${diagnosticKey}MenuClient`] = menuClient
  diagnostics[`${diagnosticKey}MenuScreen`] = menuScreen
  await realMouseClick(menuScreen, 'left', false)
  await delay(100)
}

async function verifyAssetDropOnlyRepeatPasteWithRealMouse(): Promise<void> {
  await dragAssetCardToFrame('A2.png', 'cell', 'C', 10, 'assetDropRepeatSource')
  await waitForNoAssetEventAt('cell', 'C', 11)
  await dragSelectSheetRange('cell', 'C', 11, 10, 'assetDropRepeatSourceRange')
  await clickSheetContextMenuItemAtFrame('cell', 'C', 10, 'コピー', 'assetDropRepeatCopy')

  await dragSelectSheetRange('cell', 'C', 14, 19, 'assetDropRepeatTargetRange')
  for (const frame of [14, 15, 16, 17, 18, 19]) {
    await waitForNoAssetEventAt('cell', 'C', frame)
  }
  await clickSheetContextMenuItemAtFrame('cell', 'C', 14, '選択範囲内にリピート貼り付け', 'assetDropRepeatPaste')
  for (const frame of [14, 16, 18]) {
    await waitForAssetEventAt('cell', 'C', frame)
  }
  for (const frame of [15, 17, 19]) {
    await waitForNoAssetEventAt('cell', 'C', frame)
  }
}

async function realMouseDragStackGuideLabel(label: string, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  let mouseIsDown = false
  try {
    await runMouseOp([
      'mouse-down-screen',
      '--x', String(from.x),
      '--y', String(from.y),
      '--app-pid', args['app-pid'] as string,
    ])
    mouseIsDown = true
    await waitForPageCondition(
      () => evaluatePage<boolean>(`
        (() => Array.from(document.querySelectorAll('.stackGuideSvgLabel.dragging')).some(item =>
          item.textContent?.trim() === ${JSON.stringify(label)}
        ))()
      `),
      `stack guide label ${label} drag start`,
      3000,
    )
    await runMouseOp([
      'mouse-move-screen',
      '--x', String(to.x),
      '--y', String(to.y),
      '--duration', '0.35',
    ])
  } finally {
    if (mouseIsDown) {
      await runMouseOp([
        'mouse-up-screen',
        '--x', String(to.x),
        '--y', String(to.y),
      ]).catch(error => {
        diagnostics[`stack guide label ${label}:mouseUpError`] = errorMessage(error)
      })
    }
  }
  diagnostics[`stack guide label ${label}:postDrag`] = await evaluatePage(`
    (() => {
      const labels = Array.from(document.querySelectorAll('.stackGuideSvgLabel'));
      return labels.map(item => ({
        text: item.textContent?.trim() || '',
        role: item.dataset.stackGuideRole || '',
        dragging: item.classList.contains('dragging'),
        rect: (() => {
          const box = item.getBoundingClientRect();
          return { left: box.left, top: box.top, width: box.width, height: box.height };
        })(),
      }));
    })()
  `)
}

async function verifyPointerDragGhost(from: ScreenPoint, moveTo: ScreenPoint, selector: string, label: string): Promise<void> {
  let mouseIsDown = false
  try {
    await runMouseOp([
      'mouse-down-screen',
      '--x', String(from.x),
      '--y', String(from.y),
      '--app-pid', args['app-pid'] as string,
    ])
    mouseIsDown = true
    await runMouseOp([
      'mouse-move-screen',
      '--x', String(moveTo.x),
      '--y', String(moveTo.y),
      '--duration', '0.25',
    ])
    await waitForPageCondition(
      () => evaluatePage<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
      label,
      3000,
    )
    const state = await evaluatePage<{ left: number; top: number; width: number; height: number; text: string } | null>(`
      (() => {
        const ghost = document.querySelector(${JSON.stringify(selector)});
        const root = ghost?.closest('.pointerDragGhost') || ghost;
        const rect = root instanceof Element ? root.getBoundingClientRect() : null;
        return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, text: root.textContent?.trim().slice(0, 120) ?? '' } : null;
      })()
    `)
    diagnostics[label] = state
    if (!state?.text) throw new Error(`${label} did not expose a readable common preview label`)
    assertGhostDoesNotCoverPoint(state, await screenToClient(moveTo), label)
  } finally {
    if (mouseIsDown) {
      await runMouseOp([
        'mouse-up-screen',
        '--x', String(moveTo.x),
        '--y', String(moveTo.y),
      ]).catch(error => {
        diagnostics[`${label}:mouseUpError`] = errorMessage(error)
      })
    }
  }
  await waitForPageCondition(
    () => evaluatePage<boolean>(`!document.querySelector(${JSON.stringify(selector)})`),
    `${label} cleanup`,
    3000,
  )
}

async function waitForInternalPointerDragCleanup(): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      !document.body.classList.contains('internalPointerDragActive')
      && !document.querySelector('.pointerDragGhost')
      && !document.querySelector('.internalPointerDragSource')
      && !document.querySelector('[data-internal-drag-source="true"]')
    `),
    'internal pointer drag cleanup',
    3000,
  )
}

async function currentInternalDragVisualState(targetClient: ClientPoint): Promise<{
  validity: string
  dragKind: string
  sourceCursor: string
  targetCursor: string
  targetTag: string
  ghostRect: { left: number; top: number; width: number; height: number } | null
  ghostText: string
}> {
  return evaluatePage(`
    (() => {
      const source = document.querySelector('[data-internal-drag-source="true"]');
      const target = document.elementFromPoint(${JSON.stringify(targetClient.x)}, ${JSON.stringify(targetClient.y)});
      const ghost = document.querySelector('.internalDragPreviewShell.pointerDragGhost');
      const rect = ghost?.getBoundingClientRect() || null;
      return {
        validity: document.body.dataset.internalDragValidity || '',
        dragKind: document.body.dataset.internalDragKind || '',
        sourceCursor: source instanceof Element ? getComputedStyle(source).cursor : '',
        targetCursor: target instanceof Element ? getComputedStyle(target).cursor : '',
        targetTag: target instanceof Element ? target.tagName : '',
        ghostRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        ghostText: ghost?.textContent?.trim().slice(0, 120) || '',
      };
    })()
  `)
}

function assertGhostDoesNotCoverPoint(
  rect: { left: number; top: number; width: number; height: number } | null,
  point: ClientPoint,
  label: string,
): void {
  if (!rect) throw new Error(`${label} did not expose the shared drag preview rectangle`)
  const coversPoint = point.x >= rect.left
    && point.x <= rect.left + rect.width
    && point.y >= rect.top
    && point.y <= rect.top + rect.height
  if (coversPoint) {
    throw new Error(`${label} drag preview covers the pointer/drop target: ${JSON.stringify({ rect, point })}`)
  }
}

async function runMouseOpJson<T = unknown>(mouseArgs: string[]): Promise<T> {
  const script = fileURLToPath(new URL('./mouse_ops.py', import.meta.url))
  try {
    const { stdout, stderr } = await execFileAsync(args.python as string, [script, ...mouseArgs], { windowsHide: false, maxBuffer: 1024 * 1024 })
    if (stdout.trim()) diagnostics[`mouse:${checks.length}:${mouseArgs[0]}`] = stdout.trim()
    if (stderr.trim()) diagnostics[`mouse-stderr:${checks.length}:${mouseArgs[0]}`] = stderr.trim()
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || '{}') as T
  } catch (error) {
    const processError = error as { stdout?: string; stderr?: string; message?: string }
    const stdout = processError.stdout?.trim() ?? ''
    const stderr = processError.stderr?.trim() ?? ''
    if (stdout) diagnostics[`mouse:${checks.length}:${mouseArgs[0]}:failed`] = stdout
    if (stderr) diagnostics[`mouse-stderr:${checks.length}:${mouseArgs[0]}:failed`] = stderr
    let message = processError.message || `mouse operation failed: ${mouseArgs[0]}`
    try {
      const payload = JSON.parse(stdout.split(/\r?\n/).at(-1) || '{}') as { error?: string }
      if (payload.error) message = payload.error
    } catch {
      // Preserve the process error when the helper could not emit JSON.
    }
    throw new Error(message)
  }
}

async function runExplorerDrop(path: string, target: ScreenPoint): Promise<void> {
  await runMouseOp([
    'drag-explorer-item',
    '--path', path,
    '--allowed-root', args['allowed-root'] as string,
    '--to-x', String(target.x),
    '--to-y', String(target.y),
    '--app-pid', args['app-pid'] as string,
  ])
}

async function runExplorerMultiDrop(paths: string[], target: ScreenPoint): Promise<void> {
  await runMouseOp([
    'drag-explorer-items',
    ...paths.flatMap(path => ['--path', path]),
    '--allowed-root', args['allowed-root'] as string,
    '--to-x', String(target.x),
    '--to-y', String(target.y),
    '--app-pid', args['app-pid'] as string,
  ])
}

async function runExplorerDropAndWait(
  path: string,
  target: ScreenPoint,
  verify: () => Promise<void>,
  label: string,
  attempts = 2,
): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await runExplorerDrop(path, target)
    try {
      await verify()
      if (attempt > 1) diagnostics[`${label}:attempts`] = attempt
      return
    } catch (error) {
      lastError = error
      diagnostics[`${label}:attempt:${attempt}:error`] = errorMessage(error)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`)
}

async function waitForSheet(): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`Boolean(document.querySelector('.sheetSvg') && document.querySelector('.assetBrowser'))`),
    'sheet and asset browser',
  )
}

async function setSheetZoomForRealMouse(percent: number): Promise<void> {
  const zoomText = `${percent}%`
  await evaluatePage<void>(`
    (() => {
      const input = document.querySelector('.sheetZoomFloatingPalette input[type="range"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('sheet zoom slider not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, ${JSON.stringify(String(percent))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `)
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => {
        const value = document.querySelector('.sheetZoomFloatingPalette .zoomPaletteTrigger')?.textContent?.trim() || '';
        return value === ${JSON.stringify(zoomText)};
      })()
    `),
    `sheet zoom set to ${zoomText}`,
  )
  diagnostics.sheetZoom = await evaluatePage(`
    (() => {
      const svg = document.querySelector('.sheetSvg[data-page-id="page_1"]') || document.querySelector('.sheetSvg');
      const box = svg?.getBoundingClientRect();
      return {
        value: document.querySelector('.sheetZoomFloatingPalette .zoomPaletteTrigger')?.textContent?.trim() || '',
        svg: box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null,
      };
    })()
  `)
}

async function assetBrowserDropPoint(): Promise<ClientPoint> {
  return evaluatePage<ClientPoint>(`
    (() => {
      const browser = document.querySelector('.assetBrowser');
      const items = browser?.querySelector('.assetBrowserItems');
      if (!browser || !items) throw new Error('asset browser drop surface not found');
      const browserRect = browser.getBoundingClientRect();
      const itemsRect = items.getBoundingClientRect();
      if (browserRect.width < 40 || browserRect.height < 80 || itemsRect.width < 40 || itemsRect.height < 40) {
        throw new Error('asset browser is not visibly expanded: ' + JSON.stringify({ browser: { width: browserRect.width, height: browserRect.height }, items: { width: itemsRect.width, height: itemsRect.height } }));
      }
      return {
        x: itemsRect.left + Math.min(Math.max(itemsRect.width / 2, 32), itemsRect.width - 24),
        y: itemsRect.top + Math.min(Math.max(itemsRect.height / 3, 32), itemsRect.height - 24),
      };
    })()
  `)
}

async function waitForAssetBrowserFile(fileName: string): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.assetCard:not(.assetCatalogFolderCard)'));
        const location = document.querySelector('.assetLocationText');
        return Boolean(location && cards.some(card => (card.textContent || '').includes(${JSON.stringify(fileName)})));
      })()
    `),
    `asset browser file ${fileName}`,
  )
}

async function waitForAssetBrowserSelection(expectedFileNames: string[]): Promise<void> {
  const expected = [...expectedFileNames].sort()
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => {
        const selected = Array.from(document.querySelectorAll('.assetCard[aria-selected="true"]'))
          .map(card => card.querySelector('.assetCardMeta strong')?.textContent?.trim() || '')
          .filter(Boolean)
          .sort();
        return JSON.stringify(selected) === ${JSON.stringify(JSON.stringify(expected))};
      })()
    `),
    `asset browser selection ${expected.join(', ')}`,
  )
}

async function waitForAssetBrowserFilesMaterialized(expectedFileNames: string[]): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => {
        const expected = ${JSON.stringify(expectedFileNames)};
        const cards = Array.from(document.querySelectorAll('.assetCard:not(.assetCatalogFolderCard)'));
        return expected.every(fileName => {
          const card = cards.find(item => item.querySelector('.assetCardMeta strong')?.textContent?.trim() === fileName);
          return Boolean(card);
        });
      })()
    `),
    `asset browser files materialized: ${expectedFileNames.join(', ')}`,
  )
}

async function navigateAssetCatalogUp(): Promise<void> {
  const previousLocation = await evaluatePage<string>(`document.querySelector('.assetLocationText')?.textContent?.trim() || ''`)
  const clicked = await evaluatePage<boolean>(`
    (() => {
      const button = document.querySelector('[aria-label="上のフォルダへ"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()
  `)
  if (!clicked) throw new Error('asset catalog up button is unavailable')
  await waitForPageCondition(
    () => evaluatePage<boolean>(`(document.querySelector('.assetLocationText')?.textContent?.trim() || '') !== ${JSON.stringify(previousLocation)}`),
    'asset catalog navigated up',
  )
}

async function createStackGuideLabelFromHeader(role: SheetTimingRole, gapIndex: number, label: string): Promise<void> {
  const headerPoint = await stackGuideHeaderPoint(role, gapIndex)
  await cdpMouseClick(headerPoint, 'right')
  await waitForPageCondition(() => evaluatePage<boolean>(`Boolean(document.querySelector('[role="menu"]'))`), 'stack guide insert menu')
  await clickMenuItem('BG/BOOK追加')
  await cdpMouseClick(await activeStackGuideInsertHandlePoint(role, gapIndex))
  await setStackGuideEditorValue(label)
  await clickStackGuideEditorSubmit()
}

async function activeStackGuideInsertHandlePoint(role: SheetTimingRole, gapIndex: number): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const handles = Array.from(document.querySelectorAll('.stackGuideGap.insertToolActive .stackGuideInsertHandle'));
      const handle = handles.find(item =>
        item.dataset.stackGuideRole === ${JSON.stringify(role)}
        && Number(item.dataset.stackGuideGapIndex) === ${gapIndex}
      ) || handles[0];
      if (!handle) return null;
      handle.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `)
  if (!point) throw new Error('active stack guide insert handle not found')
  return point
}

async function registeredCellCardPoint(paperTrack: string): Promise<ClientPoint> {
  return evaluatePage<ClientPoint>(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.cspTreeCel[data-csp-key-id]'));
      const card = cards.find(item => item.dataset.cspPaperTrack === ${JSON.stringify(paperTrack)});
      if (!card) throw new Error('registered cell card not found: ${escapeForSingleQuotedError(paperTrack)}');
      card.scrollIntoView({ block: 'center', inline: 'nearest' });
      const handle = card.querySelector('.cspTreeCelName') || card;
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + Math.min(Math.max(rect.width / 2, 18), rect.width - 8), y: rect.top + rect.height / 2 };
    })()
  `)
}

async function registeredCellCardState(paperTrack: string): Promise<{ cursor: string; text: string; rect: { left: number; top: number; width: number; height: number } }> {
  return evaluatePage(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.cspTreeCel[data-csp-key-id]'));
      const card = cards.find(item => item.dataset.cspPaperTrack === ${JSON.stringify(paperTrack)});
      if (!card) throw new Error('registered cell card not found: ${escapeForSingleQuotedError(paperTrack)}');
      card.scrollIntoView({ block: 'center', inline: 'nearest' });
      const handle = card.querySelector('.cspTreeCelName') || card;
      const rect = handle.getBoundingClientRect();
      return {
        cursor: getComputedStyle(handle).cursor,
        text: handle.textContent?.trim() || '',
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      };
    })()
  `)
}

async function waitForRegisteredCellCardAsset(paperTrack: string, fileName: string): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.cspTreeCel[data-csp-key-id]'));
        const card = cards.find(item => item.dataset.cspPaperTrack === ${JSON.stringify(paperTrack)});
        return Boolean(card && (card.textContent || '').includes(${JSON.stringify(fileName)}));
      })()
    `),
    `registered cell card ${paperTrack} asset ${fileName}`,
  )
}

async function stackGuideCardPoint(label: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const input = Array.from(document.querySelectorAll('.cspTreeTrackNameInput')).find(item => item.value === ${JSON.stringify(label)});
      const text = Array.from(document.querySelectorAll('.cspTreeTrackName')).find(item => item.textContent?.trim() === ${JSON.stringify(label)});
      const card = (input || text)?.closest('.cspTreeTrack');
      if (!card) return null;
      card.scrollIntoView({ block: 'center', inline: 'nearest' });
      const handle = card.querySelector('.cspTreeTrackRow') || card;
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + Math.min(Math.max(rect.width / 2, 24), rect.width - 8), y: rect.top + rect.height / 2 };
    })()
  `)
  if (!point) throw new Error(`stack guide card not found: ${label}`)
  return point
}

async function waitForStackGuideCardAsset(label: string, fileName: string): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => {
      const input = Array.from(document.querySelectorAll('.cspTreeTrackNameInput')).find(item => item.value === ${JSON.stringify(label)});
      const text = Array.from(document.querySelectorAll('.cspTreeTrackName')).find(item => item.textContent?.trim() === ${JSON.stringify(label)});
      const card = (input || text)?.closest('.cspTreeTrack');
        return Boolean(card && (card.textContent || '').includes(${JSON.stringify(fileName)}));
      })()
    `),
    `stack guide card ${label} asset ${fileName}`,
  )
}

async function stackGuideHeaderPoint(role: SheetTimingRole, gapIndex: number): Promise<ClientPoint> {
  const domPoint = await stackGuideGapDomPoint(role, gapIndex, 'handle')
  if (domPoint) return domPoint
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  const box = await evaluatePage<{ left: number; top: number; width: number; height: number }>(`
    (() => {
      const svg = document.querySelector('.sheetSvg[data-page-id="page_1"]') || document.querySelector('.sheetSvg');
      if (!svg) throw new Error('sheet svg not found');
      svg.scrollIntoView({ block: 'center', inline: 'center' });
      const box = svg.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    })()
  `)
  const normalizedX = region.rect.x + (region.rect.w * gapIndex) / region.grid.columns.length
  const normalizedY = region.rect.y - 0.018
  return {
    x: box.left + normalizedX * box.width,
    y: box.top + normalizedY * box.height,
  }
}

async function stackGuideLabelToGridRolePoints(labelText: string, role: SheetTimingRole): Promise<{ label: ClientPoint; target: ClientPoint }> {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  const layout = resolveSheetTemplateGridLayout(standardA3SheetTemplate, region, {
    paperTracks: standardA3SheetTemplate.defaults.paperTracks,
    durationFrames: standardA3SheetTemplate.defaults.durationFrames,
    frameOrigin: standardA3SheetTemplate.defaults.frameOrigin,
  })
  if (!layout) throw new Error(`template layout not found: ${role}`)
  const target = {
    x: layout.rect.x + layout.rect.w / 2,
    y: layout.rect.y + layout.frames.rowHeight / 2,
  }
  const points = await evaluatePage<{ label: ClientPoint; target: ClientPoint } | null>(`
    (() => {
      const svg = document.querySelector('.sheetSvg[data-page-id="page_1"]') || document.querySelector('.sheetSvg');
      const labels = Array.from(document.querySelectorAll('.stackGuideSvgLabel'));
      const label = labels.find(item => item.textContent?.trim() === ${JSON.stringify(labelText)});
      if (!svg || !label) return null;
      const svgRect = svg.getBoundingClientRect();
      const labelBox = label.querySelector('.stackGuideSvgLabelBox');
      const labelRect = (labelBox || label).getBoundingClientRect();
      return {
        label: {
          x: labelRect.left + Math.min(labelRect.width / 2, 56),
          y: labelRect.top + labelRect.height / 2
        },
        target: {
          x: svgRect.left + ${target.x} * svgRect.width,
          y: svgRect.top + ${target.y} * svgRect.height
        }
      };
    })()
  `)
  if (!points) throw new Error(`stack guide label/grid target not found: ${labelText} ${role}`)
  return points
}

async function stackGuideGapDomPoint(role: SheetTimingRole, gapIndex: number, mode: 'handle' | 'anchor'): Promise<ClientPoint | null> {
  const snapIndex = gapIndex + 1
  return evaluatePage<ClientPoint | null>(`
    (() => {
      const selector = [
        '.stackGuideGap[data-stack-guide-role="${role}"][data-stack-guide-gap-index="${gapIndex}"]',
        '.stackGuideGap[data-stack-guide-role="${role}"][data-stack-guide-snap-index="${snapIndex}"]'
      ].join(',');
      const gap = document.querySelector(selector);
      if (!gap) return null;
      gap.scrollIntoView({ block: 'center', inline: 'center' });
      const gapRect = gap.getBoundingClientRect();
      if (${JSON.stringify(mode)} === 'anchor') {
        return { x: gapRect.left + gapRect.width / 2, y: gapRect.top + 1 };
      }
      const handle = gap.querySelector('.stackGuideInsertHandle') || gap;
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.bottom - Math.min(8, Math.max(1, rect.height / 4)) };
    })()
  `)
}

async function waitForStackGuideLabelRole(label: string, role: SheetTimingRole): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => Array.from(document.querySelectorAll('.stackGuideSvgLabel')).some(item =>
        item.textContent?.trim() === ${JSON.stringify(label)}
        && item.dataset.stackGuideRole === ${JSON.stringify(role)}
        && item.getBoundingClientRect().width > 0
      ))()
    `),
    `stack guide label ${label} in ${role}`,
  )
}

async function waitForNoStackGuideLabelRole(label: string, role: SheetTimingRole): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`
      (() => !Array.from(document.querySelectorAll('.stackGuideSvgLabel')).some(item =>
        item.textContent?.trim() === ${JSON.stringify(label)}
        && item.dataset.stackGuideRole === ${JSON.stringify(role)}
        && item.getBoundingClientRect().width > 0
      ))()
    `),
    `stack guide label ${label} not in ${role}`,
  )
}

async function clickMenuItem(label: string): Promise<void> {
  const clicked = await evaluatePage<boolean>(`
    (() => {
      const menu = document.querySelector('[role="menu"]');
      if (!menu) return false;
      const button = Array.from(menu.querySelectorAll('button[role="menuitem"]'))
        .find(item => item.textContent?.trim() === ${JSON.stringify(label)} && !item.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()
  `)
  if (!clicked) throw new Error(`menu item not found: ${label}`)
  await delay(50)
}

async function menuItemPoint(label: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('[role="menu"] button[role="menuitem"]'));
      const button = buttons.find(item => item.textContent?.trim() === ${JSON.stringify(label)} && !item.disabled);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `)
  if (!point) throw new Error(`menu item not found or disabled: ${label}`)
  return point
}

async function normalizeSelectedRegisteredCellWithRealAssetFileName(paperTrack: string, expectedNextFileName: string): Promise<void> {
  await cdpMouseClick(await registeredCellCardPoint(paperTrack))
  const opened = await evaluatePage<boolean>(`
    (() => {
      const button = document.querySelector('.cspTreeNormalizeButton');
      if (!button) return false;
      button.click();
      return true;
    })()
  `)
  if (!opened) throw new Error('name normalization button not found')
  await waitForPageCondition(() => evaluatePage<boolean>(`Boolean(document.querySelector('.nameNormalizationDialog'))`), 'name normalization dialog')
  const prepared = await evaluatePage<boolean>(`
    (() => {
      const dialog = document.querySelector('.nameNormalizationDialog');
      if (!dialog) return false;
      const target = dialog.querySelector('select');
      if (!target) return false;
      target.value = 'selected-key';
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      const includeFiles = dialog.querySelector('.nameNormalizationCheckbox input');
      if (!includeFiles) return false;
      if (!includeFiles.checked) includeFiles.click();
      return true;
    })()
  `)
  if (!prepared) throw new Error('name normalization controls were not found')
  await waitForPageCondition(
    () => evaluatePage<boolean>(`(document.querySelector('.nameNormalizationDialog')?.textContent || '').includes(${JSON.stringify(expectedNextFileName)})`),
    `name normalization plan includes ${expectedNextFileName}`,
  )
  const applied = await evaluatePage<boolean>(`
    (() => {
      const dialog = document.querySelector('.nameNormalizationDialog');
      if (!dialog) return false;
      const button = Array.from(dialog.querySelectorAll('footer button'))
        .find(item => item.textContent?.trim() === '適用' && !item.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()
  `)
  if (!applied) throw new Error('name normalization apply button not found or disabled')
  await waitForPageCondition(() => evaluatePage<boolean>(`!document.querySelector('.nameNormalizationDialog')`), 'name normalization dialog closed')
  await waitForRegisteredCellCardAsset(paperTrack, expectedNextFileName)
  await waitForAssetBrowserFile(expectedNextFileName)
  const expectedPath = join(args.folder as string, expectedNextFileName)
  await waitForCondition(async () => fileExists(expectedPath), `renamed material file ${expectedNextFileName}`, 12000)
}

async function setStackGuideEditorValue(value: string): Promise<void> {
  await waitForPageCondition(
    () => evaluatePage<boolean>(`Boolean(document.querySelector('.stackGuideEditor input[name="stackGuideLabel"]'))`),
    'stack guide label editor input',
  )
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
  await cdpMouseClick(point)
}

async function cdpMouseClick(point: ClientPoint, button: 'left' | 'right' = 'left'): Promise<void> {
  if (!client) throw new Error('CDP client is not connected')
  const buttons = button === 'left' ? 1 : 2
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button,
    buttons,
    clickCount: 1,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button,
    buttons: 0,
    clickCount: 1,
  })
}

async function assetCardPoint(fileName: string): Promise<ClientPoint> {
  return evaluatePage<ClientPoint>(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.assetCard:not(.assetCatalogFolderCard)'));
      const card = cards.find(item => (item.textContent || '').includes(${JSON.stringify(fileName)}));
      if (!card) throw new Error('asset card not found: ${escapeForSingleQuotedError(fileName)}');
      const rect = card.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `)
}

async function framePoint(
  role: SheetTimingRole,
  paperTrack: string,
  frame: number,
  options: { yFraction?: number } = {},
): Promise<ClientPoint> {
  const hit = timingHitForFrame(standardA3SheetTemplate, role, paperTrack, frame, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
  if (!hit) throw new Error(`template hit not found: ${role} ${paperTrack} ${frame}`)
  const localFrame = 'localFrame' in hit && typeof hit.localFrame === 'number' ? hit.localFrame : hit.frame
  const rect = cellRectForHit(
    standardA3SheetTemplate,
    { ...hit, frame: localFrame },
    standardA3SheetTemplate.defaults.durationFrames,
    standardA3SheetTemplate.defaults.frameOrigin,
  )
  if (!rect) throw new Error(`template rect not found: ${role} ${paperTrack} ${frame}`)
  const yFraction = options.yFraction ?? 0.5
  const pageId = hit.pageId ?? 'page_1'
  const svgRect = await evaluatePage<NormalizedRect & { left: number; top: number; width: number; height: number }>(`
    (() => {
      const svg = document.querySelector(${JSON.stringify(`.sheetSvg[data-page-id="${pageId}"]`)}) || document.querySelector('.sheetSvg');
      if (!svg) throw new Error('sheet svg not found');
      const box = svg.getBoundingClientRect();
      return { x: 0, y: 0, w: 1, h: 1, left: box.left, top: box.top, width: box.width, height: box.height };
    })()
  `)
  return {
    x: svgRect.left + (rect.x + rect.w / 2) * svgRect.width,
    y: svgRect.top + (rect.y + rect.h * yFraction) * svgRect.height,
  }
}

async function waitForAssetEventAt(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  await waitForPageCondition(async () => assetEventAt(role, paperTrack, frame), `${role} ${paperTrack} ${frame} asset event`)
}

async function waitForTimelineEventAt(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  await waitForPageCondition(async () => timelineEventAt(role, paperTrack, frame), `${role} ${paperTrack} ${frame} timeline event`)
}

async function waitForNoAssetEventAt(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  await waitForPageCondition(async () => !(await assetEventAt(role, paperTrack, frame)), `${role} ${paperTrack} ${frame} no asset event`)
}

async function assetEventAt(role: SheetTimingRole, paperTrack: string, frame: number): Promise<boolean> {
  const target = await framePoint(role, paperTrack, frame)
  return evaluatePage<boolean>(`
    (() => {
      const target = ${JSON.stringify(target)};
      return Array.from(document.querySelectorAll('.assetAssignedEventRect')).some(item => {
        const box = item.getBoundingClientRect();
        return target.x >= box.left && target.x <= box.right && target.y >= box.top && target.y <= box.bottom;
      });
    })()
  `)
}

async function timelineEventAt(role: SheetTimingRole, paperTrack: string, frame: number): Promise<boolean> {
  const target = await framePoint(role, paperTrack, frame)
  return evaluatePage<boolean>(`
    (() => {
      const target = ${JSON.stringify(target)};
      return Array.from(document.querySelectorAll('.timelineEventHandle .eventRect')).some(item => {
        const box = item.getBoundingClientRect();
        return target.x >= box.left && target.x <= box.right && target.y >= box.top && target.y <= box.bottom;
      });
    })()
  `)
}

async function waitForSelectedRange(role: SheetTimingRole, paperTrack: string, frameStart: number, frameEnd: number): Promise<void> {
  const expected = templateRangeLocationForFrame(role, paperTrack, frameStart, frameEnd)
  await waitForPageCondition(async () => {
    const rects = await evaluatePage<Array<NormalizedRect & { pageId: string }>>(`
      Array.from(document.querySelectorAll('.selectedRangeRect')).map(rect => ({
        pageId: rect.closest('svg.sheetSvg')?.dataset.pageId ?? '',
        x: Number(rect.getAttribute('x')),
        y: Number(rect.getAttribute('y')),
        w: Number(rect.getAttribute('width')),
        h: Number(rect.getAttribute('height'))
      }))
    `)
    return rects.some(rect => rect.pageId === expected.pageId && rectMatches(rect, expected.rect))
  }, `${role} ${paperTrack} selected ${frameStart}-${frameEnd}`)
}

function templateRangeLocationForFrame(role: SheetTimingRole, paperTrack: string, frameStart: number, frameEnd: number): { pageId: string; rect: NormalizedRect } {
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

function templateFrameLocationForFrame(role: SheetTimingRole, paperTrack: string, frame: number): { pageId: string; rect: NormalizedRect } {
  const hit = timingHitForFrame(standardA3SheetTemplate, role, paperTrack, frame, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
  if (!hit) throw new Error(`template hit not found: ${role} ${paperTrack} ${frame}`)
  const localFrame = 'localFrame' in hit && typeof hit.localFrame === 'number' ? hit.localFrame : hit.frame
  const rect = cellRectForHit(
    standardA3SheetTemplate,
    { ...hit, frame: localFrame },
    standardA3SheetTemplate.defaults.durationFrames,
    standardA3SheetTemplate.defaults.frameOrigin,
  )
  if (!rect) throw new Error(`template rect not found: ${role} ${paperTrack} ${frame}`)
  return {
    pageId: hit.pageId ?? 'page_1',
    rect,
  }
}

function rectMatches(actual: NormalizedRect, expected: NormalizedRect): boolean {
  return closeTo(actual.x, expected.x)
    && closeTo(actual.y, expected.y)
    && closeTo(actual.w, expected.w)
    && closeTo(actual.h, expected.h)
}

function closeTo(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 0.002
}

async function clientToScreen(point: ClientPoint): Promise<ScreenPoint> {
  const windowMetrics = await runMouseOpJson<WindowClientMetrics>(['window-client-metrics', '--app-pid', args['app-pid'] as string])
  const metrics = await evaluatePage<ViewportMetrics>(`
    (() => ({
      screenX: window.screenX,
      screenY: window.screenY,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    }))()
  `)
  const scaleX = windowMetrics.client.width / metrics.innerWidth
  const scaleY = windowMetrics.client.height / metrics.innerHeight
  if (point.x < 0 || point.y < 0 || point.x > metrics.innerWidth || point.y > metrics.innerHeight) {
    throw new Error(`client point is outside the visible WebView viewport: ${JSON.stringify({ point, metrics })}`)
  }
  diagnostics.viewportMetrics = metrics
  diagnostics.windowClientMetrics = windowMetrics
  const screenPoint = {
    x: Math.round(windowMetrics.client.x + point.x * scaleX),
    y: Math.round(windowMetrics.client.y + point.y * scaleY),
  }
  const clientRight = windowMetrics.client.x + windowMetrics.client.width
  const clientBottom = windowMetrics.client.y + windowMetrics.client.height
  if (screenPoint.x < windowMetrics.client.x || screenPoint.x > clientRight || screenPoint.y < windowMetrics.client.y || screenPoint.y > clientBottom) {
    throw new Error(`screen point is outside the app client rectangle: ${JSON.stringify({ point, screenPoint, client: windowMetrics.client })}`)
  }
  return screenPoint
}

async function screenToClient(point: ScreenPoint): Promise<ClientPoint> {
  const windowMetrics = await runMouseOpJson<WindowClientMetrics>(['window-client-metrics', '--app-pid', args['app-pid'] as string])
  const metrics = await evaluatePage<ViewportMetrics>(`
    (() => ({
      screenX: window.screenX,
      screenY: window.screenY,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    }))()
  `)
  const scaleX = windowMetrics.client.width / metrics.innerWidth
  const scaleY = windowMetrics.client.height / metrics.innerHeight
  return {
    x: (point.x - windowMetrics.client.x) / scaleX,
    y: (point.y - windowMetrics.client.y) / scaleY,
  }
}

async function waitForPageCondition(predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 12000): Promise<void> {
  await waitForCondition(predicate, label, timeoutMs)
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 12000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(100)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function evaluatePage<T>(expression: string): Promise<T> {
  if (!client) throw new Error('CDP client is not connected')
  const response = await client.send<{ result: { value?: T; description?: string }; exceptionDetails?: unknown }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) throw new Error(`page evaluation failed: ${JSON.stringify(response.exceptionDetails)}`)
  return response.result.value as T
}

async function pageDebug(): Promise<Record<string, unknown>> {
  return evaluatePage<Record<string, unknown>>(`
    (() => ({
      bodyText: document.body?.textContent?.slice(0, 1000) ?? '',
      assetCards: Array.from(document.querySelectorAll('.assetCard')).map(item => item.textContent?.trim()).slice(0, 20),
      assetLocation: document.querySelector('.assetLocationText')?.textContent?.trim() ?? '',
      assignedEvents: document.querySelectorAll('.assetAssignedEventRect').length,
      dropDiagnostics: window.__xsheetDropDiagnostics ?? [],
      viewport: { innerWidth, innerHeight, screenX, screenY, outerWidth, outerHeight, devicePixelRatio },
    }))()
  `)
}

async function waitForCdpTarget(port: number, predicate: (target: CdpListTarget) => boolean, label: string): Promise<CdpListTarget> {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()) as CdpListTarget[]
    const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl && predicate(item))
    if (target) return target
    await delay(250)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function captureScreenshot(label: string): Promise<string> {
  if (!client) throw new Error('CDP client is not connected')
  const fileName = `${label.replace(/[^a-z0-9_-]+/gi, '-')}.png`
  const path = join(args['screenshot-root'] as string, fileName)
  const response = await client.send<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  await writeFile(path, Buffer.from(response.data, 'base64'))
  if (!screenshots.includes(path)) screenshots.push(path)
  diagnostics.screenshots = [...screenshots]
  return path
}

function screenshotArtifacts(): string[] {
  return [...screenshots]
}

function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      values[key] = 'true'
    } else {
      values[key] = next
      index += 1
    }
  }
  return values
}

function escapeForSingleQuotedError(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failureKind(error: unknown): 'environment' | 'assertion' {
  return errorMessage(error).includes('E2E_ENVIRONMENT_UNAVAILABLE') ? 'environment' : 'assertion'
}
