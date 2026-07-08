import { readFile, writeFile } from 'node:fs/promises'
import { patchXdtsValue } from '@xsheet-remap/xdts'

const [inputPath, outputPath] = process.argv.slice(2)
const trackNoArg = option('--trackNo')
const trackArg = option('--track')
const frameArg = option('--frame')
const valueArg = option('--value')

if (!inputPath || !outputPath || (!trackNoArg && !trackArg) || frameArg === undefined) {
  console.error('usage: npm run xdts:patch -- <input.xdts> <output.xdts> (--track <name> | --trackNo <n>) --frame <xdtsFrameIndex> [--value <cellName|null>]')
  process.exit(1)
}

const track = trackNoArg === undefined ? String(trackArg) : Number(trackNoArg)
const frame = Number(frameArg)
if (!Number.isFinite(frame)) throw new Error(`invalid --frame: ${frameArg}`)
const value = valueArg === undefined || valueArg === 'null' ? null : valueArg
const patched = patchXdtsValue(await readFile(inputPath, 'utf8'), track, frame, value)
await writeFile(outputPath, patched, 'utf8')
console.log(JSON.stringify({ inputPath, outputPath, track, frame, value }, null, 2))

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
