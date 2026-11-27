import assert from 'node:assert/strict'
import test from 'node:test'
import { CUSTOM_SIGNATURE_MAX_LENGTH, normalizeCustomSignatureText, pickShownSignature, plainSignatureHtml, readMailSignatures } from '../src/mailSignatureChoice.js'

// ── The webmail's answers ──

// ── The custom signature, written ──

test('the custom signature\'s text: tidied, capped, refused past the limit', () => {
  assert.deepEqual(normalizeCustomSignatureText('\n\n  Camille  \r\nMMI\t2\u0007\n\n\n\nfin  \n'), { ok: true, text: '  Camille\nMMI 2\n\nfin' })
  assert.deepEqual(normalizeCustomSignatureText(''), { ok: true, text: '' })
  assert.deepEqual(normalizeCustomSignatureText(42), { ok: false, error: 'mail_signature_invalid' })
  assert.deepEqual(normalizeCustomSignatureText(null), { ok: false, error: 'mail_signature_invalid' })
  assert.equal(normalizeCustomSignatureText('x'.repeat(CUSTOM_SIGNATURE_MAX_LENGTH)).ok, true)
  assert.deepEqual(normalizeCustomSignatureText('x'.repeat(CUSTOM_SIGNATURE_MAX_LENGTH + 1)), { ok: false, error: 'mail_signature_too_long' })
  assert.deepEqual(normalizeCustomSignatureText(Array.from({ length: 31 }, () => 'l').join('\n')), { ok: false, error: 'mail_signature_too_long' })
})

// ── In the mail sent ──

test('the page\'s copy of the signatures: checked, and the one a draft shows', () => {
  const data = readMailSignatures({
    signatures: [
      { id: 'sig-1', name: 'Pro', html: '<div>Pro</div>', text: 'Pro', hasImages: true },
      { id: 'sig-2', name: 'Réponse', html: '<div>Re</div>', text: 'Re' },
      { id: 'sig-t', name: 'Tafac', html: '<div>Moi</div>', text: 'Moi' },
      { id: '<x>', name: 'bad' },
    ],
    identities: [{ id: 'acc', signatureId: 'sig-1', replySignatureId: 'sig-2' }, { id: 'perso', signatureId: 'unknown', replySignatureId: null }],
    customId: 'sig-t',
    maxLength: 999_999,
  })
  assert.equal(data.signatures.length, 3)
  assert.equal(data.maxLength, CUSTOM_SIGNATURE_MAX_LENGTH)
  assert.deepEqual(data.identities[1], { id: 'perso', signatureId: null, replySignatureId: null })
  assert.equal(pickShownSignature(data, 'partage').id, 'sig-1')
  assert.equal(pickShownSignature(data, 'partage', { identityId: 'acc', reply: true }).id, 'sig-2')
  assert.equal(pickShownSignature(data, 'partage', { identityId: 'perso' }), null)
  assert.equal(pickShownSignature(data, 'custom').id, 'sig-t')
  assert.equal(pickShownSignature(data, 'auto'), null)
  assert.equal(pickShownSignature(null, 'custom'), null)
  assert.deepEqual(readMailSignatures(null), { signatures: [], identities: [], customId: null, maxLength: CUSTOM_SIGNATURE_MAX_LENGTH })
  assert.equal(plainSignatureHtml('<i>a</i>\n'), '<div>&lt;i&gt;a&lt;/i&gt;</div><div><br></div>')
})

// ── The routes, on the demo account (nothing leaves) ──
