import { browserProjects, checks } from './plan.mjs'

export const defaultBrowserWorkers = 2

// Do not let a misspelled filter silently turn a focused run into full acceptance.
export function parseOptions(argv) {
  const args = [...argv]
  const phase = args[0] && !args[0].startsWith('--') ? args.shift() : 'local'
  if (![...Object.keys(checks), 'local', 'browser', 'browser-ci', 'plan'].includes(phase)) throw new Error(`Unknown verification phase: ${phase}`)
  const allowed = new Set(phase === 'plan' ? ['base', 'release']
    : phase === 'browser' ? ['reuse', 'list', 'workers', 'project', 'suite', 'grep', 'file']
      : phase === 'browser-ci' ? ['reuse', 'list']
        : phase === 'local' ? ['reuse', 'workers'] : ['reuse'])
  const options = { phase, reuse: false, list: false, release: false, base: null, project: null, suite: 'all', grep: null, files: [], workers: defaultBrowserWorkers }
  const seen = new Set()
  while (args.length) {
    const arg = args.shift()
    const match = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(arg)
    if (!match || !allowed.has(match[1])) throw new Error(`Unsupported argument for ${phase}: ${arg}`)
    const [, name, inline] = match
    if (seen.has(name) && name !== 'file') throw new Error(`Duplicate option: --${name}`)
    seen.add(name)
    if (['reuse', 'list', 'release'].includes(name)) {
      if (inline !== undefined) throw new Error(`--${name} does not take a value`)
      options[name] = true
      continue
    }
    const value = inline ?? (args[0] && !args[0].startsWith('--') ? args.shift() : undefined)
    if (value === undefined || value === '' && name !== 'base') throw new Error(`Missing value for --${name}`)
    if (name === 'file') {
      if (!/^[a-zA-Z0-9_-]+\.spec\.ts$/.test(value)) throw new Error('--file must be an exact browser spec basename, e.g. editing.spec.ts')
      options.files.push(value)
    } else options[name] = value
  }
  if (options.project && !browserProjects.includes(options.project)) throw new Error(`Unknown browser project: ${options.project}`)
  if (!['all', 'functional', 'isolated'].includes(options.suite)) throw new Error(`Unknown browser suite: ${options.suite}`)
  if (!/^[1-9]\d*$/.test(String(options.workers)) || !Number.isSafeInteger(Number(options.workers))) throw new Error('--workers must be a positive integer')
  options.workers = Number(options.workers)
  if (options.grep !== null) new RegExp(options.grep)
  options.files = [...new Set(options.files)].sort()
  return options
}
