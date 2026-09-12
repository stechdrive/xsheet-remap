import fs from 'node:fs'
import path from 'node:path'
import { sourceIdentity, verifyExecutable } from './evidence.mjs'

const exePath = path.resolve(process.argv[2])
const output = process.argv[3]
if (!output) throw new Error('Usage: executable.mjs <EXE path> <evidence JSON path>')
const identity = sourceIdentity()
// Release output mirrors the coherent dev-local EXEs. An explicitly selected
// copy is also testable, but only when its bytes match that current build record.
const buildStatePath = [path.join(path.dirname(exePath), 'build-state.json'), path.resolve('dev-local/build-state.json')].find(file => fs.existsSync(file))
if (!buildStatePath) throw new Error('No EXE build record; build the requested target first')
const buildState = JSON.parse(fs.readFileSync(buildStatePath, 'utf8'))
const artifact = verifyExecutable({ exePath, bytes: fs.readFileSync(exePath), buildState, identity })
fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, identity, buildStatePath, artifact }, null, 2))
