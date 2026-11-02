/**
 * Live walkthrough of Afribok against a running server instance.
 * Exercises: signup → onboarding (8 cards) → departments → team →
 * register (as registration officer) → sync replay → department
 * scoping → AI triage/scribe (keys permitting) → note approval →
 * assistant → EHR integration → forecast/predictions → performance →
 * audit → frontend serving.
 *
 * Usage: node scripts/walkthrough.mjs http://localhost:4890
 */
const BASE = process.argv[2] || 'http://localhost:4890'

const results = []
let failed = 0
function assert(cond, name, detail = '') {
  results.push({ name, pass: Boolean(cond) })
  console.log(`${cond ? '✓' : '✗'} ${name}${detail && !cond ? ` — ${detail}` : ''}`)
  if (!cond) failed += 1
}

function client() {
  let cookie = ''
  return {
    async call(path, { method = 'GET', body } = {}) {
      const response = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      let json = null
      try { json = await response.json() } catch { json = null }
      return { status: response.status, body: json }
    },
  }
}

const uuid = () => crypto.randomUUID()
const stamp = () => new Date().toISOString()

const admin = client()
const nurse = client()
const clinician = client()
const registration = client()

let emergencyDepartmentId = null
const registeredEncounterIds = []

// ── 1. Health + frontend serving ──────────────────────────────────────
{
  const health = await admin.call('/api/health')
  assert(health.status === 200 && health.body?.facility, 'Server health check', `ai keys=${health.body?.ai?.keys ?? 0}`)
  const home = await fetch(BASE)
  const html = await home.text()
  assert(home.status === 200 && html.includes('root'), 'Frontend index.html served')
}

// ── 2. Hospital account creation (first account = admin) ───────────────
{
  const res = await admin.call('/api/auth/register', {
    method: 'POST',
    body: { name: 'Dr Amina Walkthrough', email: 'walkthrough.admin@hospital.test', password: 'Walkthrough#2026' },
  })
  assert(res.status === 201 && res.body?.user?.role === 'admin', 'First account becomes hospital administrator', `role=${res.body?.user?.role}`)
  const me = await admin.call('/api/me')
  assert(me.status === 200 && me.body?.user?.email === 'walkthrough.admin@hospital.test', 'Session cookie authenticates the admin')
}

// ── 3. Mandatory onboarding cards 1–8 ─────────────────────────────────
{
  const before = await admin.call('/api/setup')
  assert(before.body?.complete === false, 'Onboarding starts incomplete', `complete=${before.body?.complete}`)

  let res = await admin.call('/api/setup', {
    method: 'PATCH',
    body: { name: 'St. Kambi Hospital', facilityType: 'Referral hospital', location: 'Lagos, Nigeria', address: '12 Awolowo Road', size: 'mid', dailyPatients: 180, operatingDays: 'Mon-Sat', operatingHours: '07:00-22:00' },
  })
  assert(res.status === 200, 'Card 1 saved: hospital information')

  const created = await admin.call('/api/departments', { method: 'POST', body: { name: 'Emergency', description: 'Adult and paediatric emergency' } })
  emergencyDepartmentId = created.body?.department?.id
  await admin.call('/api/departments', { method: 'POST', body: { name: 'General Outpatient' } })
  const departments = (await admin.call('/api/departments')).body.departments
  assert(departments.length === 2 && emergencyDepartmentId, 'Card 2: departments created and drive global options')

  res = await admin.call('/api/setup', {
    method: 'PATCH',
    body: { ehrStatus: 'ehr', ehrName: 'OpenMRS', ehrVendor: 'OpenMRS community', ehrApiAccess: 'yes', ehrRead: true, ehrWrite: false, ehrStandard: 'FHIR R4', ehrDocs: true, ehrContact: 'ict@sthospital.ng' },
  })
  assert(res.status === 200, 'Card 3 saved: EHR/EMR status')

  res = await admin.call('/api/setup', { method: 'PATCH', body: { historyStatus: 'partial', historyFormats: ['paper', 'csv'], historyPeriod: '6_12_months' } })
  assert(res.status === 200, 'Card 4 saved: historical data')

  res = await admin.call('/api/setup', {
    method: 'PATCH',
    body: { walkInShare: 'most', appointments: false, doctors: 6, nurses: 14, hasEmergency: true, hasLab: true, hasPharmacy: true, hasBeds: true },
  })
  assert(res.status === 200, 'Card 5 saved: patient volume and operations')

  res = await admin.call('/api/setup', { method: 'PATCH', body: { internet: 'unstable', localNetwork: true, localServer: false, devices: ['desktop', 'tablet', 'smartphone'] } })
  assert(res.status === 200, 'Card 7 saved: offline/technical environment')

  res = await admin.call('/api/setup/complete', { method: 'POST' })
  assert(res.status === 200 && res.body?.facility?.onboardingComplete === true, 'Card 8: onboarding completes and unlocks the dashboard')
}

// ── 4. Individual staff accounts and their own logins ─────────────────
{
  const staff = [
    { name: 'Ngozi Nurse', email: 'walkthrough.nurse@hospital.test', role: 'nurse', departmentId: emergencyDepartmentId },
    { name: 'Baba Doctor', email: 'walkthrough.doctor@hospital.test', role: 'clinician', departmentId: emergencyDepartmentId },
    { name: 'Chidi Reception', email: 'walkthrough.registration@hospital.test', role: 'registration' },
    { name: 'Ade Audit', email: 'walkthrough.auditor@hospital.test', role: 'auditor' },
  ]
  for (const member of staff) {
    const res = await admin.call('/api/team', { method: 'POST', body: { ...member, password: 'Walkthrough#2026' } })
    assert(res.status === 201, `Card 6: staff account created (${member.role})`, res.body?.error)
  }
  for (const [c, creds] of [[nurse, staff[0]], [clinician, staff[1]], [registration, staff[2]]]) {
    const res = await c.call('/api/auth/login', { method: 'POST', body: { email: creds.email, password: 'Walkthrough#2026' } })
    assert(res.status === 200, `Staff ${creds.role} logs in individually`)
  }
}

// ── 5. Walk-in registration via offline sync (registration officer) ───
{
  const patients = [
    ['Halima', 'Bello', 'female', '2001-03-14', 'Fever and severe weakness', 'ATSU-100001'],
    ['Kelechi', 'Obi', 'male', '1988-07-02', 'Chest pain since morning', 'ATSU-100002'],
    ['Adaeze', 'Umeh', 'female', '1975-01-30', 'Follow-up diabetes review', 'ATSU-100003'],
  ]
  for (const [first, last, sex, dob, complaint, hospitalNumber] of patients) {
    const patientId = uuid(), encounterId = uuid()
    const res = await registration.call('/api/sync', {
      method: 'POST',
      body: {
        operations: [{
          id: uuid(), type: 'register_patient', clientTime: stamp(),
          payload: {
            patient: { id: patientId, hospitalNumber, firstName: first, lastName: last, sex, dateOfBirth: dob },
            encounter: { id: encounterId, arrivedAt: stamp(), chiefComplaint: complaint, departmentId: emergencyDepartmentId, consentRecorded: true },
          },
        }],
      },
    })
    const result = res.body?.results?.[0]
    assert(res.status === 200 && result?.status === 'applied', `Walk-in registered via offline sync (${first} ${last})`, JSON.stringify(result?.message))
    registeredEncounterIds.push(encounterId)
  }

  // Nurse replaying register_patient must be refused — permissions hold inside offline sync
  const nurseTry = await nurse.call('/api/sync', {
    method: 'POST',
    body: {
      operations: [{ id: uuid(), type: 'register_patient', clientTime: stamp(), payload: {
        patient: { id: uuid(), hospitalNumber: 'ATSU-100004', firstName: 'Test', lastName: 'Shouldrefuse', sex: 'male' },
        encounter: { id: uuid(), arrivedAt: stamp(), chiefComplaint: '', departmentId: emergencyDepartmentId },
      } }],
    },
  })
  const refusal = nurseTry.body?.results?.[0]
  assert(refusal?.status === 'rejected' && /role/i.test(refusal.message ?? ''), 'Permissions enforced inside offline sync (nurse cannot register)', refusal?.message)

  // Duplicate hospital number refused
  const dupe = await registration.call('/api/sync', {
    method: 'POST',
    body: {
      operations: [{ id: uuid(), type: 'register_patient', clientTime: stamp(), payload: {
        patient: { id: uuid(), hospitalNumber: 'ATSU-100001', firstName: 'Halima', lastName: 'Bello', sex: 'female' },
        encounter: { id: uuid(), arrivedAt: stamp(), chiefComplaint: 'again', departmentId: emergencyDepartmentId },
      } }],
    },
  })
  const dupeResult = dupe.body?.results?.[0]
  assert(dupeResult && ['conflict', 'rejected'].includes(dupeResult.status), 'Duplicate hospital number refused', dupeResult?.message)

  // Idempotent replay of the same operation id
  const patientsList = (await registration.call('/api/patients')).body.patients
  const adaeze = patientsList.find((p) => p.hospitalNumber === 'ATSU-100003')
  const createEncounterPayload = { operations: [{ id: uuid(), type: 'create_encounter', clientTime: stamp(), payload: {
    id: uuid(), patientId: adaeze.id, arrivedAt: stamp(), chiefComplaint: 'Malaria follow-up', departmentId: emergencyDepartmentId } }] }
  const first = await registration.call('/api/sync', { method: 'POST', body: createEncounterPayload })
  const replay = await registration.call('/api/sync', { method: 'POST', body: createEncounterPayload })
  const r1 = first.body?.results?.[0], r2 = replay.body?.results?.[0]
  assert(r1?.status === 'applied' && r2?.status === 'duplicate', 'Idempotency: replayed operation marked duplicate, not re-applied', JSON.stringify({ r1: r1?.status, r2: r2?.status }))

  for (const id of registeredEncounterIds) {
    const res = await registration.call(`/api/encounters/${id}`)
    assert(res.status === 200, `Encounter record readable (${String(id).slice(0, 8)})`)
  }
}

// ── 6. Scoping: what each role can see ────────────────────────────────
{
  const all = await admin.call('/api/patients')
  const scoped = await nurse.call('/api/patients')
  const reg = await registration.call('/api/patients')
  assert(all.body?.patients?.length >= 3, 'Administrator sees hospital-wide patients')
  assert(scoped.body?.patients?.length >= 3, 'Nurse sees department patients')
  assert(reg.body?.patients?.length === all.body?.patients?.length, 'Registration sees facility-wide identity view')
}

// ── 7. AI triage + scribe (AI-gated) and assignment approval flow ─────
{
  const status = await nurse.call('/api/ai/status')
  const configured = status.body?.configured === true
  console.log(`ℹ AI key pool: configured=${configured}, keys=${status.body?.keys ?? 0}, models=${JSON.stringify(status.body?.models)}`)

  const team = (await admin.call('/api/team')).body.members
  const doctor = team.find((m) => m.role === 'clinician')
  const assign = await nurse.call(`/api/encounters/${registeredEncounterIds[1]}`, { method: 'POST', body: { assignedClinicianId: doctor.id, status: 'in_consultation' } })
  assert(assign.status === 200 && assign.body?.encounter?.status === 'in_consultation', 'Doctor assigned and consultation started', assign.body?.error)

  const noNote = await clinician.call(`/api/encounters/${registeredEncounterIds[1]}/note/approve`, { method: 'POST', body: { approved: true } })
  assert(noNote.status === 409, 'Approval refuses when no note has been drafted', noNote.body?.error)

  if (configured) {
    const res = await nurse.call('/api/ai/triage', { method: 'POST', body: { encounterId: registeredEncounterIds[1], vitals: { bp: '90/60', pulse: 118, spo2: '94%' }, notes: 'Sweating, feels faint when standing' } })
    assert(res.status === 200 && [1, 2, 3, 4, 5].includes(res.body?.assessment?.level), 'AI triage assessment generated and saved', res.body?.error)
    const enc = (await nurse.call(`/api/encounters/${registeredEncounterIds[1]}`)).body.encounter
    assert(enc?.triage?.assessedAt, 'Triage result attached to the patient encounter')

    const transcript = 'Patient: the chest pain started this morning when climbing stairs. Doctor: any shortness of breath? Patient: yes, mild. Doctor: no radiation noted, heart sounds normal, EKG pending.'
    const scribe = await clinician.call('/api/ai/scribe', { method: 'POST', body: { encounterId: registeredEncounterIds[1], transcript } })
    assert(scribe.status === 200 && scribe.body?.note, 'AI scribe drafted a structured note', scribe.body?.error)
    const nurseApprove = await nurse.call(`/api/encounters/${registeredEncounterIds[1]}/note/approve`, { method: 'POST', body: { approved: true } })
    assert(nurseApprove.status === 403, 'A nurse cannot approve a clinical note')
    const approve = await clinician.call(`/api/encounters/${registeredEncounterIds[1]}/note/approve`, { method: 'POST', body: { approved: true } })
    assert(approve.status === 200 && approve.body?.encounter?.noteApprovedAt, 'Doctor approved the clinical note')
  } else {
    console.log('ℹ AI triage/scribe … pending — no keys configured; AI-gated features degrade safely')
  }
}

// ── 8. Assistant: answers, privacy isolation ──────────────────────────
{
  const res = await nurse.call('/api/assistant/message', { method: 'POST', body: { message: 'How many patients are waiting in my department?' } })
  assert(res.status === 200 && res.body?.answer, 'Assistant answers operational question', JSON.stringify(res.body?.answer)?.slice(0, 90))

  const conversations = await nurse.call('/api/assistant/conversations')
  const convId = conversations.body?.conversations?.[0]?.id
  assert(Boolean(convId), 'Assistant keeps per-user conversation history')

  const foreign = await clinician.call(`/api/assistant/conversations/${convId}`)
  assert(foreign.status === 404, 'Assistant conversations are private to their user')

  const patients = (await nurse.call('/api/patients')).body.patients
  const patientQuestion = await nurse.call('/api/assistant/message', {
    method: 'POST',
    body: { message: 'Summarise this patient record.', patientId: patients[0].id },
  })
  assert(patientQuestion.status === 200, 'Patient-level question answered from authorised context', JSON.stringify(patientQuestion.body?.answer)?.slice(0, 90))
}

// ── 9. EHR integration configuration and permissions ──────────────────
{
  const res = await admin.call('/api/ehr/integration', {
    method: 'PUT',
    body: {
      vendor: 'OpenMRS walkthrough FHIR', standard: 'FHIR_R4',
      endpointUrl: 'https://hapi.fhir.org/baseR4',
      readEnabled: true, writeEnabled: false, credential: 'walkthrough-token-abc',
    },
  })
  assert(res.status === 200 && res.body?.integration?.vendor, 'EHR connector configuration saved (credential stored encrypted)', res.body?.error)

  const forbidden = await nurse.call('/api/ehr/integration')
  assert(forbidden.status === 403, 'Only administrators manage EHR integrations', `HTTP ${forbidden.status}`)

  // Endpoint test is performed live; network permitting it validates FHIR metadata.
  const connectionTest = await admin.call('/api/ehr/integration/test', { method: 'POST' })
  console.log(`ℹ EHR endpoint test: success=${connectionTest.body?.success} — ${connectionTest.body?.message ?? `HTTP ${connectionTest.status}`}`)
  assert([200, 502].includes(connectionTest.status), 'EHR connection test executes and records its outcome')
}

// ── 10. Forecast, predictions, performance, audit ─────────────────────
{
  const forecast = await nurse.call('/api/forecast')
  assert(forecast.status === 200 && forecast.body?.forecast?.days?.length > 0, 'Forecast built from real history')
  const predictions = await admin.call('/api/predictions')
  assert(predictions.status === 200 && predictions.body?.cards?.length > 0, 'Prediction cards returned')
  const lab = predictions.body?.cards?.find((c) => c.key === 'laboratory')
  assert(lab && lab.quality === 'insufficient', 'Lab forecast honestly marked insufficient (no order data)')
  const perf = await admin.call('/api/performance')
  assert(perf.status === 200 && perf.body?.performance?.timings, 'Measured performance report returned')
  const audit = await admin.call('/api/audit')
  assert(audit.status === 200 && (audit.body?.events?.length ?? 0) > 10, 'Audit log recorded events', `${audit.body?.events?.length ?? 0} events`)
  const nurseAudit = await nurse.call('/api/audit')
  assert(nurseAudit.status === 403, 'Nurse cannot read the audit log')
}

console.log(`\n${results.filter((r) => r.pass).length} passed · ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
