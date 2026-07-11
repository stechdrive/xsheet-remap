import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  activeCutProjectFromDocument,
  addBlankSharedCutToProjectDocument,
  buildCspImportPackage,
  createDefaultProject,
  createOrSetEvent,
  createProjectDocumentFromCutProject,
  registerAsset,
  registerAssetRoot,
  setEvent,
  updateActiveCutProjectInDocument,
  updateLogicalSheetSettings,
  updateProjectPaperTracks,
  upsertBinding,
  type CutMetadata,
  type CutProject,
  type CutGroupProjectDocument,
} from '@xsheet-remap/core'
import { exportXdts, parseXdts } from '@xsheet-remap/xdts'

type FixturePaperTrack = 'A' | 'B' | 'C' | 'D' | 'E'
type FixtureCorrectionLayerId = 'layer_sakuga' | 'layer_enshutsu' | 'layer_sakkan'
type Rgba = readonly [number, number, number, number]

interface FixtureAsset {
  cspCellName: string
  paperTrack: FixturePaperTrack
  correctionLayerId: FixtureCorrectionLayerId
  relativePath: string
  color: Rgba
}

interface FixtureEvent {
  key: string
  paperTrack: FixturePaperTrack
  frame: number
}

interface FixtureCut {
  cut: string
  timelineName: string
  durationFrames: number
  events: FixtureEvent[]
}

const repoRoot = process.cwd()
const fixturesRoot = path.resolve(repoRoot, 'apps/csp-import-helper/tests/fixtures')
const fixtureRoot = path.resolve(fixturesRoot, 'csp-import-v3-cut-group')
const materialsDirectory = path.join(fixtureRoot, 'materials')
const packageDirectory = path.join(fixtureRoot, 'xsheet-csp-import')

const fixtureAssets: FixtureAsset[] = [
  { cspCellName: 'A_01', paperTrack: 'A', correctionLayerId: 'layer_sakuga', relativePath: 'materials/A_01.png', color: [224, 73, 57, 255] },
  { cspCellName: 'A_02', paperTrack: 'A', correctionLayerId: 'layer_sakuga', relativePath: 'materials/A_02.png', color: [246, 155, 71, 255] },
  { cspCellName: 'B_01', paperTrack: 'B', correctionLayerId: 'layer_sakuga', relativePath: 'materials/B_01.png', color: [54, 126, 221, 255] },
  { cspCellName: 'B_02', paperTrack: 'B', correctionLayerId: 'layer_sakuga', relativePath: 'materials/B_02.png', color: [61, 169, 117, 255] },
  { cspCellName: 'C_01', paperTrack: 'C', correctionLayerId: 'layer_sakuga', relativePath: 'materials/C_01.png', color: [156, 91, 214, 255] },
  { cspCellName: 'D_01', paperTrack: 'D', correctionLayerId: 'layer_sakuga', relativePath: 'materials/D_01.png', color: [42, 185, 199, 255] },
  { cspCellName: 'E_01', paperTrack: 'E', correctionLayerId: 'layer_sakuga', relativePath: 'materials/E_01.png', color: [229, 201, 65, 255] },
  { cspCellName: 'A_03_e', paperTrack: 'A', correctionLayerId: 'layer_enshutsu', relativePath: 'materials/A_03_e.png', color: [232, 96, 164, 255] },
  { cspCellName: 'D_02_e', paperTrack: 'D', correctionLayerId: 'layer_enshutsu', relativePath: 'materials/D_02_e.png', color: [84, 203, 219, 255] },
  { cspCellName: 'E_02_e', paperTrack: 'E', correctionLayerId: 'layer_enshutsu', relativePath: 'materials/E_02_e.png', color: [244, 216, 97, 255] },
  { cspCellName: 'A_04_s', paperTrack: 'A', correctionLayerId: 'layer_sakkan', relativePath: 'materials/A_04_s.png', color: [188, 69, 77, 255] },
  { cspCellName: 'B_03_s', paperTrack: 'B', correctionLayerId: 'layer_sakkan', relativePath: 'materials/B_03_s.png', color: [79, 92, 204, 255] },
  { cspCellName: 'C_02_s', paperTrack: 'C', correctionLayerId: 'layer_sakkan', relativePath: 'materials/C_02_s.png', color: [118, 73, 179, 255] },
]

const fixtureCuts: FixtureCut[] = [
  {
    cut: 'C101A',
    timelineName: '101A',
    durationFrames: 24,
    events: [
      { key: 'A_01', paperTrack: 'A', frame: 1 },
      { key: 'C_01', paperTrack: 'C', frame: 3 },
      { key: 'B_01', paperTrack: 'B', frame: 5 },
      { key: 'A_02', paperTrack: 'A', frame: 9 },
      { key: 'A_03_e', paperTrack: 'A', frame: 13 },
      { key: 'B_02', paperTrack: 'B', frame: 17 },
      { key: 'C_02_s', paperTrack: 'C', frame: 19 },
    ],
  },
  {
    cut: 'C101B',
    timelineName: '101B',
    durationFrames: 36,
    events: [
      { key: 'A_01', paperTrack: 'A', frame: 1 },
      { key: 'B_01', paperTrack: 'B', frame: 7 },
      { key: 'D_01', paperTrack: 'D', frame: 11 },
      { key: 'A_02', paperTrack: 'A', frame: 13 },
      { key: 'A_03_e', paperTrack: 'A', frame: 15 },
      { key: 'B_02', paperTrack: 'B', frame: 19 },
      { key: 'D_02_e', paperTrack: 'D', frame: 21 },
      { key: 'B_03_s', paperTrack: 'B', frame: 23 },
      { key: 'A_01', paperTrack: 'A', frame: 25 },
      { key: 'B_01', paperTrack: 'B', frame: 31 },
    ],
  },
  {
    cut: 'C101C',
    timelineName: '101C',
    durationFrames: 48,
    events: [
      { key: 'A_02', paperTrack: 'A', frame: 1 },
      { key: 'B_02', paperTrack: 'B', frame: 9 },
      { key: 'A_01', paperTrack: 'A', frame: 17 },
      { key: 'E_01', paperTrack: 'E', frame: 21 },
      { key: 'B_01', paperTrack: 'B', frame: 25 },
      { key: 'E_02_e', paperTrack: 'E', frame: 27 },
      { key: 'A_02', paperTrack: 'A', frame: 33 },
      { key: 'A_04_s', paperTrack: 'A', frame: 37 },
      { key: 'B_02', paperTrack: 'B', frame: 41 },
      { key: 'B_03_s', paperTrack: 'B', frame: 45 },
    ],
  },
]

async function main(): Promise<void> {
  assertFixtureRoot()
  await mkdir(materialsDirectory, { recursive: true })
  await mkdir(packageDirectory, { recursive: true })
  await cleanFixtureOutputs()

  await writeFixtureImages()
  const document = await buildFixtureDocument()
  const packageBuild = buildCspImportPackage(document, { appVersion: 'fixture-v3-cut-group' })
  const errors = packageBuild.issues.filter(issue => issue.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`fixture package has validation errors:\n${errors.map(issue => issue.message).join('\n')}`)
  }
  if (path.resolve(packageBuild.assetRootPath ?? '') !== fixtureRoot) {
    throw new Error(`unexpected asset root: ${packageBuild.assetRootPath ?? '(none)'}`)
  }

  await writeFile(
    path.join(packageDirectory, packageBuild.manifestFileName),
    `${JSON.stringify(packageBuild.manifest, null, 2)}\n`,
    'utf-8',
  )
  if (packageBuild.setupOutput) {
    await writeFile(path.join(packageDirectory, packageBuild.setupOutput.xdtsFileName), exportXdts(packageBuild.setupOutput.exportPlan), 'utf-8')
  }
  for (const output of packageBuild.cutOutputs) {
    await writeFile(path.join(packageDirectory, output.xdtsFileName), exportXdts(output.exportPlan), 'utf-8')
  }
  await writeReadme()
  await verifyWrittenFixture(packageBuild.manifestFileName)
  console.log(`generated ${path.relative(repoRoot, fixtureRoot).replace(/\\/g, '/')}`)
}

function assertFixtureRoot(): void {
  const relative = path.relative(fixturesRoot, fixtureRoot)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing to write outside fixtures root: ${fixtureRoot}`)
  }
}

async function writeFixtureImages(): Promise<void> {
  for (const asset of fixtureAssets) {
    await writeFile(path.join(fixtureRoot, asset.relativePath), makePng(96, 72, asset.color))
  }
}

async function buildFixtureDocument(): Promise<CutGroupProjectDocument> {
  const rootCut = fixtureCuts[0]
  if (!rootCut) throw new Error('fixture requires at least one cut')

  let project = createDefaultProject()
  project = updateProjectPaperTracks(project, ['A', 'B', 'C', 'D', 'E'])
  project = {
    ...project,
    projectId: 'fixture_csp_import_v3_cut_group',
    cut: cutMetadata(rootCut),
  }
  project = updateLogicalSheetSettings(project, { durationFrames: rootCut.durationFrames })

  const registeredRoot = registerAssetRoot(project, {
    label: 'cut-folder',
    path: fixtureRoot,
    handleKind: 'directory',
  })
  project = registeredRoot.project

  const assetIdByCellName = new Map<string, string>()
  const assetByCellName = new Map<string, FixtureAsset>()
  for (const asset of fixtureAssets) {
    const absolutePath = path.join(fixtureRoot, asset.relativePath)
    const fileStat = await stat(absolutePath)
    const registered = registerAsset(project, {
      name: path.basename(asset.relativePath),
      path: absolutePath,
      relativePath: asset.relativePath,
      size: fileStat.size,
      lastModified: Date.UTC(2026, 0, 1),
    }, {
      role: 'cell-material',
      rootId: registeredRoot.root.rootId,
      relativePath: asset.relativePath,
    })
    project = registered.project
    assetIdByCellName.set(asset.cspCellName, registered.asset.assetId)
    assetByCellName.set(asset.cspCellName, asset)
  }

  const keyIdByCellName = new Map<string, string>()
  for (const event of rootCut.events) {
    const keyed = createTimedEventWithBinding(project, event, assetIdByCellName, assetByCellName, keyIdByCellName)
    project = keyed.project
  }

  let document = createProjectDocumentFromCutProject(project)
  for (const cut of fixtureCuts.slice(1)) {
    document = addTimedCut(document, cut, assetIdByCellName, assetByCellName, keyIdByCellName)
  }
  return document
}

function addTimedCut(
  documentInput: CutGroupProjectDocument,
  cut: FixtureCut,
  assetIdByCellName: Map<string, string>,
  assetByCellName: Map<string, FixtureAsset>,
  keyIdByCellName: Map<string, string>,
): CutGroupProjectDocument {
  const previousActiveProject = activeCutProjectFromDocument(documentInput)
  let document = addBlankSharedCutToProjectDocument(documentInput, previousActiveProject, { cut: cutMetadata(cut) })
  let project = activeCutProjectFromDocument(document)
  project = updateLogicalSheetSettings(project, { durationFrames: cut.durationFrames })
  for (const event of cut.events) {
    const keyId = keyIdByCellName.get(event.key)
    if (keyId) {
      project = setEvent(project, event.paperTrack, event.frame, keyId, 'action')
      continue
    }
    const keyed = createTimedEventWithBinding(project, event, assetIdByCellName, assetByCellName, keyIdByCellName)
    project = keyed.project
  }
  document = updateActiveCutProjectInDocument(document, project)
  return document
}

function createTimedEventWithBinding(
  projectInput: CutProject,
  event: FixtureEvent,
  assetIdByCellName: Map<string, string>,
  assetByCellName: Map<string, FixtureAsset>,
  keyIdByCellName: Map<string, string>,
): { project: CutProject } {
  const assetId = assetIdByCellName.get(event.key)
  if (!assetId) throw new Error(`registered asset not found: ${event.key}`)
  const asset = assetByCellName.get(event.key)
  if (!asset) throw new Error(`fixture asset not found: ${event.key}`)
  const created = createOrSetEvent(projectInput, event.paperTrack, event.frame, 'action')
  const slotId = slotIdFor(created.project, event.paperTrack, asset.correctionLayerId)
  const project = upsertBinding(created.project, {
    slotId,
    keyId: created.key.keyId,
    cspCellName: event.key,
    materialState: 'assigned',
    assetId,
  })
  keyIdByCellName.set(event.key, created.key.keyId)
  return { project }
}

function cutMetadata(cut: Pick<FixtureCut, 'cut' | 'timelineName'>): CutMetadata {
  return {
    title: 'CSP Import Fixture',
    episode: '101',
    cut: cut.cut,
    cspTimelineName: cut.timelineName,
  }
}

async function cleanFixtureOutputs(): Promise<void> {
  await rm(path.join(fixtureRoot, 'README.md'), { force: true })
  await rm(path.join(packageDirectory, 'csp-import.xci'), { force: true })
  await rm(path.join(packageDirectory, 'csp-import-manifest.json'), { force: true })
  await rm(path.join(packageDirectory, 'csp-import-job-log.json'), { force: true })
  await rm(path.join(packageDirectory, '_setup.xdts'), { force: true })
  for (const cut of fixtureCuts) {
    await rm(path.join(packageDirectory, `${cut.cut}.xdts`), { force: true })
    await rm(path.join(packageDirectory, `${cut.timelineName}.xdts`), { force: true })
  }
}

function slotIdFor(project: CutProject, paperTrack: FixturePaperTrack, correctionLayerId: FixtureCorrectionLayerId): string {
  const slot = project.cspTrackSlots.find(item => item.paperTrack === paperTrack && item.correctionLayerId === correctionLayerId)
  if (!slot) throw new Error(`slot not found: ${correctionLayerId}/${paperTrack}`)
  return slot.slotId
}

async function verifyWrittenFixture(manifestFileName: string): Promise<void> {
  const manifestPath = path.join(packageDirectory, manifestFileName)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as {
    schemaVersion?: number
    assetRoot?: string
    setup?: { xdts: string; purpose: string }
    cuts?: Array<{
      cutNumber: string
      timelineName: string
      durationFrames: number
      files: { xdts: string }
      tracks: Array<{ cels?: Array<{ cspCellName: string; assetPath: string }> }>
    }>
  }
  if (manifest.schemaVersion !== 3) throw new Error(`unexpected schemaVersion: ${manifest.schemaVersion ?? '(none)'}`)
  if (manifest.assetRoot !== '..') throw new Error(`unexpected assetRoot: ${manifest.assetRoot ?? '(none)'}`)
  const setup = manifest.setup
  if (!setup || setup.xdts !== '_setup.xdts') throw new Error(`unexpected setup xdts: ${setup?.xdts ?? '(none)'}`)
  if (!manifest.cuts || manifest.cuts.length !== fixtureCuts.length) {
    throw new Error(`unexpected cut count: ${manifest.cuts?.length ?? 0}`)
  }
  const setupXdts = parseXdts(await readFile(path.join(packageDirectory, setup.xdts), 'utf-8'))
  const setupTrackNames = setupXdts.tracks.map(track => track.name)
  const expectedSetupTrackNames = [
    '===== XSHEET IMPORT START =====',
    '===== 作画 =====',
    'A',
    'B',
    'C',
    'D',
    'E',
    '===== 演出 =====',
    'A',
    'D',
    'E',
    '===== 作監 =====',
    'A',
    'B',
    'C',
    '===== XSHEET IMPORT END =====',
  ]
  if (JSON.stringify(setupTrackNames) !== JSON.stringify(expectedSetupTrackNames)) {
    throw new Error(`unexpected setup XDTS track order:\n${setupTrackNames.join('\n')}`)
  }

  for (const expectedCut of fixtureCuts) {
    const manifestCut = manifest.cuts.find(cut => cut.cutNumber === expectedCut.cut)
    if (!manifestCut) throw new Error(`manifest cut not found: ${expectedCut.cut}`)
    if (manifestCut.timelineName !== expectedCut.timelineName) {
      throw new Error(`unexpected timelineName for ${expectedCut.cut}: ${manifestCut.timelineName}`)
    }
    if (manifestCut.durationFrames !== expectedCut.durationFrames) {
      throw new Error(`unexpected duration for ${expectedCut.cut}: ${manifestCut.durationFrames}`)
    }
    const xdtsPath = path.join(packageDirectory, manifestCut.files.xdts)
    const parsedXdts = parseXdts(await readFile(xdtsPath, 'utf-8'))
    if (parsedXdts.duration !== expectedCut.durationFrames) {
      throw new Error(`unexpected XDTS duration for ${expectedCut.cut}: ${parsedXdts.duration}`)
    }
    for (const track of manifestCut.tracks) {
      for (const cel of track.cels ?? []) {
        const assetPath = path.resolve(packageDirectory, manifest.assetRoot, cel.assetPath)
        await stat(assetPath)
        if (path.parse(assetPath).name !== cel.cspCellName) {
          throw new Error(`asset stem mismatch for ${expectedCut.cut}: ${cel.cspCellName} / ${assetPath}`)
        }
      }
    }
  }
}

async function writeReadme(): Promise<void> {
  await writeFile(
    path.join(fixtureRoot, 'README.md'),
    `# CSP import v3 cut-group fixture

Generated test data for updating the CSP import helper from the legacy
single-cut manifest shape to the current main-app schema v3 shape.

Regenerate from the repository root:

\`\`\`powershell
npx tsx tools/fixtures/generate-csp-import-v3-cut-group.ts
\`\`\`

Layout:

\`\`\`text
csp-import-v3-cut-group/
  materials/
    A_01.png
    A_02.png
    A_03_e.png
    A_04_s.png
    B_01.png
    B_02.png
    B_03_s.png
    C_01.png
    C_02_s.png
    D_01.png
    D_02_e.png
    E_01.png
    E_02_e.png
  xsheet-csp-import/
    csp-import.xci
    _setup.xdts
    C101A.xdts
    C101B.xdts
    C101C.xdts
\`\`\`

The three cuts share A/B cels, each cut contains one cut-local作画 column, and
the same paper track names are also used in 演出 and 作監 process folders. This
keeps the fixture representative of shared-cut projects where later timelines
introduce folders that are not present in the first XDTS:

| cut | 作画 local | 演出 | 作監 |
| --- | --- | --- | --- |
| C101A | C_01 | A_03_e | C_02_s |
| C101B | D_01 | A_03_e / D_02_e | B_03_s |
| C101C | E_01 | E_02_e | A_04_s / B_03_s |

Each cut has its own CSP timeline name and duration. The cut number keeps its
\`C\` prefix, while \`timelineName\` is the explicit CSP timeline setting value:

| cut | timelineName | duration |
| --- | --- | ---: |
| C101A | 101A | 24f |
| C101B | 101B | 36f |
| C101C | 101C | 48f |

The manifest is schemaVersion 3 and is intended to exercise the helper's
multi-cut XDTS import and cross-cut asset de-duplication path.
The setup XDTS contains the union animation-folder stack for 作画, 演出, and
作監. It deliberately repeats animation-folder names such as A under multiple
process separators so the helper has to resolve duplicate XDTS track names by
manifest process context.
`,
    'utf-8',
  )
}

function makePng(width: number, height: number, color: Rgba): Buffer {
  const bytesPerPixel = 4
  const rowStride = 1 + width * bytesPerPixel
  const raw = Buffer.alloc(rowStride * height)
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowStride
    raw[rowOffset] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * bytesPerPixel
      const shade = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0 ? 0 : -34
      raw[offset] = clampByte(color[0] + shade)
      raw[offset + 1] = clampByte(color[1] + shade)
      raw[offset + 2] = clampByte(color[2] + shade)
      raw[offset + 3] = color[3]
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([length, typeBytes, data, crc])
}

const crcTable = new Uint32Array(256)
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  crcTable[index] = value >>> 0
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value))
}

await main()
