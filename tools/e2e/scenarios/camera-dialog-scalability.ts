interface Point {
  x: number
  y: number
}

interface CameraDialogScalabilityDriver {
  clientPointsForTimedRange: (
    role: 'camera',
    laneId: string,
    startFrame: number,
    endFrame: number,
  ) => Promise<[Point, Point]>
  mouseDrag: (start: Point, end: Point) => Promise<void>
  keyPress: (key: string) => Promise<void>
  waitForSelector: (selector: string) => Promise<unknown>
  clickButtonByText: (label: string) => Promise<void>
  setReactFieldValue: (selector: string, value: string) => Promise<void>
  evaluatePage: <T>(expression: string) => Promise<T>
  waitForPageCondition: (condition: () => boolean, label?: string) => Promise<void>
  checks: string[]
}

interface CameraDialogLayoutContract {
  bodyFits: boolean
  segmentLefts: number[]
  durationLefts: number[]
  deleteLefts: number[]
  constrainedScrolls: boolean
  footerVisible: boolean
}

export async function verifyCameraDialogScalability(
  driver: CameraDialogScalabilityDriver,
): Promise<void> {
  const [scaleStart, scaleEnd] = await driver.clientPointsForTimedRange(
    'camera',
    'camera_lane_1',
    1,
    96,
  )
  await driver.mouseDrag(scaleStart, scaleEnd)
  await driver.keyPress('Enter')
  await driver.waitForSelector('[role="dialog"][aria-label="撮影指示"]')
  await driver.clickButtonByText('＋ 中間ラベル')
  await driver.setReactFieldValue('[aria-label="CAMERA中間ラベル1までの区間長"]', '25')
  await driver.evaluatePage<void>(`(() => {
    const input = document.querySelector('[aria-label="CAMERA中間ラベル1までの区間長"]');
    input?.focus();
    input?.blur();
  })()`)
  await driver.waitForPageCondition(
    () => document.querySelector<HTMLInputElement>('[aria-label="CAMERA中間ラベル1までの区間長"]')?.value === '1+1',
    'compact intermediate duration normalized to 1+1',
  )
  for (let index = 1; index < 7; index += 1) {
    await driver.clickButtonByText('＋ 中間ラベル')
  }
  await driver.waitForPageCondition(
    () => document.querySelectorAll('[role="dialog"][aria-label="撮影指示"] .cameraSegmentKindOptions').length === 8,
    'eight visible CAMERA interval selectors',
  )
  const layout = await driver.evaluatePage<CameraDialogLayoutContract>(`
    (() => {
      const dialog = document.querySelector('.cameraCueDialog');
      const body = dialog?.querySelector('.cameraCueDialogBody');
      const footer = dialog?.querySelector('.soundCueDialogFooter');
      if (!dialog || !body || !footer) throw new Error('CAMERA dialog layout is unavailable');
      const bodyFits = body.scrollHeight <= body.clientHeight + 1;
      const segmentLefts = Array.from(dialog.querySelectorAll('.cameraSegmentKindOptions')).map(item => Math.round(item.getBoundingClientRect().left));
      const durationLefts = Array.from(dialog.querySelectorAll('.cameraIntermediatePointRow .compactDurationFrameControl')).map(item => Math.round(item.getBoundingClientRect().left));
      const deleteLefts = Array.from(dialog.querySelectorAll('.cameraIntermediatePointRow > .dialogIconButton')).map(item => Math.round(item.getBoundingClientRect().left));
      dialog.style.maxHeight = '360px';
      const constrainedScrolls = body.scrollHeight > body.clientHeight + 1 && getComputedStyle(body).overflowY === 'auto';
      const dialogBox = dialog.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      const footerVisible = footerBox.top >= dialogBox.top && footerBox.bottom <= dialogBox.bottom + 1;
      return { bodyFits, segmentLefts, durationLefts, deleteLefts, constrainedScrolls, footerVisible };
    })()
  `)
  const aligned = (values: number[]) => values.length > 0 && new Set(values).size === 1
  if (!layout.bodyFits
    || !aligned(layout.segmentLefts)
    || !aligned(layout.durationLefts)
    || !aligned(layout.deleteLefts)
    || !layout.constrainedScrolls
    || !layout.footerVisible) {
    throw new Error(`CAMERA dialog scalability contract failed: ${JSON.stringify(layout)}`)
  }
  await driver.keyPress('Escape')
  await driver.waitForPageCondition(
    () => !document.querySelector('[role="dialog"][aria-label="撮影指示"]'),
    'scalability CAMERA dialog closed',
  )
  driver.checks.push('kept eight CAMERA intervals aligned without scrolling at normal height and retained a fixed footer with body scrolling at constrained height')
}
