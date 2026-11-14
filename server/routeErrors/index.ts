// What a route answers when it fails for a reason of its own (the
// university's service is down, answered something unexpected, timed out).
//
// The errors thrown on the way name upstream services, hosts, HTTP statuses
// and steps of the sign-in chains: nothing a student can act on, and a map
// of what is behind the app for anyone probing it. In production the page
// gets one fixed sentence and the details go to the server's log; a
// development server passes the message on, which is what its debug menu
// shows.
export { dropDebugFields } from './debugFields.ts'

// Shown by the page as it is.
export const UNAVAILABLE_MESSAGE = 'Service indisponible pour le moment'

export interface RouteErrorReporterOptions {
  production: boolean
  log?: (line: string) => void
}

interface RouteRequest {
  method: string
  path: string
}

export type RouteErrorReporter = (req: RouteRequest, error: unknown) => string

export function createRouteErrorReporter({ production, log = console.error }: RouteErrorReporterOptions): RouteErrorReporter {
  return (req, error) => {
    const message = error instanceof Error ? error.message : String(error)
    if (!production) return message

    // The path, never its query: an error class and message, which hold no
    // cookie, token or answer of the university.
    const name = error instanceof Error ? error.name : 'Error'
    log(`[route] ${req.method} ${req.path} failed: ${name}: ${message.slice(0, 300)}`)
    return UNAVAILABLE_MESSAGE
  }
}
