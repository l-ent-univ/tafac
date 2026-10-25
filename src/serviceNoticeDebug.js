// Dev only: the debug panel hides the university's outage notice
// (ServiceNotice) on this device. Read once, at load: the panel reloads the
// page after setting it.
export const SERVICE_NOTICE_DEBUG_KEY = 'l-ent:debug-hide-service-notice'

export function isServiceNoticeHiddenByDebug() {
  if (!import.meta.env?.DEV) return false
  try {
    return localStorage.getItem(SERVICE_NOTICE_DEBUG_KEY) === '1'
  } catch {
    return false
  }
}
