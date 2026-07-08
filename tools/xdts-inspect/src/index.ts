import { readFile } from 'node:fs/promises'
import { parseXdts, resolveCellsAtFrameByTrackNo } from '@xsheet-remap/xdts'

const filePath = process.argv[2]
const frameArg = process.argv.includes('--frame') ? process.argv[process.argv.indexOf('--frame') + 1] : undefined

if (!filePath) {
  console.error('usage: npm run xdts:inspect -- <input.xdts> [--frame <xdtsFrameIndex>]')
  process.exit(1)
}

const xdts = parseXdts(await readFile(filePath, 'utf8'))
const frameIndex = frameArg === undefined ? undefined : Number(frameArg)
const resolved = frameIndex === undefined ? undefined : Object.fromEntries(resolveCellsAtFrameByTrackNo(xdts.tracks, frameIndex))

console.log(JSON.stringify({
  file: filePath,
  version: xdts.version,
  header: xdts.header,
  timeTableName: xdts.timeTableName,
  duration: xdts.duration,
  fps: xdts.fps,
  resolvedAtFrame: frameIndex === undefined ? undefined : { frameIndex, tracks: resolved },
  tracks: xdts.tracks.map(track => ({
    trackNo: track.trackNo,
    name: track.name,
    cellNames: track.cellNames,
    frames: track.frames.map(frame => ({ frame: frame.frameIndex, value: frame.cellName })),
  })),
}, null, 2))
