import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { withoutGeneratedVersion } from '../verification/plan.mjs'

const hash = text => crypto.createHash('sha256').update(text).digest('hex')
const normalize = text => text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').trim() + '\n'
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const roots = ['', 'apps/web', 'packages/ui', 'packages/adapters', 'packages/core', 'packages/xdts']
const nativeInputs = ['apps/desktop/src-tauri/Cargo.toml', 'apps/desktop/src-tauri/Cargo.lock',
  'apps/sheet-corrector/src-tauri/Cargo.toml', 'apps/sheet-corrector/src-tauri/Cargo.lock', 'native/desktop-runtime/Cargo.toml']

export function runtimeNpmPackages(lock) {
  const visited = new Set()
  function visit(key) {
    if (visited.has(key)) return
    const entry = lock.packages[key]
    if (!entry) throw new Error(`Missing runtime package: ${key}`)
    visited.add(key)
    if (entry.link) { visit(entry.resolved); return }
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
      let directory = key, resolved
      while (true) {
        const candidate = `${directory ? `${directory}/` : ''}node_modules/${name}`
        if (lock.packages[candidate]) { resolved = candidate; break }
        if (!directory) break
        directory = path.posix.dirname(directory)
        if (directory === '.') directory = ''
      }
      if (!resolved) throw new Error(`Unresolved runtime dependency ${name} from ${key}`)
      visit(resolved)
    }
  }
  roots.forEach(visit)
  return [...visited].filter(key => key.startsWith('node_modules/') && !lock.packages[key].link)
    .sort().map(key => ({ path: key, version: lock.packages[key].version, integrity: lock.packages[key].integrity ?? '', license: lock.packages[key].license ?? '' }))
}

function inputIdentity(root, supplemental, npmPackages) {
  const inputs = Object.fromEntries(nativeInputs.map(file => [file, hash(normalize(withoutGeneratedVersion(file, fs.readFileSync(path.join(root, file), 'utf8'))))]))
  for (const file of ['licenses/supplemental.json', ...Object.keys(supplemental.sources).map(name => `licenses/upstream/${name}`),
    ...supplemental.assets.flatMap(asset => asset.bundledPath ? [asset.bundledPath] : [])]) {
    const bytes = fs.readFileSync(path.join(root, file))
    inputs[file] = hash(/\.(?:txt|json)$/.test(file) ? normalize(bytes.toString('utf8')) : bytes)
  }
  inputs.npm = hash(JSON.stringify(npmPackages))
  return inputs
}

function sourceUrl(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url
  if (!raw) return ''
  const url = raw.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '')
  return url.startsWith('https://') ? url : ''
}

function licenseFiles(directory) {
  const result = []
  function collect(relative) {
    const file = path.join(directory, relative), stat = fs.statSync(file)
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) collect(path.join(relative, name))
    else if (stat.isFile() && !/\.(?:spdx|json)$/i.test(relative)) result.push(relative)
  }
  for (const name of fs.readdirSync(directory).sort()) {
    if (/^(?:licen[sc]e|copying|notice|copyright)(?:[-_.]|$)/i.test(name)) collect(name)
  }
  return result
}

export function generateLicenseCatalog(root, metadata) {
  const supplemental = readJson(path.join(root, 'licenses/supplemental.json'))
  const npmPackages = runtimeNpmPackages(readJson(path.join(root, 'package-lock.json')))
  const texts = {}, components = [], usedSupplemental = new Set()
  function addText(text) {
    const normalized = normalize(text), id = hash(normalized)
    if (!normalized.trim()) throw new Error('Empty license text')
    texts[id] = normalized
    return id
  }
  function extraTexts(id) {
    const files = supplemental.packages[id] ?? []
    if (files.length) usedSupplemental.add(id)
    return files.map(file => addText(fs.readFileSync(path.join(root, 'licenses/upstream', file), 'utf8')))
  }
  for (const item of npmPackages) {
    const directory = path.join(root, item.path), pkg = readJson(path.join(directory, 'package.json'))
    if (pkg.version !== item.version) throw new Error(`Installed ${pkg.name} differs from lockfile`)
    if (/^(?:@types\/|@webgpu\/types$|undici-types$)/.test(pkg.name)) continue
    const id = `npm:${pkg.name}@${pkg.version}`
    const files = licenseFiles(directory)
    if (pkg.name === 'celcodec') files.push('THIRD_PARTY_NOTICES.md')
    const textIds = [...new Set([...files.map(file => addText(fs.readFileSync(path.join(directory, file), 'utf8'))), ...extraTexts(id)])]
    if (!textIds.length) throw new Error(`No license text for ${id}`)
    components.push({ id, group: pkg.name === '@fontsource/line-seed-jp' ? 'assets' : 'web', name: pkg.name, version: pkg.version, license: item.license,
      source: sourceUrl(pkg.repository), textIds })
  }
  const packages = new Map(metadata.flatMap(meta => meta.packages.filter(pkg => pkg.source).map(pkg => [pkg.id, pkg])))
  for (const pkg of [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))) {
    const directory = path.dirname(pkg.manifest_path), id = `cargo:${pkg.name}@${pkg.version}`
    const files = licenseFiles(directory)
    if (pkg.license_file && !files.includes(pkg.license_file)) files.push(pkg.license_file)
    const textIds = [...new Set([...files.map(file => addText(fs.readFileSync(path.resolve(directory, file), 'utf8'))), ...extraTexts(id)])]
    if (!textIds.length) throw new Error(`No license text for ${id}`)
    components.push({ id, group: 'windows', name: pkg.name, version: pkg.version, license: pkg.license,
      source: `https://crates.io/crates/${pkg.name}/${pkg.version}`, textIds })
  }
  for (const asset of supplemental.assets) {
    const { files, ...component } = asset
    delete component.bundledPath
    components.push({ ...component, id: `asset:${asset.name}`, group: 'assets', textIds: files.map(file => addText(fs.readFileSync(path.join(root, 'licenses/upstream', file), 'utf8'))) })
  }
  for (const id of Object.keys(supplemental.packages)) if (!usedSupplemental.has(id)) throw new Error(`Stale supplemental license entry: ${id}`)
  return { schemaVersion: 1, inputs: inputIdentity(root, supplemental, npmPackages),
    nativePackages: components.filter(component => component.group === 'windows').map(component => component.id), components, texts }
}

export function checkLicenseCatalog(root, catalog = readJson(path.join(root, 'licenses/catalog.json'))) {
  const supplemental = readJson(path.join(root, 'licenses/supplemental.json'))
  const packages = runtimeNpmPackages(readJson(path.join(root, 'package-lock.json')))
  const expected = inputIdentity(root, supplemental, packages)
  if (catalog.schemaVersion !== 1 || JSON.stringify(catalog.inputs) !== JSON.stringify(expected)) {
    throw new Error('License catalog is stale; review dependencies and run node tools/checks/license-notices.mjs --update')
  }
  const ids = new Set(), referenced = new Set()
  for (const component of catalog.components) {
    if (!component.id || ids.has(component.id) || !component.name || !component.version || !component.license || !component.textIds?.length) throw new Error('Invalid or duplicate license component')
    ids.add(component.id)
    for (const id of component.textIds) {
      const text = catalog.texts[id]
      if (!text?.trim() || hash(text) !== id) throw new Error(`Missing or modified license text: ${component.id}`)
      referenced.add(id)
    }
    if (!component.textIds.some(id => catalog.texts[id].length >= 80)) throw new Error(`Incomplete license text: ${component.id}`)
  }
  for (const id of Object.keys(catalog.texts)) if (!referenced.has(id)) throw new Error('Unreferenced license text')
  const nativeIds = catalog.components.filter(component => component.group === 'windows').map(component => component.id)
  if (JSON.stringify(nativeIds) !== JSON.stringify(catalog.nativePackages)) throw new Error('Native license inventory is incomplete')
  for (const [id, files] of Object.entries(supplemental.packages)) {
    const component = catalog.components.find(value => value.id === id)
    for (const file of files) if (!component?.textIds.includes(hash(normalize(fs.readFileSync(path.join(root, 'licenses/upstream', file), 'utf8'))))) throw new Error(`Missing supplemental notice: ${id}`)
  }
  for (const asset of supplemental.assets) {
    const component = catalog.components.find(value => value.id === `asset:${asset.name}`)
    if (!component || component.version !== asset.version || component.source !== asset.source || JSON.stringify(component.links) !== JSON.stringify(asset.links)) throw new Error(`Missing asset notice: ${asset.name}`)
    for (const file of asset.files) if (!component.textIds.includes(hash(normalize(fs.readFileSync(path.join(root, 'licenses/upstream', file), 'utf8'))))) throw new Error(`Missing asset license: ${asset.name}`)
  }
  // Check installed npm notices independently. Cargo source caches are not needed
  // in CI: their reviewed snapshot is pinned to both native lockfiles/manifests.
  for (const item of packages) {
    const directory = path.join(root, item.path), pkg = readJson(path.join(directory, 'package.json'))
    if (/^(?:@types\/|@webgpu\/types$|undici-types$)/.test(pkg.name)) continue
    const component = catalog.components.find(value => value.id === `npm:${pkg.name}@${item.version}`)
    if (!component || pkg.version !== item.version) throw new Error(`Missing runtime license: ${pkg.name}`)
    const files = licenseFiles(directory)
    if (pkg.name === 'celcodec') files.push('THIRD_PARTY_NOTICES.md')
    for (const file of files) if (!component.textIds.includes(hash(normalize(fs.readFileSync(path.join(directory, file), 'utf8'))))) throw new Error(`Outdated npm notice: ${pkg.name}/${file}`)
  }
  return { components: catalog.components.length, texts: Object.keys(catalog.texts).length }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 1 || args[0] !== '--update')) throw new Error('Expected --update or no arguments')
  if (args[0] === '--update') {
    const metadata = ['apps/desktop/src-tauri/Cargo.toml', 'apps/sheet-corrector/src-tauri/Cargo.toml'].map(manifest => JSON.parse(execFileSync('cargo',
      ['metadata', '--manifest-path', manifest, '--locked', '--offline', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })))
    const catalog = generateLicenseCatalog(root, metadata)
    fs.writeFileSync(path.join(root, 'licenses/catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`)
  }
  console.log('[licenses] passed:', checkLicenseCatalog(root))
}
