// Wait for every started task, including after failure. Later phases must never
// overlap unfinished checks (in particular the isolated browser acceptance).
export async function runIndependent(tasks) {
  const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task)))
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
  if (errors.length) throw new AggregateError(errors, errors.map(String).join('\n'))
}
