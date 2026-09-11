import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifyNativeFileDrop } from './native-file-drop-contract'

type Drop = { source: string; type: string; paths: string[] }
let events: Drop[]
const driver = { evaluate: <T>(expression: string): Promise<T> => window.eval(expression) }
beforeEach(() => {
  vi.useFakeTimers()
  events = []
  Object.assign(window, { __xsheetDropDiagnostics: events })
})
afterEach(() => { Reflect.deleteProperty(window, '__xsheetDropDiagnostics'); vi.useRealTimers() })

it('requires a fresh OS drop with every selected file', async () => {
  const paths = ['D:/fixture/A1.png', 'D:/fixture/A2.png']
  const evidence = await verifyNativeFileDrop(driver, paths, async () => {
    events.push({ source: 'native:window', type: 'drop', paths: paths.map(path => path.toUpperCase()) })
  })
  expect(evidence).toMatchObject({ source: 'native:window', type: 'drop' })
})

it('does not pass on an older OS drop or a synthesized router event', async () => {
  const paths = ['D:/fixture/A1.png']
  events.push({ source: 'native:window', type: 'drop', paths })
  const pending = expect(verifyNativeFileDrop(driver, paths, async () => {
    events.push({ source: 'native-router', type: 'drop', paths })
  })).rejects.toThrow('did not deliver the expected native file drop')
  await vi.advanceTimersByTimeAsync(8200)
  await pending
})

it('rejects partial multi-file delivery', async () => {
  const pending = expect(verifyNativeFileDrop(driver, ['D:/fixture/A1.png', 'D:/fixture/A2.png'], async () => {
    events.push({ source: 'native:webview', type: 'drop', paths: ['D:/fixture/A1.png'] })
  })).rejects.toThrow('did not deliver the expected native file drop')
  await vi.advanceTimersByTimeAsync(8200)
  await pending
})
