import { readFile } from 'node:fs/promises'
import { parseXdts } from '@xsheet-remap/xdts'

const [csvPath, xdtsPath] = process.argv.slice(2)

if (!csvPath || !xdtsPath) {
  console.error('usage: npm run csv-xdts:compare -- <timeline.csv> <timeline.xdts>')
  process.exit(1)
}

const csvRows = parseCsv(await readFile(csvPath, 'utf8'))
const xdts = parseXdts(await readFile(xdtsPath, 'utf8'))
const parentRow = csvRows[0] ?? []
const nameRow = csvRows[1] ?? []
const csvColumns = nameRow.map((name, index) => ({
  column: index,
  parentPath: parentRow[index] ?? '',
  name,
  fullPath: [parentRow[index], name].filter(Boolean).join('/'),
}))

console.log(JSON.stringify({
  csvPath,
  xdtsPath,
  columns: csvColumns.map((column, index) => ({
    csvColumn: column.column,
    csvFullPath: column.fullPath,
    xdtsTrackNo: xdts.tracks[index]?.trackNo ?? null,
    xdtsName: xdts.tracks[index]?.name ?? null,
  })),
  unmatchedXdtsTracks: xdts.tracks.slice(csvColumns.length).map(track => ({ trackNo: track.trackNo, name: track.name })),
}, null, 2))

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cell = ''
  let row: string[] = []
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  row.push(cell.replace(/\r$/, ''))
  rows.push(row)
  return rows.filter(items => items.some(item => item.length > 0))
}
