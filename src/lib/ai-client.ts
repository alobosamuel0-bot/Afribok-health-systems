import type { Capacity, ClinicalNote, Forecast, OcrExtraction, TriageAssessment } from '@shared/clinical'
import type { Encounter } from '@shared/types'
import { api } from './api'
import type { EncodedAudio } from './audio'

const AI_TIMEOUT_MS = 150_000

const aiSignal = () => AbortSignal.timeout(AI_TIMEOUT_MS)

export interface AiStatus {
  configured: boolean
  keys: number
  availableKeys: number
  models: string[]
  features: string[]
}

export function fetchAiStatus(): Promise<AiStatus> {
  return api<AiStatus>('/api/ai/status')
}

export async function fileToDataUrl(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('That photograph is over 8 MB. Take a smaller photo and try again.')
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The photograph could not be read from this device.'))
    reader.readAsDataURL(file)
  })
}

export async function extractPaperRecord(file: File): Promise<OcrExtraction> {
  const dataUrl = await fileToDataUrl(file)
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(';')) || file.type || 'image/jpeg'
  const response = await api<{ extraction: OcrExtraction }>('/api/ai/ocr', {
    method: 'POST',
    body: JSON.stringify({ imageBase64: dataUrl, mimeType }),
    signal: aiSignal(),
  })
  return response.extraction
}

export interface RegistrationExtraction {
  fields: Record<string, { value: string | null; confidence: number }>
  transcript: string
  warnings: string[]
  model: string
}

export async function structureRegistration(input: {
  audio?: EncodedAudio
  transcript?: string
}): Promise<RegistrationExtraction> {
  return api<RegistrationExtraction>('/api/ai/register', {
    method: 'POST',
    body: JSON.stringify({
      audioBase64: input.audio?.base64,
      mimeType: input.audio?.mimeType,
      audioSeconds: input.audio?.seconds,
      transcript: input.transcript,
    }),
    signal: aiSignal(),
  })
}

export async function runTriage(
  encounterId: string,
  options: { notes?: string; vitals?: Record<string, string | number> } = {},
): Promise<{ assessment: TriageAssessment; encounter: Encounter }> {
  return api<{ assessment: TriageAssessment; encounter: Encounter }>('/api/ai/triage', {
    method: 'POST',
    body: JSON.stringify({ encounterId, ...options }),
    signal: aiSignal(),
  })
}

export async function draftClinicalNote(input: {
  encounterId: string
  audio?: EncodedAudio
  transcript?: string
  notes?: string
}): Promise<{ note: ClinicalNote; encounter: Encounter }> {
  return api<{ note: ClinicalNote; encounter: Encounter }>('/api/ai/scribe', {
    method: 'POST',
    body: JSON.stringify({
      encounterId: input.encounterId,
      audioBase64: input.audio?.base64,
      mimeType: input.audio?.mimeType,
      audioSeconds: input.audio?.seconds,
      transcript: input.transcript,
      notes: input.notes,
    }),
    signal: aiSignal(),
  })
}

export async function fetchForecast(
  historyDays = 90,
  horizonHours = 24,
): Promise<{ forecast: Forecast; capacity: Capacity }> {
  return api<{ forecast: Forecast; capacity: Capacity }>(
    `/api/forecast?historyDays=${historyDays}&horizonHours=${horizonHours}`,
    { signal: aiSignal() },
  )
}

export async function saveCapacity(capacity: Omit<Capacity, 'updatedAt'>): Promise<Capacity> {
  const response = await api<{ capacity: Capacity }>('/api/capacity', {
    method: 'PUT',
    body: JSON.stringify(capacity),
  })
  return response.capacity
}
