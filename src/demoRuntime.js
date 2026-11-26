// The demo account on this page: its sign-in (src/demoSession.js) and the
// answers to its requests (src/demoServer.js), given the university the
// page runs for, the browser's storage and the university's own files.
// src/entApi.js asks here before it sends anything: while the demo is
// signed in, nothing of it goes to a server.
import universityConfig from '@university'
import { DEMO_MAIL_STORAGE_KEY } from './demoMail.js'
import { createDemoServer } from './demoServer.js'
import { endDemoSession, onDemoSessionChange, readDemoSession, startDemoSession } from './demoSession.js'

// The look of each university's automatic icons (shared.js: appIcons),
// asked only in the demo: for a student the server draws the tiles.
const appIconLooks = import.meta.glob('../universities/*/shared.js', { import: 'appIcons' })
// The automatic signature's logos, as a sent mail carries them (PNG:
// scripts/render-mail-logos.mjs): the university's (logo.png) and each
// establishment's (<its id>.png).
const mailLogos = import.meta.glob('../universities/*/assets/mail/*.png', { query: '?url', import: 'default', eager: true })

function tabStorage() {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

// The tiles' icons, picked here as the server picks them, in the
// university's style and colours.
async function pickIcons(services) {
  const [{ pickAppIcons, sanitizeAppIconRequest }, look] = await Promise.all([
    import('./appIconPicks.js'),
    appIconLooks[`../universities/${universityConfig.id}/shared.js`]?.().catch(() => null) ?? null,
  ])
  const listed = sanitizeAppIconRequest({ services }) ?? []
  try {
    return pickAppIcons(listed, look ?? { style: universityConfig.appIconStyle })
  } catch {
    // A look this page doesn't know: the default one.
    return pickAppIcons(listed)
  }
}

// A PNG's size in pixels (its IHDR), or null.
function readPngSize(bytes) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function toBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

const logoRequests = new Map()

// One logo for the demo's copy of a mail: its bytes as a data: URL (a real
// mail has them inline), drawn at half its pixels. Null when there's none.
function readLogo(name, alt) {
  const url = mailLogos[`../universities/${universityConfig.id}/assets/mail/${name}.png`]
  if (!url) return null
  if (!logoRequests.has(url)) {
    logoRequests.set(url, fetch(url).then(async (response) => {
      if (!response.ok) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      const size = readPngSize(bytes)
      return size ? { src: `data:image/png;base64,${toBase64(bytes)}`, width: Math.round(size.width / 2), height: Math.round(size.height / 2) } : null
    }).catch(() => null))
  }
  return logoRequests.get(url).then((logo) => (logo ? { ...logo, alt } : null))
}

// The signature's logos: the establishment's (when it has one), then the
// university's.
async function readLogos(establishmentId) {
  const establishment = establishmentId ? universityConfig.establishments?.byId?.[establishmentId] ?? null : null
  const logos = await Promise.all([
    establishment ? readLogo(establishmentId, establishment.label ?? '') : null,
    readLogo('logo', universityConfig.university?.name ?? ''),
  ])
  return logos.filter(Boolean)
}

let server = null

function demoServer() {
  server ??= createDemoServer({
    config: universityConfig,
    session: readDemoSession,
    storage: tabStorage(),
    debug: Boolean(import.meta.env?.DEV),
    pickIcons,
    readLogos,
  })
  return server
}

// What the last demo left in this tab, when it ended somewhere else (another
// tab signed out, the sign-in ran out): nothing of it stays.
function forgetDemoMailbox() {
  server?.clear()
  server = null
  try {
    tabStorage()?.removeItem(DEMO_MAIL_STORAGE_KEY)
  } catch {
    // Nothing was kept there.
  }
}

if (!readDemoSession()) forgetDemoMailbox()
onDemoSessionChange(() => {
  if (!readDemoSession()) forgetDemoMailbox()
})

export function isDemoSignedIn() {
  return Boolean(readDemoSession())
}

// Signed in to the demo: a new sign-in, a new mailbox.
export function signInToDemo({ university, analyticsEnabled }) {
  forgetDemoMailbox()
  return startDemoSession({ university, analyticsEnabled })
}

// Signed out of the demo, or signed in for real: the demo ends in every
// tab, and what the visitor did in it goes.
export function signOutOfDemo() {
  endDemoSession()
  forgetDemoMailbox()
}

// fetch(url, init) for the demo: answered here.
export function answerDemoRequest(url, init) {
  return demoServer().answer(url, init)
}

// A file picked in the demo's composer → { status, body }.
export function uploadDemoFile(file, options) {
  return demoServer().upload(file, options)
}
