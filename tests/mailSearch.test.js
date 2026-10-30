import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAIL_SEARCH_MAX_WORDS,
  buildZimbraSearchQuery,
  foldMailSearchText,
  getMailSearchVariants,
  parseMailSearchWords,
} from '../src/mailSearch.js'

test('words split on whitespace and punctuation, addresses and dashes kept whole', () => {
  assert.deepEqual(parseMailSearchWords('  Moodle   TD#2 (urgent) '), ['Moodle', 'TD', 'urgent'])
  assert.deepEqual(parseMailSearchWords('jean.dupont@univ-rennes.fr.'), ['jean.dupont@univ-rennes.fr'])
  assert.deepEqual(parseMailSearchWords('TD-12'), ['TD-12'])
  assert.deepEqual(parseMailSearchWords(''), [])
  assert.deepEqual(parseMailSearchWords(null), [])
})

test('apostrophes split elisions off instead of gluing the word', () => {
  assert.deepEqual(parseMailSearchWords("l'examen"), ["l'examen"])
  // A typographic apostrophe is read as a straight one.
  assert.deepEqual(parseMailSearchWords('l’examen d’anglais'), ["l'examen", "d'anglais"])
  assert.deepEqual(getMailSearchVariants("l'examen"), ["l'examen", 'examen'])
  assert.deepEqual(getMailSearchVariants("qu'il"), ["qu'il", 'il'])
  // No elision: its first part, a prefix of the whole word, is enough.
  assert.deepEqual(getMailSearchVariants("aujourd'hui"), ['aujourd'])
})

test('a word needs two letters or digits, its elision aside', () => {
  for (const query of ['a', 'é', "l'", "l'a", '-', '...', '@@', '*', 'é́']) {
    assert.deepEqual(parseMailSearchWords(query), [], query)
  }
  assert.deepEqual(parseMailSearchWords('a examen 2'), ['examen'])
  assert.deepEqual(parseMailSearchWords('ab'), ['ab'])
})

test('word count and length are capped', () => {
  const words = parseMailSearchWords(Array.from({ length: 20 }, (_, index) => `mot${index}`).join(' '))
  assert.equal(words.length, MAIL_SEARCH_MAX_WORDS)
  assert.equal(parseMailSearchWords('x'.repeat(200))[0].length, 64)
})

test('the query needs every word, each as a prefix in any field and form', () => {
  assert.equal(
    buildZimbraSearchQuery(parseMailSearchWords('Moodle'), '2'),
    'inid:2 (from:moodle* OR to:moodle* OR subject:moodle* OR content:moodle*)',
  )
  assert.equal(
    buildZimbraSearchQuery(parseMailSearchWords('Étude stage'), '5'),
    'inid:5 (from:étude* OR from:etude* OR to:étude* OR to:etude* OR subject:étude* OR subject:etude* OR content:étude* OR content:etude*)'
      + ' (from:stage* OR to:stage* OR subject:stage* OR content:stage*)',
  )
  assert.match(buildZimbraSearchQuery(parseMailSearchWords('l’examen')), /^inid:2 \(from:l'examen\* OR from:examen\* OR /)
})

test('nothing typed becomes a Zimbra operator, field or phrase', () => {
  const hostile = [
    'from:boss@x.fr', 'in:trash', '-moodle', '+moodle', '"exact phrase"', 'a OR b', '(x) {y}', 'is:unread', '\\"x',
    'content:*', 'tag:\\x', '*', 'x* y*', 'not:me', 'a\tb\nc', '‐moodle',
  ]
  for (const query of hostile) {
    const built = buildZimbraSearchQuery(parseMailSearchWords(query), '2')
    const groups = built.replace(/^inid:2/, '').trim()
    if (!groups) continue
    for (const group of groups.match(/\([^()]*\)/g)) {
      for (const term of group.slice(1, -1).split(' OR ')) {
        assert.match(term, /^(from|to|subject|content):[\p{L}\p{M}\p{N}@._'][\p{L}\p{M}\p{N}@._'-]*\*$/u, `${query} → ${term}`)
      }
    }
    // Only our own groups, fields and ORs are left once the terms are taken out.
    assert.equal(groups.replace(/\((?:(?:from|to|subject|content):[^\s()]+\*(?: OR )?)+\)/g, '').trim(), '', query)
  }
})

test('the folder must be an id', () => {
  assert.throws(() => buildZimbraSearchQuery(['moodle'], '2 OR in:trash'), TypeError)
  assert.throws(() => buildZimbraSearchQuery(['moodle'], ''), TypeError)
  assert.equal(buildZimbraSearchQuery([], '257'), 'inid:257')
})

test('folding ignores case, accents and apostrophe styles', () => {
  assert.equal(foldMailSearchText('Étude d’ÉTÉ'), "etude d'ete")
  assert.equal(foldMailSearchText('l‘ex'), foldMailSearchText("l'ex"))
  assert.equal(foldMailSearchText(undefined), '')
})
