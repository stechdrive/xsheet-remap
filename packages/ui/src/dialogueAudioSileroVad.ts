import { summarizeDialogueWaveform } from './dialogueAudioEngine'
import type { DialogueAudioVadPreset, DialogueSpeechRange } from './dialogueAudioProject'
import {
  analyzeDialogueAudioWithRmsVad,
  analyzeDialogueVadProbabilities,
  dialogueVadFramesToPrerollRanges,
  dialogueVadFramesToSpeechRanges,
  getDialogueVadTuning,
  type DialogueVadDebug,
} from './dialogueAudioVad'

export type DialogueVadEngineStatus = 'idle' | 'loading' | 'silero' | 'fallback'

export interface DialogueSileroAnalysis {
  waveform: number[]
  speechRanges: DialogueSpeechRange[]
  prerollRanges: DialogueSpeechRange[]
  engine: Exclude<DialogueVadEngineStatus, 'idle' | 'loading'>
  debug: DialogueVadDebug
  error?: string
}

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

let worker: Worker | null = null
let workerFailed = false
let requestId = 0
const pending = new Map<number, {
  resolve: (probabilities: Float32Array) => void
  reject: (error: Error) => void
}>()

export async function analyzeDialogueAudioWithSileroVad(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
  audioStartFrame: number,
  preset: DialogueAudioVadPreset,
  stability: number,
  sensitivity: number,
): Promise<DialogueSileroAnalysis> {
  const tuning = getDialogueVadTuning(preset, stability, sensitivity)
  const waveform = summarizeDialogueWaveform(samples, 1024)
  try {
    const probabilities = await requestSileroProbabilities(samples, sampleRate)
    const analysis = analyzeDialogueVadProbabilities(samples, sampleRate, fps, tuning, probabilities)
    return {
      waveform,
      speechRanges: dialogueVadFramesToSpeechRanges(analysis.frames, audioStartFrame),
      prerollRanges: dialogueVadFramesToPrerollRanges(analysis.frames, audioStartFrame),
      engine: analysis.debug.usedFallbackRms ? 'fallback' : 'silero',
      debug: analysis.debug,
    }
  } catch (error) {
    const fallback = analyzeDialogueAudioWithRmsVad(samples, sampleRate, fps, tuning)
    return {
      waveform,
      speechRanges: dialogueVadFramesToSpeechRanges(fallback.frames, audioStartFrame),
      prerollRanges: dialogueVadFramesToPrerollRanges(fallback.frames, audioStartFrame),
      engine: 'fallback',
      debug: fallback.debug,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function resetDialogueSileroVadWorkerForTests(): void {
  worker?.terminate()
  worker = null
  workerFailed = false
  requestId = 0
  pending.clear()
}

function requestSileroProbabilities(samples: Float32Array, sampleRate: number): Promise<Float32Array> {
  const currentWorker = ensureWorker()
  const transferredSamples = samples.slice()
  const id = ++requestId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const payload: DialogueVadWorkerRequest = {
      id,
      samples: transferredSamples,
      sampleRate,
      baseUrl: resolvePublicBaseUrl(),
    }
    currentWorker.postMessage(payload, [transferredSamples.buffer])
  })
}

function ensureWorker(): Worker {
  if (workerFailed) throw new Error('Silero VADワーカーは簡易検出へフォールバックしました。')
  if (worker) return worker
  if (typeof Worker === 'undefined') throw new Error('この環境ではSilero VADワーカーを利用できません。')
  try {
    worker = new Worker(new URL('./dialogueAudioVadWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<DialogueVadWorkerResponse>) => {
      const response = event.data
      const callback = pending.get(response.id)
      if (!callback) return
      pending.delete(response.id)
      if (response.error) callback.reject(new Error(response.error))
      else callback.resolve(response.probabilities ?? new Float32Array())
    }
    worker.onerror = event => failWorker(new Error(event.message || 'Silero VADワーカーでエラーが発生しました。'))
    worker.onmessageerror = () => failWorker(new Error('Silero VADワーカーの応答を読み取れませんでした。'))
    return worker
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    failWorker(failure)
    throw failure
  }
}

function failWorker(error: Error): void {
  workerFailed = true
  worker?.terminate()
  worker = null
  pending.forEach(callback => callback.reject(error))
  pending.clear()
}

function resolvePublicBaseUrl(): string {
  const configuredBase = ((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './')
  try {
    return new URL(configuredBase, window.location.href).toString()
  } catch {
    return configuredBase
  }
}
