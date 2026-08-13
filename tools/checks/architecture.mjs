import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const ignoredDirectories = new Set(['node_modules', 'dist', 'dist-ts', 'target', 'gen', '.tmp', 'release-local'])
const violations = []
const implementationLineLimit = 2300
const testLineLimit = 1800

async function sourceFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(relativePath))
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath)
  }
  return files
}

async function checkImports(relativeDirectory, checks) {
  for (const relativePath of await sourceFiles(relativeDirectory)) {
    const source = await readFile(path.join(root, relativePath), 'utf8')
    for (const check of checks) {
      if (check.pattern.test(source)) violations.push(`${relativePath}: ${check.message}`)
    }
  }
}

async function checkFilePatterns(relativePath, checks) {
  const source = await readFile(path.join(root, relativePath), 'utf8')
  for (const check of checks) {
    if (check.pattern.test(source)) violations.push(`${relativePath}: ${check.message}`)
  }
}

async function checkFileRequirements(relativePath, checks) {
  const source = await readFile(path.join(root, relativePath), 'utf8')
  for (const check of checks) {
    if (!check.pattern.test(source)) violations.push(`${relativePath}: ${check.message}`)
  }
}

async function checkFileSizes(relativeDirectory) {
  for (const relativePath of await sourceFiles(relativeDirectory)) {
    const source = await readFile(path.join(root, relativePath), 'utf8')
    const lineCount = source.split(/\r?\n/).length
    const isTest = /(?:^|[\\/])[^\\/]+\.test\.[^.]+$/.test(relativePath)
    const limit = isTest ? testLineLimit : implementationLineLimit
    if (lineCount > limit) {
      violations.push(`${relativePath}: ${lineCount} lines exceeds the ${isTest ? 'test' : 'implementation'} limit of ${limit}`)
    }
  }
}

await checkImports('packages/core/src', [
  {
    pattern: /from\s+['"]@xsheet-remap\/(?:ui|adapters|xdts)['"]/,
    message: 'core must not depend on ui, adapters, or xdts',
  },
])

await checkImports('packages/ui/src', [
  {
    pattern: /(?:from\s+|import\s*\()['"]@tauri-apps\/api/,
    message: 'ui must access Tauri through @xsheet-remap/adapters',
  },
])

await checkFilePatterns('packages/ui/src/DialogueAudioTimeline.tsx', [
  {
    pattern: /\btitle\s*=/,
    message: 'audio timeline tooltips must use the shared Tooltip or TooltipTarget foundation instead of native title attributes',
  },
])

await checkFileRequirements('packages/ui/src/app-shell-controller.tsx', [
  {
    pattern: /from\s+['"]\.\/workspaceInteractionPolicy['"]/,
    message: 'cross-surface SOUND navigation must use the shared workspace interaction policy',
  },
  {
    pattern: /from\s+['"]\.\/workspaceSelectionModel['"]/,
    message: 'sheet selection lookup must use the shared workspace selection model',
  },
  {
    pattern: /\bresolveWorkspaceKeyboardOwner\b/,
    message: 'workspace key commands must resolve ownership from the focused DOM surface',
  },
])

await checkFilePatterns('packages/ui/src/app-shell-controller.tsx', [{
  pattern: /event\.target\s+instanceof\s+HTML(?:Input|TextArea|Select)Element/,
  message: 'workspace key commands must use the shared interactive-target policy instead of private element checks',
}])

await checkFileRequirements('packages/ui/src/app-sheet-canvas-controller.tsx', [{
  pattern: /\bresolveSheetViewportPointerIntent\b/,
  message: 'sheet viewport background and pan gestures must use the shared workspace interaction policy',
}])

await checkFileRequirements('packages/ui/src/DialogueAudioTimeline.tsx', [{
  pattern: /\bconsumedSoundCueNavigationRequestRef\b/,
  message: 'linked SOUND navigation must be consumed as a one-shot request instead of observed as persistent selection state',
}])

for (const relativePath of [
  'packages/ui/src/useDialogueAudioSegmentDrag.ts',
  'packages/ui/src/sheet-panel-annotation.tsx',
  'packages/ui/src/useSheetCalibrationDrag.ts',
]) {
  await checkFileRequirements(relativePath, [{
    pattern: /\busePointerDragSession\b/,
    message: 'pointer-driven edits must use the shared pointer drag session contract',
  }])
}

for (const relativePath of [
  'packages/ui/src/sheet-panel-annotation.tsx',
  'packages/ui/src/TimelineMemoLayer.tsx',
]) {
  await checkFileRequirements(relativePath, [{
    pattern: /\buseInlineEditorSession\b/,
    message: 'inline text editors must use the shared exactly-once editor session contract',
  }])
}

for (const relativePath of [
  'packages/ui/src/SoundCueDialog.tsx',
  'packages/ui/src/CameraCueDialog.tsx',
  'packages/ui/src/SheetHistoryRail.tsx',
]) {
  await checkFileRequirements(relativePath, [{
    pattern: /\buseModalDialogKeyboardBoundary\b/,
    message: 'workspace dialogs must own Escape and keyboard focus through the shared modal boundary',
  }])
  await checkFilePatterns(relativePath, [{
    pattern: /(?:window|document)\.addEventListener\(\s*['"]keydown['"]/,
    message: 'workspace dialogs must not install private keydown listeners',
  }])
}

for (const relativePath of [
  'packages/ui/src/stack-guides-paper-track.tsx',
  'packages/ui/src/TimelineLaneEditorPopover.tsx',
]) {
  await checkFileRequirements(relativePath, [{
    pattern: /\buseFloatingEditorBoundary\b/,
    message: 'floating editors must use the shared outside-click and Escape boundary',
  }])
}

for (const relativePath of [
  'packages/ui/src/TimelineMemoLayer.tsx',
  'packages/ui/src/PageAnnotationInputSurface.tsx',
]) {
  await checkFileRequirements(relativePath, [{
    pattern: /\buseInkStrokeSession\b/,
    message: 'freehand ink must use the dedicated actual/predicted pointer session contract',
  }])
}

for (const relativePath of [
  'packages/ui/src/useDialogueAudioSegmentDrag.ts',
  'packages/ui/src/sheet-panel-annotation.tsx',
  'packages/ui/src/TimelineMemoLayer.tsx',
  'packages/ui/src/useSheetCalibrationDrag.ts',
  'packages/ui/src/PageAnnotationInputSurface.tsx',
]) {
  await checkFilePatterns(relativePath, [{
    pattern: /(?:window|document)\.addEventListener\(\s*['"]pointer(?:move|up|cancel|down)['"]/,
    message: 'feature components must not install private pointer drag lifecycle listeners',
  }])
}

for (const directory of ['apps', 'packages', 'tools']) {
  await checkImports(directory, [
    {
      pattern: /['"]@xsheet-remap\/[^'"]+\/src(?:\/|['"])/,
      message: 'workspace packages must be imported through their public exports',
    },
  ])
  await checkFileSizes(directory)
}

if (violations.length > 0) {
  console.error('[architecture] dependency boundary violations:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('[architecture] passed')
}
