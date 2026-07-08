const naturalFileNameCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

export function compareNaturalFileNameText(a: string, b: string): number {
  return naturalFileNameCollator.compare(a, b) || a.localeCompare(b, 'ja')
}

export function compareFileNameLikeText(a: string, b: string): number {
  const aParts = splitFileNameForSort(a)
  const bParts = splitFileNameForSort(b)
  return compareNaturalFileNameText(aParts.stem, bParts.stem)
    || compareNaturalFileNameText(aParts.extension, bParts.extension)
    || compareNaturalFileNameText(a, b)
}

function splitFileNameForSort(value: string): { stem: string; extension: string } {
  const slashIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  const directory = slashIndex >= 0 ? value.slice(0, slashIndex + 1) : ''
  const fileName = slashIndex >= 0 ? value.slice(slashIndex + 1) : value
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) return { stem: value, extension: '' }
  return {
    stem: `${directory}${fileName.slice(0, dotIndex)}`,
    extension: fileName.slice(dotIndex + 1),
  }
}
