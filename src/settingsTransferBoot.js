// Imported first by main.jsx: some modules read settings when they load
// (analytics reads the opt-out), so transferred ones must already be there.
// Don't import analytics.js here for the same reason.
import { TRANSFERABLE_KEYS, importTransferredSettings, isSettingsTransferArrival } from './settingsTransfer'

function readMissingKeys() {
  try {
    return TRANSFERABLE_KEYS.filter((key) => localStorage.getItem(key) === null)
  } catch {
    return []
  }
}

// Read before the import, which takes the link off the address bar.
const arrivedFromLent = isSettingsTransferArrival()
const missingBefore = arrivedFromLent ? readMissingKeys() : []
importTransferredSettings()
const missingAfter = new Set(readMissingKeys())

// Whether this page load came from the old l'ent address, and which settings
// came along. App.jsx opens the welcome sheet from it.
export const settingsTransfer = {
  arrived: arrivedFromLent,
  importedKeys: missingBefore.filter((key) => !missingAfter.has(key)),
}
