import { describe, expect, it } from 'vitest'
import { browserFilters, assertSameCases, browserCases, validateBrowserResults } from './browser.mjs'
import { parseOptions } from './options.mjs'
import { reusableEvidence } from './evidence.mjs'
import { pagesTestPort } from '../e2e/canvaskit/pages-server.mjs'

describe('browser selection and isolated execution', () => {
  it('allows an isolated candidate port and rejects invalid server endpoints', () => {
    expect(pagesTestPort('5187')).toBe(5187)
    for (const port of ['', '0', '80', '65536', '5187.5', 'localhost', '5187/path']) expect(() => pagesTestPort(port)).toThrow('XSHEET_BROWSER_PORT')
  })
  it('accepts explicit filters but refuses unknown, duplicate and ambiguous arguments', () => {
    expect(parseOptions(['browser', '--project=webkit-touch', '--workers', '2', '--grep=save|open', '--file=pwa.spec.ts', '--suite=functional', '--list']))
      .toMatchObject({ project: 'webkit-touch', workers: 2, grep: 'save|open', files: ['pwa.spec.ts'], suite: 'functional', list: true })
    for (const args of [
      ['browser', '--grepp=save'], ['browser', '--workers=0'], ['browser', '--workers=50%'], ['browser', '--workers=1.5'],
      ['browser', '--workers'], ['browser', '--workers=2', '--workers=4'], ['browser', '--project=safari'],
      ['browser', '--grep=['], ['browser', '--file=../pwa.spec.ts'], ['browser', '--suite=fast'], ['browser', '--reuse=false'],
      ['local', '--project=chromium'], ['local', '--suite=functional'], ['local', '--grep=save'],
      ['browser-ci', '--workers=2'], ['browser-ci', '--grep=save'], ['check', '--project=chromium'],
    ]) expect(() => parseOptions(args), args.join(' ')).toThrow()
    expect(parseOptions(['local', '--workers=1', '--reuse'])).toMatchObject({ workers: 1, reuse: true })
    expect(parseOptions(['plan', '--base=', '--release'])).toMatchObject({ base: '', release: true })
  })

  it('intersects user grep with the isolated lane and keeps touch exclusion in both lanes', () => {
    const matches = (project: string, suite: string, pattern: string | null, title: string) => {
      const filters = browserFilters(project, suite, pattern)
      return filters.grep.test(title) && !filters.grepInvert.some((regex: RegExp) => regex.test(title))
    }
    for (const project of ['chromium', 'webkit', 'chromium-touch', 'webkit-touch']) {
      const titles = ['save', 'open @isolated', 'save @isolated', 'save @touch', 'save @touch @isolated']
      const all = titles.filter(title => matches(project, 'all', 'save', title))
      const functional = titles.filter(title => matches(project, 'functional', 'save', title))
      const isolated = titles.filter(title => matches(project, 'isolated', 'save', title))
      expect(new Set([...functional, ...isolated])).toEqual(new Set(all))
      expect(functional.filter(title => isolated.includes(title))).toEqual([])
      expect(isolated.every(title => title.includes('@isolated') && title.includes('save'))).toBe(true)
    }
    expect(matches('webkit', 'isolated', '^webkit.*save$', 'webkit @isolated save')).toBe(true)
    expect(matches('webkit', 'isolated', '^webkit.*save$', 'other @isolated save')).toBe(false)
  })

  it('detects a missing or duplicated case when partitioning the full inventory', () => {
    expect(() => assertSameCases(['a', 'b'], ['b', 'a'])).not.toThrow()
    expect(() => assertSameCases(['a', 'b'], ['a'])).toThrow('missing 1')
    expect(() => assertSameCases(['a', 'b'], ['a', 'b', 'c'])).toThrow('extra 1')
    expect(() => assertSameCases(['a', 'b'], ['a', 'a'])).toThrow('Duplicate')
  })

  const report = () => ({ config: { workers: 2, metadata: { actualWorkers: 2 }, fullyParallel: false, shard: null, forbidOnly: true,
    projects: [{ retries: 0, repeatEach: 1 }] }, errors: [], stats: { duration: 123 },
    suites: [{ title: 'editing.spec.ts', specs: [{ title: 'Undo restores cells', file: 'editing.spec.ts', tags: [],
      tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0 }] }] }] }] })
  it('rejects skipped, failed, flaky, timed out or differently configured results', () => {
    const passed = report(), inventory = browserCases(passed).map(item => item.id)
    expect(validateBrowserResults(passed, inventory, 2)).toMatchObject({ passed: 1, failed: 0, retries: 0 })
    for (const status of ['failed', 'timedOut', 'skipped', 'interrupted']) {
      const changed = report(); changed.suites[0].specs[0].tests[0].results[0].status = status
      expect(() => validateBrowserResults(changed, inventory, 2)).toThrow('failed, skipped or retried')
    }
    const retried = report(); retried.suites[0].specs[0].tests[0].results[0].retry = 1
    expect(() => validateBrowserResults(retried, inventory, 2)).toThrow('retried')
    expect(() => validateBrowserResults(passed, inventory, 1)).toThrow('worker configuration')
    expect(() => validateBrowserResults(passed, [...inventory, 'missing'], 2)).toThrow('inventory differs')
    expect(() => validateBrowserResults({ ...passed, errors: ['server failure'] }, inventory, 2)).toThrow('global errors')
    for (const config of [{ ...passed.config, fullyParallel: true }, { ...passed.config, forbidOnly: false },
      { ...passed.config, shard: { current: 1, total: 2 } }, { ...passed.config, projects: [{ retries: 1, repeatEach: 1 }] },
      { ...passed.config, projects: [{ retries: 0, repeatEach: 2 }] }]) {
      expect(() => validateBrowserResults({ ...passed, config }, inventory, 2)).toThrow('no retries, repeats or shards')
    }
  })

  it('never reuses subset, old, worker-mismatched or inventory-mismatched browser evidence as full acceptance', () => {
    const identity = { sourceSha256: 'source', node: 'v24', playwright: '1.63', browserRevisions: 'revision' }
    const execution = { suite: 'all', workers: 2, projects: ['chromium', 'webkit', 'chromium-touch', 'webkit-touch'], grep: null, inventorySha256: 'full' }
    const evidence = { schemaVersion: 1, phase: 'browser', status: 'passed', identity, artifactSha256: 'artifact', execution }
    expect(reusableEvidence(evidence, identity, 'browser', 'artifact', execution)).toBe(true)
    for (const different of [undefined, { ...execution, workers: 1 }, { ...execution, suite: 'functional' },
      { ...execution, projects: ['chromium'] }, { ...execution, grep: 'Undo' }, { ...execution, inventorySha256: 'partial' }]) {
      expect(reusableEvidence({ ...evidence, execution: different }, identity, 'browser', 'artifact', execution)).toBe(false)
    }
    expect(reusableEvidence(evidence, { ...identity, browserRevisions: 'new' }, 'browser', 'artifact', execution)).toBe(false)
  })
})
