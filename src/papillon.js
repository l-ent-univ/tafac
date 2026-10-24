// Tafac is part of Papillon (https://papillon.bzh), made by the same team.
// Every mention of it reads its link from here, so the university's
// `branding.papillon` block (shared.js) turns them all on or off at once.
// Pure: takes `universityConfig.branding`, for the tests.

const PAPILLON_URL = 'https://papillon.bzh'

// Dev only: the debug panel forces the switch on this device, 'on' or 'off'
// (anything else: as the university says). Read once, at load: the panel
// reloads the page after setting it.
export const PAPILLON_DEBUG_KEY = 'l-ent:debug-papillon'

export function readPapillonDebugOverride() {
  if (!import.meta.env?.DEV) return null
  try {
    const value = localStorage.getItem(PAPILLON_DEBUG_KEY)
    return value === 'on' || value === 'off' ? value : null
  } catch {
    return null
  }
}

// Papillon's site, or null (no block, or no https link): nothing to show.
// `override` (the debug panel's): 'off' hides it, 'on' shows it, with
// Papillon's own site when the university has no link.
export function getPapillonUrl(branding, override = null) {
  if (override === 'off') return null
  const url = branding?.papillon?.url
  if (typeof url === 'string' && url.startsWith('https://')) return url
  return override === 'on' ? PAPILLON_URL : null
}
