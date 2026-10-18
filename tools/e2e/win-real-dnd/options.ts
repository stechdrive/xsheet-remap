// Native input must never start after a typo silently selects another scenario.
const names = new Set(['port', 'result', 'report', 'python', 'app-pid', 'test-case', 'scenario-id',
  'screenshot-root', 'folder', 'allowed-root', 'multi-folder', 'direct-file', 'mode'])

export function parseNativeDropOptions(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index], key = token.slice(2), value = argv[index + 1]
    if (!token.startsWith('--') || !names.has(key)) throw new Error(`Unknown native drop argument: ${token}`)
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate native drop argument: ${token}`)
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`)
    values[key] = value
  }
  if (values.mode && !['remap', 'editor'].includes(values.mode)) throw new Error(`Unsupported native drop mode: ${values.mode}`)
  return values
}

/** Remap's EXE contains both entries; selecting a scenario must also select its UI. */
export function nativeDropAppUrl(currentUrl: string, mode: string): string {
  if (!['remap', 'editor'].includes(mode)) throw new Error(`Unsupported native drop mode: ${mode}`)
  const url = new URL(currentUrl)
  url.searchParams.set('app', mode)
  return url.href
}

export function assertGeneratedFixtureReload(scenario: string | undefined, currentUrl: string, dialog: Record<string, unknown>): void {
  if (scenario !== 'registered-cell-real-dnd' || dialog.type !== 'beforeunload' || dialog.url !== currentUrl) {
    throw new Error(`Unexpected dialog during scenario setup: ${JSON.stringify(dialog)}`)
  }
}
