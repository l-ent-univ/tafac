// First import of main.jsx: this address now only redirects to Tafac, and
// the app isn't rendered at all. The first visit carries this browser's
// settings over (see settingsTransfer.js); later visits land on Tafac as is,
// so they never overwrite settings changed there since.
import { MOVED_TO_TAFAC_KEY, TAFAC_URL, moveToTafac } from './settingsTransfer'

function hasMovedToTafac() {
  try {
    return localStorage.getItem(MOVED_TO_TAFAC_KEY) === '1'
  } catch {
    return false
  }
}

if (hasMovedToTafac()) window.location.replace(TAFAC_URL)
else moveToTafac()
