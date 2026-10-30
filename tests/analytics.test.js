import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { createAnalytics, createDailyHasher, readAnalyticsConfig } from '../server/analytics.js'
import { ANALYTICS_MAX_EVENTS_PER_BATCH, sanitizeAnalyticsBatch, sanitizeAnalyticsEvent } from '../server/analyticsSchema.js'
import { toFormationSlug } from '../src/formationSlug.js'

const DAY_1 = Date.parse('2026-10-08T10:00:00Z')
const DAY_1_LATE = Date.parse('2026-10-08T23:59:59Z')
const DAY_2 = Date.parse('2026-10-09T00:00:01Z')

function createFakeClient() {
  const captured = []
  return {
    captured,
    capture: (message) => captured.push(message),
    on: () => {},
    shutdown: async () => {},
  }
}

test('daily hash is stable within a UTC day and changes the next day', () => {
  let now = DAY_1
  let saltCount = 0
  const hasher = createDailyHasher({
    now: () => now,
    generateSalt: () => Buffer.from(`salt-${++saltCount}`),
  })

  const morning = hasher('session-a')
  now = DAY_1_LATE
  assert.equal(hasher('session-a'), morning)
  assert.notEqual(hasher('session-b'), morning)
  assert.equal(saltCount, 1)

  now = DAY_2
  const nextDay = hasher('session-a')
  assert.notEqual(nextDay, morning)
  assert.equal(saltCount, 2)

  assert.match(morning, /^[0-9a-f]{32}$/)
  assert.ok(!morning.includes('session-a'))
})

test('daily hash uses a random salt by default (not reproducible across instances)', () => {
  const now = () => DAY_1
  assert.notEqual(createDailyHasher({ now })('session-a'), createDailyHasher({ now })('session-a'))
})

test('allowlist drops unknown events, unknown properties and free text', () => {
  assert.equal(sanitizeAnalyticsEvent({ event: '$pageview', properties: {} }, { hasSession: true }), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'constructor' }, { hasSession: true }), null)

  const event = sanitizeAnalyticsEvent({
    event: 'widget_loaded',
    properties: {
      widget: 'mail',
      status: 'ok',
      duration_bucket: '<1s',
      error_kind: 'network',
      subject: 'Convocation examen',
      email: 'demo@tafac.fr',
      device: 'desktop',
      browser: 'Mozilla/5.0',
      lang: 'fr-FR',
      establishment: 'Camille Martin',
      formation: 'BUT MMI / TP 3',
      university: 'evil',
      demo: true,
      $ip: '1.2.3.4',
    },
  }, { hasSession: true })

  assert.deepEqual(event, {
    event: 'widget_loaded',
    properties: { device: 'desktop', widget: 'mail', status: 'ok', duration_bucket: '<1s' },
  })
})

test('required and cross-property rules', () => {
  const opts = { hasSession: true }
  assert.equal(sanitizeAnalyticsEvent({ event: 'widget_loaded', properties: { widget: 'mail' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'app_opened', properties: { app: 'Moodle UR', source: 'grid' } }, opts), null)
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'app_opened', properties: { app: 'moodle-ur', source: 'grid' } }, opts)?.properties,
    { app: 'moodle-ur', source: 'grid' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'app_opened', properties: { app: 'lent-iutlan-notes9', source: 'favorites', in_app: true } }, opts)?.properties,
    { app: 'lent-iutlan-notes9', source: 'favorites', in_app: true },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'app_opened', properties: { app: 'moodle-ur', source: 'grid', in_app: 'yes' } }, opts)?.properties,
    { app: 'moodle-ur', source: 'grid' },
  )
  assert.equal(sanitizeAnalyticsEvent({ event: 'setting_changed', properties: { setting: 'analytics', value: 'off' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'setting_changed', properties: { setting: 'widget_visibility', value: 'off' } }, opts), null)
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'setting_changed', properties: { setting: 'app_descriptions', value: 'on', widget: 'mail' } }, opts)?.properties,
    { setting: 'app_descriptions', value: 'on' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'setting_changed', properties: { setting: 'theme', value: 'dark' } }, opts)?.properties,
    { setting: 'theme', value: 'dark' },
  )
  assert.equal(sanitizeAnalyticsEvent({ event: 'setting_changed', properties: { setting: 'theme', value: 'on' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'setting_changed', properties: { setting: 'wallpaper', value: 'dark' } }, opts), null)
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'widget_loaded', properties: { widget: 'mail', status: 'error', error_kind: 'http_5xx' } }, opts)?.properties,
    { widget: 'mail', status: 'error', error_kind: 'http_5xx' },
  )
})

test('events without a session are limited to the anonymous-safe ones', () => {
  assert.equal(sanitizeAnalyticsEvent({ event: 'dashboard_viewed' }, { hasSession: false }), null)
  assert.ok(sanitizeAnalyticsEvent({ event: 'login_result', properties: { result: 'failure' } }, { hasSession: false }))
})

test('settings_imported only carries a boolean', () => {
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'settings_imported', properties: { has_settings: true, keys: ['l-ent:weather-city'] } }, { hasSession: false }),
    { event: 'settings_imported', properties: { has_settings: true } },
  )
  assert.equal(sanitizeAnalyticsEvent({ event: 'settings_imported', properties: { has_settings: 'yes' } }, { hasSession: false }), null)
})

test('batch parsing accepts sendBeacon text bodies and caps the batch size', () => {
  const events = Array.from({ length: 50 }, () => ({ event: 'dashboard_viewed' }))
  assert.equal(sanitizeAnalyticsBatch(JSON.stringify({ events }), { hasSession: true }).length, ANALYTICS_MAX_EVENTS_PER_BATCH)
  assert.deepEqual(sanitizeAnalyticsBatch('not json', { hasSession: true }), [])
  assert.deepEqual(sanitizeAnalyticsBatch({ events: 'nope' }, { hasSession: true }), [])
})

test('disabled without a project key', () => {
  assert.deepEqual(readAnalyticsConfig({}), { projectKey: null, host: 'https://eu.i.posthog.com', excludedUsers: [] })
  const analytics = createAnalytics({ projectKey: null })
  assert.equal(analytics.enabled, false)
  assert.equal(analytics.ingest({ events: [{ event: 'dashboard_viewed' }] }, { id: 's' }), 0)
})

test('ingest hashes the session id and sets privacy flags', () => {
  const client = createFakeClient()
  const analytics = createAnalytics({
    projectKey: 'test',
    universityId: 'univ-rennes',
    client,
    hasher: createDailyHasher({ now: () => DAY_1, generateSalt: () => Buffer.from('fixed') }),
  })

  analytics.ingest(JSON.stringify({ events: [{ event: 'dashboard_viewed', properties: { device: 'mobile' } }] }), { id: 'session-123', demo: true })
  analytics.ingest({ events: [{ event: 'login_result', properties: { result: 'failure', demo: false } }] }, null)

  assert.equal(client.captured.length, 2)
  const [withSession, withoutSession] = client.captured
  assert.match(withSession.distinctId, /^[0-9a-f]{32}$/)
  assert.notEqual(withSession.distinctId, 'session-123')
  assert.equal(withSession.disableGeoip, true)
  assert.deepEqual(withSession.properties, {
    device: 'mobile',
    demo: true,
    university: 'univ-rennes',
    $process_person_profile: false,
  })
  assert.match(withoutSession.distinctId, /^[0-9a-f-]{36}$/)
  assert.equal(withoutSession.properties.demo, false)
})

test('events of excluded accounts are dropped, never sent', () => {
  assert.deepEqual(readAnalyticsConfig({ ANALYTICS_EXCLUDED_USERS: ' Dev1, dev2  dev3,' }).excludedUsers, ['dev1', 'dev2', 'dev3'])

  const client = createFakeClient()
  const analytics = createAnalytics({ projectKey: 'test', excludedUsers: ['dev1'], client })
  const batch = { events: [{ event: 'dashboard_viewed' }] }

  assert.equal(analytics.ingest(batch, { id: 'session-a', demo: false, user: 'DEV1' }), 0)
  assert.equal(analytics.ingest(batch, { id: 'session-b', demo: false, user: 'student' }), 1)
  assert.equal(analytics.ingest({ events: [{ event: 'login_result', properties: { result: 'success', demo: false } }] }, null), 1)
  assert.equal(client.captured.length, 2)
  assert.ok(client.captured.every(({ properties }) => !('user' in properties)))
})

test('formation slug is short and only accepted as a slug', () => {
  assert.equal(toFormationSlug('BUT MMI'), 'but-mmi')
  assert.equal(toFormationSlug('Licence Économie-Gestion'), 'licence-economie-gestion')
  assert.equal(toFormationSlug('   '), '')
  assert.ok(toFormationSlug('x'.repeat(80)).length <= 32)
  const kept = sanitizeAnalyticsEvent({ event: 'dashboard_viewed', properties: { formation: 'but-mmi' } }, { hasSession: true })
  assert.deepEqual(kept.properties, { formation: 'but-mmi' })
  const dropped = sanitizeAnalyticsEvent({ event: 'dashboard_viewed', properties: { formation: 'BUT MMI 2 — TP3' } }, { hasSession: true })
  assert.deepEqual(dropped.properties, {})
})

test('page_viewed only names the grades page and an enum source', () => {
  const opts = { hasSession: true }
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'grades', source: 'launch_card', semester: '2026-S3' } }, opts)?.properties,
    { page: 'grades', source: 'launch_card' },
  )
  assert.equal(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'grades', source: 'https://tafac.fr/' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: '/grades?ue=UE3.1', source: 'nav' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'grades', source: 'nav' } }, { hasSession: false }), null)
})

test('grades_loaded keeps buckets and categories, never numbers', () => {
  const opts = { hasSession: true }
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'grades_loaded', properties: { status: 'error', duration_bucket: '<3s', error_kind: 'timeout', duration_ms: 2412, error: 'ScoDoc down' } }, opts)?.properties,
    { status: 'error', duration_bucket: '<3s', error_kind: 'timeout' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'grades_loaded', properties: { status: 'unpublished', duration_bucket: '<500ms', error_kind: 'network' } }, opts)?.properties,
    { status: 'unpublished', duration_bucket: '<500ms' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'grades_loaded', properties: { status: 'ok', duration_bucket: 1200, average: 12.5 } }, opts)?.properties,
    { status: 'ok' },
  )
  assert.equal(sanitizeAnalyticsEvent({ event: 'grades_loaded', properties: { status: 'loading' } }, opts), null)
})

test('grades_action carries an action, and `from` only for a grade detail', () => {
  const opts = { hasSession: true }
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'grades_action', properties: { action: 'grade_detail_opened', from: 'ue_view', evaluation_id: 4512, module: 'R3.01' } }, opts)?.properties,
    { action: 'grade_detail_opened', from: 'ue_view' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'grades_action', properties: { action: 'semester_changed', from: 'latest', semester_id: '845' } }, opts)?.properties,
    { action: 'semester_changed' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'grades_action', properties: { action: 'ue_view_opened', ue: 'UE3.1' } }, opts)?.properties,
    { action: 'ue_view_opened' },
  )
  assert.equal(sanitizeAnalyticsEvent({ event: 'grades_action', properties: { action: 'UE3.1' } }, opts), null)
})

test('simulator_step keeps reveal outcomes on reveal_shown and `reached` on closed only', () => {
  const opts = { hasSession: true }
  const reveal = {
    edited_bucket: '2-3',
    added_grades: true,
    ue_direction: 'up',
    ue_validated: true,
    crossed_pass_mark: true,
  }
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'simulator_step', properties: { step: 'reveal_shown', ...reveal, reached: 'reveal', delta: 1.5, average: 10.4, ue: 'UE3.1' } }, opts)?.properties,
    { step: 'reveal_shown', ...reveal },
  )
  // Numbers where buckets are expected are dropped, not rounded.
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'simulator_step', properties: { step: 'reveal_shown', edited_bucket: 2, ue_direction: '+1.5', ue_validated: 'yes' } }, opts)?.properties,
    { step: 'reveal_shown' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'simulator_step', properties: { step: 'closed', reached: 'edit', ...reveal } }, opts)?.properties,
    { step: 'closed', reached: 'edit' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'simulator_step', properties: { step: 'ue_picked', reached: 'dial', ue_validated: false } }, opts)?.properties,
    { step: 'ue_picked' },
  )
  assert.equal(sanitizeAnalyticsEvent({ event: 'simulator_step', properties: { step: 'typed' } }, opts), null)
})

test('launch_card only carries its action and which launch', () => {
  const opts = { hasSession: true }
  for (const action of ['shown', 'cta', 'dismissed', 'tab_marker']) {
    for (const launch of ['grades', 'planning', 'mail']) {
      assert.deepEqual(sanitizeAnalyticsEvent({ event: 'launch_card', properties: { action, launch } }, opts)?.properties, { action, launch })
    }
  }
  // Versions from before the Planning's launch only announced « Mes notes ».
  assert.deepEqual(sanitizeAnalyticsEvent({ event: 'launch_card', properties: { action: 'shown' } }, opts)?.properties, { action: 'shown', launch: 'grades' })
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'launch_card', properties: { action: 'cta', launch: 'planning', title: 'Ton emploi du temps dans l’appli', page: '/planning' } }, opts)?.properties,
    { action: 'cta', launch: 'planning' },
  )
  assert.equal(sanitizeAnalyticsEvent({ event: 'launch_card', properties: { action: 'clicked', launch: 'planning' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'launch_card', properties: { action: 'shown', launch: 'planning' } }, { hasSession: false }), null)
})

test('grades events take the session demo flag from the server, never the client', () => {
  const client = createFakeClient()
  const analytics = createAnalytics({ projectKey: 'test', client })
  analytics.ingest({ events: [{ event: 'page_viewed', properties: { page: 'grades', source: 'nav', demo: false } }] }, { id: 'demo-session', demo: true })
  analytics.ingest({ events: [{ event: 'grades_action', properties: { action: 'pdf_downloaded', demo: true } }] }, { id: 'real-session', demo: false })
  assert.deepEqual(client.captured.map(({ properties }) => properties.demo), [true, false])
})

test('page_viewed keeps each page to its own sources, and `view` to the planning', () => {
  const opts = { hasSession: true }
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'planning', source: 'dashboard_card', view: 'two_days', week: '2026-10-19', day: '2026-10-21' } }, opts)?.properties,
    { page: 'planning', source: 'dashboard_card', view: 'two_days' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'planning', source: 'tile', view: 'twoDays' } }, opts)?.properties,
    { page: 'planning', source: 'tile' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'grades', source: 'nav', view: 'week' } }, opts)?.properties,
    { page: 'grades', source: 'nav' },
  )
  // Both pages have their launch card.
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'planning', source: 'launch_card', view: 'week' } }, opts)?.properties,
    { page: 'planning', source: 'launch_card', view: 'week' },
  )
  assert.equal(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'planning', source: 'launch-card' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'planning', source: 'nav' } }, { hasSession: false }), null)
})

test('planning_loaded keeps a status, a bucket and error_kind for unavailable only', () => {
  const opts = { hasSession: true }
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'planning_loaded', properties: { status: 'unavailable', duration_bucket: '<10s', error_kind: 'http_5xx', error: 'ADE down', week: '2026-10-19' } }, opts)?.properties,
    { status: 'unavailable', duration_bucket: '<10s', error_kind: 'http_5xx' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'planning_loaded', properties: { status: 'empty', duration_bucket: '<1s', error_kind: 'network', classes: 0 } }, opts)?.properties,
    { status: 'empty', duration_bucket: '<1s' },
  )
  assert.deepEqual(
    sanitizeAnalyticsEvent({ event: 'planning_loaded', properties: { status: 'ok', duration_bucket: 840, group: 'TP3' } }, opts)?.properties,
    { status: 'ok' },
  )
  assert.deepEqual(sanitizeAnalyticsEvent({ event: 'planning_loaded', properties: { status: 'unconfigured' } }, opts)?.properties, { status: 'unconfigured' })
  assert.equal(sanitizeAnalyticsEvent({ event: 'planning_loaded', properties: { status: 'loading' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'planning_loaded', properties: { status: 'error' } }, opts), null)
})

test('planning_action keeps only the properties of its action, never a class or a day', () => {
  const opts = { hasSession: true }
  const keep = (properties) => sanitizeAnalyticsEvent({ event: 'planning_action', properties }, opts)?.properties ?? null
  assert.deepEqual(keep({ action: 'view_changed', view: 'week', via: 'arrow', from: 'header' }), { action: 'view_changed', view: 'week' })
  assert.deepEqual(keep({ action: 'course_opened', view: 'list', title: 'Maths', room: 'B204', teacher: 'Dupont', day: '2026-10-21' }), { action: 'course_opened', view: 'list' })
  assert.deepEqual(keep({ action: 'week_changed', via: 'swipe', steps: '2-3', view: 'week' }), { action: 'week_changed', via: 'swipe', steps: '2-3' })
  assert.deepEqual(keep({ action: 'day_changed', via: 'pill', steps: 3 }), { action: 'day_changed', via: 'pill' })
  assert.deepEqual(keep({ action: 'ics_exported', from: 'settings', result: 'empty', classes: 12 }), { action: 'ics_exported', from: 'settings', result: 'empty' })
  for (const action of ['today', 'calendar_picked', 'day_opened', 'occurrence_opened', 'retry', 'open_account']) {
    assert.deepEqual(keep({ action, view: 'day', via: 'arrow', steps: '1', from: 'header', result: 'ok' }), { action })
  }
  // Context properties stay.
  assert.deepEqual(keep({ action: 'today', device: 'mobile', formation: 'but-mmi' }), { device: 'mobile', formation: 'but-mmi', action: 'today' })
  // Without what makes them meaningful, or with free text, dropped.
  assert.equal(keep({ action: 'view_changed' }), null)
  assert.equal(keep({ action: 'view_changed', view: 'Semaine du 19 octobre' }), null)
  assert.equal(keep({ action: 'week_changed', steps: '1' }), null)
  assert.equal(keep({ action: 'ics_exported', from: 'header' }), null)
  assert.equal(keep({ action: 'ics_exported', from: 'dashboard', result: 'ok' }), null)
  assert.equal(keep({ action: 'Maths B204' }), null)
})

test('page_viewed accepts the Messagerie with its own sources', () => {
  const opts = { hasSession: true }
  for (const source of ['nav', 'tabbar', 'tile', 'dashboard_card', 'launch_card', 'grades', 'planning', 'history', 'other']) {
    assert.deepEqual(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'mail', source, view: 'week' } }, opts)?.properties, { page: 'mail', source })
  }
  // `sidebar_card` is « Mes notes »'s alone.
  assert.equal(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'mail', source: 'sidebar_card' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'grades', source: 'grades' } }, opts), null)
  assert.equal(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'planning', source: 'planning' } }, opts), null)
})

test('mail_loaded only carries a status, a duration bucket and the error kind of an error', () => {
  const opts = { hasSession: true }
  const keep = (properties) => sanitizeAnalyticsEvent({ event: 'mail_loaded', properties }, opts)?.properties ?? null
  for (const status of ['ok', 'empty', 'session_expired']) {
    assert.deepEqual(keep({ status, duration_bucket: '<1s', error_kind: 'network', count: 42, folder: 'Perso' }), { status, duration_bucket: '<1s' })
  }
  assert.deepEqual(keep({ status: 'error', duration_bucket: '10s+', error_kind: 'http_5xx' }), { status: 'error', duration_bucket: '10s+', error_kind: 'http_5xx' })
  assert.equal(keep({ status: 'loading' }), null)
  assert.equal(keep({}), null)
})

test('mail_action keeps only the properties of its action, never a subject, an address or a folder name', () => {
  const opts = { hasSession: true }
  const keep = (properties) => sanitizeAnalyticsEvent({ event: 'mail_action', properties }, opts)?.properties ?? null
  const leaks = { subject: 'Convocation', to: 'a@b.fr', folder: 'Projets', query: 'examen', name: 'cv.pdf', id: '123', count: 5 }
  assert.deepEqual(keep({ action: 'mail_opened', from: 'widget', ...leaks }), { action: 'mail_opened', from: 'widget' })
  assert.deepEqual(keep({ action: 'folder_changed', folder_kind: 'folder', ...leaks }), { action: 'folder_changed', folder_kind: 'folder' })
  assert.deepEqual(keep({ action: 'search', scope: 'server', ...leaks }), { action: 'search', scope: 'server' })
  assert.deepEqual(keep({ action: 'compose_opened', kind: 'grade', ...leaks }), { action: 'compose_opened', kind: 'grade' })
  // A class's mail: never its course, room, teacher or day.
  const courseLeaks = { course: 'R5.12 Développement back-end', room: 'A08', teacher: 'M. Lemoine', day: '2026-11-03', title: 'R5.12' }
  assert.deepEqual(keep({ action: 'compose_opened', kind: 'course', ...leaks, ...courseLeaks }), { action: 'compose_opened', kind: 'course' })
  assert.deepEqual(keep({ action: 'course_attached', ...leaks, ...courseLeaks }), { action: 'course_attached' })
  assert.deepEqual(
    keep({ action: 'sent', result: 'partial', attachments: '2-3', inline_images: true, ...leaks }),
    { action: 'sent', result: 'partial', attachments: '2-3', inline_images: true },
  )
  for (const action of ['trash', 'spam', 'move', 'restore', 'delete_forever', 'flag', 'read_toggle']) {
    for (const via of ['toolbar', 'context_menu', 'swipe', 'keyboard']) assert.deepEqual(keep({ action, via, ...leaks }), { action, via })
  }
  assert.deepEqual(keep({ action: 'pdf', result: 'error' }), { action: 'pdf', result: 'error' })
  assert.deepEqual(keep({ action: 'empty_folder', folder_kind: 'trash', ...leaks }), { action: 'empty_folder', folder_kind: 'trash' })
  for (const action of ['thread_expanded', 'refresh', 'draft_saved', 'draft_discarded', 'grade_attached', 'course_attached', 'print', 'attachment_downloaded']) {
    assert.deepEqual(keep({ action, via: 'toolbar', from: 'list', result: 'ok', ...leaks }), { action })
  }
  // Context properties stay.
  assert.deepEqual(keep({ action: 'refresh', device: 'mobile' }), { device: 'mobile', action: 'refresh' })
  // Without what makes them meaningful, or with anything else, dropped.
  assert.equal(keep({ action: 'mail_opened' }), null)
  assert.equal(keep({ action: 'mail_opened', from: 'Projets' }), null)
  assert.equal(keep({ action: 'folder_changed', folder_kind: 'Projets' }), null)
  assert.equal(keep({ action: 'search', scope: 'examen' }), null)
  assert.equal(keep({ action: 'trash' }), null)
  assert.equal(keep({ action: 'trash', via: 'voice' }), null)
  assert.equal(keep({ action: 'sent' }), null)
  assert.equal(keep({ action: 'sent', result: 'ok', attachments: 7 })?.attachments, undefined)
  assert.equal(keep({ action: 'pdf', result: 'undone' }), null)
  assert.equal(keep({ action: 'compose_opened', kind: 'spam' }), null)
  assert.equal(keep({ action: 'delete_everything' }), null)
  assert.equal(keep({ action: 'Convocation examen' }), null)
})

test('setting_changed takes the mail signature on/off and its kind, nothing else', () => {
  const opts = { hasSession: true }
  const keep = (properties) => sanitizeAnalyticsEvent({ event: 'setting_changed', properties }, opts)?.properties ?? null
  assert.deepEqual(keep({ setting: 'mail_signature', value: 'off' }), { setting: 'mail_signature', value: 'off' })
  assert.deepEqual(keep({ setting: 'mail_signature', value: 'on', text: 'Jean Dupont' }), { setting: 'mail_signature', value: 'on' })
  for (const value of ['auto', 'partage', 'custom']) assert.deepEqual(keep({ setting: 'mail_signature_kind', value }), { setting: 'mail_signature_kind', value })
  assert.equal(keep({ setting: 'mail_signature_kind', value: 'on' }), null)
  assert.equal(keep({ setting: 'mail_signature', value: 'custom' }), null)
  assert.equal(keep({ setting: 'wallpaper', value: 'partage' }), null)
  assert.equal(keep({ setting: 'theme', value: 'custom' }), null)
})
