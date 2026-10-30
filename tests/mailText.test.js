import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTROL_CHARACTERS, capLength, cleanTextLines, decodeEntities, escapeHtml } from '../src/mailText.js'
import { parseDrupalProfileName } from '../server/portalSession.js'

test('the shared text helpers', () => {
  assert.equal('a\u202eb\u0000c\u2028d'.replace(CONTROL_CHARACTERS, ''), 'abcd')
  assert.equal(capLength('a😀b', 2), 'a😀')
  assert.equal(capLength('abc', 5), 'abc')
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  assert.equal(escapeHtml(null), '')
  // One pass: an escaped entity stays one; numeric ones out of range are
  // dropped, never thrown (the portal's copy threw on &#x110000;).
  assert.equal(decodeEntities('&amp;lt; &#233;&#xE9; &apos;&quot;&nbsp;&copy; &#0;&#x110000;'), "&lt; éé '\" &copy; ")
  assert.equal(cleanTextLines('\n\n  Léo\t \r\nDupont\u200b  \n\n\n\nIUT\n\n'), '  Léo\nDupont\n\nIUT')
  assert.equal(cleanTextLines('e\u0301'), 'é')
})

test('the portal\'s profile name, with the shared entity decoding', () => {
  const html = '<div class="field field--name-field-nomprenom">Ana&#xEF;s&nbsp;Le&#x110000; Gall</div>'
  assert.deepEqual(parseDrupalProfileName(html), { name: 'Anaïs Le Gall', given_name: 'Anaïs', family_name: 'Le Gall' })
})
