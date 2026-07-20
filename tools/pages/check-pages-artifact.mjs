import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const outputRoot = path.join(repoRoot, 'apps', 'web', 'dist-pages')
const MAX_FILES = 1000
// Silero VADはモデルとWASMを初回音声解析時にだけ取得する。OCRは引き続きPages対象外。
const MAX_TOTAL_BYTES = 48 * 1024 * 1024
const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024
const allowedExtensions = new Set([
  '.css', '.gif', '.html', '.ico', '.jpeg', '.jpg', '.js', '.json', '.mjs', '.png',
  '.onnx', '.svg', '.ttf', '.wasm', '.webmanifest', '.webp', '.woff', '.woff2',
])
const forbiddenPathPatterns = [
  { name: 'source map', pattern: /(?:^|\/).*\.map$/i },
  { name: 'OCR runtime or model', pattern: /(?:^|\/)ocr(?:\/|$)/i },
  { name: 'environment file', pattern: /(?:^|\/)\.env(?:\.|$)/i },
  { name: 'private key or certificate', pattern: /\.(?:key|pem|p12|pfx)$/i },
  { name: 'user or interchange data', pattern: /\.(?:clip|psb|psd|xci|xdts|xsr)$/i },
  { name: 'local output directory', pattern: /(?:^|\/)(?:dev-local|reference-local|release-local|\.tmp)(?:\/|$)/i },
]
const contentPatterns = [
  { name: 'Windows user profile path', pattern: /[A-Za-z]:\\Users\\[^\\\s'"`<>]+/i },
  { name: 'developer workspace path', pattern: /[A-Za-z]:\\(?:GitHub|gh|dev|src|work)\\[^\\\s'"`<>]+/i },
  { name: 'repository-local output name', pattern: /(?:reference-local|release-local|dev-local|csp-import-helper-(?:build-venv|pyinstaller|dist))/i },
  { name: 'likely inline secret', pattern: /\b(?:api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*['"][A-Za-z0-9_./+=-]{16,}/i },
  { name: 'OCR model/runtime identifier', pattern: /(?:@paddleocr|PaddleOCR|PP-OCRv5)/i },
]

const findings = []
const files = await listFiles(outputRoot)
if (files.length === 0) fail('Pages output is empty')
if (files.length > MAX_FILES) findings.push(`file count ${files.length} exceeds ${MAX_FILES}`)
const requiredFiles = ['index.html', 'manifest.webmanifest', 'pages-artifact.json', 'sw.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']
for (const required of requiredFiles) if (!files.includes(required)) findings.push(`required file is missing: ${required}`)

const localValues = await localOnlyValues()
let totalBytes = 0
for (const relativePath of files) {
  const absolutePath = path.join(outputRoot, ...relativePath.split('/'))
  const stats = await fs.lstat(absolutePath)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    findings.push(`unsupported or linked output entry: ${relativePath}`)
    continue
  }
  const resolvedPath = await fs.realpath(absolutePath)
  if (!isInside(outputRoot, resolvedPath)) findings.push(`output entry escapes root: ${relativePath}`)
  const extension = path.extname(relativePath).toLowerCase()
  if (!allowedExtensions.has(extension)) findings.push(`extension is not allowlisted: ${relativePath}`)
  for (const rule of forbiddenPathPatterns) if (rule.pattern.test(relativePath)) findings.push(`${rule.name}: ${relativePath}`)
  totalBytes += stats.size
  if (stats.size > MAX_SINGLE_FILE_BYTES) findings.push(`single file exceeds ${MAX_SINGLE_FILE_BYTES} bytes: ${relativePath}`)
  const bytes = await fs.readFile(absolutePath)
  const decoded = [bytes.toString('utf8'), bytes.toString('utf16le')]
  for (const rule of contentPatterns) {
    if (decoded.some(content => rule.pattern.test(content))) findings.push(`${rule.name}: ${relativePath}`)
  }
  for (const value of localValues) {
    if (decoded.some(content => content.includes(value))) findings.push(`local-only environment value: ${relativePath}`)
  }
}
if (totalBytes > MAX_TOTAL_BYTES) findings.push(`total size ${totalBytes} exceeds ${MAX_TOTAL_BYTES} bytes`)

const indexHtml = await fs.readFile(path.join(outputRoot, 'index.html'), 'utf8')
for (const required of ['Content-Security-Policy', 'manifest.webmanifest', 'referrer']) {
  if (!indexHtml.includes(required)) findings.push(`index.html is missing ${required}`)
}
const manifest = JSON.parse(await fs.readFile(path.join(outputRoot, 'manifest.webmanifest'), 'utf8'))
if (manifest.start_url !== './' || manifest.scope !== './' || manifest.display !== 'standalone') {
  findings.push('manifest must use relative standalone Pages scope')
}
if (JSON.stringify(manifest).match(/https?:\/\//i)) findings.push('manifest contains an external URL')
for (const [iconPath, expectedSize] of [['icons/icon-192.png', 192], ['icons/icon-512.png', 512]]) {
  const bytes = await fs.readFile(path.join(outputRoot, iconPath))
  const dimensions = pngDimensions(bytes)
  if (dimensions?.width !== expectedSize || dimensions?.height !== expectedSize) {
    findings.push(`${iconPath} must be a ${expectedSize}x${expectedSize} PNG`)
  }
  const manifestIcon = manifest.icons?.find(icon => icon.src === `./${iconPath}`)
  if (manifestIcon?.sizes !== `${expectedSize}x${expectedSize}` || manifestIcon?.type !== 'image/png') {
    findings.push(`manifest is missing the declared ${expectedSize}x${expectedSize} PNG icon`)
  }
}

const serviceWorker = await fs.readFile(path.join(outputRoot, 'sw.js'), 'utf8')
if (!serviceWorker.includes('KNOWN_PATHS.has(url.pathname)') || !serviceWorker.includes('url.origin !== self.location.origin')) {
  findings.push('service worker must restrict caching to generated same-origin assets')
}

await verifyInventory(files)

if (findings.length > 0) {
  console.error('[pages-artifact] rejected:')
  for (const finding of [...new Set(findings)].sort()) console.error(`- ${finding}`)
  process.exit(1)
}
console.log(`[pages-artifact] passed: ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`)

async function verifyInventory(allFiles) {
  const inventory = JSON.parse(await fs.readFile(path.join(outputRoot, 'pages-artifact.json'), 'utf8'))
  if (inventory.schemaVersion !== 1 || inventory.app !== 'xsheet-editor-pwa' || !Array.isArray(inventory.files)) {
    findings.push('pages-artifact.json has an invalid schema')
    return
  }
  const expectedPaths = allFiles.filter(file => file !== 'pages-artifact.json').sort()
  const recordedPaths = inventory.files.map(file => file.path).sort()
  if (JSON.stringify(expectedPaths) !== JSON.stringify(recordedPaths)) {
    findings.push('pages-artifact.json file list does not match output')
    return
  }
  for (const record of inventory.files) {
    const bytes = await fs.readFile(path.join(outputRoot, ...record.path.split('/')))
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    if (record.bytes !== bytes.byteLength || record.sha256 !== sha256) {
      findings.push(`pages-artifact.json hash mismatch: ${record.path}`)
    }
  }
}

async function listFiles(root, relativeDirectory = '') {
  const entries = await fs.readdir(path.join(root, relativeDirectory), { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name)
    if (entry.isSymbolicLink()) {
      findings.push(`symbolic link is forbidden: ${relativePath}`)
      continue
    }
    if (entry.isDirectory()) result.push(...await listFiles(root, relativePath))
    else result.push(relativePath)
  }
  return result.sort((a, b) => a.localeCompare(b, 'en'))
}

async function localOnlyValues() {
  const envPath = path.join(repoRoot, '.env.local')
  try {
    const contents = await fs.readFile(envPath, 'utf8')
    return contents.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*?)\s*$/)
      if (!match) return []
      const value = match[1].replace(/^(['"])(.*)\1$/, '$2')
      return value.length >= 8 ? [value] : []
    })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return undefined
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function fail(message) {
  console.error(`[pages-artifact] ${message}`)
  process.exit(1)
}
