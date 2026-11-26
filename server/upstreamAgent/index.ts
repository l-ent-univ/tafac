// How Tafac presents itself to the university: one User-Agent on every
// request made there with a session's cookies.
//
// A CAS binds its ticket (the TGC) to the User-Agent that signed in, and
// deletes it when another one shows it (Rennes, Rennes 2). A session is used
// by two programs: this server, and the gateway in front of it
// (back/crates/tafac-gateway), which signs in and asks the services through
// tonAPI. Whichever of the two signed in, both show the ticket afterwards,
// so both go under one name: this one here, node.rs' USER_AGENT there.
// tests/upstreamAgent.test.js holds the two together.
//
// The name is the one fetch gives by itself, under which this server signed
// every session in until now: nothing changes for the university, nor for
// the sessions that exist. It is set on purpose so that another Node, or
// another fetch, can't change it unnoticed and sign everyone out.
export const UPSTREAM_USER_AGENT = 'node'

// `headers`, with that User-Agent unless the request has one of its own.
export function withUpstreamAgent(headers: Headers): Headers {
  if (!headers.has('user-agent')) headers.set('user-agent', UPSTREAM_USER_AGENT)
  return headers
}
