import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

// The gateway asks the university with the cookies of this server's session
// (back/crates/tafac-gateway). A CAS binds its ticket to the User-Agent that
// signed in and deletes it when another shows it (Rennes, Rennes 2), so the
// gateway presents itself as this server does: fetch's own User-Agent, which
// server/entAuthApp.js never replaces (fetchWithJar). If this name changes
// (another Node, a User-Agent set on purpose), node.rs' USER_AGENT changes
// with it, or every route the gateway answers through the CAS goes back to
// this server.
test("fetch presents itself as the gateway says it does", async () => {
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

  assert.equal(seen, 'node')
})
