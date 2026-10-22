import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPreviewUrl, createLinkPreviewer, isPublicAddress, parseLinkMetadata } from '../server/linkPreview.js'

test('only public addresses are fetched', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(address), false, address)
  }
  assert.equal(isPublicAddress('93.184.216.34'), true)
  assert.equal(isPublicAddress('2606:4700::6810:84e5'), true)
})

test('only http(s) URLs on standard ports, without credentials or local names', () => {
  assert.equal(checkPreviewUrl('https://www.univ-rennes.fr/actu#top')?.href, 'https://www.univ-rennes.fr/actu')
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest', 'https://example.com:8443/', 'https://user:pass@example.com/', 'http://intranet.local/', 'not a url']) {
    assert.equal(checkPreviewUrl(url), null, url)
  }
})

test('reads Open Graph, falls back to the title and the description', () => {
  const html = `<html><head>
    <title>Accueil &amp; actualités</title>
    <meta property="og:title" content="Rentrée 2026 &#8211; IUT">
    <meta name="description" content="La page de la rentrée.">
    <meta property="og:image" content="/img/rentree.jpg">
    <link rel="icon" href="/favicon.png">
  </head><body><meta property="og:title" content="ignored"></body></html>`
  assert.deepEqual(parseLinkMetadata(html, 'https://www.iut-lannion.fr/rentree'), {
    url: 'https://www.iut-lannion.fr/rentree',
    title: 'Rentrée 2026 – IUT',
    description: 'La page de la rentrée.',
    image: 'https://www.iut-lannion.fr/img/rentree.jpg',
    siteName: 'iut-lannion.fr',
    icon: 'https://www.iut-lannion.fr/favicon.png',
  })
  assert.equal(parseLinkMetadata('<title>Seul titre</title>', 'https://example.com/').title, 'Seul titre')
})

test('a URL is fetched once, and a refused one never', async () => {
  let calls = 0
  const getPreview = createLinkPreviewer({
    fetcher: async (url) => {
      calls += 1
      return { url, html: '<title>Page</title>' }
    },
  })
  assert.equal((await getPreview('https://example.com/a')).title, 'Page')
  await getPreview('https://example.com/a')
  assert.equal(await getPreview('http://10.0.0.1/'), null)
  assert.equal(calls, 1)
})
