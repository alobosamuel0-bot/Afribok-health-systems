/**
 * Drives the hospital onboarding cards on the live deployment: signs in as the
 * administrator, proves the dashboard is gated, answers all eight cards, and
 * checks the answers are stored on the server.
 *
 *   TARGET_URL=https://afribok.vertexsautomations.com node scripts/live-setup-test.mjs
 */
import { chromium } from 'playwright-core'

const executablePath =
  process.env.CHROME_PATH || '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
const base = process.env.TARGET_URL || 'https://afribok.vertexsautomations.com'
const admin = { email: 'admin@afribok.health', password: 'Afribok#2026' }

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const failures = []
page.on('pageerror', (error) => failures.push(`PAGEERROR ${error.message}`))

async function check(label, run) {
  try {
    await run()
    console.log(`PASS ${label}`)
  } catch (error) {
    console.log(`FAIL ${label}: ${error.message}`)
    failures.push(label)
  }
}

const field = (label) => page.locator('.setup-field', { hasText: label }).locator('input, select').first()
const next = () => page.getByRole('button', { name: /Save and continue/ }).click()

let needsSetup = false

await check('sign-in sends an unconfigured hospital to setup', async () => {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await page.fill('#email', admin.email)
  await page.fill('#password', admin.password)
  await page.click('.auth-submit')
  // Sign-in lands on /app and the gate redirects to /setup; accept either end state.
  await page.waitForFunction(
    () => location.pathname === '/setup' || !!document.querySelector('.page-header'),
    null,
    { timeout: 30000 },
  )
  needsSetup = new URL(page.url()).pathname === '/setup'
  if (!needsSetup) {
    console.log('  setup already complete on this deployment — verifying stored answers only')
    return
  }
  await page.waitForSelector('.setup-card', { timeout: 20000 })
  const heading = await page.locator('.setup-card h1').innerText()
  if (!/hospital/i.test(heading)) throw new Error(`unexpected setup heading: ${heading}`)
})

if (needsSetup) {
  await check('card 1 saves hospital information', async () => {
    await field('Hospital or clinic name').fill('Afribok Clinic')
    await field('Type of facility').selectOption({ label: 'General hospital' })
    await field('Town, city or district').fill('Abuja, Nigeria')
    await field('Street address').fill('14 Ahmadu Bello Way')
    await field('Approximate size').fill('40 beds, 6 consulting rooms')
    await field('Patients seen on a typical day').fill('120')
    await field('Operating days').fill('Monday to Saturday')
    await field('Operating hours').fill('08:00 – 18:00, emergency 24 hours')
    await next()
    await page.waitForSelector('text=Which departments are available?', { timeout: 20000 })
  })

  await check('card 2 creates the hospital departments', async () => {
    for (const name of [
      'Emergency',
      'General Outpatient',
      'Paediatrics',
      'Obstetrics and Gynaecology',
      'Laboratory',
      'Pharmacy',
    ]) {
      await field('Department name').fill(name)
      await page.getByRole('button', { name: /Add department/ }).click()
      await page.locator('.setup-dept-row', { hasText: name }).first().waitFor({ timeout: 15000 })
    }
    const rows = await page.locator('.setup-dept-row').count()
    if (rows < 6) throw new Error(`expected 6 departments, saw ${rows}`)
    await next()
    await page.waitForSelector('text=Do you already use an electronic record system?', { timeout: 20000 })
  })

  await check('cards 3 and 4 record the EHR and history answers', async () => {
    await page.locator('.setup-option', { hasText: 'No, our records are primarily paper-based' }).click()
    await next()
    await page.waitForSelector('text=What historical data exists today?', { timeout: 20000 })
    await page.locator('.setup-option', { hasText: 'No historical records available' }).click()
    await next()
    await page.waitForSelector('text=How does the hospital run day to day?', { timeout: 20000 })
  })

  await check('card 5 records volume and services', async () => {
    await field('Doctors available').fill('8')
    await field('Nurses available').fill('21')
    await next()
    await page.waitForSelector('text=Who will use Afribok?', { timeout: 20000 })
  })

  await check('card 6 shows the staff accounts', async () => {
    const rows = await page.locator('.setup-dept-row').count()
    if (rows < 1) throw new Error('no staff accounts listed')
    await next()
    await page.waitForSelector('text=How should the workspace run here?', { timeout: 20000 })
  })

  await check('card 7 records the technical environment', async () => {
    await page.locator('.setup-option', { hasText: 'Internet is available but drops frequently' }).click()
    await page.locator('.setup-check', { hasText: 'Desktop computers' }).click()
    await page.locator('.setup-check', { hasText: 'Tablets' }).click()
    await page.locator('.setup-check', { hasText: 'internal local network' }).click()
    await next()
    await page.waitForSelector('text=Check the answers before you begin', { timeout: 20000 })
  })

  await check('card 8 finishes setup and opens the dashboard', async () => {
    await page.getByRole('button', { name: /Finish setup and open dashboard/ }).click()
    await page.waitForURL('**/app', { timeout: 30000 })
    await page.waitForSelector('.page-header', { timeout: 30000 })
  })
}

await check('the answers are stored on the server', async () => {
  const result = await page.evaluate(async () => {
    const [me, setup] = await Promise.all([fetch('/api/me'), fetch('/api/setup')])
    return { me: await me.json(), setup: await setup.json() }
  })
  if (!result.me.facility.onboardingComplete) throw new Error('facility is still marked incomplete')
  if (result.me.facility.name !== 'Afribok Clinic') throw new Error(`facility name is ${result.me.facility.name}`)
  if (result.setup.departments.length < 6) throw new Error(`only ${result.setup.departments.length} departments stored`)
  if (result.setup.profile.ehrStatus !== 'paper') throw new Error(`ehrStatus is ${result.setup.profile.ehrStatus}`)
  if (result.setup.profile.historyStatus !== 'no') throw new Error(`historyStatus is ${result.setup.profile.historyStatus}`)
  if (result.setup.profile.doctors !== 8) throw new Error(`doctors is ${result.setup.profile.doctors}`)
  if (result.setup.profile.completedAt === null) throw new Error('completedAt is missing')
  console.log(
    `  ${result.setup.departments.length} departments · ${result.setup.profile.name} · ${result.setup.profile.location}`,
  )
})

await check('the workspace shell shows the configured hospital', async () => {
  await page.goto(`${base}/app/team`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.team-list', { timeout: 30000 })
  const facility = await page.locator('.facility-card strong').innerText()
  if (facility !== 'Afribok Clinic') throw new Error(`shell shows ${facility}`)
  const departmentOptions = await page.locator('.team-dept-cell select').first().locator('option').count()
  if (departmentOptions < 2) throw new Error('department assignment has no options')
})

await page.screenshot({ path: 'screenshots/hospital-setup.png', fullPage: true })

if (failures.length) {
  console.log(`RESULT: ${failures.length} failed -> ${failures.join(' | ')}`)
  await browser.close()
  process.exitCode = 1
} else {
  console.log('RESULT: all hospital setup checks passed')
  await browser.close()
}
