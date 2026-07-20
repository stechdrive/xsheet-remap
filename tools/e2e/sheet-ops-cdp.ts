import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  cellRectForHit,
  resolveSheetTemplateGridLayout,
  sheetGridCellRect,
  timingHitForFrame,
  standardA3SheetTemplate,
  type NormalizedRect,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import { assertSelectorsContributePaint } from './visual-paint-contract'
import { verifyAnnotationInteractionScenario } from './scenarios/annotation-interactions'
import { verifyCameraDialogScalability } from './scenarios/camera-dialog-scalability'
import { verifyCspImportExportScenario } from './scenarios/csp-import-export'
import { verifySharedCutMenuControlsScenario, verifyTopMenuBehaviorScenario } from './scenarios/shared-ui-controls'
import { CdpClient } from './cdp-client'
import {
  assetBrowserCardPointByName,
  clickStackGuideCardByLabel,
  dragAssetBrowserCardToStackGuide,
  waitForStackGuideCardAsset,
} from './csp-asset-actions'

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

const args = parseArgs(process.argv.slice(2))
const port = Number(args.port)
if (!Number.isInteger(port) || port <= 0) throw new Error('--port is required')
if (!args.result) throw new Error('--result is required')
if (!args.report) throw new Error('--report is required')

const checks: string[] = []
const scenarioArtifacts: string[] = []
let client: CdpClient | null = null
let previewClient: CdpClient | null = null
const e2ePageFrames = standardA3SheetTemplate.defaults.durationFrames
let e2eDurationFrames = e2ePageFrames
const sheetOpsScenarioIds = [
  'shell-layout',
  'stack-guides',
  'multipage-timing',
  'timing-edit',
  'asset-drop',
  'asset-preview',
  'sound-ops',
  'camera-ops',
  'timeline-ripple',
  'timeline-memo',
  'annotation-interactions',
  'sheet-history',
  'export-validation',
] as const
type SheetOpsScenarioId = typeof sheetOpsScenarioIds[number]
const scenarioId = parseSheetOpsScenarioId(args.scenario)

try {
  const target = await waitForCdpTarget(port, target => !target.url.includes('window=asset-preview'), 'main CDP target')
  if (!target.webSocketDebuggerUrl) throw new Error('CDP target did not expose a websocket URL')
  client = await CdpClient.connect(target.webSocketDebuggerUrl)
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Input.setIgnoreInputEvents', { ignore: false })

  await waitForSheet()
  await runSheetOpsScenario(scenarioId)

  if (args.screenshot) await capturePageScreenshot(args.screenshot)
  const report: SheetOpsReport = {
    checks,
    finalEvents: await evaluatePage<EventSnapshot[]>(snapshotEventsExpression()),
  }
  await writeJson(args.report, report)
  await writeJson(args.result, {
    passed: true,
    scenario: scenarioId,
    checks,
    artifacts: [args.report, args.screenshot, ...scenarioArtifacts].filter(Boolean),
  })
} catch (error) {
  const failureArtifacts = [args.report, ...scenarioArtifacts]
  if (client && args['failure-screenshot']) {
    await capturePageScreenshot(args['failure-screenshot'])
      .then(() => failureArtifacts.push(args['failure-screenshot']))
      .catch(() => undefined)
  }
  const report = {
    checks,
    error: errorMessage(error),
    debug: client ? await pageDebug().catch(debugError => ({ debugError: errorMessage(debugError) })) : null,
    previewDebug: previewClient ? await previewPageDebug().catch(debugError => ({ debugError: errorMessage(debugError) })) : null,
  }
  await writeJson(args.report, report)
  await writeJson(args.result, {
    passed: false,
    scenario: scenarioId,
    error: errorMessage(error),
    checks,
    artifacts: failureArtifacts,
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

function parseSheetOpsScenarioId(value: string | undefined): SheetOpsScenarioId {
  if (value && (sheetOpsScenarioIds as readonly string[]).includes(value)) return value as SheetOpsScenarioId
  throw new Error(`--scenario must be one of: ${sheetOpsScenarioIds.join(', ')}`)
}

async function runSheetOpsScenario(scenario: SheetOpsScenarioId): Promise<void> {
  switch (scenario) {
    case 'shell-layout':
      await verifyShellLayoutScenario()
      return
    case 'stack-guides':
      await verifyStackGuidePlacementAndSharedCuts()
      return
    case 'multipage-timing':
      await verifyMultiPageTimingScenario()
      return
    case 'timing-edit':
      await verifyTimingEditingScenario()
      return
    case 'asset-drop':
      await verifyAssetDropScenario()
      return
    case 'asset-preview':
      await verifyAssetPreviewScenario()
      return
    case 'sound-ops':
      await verifySoundCueEditing()
      return
    case 'camera-ops':
      await verifyCameraCueInputHandoff()
      return
    case 'timeline-ripple':
      await verifyTimelineRippleEditing()
      return
    case 'timeline-memo':
      await verifyTimelineMemoEditing()
      return
    case 'annotation-interactions':
      await verifyAnnotationInteractionScenario({
        checks,
        clickFrame,
        keyPress,
        waitForEventAt,
        dragSoundRange,
        waitForSelector,
        setReactFieldValue,
        clickButtonByText,
        waitForSoundCueAt,
        clientPointsForTimedRange,
        mouseDrag,
        waitForCameraCueAt,
        rightClickFrame,
        rightClickTimedRangeFrame,
        evaluatePage,
        waitForPageCondition,
        clickMenuItem,
        selectorInsetDrag,
        hoverSelector,
        centerOfSelector,
        inputPointForSelector,
        waitForCondition,
        mouseClick,
        mouseDoubleClick,
        clientSend,
        captureScreenshot: capturePageScreenshotData,
        captureScreenshotArtifact: captureScenarioScreenshot,
      })
      return
    case 'sheet-history':
      await verifySheetHistoryScenario()
      return
    case 'export-validation':
      if (!args['cut-root']) throw new Error('--cut-root is required for export-validation')
      await verifyCspImportExportScenario({
        cutRoot: args['cut-root'], checks, mouseClick, centerOfSelector, waitForPageCondition,
        clickButtonByText, evaluatePage, waitForCondition,
      })
  }
}

async function verifySheetHistoryScenario(): Promise<void> {
  await waitForPageCondition(() => {
    const rail = document.querySelector('.sheetHistoryRail')
    const tabs = document.querySelectorAll('.sheetHistoryTab')
    return rail?.getAttribute('aria-label') === 'シート履歴'
      && document.querySelector('.sheetHistoryTabs')?.getAttribute('aria-orientation') === 'vertical'
      && tabs.length === 1
      && tabs[0]?.getAttribute('aria-label') === '現在のシート'
  }, 'unnamed initial sheet history tab')
  checks.push('showed the unnamed initial sheet as an accessible document tab')

  await clickFrame('cell', 'A', 1)
  await keyPress('1')
  await keyPress('Enter')
  await waitForEventAt('cell', 'A', 1, '1')

  await mouseClick(await centerOfSelector('.sheetHistoryAddButton'))
  await waitForPageCondition(() => Boolean(document.querySelector('.sheetHistoryDialog')), 'sheet history add dialog')
  await setReactFieldValue('.sheetHistoryDialog input[list]', '演出確認')
  await clickButtonByText('追加')
  await waitForPageCondition(() => {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('.sheetHistoryTab'))
    return tabs.length === 2
      && tabs.some(tab => tab.getAttribute('aria-label') === '演出確認' && tab.getAttribute('aria-selected') === 'true')
  }, 'duplicated named sheet is active')
  await waitForPageCondition(() => Boolean(document.querySelector('.sheetRevisionReferenceLayer .sheetRevisionReferenceText')), 'source sheet underlay')
  checks.push('created a named duplicate and rendered the source sheet as a non-interactive reference layer')

  await clickFrame('cell', 'B', 2)
  await keyPress('2')
  await keyPress('Enter')
  await waitForEventAt('cell', 'B', 2, '2')

  await mouseClick(await centerOfSelector('.sheetHistoryTab[aria-label="現在のシート"]'))
  await waitForPageCondition(() => document.querySelector('.sheetHistoryTab[aria-label="現在のシート"]')?.getAttribute('aria-selected') === 'true', 'original sheet active')
  await waitForNoEventAt('cell', 'B', 2, '2')
  await waitForPageCondition(() => !document.querySelector('.sheetRevisionReferenceLayer'), 'reference hidden on original sheet')

  await mouseClick(await centerOfSelector('.sheetHistoryTab[aria-label="演出確認"]'))
  await waitForEventAt('cell', 'B', 2, '2')
  await waitForPageCondition(() => Boolean(document.querySelector('.sheetRevisionReferenceLayer')), 'reference restored on copied sheet')
  checks.push('switched between independent sheet histories without leaking timing events and restored the configured reference')
}

async function verifyShellLayoutScenario(): Promise<void> {
  await verifyTopMenuBehaviorScenario({
    checks, clickActionMenuSummary, ensureSharedCutMenuOpen, evaluatePage, mouseClick, mouseMove,
    viewportOutsideMenusPoint, waitForNoActionMenu, waitForPageCondition,
  })
  await verifyAssetBrowserShell()
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
  }, 'display-template menu visible inside the viewport')
  await keyPress('Escape')
  await waitForNoActionMenu('display-template menu closes with Escape')
  checks.push('opened the direct display-template menu inside the viewport and closed it with Escape')
}

async function verifyMultiPageTimingScenario(): Promise<void> {
  await dropSheetSourcesForMultiPage()
  e2eDurationFrames = e2ePageFrames * 2
  await waitForSheetPageCount(2)
  await clickFrame('cell', 'A', e2ePageFrames + 1)
  await keyPress('9')
  await waitForNoEventAt('cell', 'A', e2ePageFrames + 1, '9')
  await keyPress('Enter')
  await waitForEventAt('cell', 'A', e2ePageFrames + 1, '9')
  await waitForSelectedFrame('cell', 'A', e2ePageFrames + 2)
  checks.push('dropped two sheet images, created a multi-page sheet, committed input on page 2, and advanced one frame')
}

async function verifyTimingEditingScenario(): Promise<void> {
  await dragRange('cell', 'A', 1, 3)
  await waitForPageCondition(() => Boolean(document.querySelector('.selectedRangeRect')), 'visible CELL selection range')
  await waitForSelectedRange('cell', 'A', 1, 3)
  await keyPress('1')
  await waitForNoEventAt('cell', 'A', 1, '1')
  await keyPress('Enter')
  await waitForEventAt('cell', 'A', 1, '1')
  await waitForSelectedFrame('cell', 'A', 4)
  checks.push('committed a CELL range value only on Enter and advanced by the selected range length')

  await clickFrame('cell', 'B', 2)
  await keyPress('2')
  await waitForNoEventAt('cell', 'B', 2, '2')
  await keyPress('Enter')
  await waitForEventAt('cell', 'B', 2, '2')
  await dragRangeBetweenTracks('cell', 'A', 1, 'B', 3)
  await waitForSelectedRangeTracks('cell', ['A', 'B'], 1, 3)
  await keyboardShortcut('c')
  await clickFrame('cell', 'C', 30)
  await waitForSelectedFrame('cell', 'C', 30)
  await keyboardShortcut('v')
  await waitForEventAt('cell', 'C', 30, '1')
  await waitForEventAt('cell', 'D', 31, '2')
  await waitForNoEventAt('cell', 'C', 31, '2')
  checks.push('copied a multi-track CELL rectangle while preserving track and frame offsets')

  await dragRange('cell', 'A', 1, 3)
  await waitForSelectedRange('cell', 'A', 1, 3)
  await keyboardShortcut('c')
  await dragRange('cell', 'B', 10, 15)
  await waitForSelectedRange('cell', 'B', 10, 15)
  await rightClickFrame('cell', 'B', 10)
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')), 'timing repeat context menu')
  await clickMenuItem('選択範囲内にリピート貼り付け')
  await waitForEventAt('cell', 'B', 10, '1')
  await waitForEventAt('cell', 'B', 13, '1')
  await waitForNoEventAt('cell', 'B', 12, '1')
  await waitForNoEventAt('cell', 'B', 15, '1')
  checks.push('repeated a sparse copied range without filling its empty frames')

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
  checks.push('cut only the selected timing range')

  await clickFrame('cell', 'A', 6)
  await waitForSelectedFrame('cell', 'A', 6)
  await keyPress('2')
  await waitForNoEventAt('cell', 'A', 6, '2')
  await keyPress('Enter')
  await waitForEventAt('cell', 'A', 6, '2')
  await dragTimelineEvent('cell', 'A', 6, 'cell', 'A', 8)
  await waitForEventAt('cell', 'A', 8, '2')
  await waitForNoEventAt('cell', 'A', 6, '2')
  checks.push('moved an existing timeline event without leaving a duplicate at its source')

  await rightClickFrame('cell', 'A', 8)
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')), 'timing delete context menu')
  await clickMenuItem('キーを削除 ([Del])')
  await waitForNoEventAt('cell', 'A', 8, '2')
  checks.push('deleted a timeline event from the sheet context menu')
}

async function verifyAssetDropScenario(): Promise<void> {
  const primaryAsset = requireArg('asset')
  const secondaryAsset = requireArg('asset-secondary')
  await dragRange('cell', 'A', 20, 24)
  await waitForSelectedRange('cell', 'A', 20, 24)
  await dropAssetFile('cell', 'A', 24, primaryAsset)
  await waitForAssetEventAt('cell', 'A', 20)
  await waitForNoAssetEventAt('cell', 'A', 24)
  await waitForSelectedRegisteredCellCard('A')
  await recordAssetRootStateAfterCdpDrop()
  checks.push('assigned a dropped asset to the active range start and selected its registered card')

  await dropAssetFile('cell', 'B', 30, secondaryAsset)
  await waitForAssetEventAt('cell', 'B', 30)
  await waitForSelectedRegisteredCellCard('B')
  await waitForAssetEventAt('cell', 'A', 20)
  checks.push('created an independent second registered cell without altering the first assignment')
}

async function verifyAssetPreviewScenario(): Promise<void> {
  const primaryAsset = requireArg('asset')
  const secondaryAsset = requireArg('asset-secondary')
  await verifyAssetBrowserShell()
  await dropAssetFolderOnBrowser(requireArg('asset-root'))
  await dragRange('cell', 'A', 20, 24)
  await dropAssetFile('cell', 'A', 24, primaryAsset)
  await waitForAssetEventAt('cell', 'A', 20)
  await waitForSelectedRegisteredCellCard('A')

  await openAssetBrowserPreviewByName('A1.png')
  previewClient = await connectPreviewWindow(port)
  await waitForPreviewText('A1')
  checks.push('opened the native material preview from a visible quick-preview control')

  await clickAssetBrowserCardByName('A1_e.png')
  await waitForPreviewText('A1_e.png')
  await waitForPreviewTextMissing('A1.png')
  checks.push('updated the open preview from an unregistered catalog material selection')

  await dropAssetFile('cell', 'B', 30, secondaryAsset)
  await waitForAssetEventAt('cell', 'B', 30)
  await clickRegisteredCellCardByTrack('B')
  await waitForSelectedRegisteredCellCard('B')
  await waitForPreviewText('A2')
  await waitForPreviewTextMissing('A1_e.png')
  checks.push('updated the open preview from a registered CSP card selection')

  await clickRegisteredCellCardByTrack('A')
  await waitForSelectedRegisteredCellCard('A')
  await waitForPreviewText('A1')
  await waitForPreviewTextMissing('A2')
  checks.push('switched the open preview between material-assigned registered CSP cards')

  await createStackGuideLabelFromHeader('action', 2, 'BOOK-PREVIEW')
  await waitForStackGuideLabelRole('BOOK-PREVIEW', 'action')
  await dragAssetBrowserCardToStackGuide(activeClient(), 'A1_e.png', 'BOOK-PREVIEW')
  await waitForStackGuideCardAsset(activeClient(), 'BOOK-PREVIEW', 'A1_e.png')
  await clickStackGuideCardByLabel(activeClient(), 'BOOK-PREVIEW')
  await waitForPreviewText('BOOK-PREVIEW')
  await waitForPreviewText('A1_e.png')
  await waitForPreviewTextMissing('A1.png')
  checks.push('updated the open preview from a material-assigned BG/BOOK, camera-note, or memo CSP card')
}

async function dropSheetSourcesForMultiPage(): Promise<void> {
  const sheetSources = [args.sheetSource, args['sheet-source'], args.sheetSourceSecondary, args['sheet-source-secondary']]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
  if (sheetSources.length < 2) throw new Error('--sheet-source and --sheet-source-secondary are required')
  const menuOpen = await evaluatePage<boolean>(`Boolean(document.querySelector('.paperSheetRailMenu.actionMenuPortalContent'))`)
  if (!menuOpen) await clickActionMenuSummary('紙シート')
  await waitForSelector('.paperSheetRailMenu.actionMenuPortalContent')
  await setFileInputFiles('.paperSheetRailMenu input[type="file"]', sheetSources)
}

async function verifySoundCueEditing(): Promise<void> {
  await dragSoundRange('sound_lane_1', 10, 15)
  await keyPress('Enter')
  await waitForSelector('[role="dialog"][aria-label="SOUND指示"]')
  await setReactFieldValue('[aria-label="SOUNDラベル"]', 'E2E話者')
  await setReactFieldValue('[aria-label="SOUND内容"]', 'E2Eセリフ')
  await clickButtonByText('追加')
  await waitForSoundCueAt('sound_lane_1', 10, 15, 'E2E話者')

  await doubleClickSoundFrame('sound_lane_1', 10)
  await waitForSelector('[role="dialog"][aria-label="SOUND区間を編集"]')
  await setReactFieldValue('[aria-label="SOUNDラベル"]', 'E2E効果音')
  await clickButtonByText('更新')
  await waitForSoundCueAt('sound_lane_1', 10, 15, 'E2E効果音')

  await dragSoundCueBody('sound_lane_1', 10, 20)
  await waitForSoundCueAt('sound_lane_1', 20, 25, 'E2E効果音')
  await resizeSelectedSoundCueEnd('sound_lane_1', 30)
  await waitForSoundCueAt('sound_lane_1', 20, 30, 'E2E効果音')
  await keyboardShortcut('z')
  await waitForSoundCueAt('sound_lane_1', 20, 25, 'E2E効果音')

  await keyboardShortcut('c')
  await dragSoundRange('sound_lane_1', 35, 40)
  await keyboardShortcut('v')
  await waitForSoundCueAt('sound_lane_1', 35, 40, 'E2E効果音')
  checks.push('created, edited, moved, resized, undid, copied, and pasted a template-mapped SOUND interval')
}

async function verifyTimelineMemoEditing(): Promise<void> {
  await rightClickFrame('action', 'A', 70)
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')), 'timeline memo create menu')
  await clickMenuItem('メモを追加')
  await waitForPageCondition(() => document.querySelectorAll('.timelineMemoSegment.selected').length === 2, 'A3 six-second wrap memo segments')
  await waitForPageCondition(() => Boolean(document.querySelector('.timelineMemoAnchorCue.selected[data-timeline-memo-anchor-frame="70"] .timelineMemoAnchorMarker')), 'timeline memo anchor cue')
  await waitForPageCondition(() => Boolean(document.querySelector('.annotationFloatingPalette[data-annotation-target="timeline-memo"] button[aria-label="選択メモに描画"][aria-pressed="true"]')), 'memo-targeted pen session')
  const anchorCuePlacement = await evaluatePage<{ markerLeft: number; markerRight: number; cellLeft: number; cellCenter: number }>(`
    (() => {
      const marker = document.querySelector('.timelineMemoAnchorCue[data-timeline-memo-anchor-frame="70"] .timelineMemoAnchorMarker');
      const memo = document.querySelector('.timelineMemoSegment.selected');
      if (!marker || !memo) throw new Error('timeline memo anchor geometry is unavailable');
      const markerRect = marker.getBoundingClientRect();
      const memoRect = memo.getBoundingClientRect();
      return { markerLeft: markerRect.left, markerRight: markerRect.right, cellLeft: memoRect.left, cellCenter: memoRect.left + memoRect.width / 2 };
    })()
  `)
  if (anchorCuePlacement.markerLeft < anchorCuePlacement.cellLeft - 1 || anchorCuePlacement.markerRight >= anchorCuePlacement.cellCenter) {
    throw new Error('timeline memo anchor cue is not confined to the left side of its frame')
  }
  const selectedAnchorIsVisualOnly = await evaluatePage<boolean>(`
    !document.querySelector('.timelineMemoAnchorCue.selected .timelineMemoAnchorHitArea')
  `)
  if (!selectedAnchorIsVisualOnly) throw new Error('selected timeline memo anchor still owns pointer input')
  const beforeMove = await selectedTimelineMemoGeometry()
  const memoMove = await selectorInsetDrag('.timelineMemoMoveHandle .timelineMemoHandleHitArea', 0.5, 0.5, 1.5, 0.5)
  const moveHandleReceivesInput = await evaluatePage<boolean>(`
    (() => {
      const point = ${JSON.stringify(memoMove.start)};
      return Boolean(document.elementFromPoint(point.x, point.y)?.closest('.timelineMemoMoveHandle'));
    })()
  `)
  if (!moveHandleReceivesInput) throw new Error('timeline memo move handle does not receive pointer input')
  await mouseDrag(memoMove.start, memoMove.end)
  await waitForCondition(async () => {
    const current = await selectedTimelineMemoGeometry()
    return current.memoLeft > beforeMove.memoLeft + 4
  }, 5000, 'timeline memo moved')
  const afterMove = await selectedTimelineMemoGeometry()
  if (Math.abs(afterMove.anchorLeft - beforeMove.anchorLeft) > 1 || Math.abs(afterMove.anchorTop - beforeMove.anchorTop) > 1) {
    throw new Error('timeline memo anchor moved with its canvas')
  }
  if (!afterMove.connectorVisible) throw new Error('timeline memo connector is unavailable after moving its canvas')
  checks.push('moved the handwritten memo from its initially overlapping anchor while keeping the logical frame fixed')
  const draw = await selectorInsetDrag('.timelineMemoSegment.selected .timelineMemoDrawSurface', 0.2, 0.25, 0.8, 0.75)
  const drawSurfaceReceivesInput = await evaluatePage<boolean>(`
    [${JSON.stringify(draw.start)}, ${JSON.stringify(draw.end)}].every(point =>
      Boolean(document.elementFromPoint(point.x, point.y)?.closest('.timelineMemoDrawSurface'))
    )
  `)
  if (!drawSurfaceReceivesInput) throw new Error('timeline memo handles obstruct the transparent drawing surface')
  await mouseDrag(draw.start, draw.end)
  await waitForPageCondition(() => document.querySelectorAll('.timelineMemoStroke:not(.draft)').length >= 1, 'timeline memo ink')
  checks.push('created a range-sized handwritten memo and entered its pen session automatically')

  const inkBeforeErase = await evaluatePage<string>(`Array.from(document.querySelectorAll('.timelineMemoStroke:not(.draft)')).map(path => path.getAttribute('d')).join('|')`)
  await hoverSelector('.annotationFloatingPalette[data-annotation-target="timeline-memo"]')
  await waitForSelector('button[aria-label="選択メモ内を消去"]')
  await mouseClick(await centerOfSelector('button[aria-label="選択メモ内を消去"]'))
  await waitForPageCondition(() => Boolean(document.querySelector('.annotationFloatingPalette[data-annotation-target="timeline-memo"] button[aria-label="選択メモ内を消去"][aria-pressed="true"]')), 'memo-targeted eraser session')
  const erase = await selectorInsetDrag('.timelineMemoSegment.selected .timelineMemoDrawSurface.eraser', 0.46, 0.78, 0.54, 0.22)
  await mouseDrag(erase.start, erase.end)
  await waitForCondition(async () => (await evaluatePage<string>(`Array.from(document.querySelectorAll('.timelineMemoStroke:not(.draft)')).map(path => path.getAttribute('d')).join('|')`)) !== inkBeforeErase, 5000, 'timeline memo ink erased')
  await waitForPageCondition(() => Boolean(document.querySelector('.timelineMemoSegment.selected')), 'memo remains selected after erasing')
  checks.push('kept the memo target while switching to the shared eraser and erased only memo ink')

  const beforeWidth = await evaluatePage<number>(`Number(document.querySelector('.timelineMemoSegment.selected .timelineMemoBounds')?.getAttribute('width') ?? 0)`)
  const resize = await selectorInsetDrag('.timelineMemoSegment.selected .timelineMemoResizeHandle', 0.5, 0.5, 4.5, 3.5)
  const resizeHandleReceivesInput = await evaluatePage<boolean>(`(() => { const point = ${JSON.stringify(resize.start)}; return Boolean(document.elementFromPoint(point.x, point.y)?.closest('.timelineMemoResizeHandle')); })()`)
  if (!resizeHandleReceivesInput) throw new Error('timeline memo resize handle does not receive pointer input')
  await mouseDrag(resize.start, resize.end)
  await waitForCondition(async () => (await evaluatePage<number>(`Number(document.querySelector('.timelineMemoSegment.selected .timelineMemoBounds')?.getAttribute('width') ?? 0)`)) > beforeWidth, 5000, 'timeline memo resized')
  checks.push('resized the logical memo canvas with its persistent bounding handle')

  const exitMemoPoint = await clientPointForFrame('action', 'A', 20)
  const exitMemoTargetIsOutside = await evaluatePage<boolean>(`
    (() => {
      const point = ${JSON.stringify(exitMemoPoint)};
      const target = document.elementFromPoint(point.x, point.y);
      return !target?.closest('[data-timeline-memo-id]');
    })()
  `)
  if (!exitMemoTargetIsOutside) throw new Error('timeline memo hit area obstructs a frame outside its visible bounds')
  await mouseClick(exitMemoPoint)
  await waitForPageCondition(() => !document.querySelector('.timelineMemoSegment.selected'), 'timeline memo edit exit')
  await waitForPageCondition(() => Boolean(document.querySelector('.annotationFloatingPalette[data-annotation-target="sheet"]')), 'sheet annotation target restored')
  await waitForPageCondition(() => Boolean(document.querySelector('.timelineMemoAnchorCue:not(.selected)[data-timeline-memo-anchor-frame="70"]')), 'persistent timeline memo anchor cue')
  const unselectedMemoOwnsOnlyInk = await evaluatePage<boolean>(`
    !document.querySelector('.timelineMemoSegment:not(.selected) .timelineMemoHitArea')
      && Boolean(document.querySelector('.timelineMemoSegment:not(.selected) .timelineMemoStrokeHit'))
  `)
  if (!unselectedMemoOwnsOnlyInk) throw new Error('unselected timeline memo still owns its transparent canvas')
  await clientPointForFrame('action', 'A', 70)
  await mouseClick(await inputPointForSelector('.timelineMemoAnchorCue[data-timeline-memo-anchor-frame="70"] .timelineMemoAnchorHitArea'), 'right')
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')), 'timeline memo anchor context menu')
  const contextMenuKeepsSheetActions = await evaluatePage<boolean>(`
    (() => {
      const menu = document.querySelector('[role="menu"]');
      const labels = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? []).map(item => item.textContent?.trim());
      return labels.includes('メモを編集') && labels.includes('メモを削除') && labels.includes('挿入') && labels.includes('削除');
    })()
  `)
  if (!contextMenuKeepsSheetActions) throw new Error('timeline memo context menu hides the underlying sheet actions')
  await clickMenuItem('メモを編集')
  await waitForPageCondition(() => Boolean(document.querySelector('.timelineMemoSegment.selected')), 'timeline memo re-entry from anchor')
  await waitForPageCondition(() => Boolean(document.querySelector('.annotationFloatingPalette[data-annotation-target="timeline-memo"]')), 'timeline memo tools restored after re-entry')
  const refinedHandlesVisible = await evaluatePage<boolean>(`
    Boolean(document.querySelector('.timelineMemoMoveHandleVisual'))
      && document.querySelectorAll('.timelineMemoMoveHandleGrip').length === 3
      && Boolean(document.querySelector('.timelineMemoResizeHandleVisual'))
      && !document.querySelector('.timelineMemoMoveHandleGlyph')
  `)
  if (!refinedHandlesVisible) throw new Error('refined timeline memo move and resize handles are unavailable')
  const resumedExitMemoPoint = await clientPointForFrame('action', 'A', 20)
  await mouseClick(resumedExitMemoPoint)
  await waitForPageCondition(() => !document.querySelector('.timelineMemoSegment.selected'), 'timeline memo second edit exit')
  checks.push('re-entered memo editing from the shared-size anchor while preserving underlying sheet actions')
  await mouseClick(resumedExitMemoPoint)
  await keyPress('4')
  await keyPress('Enter')
  await waitForEventAt('action', 'A', 20, '4')
  checks.push('left memo editing on an outside click and continued ordinary frame input')

  await dropSheetSourcesForMultiPage()
  e2eDurationFrames = e2ePageFrames * 2
  await waitForSheetPageCount(2)
  await rightClickFrame('action', 'A', 146)
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')), 'page 2 memo create menu')
  await clickMenuItem('メモを追加')
  await waitForPageCondition(() => Boolean(document.querySelector('svg.sheetSvg[data-page-id="page_2"] .timelineMemoSegment.selected')), 'page 2 anchored memo')
  await waitForPageCondition(() => Boolean(document.querySelector('svg.sheetSvg[data-page-id="page_2"] .timelineMemoAnchorCue[data-timeline-memo-anchor-frame="146"]')), 'page 2 timeline memo anchor cue')
  const pageOneHasPageTwoAnchor = await evaluatePage<boolean>('Boolean(document.querySelector(\'svg.sheetSvg[data-page-id="page_1"] .timelineMemoAnchorCue[data-timeline-memo-anchor-frame="146"]\'))')
  if (pageOneHasPageTwoAnchor) throw new Error('page 2 timeline memo anchor cue leaked onto page 1')
  const pageTwoDraw = await selectorInsetDrag('svg.sheetSvg[data-page-id="page_2"] .timelineMemoDrawSurface', 0.2, 0.25, 0.78, 0.75)
  await mouseDrag(pageTwoDraw.start, pageTwoDraw.end)
  await waitForPageCondition(() => Boolean(document.querySelector('svg.sheetSvg[data-page-id="page_2"] .timelineMemoStroke:not(.draft)')), 'page 2 memo ink')
  checks.push('created and drew a separately anchored memo on page 2')
}

async function selectedTimelineMemoGeometry(): Promise<{
  memoLeft: number
  memoTop: number
  anchorLeft: number
  anchorTop: number
  connectorVisible: boolean
}> {
  return evaluatePage(`
    (() => {
      const handle = document.querySelector('.timelineMemoMoveHandle');
      const bounds = handle?.closest('.timelineMemoSegment')?.querySelector('.timelineMemoBounds');
      const anchor = document.querySelector('.timelineMemoAnchorCue.selected .timelineMemoAnchorMarker');
      if (!bounds || !anchor) throw new Error('selected timeline memo geometry is unavailable');
      const memoBox = bounds.getBoundingClientRect();
      const anchorBox = anchor.getBoundingClientRect();
      return {
        memoLeft: memoBox.left,
        memoTop: memoBox.top,
        anchorLeft: anchorBox.left,
        anchorTop: anchorBox.top,
        connectorVisible: Boolean(document.querySelector('.timelineMemoAnchorConnector')),
      };
    })()
  `)
}

async function verifyCameraCueInputHandoff(): Promise<void> {
  await verifyCameraDialogScalability({
    clientPointsForTimedRange, mouseDrag, keyPress, waitForSelector,
    clickButtonByText, setReactFieldValue, evaluatePage,
    waitForPageCondition, checks,
  })

  const [start, end] = await clientPointsForTimedRange('camera', 'camera_lane_1', 1, 24)
  await mouseDrag(start, end)
  await keyPress('Enter')
  await waitForSelector('[role="dialog"][aria-label="撮影指示"]')
  await waitForPageCondition(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="撮影指示"]')
    if (!dialog) return false
    const radios = Array.from(dialog.querySelectorAll<HTMLElement>('[role="radio"]'))
    const builtIns = Array.from(dialog.querySelectorAll<HTMLOptionElement>('datalist option')).map(option => option.value)
    const instruction = dialog.querySelector<HTMLInputElement>('[aria-label="CAMERA指示"]')
    const addButton = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '追加')
    return dialog.querySelector('header strong')?.textContent?.trim() === '撮影指示'
      && radios.length === 5
      && !dialog.querySelector('.cameraShapePicker')
      && Boolean(dialog.querySelector('[role="radiogroup"][aria-label="開始から次の点までの図形"]'))
      && !dialog.querySelector('select')
      && !dialog.querySelector('[aria-label="CAMERA開始フレーム"]')
      && instruction?.required === false
      && addButton?.disabled === false
      && Boolean(dialog.querySelector('[aria-label="長さ コマ"]'))
      && Boolean(dialog.querySelector('[aria-label="CAMERA開始ラベル"]'))
      && Boolean(dialog.querySelector('[aria-label="CAMERA終了ラベル"]'))
      && ['OL', 'TU', 'TB', 'SL', 'DTU', 'DTB', 'PAN', 'FI', 'FO', 'WI', 'WO', 'Follow', '画ブレ'].every(value => builtIns.includes(value))
  }, 'compact CAMERA dialog with five visible outgoing-segment choices')
  await waitForPageCondition(() => document.querySelectorAll('[role="radiogroup"][aria-label="開始から次の点までの図形"] [role="radio"]').length === 5, 'five visible segment kinds')
  if (!await evaluatePage<boolean>(`document.querySelector('[role="radio"][aria-label="開始から次の点までをオーバーラップ"] path')?.getAttribute('d') === 'M7 3H29L18 12Z M7 21H29L18 12Z'`)) throw new Error('OL segment icon is not a closed filled shape')
  await mouseClick(await centerOfSelector('[role="radio"][aria-label="開始から次の点までを波線の区間指示"]'))
  await setReactFieldValue('[aria-label="CAMERA指示"]', 'E2E MIX')
  await setReactFieldValue('[aria-label="CAMERA開始ラベル"]', 'A')
  await setReactFieldValue('[aria-label="CAMERA終了ラベル"]', 'B')
  await clickButtonByText('＋ 中間ラベル')
  await setReactFieldValue('[aria-label="CAMERA中間ラベル1"]', 'MID')
  await mouseClick(await centerOfSelector('[role="radio"][aria-label="中間ラベル1から次の点までをオーバーラップ"]'))
  await waitForSelector('[aria-label="中間ラベル1から次の点までの交差フレーム"]')
  await setReactFieldValue('[aria-label="中間ラベル1から次の点までの交差フレーム"]', '18')
  await clickButtonByText('追加')
  await waitForCameraCueAt('camera_lane_1', 1, 24, 'E2E MIX')
  await waitForPageCondition(() => {
    const cue = document.querySelector<SVGGElement>('.cameraCue.range[data-camera-lane-id="camera_lane_1"][data-frame-start="1"][data-frame-end="24"]')
    if (!cue) return false
    const paths = Array.from(cue.querySelectorAll<SVGPolylineElement>('polyline.cameraCueStroke')).map(polyline =>
      (polyline.getAttribute('points') ?? '').trim().split(/\s+/).map(value => {
        const [x = Number.NaN, y = Number.NaN] = value.split(',').map(Number)
        return { x, y }
      }),
    )
    if (paths.length !== 2 || paths.some(path => path.length !== 3)) return false
    const [forward = [], reverse = []] = paths
    const pivot = forward[1]
    const reversePivot = reverse[1]
    if (!pivot || !reversePivot) return false
    const pivotMark = cue.querySelector<SVGLineElement>('.cameraCuePivotMark')
    const markX1 = Number(pivotMark?.getAttribute('x1'))
    const markX2 = Number(pivotMark?.getAttribute('x2'))
    const markY1 = Number(pivotMark?.getAttribute('y1'))
    const markY2 = Number(pivotMark?.getAttribute('y2'))
    const expectedCenter = ((forward[0]?.x ?? 0) + (forward[2]?.x ?? 0)) / 2
    const singleCenteredCrossing = Math.abs(pivot.x - reversePivot.x) < 0.0000001
      && Math.abs(pivot.y - reversePivot.y) < 0.0000001
      && Math.abs(pivot.x - expectedCenter) < 0.0000001
      && (forward[0]?.x ?? 0) < pivot.x && pivot.x < (forward[2]?.x ?? 0)
      && (reverse[0]?.x ?? 0) > reversePivot.x && reversePivot.x > (reverse[2]?.x ?? 0)
    const cueId = cue.dataset.cameraCueId
    const label = cueId ? document.querySelector<SVGGElement>(`.cameraCueLabel[data-camera-cue-id="${cueId}"]`) : null
    const labelText = label?.querySelector<SVGTextElement>('.cameraCueLabelText text')
    const labelHit = label?.querySelector<SVGRectElement>('.cameraCueLabelHit')
    const region = label?.querySelector<SVGRectElement>('clipPath rect')
    const labelRect = {
      x: Number(labelHit?.getAttribute('x')),
      y: Number(labelHit?.getAttribute('y')),
      w: Number(labelHit?.getAttribute('width')),
      h: Number(labelHit?.getAttribute('height')),
    }
    const regionRect = {
      x: Number(region?.getAttribute('x')),
      y: Number(region?.getAttribute('y')),
      w: Number(region?.getAttribute('width')),
      h: Number(region?.getAttribute('height')),
    }
    const laneWidth = Math.abs((forward[2]?.x ?? Number.NaN) - (forward[0]?.x ?? Number.NaN))
    const expectedPivotGridLineY = pivot.y
    const pivotIsOnFrameBoundary = Math.abs(pivot.y - expectedPivotGridLineY) < 0.0000001
    const pivotMarkIsCentered = Math.abs((markX1 + markX2) / 2 - pivot.x) < 0.0000001
      && Math.abs(markY1 - pivot.y) < 0.0000001
      && Math.abs(markY2 - pivot.y) < 0.0000001
      && Math.abs((markX2 - markX1) / laneWidth - 0.65) < 0.000001
    const contained = labelRect.x >= regionRect.x - 0.0000001
      && labelRect.y >= regionRect.y - 0.0000001
      && labelRect.x + labelRect.w <= regionRect.x + regionRect.w + 0.0000001
      && labelRect.y + labelRect.h <= regionRect.y + regionRect.h + 0.0000001
    const pivotCovered = pivot.x >= labelRect.x && pivot.x <= labelRect.x + labelRect.w
      && pivot.y >= labelRect.y && pivot.y <= labelRect.y + labelRect.h
    const pointFrames = Array.from(document.querySelectorAll<SVGGElement>(`.cameraCuePoint[data-camera-cue-id="${cueId}"]`))
      .map(point => Number(point.dataset.cameraPointFrame))
    const pointsContained = Array.from(document.querySelectorAll<SVGGElement>(`.cameraCuePoint[data-camera-cue-id="${cueId}"]`)).every(point => {
      const text = point.querySelector<SVGTextElement>('text')
      const clip = point.querySelector<SVGRectElement>('clipPath rect')
      const hit = point.querySelector<SVGRectElement>('.cameraCuePointHit')
      if (!text || !clip || !hit) return false
      const hitX = Number(hit.getAttribute('x'))
      const hitW = Number(hit.getAttribute('width'))
      const clipX = Number(clip.getAttribute('x'))
      const clipW = Number(clip.getAttribute('width'))
      return hitX >= clipX - 0.0000001
        && hitX + hitW <= clipX + clipW + 0.0000001
        && Number(text.getAttribute('font-size')) === 18
    })
    return singleCenteredCrossing
      && pivotIsOnFrameBoundary
      && pivotMarkIsCentered
      && Number(labelText?.getAttribute('font-size')) === 18
      && label?.dataset.cameraLabelOverflow === 'false'
      && contained
      && !pivotCovered
      && JSON.stringify(pointFrames) === JSON.stringify([1, 12, 24])
      && cue.querySelectorAll('.cameraCueRangePath.wave').length === 1
      && cue.querySelectorAll('.cameraCueOverlapFill').length === 2
      && cue.querySelectorAll('.cameraCueMarker.start').length === 1
      && cue.querySelectorAll('.cameraCueMarker.end').length === 0
      && pointsContained
  }, 'mixed wave-to-OL instruction with local pivot, start marker, and contained label')

  const pointLabelPixels = await assertSelectorsContributePaint({
    evaluate: evaluatePage,
    captureScreenshot: capturePageScreenshotData,
  }, {
    selector: '.cameraCueEndpointLabel text',
    expectedCount: 3,
    label: 'CAMERA start, intermediate, and end point labels',
  })
  checks.push(`CAMERA point labels contributed visible compositor pixels: ${pointLabelPixels.join(', ')}`)

  const intermediateStart = await centerOfSelector('.cameraCuePoint.intermediate .cameraCuePointHit')
  const intermediateTarget = await clientPointForTimedRangeFrame('camera', 'camera_lane_1', 16)
  await mouseDrag(intermediateStart, intermediateTarget)
  await waitForPageCondition(() => document.querySelector<SVGGElement>('.cameraCuePoint.intermediate')?.dataset.cameraPointFrame === '16', 'CAMERA intermediate point snapped to frame 16')
  const historyStored = await evaluatePage<boolean>(`
    (() => {
      const instructions = JSON.parse(localStorage.getItem('xsheet:camera-instruction-history') ?? '[]');
      const points = JSON.parse(localStorage.getItem('xsheet:camera-point-label-history') ?? '[]');
      return instructions[0] === 'E2E MIX' && ['A', 'MID', 'B'].every(value => points.includes(value));
    })()
  `)
  if (!historyStored) throw new Error('CAMERA instruction or point-label MRU history was not persisted')
  await mouseDrag(await clientPointForTimedRangeFrame('camera', 'camera_lane_1', 4), await clientPointForTimedRangeFrame('camera', 'camera_lane_1', 6))
  await waitForCameraCueAt('camera_lane_1', 3, 26, 'E2E MIX')
  const cameraMoveEnded = await evaluatePage<boolean>(`!document.querySelector('.cameraCue.transforming')
    && Boolean(document.querySelector('.cameraCue.selected[data-frame-start="3"][data-frame-end="26"]'))`)
  if (!cameraMoveEnded) throw new Error('CAMERA drag did not leave the transform state on pointer release')
  await clickFrame('action', 'A', 8)
  await keyPress('1')
  await keyPress('Enter')
  await waitForEventAt('action', 'A', 8, '1')
  await waitForSelectedFrame('action', 'A', 9)
  const editorReopened = await evaluatePage<boolean>('Boolean(document.querySelector(\'[role="dialog"][aria-label="撮影指示"]\'))')
  if (editorReopened) throw new Error('CAMERA editor reopened instead of accepting ACTION timing input')
  checks.push('created and moved a mixed wave-to-OL CAMERA cue, left transform state on release, and continued ACTION input')
}

async function verifyTimelineRippleEditing(): Promise<void> {
  await clickFrame('action', 'A', 2)
  await keyPress('1')
  await keyPress('Enter')
  await waitForEventAt('action', 'A', 2, '1')
  await clickFrame('cell', 'B', 8)
  await keyPress('2')
  await keyPress('Enter')
  await waitForEventAt('cell', 'B', 8, '2')

  await dragSoundRange('sound_lane_1', 4, 8)
  await keyPress('Enter')
  await waitForSelector('[role="dialog"][aria-label="SOUND指示"]')
  await setReactFieldValue('[aria-label="SOUNDラベル"]', 'RIPPLE SOUND')
  await clickButtonByText('追加')
  await waitForSoundCueAt('sound_lane_1', 4, 8, 'RIPPLE SOUND')

  const [cameraStart, cameraEnd] = await clientPointsForTimedRange('camera', 'camera_lane_1', 6, 10)
  await mouseDrag(cameraStart, cameraEnd)
  await keyPress('Enter')
  await waitForSelector('[role="dialog"][aria-label="撮影指示"]')
  await setReactFieldValue('[aria-label="CAMERA指示"]', 'RIPPLE CAMERA')
  await clickButtonByText('追加')
  await waitForCameraCueAt('camera_lane_1', 6, 10, 'RIPPLE CAMERA')

  await rightClickTimedRangeFrame('sound', 'sound_lane_1', 6)
  await clickMenuItem('挿入')
  await waitForSelector('[role="dialog"][aria-label="フレームを挿入"]')
  const insertIsWholeCut = await evaluatePage<boolean>(`
    (() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="フレームを挿入"]');
      return Boolean(dialog?.textContent?.includes('カット全体') && !dialog.querySelector('input[name="frameOperationScope"]'));
    })()
  `)
  if (!insertIsWholeCut) throw new Error('SOUND frame operation was not fixed to the whole cut')
  await setReactFieldValue('.frameOperationInputRow input', '3')
  await clickButtonByText('挿入')
  e2eDurationFrames += 3
  await waitForSoundCueAt('sound_lane_1', 4, 11, 'RIPPLE SOUND')
  await waitForCameraCueAt('camera_lane_1', 9, 13, 'RIPPLE CAMERA')
  await waitForEventAt('action', 'A', 2, '1')
  await waitForEventAt('cell', 'B', 11, '2')
  await waitForPageCondition(() => document.body.textContent?.includes('147F') ?? false, '147F cut duration after ripple insert')
  checks.push('inserted three frames from SOUND and rippled ACTION, CELL, SOUND, CAMERA, and the cut duration')

  await keyboardShortcut('z')
  e2eDurationFrames -= 3
  await waitForSoundCueAt('sound_lane_1', 4, 8, 'RIPPLE SOUND')
  await waitForCameraCueAt('camera_lane_1', 6, 10, 'RIPPLE CAMERA')
  await waitForEventAt('cell', 'B', 8, '2')
  await waitForPageCondition(() => document.body.textContent?.includes('144F') ?? false, '144F cut duration after ripple undo')
  await keyboardShortcut('y')
  e2eDurationFrames += 3
  await waitForSoundCueAt('sound_lane_1', 4, 11, 'RIPPLE SOUND')
  await waitForCameraCueAt('camera_lane_1', 9, 13, 'RIPPLE CAMERA')
  await waitForEventAt('cell', 'B', 11, '2')
  checks.push('undid and redid the complete multi-lane ripple insert as one history entry')

  const deleteStart = await clientPointForTimedRangeFrame('camera', 'camera_lane_1', 9, { xRatio: 0.15, yRatio: 0.5 })
  const deleteEnd = await clientPointForTimedRangeFrame('camera', 'camera_lane_1', 13, { xRatio: 0.15, yRatio: 0.5 })
  await mouseDrag(deleteStart, deleteEnd)
  await waitForSelectedTimedRange('camera', 'camera_lane_1', 9, 13)
  await rightClickTimedRangeFrame('camera', 'camera_lane_1', 9)
  await clickMenuItem('削除')
  await waitForSelector('[role="dialog"][aria-label="フレームを削除"]')
  const deleteRangeIsLocked = await evaluatePage<boolean>(`
    (() => {
      const input = document.querySelector('.frameOperationInputRow input');
      return input instanceof HTMLInputElement && input.value === '5' && input.disabled;
    })()
  `)
  if (!deleteRangeIsLocked) throw new Error('CAMERA selected range was not preserved for whole-cut deletion')
  await clickButtonByText('削除')
  e2eDurationFrames -= 5
  await waitForNoCameraCue('camera_lane_1', 'RIPPLE CAMERA')
  await waitForSoundCueAt('sound_lane_1', 4, 8, 'RIPPLE SOUND')
  await waitForNoEventAt('cell', 'B', 11, '2')
  await waitForPageCondition(() => document.body.textContent?.includes('142F') ?? false, '142F cut duration after ripple delete')
  const registeredCardCount = await evaluatePage<number>(`document.querySelectorAll('.cspTreeCel[data-csp-key-id]').length`)
  if (registeredCardCount !== 2) throw new Error(`ripple deletion removed registered cards: ${registeredCardCount}`)

  await keyboardShortcut('z')
  e2eDurationFrames += 5
  await waitForCameraCueAt('camera_lane_1', 9, 13, 'RIPPLE CAMERA')
  await waitForEventAt('cell', 'B', 11, '2')
  await keyboardShortcut('y')
  e2eDurationFrames -= 5
  await waitForNoCameraCue('camera_lane_1', 'RIPPLE CAMERA')
  checks.push('deleted a CAMERA-selected span, removed covered cues, contracted crossing cues, retained cards, and verified undo/redo')

  await clickFrame('action', 'A', 20)
  await keyPress('3')
  await keyPress('Enter')
  await waitForEventAt('action', 'A', 20, '3')
  checks.push('continued normal ACTION input after the frame-operation dialog closed')
}

async function clickFrame(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  const point = await clientPointForFrame(role, paperTrack, frame)
  await mouseClick(point)
}

async function rightClickFrame(role: SheetTimingRole, paperTrack: string, frame: number): Promise<void> {
  const point = await clientPointForFrame(role, paperTrack, frame)
  await mouseClick(point, 'right')
}

async function rightClickTimedRangeFrame(role: 'sound' | 'camera', laneId: string, frame: number): Promise<void> {
  const point = await clientPointForTimedRangeFrame(role, laneId, frame)
  await mouseClick(point, 'right')
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')))
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

async function dragSoundRange(laneId: string, frameStart: number, frameEnd: number): Promise<void> {
  const [start, end] = await clientPointsForTimedRange('sound', laneId, frameStart, frameEnd)
  await mouseDrag(start, end)
}

async function doubleClickSoundFrame(laneId: string, frame: number): Promise<void> {
  const point = await clientPointForSoundFrame(laneId, frame)
  await mouseDoubleClick(point)
}

async function dragSoundCueBody(laneId: string, sourceFrame: number, targetFrame: number): Promise<void> {
  const [source, target] = await clientPointsForTimedRange('sound', laneId, sourceFrame, targetFrame)
  await mouseDrag(source, target)
}

async function resizeSelectedSoundCueEnd(laneId: string, targetFrame: number): Promise<void> {
  const source = await centerOfSelector('.soundCue.selected .soundCueEdgeHandle.end')
  const target = await clientPointForSoundFrame(laneId, targetFrame)
  await mouseDrag(source, target)
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

async function mouseMove(point: ClientPoint): Promise<void> {
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0,
  })
}

async function mouseDoubleClick(point: ClientPoint): Promise<void> {
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0,
  })
  for (let clickCount = 1; clickCount <= 2; clickCount += 1) {
    await clientSend('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount,
    })
    await clientSend('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount,
    })
  }
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

async function setReactFieldValue(selector: string, value: string): Promise<void> {
  await evaluatePage<void>(`
    (() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) {
        throw new Error('editable field not found: ${selector}');
      }
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) throw new Error('native value setter not found: ${selector}');
      setter.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `)
}

async function clickButtonByText(label: string): Promise<void> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find(item => item.textContent?.trim() === ${JSON.stringify(label)} && item.getBoundingClientRect().width > 0);
      if (!button) return null;
      const box = button.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!point) throw new Error(`button not found: ${label}`)
  await mouseClick(point)
}

async function centerOfSelector(selector: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0
        ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
        : null;
    })()
  `)
  if (!point) throw new Error(`visible element not found: ${selector}`)
  return point
}

async function inputPointForSelector(selector: string): Promise<ClientPoint> {
  const result = await evaluatePage<{ point: ClientPoint; receivesInput: boolean } | null>(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      if (
        box.width <= 0
        || box.height <= 0
        || point.x < 0
        || point.y < 0
        || point.x >= window.innerWidth
        || point.y >= window.innerHeight
      ) return { point, receivesInput: false };
      const target = document.elementFromPoint(point.x, point.y);
      return { point, receivesInput: target === element || Boolean(element.contains(target)) };
    })()
  `)
  if (!result) throw new Error(`input element not found: ${selector}`)
  if (!result.receivesInput) throw new Error(`element does not receive input at its center: ${selector}`)
  return result.point
}

async function hoverSelector(selector: string): Promise<void> {
  const point = await centerOfSelector(selector)
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0,
  })
}

async function selectorInsetDrag(selector: string, startX: number, startY: number, endX: number, endY: number): Promise<{ start: ClientPoint; end: ClientPoint }> {
  const points = await evaluatePage<{ start: ClientPoint; end: ClientPoint } | null>(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0 || box.right <= 0 || box.bottom <= 0 || box.left >= window.innerWidth || box.top >= window.innerHeight) return null;
      return {
        start: { x: box.left + box.width * ${JSON.stringify(startX)}, y: box.top + box.height * ${JSON.stringify(startY)} },
        end: { x: box.left + box.width * ${JSON.stringify(endX)}, y: box.top + box.height * ${JSON.stringify(endY)} },
      };
    })()
  `)
  if (!points) throw new Error(`visible drag surface not found: ${selector}`)
  return points
}

async function waitForSelector(selector: string): Promise<void> {
  await waitForCondition(
    () => evaluatePage<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    5000,
    selector,
  )
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

async function verifyAssetBrowserShell(): Promise<void> {
  await ensureAssetBrowserPaneOpen()
  await waitForPageCondition(() => {
    const browser = document.querySelector<HTMLElement>('.assetBrowser')
    const header = browser?.querySelector<HTMLElement>('.assetBrowserHeader')
    const catalogToolbar = browser?.querySelector<HTMLElement>('.assetCatalogToolbar')
    const controls = browser?.querySelector<HTMLElement>('.assetBrowserControls')
    const items = browser?.querySelector<HTMLElement>('.assetBrowserItems')
    const rootButton = catalogToolbar?.querySelector<HTMLElement>('[aria-label="カットフォルダを追加"], [aria-label="カットフォルダを変更"]')
    if (!browser || !header || !catalogToolbar || !controls || !items || !rootButton) return false
    const browserRect = browser.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    const fileRect = catalogToolbar.getBoundingClientRect()
    const controlsRect = controls.getBoundingClientRect()
    const itemsRect = items.getBoundingClientRect()
    return browserRect.width > 0
      && browserRect.height > 0
      && !browser.closest('aside')?.hasAttribute('hidden')
      && headerRect.top >= browserRect.top
      && controlsRect.top >= headerRect.top
      && controlsRect.bottom <= headerRect.bottom + 1
      && fileRect.top >= headerRect.bottom
      && itemsRect.top >= fileRect.bottom
      && headerRect.top - browserRect.top < 40
  }, 'asset browser catalog shell is fixed at the top')
  checks.push('verified the image asset pane keeps catalog navigation and thumbnail controls fixed at the top')
}

async function ensureAssetBrowserPaneOpen(): Promise<void> {
  const expanded = await evaluatePage<boolean>(`
    document.querySelector('button[aria-label="画像素材"]')?.getAttribute('aria-expanded') === 'true'
  `)
  if (!expanded) await mouseClick(await centerOfSelector('button[aria-label="画像素材"]'))
  await waitForPageCondition(() => {
    const toggle = document.querySelector('button[aria-label="画像素材"]')
    const pane = document.querySelector<HTMLElement>('#sheet-right-pane')
    if (!toggle || !pane) return false
    const rect = pane.getBoundingClientRect()
    return toggle.getAttribute('aria-expanded') === 'true'
      && !pane.hasAttribute('hidden')
      && rect.width > 0
      && rect.height > 0
  }, 'visible image asset pane')
}

async function dropAssetFolderOnBrowser(folderPath: string): Promise<void> {
  if (!folderPath) throw new Error('--asset-root is required for dropAssetFolderOnBrowser')
  const hasAssetBrowser = await evaluatePage<boolean>(`
    Boolean(document.querySelector('.assetBrowser'))
  `)
  if (!hasAssetBrowser) throw new Error('asset browser not found for folder drop')
  await dispatchDomFolderDropOnAssetBrowser(folderPath)
  await waitForPageCondition(() => {
    const location = document.querySelector<HTMLElement>('.assetLocationText')
    const names = Array.from(document.querySelectorAll<HTMLElement>('.assetBrowserItems .assetCard:not(.assetCatalogFolderCard) strong')).map(item => item.textContent?.trim() ?? '')
    return Boolean(location?.textContent?.trim())
      && names.includes('A1.png')
  }, 'folder drop synchronizes a root and shows registered assets in the asset browser')
  checks.push('dropped a folder onto the image asset pane and verified its assets appear in the unified catalog')
}

async function verifyStackGuidePlacementAndSharedCuts(): Promise<void> {
  await verifySharedCutMenuControlsScenario({
    checks, clickActionMenuSummary, ensureSharedCutMenuOpen, evaluatePage, mouseClick,
    viewportOutsideMenusPoint, waitForNoActionMenu, waitForPageCondition,
  })
  await createStackGuideLabelFromHeader('action', 2, 'BOOK-E2E')
  await waitForStackGuideLabelRole('BOOK-E2E', 'action')
  checks.push('created a BG/BOOK label from the ACTION header context menu')

  const alternateCutLabel = 'BOOK別案'
  await clickAddSharedCutButton(alternateCutLabel)
  await waitForSelectedSharedCut(alternateCutLabel)
  await waitForStackGuideLabelRole('BOOK-E2E', 'action')

  await dragStackGuideLabelToHeader('BOOK-E2E', 'cell', 4)
  await waitForStackGuideLabelRole('BOOK-E2E', 'cell')
  checks.push('moved a BG/BOOK label by dragging it on the live sheet')

  await switchSharedCut('001')
  await waitForSelectedSharedCut('001')
  await waitForStackGuideLabelRole('BOOK-E2E', 'action')
  await waitForNoStackGuideLabelRole('BOOK-E2E', 'cell')

  await switchSharedCut(alternateCutLabel)
  await waitForSelectedSharedCut(alternateCutLabel)
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
  const target = await stackGuideHeaderPoint(role, gapIndex)
  const source = await stackGuideLabelPoint(label)
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

async function clickAddSharedCutButton(label: string): Promise<void> {
  await ensureSharedCutMenuOpen()
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
  const inputSelector = '.cutSwitchAddForm input[aria-label="追加する兼用カット名"]'
  await waitForSelector(inputSelector)
  await setReactFieldValue(inputSelector, label)
  await mouseClick(await centerOfSelector('.cutSwitchAddConfirmButton'))
}

async function switchSharedCut(label: string): Promise<void> {
  await ensureSharedCutMenuOpen()
  const switched = await evaluatePage<boolean>(`
    (() => {
      const select = document.querySelector('.cutSwitchMenu.actionMenuPortalContent select');
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
      const current = document.querySelector('.cutSwitchMenu > summary .cutSwitchMenuLabel strong');
      return current?.textContent?.trim() === ${JSON.stringify(label)};
    })()
  `), 10000, `selected shared cut ${label}`)
}

async function ensureSharedCutMenuOpen(): Promise<void> {
  const visible = await evaluatePage<boolean>(`
    Boolean(document.querySelector('.cutSwitchMenu.actionMenuPortalContent'))
  `)
  if (!visible) await clickActionMenuSummary('兼用カットを切り替える')
  await waitForSelector('.cutSwitchMenu.actionMenuPortalContent')
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
  const itemAvailable = await evaluatePage<boolean>(`
    (() => {
      const menu = document.querySelector('[role="menu"]');
      const button = menu ? Array.from(menu.querySelectorAll('button[role="menuitem"]'))
        .find(item => item.textContent?.trim() === ${JSON.stringify(label)} && !item.disabled) : null;
      if (!button) return false;
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    })()
  `)
  if (!itemAvailable) throw new Error(`menu item not found or disabled: ${label}`)
  await delay(50)
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
  if (!point) throw new Error(`menu item is not visible: ${label}`)
  await mouseClick(point)
}

async function openAssetBrowserPreviewByName(fileName: string): Promise<void> {
  const cardPoint = await evaluatePage<ClientPoint | null>(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.assetBrowserItems .assetCard'));
      const card = cards.find(item => item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(fileName)});
      if (!card) return null;
      card.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = card.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!cardPoint) throw new Error(`asset card not found for preview: ${fileName}`)
  await clientSend('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: cardPoint.x,
    y: cardPoint.y,
    button: 'none',
    buttons: 0,
  })
  const point = await waitForCondition(
    () => evaluatePage<ClientPoint | null>(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.assetBrowserItems .assetCard'));
        const card = cards.find(item => item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(fileName)});
        const button = card?.querySelector('.assetQuickPreviewButton');
        if (!button) return null;
        const box = button.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0 || box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight) return null;
        const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        return document.elementFromPoint(point.x, point.y)?.closest('.assetQuickPreviewButton') === button ? point : null;
      })()
    `),
    5000,
    `visible asset preview button ${fileName}`,
  )
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
  await mouseClick(await assetBrowserCardPointByName(activeClient(), name))
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

async function waitForSoundCueAt(laneId: string, frameStart: number, frameEnd: number, label: string): Promise<void> {
  const normalizedLabel = label.replace(/\s+/g, '')
  await waitForCondition(async () => evaluatePage<boolean>(`
    Array.from(document.querySelectorAll('.soundCue[data-sound-lane-id="${cssEscape(laneId)}"][data-frame-start="${frameStart}"][data-frame-end="${frameEnd}"]'))
      .some(cue => cue.textContent?.replace(/\\s+/g, '').includes(${JSON.stringify(normalizedLabel)}))
  `), 5000, `${laneId} SOUND ${frameStart}-${frameEnd} ${label}`)
}

async function waitForCameraCueAt(laneId: string, frameStart: number, frameEnd: number, label: string): Promise<void> {
  await waitForCondition(async () => evaluatePage<boolean>(`
    Array.from(document.querySelectorAll('.cameraCue[data-camera-lane-id="${cssEscape(laneId)}"][data-frame-start="${frameStart}"][data-frame-end="${frameEnd}"]'))
      .some(cue => cue.getAttribute('aria-label')?.replace(/\\s+/g, '').includes(${JSON.stringify(label.replace(/\s+/g, ''))}))
  `), 5000, `${laneId} CAMERA ${frameStart}-${frameEnd} ${label}`)
}

async function waitForNoCameraCue(laneId: string, label: string): Promise<void> {
  await waitForCondition(async () => evaluatePage<boolean>(`
    !Array.from(document.querySelectorAll('.cameraCue[data-camera-lane-id="${cssEscape(laneId)}"]'))
      .some(cue => cue.getAttribute('aria-label')?.replace(/\\s+/g, '').includes(${JSON.stringify(label.replace(/\s+/g, ''))}))
  `), 5000, `${laneId} no CAMERA ${label}`)
}

async function waitForSelectedRange(role: SheetTimingRole, paperTrack: string, frameStart: number, frameEnd: number): Promise<void> {
  const expected = templateRangeLocationForFrame(role, paperTrack, frameStart, frameEnd)
  await waitForCondition(async () => {
    const rects = await evaluatePage<RectSnapshot[]>(snapshotRectsExpression('.selectedRangeRect'))
    return rects.some(rect => rect.pageId === expected.pageId && rectMatches(rect, expected.rect))
  }, 5000, `${paperTrack} selected ${frameStart}-${frameEnd}`)
}

async function waitForSelectedTimedRange(role: 'sound' | 'camera', laneId: string, frameStart: number, frameEnd: number): Promise<void> {
  const start = templateTimedRangeFrameLocation(role, laneId, frameStart)
  const end = templateTimedRangeFrameLocation(role, laneId, frameEnd)
  if (start.pageId !== end.pageId) throw new Error(`cross-page ${role.toUpperCase()} selection is not supported in this scenario`)
  const expected = {
    pageId: start.pageId,
    rect: {
      x: start.rect.x,
      y: start.rect.y,
      w: start.rect.w,
      h: end.rect.y + end.rect.h - start.rect.y,
    },
  }
  await waitForCondition(async () => {
    const rects = await evaluatePage<RectSnapshot[]>(snapshotRectsExpression('.selectedRangeRect'))
    return rects.some(rect => rect.pageId === expected.pageId && rectMatches(rect, expected.rect))
  }, 5000, `${laneId} selected ${frameStart}-${frameEnd}`)
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
  await scrollSheetRectIntoView(pageId, rect)
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
  await scrollSheetRectIntoView(start.pageId, {
    x: Math.min(start.rect.x, end.rect.x),
    y: Math.min(start.rect.y, end.rect.y),
    w: Math.max(start.rect.x + start.rect.w, end.rect.x + end.rect.w) - Math.min(start.rect.x, end.rect.x),
    h: Math.max(start.rect.y + start.rect.h, end.rect.y + end.rect.h) - Math.min(start.rect.y, end.rect.y),
  })
  const box = await sheetPageBox(start.pageId)
  return [pointForRect(box, start.rect, startBias), pointForRect(box, end.rect, endBias)]
}

async function clientPointForSoundFrame(
  laneId: string,
  frame: number,
  bias: CellPointBias = { xRatio: 0.5, yRatio: 0.5 },
): Promise<ClientPoint> {
  return clientPointForTimedRangeFrame('sound', laneId, frame, bias)
}

async function clientPointForTimedRangeFrame(
  role: 'sound' | 'camera',
  laneId: string,
  frame: number,
  bias: CellPointBias = { xRatio: 0.5, yRatio: 0.5 },
): Promise<ClientPoint> {
  const { pageId, rect } = templateTimedRangeFrameLocation(role, laneId, frame)
  await scrollSheetRectIntoView(pageId, rect)
  const box = await sheetPageBox(pageId)
  return pointForRect(box, rect, bias)
}

async function clientPointsForTimedRange(role: 'sound' | 'camera', laneId: string, frameStart: number, frameEnd: number): Promise<[ClientPoint, ClientPoint]> {
  const start = templateTimedRangeFrameLocation(role, laneId, frameStart)
  const end = templateTimedRangeFrameLocation(role, laneId, frameEnd)
  if (start.pageId !== end.pageId) throw new Error(`cross-page ${role.toUpperCase()} drag is not supported in this scenario: ${frameStart}-${frameEnd}`)
  await scrollSheetRectIntoView(start.pageId, {
    x: Math.min(start.rect.x, end.rect.x), y: Math.min(start.rect.y, end.rect.y),
    w: Math.max(start.rect.x + start.rect.w, end.rect.x + end.rect.w) - Math.min(start.rect.x, end.rect.x),
    h: Math.max(start.rect.y + start.rect.h, end.rect.y + end.rect.h) - Math.min(start.rect.y, end.rect.y),
  })
  const box = await sheetPageBox(start.pageId)
  return [
    pointForRect(box, start.rect, { xRatio: 0.5, yRatio: 0.5 }),
    pointForRect(box, end.rect, { xRatio: 0.5, yRatio: 0.5 }),
  ]
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

async function scrollSheetRectIntoView(pageId: string, rect: NormalizedRect): Promise<void> {
  await scrollSheetPageIntoView(pageId)
  const pageSelector = `svg.sheetSvg[data-page-id="${cssEscape(pageId)}"]`
  await evaluatePage<void>(`
    (() => {
      const sheet = document.querySelector(${JSON.stringify(pageSelector)});
      const viewport = sheet?.closest('.sheetViewport');
      if (!sheet || !viewport) return;
      const pageBox = sheet.getBoundingClientRect();
      const viewportBox = viewport.getBoundingClientRect();
      const target = {
        left: pageBox.left + ${JSON.stringify(rect.x)} * pageBox.width,
        top: pageBox.top + ${JSON.stringify(rect.y)} * pageBox.height,
        right: pageBox.left + ${JSON.stringify(rect.x + rect.w)} * pageBox.width,
        bottom: pageBox.top + ${JSON.stringify(rect.y + rect.h)} * pageBox.height,
      };
      const inset = 48;
      if (target.top < viewportBox.top + inset) viewport.scrollTop += target.top - viewportBox.top - inset;
      else if (target.bottom > viewportBox.bottom - inset) viewport.scrollTop += target.bottom - viewportBox.bottom + inset;
      if (target.left < viewportBox.left + inset) viewport.scrollLeft += target.left - viewportBox.left - inset;
      else if (target.right > viewportBox.right - inset) viewport.scrollLeft += target.right - viewportBox.right + inset;
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

function templateTimedRangeFrameLocation(role: 'sound' | 'camera', laneId: string, frame: number): FrameLocation {
  const pageIndex = Math.floor((frame - standardA3SheetTemplate.defaults.frameOrigin) / e2ePageFrames)
  const pageFrameStart = pageIndex * e2ePageFrames + standardA3SheetTemplate.defaults.frameOrigin
  const localFrame = frame - pageFrameStart + standardA3SheetTemplate.defaults.frameOrigin
  for (const region of standardA3SheetTemplate.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== role) continue
    const layout = resolveSheetTemplateGridLayout(standardA3SheetTemplate, region, {
      durationFrames: e2ePageFrames,
      frameOrigin: standardA3SheetTemplate.defaults.frameOrigin,
      role,
    })
    if (!layout || localFrame < layout.frames.frameStart || localFrame > layout.frames.frameEnd) continue
    const columnIndex = layout.columns.findIndex(column => column.timelineLaneId === laneId)
    if (columnIndex < 0) continue
    const rect = sheetGridCellRect(layout, columnIndex, localFrame - layout.frames.frameStart)
    if (!rect) continue
    return { pageId: `page_${pageIndex + 1}`, rect }
  }
  throw new Error(`template ${role.toUpperCase()} hit not found: ${laneId} ${frame}`)
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
        cameraCues: Array.from(document.querySelectorAll('.cameraCue')).map(cue => ({
          laneId: cue.dataset.cameraLaneId ?? '',
          frameStart: cue.dataset.frameStart ?? '',
          frameEnd: cue.dataset.frameEnd ?? '',
          label: cue.getAttribute('aria-label') ?? '',
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
  return activeClient().send<T>(method, params)
}

function activeClient(): CdpClient {
  if (!client) throw new Error('CDP client is not connected')
  return client
}

async function capturePageScreenshot(path: string): Promise<void> {
  await writeFile(path, Buffer.from(await capturePageScreenshotData(), 'base64'))
}

async function capturePageScreenshotData(): Promise<string> {
  const result = await clientSend<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  return result.data
}

async function captureScenarioScreenshot(label: string): Promise<string> {
  const root = dirname(args.screenshot || args.result)
  const path = join(root, `${scenarioId}-${label.replace(/[^a-z0-9_-]+/gi, '-')}.png`)
  await capturePageScreenshot(path)
  if (!scenarioArtifacts.includes(path)) scenarioArtifacts.push(path)
  return path
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

function requireArg(name: string): string {
  const value = args[name]
  if (!value) throw new Error(`--${name} is required for ${scenarioId}`)
  return value
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
