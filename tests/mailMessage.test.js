import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMailMessage,
  dropOwnMailCopies,
  getMailPartDisposition,
  isValidDemoMailMessageId,
  isValidMailMessageId,
  isValidMailPartId,
  mailTextToHtml,
  readContentDispositionFilename,
  sanitizeMailHtml,
} from '../server/mailMessage.js'

const clean = (html, options) => sanitizeMailHtml(html, options).html

test('scripts, handlers, frames and forms go', () => {
  const html = clean(`
    <script>alert(1)</script><p onclick="alert(2)" onmouseover="x()">Bonjour</p>
    <iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x">
    <form action="https://evil.example"><input name="password"><button>OK</button></form>
    <svg><script>alert(3)</script></svg><math><mi>x</mi></math>
    <meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example">
    <link rel="stylesheet" href="https://evil.example/a.css">`)
  assert.match(html, /<p>Bonjour<\/p>/)
  for (const forbidden of ['<script', 'onclick', 'onmouseover', '<iframe', '<object', '<embed', '<form', '<input', '<button', '<svg', '<math', '<meta', '<base', '<link', 'alert']) {
    assert.ok(!html.includes(forbidden), `${forbidden} left in ${html}`)
  }
})

test('links keep safe schemes only and open a new tab', () => {
  const html = clean('<a href="javascript:alert(1)">a</a><a href="https://x.fr/p">b</a><a href="mailto:a@b.fr">c</a><a href="data:text/html,x">d</a><a href="#top">e</a>')
  assert.ok(!html.includes('javascript:'))
  assert.ok(!html.includes('data:text'))
  assert.match(html, /<a href="https:\/\/x\.fr\/p" target="_blank" rel="noopener noreferrer">b<\/a>/)
  assert.match(html, /href="mailto:a@b\.fr"/)
  assert.match(html, /<a href="#top" target="_self"/)
})

test('remote images are held back and counted', () => {
  const result = sanitizeMailHtml('<img src="https://track.example/p.gif" alt="x"><table background="http://x.fr/bg.png"><tr><td>t</td></tr></table>')
  assert.equal(result.remoteImages, 2)
  assert.match(result.html, /<img alt="x" data-remote-src="https:\/\/track\.example\/p\.gif" \/>/)
  assert.match(result.html, /data-remote-background="http:\/\/x\.fr\/bg\.png"/)
  assert.ok(!/\ssrc=/.test(result.html))
  assert.ok(!/\sbackground=/.test(result.html))
})

test('an incoming data-remote-src is never trusted', () => {
  const html = clean('<img src="data:image/png;base64,AAAA" data-remote-src="javascript:alert(1)"><div data-remote-background="javascript:x">d</div>')
  assert.ok(!html.includes('javascript:'))
  assert.match(html, /src="data:image\/png;base64,AAAA"/)
})

test('cid images resolve, unknown ones and other schemes drop', () => {
  const html = clean('<img src="cid:logo@x"><img src="cid:missing@x"><img src="file:///etc/passwd"><img src="data:text/html,x">', {
    resolveCid: (cid) => (cid === 'logo@x' ? '/__ent_auth/mail/part?id=1&part=2' : null),
  })
  assert.equal(html, '<img src="/__ent_auth/mail/part?id=1&amp;part=2" />')
})

test('the mail’s own styles and body attributes stay', () => {
  const html = clean('<html><head><title>T</title><style>.a{color:red}</style></head><body bgcolor="#eee" style="margin:0"><p class="a">x</p></body></html>')
  assert.match(html, /<style>\.a\{color:red\}<\/style>/)
  assert.match(html, /<div style="background-color:#eee;margin:0" class="tafac-mail-body">/)
  assert.ok(!html.includes('T<'))
})

test('body colours only take plain values', () => {
  const html = clean('<body bgcolor="red;background:url(https://x.fr/a)" text="#333">x</body>')
  assert.equal(html, '<div style="color:#333" class="tafac-mail-body">x</div>')
})

test('a style tag cannot smuggle markup out', () => {
  const html = clean('<style>a{}</style><script>alert(1)</script></style><img src=x onerror=alert(1)>')
  assert.ok(!html.includes('alert'))
  assert.ok(!html.includes('onerror'))
})

const resolveLogo = (cid) => (cid === 'logo@x' ? '/__ent_auth/mail/part?id=1&part=2' : null)

test('CSS cannot reach the app’s own paths', () => {
  const sources = [
    '<div style="background:url(/__ent_proxy/uPortal/Logout)">a</div>',
    '<div style="background:url(\'__ent_auth/logout\')">a</div>',
    '<div style="background-image:u\\72l(/__ent_proxy/x)">a</div>',
    '<div style="background:\\75 rl(/__ent_proxy/x)">a</div>',
    '<div style="background:url(\\2f __ent_proxy/x)">a</div>',
    '<div style="background:url(//evil.example/x)">a</div>',
    '<div style="list-style:url(javascript:x);cursor:url(file:///x),auto">a</div>',
    '<div style="background:image-set(&quot;/__ent_proxy/x&quot; 1x)">a</div>',
    '<div style="background:-webkit-image-s\\65t(url(/__ent_proxy/x) 1x, &quot;/y&quot; 2x);color:red">a</div>',
    '<style>@import url(/__ent_proxy/a.css); @import "/b.css"; .a{background:url("/__ent_proxy/x")}</style>',
  ]
  for (const source of sources) {
    const result = sanitizeMailHtml(source)
    assert.ok(!/__ent|evil|javascript|file:|@import|[^-]image-set\(|[^-]url\(\s*['"]?\//i.test(result.html), `${source} → ${result.html}`)
    assert.equal(result.remoteImages, 0, source)
  }
})

test('CSS images: data: stays, cid: resolves, remote ones are held back and counted', () => {
  const style = clean('<div style="background:url(cid:logo@x);color:red">a</div><div style="background:url(data:image/png;base64,AAAA)">b</div><div style="background:url(cid:missing@x)">c</div>', { resolveCid: resolveLogo })
  assert.match(style, /<div style="background:url\(&quot;\/__ent_auth\/mail\/part\?id=1&amp;part=2&quot;\);color:red">a<\/div>/)
  assert.match(style, /<div style="background:url\(&quot;data:image\/png;base64,AAAA&quot;\)">b<\/div>/)
  assert.match(style, /<div style="background:none">c<\/div>/)

  const remote = sanitizeMailHtml('<td style="background:url(\'https://t.example/bg.png\') no-repeat">x</td>')
  assert.equal(remote.remoteImages, 1)
  assert.match(remote.html, /style="background:none no-repeat"/)
  assert.match(remote.html, /data-remote-style="background:url\(&quot;https:\/\/t\.example\/bg\.png&quot;\) no-repeat"/)

  const sheet = sanitizeMailHtml('<style>.a{background:url("cid:logo@x")} .b{background:URL( https://t.example/p.gif )} .d{content:"\\201C"}</style><p>x</p>', { resolveCid: resolveLogo })
  assert.equal(sheet.remoteImages, 1)
  assert.equal(
    sheet.html,
    '<style data-remote-css=".a{background:url(&quot;/__ent_auth/mail/part?id=1&amp;part=2&quot;)} .b{background:url(&quot;https://t.example/p.gif&quot;)} .d{content:&quot;\\201C&quot;}">'
      + '.a{background:url("/__ent_auth/mail/part?id=1&part=2")} .b{background:none} .d{content:"\\201C"}</style><p>x</p>',
  )
})

test('rewritten CSS cannot close its style tag, incoming holders are never trusted', () => {
  const escaped = clean('<style>.a{background:url("data:image/png,\\3c /style><img src=x onerror=alert(1)>")}</style><p>x</p>')
  assert.ok(!escaped.includes('<img'), escaped)
  assert.match(escaped, /^<style>[^<]*<\/style><p>x<\/p>$/)
  const forged = clean('<div style="color:red" data-remote-style="background:url(/x)">y</div><style data-remote-css=".a{background:url(/x)}">.b{}</style>')
  assert.equal(forged, '<div style="color:red">y</div><style>.b{}</style>')
})

test('relative links lose their href', () => {
  const html = clean('<a href="/__ent_proxy/uPortal/Logout">a</a><a href="page.html">b</a><a href="https://x.fr">c</a><a href="#top">d</a>')
  assert.equal(html, '<a target="_blank" rel="noopener noreferrer">a</a><a target="_blank" rel="noopener noreferrer">b</a>'
    + '<a href="https://x.fr" target="_blank" rel="noopener noreferrer">c</a><a href="#top" target="_self" rel="noopener noreferrer">d</a>')
})

test('plain text is escaped with clickable links', () => {
  assert.equal(
    mailTextToHtml('Voir https://x.fr/a?b=1&c=2. <b>non</b>'),
    '<div class="tafac-mail-text">Voir <a href="https://x.fr/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">https://x.fr/a?b=1&amp;c=2</a>. &lt;b&gt;non&lt;/b&gt;</div>',
  )
})

test('a Zimbra message: body, inline image used once, attachments', () => {
  const message = buildMailMessage({
    id: '257',
    su: 'Objet',
    d: 1761649200000,
    f: 'ua',
    e: [
      { t: 'f', a: 'prof@univ.fr', p: 'Prof' },
      { t: 't', a: 'moi@univ.fr' },
      { t: 'c', a: 'autre@univ.fr', p: 'Autre' },
    ],
    mp: [{
      part: 'TEXT',
      ct: 'multipart/mixed',
      mp: [
        {
          part: '1',
          ct: 'multipart/related',
          mp: [
            { part: '1.1', ct: 'text/html', body: true, content: '<p>Salut <img src="cid:logo@x"></p>' },
            { part: '1.2', ct: 'image/png', ci: '<logo@x>', s: 1200 },
          ],
        },
        { part: '2', ct: 'application/pdf', cd: 'attachment', filename: 'Sujet.pdf', s: 50000 },
        { part: '3', ct: 'image/jpeg', ci: '<unused@x>', filename: 'photo.jpg', s: 9000 },
      ],
    }],
  }, '257')

  assert.equal(message.subject, 'Objet')
  assert.equal(message.unread, true)
  assert.equal(message.flagged, false)
  assert.equal(message.format, 'html')
  assert.deepEqual(message.from, { name: 'Prof', email: 'prof@univ.fr' })
  assert.deepEqual(message.to, [{ name: 'moi@univ.fr', email: 'moi@univ.fr' }])
  assert.equal(message.cc.length, 1)
  assert.match(message.html, /<img src="\/__ent_auth\/mail\/part\?id=257&amp;part=1\.2" \/>/)
  assert.deepEqual(message.attachments.map((attachment) => attachment.name), ['Sujet.pdf', 'photo.jpg'])
  assert.equal(message.attachments[0].href, '/__ent_auth/mail/part?id=257&part=2&download=1')
})

test('a plain text message follows the theme and keeps its alternatives out', () => {
  const message = buildMailMessage({
    id: '9',
    mp: [{
      part: 'TEXT',
      ct: 'multipart/alternative',
      mp: [
        { part: '1', ct: 'text/plain', body: true, content: 'Bonjour', truncated: true },
        { part: '2', ct: 'text/html' },
      ],
    }],
  }, '9')
  assert.equal(message.format, 'text')
  assert.equal(message.truncated, true)
  assert.equal(message.attachments.length, 0)
})

test('ids and part numbers are checked', () => {
  assert.ok(isValidMailMessageId('257'))
  // A lone mail's virtual conversation (the list's rows, /mail/thread).
  assert.ok(isValidMailMessageId('-257'))
  assert.ok(isValidMailMessageId('4294967295'))
  // Another mailbox's item (zid:id), letters, too long, signs alone.
  for (const id of ['a1b2-c3:257', '0f3c9a2e-1b2c-4d5e-8f90-123456789abc:257', 'abc', '12345678901', '-', '--1', '1-', '+1', ' 1', '1\n', '1.2', '0x10']) {
    assert.ok(!isValidMailMessageId(id), id)
  }
  assert.ok(!isValidMailMessageId('../x'))
  assert.ok(!isValidMailMessageId(''))
  assert.ok(!isValidMailMessageId(257))
  assert.ok(!isValidMailMessageId(null))
  // The demo account's ids, for a demo session only: never a real one's.
  assert.ok(isValidDemoMailMessageId('demo-mail-1'))
  assert.ok(isValidDemoMailMessageId('demo-mail-12'))
  assert.ok(!isValidMailMessageId('demo-mail-1'))
  for (const id of ['257', '-257', 'demo-mail-', 'demo-mail-1x', 'demo-mail-1:2', 'demo-moodle-1', 'x-demo-mail-1']) {
    assert.ok(!isValidDemoMailMessageId(id), id)
  }
  assert.ok(isValidMailPartId('1.2'))
  assert.ok(!isValidMailPartId('TEXT'))
  assert.ok(!isValidMailPartId('1&x=2'))
})

test('the part proxy shows raster images inline and downloads the rest', () => {
  assert.deepEqual(getMailPartDisposition({ contentType: 'image/png', filename: 'logo.png' }), {
    contentType: 'image/png',
    disposition: 'inline; filename="logo.png"; filename*=UTF-8\'\'logo.png',
  })
  const svg = getMailPartDisposition({ contentType: 'image/svg+xml', filename: 'a.svg' })
  assert.match(svg.disposition, /^attachment;/)
  const html = getMailPartDisposition({ contentType: 'text/html; charset=utf-8', filename: 'page.html' })
  assert.match(html.disposition, /^attachment;/)
  const forced = getMailPartDisposition({ contentType: 'image/png', filename: 'logo.png', download: true })
  assert.match(forced.disposition, /^attachment;/)
  const odd = getMailPartDisposition({ contentType: 'bad type', filename: 'Évaluation "finale"\r\n.pdf' })
  assert.equal(odd.contentType, 'application/octet-stream')
  assert.ok(!/[\r\n]/.test(odd.disposition))
  assert.match(odd.disposition, /filename\*=UTF-8''%C3%89valuation%20_finale___\.pdf/)
})

test('upstream file names are read', () => {
  assert.equal(readContentDispositionFilename('attachment; filename="a b.pdf"'), 'a b.pdf')
  assert.equal(readContentDispositionFilename("attachment; filename*=UTF-8''%C3%A9t%C3%A9.pdf"), 'été.pdf')
  assert.equal(readContentDispositionFilename('inline; filename=x.png'), 'x.png')
  assert.equal(readContentDispositionFilename(null), null)
})

test('dropOwnMailCopies shows a mail sent to oneself once, the copy in the folder read', () => {
  const sent = { id: '10', folder: '5', messageIdHeader: '<a@x>', from: { email: 'me@u.fr' }, subject: 'Test', receivedAt: '2026-10-28T17:27:00.000Z' }
  const received = { id: '11', folder: '2', messageIdHeader: '<a@x>', from: { email: 'me@u.fr' }, subject: 'Test', receivedAt: '2026-10-28T17:27:01.000Z' }
  const other = { id: '12', folder: '2', messageIdHeader: '<b@x>', from: { email: 'me@u.fr' }, subject: 'Test', receivedAt: '2026-10-28T17:27:00.000Z' }
  assert.deepEqual(dropOwnMailCopies([sent, received, other], '2').map((m) => m.id), ['11', '12'])
  assert.deepEqual(dropOwnMailCopies([sent, received], '5').map((m) => m.id), ['10'])
  // Read from elsewhere (a search, a sub-folder): the received copy.
  assert.deepEqual(dropOwnMailCopies([sent, received], '300').map((m) => m.id), ['11'])
})

test('dropOwnMailCopies without the header: only a sent copy beside a received one, same second', () => {
  const base = { from: { email: 'Me@u.fr' }, subject: 'Test', messageIdHeader: null }
  const sent = { ...base, id: '10', folder: '5', receivedAt: '2026-10-28T17:27:00.200Z' }
  const received = { ...base, id: '11', folder: '2', receivedAt: '2026-10-28T17:27:00.400Z' }
  assert.deepEqual(dropOwnMailCopies([sent, received], '2').map((m) => m.id), ['11'])
  // Two received mails alike stay two.
  const twin = { ...received, id: '12' }
  assert.deepEqual(dropOwnMailCopies([received, twin], '2').map((m) => m.id), ['11', '12'])
  // A minute apart: not copies.
  assert.deepEqual(dropOwnMailCopies([sent, { ...received, receivedAt: '2026-10-28T17:28:00.000Z' }], '2').map((m) => m.id), ['10', '11'])
})
