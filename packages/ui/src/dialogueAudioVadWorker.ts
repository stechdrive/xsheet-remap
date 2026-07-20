import {
  DIALOGUE_VAD_CHUNK_SAMPLES,
  DIALOGUE_VAD_CONTEXT_SAMPLES,
  DIALOGUE_VAD_SAMPLE_RATE,
  DIALOGUE_VAD_STEP_SAMPLES,
  resampleDialogueAudioTo16k,
} from './dialogueAudioVad'

interface DialogueVadWorkerRequest {
  id: number
  samples: Float32Array
  sampleRate: number
  baseUrl: string
}

interface DialogueVadWorkerResponse {
  id: number
  probabilities?: Float32Array
  error?: string
}

type OrtModule = typeof import('onnxruntime-web/wasm')

interface SileroSessionInfo {
  ort: OrtModule
  session: import('onnxruntime-web').InferenceSession
  inputName: string
  sampleRateName: string
  outputName: string
  inputShape: number[]
  useCombinedState: boolean
  stateName?: string
  stateOutputName?: string
  stateShape?: number[]
  hiddenName?: string
  cellName?: string
  hiddenOutputName?: string
  cellOutputName?: string
  hiddenShape?: number[]
  cellShape?: number[]
}

let sessionPromise: Promise<SileroSessionInfo> | null = null
let sessionBaseUrl = ''

self.onmessage = (event: MessageEvent<DialogueVadWorkerRequest>) => {
  const request = event.data
  if (!request) return
  void (async () => {
    try {
      const resampled = resampleDialogueAudioTo16k(request.samples, request.sampleRate)
      const probabilities = await runSilero(resampled, request.baseUrl)
      const response: DialogueVadWorkerResponse = { id: request.id, probabilities }
      self.postMessage(response, { transfer: [probabilities.buffer] })
    } catch (error) {
      const response: DialogueVadWorkerResponse = {
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      }
      self.postMessage(response)
    }
  })()
}

async function ensureSession(baseUrl: string): Promise<SileroSessionInfo> {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  if (sessionPromise && sessionBaseUrl === normalizedBaseUrl) return sessionPromise
  sessionBaseUrl = normalizedBaseUrl
  sessionPromise = (async () => {
    const ort = (await import('onnxruntime-web/wasm')) as OrtModule
    ort.env.wasm.numThreads = 1
    const session = await ort.InferenceSession.create(
      new URL('vad/models/silero_vad.onnx', normalizedBaseUrl).toString(),
      { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
    )
    const inputNames = session.inputNames
    const outputNames = session.outputNames
    const inputName = findName(inputNames, ['input']) ?? inputNames[0]
    const stateName = findName(inputNames, ['state'])
    const hiddenName = findName(inputNames, ['h'])
    const cellName = findName(inputNames, ['c'])
    const sampleRateName = findName(inputNames, ['sr', 'sample_rate'])
      ?? inputNames.find(name => name !== inputName && name !== stateName && name !== hiddenName && name !== cellName)
      ?? inputNames[1]
    const useCombinedState = Boolean(stateName) && !hiddenName && !cellName
    const outputName = findName(outputNames, ['output']) ?? outputNames[0]
    const stateOutputName = useCombinedState
      ? findName(outputNames, ['staten', 'state_n', 'state']) ?? outputNames.find(name => name !== outputName)
      : undefined
    const hiddenOutputName = !useCombinedState ? findName(outputNames, ['hn', 'h']) ?? outputNames[1] : undefined
    const cellOutputName = !useCombinedState ? findName(outputNames, ['cn', 'c']) ?? outputNames[2] : undefined
    return {
      ort,
      session,
      inputName,
      sampleRateName,
      outputName,
      inputShape: resolveInputShape(inputMetadata(session, inputName)),
      useCombinedState,
      stateName,
      stateOutputName,
      stateShape: useCombinedState ? resolveStateShape(inputMetadata(session, stateName), [2, 1, 128]) : undefined,
      hiddenName,
      cellName,
      hiddenOutputName,
      cellOutputName,
      hiddenShape: !useCombinedState ? resolveStateShape(inputMetadata(session, hiddenName), [2, 1, 64]) : undefined,
      cellShape: !useCombinedState ? resolveStateShape(inputMetadata(session, cellName), [2, 1, 64]) : undefined,
    }
  })()
  return sessionPromise
}

async function runSilero(samples: Float32Array, baseUrl: string): Promise<Float32Array> {
  const info = await ensureSession(baseUrl)
  if (samples.length === 0) return new Float32Array()
  validateStateInputs(info)
  let combinedState = info.stateShape ? zeros(info.stateShape) : null
  let hiddenState = info.hiddenShape ? zeros(info.hiddenShape) : null
  let cellState = info.cellShape ? zeros(info.cellShape) : null
  const sampleRateTensor = new info.ort.Tensor('int64', new BigInt64Array([BigInt(DIALOGUE_VAD_SAMPLE_RATE)]), [1])
  const probabilities: number[] = []
  let context = new Float32Array(DIALOGUE_VAD_CONTEXT_SAMPLES)

  for (let offset = 0; offset < samples.length; offset += DIALOGUE_VAD_STEP_SAMPLES) {
    const chunk = new Float32Array(DIALOGUE_VAD_CHUNK_SAMPLES)
    chunk.set(samples.subarray(offset, Math.min(offset + DIALOGUE_VAD_CHUNK_SAMPLES, samples.length)))
    const input = new Float32Array(DIALOGUE_VAD_CONTEXT_SAMPLES + DIALOGUE_VAD_CHUNK_SAMPLES)
    input.set(context)
    input.set(chunk, DIALOGUE_VAD_CONTEXT_SAMPLES)
    context = input.slice(-DIALOGUE_VAD_CONTEXT_SAMPLES)
    const feeds: Record<string, import('onnxruntime-web').Tensor> = {
      [info.inputName]: new info.ort.Tensor('float32', input, info.inputShape),
      [info.sampleRateName]: sampleRateTensor,
    }
    if (info.useCombinedState && info.stateName && info.stateShape && combinedState) {
      feeds[info.stateName] = new info.ort.Tensor('float32', combinedState, info.stateShape)
    } else if (info.hiddenName && info.cellName && info.hiddenShape && info.cellShape && hiddenState && cellState) {
      feeds[info.hiddenName] = new info.ort.Tensor('float32', hiddenState, info.hiddenShape)
      feeds[info.cellName] = new info.ort.Tensor('float32', cellState, info.cellShape)
    }
    const outputs = await info.session.run(feeds)
    probabilities.push(Number(outputs[info.outputName]?.data[0] ?? 0))
    if (info.useCombinedState && info.stateOutputName) {
      const nextState = outputs[info.stateOutputName]?.data
      if (nextState) combinedState = Float32Array.from(nextState as ArrayLike<number>)
    } else if (info.hiddenOutputName && info.cellOutputName) {
      const nextHidden = outputs[info.hiddenOutputName]?.data
      const nextCell = outputs[info.cellOutputName]?.data
      if (nextHidden && nextCell) {
        hiddenState = Float32Array.from(nextHidden as ArrayLike<number>)
        cellState = Float32Array.from(nextCell as ArrayLike<number>)
      }
    }
  }
  return Float32Array.from(probabilities)
}

function validateStateInputs(info: SileroSessionInfo): void {
  if (info.useCombinedState) {
    if (!info.stateName || !info.stateShape || !info.stateOutputName) {
      throw new Error('Silero VADモデルの状態入出力が見つかりません。')
    }
  } else if (!info.hiddenName || !info.cellName || !info.hiddenShape || !info.cellShape || !info.hiddenOutputName || !info.cellOutputName) {
    throw new Error('Silero VADモデルの入出力が見つかりません。')
  }
}

function findName(names: readonly string[], candidates: string[]): string | undefined {
  const lowerNames = names.map(name => name.toLowerCase())
  for (const candidate of candidates) {
    const exact = lowerNames.indexOf(candidate)
    if (exact >= 0) return names[exact]
  }
  for (const candidate of candidates) {
    const partial = lowerNames.findIndex(name => name.includes(candidate))
    if (partial >= 0) return names[partial]
  }
  return undefined
}

function inputMetadata(
  session: import('onnxruntime-web').InferenceSession,
  name: string | undefined,
): { dimensions?: readonly unknown[] } | undefined {
  const index = name ? session.inputNames.indexOf(name) : -1
  const metadata = index >= 0 ? session.inputMetadata[index] : undefined
  const dimensions = metadata && 'dimensions' in metadata ? metadata.dimensions : undefined
  return Array.isArray(dimensions) ? { dimensions } : undefined
}

function resolveInputShape(metadata: { dimensions?: readonly unknown[] } | undefined): number[] {
  const dimensions = metadata?.dimensions ?? []
  const inputLength = DIALOGUE_VAD_CONTEXT_SAMPLES + DIALOGUE_VAD_CHUNK_SAMPLES
  return dimensions.length === 3 ? [1, 1, inputLength] : [1, inputLength]
}

function resolveStateShape(metadata: { dimensions?: readonly unknown[] } | undefined, fallback: number[]): number[] {
  const dimensions = metadata?.dimensions ?? []
  return dimensions.length >= 2 && dimensions.every(value => typeof value === 'number' && value > 0)
    ? dimensions as number[]
    : fallback
}

function zeros(shape: number[]): Float32Array {
  return new Float32Array(shape.reduce((total, dimension) => total * dimension, 1))
}
