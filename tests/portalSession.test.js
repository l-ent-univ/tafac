import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDrupalLayout, isDrupalSignedInPage, parseDrupalProfileName, parseDrupalToolCatalogue, resolvePortalKind } from '../server/portalSession.js'

test('the profile name field gives the full, given and family names', () => {
  const html = `<section id="block-nometprenom" class="page-header block">
    <div class="field field--name-field-nomprenom field--type-string field--label-hidden field--item">Camille  Le Goff</div>
  </section>`
  assert.deepEqual(parseDrupalProfileName(html), { name: 'Camille Le Goff', given_name: 'Camille', family_name: 'Le Goff' })
})

test('entities are decoded and a lone word is a given name', () => {
  const html = '<div class="field field--name-field-nomprenom field--item">Ana&#039;s</div>'
  assert.deepEqual(parseDrupalProfileName(html), { name: "Ana's", given_name: "Ana's", family_name: null })
})

test('no name field, or an empty one, is no name', () => {
  assert.equal(parseDrupalProfileName('<body class="user-logged-in"></body>'), null)
  assert.equal(parseDrupalProfileName('<div class="field--name-field-nomprenom"> </div>'), null)
  assert.equal(parseDrupalProfileName(null), null)
})

test('a Drupal page with the user-logged-in body class is signed in', () => {
  const html = '<html><body class="user-logged-in path-frontpage has-glyphicons site-etudiant"><main></main></body></html>'
  assert.equal(isDrupalSignedInPage(200, html), true)
})

test('an anonymous Drupal page or a redirect is not signed in', () => {
  assert.equal(isDrupalSignedInPage(200, '<body class="path-frontpage user-anonymous">'), false)
  assert.equal(isDrupalSignedInPage(200, '<body class="not-user-logged-in-yet">'), false)
  assert.equal(isDrupalSignedInPage(302, '<body class="user-logged-in">'), false)
  assert.equal(isDrupalSignedInPage(200, ''), false)
  assert.equal(isDrupalSignedInPage(200, null), false)
})

test('the class only counts on the body tag', () => {
  assert.equal(isDrupalSignedInPage(200, '<body class="login"><div class="user-logged-in"></div></body>'), false)
})

test('auth.portal defaults to uPortal and rejects unknown kinds', () => {
  assert.equal(resolvePortalKind(undefined), 'uportal')
  assert.equal(resolvePortalKind({ portalEntryPath: '/' }), 'uportal')
  assert.equal(resolvePortalKind({ portal: 'drupal' }), 'drupal')
  assert.throws(() => resolvePortalKind({ portal: 'liferay' }), /Unknown auth\.portal/)
})

const CATALOGUE_PAGE = `<body class="user-logged-in"><main>
<div class="view view-categories-outils"><h3>Pas une rubrique</h3></div>
<div class="view view-outils view-id-outils view-display-id-page_par_categorie">
  <div class="view-content">
  <div class="col-xs-12 section">
    <h3>Bureau</h3>
    <ul role="list">
      <li role="listitem"><div about="/outil/tempo" class="outil group-toolbox clearfix">
        <a href="https://tempo.example.fr" title="Emplois du temps">
          <span class="r2ico r2-ent-edt"></span>
<span>TEMPO</span>
</a>
        <a href="/article/decouvrir-tempo" title="Guide"><span class="r2ico r2-ent-doc2"></span></a>
      </a></div></li>
      <li role="listitem"><div about="/outil/imprimer" class="outil group-toolbox clearfix">
        <a href="/numerique/impression#accordion-1" title="Imprimer"><span>Imprimer</span></a>
      </a></div></li>
    </ul>
  </div>
  <div class="col-xs-12 section">
    <h3>Ressources</h3>
    <ul role="list">
      <li role="listitem"><div about="/outil/disques" class="outil group-toolbox clearfix">
        <a href="https://files.example.fr/login.php?url=x&amp;app=gollem" title="Recharger mon cr&#039;dit"><span>Mes disques &quot;M&quot;</span></a>
      </a></div></li>
      <li role="listitem"><div about="/outil/vide" class="outil group-toolbox clearfix">
        <a href="javascript:void(0)" title=""><span>Pas un lien</span></a>
      </a></div></li>
    </ul>
  </div>
  <div class="col-xs-12 section"><h3>Vide</h3><ul></ul></div>
  </div>
</div>
</main><footer><h3>Pied de page</h3></footer></body>`

test('the tool catalogue gives categories and tools, documentation links left out', () => {
  assert.deepEqual(parseDrupalToolCatalogue(CATALOGUE_PAGE, 'https://portail.example.fr'), [
    {
      title: 'Bureau',
      tools: [
        { id: 'tempo', title: 'TEMPO', description: 'Emplois du temps', href: 'https://tempo.example.fr/' },
        { id: 'imprimer', title: 'Imprimer', description: '', href: 'https://portail.example.fr/numerique/impression#accordion-1' },
      ],
    },
    {
      title: 'Ressources',
      tools: [
        { id: 'disques', title: 'Mes disques "M"', description: "Recharger mon cr'dit", href: 'https://files.example.fr/login.php?url=x&app=gollem' },
      ],
    },
  ])
})

test('a page without the tool view has no catalogue', () => {
  assert.deepEqual(parseDrupalToolCatalogue('<body class="user-logged-in"><h3>Accueil</h3></body>', 'https://portail.example.fr'), [])
  assert.deepEqual(parseDrupalToolCatalogue(null, 'https://portail.example.fr'), [])
})

test('the catalogue becomes a uPortal-shaped layout of launcher portlets', () => {
  const layout = buildDrupalLayout(parseDrupalToolCatalogue(CATALOGUE_PAGE, 'https://portail.example.fr'), 'etu')
  assert.equal(layout.authenticated, 'true')
  assert.equal(layout.user, 'etu')
  const [tab] = layout.layout.navigation.tabs
  assert.deepEqual(tab.content.map((folder) => [folder._objectType, folder.name, folder.content.length]), [
    ['folder', 'Bureau', 2],
    ['folder', 'Ressources', 1],
  ])
  const tempo = tab.content[0].content[0]
  assert.equal(tempo._objectType, 'portlet')
  assert.equal(tempo.portletName, 'app-launcher')
  assert.equal(tempo.ID, 'portal-tool-tempo')
  assert.equal(tempo.parameters.launchUrl, 'https://tempo.example.fr/')
  assert.equal(tempo.target, '_blank')
  assert.equal(tempo.fname, undefined)
})
