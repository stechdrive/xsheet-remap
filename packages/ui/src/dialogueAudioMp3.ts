import type { PcmAudio } from './dialogueAudioEngine'

export const DIALOGUE_AUDIO_MP3_BITRATE = 128_000

let mediabunnyPromise: Promise<{
  AudioSample: typeof import('mediabunny')['AudioSample']
  AudioSampleSource: typeof import('mediabunny')['AudioSampleSource']
  BufferTarget: typeof import('mediabunny')['BufferTarget']
  Mp3OutputFormat: typeof import('mediabunny')['Mp3OutputFormat']
  Output: typeof import('mediabunny')['Output']
}> | null = null

async function loadMediabunnyMp3Encoder() {
  mediabunnyPromise ??= Promise.all([
    import('mediabunny'),
    import('@mediabunny/mp3-encoder'),
  ]).then(([mediabunny, extension]) => {
    extension.registerMp3Encoder()
    return mediabunny
  })
  return mediabunnyPromise
}

export async function encodeDialogueAudioMp3(audio: PcmAudio): Promise<Uint8Array> {
  const { AudioSample, AudioSampleSource, BufferTarget, Mp3OutputFormat, Output } = await loadMediabunnyMp3Encoder()
  const target = new BufferTarget()
  const output = new Output({
    format: new Mp3OutputFormat({ xingHeader: true }),
    target,
  })
  const source = new AudioSampleSource({
    codec: 'mp3',
    bitrate: DIALOGUE_AUDIO_MP3_BITRATE,
    bitrateMode: 'constant',
  })
  output.addAudioTrack(source)
  await output.start()

  const sample = new AudioSample({
    data: audio.samples,
    format: 'f32-planar',
    numberOfChannels: 1,
    sampleRate: audio.sampleRate,
    timestamp: 0,
  })
  try {
    await source.add(sample)
  } finally {
    sample.close()
    source.close()
  }
  await output.finalize()
  if (!target.buffer) throw new Error('MP3データを生成できませんでした。')
  return new Uint8Array(target.buffer)
}
