interface ClientPoint {
  x: number
  y: number
}

export interface AnnotationInteractionDriver {
  checks: string[]
  clickFrame: (role: 'action' | 'cell', paperTrack: string, frame: number) => Promise<void>
  keyPress: (key: string) => Promise<void>
  waitForEventAt: (role: 'action' | 'cell', paperTrack: string, frame: number, label: string) => Promise<void>
  dragSoundRange: (laneId: string, frameStart: number, frameEnd: number) => Promise<void>
  waitForSelector: (selector: string) => Promise<void>
  setReactFieldValue: (selector: string, value: string) => Promise<void>
  clickButtonByText: (label: string) => Promise<void>
  waitForSoundCueAt: (laneId: string, frameStart: number, frameEnd: number, label: string) => Promise<void>
  clientPointsForTimedRange: (role: 'sound' | 'camera', laneId: string, frameStart: number, frameEnd: number) => Promise<[ClientPoint, ClientPoint]>
  mouseDrag: (start: ClientPoint, end: ClientPoint) => Promise<void>
  waitForCameraCueAt: (laneId: string, frameStart: number, frameEnd: number, label: string) => Promise<void>
  rightClickFrame: (role: 'action' | 'cell', paperTrack: string, frame: number) => Promise<void>
  rightClickTimedRangeFrame: (role: 'sound' | 'camera', laneId: string, frame: number) => Promise<void>
  evaluatePage: <T>(expression: string) => Promise<T>
  waitForPageCondition: (condition: () => boolean, label?: string) => Promise<void>
  clickMenuItem: (label: string) => Promise<void>
  selectorInsetDrag: (selector: string, startX: number, startY: number, endX: number, endY: number) => Promise<{ start: ClientPoint; end: ClientPoint }>
  hoverSelector: (selector: string) => Promise<void>
  centerOfSelector: (selector: string) => Promise<ClientPoint>
  inputPointForSelector: (selector: string) => Promise<ClientPoint>
  waitForCondition: <T>(condition: () => T | null | false | undefined | Promise<T | null | false | undefined>, timeoutMs: number, label: string) => Promise<T>
  mouseClick: (point: ClientPoint, button?: 'left' | 'right') => Promise<void>
  mouseDoubleClick: (point: ClientPoint) => Promise<void>
  clientSend: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

export async function verifyAnnotationInteractionScenario(driver: AnnotationInteractionDriver): Promise<void> {
  const {
    checks, clickFrame, keyPress, waitForEventAt, dragSoundRange, waitForSelector,
    setReactFieldValue, clickButtonByText, waitForSoundCueAt, clientPointsForTimedRange,
    mouseDrag, waitForCameraCueAt, rightClickFrame, rightClickTimedRangeFrame,
    evaluatePage, waitForPageCondition, clickMenuItem, selectorInsetDrag, hoverSelector,
    centerOfSelector, inputPointForSelector, waitForCondition, mouseClick, mouseDoubleClick,
    clientSend,
  } = driver

  await clickFrame('action', 'A', 4)
  await keyPress('7')
  await keyPress('Enter')
  await waitForEventAt('action', 'A', 4, '7')
  checks.push('entered and committed a numeric ACTION timing value')

  await dragSoundRange('sound_lane_1', 10, 15)
  await keyPress('Enter')
  await waitForSelector('[role="dialog"][aria-label="SOUND区間を追加"]')
  await setReactFieldValue('[aria-label="SOUNDラベル"]', 'E2E話者')
  await setReactFieldValue('[aria-label="SOUND内容"]', 'E2Eセリフ')
  await clickButtonByText('追加')
  await waitForSoundCueAt('sound_lane_1', 10, 15, 'E2E話者')
  checks.push('created a labeled SOUND dialogue interval with text')

  const [cameraStart, cameraEnd] = await clientPointsForTimedRange('camera', 'camera_lane_1', 20, 28)
  await mouseDrag(cameraStart, cameraEnd)
  await keyPress('Enter')
  await waitForSelector('[role="dialog"][aria-label="撮影指示"]')
  await setReactFieldValue('[aria-label="CAMERA指示"]', 'PAN')
  await clickButtonByText('追加')
  await waitForCameraCueAt('camera_lane_1', 20, 28, 'PAN')
  checks.push('created a CAMERA instruction interval')

  await createAnchoredMemoWithInkAndText('action', 4, 'ACTIONコメント', () => rightClickFrame('action', 'A', 4))
  await createAnchoredMemoWithInkAndText('sound', 10, 'セリフコメント', () => rightClickTimedRangeFrame('sound', 'sound_lane_1', 10))
  await createAnchoredMemoWithInkAndText('camera', 20, '撮影コメント', () => rightClickTimedRangeFrame('camera', 'camera_lane_1', 20))
  checks.push('created text and handwritten anchored comments for ACTION, SOUND, and CAMERA content')

  await selectAnnotationPaletteTool('sheet', 'テキスト')
  await waitForPageCondition(() => Boolean(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="text"]')), 'page text input surface')
  await assertNoTransientTooltip('page text placement')
  const memoPoint = await centerOfSelector('button[aria-label="MEMOを編集"]')
  const memoOwner = await topElementSummary(memoPoint)
  if (!memoOwner.includes('pageAnnotationInputSurface')) throw new Error(`page text input does not own the MEMO region: ${memoOwner}`)
  await mouseClick(memoPoint)
  await waitForSelector('.annotationTextEditor')
  await setReactFieldValue('.annotationTextEditor', 'ページコメント')
  await mouseClick(await centerOfSelector('button[aria-label="テキストを確定"]'))
  await waitForPageCondition(() => document.querySelector('.annotationTextDisplay')?.textContent === 'ページコメント', 'page text committed over MEMO')
  await keyPress('Escape')
  await waitForPageCondition(() => document.querySelector('.sheetPageSurface')?.getAttribute('data-sheet-interaction-owner') === 'sheet', 'ordinary sheet input restored')

  const pageTextBefore = await pageTextGeometry('ページコメント')
  const pageTextOwner = await topElementSummary({ x: pageTextBefore.centerX, y: pageTextBefore.centerY })
  if (!pageTextOwner.includes('annotationTextDisplay')) throw new Error(`page text cannot be selected over MEMO: ${pageTextOwner}`)
  await mouseDrag(
    { x: pageTextBefore.centerX, y: pageTextBefore.centerY },
    { x: pageTextBefore.centerX + 52, y: pageTextBefore.centerY + 18 },
  )
  const pageTextMoved = await pageTextGeometry('ページコメント')
  if (pageTextMoved.left < pageTextBefore.left + 35 || !pageTextMoved.selected) throw new Error('page text did not remain selectable and movable over the MEMO form region')

  await selectAnnotationPaletteTool('sheet', 'ペン')
  await waitForPageCondition(() => Boolean(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="pen"]')), 'page pen input surface')
  await assertNoTransientTooltip('page pen drawing')
  const strokeCountBeforeText = await evaluatePage<number>(`document.querySelectorAll('.annotationStroke:not(.annotationEraserPreview)').length`)
  const textBeforePen = await pageTextGeometry('ページコメント')
  await mouseDrag(
    { x: textBeforePen.centerX, y: textBeforePen.centerY },
    { x: textBeforePen.centerX + 58, y: textBeforePen.centerY + 8 },
  )
  await waitForCondition(
    async () => (await evaluatePage<number>(`document.querySelectorAll('.annotationStroke:not(.annotationEraserPreview)').length`)) > strokeCountBeforeText,
    5000,
    'page stroke starting on page text',
  )
  const textAfterPen = await pageTextGeometry('ページコメント')
  if (Math.abs(textAfterPen.left - textBeforePen.left) > 1 || Math.abs(textAfterPen.top - textBeforePen.top) > 1) throw new Error('page pen moved the underlying page text instead of drawing')

  const titlePoint = await centerOfSelector('button[aria-label="タイトルを編集"]')
  const strokeCountBeforeTitle = await evaluatePage<number>(`document.querySelectorAll('.annotationStroke:not(.annotationEraserPreview)').length`)
  await mouseDrag(titlePoint, { x: titlePoint.x + 64, y: titlePoint.y + 6 })
  await waitForCondition(
    async () => (await evaluatePage<number>(`document.querySelectorAll('.annotationStroke:not(.annotationEraserPreview)').length`)) > strokeCountBeforeTitle,
    5000,
    'page stroke starting on TITLE form',
  )
  await assertNoTransientTooltip('page pen over metadata forms')
  checks.push('placed, reselected, and moved page text over MEMO, then drew from page text and metadata without input interception')

  await keyPress('Escape')
  await waitForPageCondition(() => !document.querySelector('.pageAnnotationInputSurface'), 'annotation capture released')
  await mouseDoubleClick(titlePoint)
  await waitForSelector('[role="dialog"][aria-label="タイトルを編集"]')
  checks.push('released annotation ownership and restored ordinary metadata editing')

  async function createAnchoredMemoWithInkAndText(
    anchorRole: 'action' | 'sound' | 'camera',
    anchorFrame: number,
    text: string,
    openContextMenu: () => Promise<void>,
  ): Promise<void> {
    const priorMemoIds = await evaluatePage<string[]>(`Array.from(document.querySelectorAll('.timelineMemoAnchorCue')).flatMap(element => (element.getAttribute('data-timeline-memo-ids') ?? '').split(/\\s+/).filter(Boolean))`)
    await openContextMenu()
    await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')), `${anchorRole} memo context menu`)
    await clickMenuItem('メモを追加')
    await waitForCondition(async () => evaluatePage<boolean>(`
      (() => {
        const anchor = document.querySelector('.timelineMemoAnchorCue.selected');
        if (!anchor) return false;
        const ids = (anchor.getAttribute('data-timeline-memo-ids') ?? '').split(/\\s+/).filter(Boolean);
        return anchor.getAttribute('data-timeline-memo-anchor-role') === ${JSON.stringify(anchorRole)}
          && anchor.getAttribute('data-timeline-memo-anchor-frame') === ${JSON.stringify(String(anchorFrame))}
          && ids.some(id => !${JSON.stringify(priorMemoIds)}.includes(id));
      })()
    `), 5000, `${anchorRole} anchored memo selected`)
    const draw = await selectorInsetDrag('.timelineMemoSegment.selected .timelineMemoDrawSurface', 0.2, 0.25, 0.78, 0.72)
    await mouseDrag(draw.start, draw.end)
    await waitForPageCondition(() => Boolean(document.querySelector('.timelineMemoSegment.selected .timelineMemoStroke:not(.draft)')), `${anchorRole} memo ink`)
    await selectAnnotationPaletteTool('timeline-memo', 'テキスト')
    await waitForSelector('.timelineMemoSegment.selected .timelineMemoTextSurface')
    await mouseClick(await inputPointForSelector('.timelineMemoSegment.selected .timelineMemoTextSurface'))
    await waitForSelector('.timelineMemoTextEditor')
    await setReactFieldValue('.timelineMemoTextEditor', text)
    await controlEnter()
    await waitForCondition(
      async () => evaluatePage<boolean>(`Array.from(document.querySelectorAll('.timelineMemoSegment.selected .timelineMemoText')).some(element => element.textContent === ${JSON.stringify(text)})`),
      5000,
      `${anchorRole} memo text`,
    )
    await keyPress('Escape')
    await waitForPageCondition(() => !document.querySelector('.timelineMemoSegment.selected'), `${anchorRole} memo edit closed`)
  }

  async function selectAnnotationPaletteTool(target: 'sheet' | 'timeline-memo', ariaLabel: string): Promise<void> {
    const palette = `.annotationFloatingPalette[data-annotation-target="${target}"]`
    await hoverSelector(palette)
    const selector = `${palette} button[aria-label="${ariaLabel}"]`
    await waitForSelector(selector)
    await mouseClick(await centerOfSelector(selector))
  }

  async function assertNoTransientTooltip(label: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 220))
    const tooltipCount = await evaluatePage<number>(`document.querySelectorAll('.appTooltip').length`)
    if (tooltipCount !== 0) throw new Error(`${label} left ${tooltipCount} transient tooltip(s) visible`)
  }

  async function topElementSummary(point: ClientPoint): Promise<string> {
    return evaluatePage<string>(`
      (() => {
        const element = document.elementFromPoint(${point.x}, ${point.y});
        if (!element) return 'none';
        return [element.tagName, element.id, element.className?.baseVal ?? element.className ?? '', element.getAttribute('aria-label') ?? ''].join('|');
      })()
    `)
  }

  async function pageTextGeometry(text: string): Promise<{ left: number; top: number; centerX: number; centerY: number; selected: boolean }> {
    return evaluatePage(`
      (() => {
        const element = Array.from(document.querySelectorAll('.annotationTextDisplay')).find(item => item.textContent === ${JSON.stringify(text)});
        if (!element) throw new Error('page text not found: ${text}');
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2, selected: element.classList.contains('selected') };
      })()
    `)
  }

  async function controlEnter(): Promise<void> {
    const event = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 2 }
    await clientSend('Input.dispatchKeyEvent', { ...event, type: 'keyDown' })
    await clientSend('Input.dispatchKeyEvent', { ...event, type: 'keyUp' })
  }
}
