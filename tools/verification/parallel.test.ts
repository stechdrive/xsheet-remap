import { expect, it } from 'vitest'
import { runIndependent } from './parallel.mjs'

it('starts independent work together and waits for all of it after a failure', async () => {
  const events: string[] = []
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const result = runIndependent([
    async () => { events.push('first'); throw new Error('failed check') },
    async () => { events.push('second'); await pending; events.push('finished') },
  ])
  let settled = false
  const outcome = result.catch(error => { settled = true; return error })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(events).toEqual(['first', 'second'])
  expect(settled).toBe(false)
  finish()
  expect(await outcome).toBeInstanceOf(AggregateError)
  expect(events).toEqual(['first', 'second', 'finished'])
})

it('reports every failed task, including synchronous startup failures', async () => {
  const error = await runIndependent([
    () => { throw new Error('startup') },
    async () => { throw new Error('exit') },
  ]).catch(error => error)
  expect(error.errors.map(String)).toEqual(['Error: startup', 'Error: exit'])
})
