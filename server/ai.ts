import express, { Router, type Request, type Response } from 'express'
import type { AfribokDb } from './db'
import { GeminiError, extractJson, type GeminiClient } from './gemini'
import { canAccessEncounter, ServiceError, getCapacity, getEncounter, getPatient, saveNote, saveTriage } from './repository'
import { requirePermission } from './auth'
import { getEncounter as getEncounterById } from './repository'
import {
  OCR_FIELD_KEYS,
  TRIAGE_LABELS,
  noteModelSchema,
  ocrModelSchema,
  triageModelSchema,
  type ClinicalNote,
  type OcrExtraction,
  type TriageAssessment,
  type TriageLevel,
} from '../shared/clinical'
import type { SessionUser } from '../shared/types'
import type { z } from 'zod'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_AUDIO_BYTES = 7 * 1024 * 1024

const BASE_SYSTEM = `You are the clinical documentation assistant inside Afribok, a clinic record system used by nurses and clinicians.
Rules you must never break:
- You support a qualified clinician. You do not diagnose, prescribe, or replace clinical judgement.
- If the information is thin, say what is missing rather than inventing detail.
- Never invent a name, date, number or finding that is not present in the input.
- Answer with a single JSON object and nothing else.`

function fail(message: string, status = 502, code = 'AI_FAILED'): never {
  throw new ServiceError(message, status, code)
}

function aiFailure(error: unknown): never {
  if (error instanceof ServiceError) throw error
  if (error instanceof GeminiError) {
    fail(error.message, error.code === 'AI_RATE_LIMITED' ? 429 : 502, error.code)
  }
  fail(error instanceof Error ? error.message : 'The AI service failed.', 502)
}

function decodeBase64(input: string, maxBytes: number, label: string): { data: string; bytes: number } {
  const cleaned = input.replace(/^data:[^;]+;base64,/, '').trim()
  if (!cleaned) fail(`No ${label} was received.`, 400, 'BAD_REQUEST')
  const bytes = Math.floor((cleaned.length * 3) / 4)
  if (bytes > maxBytes) {
    fail(`That ${label} is too large (${(bytes / 1024 / 1024).toFixed(1)} MB). Limit is ${maxBytes / 1024 / 1024} MB.`, 413, 'TOO_LARGE')
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(cleaned)) fail(`The ${label} could not be decoded.`, 400, 'BAD_REQUEST')
  return { data: cleaned.replace(/\s/g, ''), bytes }
}

function ageFrom(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null
  const born = new Date(`${dateOfBirth}T00:00:00Z`)
  if (Number.isNaN(born.getTime())) return null
  const years = (Date.now() - born.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  return years >= 0 && years < 130 ? Math.floor(years) : null
}

function normalizeTriage(
  raw: z.infer<typeof triageModelSchema>,
  actor: SessionUser,
  model: string,
): TriageAssessment {
  const level = Math.min(5, Math.max(1, Math.round(raw.level))) as TriageLevel
  return {
    level,
    label: TRIAGE_LABELS[level],
    redFlags: raw.redFlags.map((item) => item.trim()).filter(Boolean).slice(0, 12),
    observations: raw.observations.map((item) => item.trim()).filter(Boolean).slice(0, 12),
    disposition: raw.disposition.trim(),
    reasoning: raw.reasoning.trim(),
    confidence: raw.confidence,
    assessedAt: new Date().toISOString(),
    assessedBy: actor.name,
    model,
  }
}

export function createAiRouter({
  db,
  gemini,
}: {
  db: AfribokDb
  gemini: GeminiClient
}): Router {
  const router = Router()
  router.use(express.json({ limit: '14mb' }))

  router.get('/status', requirePermission('dashboard.read'), (_req: Request, res: Response) => {
    res.json({
      ...gemini.describe(),
      features: ['triage', 'scribe', 'ocr', 'forecast'],
    })
  })

  router.post('/ocr', requirePermission('patient.create'), async (req, res) => {
    const started = Date.now()
    try {
      const image = String(req.body?.imageBase64 ?? '')
      const mimeType = String(req.body?.mimeType ?? 'image/jpeg')
      if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(mimeType)) {
        fail('Send a JPEG, PNG, WebP or HEIC photograph of the paper record.', 400, 'BAD_REQUEST')
      }
      const decoded = decodeBase64(image, MAX_IMAGE_BYTES, 'photograph')

      const prompt = `Read this photograph of a paper clinic record and extract the patient details.
Return JSON exactly in this shape:
{
  "legible": true|false,
  "documentType": "short description of the document",
  "fields": { "firstName": {"value": string|null, "confidence": 0..1}, ... },
  "confidence": 0..1,
  "warnings": [string],
  "rawText": "the readable text you can see, line by line"
}
Allowed field names: ${OCR_FIELD_KEYS.join(', ')}.
Rules:
- Copy what is written, including local spellings. Never guess a letter you cannot read.
- dateOfBirth must be YYYY-MM-DD when the record shows a clear date, otherwise null.
- sex must be "female", "male" or null.
- chiefComplaint is the presenting complaint or reason for attendance.
- If the photo is blurry, cropped, skewed or partly unreadable, set legible=false and explain in warnings.
- Per-field confidence must reflect real legibility: 0.9+ only for clean print, 0.4 or less when you are guessing.`

      const answer = await gemini.generate({
        system: BASE_SYSTEM,
        json: true,
        temperature: 0.1,
        maxOutputTokens: 2048,
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: decoded.data } },
        ],
      })

      const parsed = ocrModelSchema.safeParse(extractJson(answer.text))
      if (!parsed.success) fail('The model did not return usable fields for this photograph. Try a straighter, brighter photo.', 502, 'AI_BAD_RESPONSE')

      const fields = {} as OcrExtraction['fields']
      for (const key of OCR_FIELD_KEYS) {
        const entry = parsed.data.fields[key]
        fields[key] = {
          value: entry?.value ? entry.value.trim() : null,
          confidence: entry?.confidence ?? 0,
        }
      }

      const extraction: OcrExtraction = {
        legible: parsed.data.legible,
        documentType: parsed.data.documentType,
        fields,
        confidence: parsed.data.confidence,
        warnings: parsed.data.warnings,
        rawText: parsed.data.rawText,
        model: answer.model,
        processedAt: new Date().toISOString(),
      }

      res.json({ extraction, latencyMs: Date.now() - started, model: answer.model })
    } catch (error) {
      aiFailure(error)
    }
  })

  router.post('/register', requirePermission('patient.create'), async (req, res) => {
    const started = Date.now()
    try {
      const transcriptText = String(req.body?.transcript ?? '').slice(0, 12000)
      const audio = req.body?.audioBase64 ? String(req.body.audioBase64) : ''
      const mimeType = String(req.body?.mimeType ?? 'audio/wav')
      if (!audio && transcriptText.trim().length < 10) {
        fail('Record the patient conversation or paste a transcript first.', 400, 'BAD_REQUEST')
      }
      const instruction = `Extract new-patient registration details from this conversation.
Return JSON exactly:
{
  "transcript": string,
  "fields": {
    "firstName": {"value": string|null, "confidence": 0..1},
    "lastName": {"value": string|null, "confidence": 0..1},
    "otherNames": {"value": string|null, "confidence": 0..1},
    "sex": {"value": "female"|"male"|"other"|null, "confidence": 0..1},
    "dateOfBirth": {"value": "YYYY-MM-DD"|null, "confidence": 0..1},
    "phone": {"value": string|null, "confidence": 0..1},
    "address": {"value": string|null, "confidence": 0..1},
    "chiefComplaint": {"value": string|null, "confidence": 0..1},
    "allergies": {"value": string|null, "confidence": 0..1},
    "medicalHistory": {"value": string|null, "confidence": 0..1},
    "currentMedications": {"value": string|null, "confidence": 0..1}
  },
  "warnings": [string]
}
Rules:
- Only copy details the patient or escort actually stated. Never guess a name, date, phone or medical detail.
- chiefComplaint must be in the patient's own words.
- Do not record a diagnosis, examination finding or treatment.
- If a field was not mentioned, return value null and confidence 0.`
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: instruction }]
      if (audio) {
        const decoded = decodeBase64(audio, MAX_AUDIO_BYTES, 'recording')
        parts.push({ inlineData: { mimeType, data: decoded.data } })
      }
      const answer = await gemini.generate({
        system: BASE_SYSTEM,
        json: true,
        temperature: 0.1,
        maxOutputTokens: 2048,
        parts,
      })
      const parsed = extractJson(answer.text) as {
        transcript?: unknown
        fields?: Record<string, { value?: unknown; confidence?: unknown }>
        warnings?: unknown
      } | null
      if (!parsed || typeof parsed !== 'object' || !parsed.fields) {
        fail('The model did not return usable registration fields. Try again or use the form.', 502, 'AI_BAD_RESPONSE')
      }
      const allowed = [
        'firstName', 'lastName', 'otherNames', 'sex', 'dateOfBirth', 'phone', 'address',
        'chiefComplaint', 'allergies', 'medicalHistory', 'currentMedications',
      ] as const
      const fields: Record<string, { value: string | null; confidence: number }> = {}
      for (const key of allowed) {
        const entry = parsed.fields[key]
        const value = entry && typeof entry.value === 'string' && entry.value.trim() ? entry.value.trim().slice(0, 1000) : null
        const confidence = entry && typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
          ? Math.max(0, Math.min(1, entry.confidence)) : 0
        fields[key] = { value, confidence }
      }
      res.json({
        fields,
        transcript: typeof parsed.transcript === 'string' ? parsed.transcript.slice(0, 12000) : transcriptText,
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === 'string').slice(0, 10) : [],
        model: answer.model,
        latencyMs: Date.now() - started,
      })
    } catch (error) {
      aiFailure(error)
    }
  })

  router.post('/triage', requirePermission('encounter.update'), async (req, res) => {
    const started = Date.now()
    try {
      const actor = req.afribokUser as SessionUser
      const encounterId = String(req.body?.encounterId ?? '')
      const encounter = getEncounterById(db, actor.facilityId, encounterId)
      if (!encounter || !canAccessEncounter(actor, encounter)) fail('Visit not found.', 404, 'NOT_FOUND')
      const patient = getPatient(db, actor.facilityId, encounter.patientId)
      const capacity = getCapacity(db, actor.facilityId)
      const vitals = (req.body?.vitals ?? {}) as Record<string, unknown>
      const extra = String(req.body?.notes ?? '').slice(0, 1500)

      const waitingNow = db
        .prepare("SELECT COUNT(*) AS count FROM encounters WHERE facility_id = ? AND status = 'waiting'")
        .get(actor.facilityId) as { count: number }

      const vitalsText = Object.entries(vitals)
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(', ')

      const prompt = `Assess triage urgency for this patient and return JSON:
{
  "level": 1|2|3|4|5,
  "redFlags": [string],
  "observations": [string],
  "disposition": string,
  "reasoning": string,
  "confidence": 0..1
}
Levels: 1 = immediate resuscitation, 2 = very urgent (see within 10 min), 3 = urgent (within 30 min), 4 = standard (within 60 min), 5 = non-urgent.

Patient: ${patient ? `${patient.firstName} ${patient.lastName}` : 'unknown'}, sex ${patient?.sex ?? 'unknown'}, age ${ageFrom(patient?.dateOfBirth ?? null) ?? 'unknown'}.
Presenting complaint: ${encounter.chiefComplaint || 'not recorded'}
Extra notes: ${extra || 'none'}
Recorded observations: ${vitalsText || 'none recorded'}
Waiting now: ${waitingNow.count} patient(s); ${capacity.consultRooms} consultation room(s).

Rules:
- Flag every danger sign you can justify from the complaint (for example airway compromise, severe respiratory distress, shock, altered consciousness, seizure, severe bleeding, chest pain, stroke signs, severe dehydration, high fever in an infant, pregnancy bleeding, suicidal ideation).
- observations must be the specific measurements or checks staff should take next, not a diagnosis.
- disposition must say where the patient should go next (resuscitation bay, urgent consult, routine queue, etc.).
- If the complaint is too vague to assess, say so in reasoning and keep confidence low; do not invent findings.
- No diagnoses or drug doses.`

      const answer = await gemini.generate({
        system: BASE_SYSTEM,
        json: true,
        temperature: 0.15,
        maxOutputTokens: 1024,
        parts: [{ text: prompt }],
      })

      const parsed = triageModelSchema.safeParse(extractJson(answer.text))
      if (!parsed.success) fail('The model did not return a usable triage level. Try again.', 502, 'AI_BAD_RESPONSE')

      const assessment = normalizeTriage(parsed.data, actor, answer.model)
      const updated = saveTriage(db, actor, encounter.id, assessment)
      res.json({ assessment, encounter: updated, latencyMs: Date.now() - started })
    } catch (error) {
      aiFailure(error)
    }
  })

  router.post('/scribe', requirePermission('encounter.update'), async (req, res) => {
    const started = Date.now()
    try {
      const actor = req.afribokUser as SessionUser
      const encounterId = String(req.body?.encounterId ?? '')
      const encounter = getEncounter(db, actor.facilityId, encounterId)
      if (!encounter || !canAccessEncounter(actor, encounter)) fail('Visit not found.', 404, 'NOT_FOUND')
      const patient = getPatient(db, actor.facilityId, encounter.patientId)

      const transcriptText = String(req.body?.transcript ?? '').slice(0, 12000)
      const audio = req.body?.audioBase64 ? String(req.body.audioBase64) : ''
      const mimeType = String(req.body?.mimeType ?? 'audio/wav')
      if (!audio && transcriptText.trim().length < 10) {
        fail('Record the consultation or paste the transcript first.', 400, 'BAD_REQUEST')
      }

      const notes = String(req.body?.notes ?? '').slice(0, 2000)
      const instruction = `Write the consultation note for this clinic visit as JSON:
{
  "transcript": string,
  "subjective": string,
  "objective": string,
  "assessment": string,
  "plan": string,
  "followUp": string,
  "patientReported": [string],
  "clinicianObserved": [string],
  "warnings": [string]
}
Rules:
- Keep patient-reported statements in patientReported and clinician findings in clinicianObserved; never blur them.
- Only record what the recording or transcript supports. Put anything you could not hear in warnings.
- assessment is a short clinical impression attributed to the attending clinician, not a new diagnosis invented by you.
- plan lists next steps already discussed; do not add drugs or doses that were not said.
- If audio is inaudible or the transcript is empty, say so in warnings.

Visit: ${patient ? `${patient.firstName} ${patient.lastName}` : 'unknown patient'}, presenting complaint: ${encounter.chiefComplaint || 'not recorded'}.
Clinician notes to include: ${notes || 'none'}${transcriptText ? `\nTranscript supplied by staff:\n${transcriptText}` : ''}`

      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: instruction }]
      if (audio) {
        const decoded = decodeBase64(audio, MAX_AUDIO_BYTES, 'recording')
        parts.push({ inlineData: { mimeType, data: decoded.data } })
      }

      const answer = await gemini.generate({
        system: BASE_SYSTEM,
        json: true,
        temperature: 0.2,
        maxOutputTokens: 4096,
        parts,
      })

      const parsed = noteModelSchema.safeParse(extractJson(answer.text))
      if (!parsed.success) fail('The model did not return a usable note. Try again.', 502, 'AI_BAD_RESPONSE')

      const audioSeconds = Number(req.body?.audioSeconds ?? 0)
      const note: ClinicalNote = {
        transcript: parsed.data.transcript.trim() || transcriptText.trim(),
        subjective: parsed.data.subjective.trim(),
        objective: parsed.data.objective.trim(),
        assessment: parsed.data.assessment.trim(),
        plan: parsed.data.plan.trim(),
        followUp: parsed.data.followUp.trim(),
        patientReported: parsed.data.patientReported.filter(Boolean),
        clinicianObserved: parsed.data.clinicianObserved.filter(Boolean),
        warnings: parsed.data.warnings.filter(Boolean),
        audioSeconds: Number.isFinite(audioSeconds) ? Math.max(0, Math.round(audioSeconds)) : 0,
        model: answer.model,
        generatedAt: new Date().toISOString(),
        generatedBy: actor.name,
      }

      const updated = saveNote(db, actor, encounter.id, note)
      res.json({ note, encounter: updated, latencyMs: Date.now() - started })
    } catch (error) {
      aiFailure(error)
    }
  })

  return router
}
