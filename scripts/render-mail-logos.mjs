// The sent mail's signature logos (server/mailSend.js) as PNG: Gmail and
// Outlook don't show SVG. Run once whenever a logo changes, then commit the
// PNGs:
//
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
//   CHROME=/path/to/chrome-headless-shell node scripts/render-mail-logos.mjs
//
// (Playwright isn't a dependency of the app: any install of it will do.)
// Each logo is the light-mode one (never its dark version: the mail's body
// is light), drawn at 2× on a small rounded white plate baked into the PNG.
// Dark-mode mail clients (Apple Mail, Outlook, the Gmail apps) leave images
// as they are, and a black logo on a transparent background would vanish
// on their dark page; a white background set in CSS is dropped or inverted
// by some of them, a plate in the pixels isn't. The server reads the PNG's
// size to give the <img> its width and height (half the pixels).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Logo height in CSS pixels inside its plate, the plate's padding, its corners.
const LOGO_HEIGHT = 28
const PADDING = 6
const RADIUS = 8
const SCALE = 2

const LOGOS = [
  { from: 'universities/univ-rennes/assets/logo.svg', to: 'universities/univ-rennes/assets/mail/logo.png' },
  { from: 'universities/univ-rennes/assets/establishments/iutlan.svg', to: 'universities/univ-rennes/assets/mail/iutlan.png' },
  { from: 'universities/univ-rennes-2/assets/logo.svg', to: 'universities/univ-rennes-2/assets/mail/logo.png' },
]

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined })
const page = await browser.newPage({ deviceScaleFactor: SCALE, viewport: { width: 800, height: 200 } })

for (const logo of LOGOS) {
  const svg = readFileSync(path.join(ROOT, logo.from), 'utf8')
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div id="plate" style="display:inline-block;padding:${PADDING}px;border-radius:${RADIUS}px;background:#fff;line-height:0">
      <img src="${src}" style="height:${LOGO_HEIGHT}px;width:auto;display:block">
    </div></body></html>`)
  await page.waitForFunction(() => document.querySelector('img').complete)
  const png = await page.locator('#plate').screenshot({ omitBackground: true })
  mkdirSync(path.dirname(path.join(ROOT, logo.to)), { recursive: true })
  writeFileSync(path.join(ROOT, logo.to), png)
  console.log(`${logo.to}: ${png.readUInt32BE(16)}×${png.readUInt32BE(20)} px, ${png.length} bytes`)
}

await browser.close()
