// Recovered from the original landing-video recorder (October 2026).
// The capture still uses timestamped CDP screencast frames; the scenes now
// follow landingCopy.features. Run in a dedicated, disposable demo browser.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connect } from './rec-lib.mjs'

const desktop = process.argv.includes('--desktop')
const dark = process.argv.includes('--dark')
const base = process.env.TOUR_URL || 'http://localhost:5199/rennes'
const url = new URL(base)
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Use a local demo server')
const out = resolve(process.env.TOUR_OUTPUT || `/tmp/tafac-tour-${desktop ? 'desktop' : 'phone'}-${dark ? 'dark' : 'light'}-${Date.now()}`)
mkdirSync(out, { recursive: true })
mkdirSync(`${out}/frames`, { recursive: true })
const { ws, send, evalJs, wait, tap, center, tabByText, listeners } = await connect({ desktop })
const frames = []
const scenes = []
let recording = false
// While paused (a reload), frames are dropped and the time it took cut
// (the frames' timestamps are the wall clock's, in seconds).
let paused = false
let offset = 0
const now = () => Date.now() / 1000
const visible = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height)`
async function act(expr) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evalJs(`Boolean(${expr})`)) {
      await evalJs(`(${expr}).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })`)
      const point = await center(expr)
      await tap(point.x, point.y)
      await wait(450)
      return
    }
    await wait(200)
  }
  throw new Error(`Missing tour control: ${expr}`)
}
const nav = label => act(tabByText(label))
const button = label => act(visible(`button[aria-label="${label}"]`))
async function show(name, expr, hold = 2400) {
  if (expr) {
    if (!await evalJs(`Boolean(${expr})`)) throw new Error(`Missing scene: ${name}`)
    await evalJs(`(${expr}).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })`)
    await wait(700)
  }
  scenes.push({ name, frame: frames.length })
  await wait(hold)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${out}/${String(scenes.length).padStart(2, '0')}.png`, Buffer.from(shot.result.data, 'base64'))
}
// The page reloaded off camera: the video cuts straight to what follows.
async function reload() {
  // The screen still until here (Chrome sends a frame only on a change):
  // its last frame held up to now.
  holdLastFrame()
  const pausedAt = now()
  paused = true
  await send('Page.navigate', { url: base })
  await wait(2200)
  paused = false
  offset += now() - pausedAt
  // The page reloaded still: no frame would come until something moves.
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })
  const name = `f${String(frames.length).padStart(6, '0')}.jpg`
  writeFileSync(`${out}/frames/${name}`, Buffer.from(shot.result.data, 'base64'))
  frames.push({ name, t: now() - offset })
}
function holdLastFrame() {
  const last = frames.at(-1)
  if (last) frames.push({ name: last.name, t: now() - offset })
}
async function until(name, expr) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evalJs(`Boolean(${expr})`)) return
    await wait(200)
  }
  throw new Error(`Never reached: ${name}`)
}
async function type(expr, text) {
  await act(expr)
  // A reply's editor already holds the quote: the text goes before it.
  if (await evalJs(`(${expr}).isContentEditable`)) {
    await evalJs(`(() => { const el = ${expr}; el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range) })()`)
    await wait(150)
  }
  await send('Input.insertText', { text })
  await wait(700)
}
try {
  // Out of the video: the footer's "dev · <branch>", and the establishment's
  // logos (beside Tafac's in the sidebar and header, in the mail signature).
  const hidden = [
    'footer:has(> span.font-mono) { visibility: hidden !important; }',
    'span.inline-flex.items-center.min-w-0 > img:not(:first-child) { display: none !important; }',
    '.mail-composer-signature-logos { display: none !important; }',
  ].join(' ')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(hidden)}; document.head.appendChild(style) })` })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] })
  await send('Page.navigate', { url: base })
  await wait(2500)
  const status = await evalJs(`fetch('/__ent_auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo', university: 'univ-rennes' }) }).then(r => r.status)`)
  if (status !== 200) throw new Error(`Demo login failed: ${status}`)
  await evalJs(`import('/src/changelog.js').then(({ CHANGELOG }) => { localStorage.setItem('l-ent:changelog-seen', JSON.stringify({ ids: CHANGELOG.map(e => e.id) })); localStorage.setItem('l-ent:pwa-prompt-dismissed', '1'); localStorage.setItem('l-ent:planning-view', ${JSON.stringify(desktop ? 'week' : 'day')}); })`)
  await send('Page.navigate', { url: base })
  await wait(3500)
  listeners.push(d => {
    if (d.method !== 'Page.screencastFrame') return
    void send('Page.screencastFrameAck', { sessionId: d.params.sessionId })
    if (paused) return
    const name = `f${String(frames.length).padStart(6, '0')}.jpg`
    writeFileSync(`${out}/frames/${name}`, Buffer.from(d.params.data, 'base64'))
    frames.push({ name, t: d.params.metadata.timestamp - offset })
  })
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: desktop ? 1920 : 780, maxHeight: desktop ? 1200 : 1594, everyNthFrame: 1 })
  recording = true
  if (desktop) {
    await show('Accueil', null, 1200)
    await nav('Planning')
    await show('Prépare ta semaine', null, 2200)
  } else {
    await show('Trouve ta prochaine salle', visible('[aria-label^="Prochain cours"]'), 1800)
  }
  await nav('Mes notes')
  await wait(1200)
  const dismiss = visible('button[aria-label="Masquer ce message"]')
  if (await evalJs(`Boolean(${dismiss})`)) await act(dismiss)
  await show(desktop ? 'Fais le point sur tes résultats' : 'Consulte tes dernières notes', null, desktop ? 1400 : 2200)
  if (desktop) {
    const dialogButton = text => `[...document.querySelectorAll('[role="dialog"] button')].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.getBoundingClientRect().height)`
    await button('Simuler mes notes')
    await wait(600)
    // The UE on the dial, then one of its subjects with a grade to come.
    await act(dialogButton('Suivant'))
    await wait(600)
    await act(visible('[role="dialog"] .subject-row-toggle'))
    await act(dialogButton('Ajouter une note'))
    await type(visible('input[aria-label^="Note pour Note ajoutée"]'), '18')
    await until('the edit counted', `document.querySelector('[role="dialog"] footer')?.textContent.includes('modifiée')`)
    await show('Simulation avec une prochaine note à 18', null, 1200)
    await act(dialogButton('Suivant'))
    await until('the reveal', `Boolean(${dialogButton('Terminer')})`)
    await show('La moyenne avec ce 18', null, 2800)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await wait(400)
  }
  await nav(desktop ? 'Messagerie' : 'Mail')
  await wait(1200)
  // A mail every student gets (the scolarité's), not a course's.
  await act(`[...document.querySelectorAll('button[data-mail-id]')].find(e => e.getBoundingClientRect().height && /Scolarité/.test(e.textContent))`)
  await show('Lire un message de la fac', null, 1500)
  await button('Répondre')
  await type(visible('[contenteditable="true"][aria-label="Message"]'), 'Bonjour, merci pour ces informations. Bonne journée !')
  if (desktop) {
    const attachment = resolve(out, 'choix-de-parcours.pdf')
    writeFileSync(attachment, 'Compte de démonstration Tafac\n')
    const { result: { root } } = await send('DOM.getDocument')
    const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' })
    if (!nodeId) throw new Error('Attachment input missing')
    await send('DOM.setFileInputFiles', { nodeId, files: [attachment] })
    await wait(900)
  }
  await show(desktop ? 'Réponse avec une pièce jointe' : 'Répondre depuis le téléphone', null, 2200)
  // No send action. Reloading discards this unsent demo-only composition,
  // back on the dashboard, where the video loops from.
  await reload()
  if (desktop) {
    await nav('Toutes les applications')
    await show('Retrouve tes outils de cours', null, 2600)
  } else {
    await show('Vérifie ce qu’il reste à rendre', visible('[aria-label^="Échéances Moodle"]'), 2600)
    await evalJs('window.scrollTo({ top: 0, behavior: "smooth" })')
    await wait(900)
  }
  holdLastFrame()
  await send('Page.stopScreencast')
  recording = false
  if (!frames.length) throw new Error('No captured frames')
  writeFileSync(`${out}/frames.json`, JSON.stringify({ frames, slow: 1, scenes, desktop, dark }, null, 2))
  console.log(`Capture complete: ${out}`)
} finally {
  if (recording) await send('Page.stopScreencast').catch(() => {})
  ws.close()
}
