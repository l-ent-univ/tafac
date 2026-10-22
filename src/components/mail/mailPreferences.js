export const MAIL_PREFERENCES_KEY = 'tafac:mail_preferences'

export const DEFAULT_MAIL_PREFERENCES = {
  signatureEnabled: true,
  signatureHtml: '<p><br/></p><p>Bien cordialement,<br/><strong>[Prénom Nom]</strong><br/><em>Étudiant(e) · Université de Rennes</em></p>',
  autoCc: false,
  autoBcc: false,
  bccEmail: '',
  confirmBeforeSend: false,
}

export function getMailPreferences() {
  if (typeof window === 'undefined') return DEFAULT_MAIL_PREFERENCES
  try {
    const raw = localStorage.getItem(MAIL_PREFERENCES_KEY)
    if (!raw) return DEFAULT_MAIL_PREFERENCES
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_MAIL_PREFERENCES,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    }
  } catch {
    return DEFAULT_MAIL_PREFERENCES
  }
}

export function saveMailPreferences(newPrefs) {
  if (typeof window === 'undefined') return
  try {
    const current = getMailPreferences()
    const merged = { ...current, ...newPrefs }
    localStorage.setItem(MAIL_PREFERENCES_KEY, JSON.stringify(merged))
    return merged
  } catch {
    return DEFAULT_MAIL_PREFERENCES
  }
}
