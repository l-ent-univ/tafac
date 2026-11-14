// The login's limits (POST /__ent_auth/login): failed attempts per address
// and per login, each over a window, with a short block past the limit.
//
// A good login clears the student's own count, and takes their own earlier
// mistakes off the address's count: students behind one campus address who
// mistype then get it right don't add up against each other. It never
// clears the address's other failures: one valid account (or the public
// demo account) would otherwise reset the count between two rounds of
// guesses at everyone else's passwords.
import { createFailureWindow } from './failureWindow.ts'
import type { BlockStatus } from './failureWindow.ts'

export interface LoginRateLimiterOptions {
  windowMs: number
  blockMs: number
  maxFailuresPerIp: number
  maxFailuresPerUsername: number
  now?: () => number
}

export interface LoginRateLimiter {
  // The block in force for this address or this login, the longer of the two.
  blocked(ip: string, username: string): BlockStatus | null
  // A failed attempt; the block it brought, if any.
  recordFailure(ip: string, username: string): BlockStatus | null
  recordSuccess(ip: string, username: string): void
}

function longest(statuses: (BlockStatus | null)[]): BlockStatus | null {
  return statuses.reduce<BlockStatus | null>((current, status) => (
    status && (!current || status.retryAfterMs > current.retryAfterMs) ? status : current
  ), null)
}

export function createLoginRateLimiter({ windowMs, blockMs, maxFailuresPerIp, maxFailuresPerUsername, now }: LoginRateLimiterOptions): LoginRateLimiter {
  const byIp = createFailureWindow({ windowMs, blockMs, maxFailures: maxFailuresPerIp, now })
  const byUsername = createFailureWindow({ windowMs, blockMs, maxFailures: maxFailuresPerUsername, now })

  return {
    blocked: (ip, username) => longest([byIp.status(ip), byUsername.status(username)]),
    recordFailure: (ip, username) => longest([byIp.record(ip, username), byUsername.record(username)]),
    recordSuccess(ip, username) {
      byUsername.clear(username)
      byIp.forgive(ip, username)
    },
  }
}

export { createFailureWindow }
export type { BlockStatus }
