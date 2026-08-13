import type { SheetTimingRole } from '@xsheet-remap/core'

interface ClientPoint {
  x: number
  y: number
}

export interface MultilineMemoDriver {
  checks: string[]
  evaluatePage: <T>(expression: string) => Promise<T>
  waitForSelector: (selector: string) => Promise<void>
  waitForPageCondition: (condition: () => boolean, label?: string) => Promise<void>
  inputPointForSelector: (selector: string) => Promise<ClientPoint>
  mouseDoubleClick: (point: ClientPoint) => Promise<void>
  setReactFieldValue: (selector: string, value: string) => Promise<void>
  keyboardShortcut: (key: string) => Promise<void>
  keyPress: (key: string) => Promise<void>
  clickFrame: (role: SheetTimingRole, paperTrack: string, frame: number) => Promise<void>
  waitForEventAt: (role: SheetTimingRole, paperTrack: string, frame: number, value: string) => Promise<void>
  captureScreenshotArtifact: (label: string) => Promise<string>
}

export async function verifyMultilineMemoScenario(driver: MultilineMemoDriver): Promise<void> {
  const {
    checks,
    evaluatePage,
    waitForSelector,
    waitForPageCondition,
    inputPointForSelector,
    mouseDoubleClick,
    setReactFieldValue,
    keyboardShortcut,
    keyPress,
    clickFrame,
    waitForEventAt,
    captureScreenshotArtifact,
  } = driver
  const editSelector = 'button[aria-label="MEMOを編集"]'
  const editorSelector = 'textarea[aria-label="MEMO"]'
  const expectedValue = '1行目\n\n3行目'

  await evaluatePage(`document.querySelector(${JSON.stringify(editSelector)})?.scrollIntoView({ block: 'center', inline: 'center' })`)
  await mouseDoubleClick(await inputPointForSelector(editSelector))
  await waitForSelector(editorSelector)
  await setReactFieldValue(editorSelector, expectedValue)
  await keyboardShortcut('Enter')
  await waitForPageCondition(() => !document.querySelector('textarea[aria-label="MEMO"]'), 'multiline MEMO committed')
  await waitForPageCondition(
    () => document.activeElement?.matches('.sheetViewport[data-workspace-keyboard-scope="sheet"]') === true,
    'sheet keyboard focus restored after MEMO commit',
  )

  await clickFrame('cell', 'A', 1)
  await waitForPageCondition(
    () => document.activeElement?.matches('.sheetViewport[data-workspace-keyboard-scope="sheet"]') === true,
    'sheet keyboard focus retained after frame selection',
  )
  await keyPress('2')
  await waitForPageCondition(() => document.querySelector('.timingDraftText')?.textContent === '2', 'timing draft after MEMO commit')
  await keyPress('Enter')
  await waitForEventAt('cell', 'A', 1, '2')
  await waitForPageCondition(() => !document.querySelector(editorSelector), 'MEMO editor stayed closed during timing commit')
  checks.push('kept Ctrl+Enter MEMO completion and the next numeric timing entry in the sheet keyboard scope')

  const layout = await evaluatePage<{
    texts: string[]
    yPositions: number[]
    visualGap: number
    expectedVisualGap: number
  }>(`(() => {
    const text = Array.from(document.querySelectorAll('.metadataFieldText'))
      .find(element => element.textContent === '1行目3行目');
    if (!(text instanceof SVGTextElement)) throw new Error('committed multiline MEMO text missing');
    const lines = Array.from(text.querySelectorAll('tspan'));
    if (lines.length !== 3) throw new Error('committed multiline MEMO did not render three tspans');
    const yPositions = lines.map(line => Number(line.getAttribute('y')));
    const firstRect = lines[0].getBoundingClientRect();
    const thirdRect = lines[2].getBoundingClientRect();
    const matrix = text.getScreenCTM();
    if (!matrix) throw new Error('committed multiline MEMO screen transform missing');
    return {
      texts: lines.map(line => line.textContent ?? ''),
      yPositions,
      visualGap: thirdRect.top - firstRect.top,
      expectedVisualGap: (yPositions[2] - yPositions[0]) * Math.hypot(matrix.c, matrix.d),
    };
  })()`)
  const firstAdvance = layout.yPositions[1] - layout.yPositions[0]
  const secondAdvance = layout.yPositions[2] - layout.yPositions[1]
  if (
    JSON.stringify(layout.texts) !== JSON.stringify(['1行目', '', '3行目'])
    || !Number.isFinite(firstAdvance)
    || firstAdvance <= 0
    || Math.abs(firstAdvance - secondAdvance) > 0.01
    || layout.visualGap <= 0
    || Math.abs(layout.visualGap - layout.expectedVisualGap) > 1
  ) {
    throw new Error(`multiline MEMO blank-line spacing collapsed: ${JSON.stringify(layout)}`)
  }

  await captureScreenshotArtifact('multiline-memo-blank-line')
  await mouseDoubleClick(await inputPointForSelector(editSelector))
  await waitForSelector(editorSelector)
  const reopenedValue = await evaluatePage<string>(`document.querySelector(${JSON.stringify(editorSelector)})?.value ?? ''`)
  if (reopenedValue !== expectedValue) throw new Error(`multiline MEMO changed after reopen: ${JSON.stringify(reopenedValue)}`)
  await keyPress('Escape')
  checks.push('committed, rendered, and reopened a template-defined MEMO with one blank line')
}
