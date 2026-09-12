export function createAudioPlayheadStore(initial: { cutId: string; frame: number }) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    publish: (next: typeof initial) => {
      if (value.cutId === next.cutId && value.frame === next.frame) return
      value = next
      for (const listener of listeners) listener()
    },
  }
}
export type AudioPlayheadStore = ReturnType<typeof createAudioPlayheadStore>
