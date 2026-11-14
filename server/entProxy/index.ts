// /__ent_proxy: the page's requests to the university portal (the
// applications grid, its favourites, the account's photo), made by this
// server with the session's portal cookies.
//
// It is not a general proxy. Only a signed-in session is served, only the
// portal requests the page makes (requestPolicy.ts), with headers built here
// (portalHeaders.ts), and the answer goes back as data that can't run
// (relay.ts, the headers below): the portal's pages are never shown under
// this app's address. Mounted by server/entAuthApp.js, which hands it the
// session and the cookie jar.
import type { Request, RequestHandler, Response } from 'express'
import { buildPortalHeaders } from './portalHeaders.ts'
import { buildPortalUrl } from './portalPath.ts'
import { relayToPortal } from './relay.ts'
import { decideProxyRequest } from './requestPolicy.ts'

export interface EntProxyOptions<Session> {
  // The portal's origin (universities/<id>/server.js → origins.ent).
  entOrigin: string
  // Sent as Referer: the portal's entry page.
  referer: string
  // The request's session when it is signed in to the portal: not signed
  // out, not the demo account (which never reaches the university).
  getSession: (req: Request) => Session | null
  // fetch() with the session's portal cookies; the cookies the portal sets
  // are kept with the session.
  fetchPortal: (url: string, session: Session, init: RequestInit) => Promise<globalThis.Response>
  // Once the portal has answered: the session cookie is issued again, with
  // what the portal changed.
  onPortalAnswer?: (res: Response, session: Session) => void
  // Development servers only (requestPolicy.ts).
  allowAnyGetPath?: boolean
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000
// The layout of a large portal is a few hundred kB; a photo a few MB at most.
const API_MAX_BYTES = 5 * 1024 * 1024
const IMAGE_MAX_BYTES = 10 * 1024 * 1024
// Shown by the page as it is (AvailableApplications.jsx: getErrorMessage).
const UNAVAILABLE_MESSAGE = 'Portail indisponible pour le moment'

// Every answer: whatever the body is, a browser neither guesses its type nor
// runs it, and no other site reads it.
function hardenAnswer(res: Response): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('Cache-Control', 'no-store')
}

export function createEntProxy<Session>(options: EntProxyOptions<Session>): RequestHandler {
  const { entOrigin, referer, getSession, fetchPortal, onPortalAnswer } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async (req, res) => {
    hardenAnswer(res)
    // No body is relayed (the page sends none): whatever came is dropped.
    req.resume()

    const decision = decideProxyRequest({
      method: req.method,
      url: req.url,
      headers: req.headers,
      allowAnyGetPath: options.allowAnyGetPath === true,
    })

    if (decision.kind === 'refuse') {
      res.status(decision.status).json({ error: decision.error })
      return
    }

    const portalUrl = buildPortalUrl(entOrigin, decision.path)

    // A page of the portal: opened by the launch relay under the portal's
    // own address, signed in there with the CAS session.
    if (decision.kind === 'navigate') {
      res.redirect(302, `/__ent_auth/launch?url=${encodeURIComponent(portalUrl)}`)
      return
    }

    const session = getSession(req)
    if (!session) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    const method = decision.kind === 'api' ? decision.method : 'GET'
    try {
      const answer = await relayToPortal((url, init) => fetchPortal(url, session, init), {
        url: portalUrl,
        method,
        headers: buildPortalHeaders({ kind: decision.kind, method, headers: req.headers, entOrigin, referer }),
        imageOnly: decision.kind === 'image',
        timeoutMs,
        maxBytes: decision.kind === 'image' ? IMAGE_MAX_BYTES : API_MAX_BYTES,
      })
      onPortalAnswer?.(res, session)

      if (answer.kind === 'signed-out') {
        res.status(401).json({ error: 'The portal session has expired.' })
      } else if (answer.kind === 'not-found') {
        res.status(404).end()
      } else if (answer.kind === 'too-large') {
        res.status(502).json({ error: UNAVAILABLE_MESSAGE })
      } else {
        if (decision.kind === 'image') res.setHeader('Cache-Control', 'private, max-age=600')
        res.status(answer.status).setHeader('Content-Type', answer.contentType).end(answer.body)
      }
    } catch (error) {
      // The path, never its query, a cookie or the answer.
      const reason = error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : String(error)
      console.error(`[ent-proxy] ${method} ${decision.path.pathname} failed: ${reason}`)
      if (res.headersSent) {
        res.end()
      } else {
        res.status(502).json({ error: UNAVAILABLE_MESSAGE })
      }
    }
  }
}
