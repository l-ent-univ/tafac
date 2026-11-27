import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { setImmediate } from 'node:timers'
import test from 'node:test'
import { buildComposePayload, composeOrigin, draftStateKey, pickDefaultIdentity, sendFailureText } from '../src/mailSendPayload.js'
import { setRegister } from '../src/register.js'
import { createDraftSaver } from '../src/mailDraftSaver.js'
import { buildDraftFields } from '../src/mailCompose.js'

const AID = '4f6e1c2a-0b7d-4c8e-9a51-2f3e4d5c6b7a:9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f'

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
    inlineImages: [],
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
  // The failure's text follows the register (src/register.js): « vous » by
  // default, « tu » once set.
  assert.equal(sendFailureText({ code: 'rate', retryAfter: 42 }), 'Trop d’envois, réessayez dans 42 s')
  assert.equal(sendFailureText({ code: 'expired' }), 'Session expirée, reconnectez-vous')
  setRegister('tu')
  assert.equal(sendFailureText({ code: 'rate', retryAfter: 42 }), 'Trop d’envois, réessaie dans 42 s')
  assert.equal(sendFailureText({ code: 'expired' }), 'Session expirée, reconnecte-toi')
  setRegister('vous')
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

// ── The text's images (an image of a grade, src/gradeMail.js) ──

const IMAGE_CID = 'tafac-img-0123abcd-4567-89ab@tafac.fr'
const OTHER_CID = 'tafac-img-fedcba98-7654-3210@tafac.fr'