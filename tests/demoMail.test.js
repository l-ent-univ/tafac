import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { DEMO_MAIL_FOLDERS, DEMO_MAIL_STORAGE_KEY, createDemoMailbox, isValidDemoMailMessageId, searchDemoMailContacts } from '../src/demoMail.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  }
}

const NOW = Date.UTC(2026, 10, 26, 9, 30)
const CID = 'tafac-img-0123abcd-0000-4000-8000-000000000000@tafac.fr'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
const CONFIG = {
  university: { name: 'Université de Rennes' },
  establishments: { byId: { iutlan: { label: 'IUT de Lannion' } } },
}

let nextId = 0
function mailbox(options = {}) {
  return createDemoMailbox({
    now: () => NOW,
    config: CONFIG,
    login: 'demo',
    makeId: () => `00000000-0000-4000-8000-${String(nextId += 1).padStart(12, '0')}`,
    ...options,
  })
}

const MAIL = {
  to: [{ name: 'Léo', email: 'leo@univ.fr' }],
  subject: 'Objet',
  html: '<p>Bonjour</p><div data-mail-signature=""></div>',
  signature: { include: true, establishment: 'iutlan', group: 'Info-Com 3 · TP 3' },
}
let uid = 0
const sendBody = (overrides = {}) => ({ ...MAIL, sendUid: `uid-0000000${uid += 1}`, ...overrides })

// ── The body's check, held to the server's ─────────────────────────────────

const UPLOAD = 'demo-upload-00000000-0000-4000-8000-000000000001'
test('the demo\'s ids are its own', () => {
  for (const id of ['demo-mail-1', 'demo-mail-12', 'demo-draft-3', 'demo-sent-9999']) assert.ok(isValidDemoMailMessageId(id), id)
  for (const id of ['257', '-257', 'demo-mail-', 'demo-mail-1x', 'demo-mail-1:2', 'demo-moodle-1', 'x-demo-mail-1', 'demo-sent-12345', null, 1]) {
    assert.ok(!isValidDemoMailMessageId(id), String(id))
  }
})

// ── The mailbox ────────────────────────────────────────────────────────────

test('the inbox, its pages, its search and its folders', () => {
  const box = mailbox()
  const first = box.recent()
  assert.equal(first.status, 200)
  assert.deepEqual(Object.keys(first.body), ['authenticated', 'sessionMode', 'mail'])
  assert.equal(first.body.sessionMode, 'demo')
  assert.equal(first.body.mail.unreadCount, 7)
  assert.equal(first.body.mail.hasMore, false)
  assert.deepEqual(first.body.mail.messages.map((message) => message.id), ['demo-mail-1', 'demo-mail-2', 'demo-mail-3', 'demo-mail-4', 'demo-mail-5'])
  // Twelve minutes before the clock's time, whenever that is.
  assert.equal(first.body.mail.messages[0].receivedAt, new Date(NOW - 12 * 60 * 1000).toISOString())

  // Nothing past the first page, and no unread count there.
  assert.deepEqual(box.recent({ offset: '20' }).body.mail, { ...first.body.mail, unreadCount: null, messages: [], hasMore: false })
  assert.deepEqual(box.recent({ offset: 'x', folder: 'x' }).body, first.body)

  // The search: every word, accents and case aside; no unread count.
  const found = box.recent({ q: 'DOSSIER presse' }).body.mail
  assert.deepEqual([found.unreadCount, found.messages.map((message) => message.id)], [null, ['demo-mail-1']])
  assert.deepEqual(box.recent({ q: 'integration' }).body.mail.messages.map((message) => message.id), ['demo-mail-5'])
  assert.deepEqual(box.recent({ q: 'zzz' }).body.mail.messages, [])
  assert.deepEqual(box.recent({ q: 'dossier', offset: '20' }).body.mail.messages, [])

  // The other folders are empty until the composer fills two of them.
  for (const folder of ['5', '6', '3', '4', '300']) {
    const mail = box.recent({ folder }).body.mail
    assert.deepEqual([mail.unreadCount, mail.messages, mail.hasMore], [0, [], false], folder)
  }
  assert.equal(box.recent({ folder: '5', q: 'dossier' }).body.mail.unreadCount, null)
  assert.deepEqual(box.folders(), { status: 200, body: { folders: DEMO_MAIL_FOLDERS } })
  assert.deepEqual(DEMO_MAIL_FOLDERS.map((folder) => [folder.id, folder.kind]), [['2', 'inbox'], ['300', 'folder'], ['5', 'sent'], ['6', 'drafts'], ['4', 'junk'], ['3', 'trash']])
})

test('a sample mail, its thread, what the reader may ask', () => {
  const box = mailbox()
  const { status, body } = box.message('demo-mail-1')
  assert.equal(status, 200)
  assert.equal(body.message.format, 'text')
  assert.match(body.message.html, /^<div class="tafac-mail-text">Bonjour à tous, plusieurs d’entre vous/)
  assert.deepEqual(body.message.attachments.map((file) => [file.part, file.name, file.href]), [['2', 'Consignes – dossier de presse.pdf', null], ['3', 'exemple-communique.png', null]])
  assert.deepEqual(box.message('demo-mail-2').body.message.attachments, [])
  assert.deepEqual(box.message('demo-mail-9'), { status: 404, body: { error: 'No such message.' } })
  assert.deepEqual(box.message('257'), { status: 400, body: { error: 'Invalid message id.' } })

  const thread = box.thread('demo-mail-2', '2').body.messages
  assert.deepEqual(thread.map((row) => [row.id, row.messageIds, row.count, row.folder]), [['demo-mail-2', ['demo-mail-2'], 1, '2']])
  assert.equal(box.thread('demo-mail-2', 'x').body.messages[0].folder, '2')
  assert.deepEqual(box.thread('demo-mail-9').body.messages, [])
  assert.deepEqual(box.thread('-257'), { status: 400, body: { error: 'Invalid thread id.' } })
})

test('actions change nothing but are held to the same rules', () => {
  const box = mailbox()
  assert.deepEqual(box.action({ ids: ['demo-mail-1', 'demo-mail-2'], action: 'read' }), { status: 200, body: { ok: true } })
  assert.deepEqual(box.action({ ids: ['demo-mail-1'], action: 'move', folder: '300' }), { status: 200, body: { ok: true } })
  assert.deepEqual(box.action({ ids: ['demo-mail-1'], action: 'move', folder: '999' }), { status: 400, body: { error: 'Invalid folder.' } })
  assert.deepEqual(box.action({ ids: ['demo-mail-1'], action: 'move' }), { status: 400, body: { error: 'Invalid folder.' } })
  assert.deepEqual(box.action({ ids: ['demo-mail-1'], action: 'archive' }), { status: 400, body: { error: 'Invalid action.' } })
  for (const ids of [[], ['257'], 'demo-mail-1', Array(501).fill('demo-mail-1')]) {
    assert.deepEqual(box.action({ ids, action: 'read' }), { status: 400, body: { error: 'Invalid message ids.' } })
  }
  assert.equal(box.recent().body.mail.messages[0].unread, true)

  assert.deepEqual(box.folderAction({ folder: '2', action: 'read' }), { status: 200, body: { ok: true } })
  assert.deepEqual(box.folderAction({ folder: '3', action: 'empty' }), { status: 200, body: { ok: true } })
  for (const refused of [{ folder: '2', action: 'empty' }, { folder: '1', action: 'read' }, { folder: '999', action: 'read' }, { folder: 'x', action: 'read' }]) {
    assert.deepEqual(box.folderAction(refused), { status: 400, body: { error: 'Invalid folder.' } }, JSON.stringify(refused))
  }
  assert.deepEqual(box.folderAction({ folder: '2', action: 'delete' }), { status: 400, body: { error: 'Invalid action.' } })
})

test('the prefs and the recipients\' suggestions', () => {
  const box = mailbox()
  const prefs = box.prefs().body
  assert.equal(prefs.markRead, 0)
  assert.deepEqual(Object.keys(prefs.attachments), ['maxFileBytes', 'maxTotalBytes'])
  assert.deepEqual(prefs.identities, [
    { id: 'demo-default', name: 'Camille Martin', email: 'demo@tafac.fr' },
    { id: 'demo-etudiant', name: 'Camille Martin', email: 'camille.martin@etudiant.tafac.fr' },
  ])

  assert.deepEqual(searchDemoMailContacts('lann').map((contact) => contact.email), [
    'scolarite-iut-lannion@univ-rennes.fr',
    'bu-lannion@univ-rennes.fr',
    'bde.infocom.lannion@gmail.com',
    'secretariat-infocom-lannion@univ-rennes.fr',
    'infocom3-lannion@listes.univ-rennes.fr',
  ])
  assert.deepEqual(box.autocomplete('lea mo').body.suggestions, [{ name: 'Léa Moreau', email: 'lea.moreau@etudiant.univ-rennes.fr', kind: 'contact' }])
  // Too short, or not text: nothing is searched.
  assert.deepEqual(box.autocomplete('l').body.suggestions, [])
  assert.deepEqual(box.autocomplete(null), { status: 200, body: { suggestions: [] } })
})

test('a send: the refusals, then the copy in « Envoyés »', async () => {
  const box = mailbox()
  assert.deepEqual(await box.send(sendBody({ to: [{ email: 'pas une adresse' }] })), { status: 422, body: { error: 'mail_send_invalid_recipients', invalid: ['pas une adresse'] } })
  assert.deepEqual(await box.send(sendBody({ to: [] })), { status: 422, body: { error: 'mail_send_no_recipient' } })
  assert.deepEqual(await box.send(sendBody({ html: 42 })), { status: 400, body: { error: 'mail_send_invalid' } })
  assert.deepEqual(await box.send(sendBody({ html: 'x'.repeat(1_500_001) })), { status: 413, body: { error: 'mail_send_too_large' } })
  assert.deepEqual(await box.send(sendBody({ html: `<p>${'x'.repeat(300_000)}</p>` })), { status: 413, body: { error: 'mail_send_too_large', maxBytes: 256 * 1024 } })
  assert.deepEqual(await box.send(sendBody({ identityId: 'someone-else' })), { status: 400, body: { error: 'mail_send_invalid_identity' } })
  const gone = 'demo-upload-00000000-0000-0000-0000-000000000000'
  assert.deepEqual(await box.send(sendBody({ attachments: [{ source: 'upload', aid: gone }] })), { status: 409, body: { error: 'mail_send_upload_expired', aids: [gone] } })
  assert.deepEqual(await box.send(sendBody({ attachments: [{ source: 'message', messageId: 'demo-mail-2', part: '2' }] })), { status: 409, body: { error: 'mail_send_missing_reference' } })
  // A real account's ids aren't the demo's.
  assert.equal((await box.send(sendBody({ origin: { kind: 'reply', messageId: '257' } }))).status, 400)
  assert.deepEqual(box.recent({ folder: '5' }).body.mail.messages, [])

  const file = box.upload({ name: 'dossier/Été "final".pdf', contentType: 'application/pdf; charset=binary', size: 2048 })
  assert.deepEqual(file, { status: 200, body: { attachment: { aid: file.body.attachment.aid, name: 'Été _final_.pdf', size: 2048, contentType: 'application/pdf' } } })
  assert.match(file.body.attachment.aid, /^demo-upload-[0-9a-f-]{36}$/)

  const sent = await box.send(sendBody({
    cc: [{ email: 'lea@univ.fr' }],
    bcc: [{ email: 'cache@univ.fr' }],
    attachments: [{ source: 'message', messageId: 'demo-mail-1', part: '3' }, { source: 'upload', aid: file.body.attachment.aid }],
    origin: { kind: 'forward', messageId: 'demo-mail-1' },
  }))
  assert.deepEqual(sent, { status: 200, body: { ok: true } })

  const [row] = box.recent({ folder: '5' }).body.mail.messages
  assert.deepEqual(row, {
    id: 'demo-sent-1',
    from: { name: 'Camille Martin', email: 'demo@tafac.fr' },
    to: { name: 'Léo', email: 'leo@univ.fr' },
    subject: 'Objet',
    snippet: 'Bonjour -- Camille Martin Info-Com 3 · TP 3 IUT de Lannion – Université de Rennes',
    receivedAt: new Date(NOW).toISOString(),
    unread: false,
    flagged: false,
    messageIds: ['demo-sent-1'],
    count: 1,
    href: null,
  })
  const { message } = box.message('demo-sent-1').body
  assert.equal(message.format, 'html')
  assert.deepEqual([message.to, message.cc], [[{ name: 'Léo', email: 'leo@univ.fr' }], [{ name: 'lea@univ.fr', email: 'lea@univ.fr' }]])
  assert.match(message.html, /^<div class="tafac-mail-body"><div style="[^"]+"><p style="margin:0">Bonjour<\/p><div style="margin:14px 0 6px;[^"]+"><div>—<\/div><div style="font-weight:600;color:#1d1d1f">Camille Martin<\/div><div>Info-Com 3 · TP 3<\/div><div>IUT de Lannion – Université de Rennes<\/div><\/div><\/div><\/div>$/)
  assert.deepEqual(message.attachments, [
    { part: '2', name: 'exemple-communique.png', type: 'image/png', size: 612_480, href: null },
    { part: '3', name: 'Été _final_.pdf', type: 'application/pdf', size: 2048, href: null },
  ])
  assert.deepEqual(box.thread('demo-sent-1', '5').body.messages.map((entry) => [entry.id, entry.folder]), [['demo-sent-1', '5']])
  // The mail forwarded says so in the inbox.
  assert.equal(box.recent().body.mail.messages[0].forwarded, true)
  // The file picked went with the mail: named again, it is to attach again.
  assert.equal((await box.send(sendBody({ attachments: [{ source: 'upload', aid: file.body.attachment.aid }] }))).status, 409)
})

test('a send asked for twice goes once', async () => {
  const box = mailbox()
  const body = sendBody()
  assert.deepEqual(await box.send(body), { status: 200, body: { ok: true } })
  assert.deepEqual(await box.send(body), { status: 200, body: { ok: true } })
  assert.equal(box.recent({ folder: '5' }).body.mail.messages.length, 1)
})

test('the signature a mail takes: none, the automatic one, the student\'s own', async () => {
  const logos = [{ src: 'data:image/png;base64,AAAA', width: 104, height: 40, alt: 'Université de Rennes' }]
  const asked = []
  const box = mailbox({
    config: { ...CONFIG, mail: { signature: { showLogin: true } } },
    readLogos: async (establishment) => {
      asked.push(establishment)
      return logos
    },
  })
  const htmlOf = async (signature, more = {}) => {
    await box.send(sendBody({ signature, ...more }))
    return box.message(box.recent({ folder: '5' }).body.mail.messages[0].id).body.message.html
  }

  assert.doesNotMatch(await htmlOf({ include: false }), /Camille/)
  const auto = await htmlOf({ include: true, establishment: 'iutlan' })
  assert.match(auto, /<div>Identifiant : demo<\/div>/)
  assert.match(auto, /<img width="104" height="40" alt="Université de Rennes" style="[^"]+" src="data:image\/png;base64,AAAA" \/>/)
  // An establishment the university doesn't have: its line and its logo are left out.
  assert.doesNotMatch(await htmlOf({ include: true, establishment: 'elsewhere' }), /–/)
  assert.deepEqual(asked, ['iutlan', null])

  // « Partage »: the webmail's, its links opening in a tab.
  const partage = await htmlOf({ include: true, mode: 'partage' })
  assert.match(partage, /<div style="margin:14px 0 6px;font-size:14px;line-height:1.45;color:#1d1d1f"><div><strong>Camille Martin<\/strong><\/div>/)
  assert.match(partage, /<a style="color:#1a73e8" href="https:\/\/tafac.fr" target="_blank" rel="noopener noreferrer">tafac.fr<\/a>/)
  // « Personnalisée »: none until one is written.
  assert.doesNotMatch(await htmlOf({ include: true, mode: 'custom' }), /Camille/)
  box.saveSignature({ text: 'Camille\nBUT <Info-Com>' })
  assert.match(await htmlOf({ include: true, mode: 'custom' }), /<div>Camille<\/div><div>BUT &lt;Info-Com&gt;<\/div>/)

  // A logo that can't be read is left out, the mail goes all the same.
  const failing = mailbox({ readLogos: async () => { throw new Error('no logo') } })
  assert.equal((await failing.send(sendBody())).status, 200)
})

test('the student\'s signatures, the custom one written and removed', () => {
  const box = mailbox()
  const listed = box.signatures().body
  assert.deepEqual(listed.signatures.map((signature) => [signature.id, signature.name, signature.hasImages]), [['demo-signature-partage', 'Signature', true]])
  assert.equal(listed.signatures[0].text, 'Camille Martin\nÉtudiante · compte de démonstration\ntafac.fr (https://tafac.fr)')
  // The second identity names none: « Partage » takes the first there is.
  assert.deepEqual(listed.identities, [
    { id: 'demo-default', signatureId: 'demo-signature-partage', replySignatureId: 'demo-signature-partage' },
    { id: 'demo-etudiant', signatureId: 'demo-signature-partage', replySignatureId: 'demo-signature-partage' },
  ])
  assert.deepEqual([listed.customId, listed.maxLength], [null, 2000])

  const written = box.saveSignature({ text: '  Camille \r\n\r\n\r\nBUT Info-Com\t3  \n' })
  assert.equal(written.status, 200)
  assert.equal(written.body.customId, 'demo-signature-tafac')
  assert.deepEqual(written.body.signatures[1], { id: 'demo-signature-tafac', name: 'Tafac', html: '<div>  Camille</div><div><br /></div><div>BUT Info-Com 3</div>', text: '  Camille\n\nBUT Info-Com 3', hasImages: false })
  assert.deepEqual(box.signatures().body, written.body)

  assert.deepEqual(box.saveSignature({ text: 'x'.repeat(2001) }), { status: 413, body: { error: 'mail_signature_too_long' } })
  assert.deepEqual(box.saveSignature({ text: 42 }), { status: 400, body: { error: 'mail_signature_invalid' } })
  assert.deepEqual(box.saveSignature({}), { status: 400, body: { error: 'mail_signature_invalid' } })
  assert.equal(box.saveSignature({ text: '' }).body.customId, null)
})

test('a draft: saved, saved over, read back, sent or discarded', async () => {
  const box = mailbox()
  const saved = box.saveDraft({ ...MAIL, to: [{ email: 'à moitié' }], attachments: [{ source: 'message', messageId: 'demo-mail-1', part: '2' }] })
  assert.deepEqual(saved, { status: 200, body: { draft: { id: 'demo-draft-1', attachments: [{ messageId: 'demo-draft-1', part: '2' }], inlineImages: [] } } })
  const again = box.saveDraft({ ...MAIL, subject: 'Autre objet', draftId: 'demo-draft-1', attachments: [{ source: 'message', messageId: 'demo-draft-1', part: '2' }] })
  assert.equal(again.body.draft.id, 'demo-draft-1')

  const read = box.draft('demo-draft-1').body.draft
  assert.equal(read.html, '<p>Bonjour</p><div data-mail-signature></div>')
  assert.deepEqual([read.subject, read.to, read.identityId, read.origin, read.droppedImages], ['Autre objet', [{ name: 'Léo', email: 'leo@univ.fr' }], 'demo-default', null, 0])
  assert.deepEqual(read.attachments, [{ part: '2', name: 'Consignes – dossier de presse.pdf', size: 248_312, contentType: 'application/pdf' }])
  assert.deepEqual(box.recent({ folder: '6' }).body.mail.messages.map((row) => [row.id, row.subject, row.snippet]), [['demo-draft-1', 'Autre objet', 'Bonjour']])
  assert.deepEqual(box.thread('demo-draft-1', '6').body.messages.map((row) => row.id), ['demo-draft-1'])
  assert.deepEqual(box.draft('demo-draft-9'), { status: 404, body: { error: 'No such draft.' } })
  assert.deepEqual(box.draft('257'), { status: 400, body: { error: 'Invalid message id.' } })

  // Sent: the draft is gone, the mail answered says so.
  const sent = await box.send(sendBody({ draftId: 'demo-draft-1', attachments: [{ source: 'message', messageId: 'demo-draft-1', part: '2' }], origin: { kind: 'reply', messageId: 'demo-mail-1' } }))
  assert.equal(sent.status, 200)
  assert.equal(box.draft('demo-draft-1').status, 404)
  assert.equal(box.recent().body.mail.messages[0].replied, true)
  assert.deepEqual(box.message('demo-sent-2').body.message.attachments.map((file) => file.name), ['Consignes – dossier de presse.pdf'])

  // Uploads come first among a draft's files, whatever the composer's order.
  const file = box.upload({ name: 'notes.txt', contentType: 'text/plain', size: 12 }).body.attachment
  const mixed = box.saveDraft({ ...MAIL, attachments: [{ source: 'message', messageId: 'demo-mail-1', part: '3' }, { source: 'upload', aid: file.aid }] })
  assert.deepEqual(mixed.body.draft.attachments, [{ messageId: 'demo-draft-3', part: '3' }, { messageId: 'demo-draft-3', part: '2' }])
  assert.deepEqual(box.draft('demo-draft-3').body.draft.attachments.map((entry) => [entry.part, entry.name]), [['2', 'notes.txt'], ['3', 'exemple-communique.png']])

  // Discarded, trashed or deleted: gone.
  for (const action of ['discard', 'trash', 'delete']) {
    const { id } = box.saveDraft(MAIL).body.draft
    box.action({ ids: [id], action })
    assert.equal(box.draft(id).status, 404, action)
  }
  box.action({ ids: ['demo-draft-3'], action: 'read' })
  assert.equal(box.draft('demo-draft-3').status, 200)

  // Twenty drafts at most.
  box.action({ ids: ['demo-draft-3'], action: 'discard' })
  for (let index = 0; index < 20; index += 1) assert.equal(box.saveDraft(MAIL).status, 200)
  assert.deepEqual(box.saveDraft(MAIL), { status: 413, body: { error: 'mail_send_quota' } })
})

test('a picked file is measured, an image of the text kept', async () => {
  const box = mailbox()
  assert.deepEqual(box.upload({ name: 'vide.txt', contentType: 'text/plain', size: 0 }), { status: 400, body: { error: 'mail_upload_empty' } })
  assert.equal(box.upload({ name: 'gros.zip', contentType: 'application/zip', size: 40 * 1024 * 1024 }).status, 413)
  assert.equal(box.upload({ name: 'gros.zip', contentType: 'application/zip', size: 40 * 1024 * 1024 }).body.error, 'mail_upload_too_large')
  assert.equal(box.upload({ name: 'x', contentType: 'text/plain', size: Number.NaN }).status, 411)

  // Only a small image is read.
  assert.equal(box.keepsUpload('image/png', PNG.length), true)
  assert.equal(box.keepsUpload('IMAGE/PNG; q=1', PNG.length), true)
  assert.equal(box.keepsUpload('application/pdf', PNG.length), false)
  assert.equal(box.keepsUpload('image/svg+xml', PNG.length), false)
  assert.equal(box.keepsUpload('image/png', 1024 * 1024 + 1), false)

  const image = box.upload({ name: 'note.png', contentType: 'image/png', size: PNG.length, bytes: PNG }).body.attachment
  const text = box.upload({ name: 'notes.txt', contentType: 'text/plain', size: 12 }).body.attachment
  const html = `<p>Voici :</p><p><img data-inline-cid="${CID}" alt="Ma note" width="1120" height="600"></p>`
  const inline = (aid) => [{ cid: CID, source: 'upload', aid, width: 1120, height: 600 }]

  // A file that isn't an image kept isn't one of the text's.
  assert.deepEqual(await box.send(sendBody({ html, inlineImages: inline(text.aid) })), { status: 409, body: { error: 'mail_send_missing_reference' } })

  // In a draft: a part of it, shown from its bytes.
  const draft = box.saveDraft({ ...MAIL, html, inlineImages: inline(image.aid) }).body.draft
  assert.deepEqual(draft.inlineImages, [{ cid: CID, messageId: draft.id, part: '2' }])
  const [shown] = box.draft(draft.id).body.draft.inlineImages
  assert.deepEqual(shown, { cid: CID, part: '2', name: 'note.png', size: PNG.length, contentType: 'image/png', width: 560, height: 300, href: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` })

  // Sent from the draft: inline in the copy, no file attached.
  const sent = await box.send(sendBody({ html, draftId: draft.id, inlineImages: [{ cid: CID, source: 'message', messageId: draft.id, part: '2', width: 560, height: 300 }] }))
  assert.equal(sent.status, 200)
  const { message } = box.message(box.recent({ folder: '5' }).body.mail.messages[0].id).body
  assert.match(message.html, new RegExp(`<img width="560" height="300" alt="Ma note" style="[^"]+" src="data:image/png;base64,${Buffer.from(PNG).toString('base64')}" />`))
  assert.deepEqual(message.attachments, [])
  assert.equal(box.recent({ folder: '5' }).body.mail.messages[0].snippet.startsWith('Voici : [Image : Ma note]'), true)
})

test('the mailbox is the tab\'s: a reload finds it, a sign-out clears it', async () => {
  const storage = createStorage()
  const first = mailbox({ storage })
  await first.send(sendBody({ origin: { kind: 'reply', messageId: 'demo-mail-2' } }))
  first.saveDraft({ ...MAIL, subject: 'Un brouillon' })
  first.saveSignature({ text: 'Camille' })
  const file = first.upload({ name: 'notes.txt', contentType: 'text/plain', size: 12 }).body.attachment
  assert.ok(storage.getItem(DEMO_MAIL_STORAGE_KEY))

  // The page reloaded: the same storage, a new mailbox.
  const reloaded = mailbox({ storage })
  assert.deepEqual(reloaded.recent({ folder: '5' }).body.mail.messages.map((row) => row.id), ['demo-sent-1'])
  assert.deepEqual(reloaded.recent({ folder: '6' }).body.mail.messages.map((row) => row.subject), ['Un brouillon'])
  assert.equal(reloaded.message('demo-sent-1').status, 200)
  assert.equal(reloaded.recent().body.mail.messages[1].replied, true)
  assert.equal(reloaded.signatures().body.customId, 'demo-signature-tafac')
  // Ids go on from where they were.
  assert.equal(reloaded.saveDraft(MAIL).body.draft.id, 'demo-draft-3')
  // A file picked before the reload is to attach again.
  assert.deepEqual(await reloaded.send(sendBody({ attachments: [{ source: 'upload', aid: file.aid }] })), { status: 409, body: { error: 'mail_send_upload_expired', aids: [file.aid] } })

  reloaded.clear()
  assert.equal(storage.getItem(DEMO_MAIL_STORAGE_KEY), null)
  assert.deepEqual(reloaded.recent({ folder: '5' }).body.mail.messages, [])
  assert.deepEqual(mailbox({ storage }).recent({ folder: '6' }).body.mail.messages, [])

  // What the storage holds is read with care; a storage that fails is done without.
  for (const stored of ['not json', '[]', '{"sent":"x","drafts":[["x",{}]],"next":"2"}']) {
    const odd = createStorage()
    odd.setItem(DEMO_MAIL_STORAGE_KEY, stored)
    assert.deepEqual(mailbox({ storage: odd }).recent({ folder: '5' }).body.mail.messages, [], stored)
  }
  const failing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('blocked') } }
  const unkept = mailbox({ storage: failing })
  assert.equal((await unkept.send(sendBody())).status, 200)
  assert.equal(unkept.recent({ folder: '5' }).body.mail.messages.length, 1)
  unkept.clear()
})
