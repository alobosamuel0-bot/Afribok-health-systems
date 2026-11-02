import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app'
import { closeDatabase, openDatabase, type AfribokDb } from '../server/db'
import type { GeminiClient, GeminiInput } from '../server/gemini'
import { TEST_PASSWORD, seedTestFixture } from './helpers'

/**
 * The clinical AI features are tested against a stub model so the suite never
 * calls Gemini. The live deployment is exercised separately against the real API.
 */
const stubCalls: GeminiInput[] = []

function stubModel(input: GeminiInput): string {
  const prompt = input.parts[0]?.text ?? ''
  if (prompt.includes('Extract the patient details') || prompt.includes('paper clinic record')) {
    return JSON.stringify({
      legible: true,
      documentType: 'patient registration card',
      fields: {
        firstName: { value: 'Chinwe', confidence: 0.93 },
        lastName: { value: 'Okonkwo', confidence: 0.91 },
        otherNames: { value: null, confidence: 0 },
        sex: { value: 'female', confidence: 0.88 },
        dateOfBirth: { value: '1987-04-12', confidence: 0.74 },
        phone: { value: '0803 555 0177', confidence: 0.81 },
        address: { value: '14 Ademola Street, Wuse 2, Abuja', confidence: 0.66 },
        hospitalNumber: { value: 'AFB-2048', confidence: 0.9 },
        identifierType: { value: 'National ID', confidence: 0.6 },
        identifierValue: { value: 'NIN-5521-0093', confidence: 0.72 },
        chiefComplaint: { value: 'Fever and headache for 3 days', confidence: 0.8 },
      },
      confidence: 0.79,
      warnings: ['Date of birth read from handwriting'],
      rawText: 'NORTHSTAR CLINIC - PATIENT RECORD\nHospital No: AFB-2048',
    })
  }
  if (prompt.includes('triage urgency')) {
    return JSON.stringify({
      level: 2,
      redFlags: ['Fever with neck stiffness'],
      observations: ['Repeat temperature', 'Check capillary refill'],
      disposition: 'Urgent bay, seen within 10 minutes',
      reasoning: 'Fever with a danger sign needs urgent review.',
      confidence: 0.71,
    })
  }
  return JSON.stringify({
    transcript: 'Patient reports fever for three days.',
    subjective: 'Fever for three days.',
    objective: 'Temperature 38.6 C.',
    assessment: 'Likely viral illness.',
    plan: 'Paracetamol and fluids.',
    followUp: 'Review in three days.',
    patientReported: ['Fever for three days'],
    clinicianObserved: ['Temperature 38.6 C'],
    warnings: [],
  })
}

const fakeGemini = {
  configured: true,
  keyCount: 1,
  model: 'stub-model',
  describe: () => ({ configured: true, keys: 1, models: ['stub-model'], availableKeys: 1 }),
  generate: async (input: GeminiInput) => {
    stubCalls.push(input)
    return { text: stubModel(input), model: 'stub-model', latencyMs: 1, keySlot: 0 }
  },
} as unknown as GeminiClient

let db: AfribokDb
let app: ReturnType<typeof createApp>

beforeEach(() => {
  stubCalls.length = 0
  db = openDatabase(':memory:')
  seedTestFixture(db)
  app = createApp({ db, seed: false, serveFrontend: false, ai: fakeGemini })
})

afterEach(() => {
  closeDatabase(db)
})

async function signIn(email: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD })
  expect(response.status).toBe(200)
  return agent
}

async function registerVisit(agent: Awaited<ReturnType<typeof signIn>>) {
  const now = new Date().toISOString()
  const response = await agent.post('/api/sync').send({
    operations: [
      {
        id: randomUUID(),
        type: 'register_patient',
        clientTime: now,
        payload: {
          patient: {
            id: randomUUID(),
            hospitalNumber: `AFB-${Math.floor(Math.random() * 9000) + 1000}`,
            firstName: 'Chinwe',
            lastName: 'Okonkwo',
            otherNames: null,
            sex: 'female',
            dateOfBirth: '1987-04-12',
            phone: '0803 555 0177',
            address: 'Wuse 2, Abuja',
            identifierType: null,
            identifierValue: null,
          },
          encounter: {
            id: randomUUID(),
            arrivedAt: now,
            chiefComplaint: 'Fever and headache for 3 days',
          },
          duplicateAcknowledged: true,
        },
      },
    ],
  })
  expect(response.body.results[0].status).toBe('applied')
  return response.body.results[0].encounter as { id: string }
}

describe('clinical AI access control', () => {
  it('requires a signed-in user before any AI endpoint runs', async () => {
    const status = await request(app).get('/api/ai/status')
    expect(status.status).toBe(401)

    const ocr = await request(app).post('/api/ai/ocr').send({ imageBase64: 'AAAA', mimeType: 'image/png' })
    expect(ocr.status).toBe(401)
    expect(stubCalls).toHaveLength(0)
  })

  it('refuses triage for a role that cannot change encounters', async () => {
    const registration = await signIn('registration@afribok.health')
    const encounter = await registerVisit(registration)
    const response = await registration.post('/api/ai/triage').send({ encounterId: encounter.id })
    expect(response.status).toBe(403)
    expect(stubCalls).toHaveLength(0)
  })
})

describe('paper record capture', () => {
  it('extracts fields with confidences and flags low-confidence reads', async () => {
    const registration = await signIn('registration@afribok.health')
    const image = Buffer.from('not-a-real-jpeg').toString('base64')
    const response = await registration
      .post('/api/ai/ocr')
      .send({ imageBase64: `data:image/png;base64,${image}`, mimeType: 'image/png' })

    expect(response.status).toBe(200)
    const { extraction } = response.body
    expect(extraction.fields.firstName.value).toBe('Chinwe')
    expect(extraction.fields.lastName.value).toBe('Okonkwo')
    expect(extraction.fields.address.confidence).toBeCloseTo(0.66)
    expect(extraction.warnings[0]).toMatch(/handwriting/i)
    expect(extraction.legible).toBe(true)
    expect(stubCalls[0].parts.some((part) => part.inlineData?.mimeType === 'image/png')).toBe(true)
  })

  it('rejects a file that is not a photograph', async () => {
    const registration = await signIn('registration@afribok.health')
    const response = await registration
      .post('/api/ai/ocr')
      .send({ imageBase64: 'AAAA', mimeType: 'application/pdf' })
    expect(response.status).toBe(400)
    expect(stubCalls).toHaveLength(0)
  })
})

describe('triage and scribe', () => {
  it('saves a triage level onto the visit and returns it in the worklist', async () => {
    const registration = await signIn('registration@afribok.health')
    const encounter = await registerVisit(registration)
    const nurse = await signIn('nurse@afribok.health')

    const response = await nurse.post('/api/ai/triage').send({
      encounterId: encounter.id,
      vitals: { temperature: '38.6 °C', bloodPressure: '118/74' },
      notes: 'Neck stiffness on examination',
    })

    expect(response.status).toBe(200)
    expect(response.body.assessment).toMatchObject({ level: 2, label: 'Very urgent' })
    expect(response.body.assessment.assessedBy).toBe('Mariam Diallo')
    expect(response.body.encounter.triage.level).toBe(2)

    const visit = await nurse.get(`/api/encounters/${encounter.id}`)
    expect(visit.body.encounter.triage.redFlags).toContain('Fever with neck stiffness')
  })

  it('drafts a note from a transcript and keeps patient statements separate', async () => {
    const registration = await signIn('registration@afribok.health')
    const encounter = await registerVisit(registration)
    const clinician = await signIn('clinician@afribok.health')

    const response = await clinician.post('/api/ai/scribe').send({
      encounterId: encounter.id,
      transcript: 'Patient: I have had fever for three days. Clinician: Your temperature is 38.6 today.',
    })

    expect(response.status).toBe(200)
    expect(response.body.note).toMatchObject({
      assessment: 'Likely viral illness.',
      plan: 'Paracetamol and fluids.',
      generatedBy: 'Dr. Chidi Balogun',
    })
    expect(response.body.note.patientReported).toEqual(['Fever for three days'])
    expect(response.body.note.clinicianObserved).toEqual(['Temperature 38.6 C'])

    const visit = await clinician.get(`/api/encounters/${encounter.id}`)
    expect(visit.body.encounter.note.subjective).toBe('Fever for three days.')
  })

  it('refuses an empty scribe request instead of inventing a note', async () => {
    const registration = await signIn('registration@afribok.health')
    const encounter = await registerVisit(registration)
    const clinician = await signIn('clinician@afribok.health')

    const response = await clinician.post('/api/ai/scribe').send({ encounterId: encounter.id })
    expect(response.status).toBe(400)
    expect(stubCalls).toHaveLength(0)
  })
})

describe('outflow forecast', () => {
  it('keeps a young clinic on a blended profile instead of projecting nothing', async () => {
    const admin = await signIn('admin@afribok.health')
    const response = await admin.get('/api/forecast?historyDays=90&horizonHours=24')

    expect(response.status).toBe(200)
    const { forecast } = response.body
    expect(forecast.hours).toHaveLength(24)
    expect(forecast.days).toHaveLength(7)
    expect(forecast.history.warmingUp).toBe(true)
    expect(forecast.history.confidence).toBe('low')

    for (const day of forecast.days) {
      expect(day.expectedVisits).toBeGreaterThan(0)
      expect(day.capacityVisits).toBeGreaterThan(0)
    }
    expect(forecast.now.consultUtilization).toBeLessThanOrEqual(1.5)
    expect(forecast.hours.some((hour: { expectedArrivals: number }) => hour.expectedArrivals > 0)).toBe(true)
  })

  it('uses the capacity an administrator records for beds and equipment', async () => {
    const admin = await signIn('admin@afribok.health')
    const saved = await admin.put('/api/capacity').send({
      consultRooms: 3,
      beds: 12,
      clinicians: 4,
      equipment: [{ name: 'Nebuliser', units: 2 }],
    })
    expect(saved.status).toBe(200)
    expect(saved.body.capacity.beds).toBe(12)

    const response = await admin.get('/api/forecast')
    expect(response.body.forecast.now.staffOnDuty).toBe(4)
    expect(response.body.forecast.equipment[0]).toMatchObject({ name: 'Nebuliser', units: 2 })
  })
})
