import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const OCR_IDENTIFIER = /(?:@paddleocr|PaddleOCR|PP-OCRv5)/i

function filesUnder(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name)
    return entry.isDirectory() ? filesUnder(file) : [file]
  })
}

export function checkEmbeddedDependencies(repoRoot, artifactRoot) {
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'))
  if (!lock.packages || typeof lock.packages !== 'object') throw new Error('Dependency lock inventory is missing')
  for (const packagePath of Object.keys(lock.packages)) {
    if (/node_modules\/@paddleocr\//.test(packagePath)) throw new Error(`Removed OCR dependency: ${packagePath}`)
  }
  const externalVersion = lock.packages['node_modules/js-yaml']?.version
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(externalVersion ?? '')
  if (!match || Number(match[1]) < 4 || (Number(match[1]) === 4 && (Number(match[2]) < 3 || (Number(match[2]) === 3 && Number(match[3]) < 2)))) {
    throw new Error(`Resolved js-yaml ${externalVersion} must be 4.3.2 or newer`)
  }
  if (filesUnder(path.join(repoRoot, 'apps/web/public/ocr')).length) throw new Error('Removed OCR model/runtime assets remain in public/ocr')
  if (artifactRoot) {
    const root = path.resolve(repoRoot, artifactRoot)
    if (!fs.existsSync(root)) throw new Error(`Artifact is missing: ${artifactRoot}`)
    for (const file of filesUnder(root)) {
      const relative = path.relative(root, file).replaceAll('\\', '/')
      if (/(?:^|\/)ocr(?:\/|$)/i.test(relative)) throw new Error(`Removed OCR asset: ${relative}`)
      if (/\.(?:m?js|html|json)$/i.test(file) && OCR_IDENTIFIER.test(fs.readFileSync(file, 'utf8'))) {
        throw new Error(`Removed OCR runtime content: ${relative}`)
      }
    }
  }
  return { status: 'ocr-removed', externalVersion }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--artifact-root')) throw new Error('Expected --artifact-root <directory>')
  const result = checkEmbeddedDependencies(root, args[1])
  console.log(`[embedded-dependencies] passed: OCR dependencies/assets removed; js-yaml ${result.externalVersion}`)
}
