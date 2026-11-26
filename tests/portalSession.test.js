import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPortalApps, isDrupalSignedInPage, isIsorbonneSignedInPage, isPortalSignedInPage, parseDrupalProfileName, parseDrupalToolCatalogue, parseIsorbonneCatalogue, parseIsorbonneName, resolvePortalKind } from '../server/portalSession.js'

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

test('the catalogue becomes the list of applications the page reads', () => {
  const apps = buildPortalApps(parseDrupalToolCatalogue(CATALOGUE_PAGE, 'https://portail.example.fr'))
  assert.deepEqual(apps.map((app) => [app.id.startsWith('portal-tool-'), app.category]), [
    [true, 'Bureau'],
    [true, 'Bureau'],
    [true, 'Ressources'],
  ])
  const [tempo] = apps
  assert.deepEqual(Object.keys(tempo), ['id', 'title', 'description', 'url', 'iconUrl', 'category', 'favorite'])
  // The id a favourite is kept by, as it always was.
  assert.equal(tempo.id, 'portal-tool-tempo')
  assert.equal(tempo.url, 'https://tempo.example.fr/')
  assert.equal(tempo.iconUrl, null)
  assert.equal(tempo.favorite, false)
})

// iSorbonne (Sorbonne Nouvelle), anonymised from a real page.
const ISORBONNE_PAGE = `<body><form id="navBarForm">
  <a title="Déconnexion" class="ui-commandlink nav-link" href="logout.xhtml">Le Gall Camille <i class="fa fa-power-off"></i></a>
</form>
<form id="portalForm" name="portalForm">
  <div class="col-12 text-center" id="buttonList">
    <input type="button" class="toglem btn btn-info m-1 ombrer" value="Accueil" id="t1">
    <input type="button" class="toglem btn btn-warning m-1" value="Etudiant" id="t2">
    <input type="button" class="toglem btn m-1" value="Vide" id="t3">
    <input type="button" class="btn btn-outline-dark m-1" value="Tous les services" id="temall">
  </div>
  <div class="tuile default col-sm-6 t1" style=""><a href="#" class="ui-commandlink favik"><i class="fa fa-star"></i></a>
    <a class="links" href="https://apps.sorbonne-nouvelle.fr/FileExplorer" target="_35"><div class="bloc">
      <label id="portalForm:p35" class="ui-outputlabel h4">Mes documents U&nbsp;:</label></div></a>
  </div>
  <div class="tuile default col-sm-6 t2" style="display: none;"><a href="#" class="favik"></a>
    <a class="links" href="https://apps.sorbonne-nouvelle.fr/esup-mdw/" target="_54"><div class="bloc">
      <label id="portalForm:p54" class="ui-outputlabel h4">Mon dossier de scolarité</label></div></a>
    <i class="infos fa fa-question-circle" onclick="showDialog(54)"></i>
    <div id="infos54" style="display:none"><label id="portalForm:j_idt212" class="ui-outputlabel"><ul><li>Notes et <strong>certificat</strong> de scolarité. ${'Encore du texte. '.repeat(20)}</li></ul></label>
    </div>
  </div>
  <div class="tuile default col-sm-6 t2"><a class="links" href="javascript:void(0)"><label id="portalForm:p9" class="h4">Lien cassé</label></a></div>
</form></body>`

test('an iSorbonne page with the logout link and the tiles is signed in', () => {
  assert.equal(isIsorbonneSignedInPage(200, ISORBONNE_PAGE), true)
  assert.equal(isPortalSignedInPage('isorbonne', 200, ISORBONNE_PAGE), true)
  assert.equal(isPortalSignedInPage('drupal', 200, ISORBONNE_PAGE), false)
})

test('the iSorbonne logout link counts relative (as served) or absolute (as saved)', () => {
  const form = '<form id="portalForm"></form>'
  assert.equal(isIsorbonneSignedInPage(200, `<a href="logout.xhtml">x</a>${form}`), true)
  assert.equal(isIsorbonneSignedInPage(200, `<a href="https://isorbonne.sorbonne-nouvelle.fr/ENT/logout.xhtml">x</a>${form}`), true)
  assert.equal(isIsorbonneSignedInPage(200, `<a href="nologout.xhtml">x</a>${form}`), false)
})

test('a CAS redirect or a page without the tiles is not an iSorbonne session', () => {
  assert.equal(isIsorbonneSignedInPage(302, ISORBONNE_PAGE), false)
  assert.equal(isIsorbonneSignedInPage(200, '<a href="/ENT/logout.xhtml">x</a>'), false)
  assert.equal(isIsorbonneSignedInPage(200, '<form id="portalForm"></form>'), false)
  assert.equal(isIsorbonneSignedInPage(200, null), false)
})

test('the iSorbonne logout link gives the name, family name first', () => {
  assert.deepEqual(parseIsorbonneName(ISORBONNE_PAGE), { name: 'Camille Le Gall', given_name: 'Camille', family_name: 'Le Gall' })
  assert.deepEqual(parseIsorbonneName('<a href="/ENT/logout.xhtml">Camille</a>'), { name: 'Camille', given_name: 'Camille', family_name: null })
  assert.equal(parseIsorbonneName('<a href="/ENT/logout.xhtml"> <i></i></a>'), null)
  assert.equal(parseIsorbonneName(null), null)
})

test('the iSorbonne tiles are grouped by their category button', () => {
  const sections = parseIsorbonneCatalogue(ISORBONNE_PAGE, 'https://isorbonne.sorbonne-nouvelle.fr')
  assert.deepEqual(sections.map((section) => section.title), ['Accueil', 'Etudiant'])
  assert.deepEqual(sections[0].tools, [
    { id: '35', title: 'Mes documents U', description: '', href: 'https://apps.sorbonne-nouvelle.fr/FileExplorer' },
  ])
  const [record] = sections[1].tools
  assert.equal(sections[1].tools.length, 1)
  assert.equal(record.title, 'Mon dossier de scolarité')
  assert.ok(record.description.startsWith('Notes et certificat de scolarité.'))
  assert.ok(record.description.endsWith('…') && record.description.length <= 161)
  const recordApp = buildPortalApps(sections).find((app) => app.title === 'Mon dossier de scolarité')
  assert.equal(recordApp.url, 'https://apps.sorbonne-nouvelle.fr/esup-mdw/')
  // A tool without a description says so with nothing, not an empty text.
  assert.equal(buildPortalApps(sections).find((app) => app.title === 'Mes documents U').description, null)
})

test('the isorbonne portal kind is known', () => {
  assert.equal(resolvePortalKind({ portal: 'isorbonne' }), 'isorbonne')
})
