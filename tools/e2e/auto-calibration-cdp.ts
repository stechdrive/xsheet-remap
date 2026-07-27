import { writeFile } from 'node:fs/promises'

interface ClientPoint {
  x: number
  y: number
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
if (!args['sheet-source']) throw new Error('--sheet-source is required')

const checks: string[] = []
let client: CdpClient | null = null

try {
  const target = await waitForCdpTarget(port, target => !target.url.includes('window=asset-preview'), 'main CDP target')
  if (!target.webSocketDebuggerUrl) throw new Error('CDP target did not expose a websocket URL')
  client = await CdpClient.connect(target.webSocketDebuggerUrl)
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Input.setIgnoreInputEvents', { ignore: false })

  await waitForSheet()
  await dropSheetSourceFile(args['sheet-source'])
  await waitForPageCondition(() => document.querySelectorAll('image.sheetImage').length > 0, 'sheet source assigned')
  checks.push('loaded a sheet source image through the paper sheet loader')

  await clickButton('シート画像補正')
  await waitForPageCondition(() => {
    const dialog = document.querySelector('.calibrationLoupeDialog')
    return Boolean(dialog && document.querySelectorAll('.calibrationLoupeView').length === 4)
  }, 'calibration loupe dialog')
  checks.push('entered image warp calibration mode')

  await clickButton('4点自動検出')
  const statusText = await waitForCondition(async () => {
    const text = await evaluatePage<string>(`
      (() => document.querySelector('.paperSheetRailMenu.actionMenuPortalContent')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '')()
    `)
    if (text.includes('自動検出エラー')) return text
    if (text.includes('自動検出できませんでした')) return text
    if (new RegExp('自動検出 \\d+% / \\d+線').test(text)) return text
    return null
  }, 30000, 'auto calibration result')
  if (statusText.includes('自動検出エラー') || statusText.includes('Promise.prototype.then')) {
    throw new Error(statusText)
  }
  const overlay = await waitForCondition(async () => {
    return evaluatePage<{ method: string | null; expected: string | null; detected: string | null } | null>(`
      (() => {
        const overlay = document.querySelector('.autoCalibrationGuideOverlay');
        const expected = document.querySelector('.autoCalibrationExpectedQuad');
        const detected = document.querySelector('.autoCalibrationDetectedQuad');
        if (!overlay || !expected || !detected) return null;
        return {
          method: overlay.getAttribute('data-method'),
          expected: expected.getAttribute('points'),
          detected: detected.getAttribute('points'),
        };
      })()
    `)
  }, 5000, 'auto calibration guide overlay')
  if (
    overlay.method !== 'pixel-projection' &&
    overlay.method !== 'horizontal-span-projection' &&
    overlay.method !== 'template-grid-fit'
  ) {
    throw new Error(`expected projection auto calibration, got ${overlay.method ?? 'none'}`)
  }
  const expectedPoints = parseSvgPoints(overlay.expected)
  const detectedPoints = parseSvgPoints(overlay.detected)
  const maxGuideDelta = maxPointDelta(expectedPoints, detectedPoints)
  if (maxGuideDelta > 0.015) {
    throw new Error(`auto calibration detected guide drifted too far from template target: ${maxGuideDelta.toFixed(4)}`)
  }
  checks.push(`showed expected/detected calibration guides with ${overlay.method}`)
  checks.push(`kept detected calibration guide near template target: ${maxGuideDelta.toFixed(4)}`)
  const autoCalibrationSummary = statusText.match(/自動検出\s+\d+%\s+\/\s+\d+線/u)?.[0] ?? 'auto calibration completed'
  checks.push('ran sheet auto calibration without runtime error')

  await writeJson(args.report, { checks, autoCalibrationSummary, overlay, maxGuideDelta })
  await writeJson(args.result, {
    passed: true,
    scenario: 'auto-calibration',
    checks,
    artifacts: [args.report],
  })
} catch (error) {
  const report = {
    checks,
    error: errorMessage(error),
    debug: client ? await pageDebug().catch(debugError => ({ debugError: errorMessage(debugError) })) : null,
  }
  await writeJson(args.report, report)
  await writeJson(args.result, {
    passed: false,
    scenario: 'auto-calibration',
    error: errorMessage(error),
    checks,
    artifacts: [args.report],
  })
  process.exitCode = 1
} finally {
  client?.close()
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
    const box = sheet?.getBoundingClientRect()
    return Boolean(box && box.width > 100 && box.height > 100)
  }, 'sheet SVG')
}

async function dropSheetSourceFile(filePath: string): Promise<void> {
  await ensurePaperSheetMenuOpen()
  await setFileInputFiles('.paperSheetRailMenu input.hiddenFileInput[type="file"]', [filePath])
}

async function ensurePaperSheetMenuOpen(): Promise<void> {
  const opened = await evaluatePage<boolean>(`
    (() => {
      if (document.querySelector('.paperSheetRailMenu.actionMenuPortalContent')) return true;
      const summary = Array.from(document.querySelectorAll('summary'))
        .find(item => item.getAttribute('aria-label') === '紙シート' && item.getBoundingClientRect().width > 0);
      if (!(summary instanceof HTMLElement)) return false;
      summary.click();
      return true;
    })()
  `)
  if (!opened) throw new Error('paper sheet rail menu trigger not found')
  await waitForPageCondition(() => Boolean(document.querySelector('.paperSheetRailMenu.actionMenuPortalContent')), 'paper sheet rail menu')
}

async function clickButton(label: string): Promise<void> {
  const clicked = await evaluatePage<boolean>(`
    (() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find(item => item.textContent?.trim() === ${JSON.stringify(label)} && !item.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()
  `)
  if (!clicked) throw new Error(`button not found or disabled: ${label}`)
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

async function pageDebug(): Promise<Record<string, unknown>> {
  return evaluatePage<Record<string, unknown>>(`
    (() => ({
      readyState: document.readyState,
      bodyText: (document.body?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 800),
      hasDropZone: Boolean(document.querySelector('.sheetSourceDropZone')),
      sheetCount: document.querySelectorAll('svg.sheetSvg').length,
      imageCount: document.querySelectorAll('image.sheetImage').length,
      toolbarText: document.querySelector('.paperSheetRailMenu.actionMenuPortalContent')?.textContent?.replace(/\\s+/g, ' ').slice(0, 800) ?? null,
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
  const deadline = Date.now() + timeoutMs
  let lastError: Error | null = null
  while (Date.now() < deadline) {
    try {
      const value = await condition()
      if (value) return value
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function parseArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index]
    if (!key.startsWith('--')) continue
    const next = values[index + 1]
    if (!next || next.startsWith('--')) {
      result[key.slice(2)] = 'true'
    } else {
      result[key.slice(2)] = next
      index += 1
    }
  }
  return result
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseSvgPoints(value: string | null): ClientPoint[] {
  return (value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(item => {
      const [x, y] = item.split(',').map(Number)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`invalid SVG point: ${item}`)
      }
      return { x, y }
    })
}

function maxPointDelta(a: ClientPoint[], b: ClientPoint[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error(`point count mismatch: ${a.length} != ${b.length}`)
  }
  return Math.max(...a.map((point, index) => {
    const other = b[index]
    return Math.max(Math.abs(point.x - other.x), Math.abs(point.y - other.y))
  }))
}
