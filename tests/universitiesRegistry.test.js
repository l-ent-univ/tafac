import assert from 'node:assert/strict'
import test from 'node:test'
import { fillBrandingPlaceholders, fillPublicOrigin } from '../server/appShell.js'
import { branding as neutralBranding } from '../universities/neutral.js'
import {
  listServedUniversityIds,
  listUniversityIds,
  loadUniversityDirectoryEntry,
  resolveMultiUniversity,
} from '../universities/index.js'

test('resolveMultiUniversity: the flag decides, else a set UNIVERSITY means one', () => {
  assert.equal(resolveMultiUniversity({}), true)
  assert.equal(resolveMultiUniversity({ UNIVERSITY: 'univ-rennes' }), false)
  assert.equal(resolveMultiUniversity({ UNIVERSITY: ' ' }), true)
  assert.equal(resolveMultiUniversity({ UNIVERSITY: 'univ-rennes', MULTI_UNIVERSITY: '1' }), true)
  assert.equal(resolveMultiUniversity({ UNIVERSITY: 'univ-rennes', MULTI_UNIVERSITY: 'true' }), true)
  assert.equal(resolveMultiUniversity({ MULTI_UNIVERSITY: '0' }), false)
  assert.equal(resolveMultiUniversity({ UNIVERSITY: 'univ-rennes', MULTI_UNIVERSITY: 'false' }), false)
  // The former name still works (existing deployments).
  assert.equal(resolveMultiUniversity({ UNIVERSITY: 'univ-rennes', MULTI_TENANT: '1' }), true)
  assert.equal(resolveMultiUniversity({ MULTI_TENANT: '1', MULTI_UNIVERSITY: '0' }), false)
})

test('listServedUniversityIds: the list, else every non-example university', () => {
  assert.deepEqual(listServedUniversityIds('univ-exemple, univ-rennes,univ-exemple'), ['univ-exemple', 'univ-rennes'])
  assert.deepEqual(listServedUniversityIds(''), listUniversityIds().filter((id) => !id.startsWith('example')))
  assert.ok(!listServedUniversityIds('').includes('example-minimal'))
  assert.throws(() => listServedUniversityIds('univ-nope'), /Unknown university/)
})

test('the neutral config is not a university', () => {
  assert.ok(!listUniversityIds().includes('neutral'))
  assert.equal(neutralBranding.appName, 'Tafac')
  assert.equal(neutralBranding.about.repoUrl, 'https://github.com/l-ent-univ/tafac')
  assert.deepEqual(neutralBranding.papillon, { url: 'https://papillon.bzh' })
  assert.doesNotMatch(JSON.stringify(neutralBranding), /Rennes/)
})

test('directory entries: slug and dev-only flag from shared.js', async () => {
  assert.deepEqual(await loadUniversityDirectoryEntry('univ-rennes'), {
    id: 'univ-rennes', name: 'Université de Rennes', shortName: 'Rennes', slug: 'rennes', devOnly: false,
  })
  const exemple = await loadUniversityDirectoryEntry('univ-exemple')
  assert.equal(exemple.slug, 'exemple')
  assert.equal(exemple.devOnly, true)
})

test('the page gets its SEO text and address from the server', () => {
  const html = '<title>%LENT_SEO_TITLE%</title><meta content="%LENT_APP_NAME%"><script>{"alternateName": %LENT_ALTERNATE_NAMES_JSON%, "sameAs": ["%LENT_REPO_URL%"], "url": "__PUBLIC_ORIGIN__/"}</script>%LENT_UNKNOWN%'
  const filled = fillPublicOrigin(fillBrandingPlaceholders(html, neutralBranding), 'https://tafac.fr')
  assert.equal(filled, `<title>${neutralBranding.seoTitle}</title><meta content="Tafac"><script>{"alternateName": ["l'ent"], "sameAs": ["https://github.com/l-ent-univ/tafac"], "url": "https://tafac.fr/"}</script>%LENT_UNKNOWN%`)
})
