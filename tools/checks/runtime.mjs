import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const runtimeRanges = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).engines

function versionParts(version) {
  if (typeof version !== 'string' || !/^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Expected a stable major.minor.patch version, got ${JSON.stringify(version)}`)
  }
  const parts = version.replace(/^v/, '').split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) throw new Error('Runtime version exceeds the supported integer range')
  return parts
}

// Deliberately support only the bounded-major ranges used by engines. This must
// work before npm ci, so it cannot import semver from the dependency installation.
export function supportsVersion(version, range) {
  const current = versionParts(version)
  if (typeof range !== 'string') throw new Error('Missing runtime support range')
  const intervals = range.split('||').map(clause => {
    const match = /^>=(\d+\.\d+\.\d+) <([1-9]\d*)$/.exec(clause.trim())
    if (!match) throw new Error(`Unsupported runtime range syntax: ${range}`)
    const minimum = versionParts(match[1])
    if (Number(match[2]) !== minimum[0] + 1) throw new Error(`Each runtime range must cover one major: ${range}`)
    return minimum
  })
  return intervals.some(minimum => current[0] === minimum[0]
    && (current[1] > minimum[1] || current[1] === minimum[1] && current[2] >= minimum[2]))
}

export function runtimeIdentity({ npmVersion } = {}) {
  if (npmVersion === undefined && process.env.npm_execpath) {
    const packageFile = path.resolve(path.dirname(process.env.npm_execpath), '../package.json')
    const npmPackage = JSON.parse(readFileSync(packageFile, 'utf8'))
    if (npmPackage.name !== 'npm') throw new Error('The active package manager is not npm')
    npmVersion = npmPackage.version
  }
  return {
    node: process.version,
    npm: npmVersion ?? null,
    platform: process.platform,
    arch: process.arch,
    nodeOptions: process.env.NODE_OPTIONS ?? '',
    nodeExecArgv: process.execArgv,
  }
}

export function assertSupportedRuntime(identity, ranges = runtimeRanges) {
  if (!identity.npm) throw new Error('Cannot identify the active npm. Run this command through npm run, using Node and its bundled npm.')
  for (const name of ['node', 'npm']) {
    if (!supportsVersion(identity[name], ranges[name])) {
      throw new Error(`Unsupported ${name} ${identity[name]}; supported: ${ranges[name]}. Use an updated supported Node installation and its bundled npm.`)
    }
  }
  return identity
}

function main(args) {
  let npmVersion
  let json = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--json' && !json) json = true
    else if (args[index] === '--npm-version' && npmVersion === undefined && args[index + 1]) npmVersion = args[++index]
    else throw new Error(`Unknown, duplicate or incomplete runtime option: ${args[index]}`)
  }
  const identity = assertSupportedRuntime(runtimeIdentity({ npmVersion }))
  console.log(json ? JSON.stringify(identity) : `[runtime] Node ${identity.node} / npm ${identity.npm}; supported Node ${runtimeRanges.node}, npm ${runtimeRanges.npm}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) }
  catch (error) { console.error(`[runtime] ${error.message}`); process.exitCode = 1 }
}
