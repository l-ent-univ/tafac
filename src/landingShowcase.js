// The landing page's showcase (src/components/LandingShowcase.jsx): one tab
// per page of the app, in the order of its navigation, each with what it
// does (landingCopy.json, `showcase`) and a preview on the demo account's
// data. Pure (no React, no @university), see tests/landingShowcase.test.js.
import { CHANGELOG } from './changelog.js'
import { isFeatureOn } from './changelogState.js'
import { daysBetween, toDayKey } from './planningDates.js'

// `id`: the tab's anchor on the page (#messagerie…), `key`: its copy and
// preview, `features`: what a university needs on for it (as its nav item,
// src/navItems.js). Each item of a tab (by its index in the copy) may need
// a feature of its own (`itemFeatures`).
export const SHOWCASE_TABS = Object.freeze([
  {
    id: 'accueil',
    key: 'home',
    icon: 'carbon:home',
    features: [],
    itemIcons: ['ph:hand-waving', 'carbon:time', 'carbon:email', 'carbon:task', 'carbon:app-switcher'],
    itemFeatures: [[], ['ade'], ['mail'], ['moodleDeadlines'], []],
  },
  {
    id: 'mes-notes',
    key: 'grades',
    icon: 'carbon:chart-pie',
    features: ['grades'],
    itemIcons: ['carbon:chart-ring', 'carbon:chart-histogram', 'carbon:calculator', 'carbon:email'],
    itemFeatures: [[], [], [], ['mail']],
  },
  {
    id: 'planning',
    key: 'planning',
    icon: 'carbon:calendar',
    features: ['planning'],
    itemIcons: ['carbon:list-boxes', 'carbon:email', 'carbon:download', 'carbon:arrows-horizontal'],
    itemFeatures: [[], ['mail'], [], []],
  },
  {
    id: 'messagerie',
    key: 'mail',
    icon: 'carbon:email',
    features: ['mail'],
    // The in-app page, not the webmail's link (mail.page: false).
    mailPage: true,
    itemIcons: ['carbon:chat', 'carbon:edit', 'carbon:undo', 'carbon:document-attachment', 'carbon:warning-alt'],
    itemFeatures: [[], [], [], [], []],
  },
])

// A tab's own id; its panel's is the tab's `id` (the page's anchor,
// #messagerie…).
export function showcaseTabId(id) {
  return `onglet-${id}`
}

// The changelog's launches (a `spotlight` entry), by the tab they announce.
const LAUNCH_TABS = Object.freeze({
  messagerie: 'messagerie',
  planning: 'planning',
  'mes-notes': 'mes-notes',
})

// A launch stays « Nouveau » on the landing this long after its date.
export const ANNOUNCEMENT_MAX_AGE_DAYS = 60

// Whether a university page shows what needs `features`. The neutral page
// (tafac.fr, no university yet) shows the whole app.
function hasFeatures(config, features) {
  if (config?.neutral) return true
  return features.every((feature) => isFeatureOn(config?.features?.[feature]))
}

// The tabs this landing shows: every one on the neutral page, a
// university's own on its page (/<slug>). Each with its items' indexes
// (`items`) that apply, in the copy's order.
export function listShowcaseTabs(config) {
  return SHOWCASE_TABS
    .filter((tab) => hasFeatures(config, tab.features))
    .filter((tab) => !tab.mailPage || config?.neutral || config?.mail?.page !== false)
    .map((tab) => ({
      ...tab,
      items: tab.itemFeatures
        .map((features, index) => (hasFeatures(config, features) ? index : null))
        .filter((index) => index !== null),
    }))
}

// The newest launch to point at from the top of the page (« Nouveau · Ta
// messagerie dans l’appli »): a `spotlight` entry of the changelog whose
// page has a tab here (`tabs`: listShowcaseTabs'), dated today or before,
// at most `maxAgeDays` ago, and for this university when it names some.
// → { id, tabId, title } or null.
export function pickShowcaseAnnouncement({ config, tabs, now = new Date(), entries = CHANGELOG, maxAgeDays = ANNOUNCEMENT_MAX_AGE_DAYS }) {
  const tabIds = new Set((tabs ?? []).map((tab) => tab.id))
  const today = toDayKey(now)
  const launch = entries
    .filter((entry) => entry.spotlight && tabIds.has(LAUNCH_TABS[entry.id]))
    .filter((entry) => config?.neutral || !Array.isArray(entry.universities) || entry.universities.length === 0
      || entry.universities.includes(config?.id))
    .filter((entry) => {
      const age = daysBetween(entry.date, today)
      return age >= 0 && age <= maxAgeDays
    })
    .sort((left, right) => right.date.localeCompare(left.date))[0]
  return launch ? { id: launch.id, tabId: LAUNCH_TABS[launch.id], title: launch.title } : null
}
