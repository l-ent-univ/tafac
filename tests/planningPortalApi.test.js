import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlanningPortalApiClient } from '../planningPortalApi.js'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createFixtureClient({ firstTokenEmpty = false, treeUnauthorizedOnce = false, law = false, noResources = false, sessionExpiresAfter = null } = {}) {
  const requests = []
  let accessTokenRequestCount = 0
  let signInCount = 0
  let eventsRequestCount = 0
  let casFollowCount = 0
  let treeRequestCount = 0
  const fetchWithJar = async (url, _jar, options = {}) => {
    requests.push({ url, options })

    if (url.endsWith('/sso/accessToken')) {
      accessTokenRequestCount += 1
      if (firstTokenEmpty && accessTokenRequestCount === 1) {
        return jsonResponse({ token: '' })
      }
      return jsonResponse({ token: 'fixture-token' })
    }

    if (url.endsWith('/RestApi/configuration/sso')) {
      return jsonResponse({ data: { webSSO: true, protocol: 'CAS' } })
    }

    if (url.endsWith('/RestApi/portal/ssologin')) {
      signInCount += 1
      return jsonResponse({
        data: {
          authData: {
            projectId: 1,
            accessToken: 'fixture-api-token',
            refreshToken: 'fixture-refresh-token',
            resources: noResources
              ? []
              : law
                ? [{ id: 605, name: 'TP 04B' }]
                : [{ id: 14961, name: 'BUT MMI 2' }],
          },
        },
      })
    }

    if (url.includes('/RestApi/portal/refreshtoken?')) {
      if (sessionExpiresAfter !== null) {
        return jsonResponse({ error: 'session expired' }, 401)
      }
      return jsonResponse({
        data: {
          accessToken: 'fixture-api-token-refreshed',
          refreshToken: 'fixture-refresh-token-refreshed',
        },
      })
    }

    if (url.endsWith('/RestApi/portal/projects/1/resourcestree')) {
      treeRequestCount += 1
      if (treeUnauthorizedOnce && treeRequestCount === 1) {
        return jsonResponse({ error: 'expired' }, 401)
      }

      return jsonResponse({
        data: {
          category: law ? [{
            category: 'trainee',
            branch: [{
              id: 600,
              name: 'Droit',
              branch: [{
                id: 601,
                name: 'RENNES',
                branch: [{
                  id: 602,
                  name: 'LICENCE 1',
                  branch: [{
                    id: 603,
                    name: 'GROUPES TD',
                    branch: [{
                      id: 604,
                      name: 'TD 04',
                      leaf: [{ id: 605, name: 'TP 04B' }],
                    }],
                  }],
                }],
              }],
            }],
          }] : [{
            category: 'trainee',
            branch: [{
              id: 100,
              name: 'IUT Lannion',
              branch: [{
                id: 200,
                name: 'BUT MMI',
                branch: [
                  {
                    id: 300,
                    name: 'MMI A2',
                    branch: [{
                      id: 400,
                      name: '2B MMI',
                      branch: [{
                        id: 500,
                        name: '2B2 MMI',
                        leaf: [
                          { id: 14961, name: '2B2-StratUX MMI' },
                          { id: 14962, name: '2B2-Dev MMI' },
                        ],
                      }],
                    }],
                  },
                  {
                    id: 301,
                    name: 'MMI A1',
                    leaf: [{ id: 14960, name: '1A MMI' }],
                  },
                ],
              }],
            }],
          }, {
            category: 'classroom',
            branch: [{
              id: 700,
              name: 'Lannion',
              branch: [{
                id: 701,
                name: 'IUT Bât. A',
                leaf: [{ id: 702, name: 'A101' }, { id: 703, name: 'A102' }],
              }],
              leaf: [{ id: 704, name: 'Amphi Lannion' }],
            }],
          }],
        },
      })
    }

    if (url.endsWith('/RestApi/portal/projects/1/calendar/')) {
      return jsonResponse({ data: { firstWeek: 35, lastWeek: 52 } })
    }

    if (url.includes('/RestApi/portal/projects/1/resourcesEventsPortal/')) {
      eventsRequestCount += 1
      // The portal session ends on ADE's side after that many calls: the
      // next one is refused until a new sign-in.
      if (sessionExpiresAfter !== null && eventsRequestCount === sessionExpiresAfter + 1) {
        return jsonResponse({ error: 'expired' }, 401)
      }
      return jsonResponse({
        data: [{
          id: 14961,
          events: [{
            id: 501,
            activityId: 42,
            name: 'Développement web',
            date: '02/09/2026',
            startHour: '08:00+0200',
            endHour: '10:00+0200',
            color: '120,140,160',
            canUpdateEvent: false,
            eventParticipants: [
              { category: 'instructor', name: 'Mme Dupont' },
              { category: 'classroom', name: 'Salle 12' },
              { category: 'category8', name: 'TP 1' },
            ],
          }],
        }],
        settings: [{ detail: 'Nom' }],
      })
    }

    throw new Error(`Unexpected fixture URL: ${url}`)
  }

  const client = createPlanningPortalApiClient({
    casOrigin: 'https://sso.example.test',
    planningOrigin: 'https://planning.example.test',
    fetchWithJar,
    followRedirectChain: async () => {
      casFollowCount += 1
      return {
        finalUrl: 'https://planning.example.test/portal/',
        response: new Response('<html></html>'),
      }
    },
  })

  return {
    client,
    requests,
    getAccessTokenRequestCount: () => accessTokenRequestCount,
    getSignInCount: () => signInCount,
    getCasFollowCount: () => casFollowCount,
    getTreeRequestCount: () => treeRequestCount,
  }
}

test('uses the current portal REST routes and normalizes its JSON', async () => {
  const { client, requests, getCasFollowCount } = createFixtureClient()
  const jar = {}
  const cacheScope = 'portal-fixture-main'

  const status = await client.fetchPortalStatus(jar)
  assert.equal(status.data.protocol, 'CAS')

  const tree = await client.fetchPortalTree(jar, { cacheScope })
  assert.equal(tree.projectId, 1)
  assert.equal(tree.currentResourceId, '14961')
  assert.deepEqual(tree.currentPathIds, ['-100', '-1', '100', '200', '300', '400', '500', '14961'])
  assert.deepEqual(tree.selectionPathIds, ['100', '200', '300', '400', '14961'])
  assert.equal(tree.defaultSelection.resourceId, '14961')
  assert.equal(tree.defaultSelection.programLabel, 'BUT MMI')
  assert.equal(tree.defaultSelection.yearLabel, 'MMI A2')
  assert.equal(tree.defaultSelection.tdLabel, '2B MMI')
  assert.equal(tree.defaultSelection.tpLabel, '2B2-StratUX MMI')
  assert.deepEqual(tree.root.children.map(({ id }) => id), ['-1'])
  assert.ok(JSON.stringify(tree.root).length < JSON.stringify(tree.fullRoot).length)

  const search = await client.searchPortalTree(jar, 'MMI', { cacheScope })
  assert.deepEqual(search.results.map(({ id }) => id), ['14961', '14962', '14960'])

  const tdTree = await client.fetchPortalTree(jar, {
    requestedResourceId: '400',
    cacheScope,
  })
  const tdFocus = tdTree.root.children[0].children[0].children[0].children[0].children[0]
  assert.deepEqual(tdFocus.children.map(({ id }) => id), ['14961', '14962'])

  const calendar = await client.fetchPortalCalendar(jar, { cacheScope })
  assert.equal(calendar.calendar.firstWeek, 35)

  const events = await client.fetchPortalEvents(jar, {
    date: '2026-09-02',
    lookaheadDays: 2,
    resourceIds: ['14961'],
    cacheScope,
  })
  assert.equal(events.events.length, 1)
  assert.deepEqual(events.events[0], {
    uid: '501',
    title: 'Développement web',
    teacher: 'Mme Dupont',
    teachers: [{ id: null, name: 'Mme Dupont' }],
    location: 'Salle 12',
    groups: ['TP 1'],
    groupsLabel: 'TP 1',
    start: '2026-09-02T06:00:00.000Z',
    end: '2026-09-02T08:00:00.000Z',
    startMs: 1788328800000,
    endMs: 1788336000000,
    date: '2026-09-02',
    timeLabel: '08:00 - 10:00',
    editable: false,
    color: '120,140,160',
    hue: null,
    link: null,
    resourceId: '14961',
    activityId: 42,
  })

  const eventRequest = requests.find(({ url }) => url.includes('resourcesEventsPortal'))
  assert.match(eventRequest.url, /resources;14961\/startdate;09022026\/enddate;09032026\/level;=8\/field;Nom;CODEZ_RESOURCE;OWNER;$/)
  assert.equal(eventRequest.options.headers.Authorization, 'Bearer fixture-api-token')
  assert.equal(getCasFollowCount(), 0)
})

test('accepts a selected numeric subgroup from the resource tree', async () => {
  const { client, requests } = createFixtureClient()
  const result = await client.fetchPortalEvents({}, {
    date: '2026-09-02',
    resourceIds: ['98765'],
    cacheScope: 'portal-fixture-subgroup',
  })

  assert.deepEqual(result.resourceIds, ['98765'])
  assert.ok(requests.some(({ url }) => url.includes('/resources;98765/')))
})

test('falls back to CAS only when the existing portal session cannot mint a token', async () => {
  const {
    client,
    getAccessTokenRequestCount,
    getCasFollowCount,
  } = createFixtureClient({ firstTokenEmpty: true })

  const tree = await client.fetchPortalTree({}, { cacheScope: 'portal-fixture-cas' })
  assert.equal(tree.projectId, 1)
  assert.equal(getCasFollowCount(), 1)
  assert.equal(getAccessTokenRequestCount(), 2)
})

test('refreshes the API bearer and retries one unauthorized REST request', async () => {
  const {
    client,
    requests,
    getTreeRequestCount,
  } = createFixtureClient({ treeUnauthorizedOnce: true })

  const tree = await client.fetchPortalTree({}, { cacheScope: 'portal-fixture-refresh' })
  assert.equal(tree.currentResourceId, '14961')
  assert.equal(getTreeRequestCount(), 2)

  const treeRequests = requests.filter(({ url }) => url.endsWith('/RestApi/portal/projects/1/resourcestree'))
  assert.equal(treeRequests[0].options.headers.Authorization, 'Bearer fixture-api-token')
  assert.equal(treeRequests[1].options.headers.Authorization, 'Bearer fixture-api-token-refreshed')

  const refreshRequest = requests.find(({ url }) => url.includes('/RestApi/portal/refreshtoken?'))
  assert.equal(refreshRequest.options.headers.Authorization, undefined)
})

test('weeks asked at once share one portal sign-in', async () => {
  const { client, getSignInCount, getAccessTokenRequestCount } = createFixtureClient()
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21']

  const results = await Promise.all(weeks.map((date) => (
    client.fetchPortalEvents({}, { date, lookaheadDays: 7, resourceIds: ['14961'], cacheScope: 'portal-fixture-together' })
  )))

  assert.equal(results.length, 3)
  assert.ok(results.every((result) => result.complete))
  assert.equal(getSignInCount(), 1)
  assert.equal(getAccessTokenRequestCount(), 1)
})

test('signs in again when a cached portal session is gone on ADE’s side', async () => {
  const { client, getSignInCount } = createFixtureClient({ sessionExpiresAfter: 1 })
  const ask = () => client.fetchPortalEvents({}, { date: '2026-09-07', lookaheadDays: 7, resourceIds: ['14961'], cacheScope: 'portal-fixture-expired' })

  await ask()
  const result = await ask()

  assert.equal(result.events.length, 1)
  assert.equal(getSignInCount(), 2)
})

test('does not sign in twice when a fresh sign-in fails', async () => {
  const { client, getSignInCount } = createFixtureClient({ sessionExpiresAfter: 0 })

  await assert.rejects(client.fetchPortalEvents({}, { date: '2026-09-07', resourceIds: ['14961'], cacheScope: 'portal-fixture-fresh-fail' }))
  assert.equal(getSignInCount(), 1)
})

test('maps a non-BUT path to generic level, TD and TP selections', async () => {
  const { client } = createFixtureClient({ law: true })
  const cacheScope = 'portal-fixture-law'
  const tree = await client.fetchPortalTree({}, { cacheScope })

  assert.deepEqual(tree.selectionPathIds, ['600', '601', '602', '604', '605'])
  assert.equal(tree.defaultSelection.yearLabel, 'LICENCE 1')
  assert.equal(tree.defaultSelection.tdLabel, 'TD 04')
  assert.equal(tree.defaultSelection.tpLabel, 'TP 04B')

  const levelTree = await client.fetchPortalTree({}, {
    requestedResourceId: '602',
    cacheScope,
  })
  const levelFocus = levelTree.root.children[0].children[0].children[0].children[0]
  assert.deepEqual(levelFocus.children.map(({ id }) => id), ['604'])
})

test('lists the rooms of the "Salles" branch with the folders above them', async () => {
  const { client } = createFixtureClient()
  const result = await client.listPortalClassrooms({}, { cacheScope: 'portal-fixture-rooms' })
  assert.equal(result.available, true)
  assert.deepEqual(result.rooms.map(({ id, name, path }) => [id, name, path.join(' › ')]).sort(), [
    ['702', 'A101', 'Lannion › IUT Bât. A'],
    ['703', 'A102', 'Lannion › IUT Bât. A'],
    ['704', 'Amphi Lannion', 'Lannion'],
  ])
})

test('lets a found group stand in for an account without one', async () => {
  const { client } = createFixtureClient({ noResources: true })

  const bare = await client.fetchPortalTree({}, { cacheScope: 'portal-fixture-none' })
  assert.equal(bare.defaultSelection, null)
  assert.equal(bare.currentResourceId, null)

  const found = await client.fetchPortalTree({}, { fallbackResourceId: '14962', cacheScope: 'portal-fixture-none' })
  assert.equal(found.defaultSelection.resourceId, '14962')
  assert.equal(found.defaultSelection.yearLabel, 'MMI A2')
  assert.equal(found.defaultSelection.tpLabel, '2B2-Dev MMI')
  assert.deepEqual(found.selectionPathIds, ['100', '200', '300', '400', '14962'])

  // Not in the tree: as without it.
  const unknown = await client.fetchPortalTree({}, { fallbackResourceId: '999', cacheScope: 'portal-fixture-none' })
  assert.equal(unknown.defaultSelection, null)
})

test('keeps the account’s own group over a fallback', async () => {
  const { client } = createFixtureClient()
  const tree = await client.fetchPortalTree({}, { fallbackResourceId: '14962', cacheScope: 'portal-fixture-own' })
  assert.equal(tree.defaultSelection.resourceId, '14961')
})
