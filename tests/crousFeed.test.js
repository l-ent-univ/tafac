import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCrousMenus, parseCrousRestaurants, parseMenuHtml } from '../server/crousFeed.js'

const RESTO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<root>
<resto id="r461" title="Resto U' Branly" opening="010,010,010,010,010,000,000" closing="0" short_desc="Campus de l'IUT" lat="48.75" lon="-3.46" zone="Lannion" zone2="" type="Restaurant">
<infos><![CDATA[<h2>Horaires</h2><p>MIDI : 11h30-13h30, du lundi au vendredi</p>]]></infos>
</resto>
<resto id="r440" title="Resto U' l&apos;Ereve" opening="" closing="1" short_desc="" lat="" lon="" zone="Rennes" zone2="" type="Restaurant">
</resto>
</root>`

const MENU_XML = `<root>
<resto id="r461">
<menu date="2026-10-20"><![CDATA[<h2>midi</h2><h4>3 - Desserts</h4><ul class="liste-plats"><li>Fruits</li></ul><h4>1 - Hors d'oeuvres</h4><ul class="liste-plats"><li>Carotte râpée</li><li></li></ul><h4>2 - Plats chauds</h4><ul class="liste-plats"><li>Nuggets &amp; frites</li></ul>]]></menu>
<menu date="2026-10-19"><![CDATA[<h2>midi</h2><h4>Structure fermée du Lundi 19 Octobre</h4>]]></menu>
</resto>
<resto id="r440">
</resto>
</root>`

test('parseCrousRestaurants reads each place, its zone, hours and state', () => {
  const [branly, ereve] = parseCrousRestaurants(RESTO_XML)
  assert.deepEqual(branly, {
    id: 'r461',
    title: 'Resto U\' Branly',
    zone: 'Lannion',
    type: 'Restaurant',
    description: 'Campus de l\'IUT',
    lat: 48.75,
    lon: -3.46,
    hours: 'MIDI : 11h30-13h30, du lundi au vendredi',
    closed: false,
  })
  assert.equal(ereve.title, 'Resto U\' l\'Ereve')
  assert.equal(ereve.closed, true)
  assert.equal(ereve.lat, null)
  assert.equal(ereve.hours, null)
})

test('parseCrousMenus orders days and sections, drops empty dishes, keeps notices', () => {
  const menus = parseCrousMenus(MENU_XML)
  const days = menus.get('r461')
  assert.deepEqual(days.map((day) => day.date), ['2026-10-19', '2026-10-20'])
  assert.deepEqual(days[0].meals, [{ name: 'midi', notice: 'Structure fermée du Lundi 19 Octobre', sections: [] }])
  assert.deepEqual(days[1].meals[0].sections, [
    { title: 'Hors d\'oeuvres', items: ['Carotte râpée'] },
    { title: 'Plats chauds', items: ['Nuggets & frites'] },
    { title: 'Desserts', items: ['Fruits'] },
  ])
  assert.deepEqual(menus.get('r440'), [])
})

test('parseMenuHtml drops the "menu non communiqué" placeholder', () => {
  const [meal] = parseMenuHtml('<h2>midi</h2><h4>Plats Chaud</h4><ul><li>menu non communiqué</li></ul>')
  assert.deepEqual(meal.sections, [])
})

test('parseMenuHtml reads several meals of a day', () => {
  const meals = parseMenuHtml('<h2>midi</h2><h4>Plat</h4><ul><li>Pâtes</li></ul><h2>soir</h2><h4>Plat</h4><ul><li>Soupe</li></ul>')
  assert.deepEqual(meals.map((meal) => [meal.name, meal.sections[0].items[0]]), [['midi', 'Pâtes'], ['soir', 'Soupe']])
})
