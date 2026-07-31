import { assertSelectorsContributePaint } from '../visual-paint-contract'

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
  evaluatePage: <T>(expression: string) => Promise<T>
  waitForPageCondition: (condition: () => boolean, label?: string) => Promise<void>
  clickMenuItem: (label: string) => Promise<void>
  selectorInsetDrag: (selector: string, startX: number, startY: number, endX: number, endY: number) => Promise<{ start: ClientPoint; end: ClientPoint }>
  centerOfSelector: (selector: string) => Promise<ClientPoint>
  inputPointForSelector: (selector: string) => Promise<ClientPoint>
  waitForCondition: <T>(condition: () => T | null | false | undefined | Promise<T | null | false | undefined>, timeoutMs: number, label: string) => Promise<T>
  mouseClick: (point: ClientPoint, button?: 'left' | 'right') => Promise<void>
  mouseDoubleClick: (point: ClientPoint) => Promise<void>
  clientSend: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  captureScreenshot: () => Promise<string>
  captureScreenshotArtifact: (label: string) => Promise<string>
}

export async function verifyAnnotationInteractionScenario(driver: AnnotationInteractionDriver): Promise<void> {
  const {
    checks, clickFrame, keyPress, waitForEventAt, dragSoundRange, waitForSelector,
    setReactFieldValue, clickButtonByText, waitForSoundCueAt, clientPointsForTimedRange,
    mouseDrag, waitForCameraCueAt, rightClickFrame,
    evaluatePage, waitForPageCondition, clickMenuItem, selectorInsetDrag,
    centerOfSelector, inputPointForSelector, waitForCondition, mouseClick, mouseDoubleClick,
    clientSend, captureScreenshot, captureScreenshotArtifact,
  } = driver

  await clickFrame('action', 'A', 4)
  await keyPress('7')
  await keyPress('Enter')
  await waitForEventAt('action', 'A', 4, '7')
  checks.push('entered and committed a numeric ACTION timing value')

  await dragSoundRange('sound_lane_1', 10, 15)
  await keyPress('Enter')
  await waitForSelector('[role="dialog"][aria-label="SOUND指示"]')
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

  const processFieldSelector = '[data-annotation-target-id="cell:process_field_original"]'
  await evaluatePage(`document.querySelector(${JSON.stringify(processFieldSelector)})?.scrollIntoView({ block: 'center', inline: 'center' })`)
  await mouseClick(await inputPointForSelector(processFieldSelector))
  await waitForPageCondition(() => document.querySelector('.annotationTargetLabel')?.textContent?.includes('対象: 原図') === true, 'individual process-field annotation target')
  const processSelection = await evaluatePage<{ selectedCount: number; targetId: string | null }>(`(() => {
    const selected = Array.from(document.querySelectorAll('[data-annotation-target-selected="true"]'));
    return { selectedCount: selected.length, targetId: selected[0]?.getAttribute('data-annotation-target-id') ?? null };
  })()`)
  if (processSelection.selectedCount !== 1 || processSelection.targetId !== 'cell:process_field_original') {
    throw new Error(`process form selection leaked to sibling fields: ${JSON.stringify(processSelection)}`)
  }
  checks.push('selected one process-check form cell without highlighting sibling fields')

  await createAnchoredMemoWithInkAndText('action', 4, 'ACTIONコメント', () => rightClickFrame('action', 'A', 4))
  await createCueLinkedMemoWithInkAndText('sound', 10, 'セリフコメント', '.soundCueBody')
  await createCueLinkedMemoWithInkAndText('camera', 20, '撮影コメント', '.cameraCueShapeHit')
  const memoTextClipContract = await evaluatePage<{ directTextClips: number; clipPaths: number; viewports: number; textLayers: number; textStrokeWidths: number[] }>(`({
    directTextClips: document.querySelectorAll('.timelineMemoText[clip-path]').length,
    clipPaths: document.querySelectorAll('.timelineMemoLayer clipPath').length,
    viewports: document.querySelectorAll('.timelineMemoTextViewport').length,
    textLayers: document.querySelectorAll('.timelineMemoTextLayer[clip-path]').length,
    textStrokeWidths: Array.from(document.querySelectorAll('.timelineMemoText')).map(element => Number.parseFloat(getComputedStyle(element).strokeWidth)),
  })`)
  if (
    memoTextClipContract.directTextClips !== 0
    || memoTextClipContract.clipPaths < 3
    || memoTextClipContract.viewports !== 0
    || memoTextClipContract.textLayers < 3
    || memoTextClipContract.textStrokeWidths.some(width => !Number.isFinite(width) || Math.abs(width - 1.4) > 0.01)
  ) {
    throw new Error(`timeline memo text clipping or outline contract drifted: ${JSON.stringify(memoTextClipContract)}`)
  }
  checks.push('created direct text comments for SOUND and text plus handwritten comments for ACTION and CAMERA')

  await evaluatePage(`document.querySelector('button[aria-label="タイトルを編集"]')?.scrollIntoView({ block: 'center', inline: 'center' })`)
  await mouseClick(await inputPointForSelector('button[aria-label="タイトルを編集"]'))
  await waitForPageCondition(() => document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-target-kind') === 'template-region'
    && document.querySelector('.annotationTargetLabel')?.textContent?.includes('対象: タイトル') === true, 'TITLE annotation target')
  await evaluatePage(`document.querySelector('button[aria-label="MEMOを編集"]')?.scrollIntoView({ block: 'center', inline: 'center' })`)
  await mouseClick(await inputPointForSelector('button[aria-label="MEMOを編集"]'))
  await waitForPageCondition(() => document.querySelector('.annotationTargetLabel')?.textContent?.includes('対象: MEMO') === true, 'MEMO annotation target')
  const memoPoint = await centerOfSelector('button[aria-label="MEMOを編集"]')
  await selectAnnotationPaletteTool('sheet', 'ペン')
  await waitForPageCondition(() => Boolean(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="pen"]')), 'MEMO pen input surface')
  const blockedMemoHotspot = await evaluatePage<{ disabled: boolean; backgroundColor: string; selected: boolean }>(`(() => {
    const hotspot = document.querySelector('button[aria-label="MEMOを編集"]');
    if (!(hotspot instanceof HTMLButtonElement)) throw new Error('MEMO hotspot not found');
    return {
      disabled: hotspot.disabled,
      backgroundColor: getComputedStyle(hotspot).backgroundColor,
      selected: hotspot.getAttribute('data-annotation-target-selected') === 'true',
    };
  })()`)
  if (!blockedMemoHotspot.disabled || !blockedMemoHotspot.selected || !['transparent', 'rgba(0, 0, 0, 0)'].includes(blockedMemoHotspot.backgroundColor)) {
    throw new Error(`blocked MEMO hotspot obscures annotation ink: ${JSON.stringify(blockedMemoHotspot)}`)
  }
  const memoStrokeCountBefore = await evaluatePage<number>(`Number(document.querySelector('.committedAnnotationCanvas')?.getAttribute('data-annotation-stroke-count') ?? 0)`)
  await drawPageStrokeWithLivePreview(
    { x: memoPoint.x - 80, y: memoPoint.y - 20 },
    { x: memoPoint.x + 80, y: memoPoint.y + 20 },
    'memo-live-annotation-preview',
  )
  await waitForPageCondition(() => document.querySelector('.annotationTargetLabel')?.textContent?.includes('対象: MEMO') === true
    && document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-target-kind') === 'template-region', 'MEMO target remains locked after drawing')
  await waitForCondition(
    async () => (await evaluatePage<number>(`Number(document.querySelector('.committedAnnotationCanvas')?.getAttribute('data-annotation-stroke-count') ?? 0)`)) > memoStrokeCountBefore,
    5000,
    'MEMO-region stroke committed',
  )
  const committedMemoStrokePixels = await assertSelectorsContributePaint({
    evaluate: evaluatePage,
    captureScreenshot,
  }, {
    selector: '.committedAnnotationCanvas[data-annotation-region-ids~="top_memo_area"]',
    expectedCount: 1,
    label: 'committed MEMO annotation while the pen session remains active',
    minimumChangedPixels: 12,
  })
  await captureScreenshotArtifact('memo-committed-annotation-visible')
  checks.push(`kept the MEMO target locked and painted committed ink above blocked hotspots: ${committedMemoStrokePixels.join(', ')}`)
  await selectAnnotationPaletteTool('sheet', 'テキスト')
  await waitForPageCondition(() => Boolean(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="text"]')), 'page text input surface')
  await assertNoTransientTooltip('page text placement')
  const memoOwner = await topElementSummary(memoPoint)
  if (!memoOwner.includes('pageAnnotationInputSurface')) throw new Error(`page text input does not own the MEMO region: ${memoOwner}`)
  await mouseClick(memoPoint)
  await waitForSelector('.annotationTextEditor')
  await setReactFieldValue('.annotationTextEditor', 'ページコメント')
  await mouseClick(await centerOfSelector('button[aria-label="テキストを確定"]'))
  await waitForPageCondition(() => document.querySelector('.annotationTextDisplay')?.textContent === 'ページコメント', 'page text committed over MEMO')
  const memoRegionId = await evaluatePage<string | null>(`document.querySelector('.annotationTextDisplay')?.getAttribute('data-annotation-region-id') ?? null`)
  if (memoRegionId !== 'top_memo_area') throw new Error(`MEMO annotation lost its template-region target: ${memoRegionId}`)
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

  const pageTargetPoint = await evaluatePage<ClientPoint>(`(() => {
    const rect = document.querySelector('.sheetPageSurface').getBoundingClientRect();
    return {
      x: Math.min(rect.right - 10, window.innerWidth - 24),
      y: Math.min(rect.bottom - 10, window.innerHeight - 140),
    };
  })()`)
  await mouseClick(pageTargetPoint)
  await waitForPageCondition(() => document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-target-kind') === 'page', 'page annotation target restored')
  await selectAnnotationPaletteTool('sheet', 'ペン')
  await waitForPageCondition(() => Boolean(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="pen"]')), 'page pen input surface')
  await assertNoTransientTooltip('page pen drawing')
  await waitForPageCondition(() => {
    const palette = document.querySelector('.annotationFloatingPalette')
    return palette?.getAttribute('data-annotation-session') === 'active'
      && palette.getAttribute('data-annotation-tool') === 'pen'
      && palette.classList.contains('open')
  }, 'annotation session remains visibly open')
  const strokeCountBeforeText = await evaluatePage<number>(`Number(document.querySelector('.committedAnnotationCanvas')?.getAttribute('data-annotation-stroke-count') ?? 0)`)
  const textBeforePen = await pageTextGeometry('ページコメント')
  await drawPageStrokeWithLivePreview(
    { x: textBeforePen.centerX, y: textBeforePen.centerY },
    { x: textBeforePen.centerX + 58, y: textBeforePen.centerY + 8 },
    'page-live-annotation-preview',
  )
  await waitForCondition(
    async () => (await evaluatePage<number>(`Number(document.querySelector('.committedAnnotationCanvas')?.getAttribute('data-annotation-stroke-count') ?? 0)`)) > strokeCountBeforeText,
    5000,
    'page stroke starting on page text',
  )
  const textAfterPen = await pageTextGeometry('ページコメント')
  if (Math.abs(textAfterPen.left - textBeforePen.left) > 1 || Math.abs(textAfterPen.top - textBeforePen.top) > 1) throw new Error('page pen moved the underlying page text instead of drawing')

  await setReactFieldValue('.annotationActiveWidthControl input[aria-label="ペン幅"]', '8')
  await waitForPageCondition(() => document.querySelector('.annotationActiveWidthControl output')?.textContent === '8', 'pen width changes during annotation session')
  await selectAnnotationPaletteTool('sheet', '消しゴム')
  await waitForPageCondition(() => {
    const palette = document.querySelector('.annotationFloatingPalette')
    return palette?.getAttribute('data-annotation-tool') === 'eraser'
      && Boolean(document.querySelector('.annotationActiveWidthControl input[aria-label="消しゴム幅"]'))
      && Boolean(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="eraser"]'))
  }, 'eraser replaces pen without ending annotation session')
  await selectAnnotationPaletteTool('sheet', 'ペン')
  await waitForPageCondition(() => Boolean(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="pen"]')), 'pen restored without ending annotation session')

  const strokeCountBeforeMemoForm = await evaluatePage<number>(`Number(document.querySelector('.committedAnnotationCanvas')?.getAttribute('data-annotation-stroke-count') ?? 0)`)
  await mouseDrag(memoPoint, { x: memoPoint.x + 64, y: memoPoint.y + 6 })
  await waitForCondition(
    async () => (await evaluatePage<number>(`Number(document.querySelector('.committedAnnotationCanvas')?.getAttribute('data-annotation-stroke-count') ?? 0)`)) > strokeCountBeforeMemoForm,
    5000,
    'page stroke starting on MEMO form',
  )
  await assertNoTransientTooltip('page pen over metadata forms')
  checks.push('kept a visible annotation session open while previewing live ink and switching pen, width, and eraser')
  checks.push('selected TITLE and MEMO targets, stored MEMO text against its template region, then restored page-target drawing without input interception')

  await clickButtonByText('完了')
  await waitForPageCondition(() => !document.querySelector('.pageAnnotationInputSurface'), 'annotation capture released')
  await mouseDoubleClick(memoPoint)
  await waitForSelector('[role="dialog"][aria-label="MEMOを編集"]')
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
    await fillSelectedMemo(anchorRole, text)
  }

  async function createCueLinkedMemoWithInkAndText(
    anchorRole: 'sound' | 'camera',
    anchorFrame: number,
    text: string,
    hitSelector: string,
  ): Promise<void> {
    const cueId = await evaluatePage<string>(`
      (() => {
        const element = document.querySelector(${JSON.stringify(hitSelector)})?.closest('[data-${anchorRole}-cue-id]');
        const cueId = element?.getAttribute('data-${anchorRole}-cue-id');
        if (!cueId) throw new Error('${anchorRole} cue id not found');
        return cueId;
      })()
    `)
    await mouseClick(anchorRole === 'camera'
      ? await inputPointForSvgGeometry(hitSelector)
      : await inputPointForSelector(hitSelector))
    await waitForCondition(
      async () => evaluatePage<boolean>(`
        document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-target-kind') === 'timed-cue'
          && document.querySelector('.annotationTargetLabel')?.textContent?.includes(${JSON.stringify(anchorRole.toUpperCase())}) === true
      `),
      5000,
      `${anchorRole} cue annotation target`,
    )
    const startsWithText = anchorRole === 'sound'
    await selectAnnotationPaletteTool('sheet', startsWithText ? 'テキスト' : 'ペン')
    await waitForCondition(async () => evaluatePage<boolean>(`
      (() => {
        const anchor = document.querySelector('.timelineMemoAnchorCue.selected');
        if (!anchor) return false;
        return anchor.getAttribute('data-timeline-memo-anchor-role') === ${JSON.stringify(anchorRole)}
          && anchor.getAttribute('data-timeline-memo-anchor-frame') === ${JSON.stringify(String(anchorFrame))}
          && (anchor.getAttribute('data-timeline-memo-anchor-cue-ids') ?? '').split(/\\s+/).includes(${JSON.stringify(cueId)});
      })()
    `), 5000, `${anchorRole} cue-linked memo selected`)
    if (anchorRole === 'sound') {
      const placement = await evaluatePage<{ overlap: number; cueArea: number; memoArea: number }>(`(() => {
        const cue = document.querySelector(${JSON.stringify(hitSelector)})?.getBoundingClientRect();
        const memo = document.querySelector('.timelineMemoSegment.selected .timelineMemoBounds')?.getBoundingClientRect();
        if (!cue || !memo) throw new Error('SOUND cue or memo bounds missing');
        const width = Math.max(0, Math.min(cue.right, memo.right) - Math.max(cue.left, memo.left));
        const height = Math.max(0, Math.min(cue.bottom, memo.bottom) - Math.max(cue.top, memo.top));
        return { overlap: width * height, cueArea: cue.width * cue.height, memoArea: memo.width * memo.height };
      })()`)
      const ratio = placement.overlap / Math.max(1, Math.min(placement.cueArea, placement.memoArea))
      if (ratio > 0.02) throw new Error(`default SOUND text memo overlaps its source cue: ${JSON.stringify({ ...placement, ratio })}`)
      checks.push('placed a SOUND text memo beside its source interval without obscuring the dialogue')
    }
    await fillSelectedMemo(anchorRole, text, startsWithText)
  }

  async function inputPointForSvgGeometry(selector: string): Promise<ClientPoint> {
    const point = await evaluatePage<ClientPoint | null>(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof SVGGeometryElement)) return null;
        const matrix = element.getScreenCTM();
        const length = element.getTotalLength();
        if (!matrix || !(length > 0)) return null;
        for (const ratio of [0.15, 0.85, 0.25, 0.75, 0.5]) {
          const local = element.getPointAtLength(length * ratio);
          const client = new DOMPoint(local.x, local.y).matrixTransform(matrix);
          const target = document.elementFromPoint(client.x, client.y);
          if (target === element || element.contains(target)) return { x: client.x, y: client.y };
        }
        return null;
      })()
    `)
    if (!point) throw new Error(`SVG geometry does not expose an input point: ${selector}`)
    return point
  }

  async function fillSelectedMemo(
    anchorRole: 'action' | 'sound' | 'camera',
    text: string,
    startsWithText = false,
  ): Promise<void> {
    if (!startsWithText) {
      const draw = await selectorInsetDrag('.timelineMemoSegment.selected .timelineMemoDrawSurface', 0.2, 0.25, 0.78, 0.72)
      await mouseDrag(draw.start, draw.end)
      await waitForPageCondition(() => Boolean(document.querySelector('.timelineMemoSegment.selected .timelineMemoStroke:not(.draft)')), `${anchorRole} memo ink`)
      await selectAnnotationPaletteTool('timeline-memo', 'テキスト')
    }
    await waitForSelector('.timelineMemoSegment.selected .timelineMemoTextSurface')
    await waitForSelector('.timelineMemoTextEditor')
    await waitForPageCondition(() => document.activeElement?.classList.contains('timelineMemoTextEditor') === true, `${anchorRole} memo text editor focused without a placement click`)
    await waitForPageCondition(() => !document.querySelector('.sheetSvg.textAnnotationPlacementMode') && !document.querySelector('.textCursorBadge'), `${anchorRole} memo does not enter page text placement mode`)
    const editorFontSize = await evaluatePage<number>(`Number.parseFloat(getComputedStyle(document.querySelector('.timelineMemoTextEditor')).fontSize)`)
    await setReactFieldValue('.timelineMemoTextEditor', text)
    await controlEnter()
    await waitForPageCondition(() => !document.querySelector('.timelineMemoTextEditor'), `${anchorRole} memo text editor closed`)
    await waitForCondition(
      async () => evaluatePage<boolean>(`Array.from(document.querySelectorAll('.timelineMemoSegment.selected .timelineMemoText')).some(element => element.textContent === ${JSON.stringify(text)})`),
      5000,
      `${anchorRole} memo text`,
    )
    const committedFont = await evaluatePage<{ logical: number; screenScaleY: number }>(`(() => {
      const textNode = Array.from(document.querySelectorAll('.timelineMemoSegment.selected .timelineMemoText')).find(element => element.textContent === ${JSON.stringify(text)});
      if (!(textNode instanceof SVGTextElement)) throw new Error('committed memo text geometry missing');
      const screenMatrix = textNode.getScreenCTM();
      if (!screenMatrix) throw new Error('committed memo text screen transform missing');
      return {
        logical: Number(textNode.getAttribute('font-size')),
        screenScaleY: Math.hypot(screenMatrix.c, screenMatrix.d),
      };
    })()`)
    if (!(committedFont.screenScaleY > 0)) throw new Error('committed memo text screen scale is invalid')
    const committedDisplayFontSize = committedFont.logical * committedFont.screenScaleY
    if (Math.abs(editorFontSize - committedDisplayFontSize) > 0.75) {
      throw new Error(`timeline text changed size after commit: ${JSON.stringify({ editorFontSize, committedDisplayFontSize })}`)
    }
    if (anchorRole === 'sound') {
      const moveFrame = await evaluatePage<{ left: number; top: number; right: number; centerY: number; cursor: string; legacyHandles: number }>(`(() => {
        const frame = document.querySelector('.timelineMemoSegment.selected .timelineMemoMoveFrame');
        if (!(frame instanceof SVGRectElement)) throw new Error('memo border move surface missing');
        const rect = frame.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          centerY: rect.top + rect.height / 2,
          cursor: getComputedStyle(frame).cursor,
          legacyHandles: document.querySelectorAll('.timelineMemoMoveHandle, .sheetTransformHandleMoveVisual').length,
        };
      })()`)
      if (moveFrame.cursor !== 'grab' || moveFrame.legacyHandles !== 0) {
        throw new Error(`memo still exposes an obstructive move icon instead of its border: ${JSON.stringify(moveFrame)}`)
      }
      await mouseDrag(
        { x: moveFrame.right - 2, y: moveFrame.centerY },
        { x: moveFrame.right + 26, y: moveFrame.centerY + 16 },
      )
      await waitForCondition(async () => evaluatePage<boolean>(`(() => {
        const frame = document.querySelector('.timelineMemoSegment.selected .timelineMemoMoveFrame');
        if (!(frame instanceof SVGRectElement)) return false;
        const rect = frame.getBoundingClientRect();
        return rect.left > ${moveFrame.left + 12} && rect.top > ${moveFrame.top + 7};
      })()`), 5000, 'memo moved by dragging its border')
      checks.push('removed the obstructive move icon and moved the selected memo through its grab border')

      const originalLogicalFontSize = committedFont.logical
      await setReactFieldValue('input[aria-label="メモ全体の文字色"]', '#285c9e')
      await setReactFieldValue('.annotationFloatingPalette input[aria-label="文字"]', '24')
      await waitForCondition(async () => evaluatePage<boolean>(`(() => {
        const texts = Array.from(document.querySelectorAll('.timelineMemoSegment.selected .timelineMemoText'));
        return texts.length > 0
          && texts.every(text => text.getAttribute('fill') === '#285c9e')
          && texts.every(text => Number(text.getAttribute('font-size')) > ${originalLogicalFontSize});
      })()`), 5000, 'memo-wide text color and size update every text run')

      await mouseClick(await inputPointForSelector('.annotationFloatingPalette summary[aria-label="メモの見た目"]'))
      await setReactFieldValue('input[aria-label="手描きの不透明度"]', '55')
      await setReactFieldValue('input[aria-label="文字の不透明度"]', '65')
      await new Promise(resolve => setTimeout(resolve, 180))
      await mouseClick(await inputPointForSelector('input[aria-label="背景色を使用"]'))
      await waitForPageCondition(() => Boolean(document.querySelector('input[aria-label="背景の不透明度"]')), 'memo appearance menu stays open after enabling its background')
      await setReactFieldValue('input[aria-label="背景の不透明度"]', '30')
      await waitForPageCondition(() => {
        const segment = document.querySelector('.timelineMemoSegment.selected')
        return segment?.querySelector('.timelineMemoInkLayer')?.getAttribute('opacity') === '0.55'
          && segment?.querySelector('.timelineMemoTextLayer')?.getAttribute('opacity') === '0.65'
          && segment?.querySelector('[data-memo-background="solid"]')?.getAttribute('opacity') === '0.3'
      }, 'timeline memo appearance controls update the rendered memo')
      await captureScreenshotArtifact('sound-memo-appearance-controls')
      checks.push('kept text size stable through commit and applied memo-wide text styling plus independent opacity/background controls')
    }
    await keyPress('Escape')
    await waitForPageCondition(() => !document.querySelector('.timelineMemoSegment.selected'), `${anchorRole} memo edit closed`)
    await waitForPageCondition(() => document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-session') === 'idle', `${anchorRole} memo tool session closed`)
  }

  async function selectAnnotationPaletteTool(target: 'sheet' | 'timeline-memo', ariaLabel: string): Promise<void> {
    const palette = `.annotationFloatingPalette[data-annotation-target="${target}"]`
    const trigger = `${palette} .annotationPaletteTrigger`
    const selector = `${palette} button[aria-label="${ariaLabel}"]`
    let toolReceivesInput = false
    try {
      await inputPointForSelector(selector)
      toolReceivesInput = true
    } catch {
      // The compact palette may be closed even while its target is already active.
    }
    if (!toolReceivesInput) await mouseClick(await inputPointForSelector(trigger))
    await waitForSelector(selector)
    await waitForCondition(async () => {
      try {
        await inputPointForSelector(selector)
        return true
      } catch {
        return false
      }
    }, 2000, `${ariaLabel} annotation palette tool receives input`)
    // The compact palette expands with a short CSS transition. Resolve the
    // hit point only after its geometry settles so the real mouse click cannot
    // land on the adjacent tool while the column is still opening.
    await new Promise(resolve => setTimeout(resolve, 180))
    await mouseClick(await inputPointForSelector(selector))
    const expectedTool = ariaLabel.includes('消しゴム') ? 'eraser' : ariaLabel.includes('テキスト') ? 'text' : 'pen'
    await waitForCondition(
      async () => evaluatePage<boolean>(`
        document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-tool') === ${JSON.stringify(expectedTool)}
          && Boolean(document.querySelector('.annotationFloatingPalette button.activeToolButton[aria-pressed="true"]'))
      `),
      2000,
      `${ariaLabel} annotation palette tool selected as ${expectedTool}`,
    )
  }

  async function assertNoTransientTooltip(label: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 220))
    const tooltipCount = await evaluatePage<number>(`document.querySelectorAll('.appTooltip').length`)
    if (tooltipCount !== 0) throw new Error(`${label} left ${tooltipCount} transient tooltip(s) visible`)
  }

  async function drawPageStrokeWithLivePreview(start: ClientPoint, end: ClientPoint, artifactLabel: string): Promise<void> {
    await clientSend('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: start.x, y: start.y, button: 'none', buttons: 0,
    })
    await clientSend('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1,
    })
    for (let step = 1; step <= 4; step += 1) {
      const ratio = step / 4
      await clientSend('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        button: 'left',
        buttons: 1,
      })
    }
    const preview = await waitForCondition(async () => evaluatePage<{
      sampleCount: number
      backingWidth: number
      backingHeight: number
      incrementalCanvas: boolean
      inputMode: string
      visible: boolean
      predictionLayerCount: number
      predictedSampleCount: number
      predictionVisible: boolean
      paletteOpen: boolean
    } | null>(`
      (() => {
        const canvas = document.querySelector('.pageAnnotationInkCanvas[data-ink-active="true"]');
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        const style = getComputedStyle(canvas);
        const prediction = canvas.parentElement?.querySelector('.pageAnnotationInkPredictionLayer') ?? null;
        const predictionStyle = prediction ? getComputedStyle(prediction) : null;
        return {
          sampleCount: Number(canvas.dataset.inkSampleCount ?? 0),
          backingWidth: canvas.width,
          backingHeight: canvas.height,
          incrementalCanvas: canvas.dataset.inkRenderMode === 'incremental-canvas',
          inputMode: canvas.dataset.inkInputMode ?? '',
          visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
          predictionLayerCount: canvas.parentElement?.querySelectorAll('.pageAnnotationInkPredictionLayer[data-ink-render-mode="predicted-svg"]').length ?? 0,
          predictedSampleCount: Number(prediction?.getAttribute('data-ink-predicted-sample-count') ?? 0),
          predictionVisible: Boolean(predictionStyle)
            && predictionStyle.display !== 'none'
            && predictionStyle.visibility !== 'hidden'
            && Number(predictionStyle.opacity) > 0,
          paletteOpen: document.querySelector('.annotationFloatingPalette[data-annotation-session="active"]')?.classList.contains('open') === true,
        };
      })()
    `), 5000, 'live page annotation preview while pointer remains pressed')
    if (
      preview.sampleCount < 2
      || preview.backingWidth <= 1
      || preview.backingHeight <= 1
      || !preview.incrementalCanvas
      || preview.inputMode !== 'pointermove'
      || !preview.visible
      || preview.predictionLayerCount !== 1
      || preview.predictedSampleCount !== 0
      || preview.predictionVisible
      || !preview.paletteOpen
    ) {
      throw new Error(`page annotation preview is not using the active incremental canvas: ${JSON.stringify(preview)}`)
    }
    const previewPixels = await assertSelectorsContributePaint({
      evaluate: evaluatePage,
      captureScreenshot,
    }, {
      selector: '.pageAnnotationInkCanvas[data-ink-active="true"]',
      expectedCount: 1,
      label: `${artifactLabel} draft stroke while the pointer remains pressed`,
      minimumChangedPixels: 12,
    })
    await captureScreenshotArtifact(artifactLabel)
    checks.push(`${artifactLabel} contributed visible compositor pixels while pressed: ${previewPixels.join(', ')}`)
    await clientSend('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1,
    })
    await waitForPageCondition(
      () => document.querySelector('.pageAnnotationInkCanvas')?.getAttribute('data-ink-active') === 'false'
        && document.querySelector('.pageAnnotationInkPredictionLayer')?.hasAttribute('hidden') === true
        && document.querySelector('.pageAnnotationInkPredictionLayer')?.getAttribute('data-ink-predicted-sample-count') === '0',
      'live page annotation preview clears after commit',
    )
  }

  async function topElementSummary(point: ClientPoint): Promise<string> {
    return evaluatePage<string>(`
      (() => {
        const element = document.elementFromPoint(${point.x}, ${point.y});
        if (!element) return 'none';
        return Array.from((function* () {
          let current = element;
          while (current) {
            yield [current.tagName, current.id, current.className?.baseVal ?? current.className ?? '', current.getAttribute('aria-label') ?? ''].join('|');
            current = current.parentElement;
          }
        })()).join(' < ');
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
