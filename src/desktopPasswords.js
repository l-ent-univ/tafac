import { isDesktopApp } from './desktopApp'

// Desktop app (macOS): the passwords saved for tafac.fr (Passwords, iCloud
// Keychain), through the app's own routes (src-tauri/src/desktop.rs). Off
// the app, or where the app can't reach them, nothing happens.

const HEADERS = { 'X-Tafac-Desktop': '1' }

// The last login picked from the system's sheet: not offered to be saved
// again once accepted.
let lastPicked = null

// The system's sheet of saved passwords: { username, password }, or null
// (cancelled, nothing saved, not the app).
export async function pickSavedPassword() {
  if (!isDesktopApp()) return null
  try {
    const response = await fetch('/__desktop/password/pick', { method: 'POST', headers: HEADERS })
    if (response.status !== 200) return null
    const credential = await response.json()
    if (!credential?.username || !credential?.password) return null
    lastPicked = credential
    return credential
  } catch {
    return null
  }
}

// An accepted login, offered to be saved for tafac.fr (the system asks).
// Never awaited, never throws.
export function offerToSavePassword({ username, password }) {
  if (!isDesktopApp() || !username || !password) return
  if (lastPicked?.username === username && lastPicked?.password === password) return
  void fetch('/__desktop/password/save', {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).catch(() => {})
}
