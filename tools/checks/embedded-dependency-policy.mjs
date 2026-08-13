import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PATCHED_JS_YAML_VERSION = '4.3.1'
const APPROVED_PADDLE_WORKER_JS_YAML_VERSION = '4.1.1'

export function compareVersions(left, right) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value)
    if (!match) throw new Error(`unsupported dependency version: ${value}`)
    return match.slice(1).map(Number)
  }
  const leftParts = parse(left)
  const rightParts = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

export function readEmbeddedJsYamlVersion(workerSource) {
  const match = /\/\*!\s*js-yaml\s+(\d+\.\d+\.\d+)\b/.exec(workerSource)
  if (!match) throw new Error('PaddleOCR worker does not expose an embedded js-yaml version banner')
  return match[1]
}

export function evaluatePaddleWorkerPolicy({ externalVersion, workerSource }) {
  if (compareVersions(externalVersion, PATCHED_JS_YAML_VERSION) < 0) {
    throw new Error(
      `resolved js-yaml ${externalVersion} is vulnerable; require ${PATCHED_JS_YAML_VERSION} or newer`,
    )
  }

  const embeddedVersion = readEmbeddedJsYamlVersion(workerSource)
  if (compareVersions(embeddedVersion, PATCHED_JS_YAML_VERSION) >= 0) {
    return { status: 'patched', externalVersion, embeddedVersion }
  }
  if (embeddedVersion === APPROVED_PADDLE_WORKER_JS_YAML_VERSION) {
    return { status: 'fixed-model-exception', externalVersion, embeddedVersion }
  }
  throw new Error(
    `PaddleOCR worker embeds unreviewed vulnerable js-yaml ${embeddedVersion}; `
      + `expected patched ${PATCHED_JS_YAML_VERSION}+ or approved ${APPROVED_PADDLE_WORKER_JS_YAML_VERSION}`,
  )
}

export function checkEmbeddedDependencies(repoRoot, artifactRoot) {
  const externalPackagePath = path.join(repoRoot, 'node_modules', 'js-yaml', 'package.json')
  const paddleAssetsPath = artifactRoot
    ? path.resolve(repoRoot, artifactRoot, 'assets')
    : path.join(repoRoot, 'node_modules', '@paddleocr', 'paddleocr-js', 'dist', 'assets')
  if (!fs.existsSync(externalPackagePath)) throw new Error('resolved js-yaml package is missing')
  if (!fs.existsSync(paddleAssetsPath)) {
    throw new Error(`PaddleOCR worker assets are missing: ${path.relative(repoRoot, paddleAssetsPath)}`)
  }

  const workerFiles = fs.readdirSync(paddleAssetsPath)
    .filter(name => /^worker-entry-.+\.js$/.test(name))
  if (workerFiles.length !== 1) {
    throw new Error(`expected exactly one PaddleOCR worker asset, found ${workerFiles.length}`)
  }

  const externalVersion = JSON.parse(fs.readFileSync(externalPackagePath, 'utf8')).version
  const workerSource = fs.readFileSync(path.join(paddleAssetsPath, workerFiles[0]), 'utf8')
  return {
    source: artifactRoot ? path.relative(repoRoot, paddleAssetsPath) : 'PaddleOCR package',
    workerFile: workerFiles[0],
    ...evaluatePaddleWorkerPolicy({ externalVersion, workerSource }),
  }
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const artifactRootIndex = process.argv.indexOf('--artifact-root')
  const artifactRoot = artifactRootIndex >= 0 ? process.argv[artifactRootIndex + 1] : undefined
  if (artifactRootIndex >= 0 && !artifactRoot) throw new Error('--artifact-root requires a path')
  const result = checkEmbeddedDependencies(repoRoot, artifactRoot)
  if (result.status === 'patched') {
    console.log(
      `[embedded-dependencies] passed: js-yaml ${result.externalVersion}; `
        + `PaddleOCR worker ${result.embeddedVersion}; source=${result.source}`,
    )
    return
  }
  console.log(
    `[embedded-dependencies] passed with fixed-model exception: js-yaml ${result.externalVersion}; `
      + `PaddleOCR worker ${result.embeddedVersion}; source=${result.source}; worker=${result.workerFile}`,
  )
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) main()
