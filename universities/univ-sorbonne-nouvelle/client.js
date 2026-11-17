// Client-safe config for Université Sorbonne Nouvelle.
import logo from './assets/logo.svg'
import {
  appIcons,
  id,
  branding,
  casOrigin,
  entOrigin,
  establishmentNames,
  features,
  gradesCopy,
  moodleOrigin,
  planningServiceUrl,
  portalEntryPath,
  register,
  university,
} from './shared.js'

export default {
  id,
  appIconStyle: appIcons.style,

  university,
  register,

  branding: {
    ...branding,
    // The iSorbonne wordmark, one colour: inverted in dark mode.
    logo,
  },

  // Help link of the CAS login page.
  links: {
    activateAccount: 'https://activation.sorbonne-nouvelle.fr/',
  },

  origins: {
    ent: entOrigin,
    cas: casOrigin,
    // Sidebar / tab bar "Moodle" link (features.moodle).
    moodle: moodleOrigin,
  },

  auth: {
    portalEntryPath,
  },

  features,

  planning: {
    serviceUrl: planningServiceUrl,
  },

  // One establishment for everyone, with the "Prochain cours" card.
  establishments: {
    fallbackId: 'sorbonneNouvelle',
    byId: {
      sorbonneNouvelle: {
        label: establishmentNames.sorbonneNouvelle,
        nextClassWidget: true,
      },
    },
  },

  services: {
    getAppIcon: () => null,
    categories: [],
    // iSorbonne's favourites are JSF actions, not an API: they stay in the browser.
    localFavorites: true,
  },

  grades: gradesCopy,
}
