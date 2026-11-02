import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSupportedRuntime, runtimeIdentity } from '../checks/runtime.mjs'
import { importerTestFilters } from './unit-evidence.mjs'

assertSupportedRuntime(runtimeIdentity())
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temporaryRoot = path.join(root, '.tmp/vitest')
mkdirSync(temporaryRoot, { recursive: true })

// Vitest creates atomic module-transfer files under os.tmpdir() before loading
// its config. Windows sandbox TEMP can reject rename there. Scope the writable
// location to this test process; Vitest still owns its unique per-run directories.
const argv = process.argv.slice(2).flatMap(arg => arg === '--clip' ? importerTestFilters : [arg])
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), ...argv], {
  cwd: root,
  env: { ...process.env, TEMP: temporaryRoot, TMP: temporaryRoot, TMPDIR: temporaryRoot },
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
