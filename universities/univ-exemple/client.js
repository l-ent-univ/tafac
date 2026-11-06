// Client-safe config for Université Exemple (demo university).
import logo from './assets/logo.png'
import {
  appIcons,
  id,
  branding,
  casOrigin,
  entOrigin,
  features,
  gradesCopy,
  planningServiceUrl,
  portalEntryPath,
  register,
  university,
} from './shared.js'

export default {
  id,
  // Icon set of the subjects in "Mes notes", the tiles' one (shared.js).
  appIconStyle: appIcons.style,

  university,
  // « vous » or « tu » (src/register.js), from shared.js.
  register,

  branding: {
    ...branding,
    logo,
  },

  links: {},

  origins: {
    ent: entOrigin,
    cas: casOrigin,
  },

  auth: {
    portalEntryPath,
  },

  features,

  planning: {
    serviceUrl: planningServiceUrl,
  },

  // The demo ADE tree mentions "IUT Lannion", so this rule turns the demo
  // account into an establishment with the full widget set.
  establishments: {
    detectFromAdeTree: [
      { includes: ['iut lannion'], id: 'demo' },
    ],
    fallbackId: 'demo',
    byId: {
      demo: {
        label: 'Campus de démonstration',
        gradeWidgets: true,
        nextClassWidget: true,
      },
    },
  },

  services: {
    getAppIcon: () => null,
    categories: [
      { label: 'Communication', keywords: ['messagerie', 'annuaire', 'webconférence', 'webconference'] },
      { label: 'Pédagogie', keywords: ['moodle', 'emplois du temps'] },
      { label: 'Outils', keywords: ['microsoft 365', 'documentation', 'assistance'] },
    ],
  },

  grades: gradesCopy,
}
