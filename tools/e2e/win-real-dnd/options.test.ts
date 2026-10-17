import { expect, it } from 'vitest'
import { parseNativeDropOptions } from './options'

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
