// Client config of Tafac without a university (universities/neutral.js): the
// university picker before login. Same shape as a universities/<id>/client.js,
// with every service off, so modules that read the config when they load
// work on it too.
import { branding, university } from '../universities/neutral.js'

export default {
  id: null,
  neutral: true,
  university,
  branding: {
    ...branding,
    logo: null,
  },
  links: {},
  origins: {
    ent: null,
    cas: null,
  },
  auth: {
    portalEntryPath: '/',
  },
  features: {
    demo: true,
  },
  planning: {},
  grades: {},
  services: {},
}
