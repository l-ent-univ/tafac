import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { setImmediate } from 'node:timers'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import {
  buildMailHtml,
  buildMailSignature,
  buildZimbraMessage,
  composerHtmlToText,
  createSendLimiter,
  createSendOnce,
  mapDraftAttachments,
  mapZimbraSendFault,
  normalizeComposePayload,
  normalizeZimbraIdentities,
  pickIdentity,
  readDraftAttachmentParts,
  readDraftForComposer,
  readPngSize,
  sanitizeComposerHtml,
  sanitizeSubject,
  settleDraftAttachments,
  submitZimbraSend,
} from '../server/mailSend.js'
import { isValidMailMessageId } from '../server/mailMessage.js'
import { isValidZimbraUploadId } from '../server/mailUpload.js'
import { buildComposePayload, composeOrigin, draftStateKey, pickDefaultIdentity, sendFailureText } from '../src/mailSendPayload.js'
import { createDraftSaver } from '../src/mailDraftSaver.js'
import { buildDraftFields } from '../src/mailCompose.js'
import { loadServerConfig } from '../universities/index.js'

const ids = { isValidMessageId: isValidMailMessageId, isValidUploadId: isValidZimbraUploadId }
const AID = '4f6e1c2a-0b7d-4c8e-9a51-2f3e4d5c6b7a:9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f'

test('the editor HTML: its allowlist and nothing more', () => {
  const clean = sanitizeComposerHtml([
    '<p>Bonjour <strong>Camille</strong> <em>et</em> <u>tous</u> <s>non</s></p>',
    '<p style="margin-left: 64px; position: fixed">indenté</p><p style="margin-left: 50px">pas un pas</p>',
    '<h2>Titre</h2><h3 style="margin-left: 32px">Sous-titre</h3>',
    '<ol start="3"><li><p>trois</p></li></ol><ul><li><p>puce</p></li></ul>',
    '<blockquote><p>cité</p></blockquote>',
    '<a href="https://example.org" target="_blank" onclick="x()">lien</a> <a href="javascript:alert(1)">js</a> <a href="//evil.example">rel</a> <a href="mailto:a@b.fr">mail</a>',
    '<span style="color: #d1342f; font-size: 18px; font-family: Georgia, serif; background-image: url(x)">mis en forme</span>',
    '<span style="font-size: 99px; color: expression(x); font-family: Comic Sans">rien</span>',
    '<mark data-color="#fff3a3" style="background-color: #fff3a3; color: inherit">surligné</mark>',
    '<div data-mail-signature=""></div><div data-mail-signature=""></div><div data-mail-signature="">texte</div>',
    '<img src="https://track.example/p.gif"><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe>',
    '<div class="wrapper"><p>dans un div</p></div><table><tr><td>cellule</td></tr></table>',
  ].join(''))
  assert.equal(clean, [
    '<p>Bonjour <strong>Camille</strong> <em>et</em> <u>tous</u> <s>non</s></p>',
    '<p style="margin-left:64px">indenté</p><p>pas un pas</p>',
    '<h2>Titre</h2><h3 style="margin-left:32px">Sous-titre</h3>',
    '<ol start="3"><li><p>trois</p></li></ol><ul><li><p>puce</p></li></ul>',
    '<blockquote><p>cité</p></blockquote>',
    '<a href="https://example.org">lien</a> <a>js</a> <a>rel</a> <a href="mailto:a@b.fr">mail</a>',
    '<span style="color:#d1342f;font-size:18px;font-family:Georgia, serif">mis en forme</span>',
    '<span>rien</span>',
    '<mark style="background-color:#fff3a3;color:inherit">surligné</mark>',
    '<div data-mail-signature></div>',
    '<p>dans un div</p>cellule',
  ].join(''))
  assert.equal(sanitizeComposerHtml(null), '')
  assert.equal(sanitizeComposerHtml(42), '')
})

test('the mail as sent: styles inline, the signature in its placeholder', () => {
  const clean = sanitizeComposerHtml('<p>Bonjour</p><p></p><p style="margin-left: 32px">loin</p><div data-mail-signature=""></div><blockquote><p>cité</p></blockquote><ul><li><p>a</p></li></ul><a href="https://x.fr">x</a><span style="font-family: Inter Variable, system-ui, sans-serif">inter</span>')
  const html = buildMailHtml(clean, { signatureHtml: '<div>SIG</div>' })
  assert.match(html, /^<html><head><meta charset="utf-8"><\/head><body><div style="font-family:[^"]+;font-size:16px;line-height:1.5;color:#1d1d1f">/)
  assert.match(html, /<p style="margin:0">Bonjour<\/p><p style="margin:0"><br \/><\/p><p style="margin:0;margin-left:32px">loin<\/p><div>SIG<\/div>/)
  assert.match(html, /<blockquote style="margin:0.4em 0 0;padding:0 0 0 12px;border-left:2px solid #d9d2cc;color:#6b625b">/)
  assert.match(html, /<ul style="margin:0.25em 0;padding-left:1.5em"><li style="margin:0">/)
  assert.match(html, /<a href="https:\/\/x.fr" style="color:#1a73e8">/)
  // Inter isn't on the reader's machine: the system's font instead.
  assert.doesNotMatch(html, /Inter Variable/)
  assert.doesNotMatch(html, /data-mail-signature/)
  // No signature: the placeholder goes; a draft keeps it.
  assert.doesNotMatch(buildMailHtml(clean), /data-mail-signature|SIG/)
  assert.match(buildMailHtml(clean, { keepPlaceholder: true }), /<div data-mail-signature><\/div>/)
  // A « $ » in the signature isn't a replacement pattern.
  assert.match(buildMailHtml(clean, { signatureHtml: '<div>$&</div>' }), /<div>\$&<\/div>/)
})

test('the text/plain alternative', () => {
  const clean = sanitizeComposerHtml('<p>Bonjour,</p><p></p><p>Voir <a href="https://example.org/tp">le sujet</a>, <a href="https://example.org">https://example.org</a> et <a href="mailto:a@b.fr">a@b.fr</a> &amp; &lt;b&gt;</p><ul><li><p>un</p><ul><li><p>sous</p></li></ul></li><li><p>deux</p></li></ul><ol start="3"><li><p>trois</p></li><li><p>quatre</p></li></ol><div data-mail-signature=""></div><p>Le 1 oct., X a écrit :</p><blockquote><p>cité</p><p></p><blockquote><p>deux fois</p></blockquote></blockquote>')
  assert.equal(composerHtmlToText(clean, { signatureText: '-- \nCamille Martin' }), [
    'Bonjour,',
    '',
    'Voir le sujet (https://example.org/tp), https://example.org et a@b.fr & <b>',
    '- un',
    '  - sous',
    '- deux',
    '3. trois',
    '4. quatre',
    '',
    '-- ',
    'Camille Martin',
    'Le 1 oct., X a écrit :',
    '> cité',
    '>',
    '> > deux fois',
  ].join('\n'))
  assert.equal(composerHtmlToText('<p>a<br />b</p>'), 'a\nb')
})

test('the signature: escaped, its logos inline by cid with their size', () => {
  const { html, text } = buildMailSignature({
    name: 'Camille <b>Martin</b>',
    group: 'MMI 2 · TP "3"',
    establishment: 'Université Rennes 2',
    university: 'Université Rennes 2',
    logos: [{ cid: '<tafac-logo-1.abc@tafac.fr>', width: 35, height: 40, alt: 'IUT "Lannion"' }],
  })
  assert.match(html, /Camille &lt;b&gt;Martin&lt;\/b&gt;/)
  assert.match(html, /MMI 2 · TP &quot;3&quot;/)
  // The same name once.
  assert.match(html, /<div>Université Rennes 2<\/div>/)
  assert.match(html, /<img src="cid:tafac-logo-1.abc@tafac.fr" width="35" height="40" alt="IUT &quot;Lannion&quot;" style="[^"]*width:35px;height:40px/)
  assert.equal(text, '-- \nCamille <b>Martin</b>\nMMI 2 · TP "3"\nUniversité Rennes 2')
  assert.deepEqual(buildMailSignature({}), { html: '', text: '' })
  assert.deepEqual(readPngSize(Buffer.from('89504e470d0a1a0a0000000d4948445200000046000000500806000000', 'hex')), { width: 70, height: 80 })
  assert.equal(readPngSize(Buffer.from('GIF89a')), null)
})

test('the page\'s request, checked again', () => {
  const base = { to: [{ name: 'Camille', email: 'camille@univ.fr' }], subject: 'Objet', html: '<p>x</p>', sendUid: 'b2a6c1f0-8f4e-4d2a-9a51-2f3e4d5c6b7a' }
  const ok = normalizeComposePayload({
    ...base,
    cc: [{ name: 'Boss <boss@univ.fr>', email: 'CAMILLE@univ.fr' }, { name: 'Léo', email: 'leo@univ.fr' }],
    bcc: [{ email: 'leo@univ.fr' }],
    subject: 'Ligne\r\nBcc: evil@x.fr‮',
    attachments: [{ source: 'upload', aid: AID }, { source: 'message', messageId: '257', part: '2.1' }, { source: 'upload', aid: AID }],
    origin: { kind: 'replyAll', messageId: '257' },
    identityId: 'a1b2c3d4-e5f6',
    draftId: '300',
    signature: { include: true, group: ' MMI\n2 ', establishment: 'iutlan', html: '<img src=x>' },
    from: 'boss@univ.fr',
  }, ids)
  assert.ok(ok.ok)
  assert.deepEqual(ok.value.to, [{ name: 'Camille', email: 'camille@univ.fr' }])
  // Each address once (any case), a name holding an @ dropped.
  assert.deepEqual(ok.value.cc, [{ name: 'Léo', email: 'leo@univ.fr' }])
  assert.deepEqual(ok.value.bcc, [])
  assert.equal(ok.value.subject, 'Ligne Bcc: evil@x.fr')
  assert.deepEqual(ok.value.attachments, [{ source: 'upload', aid: AID }, { source: 'message', messageId: '257', part: '2.1' }])
  assert.deepEqual(ok.value.origin, { kind: 'replyAll', messageId: '257', replyType: 'r' })
  assert.deepEqual(ok.value.signature, { include: true, mode: 'auto', group: 'MMI 2', establishment: 'iutlan' })
  assert.equal('from' in ok.value, false)

  const refuse = (body, options = {}) => normalizeComposePayload(body, { ...ids, ...options })
  assert.deepEqual(refuse({ ...base, to: [{ email: 'pas une adresse' }, { email: 'a@b.fr\r\nBcc: x@y.fr' }] }), { ok: false, error: 'mail_send_invalid_recipients', invalid: ['pas une adresse', 'a@b.frBcc: x@y.fr'] })
  assert.equal(refuse({ ...base, to: [] }).error, 'mail_send_no_recipient')
  assert.equal(refuse({ ...base, to: Array.from({ length: 101 }, (_, index) => ({ email: `p${index}@univ.fr` })) }).error, 'mail_send_too_many_recipients')
  assert.equal(refuse({ ...base, to: Array.from({ length: 201 }, (_, index) => ({ email: `p${index}@univ.fr` })) }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, sendUid: undefined }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, sendUid: '<script>' }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, attachments: [{ source: 'upload', aid: '../../etc' }] }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, attachments: [{ source: 'message', messageId: '1', part: '2&x=1' }] }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, attachments: [{ source: 'message', messageId: 'zid:1', part: '2' }] }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, attachments: Array.from({ length: 21 }, () => ({ source: 'upload', aid: AID })) }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, origin: { kind: 'reply', messageId: '-12' } }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, origin: { kind: 'spam', messageId: '12' } }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, identityId: 'id with spaces' }).error, 'mail_send_invalid')
  assert.equal(refuse({ ...base, html: 'x'.repeat(1_500_001) }).error, 'mail_send_too_large')
  assert.equal(refuse([]).error, 'mail_send_invalid')
  // A draft keeps what a send would refuse out instead.
  const draft = refuse({ to: [{ email: 'à moitié@' }, { email: 'ok@univ.fr' }], html: '<p>x</p>' }, { draft: true })
  assert.deepEqual(draft.value.to, [{ name: '', email: 'ok@univ.fr' }])
  assert.equal(draft.value.sendUid, null)
  assert.ok(refuse({}, { draft: true }).ok)
  assert.equal(sanitizeSubject('a'.repeat(400)).length, 255)
})

test('the identities: only addresses the account may use, the default first', () => {
  const identities = normalizeZimbraIdentities({
    identity: [
      { name: 'Perso', id: 'persona-1', _attrs: { zimbraPrefFromAddress: 'camille@gmail.com', zimbraPrefFromDisplay: 'Camille' } },
      { name: 'Alias', id: 'persona-2', _attrs: { zimbraPrefFromAddress: 'c.martin@etudiant.univ-rennes.fr', zimbraPrefFromDisplay: 'Camille M.' } },
      { name: 'DEFAULT', id: 'acct-1', _attrs: { zimbraPrefFromDisplay: 'Camille Martin' } },
      { name: 'Bad', id: 'bad id', _attrs: { zimbraPrefFromAddress: 'camille.martin@univ-rennes.fr' } },
    ],
  }, {
    name: 'camille.martin@univ-rennes.fr',
    attrs: { _attrs: { displayName: 'Camille Martin', zimbraMailAlias: ['c.martin@etudiant.univ-rennes.fr'] } },
  })
  assert.deepEqual(identities, [
    { id: 'acct-1', name: 'Camille Martin', email: 'camille.martin@univ-rennes.fr', isDefault: true },
    { id: 'persona-2', name: 'Camille M.', email: 'c.martin@etudiant.univ-rennes.fr', isDefault: false },
  ])
  // The page can't pick one of its own.
  assert.equal(pickIdentity(identities, 'persona-1'), null)
  assert.equal(pickIdentity(identities, 'acct-1').email, 'camille.martin@univ-rennes.fr')
  assert.equal(pickIdentity(identities, null).id, 'acct-1')
  // The attrs as a list, zimbraAllowFromAddress; no identities at all.
  assert.deepEqual(normalizeZimbraIdentities({ identity: [{ name: 'DEFAULT', id: 'a', a: [{ n: 'zimbraPrefFromAddress', _content: 'shared@univ.fr' }] }] }, { name: 'me@univ.fr', attrs: { a: [{ n: 'zimbraAllowFromAddress', _content: 'shared@univ.fr' }] } }).map((entry) => entry.email), ['shared@univ.fr'])
  assert.deepEqual(normalizeZimbraIdentities(null, { name: 'me@univ.fr', attrs: {} }), [{ id: 'default', name: '', email: 'me@univ.fr', isDefault: true }])
  assert.deepEqual(normalizeZimbraIdentities(null, {}), [])
})

test('the SendMsgRequest <m>: From from the identity, the parts, the references', () => {
  const identity = { id: 'acct-1', name: 'Camille Martin', email: 'camille@univ.fr' }
  const message = buildZimbraMessage({
    identity,
    to: [{ name: 'Léo', email: 'leo@univ.fr' }],
    cc: [{ name: '', email: 'cc@univ.fr' }],
    bcc: [{ name: '', email: 'bcc@univ.fr' }],
    subject: 'Re: TP',
    html: '<html>…</html>',
    text: 'texte',
    inlineParts: [{ cid: '<tafac-logo-1.x@tafac.fr>', aid: 'logo-aid-1' }],
    attachments: [{ source: 'message', messageId: '300', part: '2' }, { source: 'upload', aid: 'aid-1' }, { source: 'upload', aid: 'aid-2' }],
    origin: { messageId: '257', replyType: 'r', messageIdHeader: '<abc@univ.fr>' },
    draftId: '400',
  })
  assert.deepEqual(message, {
    idnt: 'acct-1',
    did: '400',
    origid: '257',
    rt: 'r',
    irt: { _content: '<abc@univ.fr>' },
    e: [
      { t: 'f', a: 'camille@univ.fr', p: 'Camille Martin' },
      { t: 't', a: 'leo@univ.fr', p: 'Léo' },
      { t: 'c', a: 'cc@univ.fr' },
      { t: 'b', a: 'bcc@univ.fr' },
    ],
    su: { _content: 'Re: TP' },
    mp: [{
      ct: 'multipart/alternative',
      mp: [
        { ct: 'text/plain', content: { _content: 'texte' } },
        { ct: 'multipart/related', mp: [{ ct: 'text/html', content: { _content: '<html>…</html>' } }, { ci: 'tafac-logo-1.x@tafac.fr', attach: { aid: 'logo-aid-1' } }] },
      ],
    }],
    attach: { aid: 'aid-1,aid-2', mp: [{ mid: '300', part: '2' }] },
  })
  // A forward: rt w, no In-Reply-To; a draft saves over its id; no logos,
  // no attachments: the plain alternative.
  const forward = buildZimbraMessage({ identity: { id: 'default', name: '', email: 'me@univ.fr' }, to: [], html: 'h', text: 't', origin: { messageId: '9', replyType: 'w', messageIdHeader: '<x@y>' }, draftId: '5', forDraft: true })
  assert.equal(forward.idnt, undefined)
  assert.equal(forward.id, '5')
  assert.equal(forward.did, undefined)
  assert.equal(forward.rt, 'w')
  assert.equal(forward.irt, undefined)
  assert.deepEqual(forward.e, [{ t: 'f', a: 'me@univ.fr' }])
  assert.deepEqual(forward.mp[0].mp[1], { ct: 'text/html', content: { _content: 'h' } })
  assert.equal(forward.attach, undefined)
})

test('a saved draft\'s parts, mapped back to the page\'s references', () => {
  const draft = {
    id: '400',
    mp: [{ ct: 'multipart/mixed', part: 'TEXT', mp: [
      { ct: 'multipart/alternative', part: '1', mp: [{ ct: 'text/plain', part: '1.1' }, { ct: 'text/html', part: '1.2' }] },
      { ct: 'application/pdf', part: '2', filename: 'a.pdf', s: 10 },
      { ct: 'image/png', part: '3', filename: 'b.png', s: 20 },
      { ct: 'text/plain', part: '4', filename: 'c.txt', s: 30 },
    ] }],
  }
  const parts = readDraftAttachmentParts(draft)
  assert.deepEqual(parts.map((part) => part.name), ['a.pdf', 'b.png', 'c.txt'])
  // Zimbra puts the uploads first, then the other mails' parts.
  const references = [{ source: 'message', messageId: '257', part: '2' }, { source: 'upload', aid: 'a' }, { source: 'upload', aid: 'b' }]
  assert.deepEqual(mapDraftAttachments(references, '400', parts), [
    { messageId: '400', part: '4' },
    { messageId: '400', part: '2' },
    { messageId: '400', part: '3' },
  ])
  // Counts that don't match: by name where one does.
  assert.deepEqual(mapDraftAttachments(references, '400', parts.slice(1), ['x', 'b.png', 'nope']), [null, { messageId: '400', part: '3' }, null])
  assert.deepEqual(readDraftAttachmentParts({ mp: [{ ct: 'multipart/alternative' }] }), [])
})

test('a saved draft\'s uploads: only those mapped to a part are forgotten', () => {
  const references = [{ source: 'upload', aid: 'a' }, { source: 'upload', aid: 'b' }, { source: 'message', messageId: '257', part: '2' }]
  // As many parts as references: all by position.
  const parts = [{ part: '2', name: 'a.pdf' }, { part: '3', name: 'b.png' }, { part: '4', name: 'c.txt' }]
  assert.deepEqual(settleDraftAttachments(references, '400', parts).used, ['a', 'b'])
  // One part fewer (Zimbra merged or dropped one): by the uploads' names,
  // the one not found kept for the next save.
  const settled = settleDraftAttachments(references, '400', [{ part: '3', name: 'b.png' }, { part: '2', name: 'c.txt' }], ['a.pdf', 'b.png', null])
  assert.deepEqual(settled.attachments, [null, { messageId: '400', part: '3' }, null])
  assert.deepEqual(settled.used, ['b'])
  // Without the names (the bug: every reference null, every upload gone).
  assert.deepEqual(settleDraftAttachments(references, '400', [{ part: '3', name: 'b.png' }]).used, [])
  // No parts read at all: nothing forgotten.
  assert.deepEqual(settleDraftAttachments(references, '400', [], ['a.pdf', 'b.png', null]), { attachments: [null, null, null], used: [] })
})

test('a SendMsgRequest: a partial send read the same on the retry without the draft', async () => {
  const fault = (code) => Object.assign(new Error(`Zimbra SendMsgRequest failed (${code}).`), { zimbraCode: code, zimbraArgs: [] })
  const partial = fault('mail.SEND_PARTIAL_ADDRESS_FAILURE')
  const run = async (answers, message = { did: '400', su: 'x' }) => {
    const sent = []
    const result = await submitZimbraSend(async (m) => {
      sent.push({ ...m })
      const answer = answers.shift()
      if (answer) throw answer
    }, message)
    return { result, sent }
  }
  assert.deepEqual(await run([null]), { result: null, sent: [{ did: '400', su: 'x' }] })
  assert.equal((await run([partial])).result, partial)
  // The draft gone: sent again without it; partial then too (the bug: it
  // was thrown, the page told « Message envoyé » with no cleanup).
  const retried = await run([fault('mail.NO_SUCH_MSG'), partial])
  assert.equal(retried.result, partial)
  assert.deepEqual(retried.sent, [{ did: '400', su: 'x' }, { su: 'x' }])
  assert.equal((await run([fault('mail.NO_SUCH_MSG'), null])).result, null)
  // Without a draft, a missing message is the caller's to map; another fault too.
  await assert.rejects(run([fault('mail.NO_SUCH_MSG')], { su: 'x' }), /NO_SUCH_MSG/)
  await assert.rejects(run([fault('mail.SEND_ABORTED_ADDRESS_FAILURE')]), /SEND_ABORTED/)
  await assert.rejects(run([fault('mail.NO_SUCH_MSG'), fault('mail.SEND_ABORTED_ADDRESS_FAILURE')]), /SEND_ABORTED/)
  // What the page is told of it, the same way on both paths.
  const named = Object.assign(fault('mail.SEND_PARTIAL_ADDRESS_FAILURE'), { zimbraArgs: [{ n: 'invalid', _content: 'Nope@univ.fr' }] })
  assert.deepEqual(mapZimbraSendFault(named, { recipients: ['leo@univ.fr', 'nope@univ.fr'] }), { status: 200, code: 'mail_send_partial', invalid: ['nope@univ.fr'] })
})

test('a send asked for twice: the first one\'s outcome, failures forgotten', async () => {
  const once = createSendOnce({ ttlMs: 1000, perKey: 2 })
  let calls = 0
  let release = null
  const first = once.run('s1', 'uid-1', () => new Promise((resolve) => {
    calls += 1
    release = () => resolve({ partial: null })
  }), 0)
  assert.equal(once.has('s1', 'uid-1', 10), true)
  assert.equal(once.has('s2', 'uid-1', 10), false)
  // While the first goes: the same wait.
  const second = once.run('s1', 'uid-1', () => { calls += 1 }, 10)
  await new Promise((resolve) => setImmediate(resolve))
  release()
  assert.deepEqual(await first, { partial: null })
  assert.equal(await second, await first)
  // Once sent: its answer, nothing run again.
  assert.deepEqual(await once.run('s1', 'uid-1', () => { calls += 1 }, 20), { partial: null })
  assert.equal(calls, 1)
  // A failure is forgotten: a later try goes.
  await assert.rejects(once.run('s1', 'uid-2', () => { throw new Error('refused') }, 30), /refused/)
  assert.equal(once.has('s1', 'uid-2', 40), false)
  assert.equal(await once.run('s1', 'uid-2', () => 'sent', 50), 'sent')
  // Bounded: past ttlMs, or perKey uids, the oldest go.
  assert.equal(once.has('s1', 'uid-1', 1000), false)
  await once.run('s1', 'uid-3', () => 'sent', 60)
  assert.equal(once.has('s1', 'uid-1', 70), false)
  assert.equal(once.has('s1', 'uid-3', 70), true)
  once.forget('s1')
  assert.equal(once.has('s1', 'uid-3', 70), false)
})

test('a draft back into the composer', () => {
  const draft = readDraftForComposer({
    id: '400',
    l: '6',
    su: 'Brouillon\r\n',
    idnt: 'persona-2',
    origid: '257',
    rt: 'w',
    e: [{ t: 'f', a: 'me@univ.fr' }, { t: 't', a: 'leo@univ.fr', p: 'Léo' }, { t: 't', a: 'LEO@univ.fr' }, { t: 'c', a: 'not an address' }, { t: 'b', a: 'b@univ.fr' }],
    mp: [{ ct: 'multipart/alternative', mp: [
      { ct: 'text/plain', body: true, content: 'texte' },
      { ct: 'text/html', body: true, content: '<html><body><div style="font-family:x"><p style="margin:0">Salut <script>x</script></p><div data-mail-signature></div></div></body></html>' },
    ] }],
  }, [{ id: 'persona-2' }])
  assert.deepEqual(draft, {
    id: '400',
    to: [{ name: 'Léo', email: 'leo@univ.fr' }],
    cc: [],
    bcc: [{ name: '', email: 'b@univ.fr' }],
    subject: 'Brouillon',
    html: '<p>Salut </p><div data-mail-signature></div>',
    attachments: [],
    identityId: 'persona-2',
    origin: { kind: 'forward', messageId: '257' },
  })
  const plain = readDraftForComposer({ id: '1', mp: [{ ct: 'text/plain', body: true, content: 'ligne <b>\n\nfin' }] }, [])
  assert.equal(plain.html, '<p>ligne &lt;b&gt;</p><p></p><p>fin</p>')
  assert.equal(plain.identityId, null)
})

test('Zimbra\'s faults the page is told about', () => {
  const fault = (code, args = []) => Object.assign(new Error('x'), { zimbraCode: code, zimbraArgs: args })
  assert.deepEqual(
    mapZimbraSendFault(fault('mail.SEND_ABORTED_ADDRESS_FAILURE', [{ n: 'invalid', _content: 'Bad@Univ.fr' }, { n: 'unsent', _content: 'other@x.fr' }, { n: 'invalid', _content: 'not-ours@evil.fr' }]), { recipients: ['bad@univ.fr', 'ok@univ.fr', 'other@x.fr'] }),
    { status: 422, code: 'mail_send_invalid_recipients', invalid: ['bad@univ.fr', 'other@x.fr'] },
  )
  assert.deepEqual(mapZimbraSendFault(fault('mail.SEND_PARTIAL_ADDRESS_FAILURE', [{ n: 'invalid', _content: 'bad@univ.fr' }]), { recipients: ['bad@univ.fr'] }), { status: 200, code: 'mail_send_partial', invalid: ['bad@univ.fr'] })
  assert.deepEqual(mapZimbraSendFault(fault('mail.NO_SUCH_UPLOAD', [{ n: 'id', _content: 'aid-1' }]), { aids: ['aid-1', 'aid-2'] }), { status: 409, code: 'mail_send_upload_expired', aids: ['aid-1'] })
  assert.deepEqual(mapZimbraSendFault(fault('mail.QUOTA_EXCEEDED')), { status: 413, code: 'mail_send_quota' })
  assert.deepEqual(mapZimbraSendFault(fault('mail.MESSAGE_TOO_BIG')), { status: 413, code: 'mail_send_too_large' })
  assert.deepEqual(mapZimbraSendFault(fault('mail.NO_SUCH_MSG')), { status: 409, code: 'mail_send_missing_reference' })
  assert.equal(mapZimbraSendFault(fault('service.FAILURE')), null)
  assert.equal(mapZimbraSendFault(new Error('network')), null)
})

test('the send limiter: per minute, per day, recipients, every key', () => {
  const limiter = createSendLimiter({ perMinute: 5, perDay: 100, recipientsPerDay: 500 })
  const start = 1_000_000
  for (let index = 0; index < 5; index += 1) assert.ok(limiter.take(['session:a', 'user:x'], 1, start + index).ok)
  const blocked = limiter.take(['session:a', 'user:x'], 1, start + 10)
  assert.equal(blocked.ok, false)
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60)
  // The same user from another session: the user's own count holds.
  assert.equal(limiter.take(['session:b', 'user:x'], 1, start + 20).ok, false)
  assert.ok(limiter.take(['session:b', 'user:y'], 1, start + 20).ok)
  // A minute later, again.
  assert.ok(limiter.take(['session:a', 'user:x'], 1, start + 61_000).ok)
  // Recipients per day.
  const recipients = createSendLimiter({ perMinute: 100, perDay: 100, recipientsPerDay: 500 })
  assert.ok(recipients.take(['k'], 400, start).ok)
  assert.equal(recipients.take(['k'], 101, start + 1).ok, false)
  assert.ok(recipients.take(['k'], 100, start + 2).ok)
  // Per day.
  const daily = createSendLimiter({ perMinute: 1000, perDay: 3 })
  for (let index = 0; index < 3; index += 1) assert.ok(daily.take(['k'], 0, start + index * 120_000).ok)
  const day = daily.take(['k'], 0, start + 400_000)
  assert.equal(day.ok, false)
  assert.ok(day.retryAfter > 80_000)
})

test('the page\'s payload: references, no From, the signature\'s choices only', () => {
  const state = {
    to: [{ name: 'Léo', email: 'leo@univ.fr' }, { name: '', email: 'pas bon', invalid: true }],
    cc: [],
    bcc: [],
    subject: 'Objet',
    html: '<p>x</p><div data-mail-signature=""></div>',
    attachments: [
      { key: 'upload:1', source: 'upload', aid: 'aid-1', status: 'ready' },
      { key: 'upload:2', source: 'upload', status: 'uploading' },
      { key: 'message:257:2', source: 'message', messageId: '257', part: '2', status: 'ready' },
    ],
    origin: composeOrigin('reply-all', { id: '257' }),
    identityId: 'acct-1',
    signature: { include: true, group: 'MMI 2', establishment: 'iutlan' },
  }
  const payload = buildComposePayload(state, { refs: new Map([['upload:1', { messageId: '400', part: '3' }]]), draftId: '400', sendUid: 'uid-12345678' })
  assert.deepEqual(payload, {
    to: [{ name: 'Léo', email: 'leo@univ.fr' }],
    cc: [],
    bcc: [],
    subject: 'Objet',
    html: '<p>x</p><div data-mail-signature=""></div>',
    attachments: [{ source: 'message', messageId: '400', part: '3' }, { source: 'message', messageId: '257', part: '2' }],
    origin: { kind: 'replyAll', messageId: '257' },
    identityId: 'acct-1',
    signature: { include: true, group: 'MMI 2', establishment: 'iutlan' },
    draftId: '400',
    sendUid: 'uid-12345678',
  })
  // The same content whatever its references: not saved again.
  assert.equal(draftStateKey(state), draftStateKey({ ...state, attachments: state.attachments.map((item) => ({ ...item, aid: null })) }))
  assert.notEqual(draftStateKey(state), draftStateKey({ ...state, subject: 'Autre' }))
  assert.deepEqual(composeOrigin('new', null, { kind: 'forward', messageId: '9' }), { kind: 'forward', messageId: '9' })
  assert.equal(composeOrigin('new', null), null)
  // « De : » for a reply: the address the mail was sent to.
  const identities = [{ id: 'a', email: 'me@univ.fr' }, { id: 'b', email: 'alias@univ.fr' }]
  assert.equal(pickDefaultIdentity(identities, { to: [{ email: 'ALIAS@univ.fr' }] }), 'b')
  assert.equal(pickDefaultIdentity(identities, { to: [{ email: 'x@y.fr' }] }), 'a')
  assert.equal(pickDefaultIdentity([], null), null)
  assert.equal(sendFailureText({ code: 'rate', retryAfter: 42 }), 'Trop d’envois, réessaie dans 42 s')
  // « Répondre à tous » leaves every one of the student's addresses out.
  const fields = buildDraftFields('reply-all', { from: { email: 'leo@univ.fr' }, to: [{ email: 'me@univ.fr' }, { email: 'alias@univ.fr' }, { email: 'x@univ.fr' }], cc: [] }, ['me@univ.fr', 'alias@univ.fr'])
  assert.deepEqual(fields.to.map((entry) => entry.email), ['leo@univ.fr', 'x@univ.fr'])
})

test('the draft saver: one save at a time, none when nothing changed, parts kept', async () => {
  const bodies = []
  const discarded = []
  let release = null
  const saver = createDraftSaver({
    save: async (body) => {
      bodies.push(body)
      if (bodies.length === 1) await new Promise((resolve) => { release = resolve })
      return { status: 'ok', draft: { id: '400', attachments: body.attachments.map((entry, index) => ({ messageId: '400', part: String(index + 2) })) } }
    },
    discardDraft: async (id) => discarded.push(id),
  })
  const statuses = []
  saver.subscribe((status) => statuses.push(status))
  const state = { to: [], cc: [], bcc: [], subject: 'a', html: '<p>a</p>', attachments: [{ key: 'upload:1', source: 'upload', aid: 'aid-1', status: 'ready' }], origin: null, identityId: null, signature: { include: false } }
  const first = saver.save(state)
  const second = saver.save({ ...state, subject: 'b' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(bodies.length, 1)
  release()
  await second
  await first
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0].draftId, undefined)
  // The second names the draft, and the upload as its part.
  assert.equal(bodies[1].draftId, '400')
  assert.deepEqual(bodies[1].attachments, [{ source: 'message', messageId: '400', part: '2' }])
  await saver.save({ ...state, subject: 'b' })
  assert.equal(bodies.length, 2)
  assert.equal(saver.id, '400')
  assert.deepEqual(statuses, ['saving', 'saved', 'saving', 'saved'])
  assert.equal(saver.buildSendPayload({ ...state, subject: 'b' }, 'uid-1').draftId, '400')
  await saver.discard()
  assert.deepEqual(discarded, ['400'])
  await saver.save({ ...state, subject: 'c' })
  assert.equal(bodies.length, 2)
})

test('the draft saver: a failed save tells its listeners why', async () => {
  const failure = { status: 'error', code: 'upload-expired', aids: ['aid-1'] }
  const saver = createDraftSaver({ save: async () => failure, discardDraft: async () => {} })
  const heard = []
  saver.subscribe((status, why) => heard.push([status, why]))
  await saver.save({ to: [], cc: [], bcc: [], subject: 'a', html: '', attachments: [{ key: 'upload:1', source: 'upload', aid: 'aid-1', status: 'ready' }], origin: null, identityId: null, signature: { include: false } })
  assert.deepEqual(heard, [['saving', null], ['error', failure]])
})

// ── The routes, on the demo account (nothing leaves) ──

async function withApp(run) {
  const config = await loadServerConfig('univ-rennes')
  const app = createEntAuthApp(config, { analytics: {}, session: { secret: 'a'.repeat(44), production: false } })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const signIn = async () => {
    const response = await fetch(`${base}/__ent_auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
    })
    return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
  }
  try {
    await run({ base, signIn })
  } finally {
    server.close()
  }
}

const post = (base, path, cookie, body, headers = {}) => fetch(`${base}/__ent_auth/mail/${path}`, {
  method: 'POST',
  headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}).then(async (response) => ({ status: response.status, headers: response.headers, body: await response.json() }))

test('the send and draft routes: refusals, the demo\'s fake send, its drafts', () => withApp(async ({ base, signIn }) => {
  const cookie = await signIn()
  const mail = { to: [{ name: 'Léo', email: 'leo@univ.fr' }], subject: 'Objet', html: '<p>x</p><div data-mail-signature=""></div>', signature: { include: true, establishment: 'iutlan', group: 'MMI 2' } }
  let uid = 0
  const send = (body, headers) => post(base, 'send', cookie, { ...mail, sendUid: `uid-0000000${(uid += 1)}`, ...body }, headers)

  assert.equal((await post(base, 'send', null, mail)).status, 401)
  assert.equal((await send({}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  const big = await post(base, 'send', cookie, JSON.stringify({ ...mail, html: 'x'.repeat(2.5 * 1024 * 1024) }))
  assert.deepEqual([big.status, big.body], [413, { error: 'mail_send_too_large' }])
  assert.equal((await post(base, 'send', cookie, '{not json')).status, 400)
  assert.deepEqual((await send({ to: [{ email: 'pas une adresse' }] })).body, { error: 'mail_send_invalid_recipients', invalid: ['pas une adresse'] })
  assert.deepEqual((await send({ identityId: 'someone-else' })).body, { error: 'mail_send_invalid_identity' })
  assert.deepEqual((await send({ attachments: [{ source: 'upload', aid: 'demo-upload-00000000-0000-0000-0000-000000000000' }] })).body, { error: 'mail_send_upload_expired', aids: ['demo-upload-00000000-0000-0000-0000-000000000000'] })
  // A real session's ids aren't a demo's.
  assert.equal((await send({ origin: { kind: 'reply', messageId: '257' } })).status, 400)

  // The prefs: the identities, id, name and address only.
  const prefs = await fetch(`${base}/__ent_auth/mail/prefs`, { headers: { cookie } }).then((response) => response.json())
  assert.deepEqual(prefs.identities.map((identity) => Object.keys(identity)), [['id', 'name', 'email'], ['id', 'name', 'email']])

  // A draft, saved over, read back, then sent (and gone).
  const saved = await post(base, 'draft', cookie, { ...mail, to: [{ email: 'à moitié' }], attachments: [{ source: 'message', messageId: 'demo-mail-1', part: '2' }] })
  assert.equal(saved.status, 200)
  assert.match(saved.body.draft.id, /^demo-draft-\d+$/)
  const { id } = saved.body.draft
  assert.deepEqual(saved.body.draft.attachments, [{ messageId: id, part: '2' }])
  const again = await post(base, 'draft', cookie, { ...mail, draftId: id, attachments: [{ source: 'message', ...saved.body.draft.attachments[0] }] })
  assert.equal(again.body.draft.id, id)
  const read = await fetch(`${base}/__ent_auth/mail/draft?id=${id}`, { headers: { cookie } }).then((response) => response.json())
  assert.equal(read.draft.html, '<p>x</p><div data-mail-signature></div>')
  assert.deepEqual(read.draft.attachments.map((file) => file.name), ['Consignes TP4 – composants et état.pdf'])
  const drafts = await fetch(`${base}/__ent_auth/mail/recent?folder=6`, { headers: { cookie } }).then((response) => response.json())
  assert.deepEqual(drafts.mail.messages.map((row) => row.id), [id])

  const sent = await send({ draftId: id, attachments: [{ source: 'message', messageId: id, part: '2' }], origin: { kind: 'reply', messageId: 'demo-mail-1' } })
  assert.deepEqual([sent.status, sent.body], [200, { ok: true }])
  assert.equal(sent.headers.get('cache-control'), 'no-store')
  assert.equal((await fetch(`${base}/__ent_auth/mail/draft?id=${id}`, { headers: { cookie } })).status, 404)
  const inbox = await fetch(`${base}/__ent_auth/mail/recent`, { headers: { cookie } }).then((response) => response.json())
  assert.equal(inbox.mail.messages.find((row) => row.id === 'demo-mail-1').replied, true)
  const sentFolder = await fetch(`${base}/__ent_auth/mail/recent?folder=5`, { headers: { cookie } }).then((response) => response.json())
  const copy = await fetch(`${base}/__ent_auth/mail/message?id=${sentFolder.mail.messages[0].id}`, { headers: { cookie } }).then((response) => response.json())
  // The signature, built by the server from its config.
  assert.match(copy.message.html, /IUT de Lannion – Université de Rennes/)
  assert.match(copy.message.html, /alt="Université de Rennes"/)

  // The send limit: 5 a minute (one sent already; the refusals above gave
  // theirs back), Retry-After.
  const statuses = []
  for (let index = 0; index < 5; index += 1) statuses.push((await send({})).status)
  assert.deepEqual(statuses, [200, 200, 200, 200, 429])
  const limited = await send({})
  assert.equal(limited.body.error, 'mail_send_rate_limited')
  assert.ok(Number(limited.headers.get('retry-after')) >= 1)

  // A discarded draft is gone.
  const other = await post(base, 'draft', cookie, mail)
  await post(base, 'action', cookie, { ids: [other.body.draft.id], action: 'discard' })
  assert.equal((await fetch(`${base}/__ent_auth/mail/draft?id=${other.body.draft.id}`, { headers: { cookie } })).status, 404)
}))

const uploadDemoFile = (base, cookie, bytes = 5) => fetch(`${base}/__ent_auth/mail/upload`, {
  method: 'POST',
  headers: { cookie, 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="a.txt"' },
  body: Buffer.alloc(bytes, 97),
}).then((response) => response.json())

test('a send retried with its uid: the first answer, not a second mail', () => withApp(async ({ base, signIn }) => {
  const cookie = await signIn()
  const { attachment } = await uploadDemoFile(base, cookie)
  const mail = { to: [{ email: 'leo@univ.fr' }], subject: 'Une fois', html: '<p>x</p>', attachments: [{ source: 'upload', aid: attachment.aid }], sendUid: 'uid-retry-0001' }
  const first = await post(base, 'send', cookie, mail)
  assert.deepEqual([first.status, first.body], [200, { ok: true }])
  // The answer lost, the page tries again: its upload is used and forgotten
  // since, yet it's the first answer, and one mail in « Envoyés ».
  const retry = await post(base, 'send', cookie, mail)
  assert.deepEqual([retry.status, retry.body], [200, { ok: true }])
  const sent = await fetch(`${base}/__ent_auth/mail/recent?folder=5`, { headers: { cookie } }).then((response) => response.json())
  assert.equal(sent.mail.messages.filter((row) => row.subject === 'Une fois').length, 1)
  // A new uid naming that upload is a new send: refused, the file to attach again.
  const fresh = await post(base, 'send', cookie, { ...mail, sendUid: 'uid-retry-0002' })
  assert.deepEqual([fresh.status, fresh.body], [409, { error: 'mail_send_upload_expired', aids: [attachment.aid] }])
  // A uid of another session is that session's own.
  const other = await signIn()
  assert.equal((await post(base, 'send', other, mail)).body.error, 'mail_send_upload_expired')
}))

test('the send and draft bodies: the mail bucket before a byte is read, counted once', () => withApp(async ({ base, signIn }) => {
  const cookie = await signIn()
  // A malformed body is read (400) only once a token is taken: one each.
  let read = 0
  let blocked = null
  for (let request = 0; request < 100 && !blocked; request += 1) {
    const answer = await post(base, 'draft', cookie, '{not json')
    if (answer.status === 429) blocked = answer
    else read += 1
  }
  assert.ok(blocked, 'never limited')
  assert.ok(read >= 60 && read < 75, `${read} read`)
  assert.deepEqual(blocked.body, { error: 'mail_rate_limited' })
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1)
  assert.equal(blocked.headers.get('connection'), 'close')
  // Past the bucket: a send's body isn't read either (not its 400).
  assert.equal((await post(base, 'send', cookie, '{not json')).status, 429)
}))
