import { chromium } from 'playwright-core'
const base = 'https://afribok.vertexsautomations.com'
const stamp = Date.now().toString().slice(-6)
const account = { name: `Live Admin ${stamp}`, email: `live.${stamp}@afribok.test`, password: 'live-verification-2026' }
let cookie = ''
const results = []
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
async function call(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
    signal: AbortSignal.timeout(150000),
  })
  const set = response.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  let body = null
  try { body = await response.json() } catch {}
  return { status: response.status, body, headers: response.headers }
}
const created = await call('/api/auth/register', { method: 'POST', body: JSON.stringify(account) })
check('first account is created and is the administrator', created.status === 201 && created.body?.user?.role === 'admin', `status ${created.status}, role ${created.body?.user?.role}`)
const departments = (await call('/api/departments')).body.departments
const paeds = departments.find((d) => d.name === 'Paediatrics')
const emergency = departments.find((d) => d.name === 'Emergency')
check('onboarding departments are available', Boolean(paeds && emergency), departments.map((d) => d.name).join(', '))

async function register(first, last, complaint, departmentId, allergies) {
  const now = new Date().toISOString()
  const response = await call('/api/sync', { method: 'POST', body: JSON.stringify({ operations: [{
    id: crypto.randomUUID(), type: 'register_patient', clientTime: now,
    payload: {
      patient: { id: crypto.randomUUID(), hospitalNumber: `LIVE-${Math.floor(Math.random()*90000)+10000}`, firstName: first, lastName: last,
        otherNames: null, sex: 'female', dateOfBirth: '1992-06-15', phone: '0803 111 2222', address: 'Abuja',
        identifierType: null, identifierValue: null, allergies, medicalHistory: 'Hypertension since 2020', currentMedications: 'Amlodipine 5mg daily' },
      encounter: { id: crypto.randomUUID(), arrivedAt: now, chiefComplaint: complaint, departmentId, consentRecorded: true },
      duplicateAcknowledged: true,
    },
  }] }) })
  return response.body?.results?.[0]
}
const p1 = await register('Amina', 'Live', 'Fever and headache for three days', paeds.id, 'Penicillin — rash')
const p2 = await register('Ngozi', 'Live', 'Cough for two weeks', paeds.id, 'None recorded')
const p3 = await register('Ibrahim', 'Live', 'Abdominal pain since morning', paeds.id, 'Sulfa drugs')
const emergencyPatient = await register('Emergency', 'Live', 'Chest pain and sweating', emergency.id, 'None recorded')
check('new patients receive unique identifiers', [p1, p2, p3, emergencyPatient].every((item) => item?.status === 'applied' && item.patient?.hospitalNumber), `${p1?.patient?.hospitalNumber}, ${p2?.patient?.hospitalNumber}`)
check('visits are assigned to departments with consent', p1?.encounter?.departmentName === 'Paediatrics' && p1?.encounter?.consentRecorded === true, `${p1?.encounter?.departmentName} consent=${p1?.encounter?.consentRecorded}`)

const triageResults = []
for (const item of [p1, p2, p3]) {
  const triage = await call('/api/ai/triage', { method: 'POST', body: JSON.stringify({ encounterId: item.encounter.id, notes: 'Recorded at walk-in triage' }) })
  triageResults.push(triage)
}
check('live AI triage returns a level and saves it on each visit', triageResults.every((t) => t.status === 200 && t.body?.assessment?.level >= 1 && t.body?.encounter?.triage?.level === t.body.assessment.level), triageResults.map((t) => `${t.body?.assessment?.level}/${t.body?.assessment?.label}`).join('; '))

const scribe = await call('/api/ai/scribe', { method: 'POST', body: JSON.stringify({ encounterId: p1.encounter.id, transcript: 'Clinician: What brings you in? Patient: Fever and headache for three days. Clinician: Your temperature is 38.2 today, no neck stiffness. Patient: I have a penicillin allergy. Clinician: We will give fluids and review in two days.' }) })
check('live AI scribe drafts a note from a transcript', scribe.status === 200 && Boolean(scribe.body?.note?.subjective), scribe.body?.note?.model || scribe.body?.error)
const approve = await call(`/api/encounters/${p1.encounter.id}/note/approve`, { method: 'POST', body: JSON.stringify({ approved: true }) })
check('clinician can approve the drafted note', approve.status === 200 && Boolean(approve.body?.encounter?.noteApprovedAt), approve.body?.error || '')

const ehrSaved = await call('/api/ehr/integration', { method: 'PUT', body: JSON.stringify({ vendor: 'Mock FHIR', standard: 'FHIR_R4', endpointUrl: 'http://127.0.0.1:4100/fhir', readEnabled: true, writeEnabled: true, credential: '' }) })
const ehrTest = await call('/api/ehr/integration/test', { method: 'POST', body: '{}' })
check('EHR connector saves and tests a real endpoint', ehrSaved.status === 200 && ehrTest.body?.success === true && ehrTest.body?.integration?.capabilities?.patientRead === true, ehrTest.body?.message || ehrSaved.body?.error)
const pull = await call(`/api/ehr/patients/${p1.patient.id}/pull`, { method: 'POST', body: '{}' })
check('Afribok reads authorised patient demographics from the EHR', pull.status === 200 && pull.body?.patient?.phone === '0809 999 0000', pull.body?.error || pull.body?.patient?.phone)
const push = await call(`/api/ehr/encounters/${p1.encounter.id}/push-note`, { method: 'POST', body: '{}' })
const pushAgain = await call(`/api/ehr/encounters/${p1.encounter.id}/push-note`, { method: 'POST', body: '{}' })
check('approved note is written to the EHR and not duplicated', push.status === 200 && push.body?.remoteId === 'doc-1' && pushAgain.body?.alreadySynced === true, push.body?.error || pushAgain.body?.message)

const assistant = await call('/api/assistant/message', { method: 'POST', body: JSON.stringify({ message: 'What allergies and current medications are recorded for this patient?', patientId: p1.patient.id }) })
check('assistant retrieves the selected patient’s authorised record', assistant.status === 200 && /penicillin/i.test(assistant.body?.answer || ''), assistant.body?.answer?.slice(0, 160))
const predictions = await call('/api/predictions?historyDays=90')
check('predictive engine returns inflow, outflow and department cards', predictions.status === 200 && predictions.body?.cards?.length >= 6 && predictions.body.cards.some((c) => c.key === 'inflow'), `${predictions.body?.cards?.length} cards`)
const performance = await call('/api/performance?days=30')
check('performance is measured from recorded timestamps', performance.status === 200 && performance.body?.performance?.counts?.registered >= 4, JSON.stringify(performance.body?.performance?.timings))

const staff = await call('/api/team', { method: 'POST', body: JSON.stringify({ name: 'Live Nurse', email: `nurse.${stamp}@afribok.test`, password: 'live-nurse-2026', role: 'nurse', staffNumber: `N-${stamp}`, phone: '0800 000 0000', departmentId: paeds.id }) })
check('administrator creates an individual staff account', staff.status === 201 && staff.body?.member?.departmentName === 'Paediatrics', staff.body?.error || staff.body?.member?.email)
let nurseCookie = ''
const nurseLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `nurse.${stamp}@afribok.test`, password: 'live-nurse-2026' }) })
nurseCookie = (nurseLogin.headers.get('set-cookie') || '').split(';')[0]
const nurseBootstrap = await fetch(base + '/api/bootstrap', { headers: { cookie: nurseCookie } }).then((r) => r.json())
check('department scoping hides another department’s patient', nurseBootstrap.patients?.length === 3 && !nurseBootstrap.patients.some((p) => p.lastName === 'Live' && p.firstName === 'Emergency'), `${nurseBootstrap.patients?.length} visible`)

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(e.message))
await page.goto(base + '/login', { waitUntil: 'networkidle' })
await page.fill('#email', account.email); await page.fill('#password', account.password); await page.click('.auth-submit')
await page.waitForURL('**/app', { timeout: 30000 }); await page.waitForTimeout(2500)
await page.screenshot({ path: 'screenshots/live-final-dashboard.png', fullPage: true })
const nav = await page.locator('.sidebar-nav').innerText()
check('live UI exposes triage, predictive engine, performance and assistant', ['AI triage', 'Predictive engine', 'Performance', 'AI Assistant'].every((label) => nav.includes(label)), nav.replace(/\n/g, ' | '))
for (const path of ['/app/triage', '/app/predictive', '/app/performance', '/app/assistant', '/app/team']) {
  await page.goto(base + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(1800)
  const body = await page.locator('body').innerText()
  const expected = path.includes('triage') ? 'Batch triage' : path.includes('predictive') ? 'Operational demand forecast' : path.includes('performance') ? 'Measured, not claimed' : path.includes('assistant') ? 'Permission-aware' : 'Add staff member'
  check(`live UI renders ${path}`, body.includes(expected), body.slice(0, 80).replace(/\n/g, ' | '))
  await page.screenshot({ path: `screenshots/live-final-${path.split('/').pop()}.png`, fullPage: true })
}
check('no browser runtime errors on the tested screens', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`RESULT: ${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log(failed.map((f) => f.name).join(' | ')); process.exitCode = 1 }
