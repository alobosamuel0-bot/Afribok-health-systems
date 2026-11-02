import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const executablePath =
  process.env.CHROME_PATH || '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
const base = process.env.TARGET_URL || 'http://127.0.0.1:3000'
mkdirSync('screenshots', { recursive: true })

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`))

await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
await page.screenshot({ path: 'screenshots/landing-hero.png' })
await page.evaluate(() => document.querySelector('#simulation')?.scrollIntoView())
await page.waitForTimeout(3500)
await page.screenshot({ path: 'screenshots/landing-simulation.png' })
const simText = await page.locator('.sim-stage').innerText()
console.log('SIMULATION HUD:', simText.replaceAll('\n', ' | '))

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.screenshot({ path: 'screenshots/login.png' })

await page.fill('#email', 'registration@afribok.health')
await page.fill('#password', 'Afribok#2026')
await page.click('.auth-submit')
await page.waitForURL('**/app', { timeout: 15000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: 'screenshots/dashboard.png' })

await page.goto(`${base}/app/patients`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: 'screenshots/patients.png' })

await page.goto(`${base}/app/register`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.screenshot({ path: 'screenshots/register.png' })

console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'none')
console.log('TITLE:', await page.title())
await browser.close()
