// Where the student's login and password (and the one-time code) may be
// posted: the university's CAS, nowhere else.
//
// The login starts at the portal and follows its redirects to the CAS's
// form, then posts to that form's action. Both come from the network: a
// portal that redirected elsewhere, or a form pointing at another host,
// would otherwise be handed the password. A student in a browser would see
// the address change; the server has to check it.
export function isCredentialTarget(actionUrl: string, casOrigin: string): boolean {
  try {
    return new URL(actionUrl).origin === new URL(casOrigin).origin
  } catch {
    return false
  }
}
