import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_MOODLE_STATE, MOODLE_THEME_TOKENS, isSlotCovered, parseMoodleState, readMoodleTheme, rectsOverlap, sameMoodleState, sameMoodleTheme, slotBounds } from '../src/desktopMoodle.js'

test('the app’s state is read in the shapes the page counts on', () => {
  assert.deepEqual(parseMoodleState({ version: 4, phase: 'ready', loading: true, back: true, forward: false, title: 'Tableau de bord', file: false }), {
    version: 4, phase: 'ready', loading: true, back: true, forward: false, title: 'Tableau de bord', file: false,
  })
  // What isn't said is off.
  assert.deepEqual(parseMoodleState({ phase: 'signin' }), { version: null, phase: 'signin', loading: false, back: false, forward: false, title: '', file: false })
  // The server found the session expired: the page signs out.
  assert.equal(parseMoodleState({ phase: 'expired' })?.phase, 'expired')
  assert.equal(parseMoodleState({ phase: 'nowhere' }), null)
  assert.equal(parseMoodleState(null), null)
  assert.equal(parseMoodleState('ready'), null)
})

test('two states are the same whatever their version', () => {
  const state = parseMoodleState({ version: 1, phase: 'ready', title: 'Cours' })
  assert.equal(sameMoodleState(state, { ...state, version: 2 }), true)
  assert.equal(sameMoodleState(state, { ...state, loading: true }), false)
  assert.equal(sameMoodleState(INITIAL_MOODLE_STATE, null), false)
})

test('the slot’s place is in whole points, its edges where they round to', () => {
  assert.deepEqual(slotBounds({ left: 295.6, top: 52, right: 1308.4, bottom: 762 }), { x: 296, y: 52, width: 1012, height: 710 })
  assert.deepEqual(slotBounds({ left: 96, top: 52, right: 1024, bottom: 640.5 }), { x: 96, y: 52, width: 928, height: 589 })
})

test('rectangles overlap when they share more than an edge', () => {
  const slot = { left: 300, top: 52, right: 1300, bottom: 760 }
  assert.equal(rectsOverlap({ left: 250, top: 100, right: 420, bottom: 300 }, slot), true)
  assert.equal(rectsOverlap({ left: 20, top: 100, right: 300, bottom: 300 }, slot), false)
  assert.equal(rectsOverlap({ left: 400, top: 0, right: 600, bottom: 52 }, slot), false)
})

// A page with a slot and whatever lies over it: `top(x, y)` is what takes a
// press there, `found` what each selector finds.
function fakePage({ top = () => null, dialogs = [], popups = [] } = {}) {
  const inside = { isSlotChild: true }
  const slot = {
    getBoundingClientRect: () => ({ left: 300, top: 52, right: 1300, bottom: 752, width: 1000, height: 700 }),
    contains: (element) => element === slot || element === inside,
  }
  const doc = {
    querySelectorAll: (selector) => (selector.includes('dialog') ? dialogs : popups),
    elementFromPoint: (x, y) => top(x, y) ?? inside,
  }
  return { slot, doc }
}

const element = (rect, rendered = true) => ({
  checkVisibility: () => rendered,
  getBoundingClientRect: () => rect,
})

test('nothing over the slot: the view shows', () => {
  const { slot, doc } = fakePage()
  assert.equal(isSlotCovered(slot, doc), false)
})

test('a dialog anywhere covers it, unless it isn’t rendered', () => {
  const sheet = element({ left: 0, top: 0, right: 200, bottom: 200 })
  assert.equal(isSlotCovered(...Object.values(fakePage({ dialogs: [sheet] }))), true)
  const closed = element({ left: 0, top: 0, right: 0, bottom: 0 }, false)
  assert.equal(isSlotCovered(...Object.values(fakePage({ dialogs: [closed] }))), false)
})

test('a menu counts when it reaches the slot', () => {
  const inSidebar = element({ left: 20, top: 500, right: 280, bottom: 700 })
  assert.equal(isSlotCovered(...Object.values(fakePage({ popups: [inSidebar] }))), false)
  const overTheEdge = element({ left: 200, top: 500, right: 420, bottom: 700 })
  assert.equal(isSlotCovered(...Object.values(fakePage({ popups: [overTheEdge] }))), true)
})

test('anything else that takes a press over the slot covers it', () => {
  const note = { isNote: true }
  // A note along the slot's bottom edge.
  const { slot, doc } = fakePage({ top: (x, y) => (y > 700 ? note : null) })
  assert.equal(isSlotCovered(slot, doc), true)
})

test('what only pokes over the slot’s edge doesn’t cover it', () => {
  // The sidebar's handle, centred on the slot's left edge (300): 10px in.
  const handle = { isHandle: true }
  const { slot, doc } = fakePage({ top: (x, y) => (x < 310 && y > 380 && y < 420 ? handle : null) })
  assert.equal(isSlotCovered(slot, doc), false)
})

test('a slot without a size is not one to show a view in', () => {
  const { slot, doc } = fakePage()
  slot.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })
  assert.equal(isSlotCovered(slot, doc), true)
})

// A page whose colours are `colors` (custom property: colour, as the browser
// resolves it), on <html data-theme=…>.
function themedPage(theme, colors) {
  const added = []
  const probe = { hidden: false, style: { color: '' }, remove: () => added.splice(added.indexOf(probe), 1) }
  const doc = {
    documentElement: { dataset: { theme }, append: (element) => added.push(element) },
    createElement: () => probe,
    defaultView: {
      getComputedStyle: () => ({
        get color() {
          return colors[/^var\((--[a-z-]+)\)$/.exec(probe.style.color)?.[1]] ?? ''
        },
      }),
    },
  }
  return { doc, added }
}

test('the theme sent to Moodle is the page’s colours, resolved', () => {
  const colors = Object.fromEntries(Object.values(MOODLE_THEME_TOKENS).map((property, index) => [property, `rgb(${index}, 0, 0)`]))
  colors['--brand'] = 'oklch(0.525 0.133 245)'
  const { doc, added } = themedPage('dark', colors)
  const theme = readMoodleTheme(doc)
  assert.equal(theme.dark, true)
  assert.equal(theme.tokens.brand, 'oklch(0.525 0.133 245)')
  assert.equal(theme.tokens.sidebar, colors['--material-sidebar-solid'])
  assert.equal(Object.keys(theme.tokens).length, Object.keys(MOODLE_THEME_TOKENS).length)
  // The probe it reads them on is gone after.
  assert.deepEqual(added, [])
})

test('a colour the page doesn’t have is left out', () => {
  const { doc } = themedPage('light', { '--ink': 'rgb(73, 29, 17)' })
  assert.deepEqual(readMoodleTheme(doc), { dark: false, tokens: { ink: 'rgb(73, 29, 17)' } })
})

test('two themes are the same when every colour is', () => {
  const theme = { dark: false, tokens: { ink: 'rgb(73, 29, 17)' } }
  assert.equal(sameMoodleTheme(theme, { dark: false, tokens: { ink: 'rgb(73, 29, 17)' } }), true)
  assert.equal(sameMoodleTheme(theme, { dark: true, tokens: { ink: 'rgb(73, 29, 17)' } }), false)
  assert.equal(sameMoodleTheme(theme, { dark: false, tokens: { ink: 'rgb(0, 0, 0)' } }), false)
  assert.equal(sameMoodleTheme(theme, null), false)
})
