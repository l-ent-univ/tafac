import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KEPT_PAGE_CLASS,
  NO_KEPT_PAGES,
  PAGE_TOP,
  forgetScroll,
  isInHiddenPage,
  keepPages,
  rememberScroll,
  scrollOf,
  settleAnimations,
} from '../src/keptPages.js'

const OFFER = ['home', 'grades', 'planning', 'mail', 'moodle']
const show = (state, page, { owner = 'rennes:camille', offer = OFFER } = {}) => keepPages(state, { owner, offer, page })
// The pages shown one after the other, from nothing kept.
const visit = (...pages) => pages.reduce((state, page) => show(state, page), NO_KEPT_PAGES)

test('no page is kept without an owner', () => {
  assert.equal(keepPages(NO_KEPT_PAGES, { owner: null, offer: OFFER, page: 'home' }), NO_KEPT_PAGES)
  assert.deepEqual(keepPages(NO_KEPT_PAGES, { owner: null, offer: OFFER, page: 'grades' }).pages, {})
})

test('a page shown is kept, and stays kept behind the next one', () => {
  const state = visit('home', 'planning')
  assert.equal(state.shown, 'planning')
  assert.deepEqual(Object.keys(state.pages), ['home', 'planning'])
  assert.equal(state.pages.home.visit, 1)
  assert.equal(state.pages.planning.visit, 1)
})

test('nothing changes while the same page is shown', () => {
  const state = visit('home')
  assert.equal(show(state, 'home'), state)
  // The offer in another order is the same offer.
  assert.equal(show(state, 'home', { offer: [...OFFER].reverse() }), state)
})

test('each arrival on a kept page is another visit of the same mount', () => {
  const state = visit('home', 'grades', 'home', 'planning', 'home')
  assert.equal(state.pages.home.visit, 3)
  assert.equal(state.pages.grades.visit, 1)
  assert.equal(state.pages.home.key, visit('home').pages.home.key)
})

test('the pages kept together have each their own key', () => {
  // Siblings in the app's column: a key shared would mount them over and over.
  const state = visit('home', 'grades', 'planning', 'mail')
  const keys = Object.values(state.pages).map((entry) => entry.key)
  assert.equal(new Set(keys).size, keys.length)
})

test('« Moodle » is shown but not kept', () => {
  const state = visit('home', 'moodle')
  assert.equal(state.shown, 'moodle')
  assert.deepEqual(Object.keys(state.pages), ['home'])
  // Back from it is an arrival like another.
  assert.equal(show(state, 'home').pages.home.visit, 2)
})

test('signing out drops every page', () => {
  const state = keepPages(visit('home', 'grades', 'mail'), { owner: null, offer: OFFER, page: 'home' })
  assert.deepEqual(state.pages, {})
  assert.equal(state.owner, null)
  assert.equal(state.shown, null)
})

test('another account starts from nothing, on new mounts', () => {
  const first = visit('home', 'grades')
  const second = show(first, 'grades', { owner: 'rennes:alex' })
  assert.deepEqual(Object.keys(second.pages), ['grades'])
  assert.equal(second.pages.grades.visit, 1)
  assert.notEqual(second.pages.grades.key, first.pages.grades.key)
  // Another university, the same login.
  const third = show(second, 'grades', { owner: 'rennes-2:alex' })
  assert.notEqual(third.pages.grades.key, second.pages.grades.key)
})

test('the same account back after a sign-out gets new mounts', () => {
  const first = visit('home', 'grades')
  const signedOut = keepPages(first, { owner: null, offer: OFFER, page: 'home' })
  const back = show(show(signedOut, 'home'), 'grades')
  assert.notEqual(back.pages.home.key, first.pages.home.key)
  assert.equal(back.pages.grades.visit, 1)
  assert.equal(back.pages.grades.scroll, null)
})

test('other pages on offer drop the hidden ones, the page shown stays as it is', () => {
  const state = rememberScroll(visit('grades', 'home', 'planning', 'home'), { window: 0, column: 0 })
  const fewer = show(state, 'home', { offer: ['home', 'planning', 'mail'] })
  assert.deepEqual(Object.keys(fewer.pages), ['home'])
  // Not mounted again, not another arrival.
  assert.equal(fewer.pages.home, state.pages.home)
  // The planning, back later, is a new mount on its first visit.
  const again = show(fewer, 'planning', { offer: ['home', 'planning', 'mail'] })
  assert.equal(again.pages.planning.visit, 1)
  assert.notEqual(again.pages.planning.key, state.pages.planning.key)
})

test('a page that goes with the offer while shown isn’t kept for its return', () => {
  // « Mes notes » shown, then off the offer: App falls back to « Accueil ».
  const state = visit('home', 'grades')
  const fallback = show(state, 'home', { offer: ['home', 'planning'] })
  assert.deepEqual(Object.keys(fallback.pages), ['home'])
  assert.equal(fallback.pages.home.visit, 1)
  assert.notEqual(fallback.pages.home.key, state.pages.home.key)
})

test('a page comes back where it was left, a first visit starts at the top', () => {
  let state = visit('home')
  assert.equal(scrollOf(state, 'home'), PAGE_TOP)
  state = show(rememberScroll(state, { window: 640, column: 0 }), 'grades')
  assert.equal(scrollOf(state, 'grades'), PAGE_TOP)
  state = show(rememberScroll(state, { window: 1200, column: 0 }), 'home')
  assert.deepEqual(scrollOf(state, 'home'), { window: 640, column: 0 })
  state = show(rememberScroll(state, { window: 80, column: 0 }), 'grades')
  assert.deepEqual(scrollOf(state, 'grades'), { window: 1200, column: 0 })
  // On a wide screen the column scrolls, not the document.
  state = show(rememberScroll(state, { window: 0, column: 300 }), 'home')
  assert.deepEqual(scrollOf(state, 'grades'), { window: 0, column: 300 })
})

test('a scroll is only kept for a kept page', () => {
  const onMoodle = visit('home', 'moodle')
  assert.equal(rememberScroll(onMoodle, { window: 500, column: 0 }), onMoodle)
  assert.equal(scrollOf(onMoodle, 'moodle'), PAGE_TOP)
  assert.equal(rememberScroll(NO_KEPT_PAGES, { window: 500, column: 0 }), NO_KEPT_PAGES)
})

test('a page asked from its top forgets where it was left', () => {
  const state = show(rememberScroll(visit('planning'), { window: 900, column: 0 }), 'home')
  const asked = forgetScroll(state, 'planning')
  assert.equal(scrollOf(asked, 'planning'), PAGE_TOP)
  assert.equal(asked.pages.planning.visit, 1)
  // Nothing to forget: the same state.
  assert.equal(forgetScroll(asked, 'planning'), asked)
  assert.equal(forgetScroll(asked, 'mail'), asked)
})

test('a dropped page’s scroll goes with it', () => {
  const state = show(rememberScroll(visit('grades'), { window: 700, column: 0 }), 'home')
  const signedOut = keepPages(state, { owner: null, offer: OFFER, page: 'home' })
  assert.equal(scrollOf(show(signedOut, 'grades'), 'grades'), PAGE_TOP)
  const fewer = show(state, 'home', { offer: ['home', 'planning'] })
  assert.equal(scrollOf(fewer, 'grades'), PAGE_TOP)
})

test('an element knows it is in a hidden kept page', () => {
  const asked = []
  const inHidden = { closest: (selector) => { asked.push(selector); return {} } }
  assert.equal(isInHiddenPage(inHidden), true)
  assert.deepEqual(asked, [`.${KEPT_PAGE_CLASS}[hidden]`])
  assert.equal(isInHiddenPage({ closest: () => null }), false)
  assert.equal(isInHiddenPage(null), false)
  assert.equal(isInHiddenPage({}), false)
})

// A CSS animation as getAnimations() gives it.
function cssAnimation(target, { endTime = 300, pseudoElement = null, name = 'rise' } = {}) {
  const animation = {
    animationName: name,
    finished: false,
    effect: { target, pseudoElement, getComputedTiming: () => ({ endTime }) },
    finish() { animation.finished = true },
  }
  return animation
}

test('the animations starting over in a page shown again are ended, not the page’s own', () => {
  const root = { getAnimations: () => animations }
  const card = {}
  const own = cssAnimation(root, { name: 'page-enter-ios' })
  const entry = cssAnimation(card)
  const delayed = cssAnimation(card, { endTime: 1300 })
  const spinner = cssAnimation(card, { endTime: Infinity })
  const ownPseudo = cssAnimation(root, { pseudoElement: '::before' })
  const transition = { transitionProperty: 'opacity', effect: { target: card, getComputedTiming: () => ({ endTime: 200 }) }, finish() { transition.finished = true } }
  const scripted = { effect: { target: card, getComputedTiming: () => ({ endTime: 200 }) }, finish() { scripted.finished = true } }
  const stuck = { ...cssAnimation(card), finish() { throw new Error('InvalidStateError') } }
  const animations = [own, entry, delayed, spinner, ownPseudo, transition, scripted, stuck, { animationName: 'gone', effect: null }]

  assert.equal(settleAnimations(root), 3)
  assert.equal(own.finished, false)
  assert.equal(entry.finished, true)
  assert.equal(delayed.finished, true)
  assert.equal(spinner.finished, false)
  assert.equal(ownPseudo.finished, true)
  assert.equal(transition.finished, undefined)
  assert.equal(scripted.finished, undefined)
})

test('a place that can’t list its animations is left alone', () => {
  assert.equal(settleAnimations(null), 0)
  assert.equal(settleAnimations({}), 0)
  assert.equal(settleAnimations({ getAnimations: () => { throw new Error('unsupported') } }), 0)
})
