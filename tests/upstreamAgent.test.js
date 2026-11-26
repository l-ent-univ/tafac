import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import test from 'node:test'

import { UPSTREAM_USER_AGENT, withUpstreamAgent } from '../server/upstreamAgent/index.ts'

// A CAS binds its ticket to the User-Agent that signed in and deletes it
// when another shows it (Rennes, Rennes 2). This server and the gateway in
// front of it (back/crates/tafac-gateway) use the same sessions: whichever
// of the two signed in, both show the ticket. They go under one name.

test('the server and the gateway present themselves under the same name', () => {
  const gateway = readFileSync(new URL('../back/crates/tafac-gateway/src/node.rs', import.meta.url), 'utf8')
  const name = gateway.match(/pub\(crate\) const USER_AGENT: &str = "([^"]+)";/)?.[1]

  assert.equal(name, UPSTREAM_USER_AGENT)
})

test('every request made with a session\'s cookies says that name', async () => {
  const entAuthApp = readFileSync(new URL('../server/entAuthApp.js', import.meta.url), 'utf8')
  // The one place a session's cookies leave from.
  assert.match(entAuthApp, /async function fetchWithJar\(url, jar, options = \{\}\) \{\n {2}const headers = withUpstreamAgent\(new Headers\(options\.headers \?\? \{\}\)\)/)

  const seen = await new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      response.end('ok')
      server.close()
      resolve(request.headers['user-agent'])
    })
    server.listen(0, '127.0.0.1', () => {
      fetch(`http://127.0.0.1:${server.address().port}/`, { headers: withUpstreamAgent(new Headers({ Accept: 'text/html' })) }).catch(reject)
    })
  })

  assert.equal(seen, UPSTREAM_USER_AGENT)
})

test('a request with a name of its own keeps it', () => {
  const headers = withUpstreamAgent(new Headers({ 'User-Agent': 'App-Campus-Mobile-2.4.5' }))

  assert.equal(headers.get('user-agent'), 'App-Campus-Mobile-2.4.5')
})

// The sessions that exist were signed in under fetch's own name: the name
// set on purpose is the same, so none of them is signed out by it.
test('the name is the one fetch gave by itself until now', async () => {
  const seen = await new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      response.end('ok')
      server.close()
      resolve(request.headers['user-agent'])
    })
    server.listen(0, '127.0.0.1', () => {
      fetch(`http://127.0.0.1:${server.address().port}/`).catch(reject)
    })
  })

  assert.equal(seen, UPSTREAM_USER_AGENT)
})
