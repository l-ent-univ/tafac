import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SIGNATURE_PLACEHOLDER,
  buildAutoSignature,
  buildSentHtml,
  cleanComposerHtml,
  composerHtmlToText,
  frameOwnSignature,
  plainSignatureToHtml,
  selectComposerImages,
} from '../src/demoMailHtml.js'
import {
  buildMailHtml,
  buildMailSignature,
  composerHtmlToText as serverHtmlToText,
  sanitizeComposerHtml,
  selectInlineImages,
} from '../server/mailSend.js'
import { sanitizeMailHtml } from '../server/mailMessage.js'
import { frameSignature, plainSignatureToHtml as serverPlainSignatureToHtml, readSignatureContent } from '../server/mailSignature.js'

// The demo's mails are made by the page (src/demoMailHtml.js) as the server
// makes a real account's: each function here is held to the server's own,
// on what the editor writes and on what it must never keep.
const CID = 'tafac-img-0123abcd-0000-4000-8000-000000000000@tafac.fr'
const OTHER_CID = 'tafac-img-89abcdef-0000-4000-8000-000000000000@tafac.fr'
const PNG = 'data:image/png;base64,iVBORw0KGgo='

const EDITOR_HTML = [
  '',
  '<p></p>',
  '<p>Bonjour &amp; bienvenue &lt;à tous&gt; "entre guillemets" l\'apostrophe &nbsp; fin</p><p></p><p style="margin-left: 32px;">en retrait</p>',
  '<p><strong>gras</strong> <em>italique</em> <u>souligné</u> <s>barré</s> <b>b</b> <i>i</i></p>',
  '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://tafac.fr/?a=1&amp;b=2">un lien</a>, <a href="mailto:camille@tafac.fr">camille@tafac.fr</a>, <a href="https://tafac.fr">https://tafac.fr</a></p>',
  '<h2>Titre</h2><h3 style="margin-left: 64px">Sous-titre</h3><ul><li><p>un</p></li><li><p>deux</p><ul><li><p>dedans</p></li></ul></li></ul><ol start="3"><li><p>trois</p></li><li><p>quatre</p></li></ol><ol start="1"><li><p>un</p></li></ol>',
  '<blockquote><p>Le 3 octobre, Thomas Lemoine a écrit :</p><blockquote><p>plus ancien</p></blockquote></blockquote><p>réponse</p>',
  '<p><span style="color: rgb(224, 49, 49); font-size: 18px; font-family: &quot;Collab Sans&quot;, system-ui, sans-serif;">rouge</span> <span style="font-family: Georgia, serif">serif</span> <mark style="background-color: #fff3bf; color: inherit;">surligné</mark> <mark>sans couleur</mark> <span style="color:#e03131;background-color:rgba(0, 0, 0, 0.5)">deux</span></p>',
  `<p>avant</p>${SIGNATURE_PLACEHOLDER}<p>après</p>`,
  '<p>avant</p><div data-mail-signature=""></div><div data-mail-signature></div><div>un div <b>simple</b></div>',
  '<table data-mail-summary=""><tbody><tr><th>Cours</th><td>R5.07 Stratégie</td></tr><tr><th>Salle</th><td>B03</td></tr></tbody></table><p>après<br>la ligne<br />suivante</p>',
  `<p><img data-inline-cid="${CID}" alt="Une note : 15/20" width="560" height="300"></p><p>sous l’image</p>`,
  `<p><img data-inline-cid="${CID}" width="80" height="40"><img data-inline-cid="${OTHER_CID}" alt="l'autre" width="10" height="10"><img data-inline-cid="${CID}" alt="deux fois"></p>`,
  // What the editor never writes, and a mail must not keep.
  '<p onclick="x()" class="k" id="i">attributs</p><script>alert(1)</script><style>p{color:red}</style><p>fin</p>',
  '<p><a href="javascript:alert(1)">js</a> <a href="/chemin">relatif</a> <a href="//tafac.fr">sans schéma</a> <a>sans lien</a></p>',
  '<p><span style="position:fixed;color:red;font-size:99px">styles</span> <span style="color:#abc;font-size:16px;">gardés</span></p>',
  '<p><img src="https://tafac.fr/logo.png" alt="distante"><img data-inline-cid="pas-un-cid" src="data:image/png;base64,AA=="></p>',
  '<h1>Titre 1</h1><code>code</code><hr><pre>pré</pre><iframe src="https://tafac.fr">dedans</iframe><svg><text>svg</text></svg><p>reste</p>',
  '<div data-mail-signature>du texte dedans</div><p>le reste</p>',
  '<p>une fin de balise seule</i></p><ul><li><p>une liste laissée ouverte</p>',
  '<!-- un commentaire --><p>a &lt; b &amp;&amp; c &gt; d</p><p>1 < 2</p>',
]

const REFERENCES = [
  { cid: CID, source: 'upload', aid: 'upload-1', width: 560, height: 300 },
  { cid: OTHER_CID, source: 'message', messageId: 'demo-draft-1', part: '3', width: 10, height: 10 },
]

test('the editor\'s HTML is cleaned as the server cleans it', () => {
  for (const html of EDITOR_HTML) {
    assert.equal(cleanComposerHtml(html), sanitizeComposerHtml(html), html)
  }
  assert.equal(cleanComposerHtml(null), '')
  assert.equal(cleanComposerHtml(42), '')
})

test('the images a mail takes are the server\'s', () => {
  for (const html of EDITOR_HTML) {
    const clean = sanitizeComposerHtml(html)
    for (const references of [REFERENCES, REFERENCES.slice(1), []]) {
      assert.deepEqual(selectComposerImages(clean, references), selectInlineImages(clean, references), html)
    }
  }
})

test('the text of a mail is the server\'s', () => {
  for (const html of EDITOR_HTML) {
    const clean = sanitizeComposerHtml(html)
    assert.equal(composerHtmlToText(clean), serverHtmlToText(clean), html)
    assert.equal(composerHtmlToText(clean, { signatureText: '-- \nCamille Martin\nTP 3' }), serverHtmlToText(clean, { signatureText: '-- \nCamille Martin\nTP 3' }), html)
  }
})

// The demo's copy of a sent mail is what the reader would be given of the
// mail the server builds.
const asRead = (html) => sanitizeMailHtml(html).html
const imageSources = (images) => new Map(images.map((image) => [image.cid, { src: PNG, width: image.width, height: image.height, alt: image.alt }]))

test('a sent mail reads as the server\'s would', () => {
  const signature = '<div style="margin:14px 0 6px;font-size:14px;line-height:1.45;color:#6b625b"><div>—</div><div style="font-weight:600;color:#1d1d1f">Camille Martin</div></div>'
  for (const html of EDITOR_HTML) {
    const { html: clean, images } = selectInlineImages(sanitizeComposerHtml(html), REFERENCES)
    for (const signatureHtml of ['', signature]) {
      assert.equal(
        buildSentHtml(clean, { signatureHtml, images: imageSources(images) }),
        asRead(buildMailHtml(clean, { signatureHtml, images: imageSources(images) })),
        html,
      )
    }
    // An image the mail doesn't hold isn't shown.
    assert.equal(buildSentHtml(clean), asRead(buildMailHtml(clean)), html)
  }
})

test('the automatic signature is the server\'s', () => {
  const logos = [
    { src: PNG, width: 104, height: 40, alt: 'Université de Rennes' },
    { src: PNG, width: 35, height: 40, alt: 'IUT "de" Lannion & l\'ENSSAT' },
  ]
  for (const signature of [
    { name: 'Camille Martin', login: 'demo', group: 'Info-Com 3 · TP 3', establishment: 'IUT de Lannion', university: 'Université de Rennes', logos },
    { name: 'Camille <Martin> & co', login: 'demo@tafac.fr', group: '', establishment: 'Université Rennes 2', university: 'Université Rennes 2', logos: logos.slice(0, 1) },
    { name: 'Camille Martin' },
    { logos },
    {},
  ]) {
    const built = buildAutoSignature(signature)
    const served = buildMailSignature(signature)
    assert.equal(built.text, served.text)
    assert.equal(buildSentHtml(SIGNATURE_PLACEHOLDER, { signatureHtml: built.html }), asRead(buildMailHtml(SIGNATURE_PLACEHOLDER, { signatureHtml: served.html })))
  }
})

test('a signature of the student\'s own is framed as the server frames it', () => {
  const partage = readSignatureContent({ html: '<div><strong>Camille Martin</strong></div><div style="color:#6b625b">Étudiante · compte de démonstration</div><p>un paragraphe</p><ul><li>une liste</li></ul><div><a href="https://tafac.fr">tafac.fr</a> <a>sans lien</a></div>' })
  const custom = readSignatureContent({ text: 'Camille\n\nBUT Info-Com <3 & "co"' })
  const dashed = readSignatureContent({ text: '-- \nCamille' })
  for (const signature of [partage, custom, dashed, { html: '', text: '' }, null]) {
    const framed = frameOwnSignature(signature)
    const served = frameSignature(signature)
    assert.equal(framed.text, served.text)
    assert.equal(buildSentHtml(SIGNATURE_PLACEHOLDER, { signatureHtml: framed.html }), asRead(buildMailHtml(SIGNATURE_PLACEHOLDER, { signatureHtml: served.html })))
  }
  for (const text of ['Camille\n\nBUT <Info-Com> & co', '', 'une ligne']) {
    assert.equal(plainSignatureToHtml(text), serverPlainSignatureToHtml(text))
  }
})
