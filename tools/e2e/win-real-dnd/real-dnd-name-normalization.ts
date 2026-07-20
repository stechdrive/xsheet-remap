interface CdpSender {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
}

type PageEvaluator = <T>(expression: string) => Promise<T>
type PageConditionWaiter = (condition: () => Promise<boolean>, label: string, timeoutMs?: number) => Promise<void>
type ScreenshotCapture = (label: string) => Promise<string>

interface NameNormalizationDialogLayoutOptions {
  client: CdpSender
  evaluatePage: PageEvaluator
  waitForPageCondition: PageConditionWaiter
  captureScreenshot: ScreenshotCapture
  diagnostics: Record<string, unknown>
}

interface NameNormalizationDialogGeometry {
  viewport: { width: number; height: number }
  dialog: { top: number; bottom: number; left: number; right: number }
  bodyScrollable: boolean
  headerShift: number
  footerShift: number
  stickyHeaderOffset: number
  defaultsCorrect: boolean
  headersCorrect: boolean
}

export async function verifyNameNormalizationDialogLayout({
  client,
  evaluatePage,
  waitForPageCondition,
  captureScreenshot,
  diagnostics,
}: NameNormalizationDialogLayoutOptions): Promise<void> {
  const originalViewport = await evaluatePage<{ width: number; height: number; deviceScaleFactor: number }>(`
    ({ width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio || 1 })
  `)
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 720,
    deviceScaleFactor: originalViewport.deviceScaleFactor,
    mobile: false,
  })
  try {
    const opened = await evaluatePage<boolean>(`
      (() => {
        const button = document.querySelector('.cspTreeNormalizeButton');
        if (!(button instanceof HTMLButtonElement) || button.textContent?.trim() !== '一括リネーム') return false;
        button.click();
        return true;
      })()
    `)
    if (!opened) throw new Error('visible one-click rename button not found')
    await waitForPageCondition(
      () => evaluatePage<boolean>(`Boolean(document.querySelector('.nameNormalizationDialog'))`),
      'name normalization dialog at minimum viewport',
    )
    await captureScreenshot('remap-name-normalization-1024x720')
    const geometry = await evaluatePage<NameNormalizationDialogGeometry>(`
      (() => {
        const dialog = document.querySelector('.nameNormalizationDialog');
        const header = dialog?.querySelector('.nameNormalizationHeader');
        const body = dialog?.querySelector('.nameNormalizationBody');
        const footer = dialog?.querySelector('.nameNormalizationFooter');
        const tbody = dialog?.querySelector('.nameNormalizationTable tbody');
        if (!(dialog instanceof HTMLElement) || !(header instanceof HTMLElement) || !(body instanceof HTMLElement)
          || !(footer instanceof HTMLElement) || !(tbody instanceof HTMLElement)) {
          throw new Error('rename dialog layout elements not found');
        }
        const sourceRow = tbody.querySelector('tr');
        for (let index = 0; index < 180; index += 1) {
          const row = sourceRow?.cloneNode(true) ?? document.createElement('tr');
          if (!(row instanceof HTMLTableRowElement)) continue;
          row.dataset.layoutFixture = 'true';
          if (!sourceRow) {
            for (let column = 0; column < 5; column += 1) {
              const cell = document.createElement('td');
              cell.textContent = 'layout fixture ' + index + '-' + column;
              row.append(cell);
            }
          }
          tbody.append(row);
        }
        body.scrollTop = 0;
        const dialogRect = dialog.getBoundingClientRect();
        const headerTop = header.getBoundingClientRect().top;
        const footerTop = footer.getBoundingClientRect().top;
        const bodyScrollable = body.scrollHeight > body.clientHeight;
        body.scrollTop = body.scrollHeight;
        const stickyHeader = dialog.querySelector('.nameNormalizationTable th');
        const bodyRect = body.getBoundingClientRect();
        const selects = Array.from(dialog.querySelectorAll('select'));
        const includeFiles = dialog.querySelector('input[type="checkbox"]');
        const defaultsCorrect = selects[0]?.value === 'action'
          && selects[1]?.value === ''
          && selects[2]?.value === 'auto'
          && includeFiles instanceof HTMLInputElement
          && includeFiles.checked;
        const headers = Array.from(dialog.querySelectorAll('.nameNormalizationTable th')).map(item => item.textContent?.trim());
        const headersCorrect = JSON.stringify(headers) === JSON.stringify(['工程', '対象', 'クリスタ用セル名', '素材ファイル名', '変更内容']);
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          dialog: { top: dialogRect.top, bottom: dialogRect.bottom, left: dialogRect.left, right: dialogRect.right },
          bodyScrollable,
          headerShift: Math.abs(header.getBoundingClientRect().top - headerTop),
          footerShift: Math.abs(footer.getBoundingClientRect().top - footerTop),
          stickyHeaderOffset: stickyHeader instanceof HTMLElement ? Math.abs(stickyHeader.getBoundingClientRect().top - bodyRect.top) : 999,
          defaultsCorrect,
          headersCorrect,
        };
      })()
    `)
    diagnostics.nameNormalizationMinimumViewport = geometry
    assertNameNormalizationDialogGeometry(geometry)
  } finally {
    await evaluatePage<void>(`
      (() => {
        document.querySelectorAll('[data-layout-fixture="true"]').forEach(item => item.remove());
        const dialog = document.querySelector('.nameNormalizationDialog');
        const cancel = Array.from(dialog?.querySelectorAll('button') || []).find(item => item.textContent?.trim() === 'キャンセル');
        cancel?.click();
      })()
    `).catch(() => undefined)
    await client.send('Emulation.clearDeviceMetricsOverride')
    await waitForPageCondition(
      () => evaluatePage<boolean>(`window.innerWidth === ${originalViewport.width} && window.innerHeight === ${originalViewport.height}`),
      'original viewport restored',
    )
  }
}

function assertNameNormalizationDialogGeometry(geometry: NameNormalizationDialogGeometry): void {
  const insideViewport = geometry.viewport.width === 1024
    && geometry.viewport.height === 720
    && geometry.dialog.top >= -1
    && geometry.dialog.left >= -1
    && geometry.dialog.bottom <= geometry.viewport.height + 1
    && geometry.dialog.right <= geometry.viewport.width + 1
  if (!insideViewport || !geometry.bodyScrollable || geometry.headerShift > 1 || geometry.footerShift > 1
    || geometry.stickyHeaderOffset > 2 || !geometry.defaultsCorrect || !geometry.headersCorrect) {
    throw new Error(`name normalization dialog minimum viewport layout failed: ${JSON.stringify(geometry)}`)
  }
}
