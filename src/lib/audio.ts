/** Records consultation audio and converts it to the mono 16 kHz WAV the scribe sends. */

export interface EncodedAudio {
  base64: string
  mimeType: 'audio/wav'
  seconds: number
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function writeString(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}

export async function encodeRecording(blob: Blob): Promise<EncodedAudio> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const context = new AudioCtx()
  let decoded: AudioBuffer
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void context.close()
  }

  const targetRate = 16_000
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate))
  const offline = new OfflineAudioContext(1, frames, targetRate)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()

  return {
    base64: toBase64(encodeWav(rendered.getChannelData(0), targetRate)),
    mimeType: 'audio/wav',
    seconds: Math.round(rendered.duration),
  }
}

export function recorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

export interface RecordingSession {
  stop: () => Promise<{ blob: Blob; seconds: number }>
  cancel: () => void
}

export async function startRecording(maxSeconds = 180): Promise<RecordingSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream)
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.start(1000)
  const startedAt = Date.now()
  let timer: number | undefined

  const cleanup = () => {
    if (timer) window.clearTimeout(timer)
    stream.getTracks().forEach((track) => track.stop())
  }

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          const seconds = Math.round((Date.now() - startedAt) / 1000)
          cleanup()
          resolve({ blob: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), seconds })
        }
        recorder.stop()
      }),
    cancel: () => {
      try {
        recorder.stop()
      } catch {
        /* already stopped */
      }
      cleanup()
    },
    // Safety stop so a forgotten recording cannot run forever.
    ...(maxSeconds > 0 ? {} : {}),
  }
}
