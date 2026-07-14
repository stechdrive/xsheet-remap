import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type PrecisionDiagnostics = {
  totalAnchorCount: number
  matchedAnchorCount: number
  inlierCount: number
  coverage: number
  confidence: number
  rmsBeforePx: number
  rmsAfterPx: number
  maxDisplacementPx: number
}

type ComparisonDiagnostic = {
  path: string
  name: string
  calibration: {
    confidence: number
    detectedLineCount: number
    method: string
  } | null
  precisionDiagnostics: PrecisionDiagnostics | null
  basicPngDataUrl: string | null
  precisionPngDataUrl: string | null
}

type ReportItem = Omit<ComparisonDiagnostic, 'basicPngDataUrl' | 'precisionPngDataUrl'> & {
  index: number
  basicImagePath: string | null
  precisionImagePath: string | null
  error: string | null
}

type Report = {
  generatedAt: string
  input: string
  output: string
  summary: {
    total: number
    calibrated: number
    precision: number
    basicOnly: number
    errors: number
  }
  items: ReportItem[]
}

type CdpTarget = {
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

type CdpResponse<T = unknown> = {
  id?: number
  result?: T
  error?: { message: string; data?: string }
}

type RuntimeEvaluateResult = {
  result: { value?: unknown; description?: string }
  exceptionDetails?: { text?: string; exception?: { description?: string } }
}

class CdpClient {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as CdpResponse
      if (typeof message.id !== 'number') return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ''}`))
      else pending.resolve(message.result)
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
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close(): void {
    this.socket.close()
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = parseArgs(process.argv.slice(2))
const outputRoot = path.resolve(args.out)
const runtimeRoot = path.join(repoRoot, '.tmp', 'sheet-corrector-precision-compare', timestampId())
const basicRoot = path.join(outputRoot, 'basic')
const precisionRoot = path.join(outputRoot, 'precision')
const profileRoot = path.join(runtimeRoot, 'profile', 'webview2')
let child: ChildProcess | null = null
let client: CdpClient | null = null

try {
  await Promise.all([
    mkdir(basicRoot, { recursive: true }),
    mkdir(precisionRoot, { recursive: true }),
    mkdir(profileRoot, { recursive: true }),
    mkdir(path.join(runtimeRoot, 'temp'), { recursive: true }),
  ])
  const files = await collectInputFiles(args.input, args.pattern)
  if (files.length === 0) throw new Error('比較対象の画像がありません。')
  const port = await getFreeTcpPort()
  child = launchSheetCorrector(args.exe, runtimeRoot, profileRoot, port)
  client = await connectToSheetCorrector(port)
  await waitForComparisonApi(client)

  const items: ReportItem[] = []
  for (const [index, filePath] of files.entries()) {
    const safeBase = safeArtifactBaseName(index, path.basename(filePath))
    try {
      const diagnostic = await evaluateFile(client, filePath)
      const basicImagePath = diagnostic.basicPngDataUrl
        ? await writeDataUrl(path.join(basicRoot, `${safeBase}-basic.png`), diagnostic.basicPngDataUrl)
        : null
      const precisionImagePath = diagnostic.precisionPngDataUrl
        ? await writeDataUrl(path.join(precisionRoot, `${safeBase}-precision.png`), diagnostic.precisionPngDataUrl)
        : null
      items.push({
        path: diagnostic.path,
        name: diagnostic.name,
        calibration: diagnostic.calibration,
        precisionDiagnostics: diagnostic.precisionDiagnostics,
        index: index + 1,
        basicImagePath: relativeOutputPath(basicImagePath),
        precisionImagePath: relativeOutputPath(precisionImagePath),
        error: null,
      })
      const status = precisionImagePath ? 'precision' : diagnostic.calibration ? 'basic-only' : 'undetected'
      const detail = diagnostic.precisionDiagnostics
        ? `inliers=${diagnostic.precisionDiagnostics.inlierCount} rms=${diagnostic.precisionDiagnostics.rmsBeforePx.toFixed(2)}→${diagnostic.precisionDiagnostics.rmsAfterPx.toFixed(2)}px max=${diagnostic.precisionDiagnostics.maxDisplacementPx.toFixed(2)}px`
        : ''
      process.stdout.write(`[${index + 1}/${files.length}] ${status.padEnd(10)} ${path.basename(filePath)} ${detail}\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      items.push({
        index: index + 1,
        path: filePath,
        name: path.basename(filePath),
        calibration: null,
        precisionDiagnostics: null,
        basicImagePath: null,
        precisionImagePath: null,
        error: message,
      })
      process.stdout.write(`[${index + 1}/${files.length}] error      ${path.basename(filePath)} ${message}\n`)
    }
  }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    output: outputRoot,
    summary: {
      total: items.length,
      calibrated: items.filter(item => item.basicImagePath).length,
      precision: items.filter(item => item.precisionImagePath).length,
      basicOnly: items.filter(item => item.basicImagePath && !item.precisionImagePath).length,
      errors: items.filter(item => item.error).length,
    },
    items,
  }
  await writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(path.join(outputRoot, 'index.html'), htmlReport(report), 'utf8')
  process.stdout.write(`\nreport: ${path.join(outputRoot, 'index.html')}\n`)
} finally {
  client?.close()
  await stopProcess(child)
}

function parseArgs(rawArgs: string[]) {
  const result = {
    exe: path.join(repoRoot, 'apps/sheet-corrector/src-tauri/target/release/xsheet-corrector.exe'),
    input: '',
    out: path.join(repoRoot, 'reference-local', 'precision-comparisons', timestampId()),
    pattern: '*sheet*.jpg',
  }
  for (let index = 0; index < rawArgs.length; index += 1) {
    const key = rawArgs[index]
    const value = rawArgs[index + 1]
    if (!key.startsWith('--') || !value || value.startsWith('--')) throw new Error(`${key} requires a value`)
    index += 1
    if (key === '--exe') result.exe = value
    else if (key === '--input') result.input = value
    else if (key === '--out') result.out = value
    else if (key === '--pattern') result.pattern = value
    else throw new Error(`unknown option: ${key}`)
  }
  if (!result.input) throw new Error('--input is required')
  return result
}

async function collectInputFiles(input: string, pattern: string): Promise<string[]> {
  const resolved = path.resolve(input)
  const info = await stat(resolved)
  const matcher = wildcardMatcher(pattern)
  if (info.isFile()) return matcher(path.basename(resolved)) ? [resolved] : []
  const entries = await readdir(resolved, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && /\.(?:jpe?g|png|tiff?|tga|bmp)$/iu.test(entry.name) && matcher(entry.name))
    .map(entry => path.join(resolved, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'ja-JP', { numeric: true, sensitivity: 'base' }))
}

function wildcardMatcher(pattern: string): (name: string) => boolean {
  const escaped = pattern.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  const regex = new RegExp(`^${escaped}$`, 'i')
  return name => regex.test(name)
}

function launchSheetCorrector(exePath: string, cwd: string, profileDirectory: string, port: number): ChildProcess {
  const resolvedExe = path.resolve(exePath)
  if (!existsSync(resolvedExe)) throw new Error(`sheet corrector exe not found: ${resolvedExe}`)
  return spawn(resolvedExe, [], {
    cwd,
    env: {
      ...process.env,
      XSHEET_REMAP_E2E: '1',
      WEBVIEW2_USER_DATA_FOLDER: profileDirectory,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      TEMP: path.join(cwd, 'temp'),
      TMP: path.join(cwd, 'temp'),
    },
    stdio: 'ignore',
    windowsHide: true,
  })
}

async function connectToSheetCorrector(port: number): Promise<CdpClient> {
  const target = await waitForCondition(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json`).catch(() => null)
    if (!response?.ok) return null
    const targets = await response.json() as CdpTarget[]
    return targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl && !item.url.includes('window=asset-preview')) ?? null
  }, 30000, 'CDP target')
  const nextClient = await CdpClient.connect(target.webSocketDebuggerUrl!)
  await nextClient.send('Runtime.enable')
  return nextClient
}

async function waitForComparisonApi(nextClient: CdpClient): Promise<void> {
  await waitForCondition(async () => {
    const ready = await evaluatePage<boolean>(nextClient, 'Boolean(window.__xsheetCorrectorDiagnostics?.evaluatePrecisionComparisonFile)')
    return ready || null
  }, 30000, 'precision comparison API')
}

function evaluateFile(nextClient: CdpClient, filePath: string): Promise<ComparisonDiagnostic> {
  return evaluatePage<ComparisonDiagnostic>(
    nextClient,
    `window.__xsheetCorrectorDiagnostics.evaluatePrecisionComparisonFile(${JSON.stringify(filePath)})`,
    240000,
  )
}

async function evaluatePage<T>(nextClient: CdpClient, expression: string, timeout = 30000): Promise<T> {
  const result = await nextClient.send<RuntimeEvaluateResult>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'CDP evaluation failed')
  return result.result.value as T
}

async function writeDataUrl(filePath: string, dataUrl: string): Promise<string> {
  const match = /^data:image\/png;base64,(.+)$/u.exec(dataUrl)
  if (!match) throw new Error(`unsupported image data for ${filePath}`)
  await writeFile(filePath, Buffer.from(match[1], 'base64'))
  return filePath
}

function relativeOutputPath(filePath: string | null): string | null {
  return filePath ? path.relative(outputRoot, filePath).replace(/\\/g, '/') : null
}

function htmlReport(report: Report): string {
  const items = report.items.map(item => {
    const metrics = item.precisionDiagnostics
    const metricText = metrics
      ? `対応点 ${metrics.inlierCount} / 残差 ${metrics.rmsBeforePx.toFixed(2)} → ${metrics.rmsAfterPx.toFixed(2)} px / 最大補正 ${metrics.maxDisplacementPx.toFixed(2)} px / 信頼度 ${Math.round(metrics.confidence * 100)}%`
      : item.calibration ? '高精度格子を安定して検出できなかったため、通常補正のみです。' : '通常補正の四隅を検出できませんでした。'
    const viewer = item.basicImagePath && item.precisionImagePath
      ? `<div class="compare" style="--split:50%"><img loading="lazy" src="${encodeURI(item.basicImagePath)}" alt="通常補正"><img loading="lazy" class="precision" src="${encodeURI(item.precisionImagePath)}" alt="高精度補正"><span class="divider"></span></div><input class="slider" type="range" min="0" max="100" value="50" aria-label="通常補正と高精度補正の境界">`
      : item.basicImagePath
        ? `<div class="single"><img loading="lazy" src="${encodeURI(item.basicImagePath)}" alt="通常補正"></div>`
        : `<div class="missing">出力なし</div>`
    const links = [
      item.basicImagePath ? `<a href="${encodeURI(item.basicImagePath)}">通常補正PNG</a>` : '',
      item.precisionImagePath ? `<a href="${encodeURI(item.precisionImagePath)}">高精度補正PNG</a>` : '',
    ].filter(Boolean).join('')
    return `<article><header><div><strong>${escapeHtml(`${item.index}. ${item.name}`)}</strong><p>${escapeHtml(metricText)}</p>${item.error ? `<p class="error">${escapeHtml(item.error)}</p>` : ''}</div><nav>${links}</nav></header><div class="labels"><span>← 高精度補正</span><span>通常補正 →</span></div>${viewer}</article>`
  }).join('\n')
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>通常補正 / 高精度補正 比較</title><style>
  :root{font-family:"Yu Gothic UI","Meiryo",system-ui,sans-serif;color:#243027;background:#e9ece6}*{box-sizing:border-box}body{margin:0}body>header{position:sticky;top:0;z-index:5;padding:14px 20px;background:#f8f9f5eb;border-bottom:1px solid #bdc5bb;backdrop-filter:blur(8px)}h1{margin:0 0 7px;font-size:20px}.summary{display:flex;gap:7px;flex-wrap:wrap}.pill{padding:4px 9px;border:1px solid #b9c4b7;border-radius:999px;background:white;font-size:12px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(560px,100%),1fr));gap:16px;padding:16px}article{overflow:hidden;border:1px solid #bdc5bb;border-radius:10px;background:white;box-shadow:0 4px 16px #2c382b18}article header{display:flex;gap:12px;justify-content:space-between;padding:11px 13px;border-bottom:1px solid #d5dbd2;background:#fafbf8}article p{margin:4px 0 0;color:#566258;font-size:12px}.error{color:#a42e25}nav{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}a{height:max-content;padding:5px 8px;border:1px solid #9ead9b;border-radius:6px;color:#255d3b;text-decoration:none;font-size:12px}.labels{display:flex;justify-content:space-between;padding:6px 12px;color:#677268;font-size:11px}.compare,.single{position:relative;aspect-ratio:1754/2481;margin:auto;max-height:76vh;background:#ddd}.compare img,.single img{display:block;width:100%;height:100%;object-fit:contain}.compare img{position:absolute;inset:0}.compare .precision{clip-path:inset(0 calc(100% - var(--split)) 0 0)}.divider{position:absolute;top:0;bottom:0;left:var(--split);width:2px;background:#dc3b2d;box-shadow:0 0 0 1px white}.slider{display:block;width:calc(100% - 24px);margin:10px 12px 13px}.missing{padding:80px 20px;text-align:center;color:#8a3b32;background:#f6e9e7}@media(max-width:620px){article header{display:grid}nav{justify-content:flex-start}}
  </style></head><body><header><h1>通常補正 / 高精度補正 比較</h1><div class="summary"><span class="pill">全 ${report.summary.total}枚</span><span class="pill">通常補正 ${report.summary.calibrated}枚</span><span class="pill">高精度 ${report.summary.precision}枚</span><span class="pill">通常のみ ${report.summary.basicOnly}枚</span><span class="pill">エラー ${report.summary.errors}枚</span></div></header><main>${items}</main><script>for(const slider of document.querySelectorAll('.slider'))slider.addEventListener('input',()=>slider.previousElementSibling.style.setProperty('--split',slider.value+'%'))</script></body></html>`
}

function safeArtifactBaseName(index: number, name: string): string {
  const stem = path.basename(name, path.extname(name))
  const safe = stem.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'sheet'
  return `${String(index + 1).padStart(3, '0')}_${safe}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character)
}

async function getFreeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('failed to allocate TCP port'))
      server.close(() => resolve(address.port))
    })
  })
}

async function waitForCondition<T>(callback: () => Promise<T | null>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: Error | null = null
  while (Date.now() < deadline) {
    try {
      const value = await callback()
      if (value) return value
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    await delay(250)
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

async function stopProcess(processToStop: ChildProcess | null): Promise<void> {
  if (!processToStop || processToStop.killed || processToStop.exitCode !== null) return
  processToStop.kill()
  await Promise.race([new Promise<void>(resolve => processToStop.once('exit', () => resolve())), delay(2500)])
}

function timestampId(): string {
  const now = new Date()
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
