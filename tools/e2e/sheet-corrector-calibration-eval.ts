import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type CornerId = 'tl' | 'tr' | 'br' | 'bl'
type DiagnosticRating = 'pass' | 'review' | 'fail'
type HumanCornerGrade = 'fit' | 'near' | 'bad'

type PixelPoint = {
  x: number
  y: number
}

const cornerIds: CornerId[] = ['tl', 'tr', 'br', 'bl']

type CornerDiagnostic = {
  corner: CornerId
  pointPx: PixelPoint
  support: number
  horizontalSupport: number
  verticalSupport: number
  horizontalOffsetPx: number
  verticalOffsetPx: number
  offsetPx: number
  localMatch: {
    corner: CornerId
    dx: number
    dy: number
    angleDeg: number
    rawGain: number
    accepted: boolean
  } | null
}

type SheetCalibrationDiagnostic = {
  path: string
  name: string
  imageSize: { width: number; height: number }
  detected: boolean
  method: string | null
  confidence: number
  detectedLineCount: number
  score: number
  rating: DiagnosticRating
  reasons: string[]
  quad: {
    topWidthPx: number
    bottomWidthPx: number
    leftHeightPx: number
    rightHeightPx: number
    widthDisagreementRatio: number
    heightDisagreementRatio: number
    maxIdealDeltaPx: number
  } | null
  corners: CornerDiagnostic[]
  images: {
    montage: string | null
    corners: Record<CornerId, string | null>
  }
}

type HumanReviewItem = {
  corners?: Partial<Record<CornerId, HumanCornerGrade>>
  note?: string
}

type HumanReviewFile = {
  reportRunId?: string
  updatedAt?: string
  items?: Record<string, HumanReviewItem>
}

type ReportItem = Omit<SheetCalibrationDiagnostic, 'images'> & {
  index: number
  inputSha256: string
  evaluationMs: number
  montagePath: string | null
  cornerImagePaths: Record<CornerId, string | null>
  autoCornerGrades: Record<CornerId, HumanCornerGrade | null>
  humanReview: HumanReviewItem | null
}

type CalibrationEvalReport = {
  runId: string
  generatedAt: string
  exePath: string
  inputs: string[]
  pattern: string
  reviewPath: string | null
  summary: {
    total: number
    pass: number
    review: number
    fail: number
    averageScore: number
    humanReviewedCorners: number
    humanMismatchCorners: number
  }
  items: ReportItem[]
}

type ParsedArgs = {
  exe: string
  inputs: string[]
  out: string
  pattern: string
  review: string | null
  keepOpen: boolean
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

interface CdpRuntimeRemoteObject {
  type: string
  subtype?: string
  value?: unknown
  description?: string
}

interface CdpRuntimeEvaluateResult {
  result: CdpRuntimeRemoteObject
  exceptionDetails?: {
    text?: string
    exception?: {
      description?: string
    }
  }
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = parseArgs(process.argv.slice(2))
const runId = timestampId()
const outputRoot = path.resolve(repoRoot, args.out.includes('<timestamp>') ? args.out.replace('<timestamp>', runId) : args.out)
const runtimeRoot = path.join(repoRoot, '.tmp', 'sheet-corrector-calibration-eval', runId)
const cropRoot = path.join(outputRoot, 'crops')
const montageRoot = path.join(outputRoot, 'montage')
const profileRoot = path.join(runtimeRoot, 'profile', 'webview2')

let child: ChildProcess | null = null
let client: CdpClient | null = null

try {
  await mkdir(cropRoot, { recursive: true })
  await mkdir(montageRoot, { recursive: true })
  await mkdir(profileRoot, { recursive: true })
  await mkdir(path.join(runtimeRoot, 'temp'), { recursive: true })

  const files = await collectInputFiles(args.inputs, args.pattern)
  if (files.length === 0) throw new Error('評価対象の画像がありません。')
  const humanReview = args.review ? await loadHumanReview(args.review) : null
  const port = await getFreeTcpPort()
  child = launchSheetCorrector(args.exe, runtimeRoot, profileRoot, port)
  client = await connectToSheetCorrector(port)
  await waitForDiagnostics(client)

  const items: ReportItem[] = []
  for (const [index, filePath] of files.entries()) {
    const inputSha256 = createHash('sha256').update(await readFile(filePath)).digest('hex')
    const evaluationStartedAt = performance.now()
    const diagnostic = await evaluateFile(client, filePath)
    const evaluationMs = Math.round((performance.now() - evaluationStartedAt) * 10) / 10
    const baseName = safeArtifactBaseName(index, diagnostic.name)
    const montagePath = diagnostic.images.montage
      ? await writeDataUrl(path.join(montageRoot, `${baseName}.png`), diagnostic.images.montage)
      : null
    const cornerImagePaths = {
      tl: diagnostic.images.corners.tl ? await writeDataUrl(path.join(cropRoot, `${baseName}-tl.png`), diagnostic.images.corners.tl) : null,
      tr: diagnostic.images.corners.tr ? await writeDataUrl(path.join(cropRoot, `${baseName}-tr.png`), diagnostic.images.corners.tr) : null,
      br: diagnostic.images.corners.br ? await writeDataUrl(path.join(cropRoot, `${baseName}-br.png`), diagnostic.images.corners.br) : null,
      bl: diagnostic.images.corners.bl ? await writeDataUrl(path.join(cropRoot, `${baseName}-bl.png`), diagnostic.images.corners.bl) : null,
    }
    const reportItem: ReportItem = {
      ...diagnostic,
      index: index + 1,
      inputSha256,
      evaluationMs,
      montagePath: montagePath ? path.relative(outputRoot, montagePath).replace(/\\/g, '/') : null,
      cornerImagePaths: {
        tl: cornerImagePaths.tl ? path.relative(outputRoot, cornerImagePaths.tl).replace(/\\/g, '/') : null,
        tr: cornerImagePaths.tr ? path.relative(outputRoot, cornerImagePaths.tr).replace(/\\/g, '/') : null,
        br: cornerImagePaths.br ? path.relative(outputRoot, cornerImagePaths.br).replace(/\\/g, '/') : null,
        bl: cornerImagePaths.bl ? path.relative(outputRoot, cornerImagePaths.bl).replace(/\\/g, '/') : null,
      },
      autoCornerGrades: autoCornerGrades(diagnostic),
      humanReview: humanReview?.items?.[diagnostic.path] ?? humanReview?.items?.[diagnostic.name] ?? null,
    }
    items.push(reportItem)
    process.stdout.write(`[${index + 1}/${files.length}] ${diagnostic.rating.padEnd(6)} ${diagnostic.score.toString().padStart(3)} ${diagnostic.name}\n`)
  }

  items.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'ja-JP', { numeric: true }))
  const report: CalibrationEvalReport = {
    runId,
    generatedAt: new Date().toISOString(),
    exePath: path.resolve(args.exe),
    inputs: args.inputs.map(input => path.resolve(input)),
    pattern: args.pattern,
    reviewPath: args.review ? path.resolve(args.review) : null,
    summary: summarize(items),
    items,
  }
  await writeJson(path.join(outputRoot, 'report.json'), report)
  await writeFile(path.join(outputRoot, 'index.html'), htmlReport(report), 'utf8')
  await writeJson(path.join(outputRoot, 'human-review.template.json'), emptyHumanReviewTemplate(report))
  process.stdout.write(`\nreport: ${path.join(outputRoot, 'index.html')}\n`)
  process.stdout.write(`json:   ${path.join(outputRoot, 'report.json')}\n`)
} finally {
  client?.close()
  if (!args.keepOpen) await stopProcess(child)
}

function parseArgs(rawArgs: string[]): ParsedArgs {
  const defaults: ParsedArgs = {
    exe: path.join(repoRoot, 'dev-local/xsheet-corrector.exe'),
    inputs: [],
    out: path.join(repoRoot, '.tmp', 'sheet-corrector-calibration-evals', '<timestamp>'),
    pattern: '*sheet*.jpg',
    review: null,
    keepOpen: false,
  }
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg === '--keep-open') {
      defaults.keepOpen = true
      continue
    }
    if (!arg.startsWith('--')) {
      defaults.inputs.push(arg)
      continue
    }
    const key = arg.slice(2)
    const value = rawArgs[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    index += 1
    if (key === 'input') defaults.inputs.push(value)
    else if (key === 'exe') defaults.exe = value
    else if (key === 'out') defaults.out = value
    else if (key === 'pattern') defaults.pattern = value
    else if (key === 'review') defaults.review = value
    else throw new Error(`unknown option: ${arg}`)
  }
  if (defaults.inputs.length === 0) throw new Error('--input is required')
  return defaults
}

async function collectInputFiles(inputs: string[], pattern: string): Promise<string[]> {
  const supported = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.tga', '.bmp'])
  const matcher = wildcardMatcher(pattern)
  const paths: string[] = []
  for (const input of inputs) {
    const resolved = path.resolve(input)
    const info = await stat(resolved)
    if (info.isDirectory()) {
      const entries = await readdir(resolved, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const childPath = path.join(resolved, entry.name)
        if (!supported.has(path.extname(entry.name).toLowerCase())) continue
        if (!matcher(entry.name)) continue
        paths.push(childPath)
      }
    } else if (info.isFile()) {
      if (!supported.has(path.extname(resolved).toLowerCase())) continue
      if (!matcher(path.basename(resolved))) continue
      paths.push(resolved)
    }
  }
  const unique = Array.from(new Set(paths.map(item => path.resolve(item))))
  return unique.sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'ja-JP', { numeric: true, sensitivity: 'base' }))
}

function wildcardMatcher(pattern: string): (name: string) => boolean {
  const trimmed = pattern.trim()
  if (!trimmed) return () => true
  const escaped = trimmed
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  const regex = new RegExp(`^${escaped}$`, 'i')
  return name => regex.test(name)
}

function launchSheetCorrector(exePath: string, workingDirectory: string, profileDirectory: string, port: number): ChildProcess {
  const resolvedExe = path.resolve(exePath)
  if (!existsSync(resolvedExe)) throw new Error(`sheet corrector exe not found: ${resolvedExe}`)
  return spawn(resolvedExe, [], {
    cwd: workingDirectory,
    env: {
      ...process.env,
      XSHEET_REMAP_E2E: '1',
      WEBVIEW2_USER_DATA_FOLDER: profileDirectory,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      TEMP: path.join(workingDirectory, 'temp'),
      TMP: path.join(workingDirectory, 'temp'),
    },
    stdio: 'ignore',
    windowsHide: false,
  })
}

async function connectToSheetCorrector(port: number): Promise<CdpClient> {
  const target = await waitForCondition(async () => {
    const targets = await listCdpTargets(port)
    return targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl && !item.url.includes('window=asset-preview')) ?? null
  }, 30000, 'CDP target')
  if (!target.webSocketDebuggerUrl) throw new Error('CDP target did not expose a websocket URL')
  const nextClient = await CdpClient.connect(target.webSocketDebuggerUrl)
  await nextClient.send('Runtime.enable')
  return nextClient
}

async function listCdpTargets(port: number): Promise<CdpListTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json`).catch(() => null)
  if (!response?.ok) return []
  return response.json() as Promise<CdpListTarget[]>
}

async function waitForDiagnostics(nextClient: CdpClient): Promise<void> {
  await waitForCondition(async () => {
    const result = await evaluatePage<boolean>(nextClient, 'Boolean(window.__xsheetCorrectorDiagnostics?.evaluateCalibrationFile)')
    return result ? true : null
  }, 30000, 'sheet corrector diagnostics API')
}

async function evaluateFile(nextClient: CdpClient, filePath: string): Promise<SheetCalibrationDiagnostic> {
  return evaluatePage<SheetCalibrationDiagnostic>(
    nextClient,
    `window.__xsheetCorrectorDiagnostics.evaluateCalibrationFile(${JSON.stringify(filePath)})`,
    120000,
  )
}

async function evaluatePage<T>(nextClient: CdpClient, expression: string, timeout = 30000): Promise<T> {
  const result = await nextClient.send<CdpRuntimeEvaluateResult>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'CDP evaluation failed')
  }
  return result.result.value as T
}

async function getFreeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('failed to allocate TCP port'))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

async function waitForCondition<T>(
  callback: () => Promise<T | null>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: Error | null = null
  while (Date.now() < deadline) {
    try {
      const result = await callback()
      if (result) return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    await delay(250)
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function autoCornerGrades(diagnostic: SheetCalibrationDiagnostic): Record<CornerId, HumanCornerGrade | null> {
  const result: Record<CornerId, HumanCornerGrade | null> = { tl: null, tr: null, br: null, bl: null }
  for (const corner of diagnostic.corners) {
    const gain = corner.localMatch?.rawGain ?? 0
    const move = corner.localMatch ? Math.hypot(corner.localMatch.dx, corner.localMatch.dy) : 0
    if (corner.support >= 0.1 && gain <= 0.035) result[corner.corner] = 'fit'
    else if (corner.support >= 0.06 && gain <= 0.075 && move <= 18) result[corner.corner] = 'near'
    else result[corner.corner] = 'bad'
  }
  return result
}

function summarize(items: ReportItem[]): CalibrationEvalReport['summary'] {
  const humanStats = humanReviewStats(items)
  return {
    total: items.length,
    pass: items.filter(item => item.rating === 'pass').length,
    review: items.filter(item => item.rating === 'review').length,
    fail: items.filter(item => item.rating === 'fail').length,
    averageScore: Math.round(average(items.map(item => item.score)) * 10) / 10,
    humanReviewedCorners: humanStats.reviewed,
    humanMismatchCorners: humanStats.mismatch,
  }
}

function humanReviewStats(items: ReportItem[]): { reviewed: number; mismatch: number } {
  let reviewed = 0
  let mismatch = 0
  for (const item of items) {
    for (const corner of cornerIds) {
      const human = item.humanReview?.corners?.[corner]
      if (!human) continue
      reviewed += 1
      if (item.autoCornerGrades[corner] && item.autoCornerGrades[corner] !== human) mismatch += 1
    }
  }
  return { reviewed, mismatch }
}

async function loadHumanReview(filePath: string): Promise<HumanReviewFile> {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw) as HumanReviewFile
}

function emptyHumanReviewTemplate(report: CalibrationEvalReport): HumanReviewFile {
  return {
    reportRunId: report.runId,
    updatedAt: new Date().toISOString(),
    items: Object.fromEntries(report.items.map(item => [
      item.path,
      {
        corners: {},
        note: '',
      },
    ])),
  }
}

async function writeDataUrl(filePath: string, dataUrl: string): Promise<string> {
  const match = /^data:image\/png;base64,(.+)$/u.exec(dataUrl)
  if (!match) throw new Error(`unsupported data URL for ${filePath}`)
  await writeFile(filePath, Buffer.from(match[1], 'base64'))
  return filePath
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function htmlReport(report: CalibrationEvalReport): string {
  const embedded = JSON.stringify(report).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>四隅検出評価 ${escapeHtml(report.runId)}</title>
<style>
  :root { color-scheme: light; font-family: "Yu Gothic UI", "Meiryo", system-ui, sans-serif; }
  body { margin: 0; background: #efefea; color: #1e261f; }
  header { position: sticky; top: 0; z-index: 5; background: rgba(249,249,245,.96); border-bottom: 1px solid #c9d0c8; padding: 14px 18px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .summary { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; }
  .pill { border: 1px solid #c4cec3; border-radius: 999px; background: #fff; padding: 4px 9px; }
  .toolbar { margin-left: auto; display: flex; gap: 8px; }
  button { font: inherit; border: 1px solid #9ead9b; background: #fff; color: #1e261f; border-radius: 7px; padding: 6px 10px; cursor: pointer; }
  button:hover { background: #e8efe7; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(660px, 1fr)); gap: 14px; padding: 14px; }
  article { background: #fff; border: 1px solid #c9d0c8; border-radius: 8px; overflow: hidden; }
  .itemHead { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: start; padding: 10px 12px; border-bottom: 1px solid #d8ded6; background: #fafbf8; }
  .fileName { font-weight: 700; overflow-wrap: anywhere; }
  .path { font-size: 11px; color: #657063; overflow-wrap: anywhere; margin-top: 3px; }
  .score { font-size: 20px; font-weight: 700; text-align: right; }
  .rating-pass { color: #116b3f; }
  .rating-review { color: #906000; }
  .rating-fail { color: #b32d25; }
  .reasons { grid-column: 1 / -1; color: #865200; font-size: 12px; }
  .montage { display: block; max-width: 100%; width: 100%; background: #eee; border-bottom: 1px solid #d8ded6; image-rendering: pixelated; }
  .corners { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 10px; }
  .corner { min-width: 0; border: 1px solid #d8ded6; border-radius: 6px; padding: 7px; }
  .corner img { width: 100%; display: block; image-rendering: pixelated; border: 1px solid #d7ddd5; background: #f6f6f1; }
  .cornerTitle { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; margin-bottom: 5px; }
  .autoGrade { color: #667063; }
  .gradeButtons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 6px; }
  .gradeButtons button { padding: 5px 3px; font-size: 12px; border-radius: 5px; }
  .gradeButtons button.selected { color: #fff; border-color: #355f4b; background: #3d765e; }
  .gradeButtons button.mismatch { box-shadow: inset 0 0 0 2px #c95b47; }
  textarea { box-sizing: border-box; width: calc(100% - 20px); margin: 0 10px 10px; min-height: 42px; resize: vertical; border: 1px solid #c9d0c8; border-radius: 6px; padding: 6px; font: inherit; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>四隅検出評価 ${escapeHtml(report.runId)}</h1>
  <div class="summary">
    <span class="pill">総数 ${report.summary.total}</span>
    <span class="pill">pass ${report.summary.pass}</span>
    <span class="pill">review ${report.summary.review}</span>
    <span class="pill">fail ${report.summary.fail}</span>
    <span class="pill">平均 ${report.summary.averageScore}</span>
    <span class="pill" id="reviewSummary">人間評価 0角</span>
    <div class="toolbar">
      <button type="button" id="clearReview">表示中レビューを消去</button>
      <button type="button" id="downloadReview">human-review.json を保存</button>
    </div>
  </div>
</header>
<main id="items"></main>
<script>
const report = ${embedded};
const cornerOrder = ['tl', 'tr', 'bl', 'br'];
const cornerLabels = { tl: '左上', tr: '右上', br: '右下', bl: '左下' };
const gradeLabels = { fit: 'ぴったり', near: '少しズレ', bad: 'ズレ' };
const storageKey = 'xsheet-calibration-review:' + report.runId;
let review = loadReview();
render();

function loadReview() {
  const fromStorage = localStorage.getItem(storageKey);
  if (fromStorage) return JSON.parse(fromStorage);
  const items = {};
  for (const item of report.items) {
    items[item.path] = item.humanReview ?? { corners: {}, note: '' };
  }
  return { reportRunId: report.runId, updatedAt: new Date().toISOString(), items };
}

function saveReview() {
  review.updatedAt = new Date().toISOString();
  localStorage.setItem(storageKey, JSON.stringify(review));
  updateSummary();
}

function render() {
  const root = document.getElementById('items');
  root.innerHTML = '';
  for (const item of report.items) root.appendChild(renderItem(item));
  updateSummary();
}

function renderItem(item) {
  const article = document.createElement('article');
  const grade = ensureReviewItem(item.path);
  article.innerHTML = \`
    <div class="itemHead">
      <div>
        <div class="fileName">\${escapeHtml(item.index + '. ' + item.name)}</div>
        <div class="path">\${escapeHtml(item.path)}</div>
      </div>
      <div class="score rating-\${item.rating}">\${item.score}<br><small>\${item.rating}</small></div>
      <div class="reasons">\${escapeHtml(item.reasons.join(' / ') || '理由なし')}</div>
    </div>
    \${item.montagePath ? \`<img class="montage" src="\${encodeURI(item.montagePath)}" alt="\${escapeHtml(item.name)} montage">\` : ''}
    <div class="corners"></div>
    <textarea placeholder="人間評価メモ"></textarea>
  \`;
  const corners = article.querySelector('.corners');
  for (const corner of cornerOrder) corners.appendChild(renderCorner(item, corner));
  const textarea = article.querySelector('textarea');
  textarea.value = grade.note || '';
  textarea.addEventListener('input', () => {
    ensureReviewItem(item.path).note = textarea.value;
    saveReview();
  });
  return article;
}

function renderCorner(item, corner) {
  const wrapper = document.createElement('div');
  wrapper.className = 'corner';
  const cornerPath = item.cornerImagePaths[corner];
  const human = ensureReviewItem(item.path).corners[corner] || '';
  const auto = item.autoCornerGrades[corner] || '';
  wrapper.innerHTML = \`
    <div class="cornerTitle">
      <strong>\${cornerLabels[corner]}</strong>
      <span class="autoGrade">自動: \${auto ? gradeLabels[auto] : '-'}</span>
    </div>
    \${cornerPath ? \`<img src="\${encodeURI(cornerPath)}" alt="\${escapeHtml(item.name + ' ' + cornerLabels[corner])}">\` : ''}
    <div class="gradeButtons"></div>
  \`;
  const buttons = wrapper.querySelector('.gradeButtons');
  for (const value of ['fit', 'near', 'bad']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = gradeLabels[value];
    button.className = human === value ? 'selected' : '';
    if (human === value && auto && auto !== value) button.classList.add('mismatch');
    button.addEventListener('click', () => {
      const itemReview = ensureReviewItem(item.path);
      itemReview.corners[corner] = itemReview.corners[corner] === value ? undefined : value;
      saveReview();
      render();
    });
    buttons.appendChild(button);
  }
  return wrapper;
}

function ensureReviewItem(path) {
  review.items ??= {};
  review.items[path] ??= { corners: {}, note: '' };
  review.items[path].corners ??= {};
  return review.items[path];
}

function updateSummary() {
  let reviewed = 0;
  let mismatch = 0;
  for (const item of report.items) {
    const itemReview = review.items?.[item.path];
    if (!itemReview?.corners) continue;
    for (const corner of cornerOrder) {
      const human = itemReview.corners[corner];
      const auto = item.autoCornerGrades[corner];
      if (!human) continue;
      reviewed += 1;
      if (auto && auto !== human) mismatch += 1;
    }
  }
  document.getElementById('reviewSummary').textContent = \`人間評価 \${reviewed}角 / 差分 \${mismatch}角\`;
}

document.getElementById('downloadReview').addEventListener('click', () => {
  saveReview();
  const blob = new Blob([JSON.stringify(review, null, 2) + '\\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'human-review.json';
  link.click();
  URL.revokeObjectURL(url);
});

document.getElementById('clearReview').addEventListener('click', () => {
  localStorage.removeItem(storageKey);
  review = { reportRunId: report.runId, updatedAt: new Date().toISOString(), items: {} };
  render();
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
</script>
</body>
</html>
`
}

function safeArtifactBaseName(index: number, name: string): string {
  const ext = path.extname(name)
  const stem = path.basename(name, ext)
  const safeStem = stem.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'sheet'
  return `${String(index + 1).padStart(3, '0')}_${safeStem}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char] ?? char))
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function timestampId(): string {
  const now = new Date()
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`
}

async function stopProcess(processToStop: ChildProcess | null): Promise<void> {
  if (!processToStop || processToStop.killed || processToStop.exitCode !== null) return
  processToStop.kill()
  await Promise.race([
    new Promise<void>(resolve => processToStop.once('exit', () => resolve())),
    delay(2500),
  ])
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
