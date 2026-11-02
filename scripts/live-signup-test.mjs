/**
 * Creates a real account through the live sign-up form, then proves the account
 * was saved on the server by signing in again with a fresh session.
 *
 *   TARGET_URL=https://afribok.vertexsautomations.com node scripts/live-signup-test.mjs
 */
import { chromium } from 'playwright-core'

const executablePath =
  process.env.CHROME_PATH || '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
const base = process.env.TARGET_URL || 'https://afribok.vertexsautomations.com'
const stamp = Date.now().toString().slice(-6)
const account = {
  name: `Live Signup ${stamp}`,
  email: `signup.${stamp}@northstar.health`,
  password: 'ward-round-live-2026',
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
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

await check('sign-up form renders', async () => {
  await page.goto(`${base}/register`, { waitUntil: 'networkidle' })
  await page.waitForSelector('#name', { timeout: 15000 })
})

await check('account is created and signed in', async () => {
  await page.fill('#name', account.name)
  await page.fill('#email', account.email)
  await page.selectOption('#role', 'registration')
  await page.fill('#password', account.password)
  await page.fill('#confirm-password', account.password)
  await page.click('.auth-submit')
  await page.waitForURL('**/app', { timeout: 30000 })
  await page.waitForSelector('.page-header, .dashboard', { timeout: 30000 })
})

await check('session belongs to the new account', async () => {
  const me = await page.evaluate(async () => {
    const response = await fetch('/api/me')
    return { status: response.status, body: await response.json() }
  })
  if (me.status !== 200) throw new Error(`/api/me returned ${me.status}`)
  if (me.body.user.email !== account.email) throw new Error(`wrong account ${me.body.user.email}`)
  console.log(`  signed in as ${me.body.user.name} (${me.body.user.role})`)
})

await check('the saved account signs in on a fresh session', async () => {
  const context = await browser.newContext()
  const fresh = await context.newPage()
  await fresh.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await fresh.fill('#email', account.email)
  await fresh.fill('#password', account.password)
  await fresh.click('.auth-submit')
  await fresh.waitForURL('**/app', { timeout: 30000 })
  await fresh.waitForSelector('.page-header, .dashboard', { timeout: 30000 })
  await context.close()
})

await page.screenshot({ path: 'screenshots/account-created.png' })

if (failures.length) {
  console.log(`RESULT: ${failures.length} failed -> ${failures.join(' | ')}`)
  await browser.close()
  process.exitCode = 1
} else {
  console.log(`RESULT: all checks passed for ${account.email}`)
  await browser.close()
}
