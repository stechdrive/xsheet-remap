import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

type PixelPoint = { x: number; y: number }

type CalibrationItem = {
  inputSha256?: string
  path: string
  name: string
  imageSize: { width: number; height: number }
  detected: boolean
  method: string | null
  confidence: number
  detectedLineCount: number
  score: number
  rating: string
  evaluationMs?: number
  corners: Array<{
    corner: string
    pointPx: PixelPoint
    support: number
    horizontalSupport: number
    verticalSupport: number
    offsetPx: number
  }>
}

type CalibrationReport = {
  runId: string
  generatedAt: string
  items: CalibrationItem[]
}

type ComparisonFailure = {
  key: string
  name: string
  reason: string
}

type ComparedItem = {
  key: string
  name: string
  detectedChanged: boolean
  methodChanged: boolean
  detectedLineCountChanged: boolean
  ratingChanged: boolean
  maximumCornerDeltaPx: number
  maximumCornerMetricDelta: number
  confidenceDelta: number
  scoreDelta: number
  baselineMs: number | null
  candidateMs: number | null
  durationRatio: number | null
}

type ParsedArgs = {
  baseline: string
  candidate: string
  out: string | null
  maximumCornerDeltaPx: number
  p99CornerDeltaPx: number
  maximumConfidenceDelta: number
}

const args = parseArgs(process.argv.slice(2))
const baseline = await loadReport(args.baseline)
const candidate = await loadReport(args.candidate)
const comparison = compareReports(baseline, candidate, args)
const json = `${JSON.stringify(comparison, null, 2)}\n`
if (args.out) {
  const outputPath = path.resolve(args.out)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, json, 'utf8')
  process.stdout.write(`comparison: ${outputPath}\n`)
}
process.stdout.write(`${json}\n`)
if (!comparison.passed) process.exitCode = 1

function parseArgs(rawArgs: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    baseline: '',
    candidate: '',
    out: null,
    maximumCornerDeltaPx: 0.5,
    p99CornerDeltaPx: 0.25,
    maximumConfidenceDelta: 1e-9,
  }
  for (let index = 0; index < rawArgs.length; index += 1) {
    const option = rawArgs[index]
    const value = rawArgs[index + 1]
    if (!option.startsWith('--') || !value || value.startsWith('--')) throw new Error(`${option} requires a value`)
    index += 1
    if (option === '--baseline') parsed.baseline = value
    else if (option === '--candidate') parsed.candidate = value
    else if (option === '--out') parsed.out = value
    else if (option === '--max-corner-delta') parsed.maximumCornerDeltaPx = positiveNumber(value, option)
    else if (option === '--p99-corner-delta') parsed.p99CornerDeltaPx = positiveNumber(value, option)
    else if (option === '--max-confidence-delta') parsed.maximumConfidenceDelta = positiveNumber(value, option)
    else throw new Error(`unknown option: ${option}`)
  }
  if (!parsed.baseline || !parsed.candidate) throw new Error('--baseline and --candidate are required')
  return parsed
}

async function loadReport(filePath: string): Promise<CalibrationReport> {
  return JSON.parse(await readFile(path.resolve(filePath), 'utf8')) as CalibrationReport
}

function compareReports(baseline: CalibrationReport, candidate: CalibrationReport, thresholds: ParsedArgs) {
  const baselineByKey = reportItemsByKey(baseline.items)
  const candidateByKey = reportItemsByKey(candidate.items)
  const failures: ComparisonFailure[] = []
  const items: ComparedItem[] = []
  const cornerDeltas: number[] = []

  for (const [key, expected] of baselineByKey) {
    const actual = candidateByKey.get(key)
    if (!actual) {
      failures.push({ key, name: expected.name, reason: 'candidate report is missing this input' })
      continue
    }
    const detectedChanged = actual.detected !== expected.detected
    const methodChanged = actual.method !== expected.method
    const detectedLineCountChanged = actual.detectedLineCount !== expected.detectedLineCount
    const ratingChanged = actual.rating !== expected.rating
    const deltas = expected.corners.map(expectedCorner => {
      const actualCorner = actual.corners.find(corner => corner.corner === expectedCorner.corner)
      return actualCorner ? distance(expectedCorner.pointPx, actualCorner.pointPx) : Number.POSITIVE_INFINITY
    })
    cornerDeltas.push(...deltas)
    const maximumCornerDeltaPx = Math.max(0, ...deltas)
    const maximumCornerMetricDelta = Math.max(0, ...expected.corners.flatMap(expectedCorner => {
      const actualCorner = actual.corners.find(corner => corner.corner === expectedCorner.corner)
      if (!actualCorner) return [Number.POSITIVE_INFINITY]
      return [
        Math.abs(actualCorner.support - expectedCorner.support),
        Math.abs(actualCorner.horizontalSupport - expectedCorner.horizontalSupport),
        Math.abs(actualCorner.verticalSupport - expectedCorner.verticalSupport),
        Math.abs(actualCorner.offsetPx - expectedCorner.offsetPx),
      ]
    }))
    const confidenceDelta = actual.confidence - expected.confidence
    if (detectedChanged) failures.push({ key, name: expected.name, reason: `detection changed: ${expected.detected} -> ${actual.detected}` })
    if (methodChanged) failures.push({ key, name: expected.name, reason: `method changed: ${expected.method} -> ${actual.method}` })
    if (detectedLineCountChanged) failures.push({ key, name: expected.name, reason: `detected line count changed: ${expected.detectedLineCount} -> ${actual.detectedLineCount}` })
    if (ratingChanged) failures.push({ key, name: expected.name, reason: `rating changed: ${expected.rating} -> ${actual.rating}` })
    if (actual.score !== expected.score) failures.push({ key, name: expected.name, reason: `score changed: ${expected.score} -> ${actual.score}` })
    if (Math.abs(confidenceDelta) > thresholds.maximumConfidenceDelta) {
      failures.push({ key, name: expected.name, reason: `confidence delta ${format(confidenceDelta)} exceeds ${thresholds.maximumConfidenceDelta}` })
    }
    if (maximumCornerMetricDelta > 1e-9) failures.push({ key, name: expected.name, reason: `corner support metric delta ${format(maximumCornerMetricDelta)} exceeds 1e-9` })
    if (maximumCornerDeltaPx > thresholds.maximumCornerDeltaPx) {
      failures.push({ key, name: expected.name, reason: `maximum corner delta ${format(maximumCornerDeltaPx)}px exceeds ${thresholds.maximumCornerDeltaPx}px` })
    }
    const baselineMs = finiteOrNull(expected.evaluationMs)
    const candidateMs = finiteOrNull(actual.evaluationMs)
    items.push({
      key,
      name: expected.name,
      detectedChanged,
      methodChanged,
      detectedLineCountChanged,
      ratingChanged,
      maximumCornerDeltaPx,
      maximumCornerMetricDelta,
      confidenceDelta,
      scoreDelta: actual.score - expected.score,
      baselineMs,
      candidateMs,
      durationRatio: baselineMs && candidateMs ? candidateMs / baselineMs : null,
    })
    candidateByKey.delete(key)
  }

  for (const [key, item] of candidateByKey) {
    failures.push({ key, name: item.name, reason: 'candidate report has an unexpected input' })
  }
  const sortedDeltas = cornerDeltas.filter(Number.isFinite).sort((a, b) => a - b)
  const p99CornerDeltaPx = percentile(sortedDeltas, 0.99)
  if (p99CornerDeltaPx > thresholds.p99CornerDeltaPx) {
    failures.push({ key: 'aggregate', name: 'all inputs', reason: `p99 corner delta ${format(p99CornerDeltaPx)}px exceeds ${thresholds.p99CornerDeltaPx}px` })
  }
  const durationRatios = items.map(item => item.durationRatio).filter((value): value is number => value !== null && Number.isFinite(value))
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: { path: path.resolve(args.baseline), runId: baseline.runId, generatedAt: baseline.generatedAt },
    candidate: { path: path.resolve(args.candidate), runId: candidate.runId, generatedAt: candidate.generatedAt },
    thresholds: {
      maximumCornerDeltaPx: thresholds.maximumCornerDeltaPx,
      p99CornerDeltaPx: thresholds.p99CornerDeltaPx,
      maximumConfidenceDelta: thresholds.maximumConfidenceDelta,
    },
    passed: failures.length === 0,
    summary: {
      baselineInputs: baseline.items.length,
      candidateInputs: candidate.items.length,
      comparedInputs: items.length,
      failureCount: failures.length,
      maximumCornerDeltaPx: Math.max(0, ...sortedDeltas),
      p99CornerDeltaPx,
      medianDurationRatio: durationRatios.length > 0 ? percentile(durationRatios.sort((a, b) => a - b), 0.5) : null,
    },
    failures,
    worstItems: items.sort((a, b) => b.maximumCornerDeltaPx - a.maximumCornerDeltaPx || a.name.localeCompare(b.name, 'ja-JP')).slice(0, 20),
  }
}

function reportItemsByKey(items: CalibrationItem[]): Map<string, CalibrationItem> {
  const result = new Map<string, CalibrationItem>()
  for (const item of items) {
    const key = item.inputSha256 || `${item.name}:${item.imageSize.width}x${item.imageSize.height}`
    if (result.has(key)) throw new Error(`duplicate calibration input key: ${key}`)
    result.set(key, item)
  }
  return result
}

function distance(a: PixelPoint, b: PixelPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positiveNumber(value: string, option: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative number`)
  return parsed
}

function format(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : String(value)
}
