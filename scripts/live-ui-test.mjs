import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const executablePath =
  process.env.CHROME_PATH || '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
const base = process.env.TARGET_URL || 'https://afribok.vertexsautomations.com'
const shots = '/tmp/afribok-live/shots'
mkdirSync(shots, { recursive: true })

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture=/tmp/afribok-live/consult.wav',
  ],
})

async function signIn(email) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    baseURL: base,
    permissions: ['microphone'],
  })
  const page = await context.newPage()
  const errors = []
  page.on('console', (message) => {
    // The unauthenticated /api/me probe on the sign-in screen is expected.
    if (message.type() === 'error' && !/status of 401/.test(message.text())) errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`))
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.fill('#email', email)
  await page.fill('#password', 'Afribok#2026')
  await page.click('.auth-submit')
  await page.waitForURL('**/app', { timeout: 20000 })
  await page.waitForTimeout(1200)
  return { context, page, errors }
}

let patientId = null
let encounterId = null

// --- Paper record capture + prefill ------------------------------------------
{
  const { context, page, errors } = await signIn('registration@afribok.health')
  await page.goto('/app/register', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /scan paper record/i }).click()
  const dialog = page.locator('[role="dialog"]').first()
  await dialog.waitFor({ state: 'visible', timeout: 10000 })
  await page.setInputFiles('#paper-record-input', '/tmp/afribok-live/poor.jpg')
  await dialog.locator('.scan-fields li').first().waitFor({ timeout: 120000 })
  const fields = await dialog.locator('.scan-fields').innerText()
  await page.screenshot({ path: `${shots}/ocr-dialog.png` })
  await page.getByRole('button', { name: /use these details/i }).click()
  await page.waitForTimeout(600)
  const values = {
    firstName: await page.inputValue('#firstName'),
    lastName: await page.inputValue('#lastName'),
    dateOfBirth: await page.inputValue('#dateOfBirth'),
    phone: await page.inputValue('#phone'),
    address: await page.inputValue('#address'),
    chiefComplaint: await page.inputValue('#chiefComplaint'),
  }
  await page.screenshot({ path: `${shots}/ocr-prefilled.png` })
  record(
    'OCR dialog reads the crooked photo',
    /chinwe/i.test(fields) && /okonkwo/i.test(fields) && /1987-04-12/.test(fields),
    fields.replaceAll('\n', ' | ').slice(0, 150),
  )
  record('form prefilled from the scan', /chinwe/i.test(values.firstName) && /okonkwo/i.test(values.lastName), JSON.stringify(values))
  record('no console errors while capturing a record', errors.length === 0, errors.slice(0, 3).join(' | '))

  // A disposable visit so triage and the scribe do not touch a real record.
  patientId = randomUUID()
  encounterId = randomUUID()
  const now = new Date().toISOString()
  const created = await page.request.post('/api/sync', {
    data: {
      operations: [
        {
          id: randomUUID(),
          type: 'register_patient',
          clientTime: now,
          payload: {
            patient: {
              id: patientId,
              hospitalNumber: `AFB-${String(Math.floor(Math.random() * 9000) + 1000)}`,
              firstName: 'Chinwe',
              lastName: 'Okonkwo',
              otherNames: null,
              sex: 'female',
              dateOfBirth: '1987-04-12',
              phone: '0803 555 0177',
              address: '14 Ademola Street, Wuse 2, Abuja',
              identifierType: 'National ID',
              identifierValue: 'NIN-5521-0093',
            },
            encounter: { id: encounterId, arrivedAt: now, chiefComplaint: 'Fever and headache for 3 days' },
            duplicateAcknowledged: true,
          },
        },
      ],
    },
  })
  const outcome = (await created.json()).results?.[0]?.status
  record('disposable test visit created', outcome === 'applied', outcome)
  writeFileSync('/tmp/afribok-live/ui-patient.txt', `${patientId}\n${encounterId}\n`)
  await context.close()
}

// --- Triage + scribe on that visit -------------------------------------------
{
  const { context, page, errors } = await signIn('nurse@afribok.health')
  await page.goto(`/app/patients/${patientId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  await page.getByRole('button', { name: /run ai triage/i }).first().click()
  await page.locator('.triage-result .triage-badge').first().waitFor({ timeout: 120000 })
  const triageText = await page.locator('.triage-result').innerText()
  await page.screenshot({ path: `${shots}/triage.png` })
  record(
    'triage renders a level from one click',
    /(Immediate|Very urgent|Urgent|Standard|Non-urgent)/i.test(triageText),
    triageText.split('\n').slice(0, 3).join(' / '),
  )

  await page.getByRole('button', { name: /record consultation/i }).first().click()
  await page.waitForTimeout(22000)
  await page.getByRole('button', { name: /stop & draft note/i }).first().click()
  const noteAppeared = await page
    .locator('.note-section')
    .first()
    .waitFor({ timeout: 180000 })
    .then(() => true)
    .catch(() => false)
  const panelText = await page.locator('.clinical-panel').last().innerText()
  await page.screenshot({ path: `${shots}/scribe.png` })
  record(
    'scribe drafts a note from recorded audio',
    noteAppeared && (await page.locator('.note-section').count()) >= 4 && /subjective/i.test(panelText),
    panelText.replaceAll('\n', ' | ').slice(0, 260),
  )
  record('no console errors on the clinical page', errors.length === 0, errors.slice(0, 3).join(' | '))
  await context.close()
}

// --- Outflow forecast page ---------------------------------------------------
{
  const { context, page, errors } = await signIn('admin@afribok.health')
  await page.goto('/app/outflow', { waitUntil: 'networkidle' })
  await page.locator('.forecast-kpi').first().waitFor({ timeout: 60000 })
  const kpis = await page.locator('.forecast-kpis').innerText()
  const days = await page.locator('.forecast-day').count()
  await page.screenshot({ path: `${shots}/forecast.png` })
  record('forecast page renders KPIs', kpis.includes('%'), kpis.replaceAll('\n', ' | ').slice(0, 200))
  record('forecast page lists seven days', days === 7, `${days} day(s)`)
  record('no console errors on the forecast page', errors.length === 0, errors.slice(0, 3).join(' | '))
  await context.close()
}

await browser.close()
const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`)
if (failed.length) process.exit(1)
