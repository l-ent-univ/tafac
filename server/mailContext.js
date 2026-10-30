// The webmail context a session's mail routes share (server/entAuthApp.js
// keeps one per session: its cookies, origin, CSRF token, and the account
// data read once per webmail sign-in), the pieces tested on their own.

import { deriveAttachmentLimits } from '../src/mailAttachments.js'

// The webmail refused the session (an expired or missing auth token, a CSRF
// refusal): signing in again fixes it, which nothing else does.
export class MailAuthError extends Error {}

const isAuthError = (error) => error instanceof MailAuthError

// A SOAP answer that means the session is gone, rather than a request the
// webmail failed: an AUTH_REQUIRED or AUTH_EXPIRED fault (the token expired
// or missing, a CSRF refusal), a 401 or 403, a redirect (to a sign-in page),
// or a page where SOAP's JSON should be. `code`: the fault's code, if any;
// `status`: the HTTP status; `json`: whether the answer was SOAP JSON.
export function isZimbraSessionRefusal({ code = '', status = 200, json = true } = {}) {
  if (/AUTH_(REQUIRED|EXPIRED)/.test(String(code ?? ''))) return true
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) return true
  return status >= 200 && status < 300 && !json
}

// Runs `fn(context)` with the session's context, signed in again once when
// the webmail refused it. `get(replacing)`: the context to use (the one
// kept, or a new sign-in when there's none or it's `replacing`, the one just
// refused); `drop(context)`: forgets that one (if it's still the one kept).
// Any other failure (a SOAP fault, a timeout, the network) keeps the
// context: it's still signed in, and other requests may be using it.
export async function runWithMailContext({ get, drop }, fn) {
  let refused = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const context = await get(refused)
    try {
      return await fn(context)
    } catch (error) {
      if (!isAuthError(error)) throw error
      drop(context)
      if (attempt > 0) throw error
      refused = context
    }
  }
  throw new Error('Unable to reach the webmail.')
}

// One request per context for account data several routes read at once (a
// cold context's /mail/prefs asks for the identities and the attachment
// limits, both from GetInfo): the one under way is shared, its answer kept
// with the context; a failure isn't, the next caller asks again. `name`
// tells them apart; forgetContextRequest has it asked again (a fresh read).
export function shareContextRequest(context, name, request) {
  context.sharedRequests ??= new Map()
  const shared = context.sharedRequests
  let entry = shared.get(name)
  if (!entry) {
    entry = Promise.resolve().then(request)
    shared.set(name, entry)
    entry.catch(() => {
      if (shared.get(name) === entry) shared.delete(name)
    })
  }
  return entry
}

export function forgetContextRequest(context, name) {
  context.sharedRequests?.delete(name)
}

// The account's attachment limits (deriveAttachmentLimits) from GetInfo's
// attSizeLimit (`readInfo(context)`), kept on the context once read. A
// GetInfo that fails for another reason than the session gives the fallback
// limits for this request only: kept, they'd stand for the whole sign-in
// (nothing would read the real ones again).
export async function readContextAttachmentLimits(context, readInfo) {
  if (context.attachmentLimits) return context.attachmentLimits
  let info
  try {
    info = await readInfo(context)
  } catch (error) {
    if (isAuthError(error)) throw error
    return deriveAttachmentLimits(null)
  }
  context.attachmentLimits ??= deriveAttachmentLimits(info?.attSizeLimit)
  return context.attachmentLimits
}
