export function patchXdtsValue(text: string, trackNameOrNo: string | number, frameIndex: number, value: string | null): string {
  const newlineIndex = text.indexOf('\n')
  const header = newlineIndex === -1 ? '' : text.slice(0, newlineIndex + 1)
  const jsonText = newlineIndex === -1 ? text : text.slice(newlineIndex + 1)
  const data = JSON.parse(jsonText.trim()) as {
    timeTables?: Array<{
      timeTableHeaders?: Array<{ fieldId?: number; names?: string[] }>
      fields?: Array<{
        fieldId?: number
        tracks?: Array<{
          trackNo?: number
          frames?: Array<{ frame?: number; data?: Array<{ id?: number; values?: string[] }> }>
        }>
      }>
    }>
  }
  const table = data.timeTables?.[0]
  if (!table) throw new Error('timeTables[0] not found')
  const names = table.timeTableHeaders?.find(item => item.fieldId === 0)?.names ?? []
  const field = table.fields?.find(item => item.fieldId === 0)
  if (!field) throw new Error('CELL field not found')
  const trackNo =
    typeof trackNameOrNo === 'number'
      ? trackNameOrNo
      : names.findIndex(name => name === trackNameOrNo)
  if (trackNo < 0) throw new Error(`track not found: ${String(trackNameOrNo)}`)
  const track = field.tracks?.find(item => item.trackNo === trackNo)
  if (!track) throw new Error(`trackNo not found: ${trackNo}`)
  const frames = track.frames ?? []
  const existing = frames.find(item => item.frame === frameIndex)
  const nextValue = value ?? 'SYMBOL_NULL_CELL'
  if (existing) {
    existing.data = [{ id: 0, values: [nextValue] }]
  } else {
    frames.push({ frame: frameIndex, data: [{ id: 0, values: [nextValue] }] })
    frames.sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0))
  }
  track.frames = frames
  return `${header}${JSON.stringify(data, null, 2)}\n`
}
