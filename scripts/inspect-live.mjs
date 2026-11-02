import { chromium } from 'playwright-core'
const executablePath = process.env.CHROME_PATH || '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
const base = 'https://afribok.vertexsautomations.com'
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()) })
await page.goto(base + '/login', { waitUntil: 'networkidle' })
console.log('login page url', page.url())
console.log('login text', (await page.locator('body').innerText()).slice(0, 400).replace(/\n+/g,' | '))
await page.fill('#email', 'admin@afribok.health')
await page.fill('#password', 'Afribok#2026')
await page.click('.auth-submit')
await page.waitForTimeout(4000)
console.log('after login url', page.url())
await page.screenshot({ path: 'screenshots/live-dashboard.png', fullPage: true })
console.log('nav', await page.locator('.sidebar-nav, aside nav').innerText().catch(() => 'NO NAV'))
for (const path of ['/app', '/app/assistant', '/app/ehr', '/app/history', '/app/outflow', '/app/roadmap', '/setup']) {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const body = (await page.locator('body').innerText()).replace(/\n+/g, ' | ')
  console.log(`\n=== ${path} -> ${page.url()} ===`)
  console.log(body.slice(0, 1200))
  await page.screenshot({ path: `screenshots/live${path.replaceAll('/', '-')}.png`, fullPage: true })
}
console.log('\nERRORS:', errors.slice(0, 20))
await browser.close()
