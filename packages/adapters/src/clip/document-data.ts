export function clipSourceDataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return `data:application/x-clip-studio;base64,${btoa(binary)}`
}

export function clipSourceBytes(dataUrl: string): Uint8Array {
  if (!/^data:[^,]*;base64,/.test(dataUrl)) throw new Error('CLIPの元データが不正です。')
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}
