import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app'
import { closeDatabase, openDatabase, type AfribokDb } from '../server/db'
import { TEST_PASSWORD, seedTestFixture } from './helpers'

// The suite runs against sample patients from the seed; a live clinic starts empty.
const EMAILS = {
  registration: 'registration@afribok.health',
  nurse: 'nurse@afribok.health',
  clinician: 'clinician@afribok.health',
  admin: 'admin@afribok.health',
  auditor: 'auditor@afribok.health',
}

let db: AfribokDb
let app: ReturnType<typeof createApp>

beforeEach(() => {
  db = openDatabase(':memory:')
  seedTestFixture(db)
  app = createApp({ db, seed: false, serveFrontend: false })
})

afterEach(() => {
  closeDatabase(db)
})

async function signIn(email: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD })
  expect(response.status).toBe(200)
  expect(response.headers['set-cookie']?.[0]).toContain('afribok_session=')
  return { agent, user: response.body.user as { id: string; role: string; name: string } }
}

function registrationOperation(overrides: {
  firstName?: string
  lastName?: string
  dateOfBirth?: string | null
  phone?: string | null
  hospitalNumber?: string
  opId?: string
  patientId?: string
} = {}) {
  const now = new Date().toISOString()
  const patientId = overrides.patientId ?? randomUUID()
  const payload = {
    patient: {
      id: patientId,
      hospitalNumber: overrides.hospitalNumber ?? `AFB-${Math.floor(Math.random() * 9000) + 1000}`,
      firstName: overrides.firstName ?? 'Nia',
      lastName: overrides.lastName ?? 'Okafor',
      otherNames: null,
      sex: 'female',
      dateOfBirth: overrides.dateOfBirth === undefined ? '1994-04-12' : overrides.dateOfBirth,
      phone: overrides.phone === undefined ? '0803 000 0000' : overrides.phone,
      address: 'Kubwa, Abuja',
      identifierType: null,
      identifierValue: null,
    },
    encounter: {
      id: randomUUID(),
      arrivedAt: now,
      chiefComplaint: 'Headache for two days',
    },
    duplicateAcknowledged: false,
  }
  return {
    id: overrides.opId ?? randomUUID(),
    type: 'register_patient' as const,
    clientTime: now,
    payload,
    patientId,
  }
}

describe('health and authentication', () => {
  it('reports a healthy facility and protects patient data', async () => {
    const health = await request(app).get('/api/health')
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({
      status: 'ok',
      stage: 'Stage 2 · live clinic deployment',
      mode: 'LIVE',
    })
    expect(health.body.time).toBeTruthy()

    const anonymous = await request(app).get('/api/bootstrap')
    expect(anonymous.status).toBe(401)
    expect(anonymous.body.error).toMatch(/sign in/i)
  })

  it('accepts only the issued clinic password and starts a session', async () => {
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAILS.registration, password: 'not-the-password' })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error).toMatch(/incorrect/i)

    const { agent, user } = await signIn(EMAILS.registration)
    expect(user.role).toBe('registration')
    expect(user.name).toBe('Adaeze Okafor')

    const me = await agent.get('/api/me')
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe(EMAILS.registration)
    // The seeded suite never runs onboarding, so the facility has no name yet.
    expect(me.body.facility.onboardingComplete).toBe(false)
    expect(me.body.facility.name).toBe('Hospital setup')

    const logout = await agent.post('/api/auth/logout')
    expect(logout.status).toBe(204)
    const afterLogout = await agent.get('/api/me')
    expect(afterLogout.status).toBe(401)
  })

  it('records failed and successful sign-ins in the audit trail', async () => {
    const { agent } = await signIn(EMAILS.admin)
    await request(app)
      .post('/api/auth/login')
      .send({ email: EMAILS.registration, password: 'wrong-on-purpose' })

    const audit = await agent.get('/api/audit?limit=50')
    expect(audit.status).toBe(200)
    const actions = audit.body.events.map((event: { action: string }) => event.action)
    expect(actions).toContain('auth.signed_in')
    expect(actions).toContain('auth.sign_in_failed')
    const failed = audit.body.events.find(
      (event: { action: string }) => event.action === 'auth.sign_in_failed',
    )
    expect(failed.detail.reason).toBe('invalid_credentials')
  })
})

describe('role permissions', () => {
  it('lets an auditor read the audit trail but not manage patients or the team', async () => {
    const { agent } = await signIn(EMAILS.auditor)

    expect((await agent.get('/api/audit')).status).toBe(200)
    expect((await agent.get('/api/team')).status).toBe(403)
    expect((await agent.get('/api/bootstrap')).status).toBe(200)

    const denial = await agent.post('/api/sync').send({
      operations: [registrationOperation()],
    })
    expect(denial.status).toBe(200)
    expect(denial.body.results[0].status).toBe('rejected')
    expect(denial.body.results[0].message).toMatch(/role does not allow/i)

    const assignments = await request(app).get('/api/team')
    expect(assignments.status).toBe(401)
  })

  it('stops a registration officer from reading audit events or changing encounters', async () => {
    const { agent } = await signIn(EMAILS.registration)
    expect((await agent.get('/api/audit')).status).toBe(403)

    const bootstrap = await agent.get('/api/bootstrap')
    const waiting = bootstrap.body.encounters.find(
      (encounter: { status: string }) => encounter.status === 'waiting',
    )
    const attempt = await agent.post('/api/sync').send({
      operations: [
        {
          id: randomUUID(),
          type: 'update_encounter',
          clientTime: new Date().toISOString(),
          payload: { encounterId: waiting.id, baseVersion: waiting.version, status: 'completed' },
        },
      ],
    })
    expect(attempt.body.results[0].status).toBe('rejected')
    expect(attempt.body.results[0].message).toMatch(/role does not allow/i)
  })
})

describe('patient registration and duplicate safety', () => {
  it('applies a registration exactly once when an offline device retries it', async () => {
    const { agent } = await signIn(EMAILS.registration)
    const operation = registrationOperation({ hospitalNumber: 'AFB-9001' })
    const { patientId } = operation

    const first = await agent
      .post('/api/sync')
      .send({ operations: [operation] })
    expect(first.status).toBe(200)
    expect(first.body.results[0].status).toBe('applied')
    expect(first.body.results[0].patient.hospitalNumber).toBe('AFB-9001')

    const replay = await agent
      .post('/api/sync')
      .send({ operations: [operation] })
    expect(replay.status).toBe(200)
    expect(replay.body.results[0].status).toBe('duplicate')

    const bootstrap = await agent.get('/api/bootstrap')
    expect(
      bootstrap.body.patients.filter((patient: { id: string }) => patient.id === patientId),
    ).toHaveLength(1)

    const { agent: admin } = await signIn(EMAILS.admin)
    const audit = await admin.get('/api/audit?limit=200')
    const created = audit.body.events.filter(
      (event: { action: string; entityId: string }) =>
        event.action === 'patient.created' && event.entityId === patientId,
    )
    expect(created).toHaveLength(1)

    const applied = audit.body.events.filter(
      (event: { action: string; detail: { operationType?: string } }) =>
        event.action === 'sync.operation_applied' && event.detail.operationType === 'register_patient',
    )
    expect(applied.length).toBeGreaterThanOrEqual(1)
  }, 20000)

  it('surfaces likely duplicates to a human instead of creating a second record', async () => {
    const { agent } = await signIn(EMAILS.registration)
    const operation = registrationOperation({
      firstName: 'Amina',
      lastName: 'Yusuf',
      dateOfBirth: '1992-06-15',
      phone: '0803 555 0142',
      hospitalNumber: 'AFB-9900',
    })

    const response = await agent.post('/api/sync').send({ operations: [operation] })
    expect(response.status).toBe(200)
    const result = response.body.results[0]
    expect(result.status).toBe('conflict')
    expect(result.message).toMatch(/possible existing record/i)
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates[0].patient.lastName).toBe('Yusuf')
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(0.8)

    const bootstrap = await agent.get('/api/bootstrap')
    expect(
      bootstrap.body.patients.some((patient: { id: string }) => patient.id === operation.patientId),
    ).toBe(false)
  })

  it('flags an existing hospital number instead of writing a second record', async () => {
    const { agent } = await signIn(EMAILS.registration)
    const operation = registrationOperation({
      firstName: 'New',
      lastName: 'Person',
      dateOfBirth: null,
      phone: null,
      hospitalNumber: 'AFB-1001',
    })
    const response = await agent.post('/api/sync').send({ operations: [operation] })
    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('conflict')
    expect(response.body.results[0].message).toMatch(/possible existing record/i)
    expect(response.body.results[0].candidates[0].reasons).toContain('Same hospital number')

    const bootstrap = await agent.get('/api/bootstrap')
    expect(
      bootstrap.body.patients.filter((patient: { hospitalNumber: string }) =>
        patient.hospitalNumber === 'AFB-1001',
      ),
    ).toHaveLength(1)
  })

  it('validates malformed offline operations before writing anything', async () => {
    const { agent } = await signIn(EMAILS.registration)
    const before = await agent.get('/api/bootstrap')

    const invalid = registrationOperation({ hospitalNumber: 'bad number!' })
    invalid.payload.patient.dateOfBirth = '31-12-1990'
    const response = await agent.post('/api/sync').send({ operations: [invalid] })
    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/hospitalNumber|dateOfBirth/)

    const after = await agent.get('/api/bootstrap')
    expect(after.body.patients).toHaveLength(before.body.patients.length)
  })
})

describe('visit status transitions', () => {
  it('advances a waiting visit and refuses a stale device copy', async () => {
    const { agent } = await signIn(EMAILS.nurse)
    const bootstrap = await agent.get('/api/bootstrap')
    const waiting = bootstrap.body.encounters.find(
      (encounter: { status: string }) => encounter.status === 'waiting',
    )
    expect(waiting).toBeTruthy()

    const advance = await agent.post('/api/sync').send({
      operations: [
        {
          id: randomUUID(),
          type: 'update_encounter',
          clientTime: new Date().toISOString(),
          payload: {
            encounterId: waiting.id,
            baseVersion: waiting.version,
            status: 'in_consultation',
          },
        },
      ],
    })
    expect(advance.body.results[0].status).toBe('applied')
    expect(advance.body.results[0].encounter.status).toBe('in_consultation')
    expect(advance.body.results[0].encounter.version).toBe(waiting.version + 1)

    const stale = await agent.post('/api/sync').send({
      operations: [
        {
          id: randomUUID(),
          type: 'update_encounter',
          clientTime: new Date().toISOString(),
          payload: {
            encounterId: waiting.id,
            baseVersion: waiting.version,
            status: 'completed',
          },
        },
      ],
    })
    expect(stale.body.results[0].status).toBe('conflict')
    expect(stale.body.results[0].serverEncounter.status).toBe('in_consultation')
    expect(stale.body.results[0].serverEncounter.version).toBe(waiting.version + 1)
  })

  it('refuses to reopen a completed visit', async () => {
    const { agent } = await signIn(EMAILS.clinician)
    const bootstrap = await agent.get('/api/bootstrap')
    const completed = bootstrap.body.encounters.find(
      (encounter: { status: string }) => encounter.status === 'completed',
    )

    const response = await agent.post('/api/sync').send({
      operations: [
        {
          id: randomUUID(),
          type: 'update_encounter',
          clientTime: new Date().toISOString(),
          payload: {
            encounterId: completed.id,
            baseVersion: completed.version,
            status: 'waiting',
          },
        },
      ],
    })
    expect(response.body.results[0].status).toBe('rejected')
    expect(response.body.results[0].message).toMatch(/cannot move to waiting/i)
  })
})

describe('team administration', () => {
  it('prevents self-lockout and deactivates a member with an audit record', async () => {
    const { agent, user } = await signIn(EMAILS.admin)

    const self = await agent.patch(`/api/team/${user.id}`).send({ role: 'auditor' })
    expect(self.status).toBe(409)
    expect(self.body.code).toBe('SELF_CHANGE')

    const team = await agent.get('/api/team')
    const target = team.body.members.find(
      (member: { email: string }) => member.email === EMAILS.registration,
    )
    expect(target).toBeTruthy()

    const disabled = await agent.patch(`/api/team/${target.id}`).send({ active: false })
    expect(disabled.status).toBe(200)
    expect(disabled.body.member.active).toBe(false)

    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAILS.registration, password: TEST_PASSWORD })
    expect(blocked.status).toBe(401)

    const audit = await agent.get('/api/audit?limit=200')
    const changed = audit.body.events.find(
      (event: { action: string; entityId: string }) =>
        event.action === 'team.member_updated' && event.entityId === target.id,
    )
    expect(changed.detail.toActive).toBe(false)
  })
})

describe('account creation', () => {
  const newAccount = {
    name: 'Blessing Adeyemi',
    email: 'blessing@northstar.health',
    password: 'ward-round-2026',
    role: 'registration',
  }

  it('saves the account, signs the person in, and accepts it on another device', async () => {
    const agent = request.agent(app)
    const created = await agent.post('/api/auth/register').send(newAccount)
    expect(created.status).toBe(201)
    expect(created.body.user).toMatchObject({
      name: 'Blessing Adeyemi',
      email: newAccount.email,
      role: 'registration',
      facilityName: 'Hospital setup',
    })
    expect(created.headers['set-cookie']?.[0]).toContain('afribok_session=')

    const me = await agent.get('/api/me')
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe(newAccount.email)

    // A second device signs in with the same credentials: the account is in the database.
    const otherDevice = await request(app)
      .post('/api/auth/login')
      .send({ email: newAccount.email, password: newAccount.password })
    expect(otherDevice.status).toBe(200)
    expect(otherDevice.body.user.email).toBe(newAccount.email)

    const { agent: adminAgent } = await signIn(EMAILS.admin)
    const audit = await adminAgent.get('/api/audit?limit=200')
    expect(
      audit.body.events.some(
        (event: { action: string; actorName: string }) =>
          event.action === 'auth.account_created' && event.actorName === 'Blessing Adeyemi',
      ),
    ).toBe(true)
  })

  it('refuses duplicate emails, short passwords and self-granted administrator access', async () => {
    const duplicate = await request(app).post('/api/auth/register').send(newAccount)
    expect(duplicate.status).toBe(201)

    const again = await request(app).post('/api/auth/register').send(newAccount)
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('EMAIL_TAKEN')

    const shortPassword = await request(app)
      .post('/api/auth/register')
      .send({ ...newAccount, email: 'short@northstar.health', password: 'short' })
    expect(shortPassword.status).toBe(400)

    const admin = await request(app)
      .post('/api/auth/register')
      .send({ ...newAccount, email: 'admin-claim@northstar.health', role: 'admin' })
    expect(admin.status).toBe(400)
  })

  it('gives a new registration account the same server-enforced limits as a seeded one', async () => {
    const agent = request.agent(app)
    await agent.post('/api/auth/register').send(newAccount)

    const dashboard = await agent.get('/api/bootstrap')
    expect(dashboard.status).toBe(200)

    const audit = await agent.get('/api/audit')
    expect(audit.status).toBe(403)

    const team = await agent.get('/api/team')
    expect(team.status).toBe(403)
  })
})

describe('connected platform modules', () => {
  it('keeps assistant conversations private and refuses patient-specific clinical retrieval', async () => {
    const { agent: nurse } = await signIn(EMAILS.nurse)
    const answer = await nurse.post('/api/assistant/message').send({ message: 'How many patients are waiting right now?' })
    expect(answer.status).toBe(200)
    expect(answer.body.answer).toMatch(/waiting/i)
    expect(answer.body.privacy).toMatch(/not sent/i)
    const conversationId = answer.body.conversationId as string

    const { agent: clinician } = await signIn(EMAILS.clinician)
    expect((await clinician.get(`/api/assistant/conversations/${conversationId}`)).status).toBe(404)
    const privateRequest = await nurse.post('/api/assistant/message').send({
      conversationId,
      message: 'Show me this patient’s allergies and diagnosis.',
    })
    expect(privateRequest.status).toBe(200)
    expect(privateRequest.body.answer).toMatch(/patient record/i)
    expect((await clinician.get('/api/assistant/conversations')).body.conversations).toHaveLength(0)
  })

  it('lets only administrators configure an EHR integration and never returns credentials', async () => {
    const { agent: nurse } = await signIn(EMAILS.nurse)
    expect((await nurse.get('/api/ehr/integration')).status).toBe(403)

    const { agent: admin } = await signIn(EMAILS.admin)
    const saved = await admin.put('/api/ehr/integration').send({
      vendor: 'Regional EHR', standard: 'FHIR_R4', endpointUrl: 'https://ehr.example.org/fhir/R4',
      readEnabled: true, credential: '',
    })
    expect(saved.status).toBe(200)
    expect(saved.body.integration).toMatchObject({
      vendor: 'Regional EHR', standard: 'FHIR_R4', status: 'configured', readEnabled: true,
      capabilities: { patientRead: false, approvedWriteBack: false },
    })
    expect(saved.body.integration).not.toHaveProperty('credential')
    expect(saved.body.integration).not.toHaveProperty('auth_token_ciphertext')
    expect((await admin.get('/api/ehr/integration')).body.integration.endpointUrl).toContain('ehr.example.org')
  })

  it('imports only aggregate history and rejects patient-identifying columns', async () => {
    const { agent: registration } = await signIn(EMAILS.registration)
    expect((await registration.post('/api/history/import').send({ csv: 'date,arrivals\n2026-01-01,5' })).status).toBe(403)

    const { agent: admin } = await signIn(EMAILS.admin)
    const date = new Date(Date.now() - 12 * 86_400_000).toISOString().slice(0, 10)
    const imported = await admin.post('/api/history/import').send({
      fileName: 'daily-summary.csv',
      csv: `date,department,arrivals,triaged,completed,waiting\n${date},Emergency,12,11,9,3`,
    })
    expect(imported.status).toBe(201)
    expect(imported.body.importedRows).toBe(1)
    expect((await admin.get('/api/history')).body.metrics[0]).toMatchObject({
      date, department: 'Emergency', arrivals: 12, triaged: 11, completed: 9, waiting: 3,
    })
    const forecast = await admin.get('/api/forecast')
    expect(forecast.status).toBe(200)
    expect(forecast.body.forecast.history.encounters).toBeGreaterThanOrEqual(12)
    expect(forecast.body.forecast.history.note).toMatch(/imported aggregate/i)
    const rejected = await admin.post('/api/history/import').send({
      csv: `date,arrivals,patient_name\n${date},1,Example Patient`,
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.error).toMatch(/aggregate operational data only/i)
  })
})
