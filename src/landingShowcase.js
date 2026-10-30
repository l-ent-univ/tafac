// The landing page's showcase (src/components/LandingShowcase.jsx): one tab
// per page of the app, in the order of its navigation, each with what it
// does (landingCopy.json, `showcase`) and a preview on the demo account's
// data. Pure (no React, no @university), see tests/landingShowcase.test.js.
import { isFeatureOn } from './changelogState.js'

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

// Whether a university page shows what needs `features`. The neutral page
// (tafac.fr, no university yet) shows the whole app.
function hasFeatures(config, features) {
  if (config?.neutral) return true
  return features.every((feature) => isFeatureOn(config?.features?.[feature]))
}

// Whether a university page shows the in-app Messagerie (not only the
// webmail's link: mail.page false). The neutral page does.
function hasMailPage(config) {
  return Boolean(config?.neutral) || config?.mail?.page !== false
}

// The device section's features (FeatureShowcase; landingCopy.json,
// `features.items`, by index): each one's icon and what a university needs
// on for it, as the tabs'.
export const DEVICE_FEATURES = Object.freeze([
  { icon: 'carbon:location', features: ['ade'] },
  { icon: 'carbon:calendar', features: ['planning'] },
  { icon: 'carbon:chart-line', features: ['grades'] },
  { icon: 'carbon:email', features: ['mail'], mailPage: true },
  { icon: 'carbon:task', features: ['moodleDeadlines'] },
  { icon: 'carbon:app-switcher', features: [] },
])

// The device section's features this landing shows, by index: every one
// on the neutral page, a university's own on its page (/<slug>).
export function listDeviceFeatures(config) {
  return DEVICE_FEATURES
    .map((item, index) => (hasFeatures(config, item.features) && (!item.mailPage || hasMailPage(config)) ? index : null))
    .filter((index) => index !== null)
}

// The tabs this landing shows: every one on the neutral page, a
// university's own on its page (/<slug>). Each with its items' indexes
// (`items`) that apply, in the copy's order.
export function listShowcaseTabs(config) {
  return SHOWCASE_TABS
    .filter((tab) => hasFeatures(config, tab.features))
    .filter((tab) => !tab.mailPage || hasMailPage(config))
    .map((tab) => ({
      ...tab,
      items: tab.itemFeatures
        .map((features, index) => (hasFeatures(config, features) ? index : null))
        .filter((index) => index !== null),
    }))
}
