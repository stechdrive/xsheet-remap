import { expect, it } from 'vitest'
import { assertGeneratedFixtureReload, nativeDropAppUrl, parseNativeDropOptions } from './options'

it('preserves paths containing spaces and explicit scenario selection', () => {
  expect(parseNativeDropOptions(['--test-case', 'explorer-import', '--multi-folder', 'D:/test fixtures/multi', '--mode', 'remap']))
    .toEqual({ 'test-case': 'explorer-import', 'multi-folder': 'D:/test fixtures/multi', mode: 'remap' })
})

it.each([
  ['--test-csae', 'full'], ['full'], ['--port'], ['--port', '--mode', 'remap'],
  ['--port', '1', '--port', '2'], ['--mode', 'corrector'],
])('rejects malformed native input options %j before launching a scenario', (...argv) => {
  expect(() => parseNativeDropOptions(argv)).toThrow()
})

it('selects the requested UI inside the same EXE origin and preserves other launch parameters', () => {
  const launched = 'http://tauri.localhost/index.html?app=remap&fixture=drag#sheet'
  expect(nativeDropAppUrl(launched, 'editor')).toBe('http://tauri.localhost/index.html?app=editor&fixture=drag#sheet')
  expect(nativeDropAppUrl(launched, 'remap')).toBe(launched)
  expect(() => nativeDropAppUrl(launched, 'corrector')).toThrow('Unsupported native drop mode')
})

it('only permits reloading the generated registered-cell fixture, never unrelated dialogs', () => {
  const url = 'http://tauri.localhost/index.html?app=remap'
  expect(() => assertGeneratedFixtureReload('registered-cell-real-dnd', url, { type: 'beforeunload', url })).not.toThrow()
  for (const [scenario, dialog] of [
    ['real-dnd', { type: 'beforeunload', url }],
    ['registered-cell-real-dnd', { type: 'confirm', url }],
    ['registered-cell-real-dnd', { type: 'beforeunload', url: 'https://example.com/' }],
  ] as const) expect(() => assertGeneratedFixtureReload(scenario, url, dialog)).toThrow('Unexpected dialog')
})
