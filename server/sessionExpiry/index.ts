// When the student's session is no longer valid, and how the page is told.
//
// Every service signs in with the CAS ticket-granting cookie (TGC) the
// session keeps. When a service fails, the reason may be anything: the
// service is down, slow, answers 5xx, refuses for a reason of its own, or
// the CAS sign-in behind it is gone. Only the last one signs the student
// out, and only the CAS can say it: its login page, asked with the TGC,
// shows the password form once the ticket is dead and « Log In Successful »
// while it lives. Anything else (no answer, a 5xx, an unknown page) is not
// a sign-out.
//
// The page is told by one header on any answer of /__ent_auth and
// /__ent_proxy, `X-Tafac-Session: expired` (src/entApi.js), set when the
// request has no session of the app's own (signed out elsewhere, its
// cookie gone) or when the CAS said the session is dead (the route then
// answers 401 { error: 'session_expired' }).

export const SESSION_HEADER = 'X-Tafac-Session'
export const SESSION_EXPIRED = 'expired'
export const SESSION_EXPIRED_CODE = 'session_expired'

interface HeaderTarget {
  setHeader(name: string, value: string): unknown
}

export function markSessionExpired(res: HeaderTarget): void {
  res.setHeader(SESSION_HEADER, SESSION_EXPIRED)
}

export type CasSessionState = 'valid' | 'expired' | 'unknown'

export interface CasLoginPage {
  status: number
  html: string
}

// The CAS login page (GET /login, no service) asked with the session's TGC.
//   expired  the password form: the CAS wants credentials again;
//   valid    a page without a form (Apereo's « Log In Successful »);
//   unknown  anything else: a redirect, an error, an outage page.
export function classifyCasLoginPage({ status, html }: CasLoginPage): CasSessionState {
  if (status !== 200) return 'unknown'
  if (/<input[^>]*\bname=["']password["']/i.test(html)) return 'expired'
  if (/<input[^>]*\bname=["']execution["']/i.test(html)) return 'unknown'
  return 'valid'
}

export interface CasSessionProbeOptions<Jar> {
  // Whether the jar still holds the TGC: without it nothing can sign in.
  hasTicket: (jar: Jar) => boolean
  // The CAS login page with the jar's cookies; throws on no answer.
  fetchLoginPage: (jar: Jar) => Promise<CasLoginPage>
  // How long a « valid » answer is taken as is, so that a service down for
  // a while doesn't send the CAS a request on each of its failures.
  validForMs?: number
  now?: () => number
}

export interface CasSessionProbe<Jar> {
  check: (key: string, jar: Jar) => Promise<CasSessionState>
  forget: (key: string) => void
}

const DEFAULT_VALID_FOR_MS = 60_000

export function createCasSessionProbe<Jar>(options: CasSessionProbeOptions<Jar>): CasSessionProbe<Jar> {
  const { hasTicket, fetchLoginPage } = options
  const validForMs = options.validForMs ?? DEFAULT_VALID_FOR_MS
  const now = options.now ?? Date.now
  const known = new Map<string, { state: CasSessionState; at: number }>()
  // One request at a time per session: the requests that failed together
  // share it.
  const inflight = new Map<string, Promise<CasSessionState>>()

  async function ask(jar: Jar): Promise<CasSessionState> {
    if (!hasTicket(jar)) return 'expired'
    try {
      return classifyCasLoginPage(await fetchLoginPage(jar))
    } catch {
      return 'unknown'
    }
  }

  function check(key: string, jar: Jar): Promise<CasSessionState> {
    const entry = known.get(key)
    if (entry?.state === 'expired') return Promise.resolve('expired')
    if (entry?.state === 'valid' && now() - entry.at < validForMs) return Promise.resolve('valid')

    const pending = inflight.get(key)
    if (pending) return pending

    const promise = ask(jar).then((state) => {
      if (state === 'unknown') known.delete(key)
      else known.set(key, { state, at: now() })
      // Old entries go: a dead session is asked about no more once ended.
      for (const [other, value] of known) {
        if (value.state === 'valid' && now() - value.at >= validForMs) known.delete(other)
      }
      return state
    }).finally(() => inflight.delete(key))
    inflight.set(key, promise)
    return promise
  }

  return {
    check,
    forget: (key) => {
      known.delete(key)
    },
  }
}

// Sessions ended here (signed out, or found expired): a request still on
// its way with their cookie is a request without a session, and can't
// issue that cookie again. Kept for a while, past any request in flight.
export interface EndedSessions {
  end: (id: string, reason: 'expired' | 'signed-out') => void
  reasonOf: (id: string | null | undefined) => 'expired' | 'signed-out' | null
}

const ENDED_KEPT_MS = 60 * 60 * 1000

export function createEndedSessions({ now = Date.now, keptMs = ENDED_KEPT_MS } = {}): EndedSessions {
  const ended = new Map<string, { reason: 'expired' | 'signed-out'; at: number }>()

  function prune() {
    for (const [id, entry] of ended) {
      if (now() - entry.at >= keptMs) ended.delete(id)
    }
  }

  return {
    end(id, reason) {
      prune()
      ended.set(id, { reason, at: now() })
    },
    reasonOf(id) {
      if (!id) return null
      const entry = ended.get(id)
      if (!entry) return null
      if (now() - entry.at >= keptMs) {
        ended.delete(id)
        return null
      }
      return entry.reason
    },
  }
}
