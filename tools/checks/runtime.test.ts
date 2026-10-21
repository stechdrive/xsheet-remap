import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertSupportedRuntime, runtimeIdentity, runtimeRanges, supportsVersion } from './runtime.mjs'

describe('supported Node and npm runtimes', () => {
  it.each(['24.22.1', '24.22.2', '24.23.0', 'v26.12.1', '26.12.2', '26.13.0'])('accepts maintained Node updates: %s', version => {
    expect(supportsVersion(version, runtimeRanges.node)).toBe(true)
  })
  it.each(['22.23.4', '24.22.0', '25.9.0', '26.12.0', '27.0.0', '28.0.0'])('rejects old or unqualified Node releases: %s', version => {
    expect(supportsVersion(version, runtimeRanges.node)).toBe(false)
  })
  it.each(['11.19.1', '11.19.2', '11.20.0', '11.21.1'])('accepts npm updates: %s', version => {
    expect(supportsVersion(version, runtimeRanges.npm)).toBe(true)
  })
  it.each(['10.9.0', '11.7.0', '11.19.0', '12.0.0'])('rejects npm outside the supported major and minimum: %s', version => {
    expect(() => assertSupportedRuntime({ node: 'v26.12.1', npm: version })).toThrow('Unsupported npm')
  })
  it.each(['26', '26.12', '26.12.1-rc.1', '26.12.1+custom', '026.12.1', '', 'NaN.1.2'])('rejects incomplete or nonstandard runtime identity: %s', version => {
    expect(() => supportsVersion(version, runtimeRanges.node)).toThrow('stable major.minor.patch')
  })
  it.each(['>=24.22.1', '>=24.22.1 <27', '*', '^26.12.1', '>=26.12.1 <27 ||'])('fails closed on unsupported policy syntax: %s', range => {
    expect(() => supportsVersion('26.12.1', range)).toThrow('runtime range')
  })
  it('keeps npm install metadata and the CI example inside the support policy', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    expect(lock.packages[''].engines).toEqual(runtimeRanges)
    expect(supportsVersion(readFileSync('.node-version', 'utf8').trim(), runtimeRanges.node)).toBe(true)
  })
  it('identifies the npm actually running the test, without requiring a dedicated runtime', () => {
    const identity = runtimeIdentity()
    const actualNpm = execFileSync(process.execPath, [process.env.npm_execpath!, '--version'], { encoding: 'utf8' }).trim()
    expect(identity.npm).toBe(actualNpm)
    expect(identity.node).toBe(process.version)
    expect(assertSupportedRuntime(identity)).toBe(identity)
    expect(() => assertSupportedRuntime({ node: process.version, npm: null })).toThrow('Cannot identify')
  })
  it('checks the pre-install CLI with an explicit npm version and rejects invalid input', () => {
    const cli = path.resolve('tools/checks/runtime.mjs')
    const accepted = spawnSync(process.execPath, [cli, '--npm-version', '11.20.0', '--json'], { encoding: 'utf8' })
    expect(accepted.status, accepted.stderr).toBe(0)
    expect(JSON.parse(accepted.stdout)).toMatchObject({ node: process.version, npm: '11.20.0' })
    for (const args of [['--npm-version', '11.7.0'], ['--npm-version'], ['--unknown'], ['--json', '--json']]) {
      const rejected = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
      expect(rejected.status).toBe(1)
    }
  })
})
