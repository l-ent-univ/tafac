// ============================================================================
// Anonymous analytics allowlist — the ONLY place that defines what l'ent may
// send to PostHog (see docs/ANALYTICS.md).
//
// Every event the browser posts to /__ent_auth/analytics goes through
// sanitizeAnalyticsBatch(): unknown events are dropped, unknown properties are
// dropped, and every kept value must match an enum, a short slug pattern or a
// boolean. There is no free-text property on purpose: no titles, names,
// subjects, URLs, grades or search text can ever get through.
//
// Adding an event or property means editing this file AND docs/ANALYTICS.md.
// ============================================================================

export const ANALYTICS_MAX_BODY_BYTES = 8 * 1024
export const ANALYTICS_MAX_EVENTS_PER_BATCH = 20

const WIDGET_IDS = ['greeting', 'nextClass', 'latestGrade', 'mail', 'deadlines']
export const DURATION_BUCKETS = ['<500ms', '<1s', '<3s', '<10s', '10s+']
const ERROR_KINDS = ['http_4xx', 'http_5xx', 'network', 'timeout', 'other']
// How the student arrived on « Mes notes » (see src/gradesAnalytics.js).
const GRADES_PAGE_SOURCES = ['nav', 'tabbar', 'tile', 'dashboard_card', 'sidebar_card', 'launch_card', 'history', 'other']
const GRADES_ACTIONS = ['semester_changed', 'ue_view_opened', 'grade_detail_opened', 'pdf_downloaded', 'explainer_opened', 'department_message_expanded']
// How the student arrived on the Planning page (see src/planningAnalytics.js).
const PLANNING_PAGE_SOURCES = ['nav', 'tabbar', 'tile', 'dashboard_card', 'launch_card', 'history', 'other']
// And on the Messagerie (see src/mailAnalytics.js): `grades` is « Écrire au
// sujet de cette note ».
const MAIL_PAGE_SOURCES = ['nav', 'tabbar', 'tile', 'dashboard_card', 'launch_card', 'grades', 'history', 'other']
const PAGE_SOURCES = { grades: GRADES_PAGE_SOURCES, planning: PLANNING_PAGE_SOURCES, mail: MAIL_PAGE_SOURCES }
const PLANNING_VIEWS = ['day', 'two_days', 'week', 'list']
const PLANNING_ACTIONS = [
  'view_changed', 'day_changed', 'week_changed', 'today', 'calendar_picked', 'day_opened',
  'course_opened', 'occurrence_opened', 'retry', 'open_account', 'ics_exported',
]
// planning_action's own properties, by action (any other is dropped), and
// those an action can't go without.
const PLANNING_ACTION_PROPERTIES = {
  view_changed: ['view'],
  course_opened: ['view'],
  day_changed: ['via', 'steps'],
  week_changed: ['via', 'steps'],
  ics_exported: ['from', 'result'],
}
const PLANNING_ACTION_REQUIRED = {
  view_changed: ['view'],
  day_changed: ['via'],
  week_changed: ['via'],
  ics_exported: ['from', 'result'],
}
const MAIL_ACTIONS = [
  'mail_opened', 'thread_expanded', 'folder_changed', 'search', 'refresh',
  'compose_opened', 'sent', 'draft_saved', 'draft_discarded',
  'trash', 'spam', 'move', 'restore', 'delete_forever', 'flag', 'read_toggle', 'empty_folder', 'mark_folder_read',
  'print', 'pdf', 'attachment_downloaded',
]
const MAIL_FOLDER_KINDS = ['inbox', 'sent', 'drafts', 'junk', 'trash', 'folder']
// mail_action's own properties, by action (any other is dropped), and
// those an action can't go without.
const MAIL_ACTION_PROPERTIES = {
  mail_opened: ['from'],
  folder_changed: ['folder_kind'],
  search: ['scope'],
  compose_opened: ['kind'],
  sent: ['result', 'attachments', 'inline_images'],
  trash: ['via'],
  spam: ['via'],
  move: ['via'],
  restore: ['via'],
  delete_forever: ['via'],
  flag: ['via'],
  read_toggle: ['via'],
  empty_folder: ['folder_kind'],
  mark_folder_read: ['folder_kind'],
  pdf: ['result'],
}
const MAIL_ACTION_REQUIRED = {
  mail_opened: ['from'],
  folder_changed: ['folder_kind'],
  search: ['scope'],
  compose_opened: ['kind'],
  sent: ['result'],
  trash: ['via'],
  spam: ['via'],
  move: ['via'],
  restore: ['via'],
  delete_forever: ['via'],
  flag: ['via'],
  read_toggle: ['via'],
  pdf: ['result'],
}
const SETTING_VALUES = {
  theme: ['auto', 'light', 'dark'],
  mail_signature_kind: ['auto', 'partage', 'custom'],
}
const SIMULATOR_STEPS = ['opened', 'ue_picked', 'reveal_shown', 'back_to_edit', 'closed']
// The simulator's outcome, sent with reveal_shown only. Never a grade, an
// average or a delta: how many grades were changed (bucketed), which way
// the UE went and whether it ends up validated.
const SIMULATOR_REVEAL_PROPERTIES = ['edited_bucket', 'added_grades', 'ue_direction', 'ue_validated', 'crossed_pass_mark']

const oneOf = (...values) => (value) => (values.includes(value) ? value : undefined)
const boolean = (value) => (typeof value === 'boolean' ? value : undefined)
const slug = (maxLength) => {
  const pattern = new RegExp(`^[a-z0-9-]{1,${maxLength}}$`)
  return (value) => (typeof value === 'string' && pattern.test(value) ? value : undefined)
}

// Coarse context the client attaches to every event. `university` and `demo`
// are NOT accepted from the client: the server sets them from its own config
// and from the session (see server/analytics.js).
export const CONTEXT_PROPERTIES = {
  device: oneOf('mobile', 'tablet', 'desktop'),
  browser: oneOf('chromium', 'firefox', 'safari', 'other'),
  standalone: boolean,
  lang: (value) => (typeof value === 'string' && /^[a-z]{2}$/.test(value) ? value : undefined),
  // Establishment id from the university config (e.g. "iutlan"): large groups.
  establishment: slug(16),
  // Formation slug from the ADE selection (e.g. "but-mmi"): never year/TD/TP.
  formation: slug(32),
}

// event name → { properties, required, refine, allowWithoutSession }
//   properties: allowed event-specific properties and their validators
//   required: properties without which the event is dropped
//   refine(props): cross-property rules; return null to drop the event
//   allowWithoutSession: accepted from visitors without a session (they get
//     a one-off random distinct id, see server/analytics.js)
export const ANALYTICS_EVENTS = {
  dashboard_viewed: {
    properties: {},
  },
  widget_loaded: {
    properties: {
      widget: oneOf(...WIDGET_IDS),
      status: oneOf('ok', 'empty', 'error'),
      duration_bucket: oneOf(...DURATION_BUCKETS),
      error_kind: oneOf(...ERROR_KINDS),
    },
    required: ['widget', 'status'],
    refine: (props) => {
      if (props.status !== 'error') delete props.error_kind
      return props
    },
  },
  app_opened: {
    properties: {
      app: slug(64),
      source: oneOf('grid', 'favorites', 'sidebar', 'tabbar'),
      // The grade service's app opened « Mes notes » instead of ScoDoc, or
      // the planning service's app the Planning page instead of the service.
      in_app: boolean,
    },
    required: ['app', 'source'],
  },
  setting_changed: {
    properties: {
      setting: oneOf('widget_visibility', 'app_descriptions', 'custom_background', 'wallpaper', 'university_logo', 'theme', 'analytics', 'mail_signature', 'mail_signature_kind'),
      value: oneOf('on', 'off', 'auto', 'light', 'dark', 'partage', 'custom'),
      widget: oneOf(...WIDGET_IDS),
    },
    required: ['setting', 'value'],
    refine: (props) => {
      // Turning analytics off must not be reported at all.
      if (props.setting === 'analytics' && props.value === 'off') return null
      // The theme reports which one was picked, the signature's kind which
      // one (auto, partage, custom); every other setting is on/off.
      const allowed = SETTING_VALUES[props.setting] ?? ['on', 'off']
      if (!allowed.includes(props.value)) return null
      if (props.setting === 'widget_visibility') {
        return props.widget ? props : null
      }
      delete props.widget
      return props
    },
  },
  login_result: {
    properties: {
      result: oneOf('success', 'failure'),
      demo: boolean,
    },
    required: ['result'],
    allowWithoutSession: true,
  },
  pwa_update_applied: {
    properties: {},
    allowWithoutSession: true,
  },
  // Arrival from the old l'ent address (see src/settingsTransferBoot.js).
  // Usually before signing in, hence allowed without a session.
  settings_imported: {
    properties: {
      has_settings: boolean,
    },
    required: ['has_settings'],
    allowWithoutSession: true,
  },
  // « Mes notes », the Planning and the Messagerie: one per arrival on the
  // page (not per re-render), each with its own sources. The planning's
  // also says the view it opens in.
  page_viewed: {
    properties: {
      page: oneOf('grades', 'planning', 'mail'),
      source: oneOf(...new Set([...GRADES_PAGE_SOURCES, ...PLANNING_PAGE_SOURCES, ...MAIL_PAGE_SOURCES])),
      view: oneOf(...PLANNING_VIEWS),
    },
    required: ['page', 'source'],
    refine: (props) => {
      if (!PAGE_SOURCES[props.page].includes(props.source)) return null
      if (props.page !== 'planning') delete props.view
      return props
    },
  },
  // The semester « Mes notes » opens on, once per arrival. `unsupported`: a
  // relevé that isn't a BUT one, or no ScoDoc relevé at all.
  grades_loaded: {
    properties: {
      status: oneOf('ok', 'empty', 'unpublished', 'unsupported', 'error'),
      duration_bucket: oneOf(...DURATION_BUCKETS),
      error_kind: oneOf(...ERROR_KINDS),
    },
    required: ['status'],
    refine: (props) => {
      if (props.status !== 'error') delete props.error_kind
      return props
    },
  },
  grades_action: {
    properties: {
      action: oneOf(...GRADES_ACTIONS),
      // Where a grade's detail sheet was opened from.
      from: oneOf('latest', 'ue_view', 'subjects', 'dashboard'),
    },
    required: ['action'],
    refine: (props) => {
      if (props.action !== 'grade_detail_opened') delete props.from
      return props
    },
  },
  simulator_step: {
    properties: {
      step: oneOf(...SIMULATOR_STEPS),
      edited_bucket: oneOf('1', '2-3', '4+'),
      added_grades: boolean,
      ue_direction: oneOf('up', 'down', 'same', 'new'),
      ue_validated: boolean,
      crossed_pass_mark: boolean,
      // With `closed`: the furthest step reached.
      reached: oneOf('dial', 'edit', 'reveal'),
    },
    required: ['step'],
    refine: (props) => {
      if (props.step !== 'reveal_shown') {
        for (const name of SIMULATOR_REVEAL_PROPERTIES) delete props[name]
      }
      if (props.step !== 'closed') delete props.reached
      return props
    },
  },
  // The week the Planning page opens on, once per arrival: its classes
  // came (`ok`), none that week (`empty`), ADE didn't answer
  // (`unavailable`, with its error_kind), or no group chosen yet
  // (`unconfigured`). Never the week itself nor how many classes.
  planning_loaded: {
    properties: {
      status: oneOf('ok', 'empty', 'unavailable', 'unconfigured'),
      duration_bucket: oneOf(...DURATION_BUCKETS),
      error_kind: oneOf(...ERROR_KINDS),
    },
    required: ['status'],
    refine: (props) => {
      if (props.status !== 'unavailable') delete props.error_kind
      return props
    },
  },
  // One thing done on the Planning page, or its .ics export from Réglages
  // (`from`). Steps through days or weeks come once per burst, with how
  // (`via`) and how far (`steps`, bucketed): never a day or a class.
  planning_action: {
    properties: {
      action: oneOf(...PLANNING_ACTIONS),
      view: oneOf(...PLANNING_VIEWS),
      via: oneOf('arrow', 'keyboard', 'swipe', 'strip', 'pill'),
      steps: oneOf('1', '2-3', '4+'),
      from: oneOf('header', 'settings'),
      result: oneOf('ok', 'empty', 'error'),
    },
    required: ['action'],
    refine: (props) => {
      const kept = PLANNING_ACTION_PROPERTIES[props.action] ?? []
      for (const name of Object.keys(props)) {
        if (name !== 'action' && !kept.includes(name) && !Object.hasOwn(CONTEXT_PROPERTIES, name)) delete props[name]
      }
      if ((PLANNING_ACTION_REQUIRED[props.action] ?? []).some((name) => !Object.hasOwn(props, name))) return null
      return props
    },
  },
  // The folder the Messagerie opens on, once per arrival: the mails came
  // (`ok`), none (`empty`), the mail didn't answer (`error`, with its
  // error_kind) or the session is gone (`session_expired`). Never how many
  // mails nor the folder.
  mail_loaded: {
    properties: {
      status: oneOf('ok', 'empty', 'error', 'session_expired'),
      duration_bucket: oneOf(...DURATION_BUCKETS),
      error_kind: oneOf(...ERROR_KINDS),
    },
    required: ['status'],
    refine: (props) => {
      if (props.status !== 'error') delete props.error_kind
      return props
    },
  },
  // One thing done in the Messagerie. Only enums, booleans and buckets, each
  // action keeping its own properties: never a subject, an address, a
  // folder's name, a search text, a file name nor a message id. A search
  // comes once per burst of typing, with its scope only.
  mail_action: {
    properties: {
      action: oneOf(...MAIL_ACTIONS),
      from: oneOf('list', 'widget', 'history'),
      folder_kind: oneOf(...MAIL_FOLDER_KINDS),
      scope: oneOf('local', 'server'),
      kind: oneOf('new', 'reply', 'reply_all', 'forward', 'draft', 'grade'),
      result: oneOf('ok', 'partial', 'error', 'undone'),
      attachments: oneOf('0', '1', '2-3', '4+'),
      inline_images: boolean,
      via: oneOf('toolbar', 'context_menu', 'swipe', 'keyboard'),
    },
    required: ['action'],
    refine: (props) => {
      const kept = MAIL_ACTION_PROPERTIES[props.action] ?? []
      for (const name of Object.keys(props)) {
        if (name !== 'action' && !kept.includes(name) && !Object.hasOwn(CONTEXT_PROPERTIES, name)) delete props[name]
      }
      if ((MAIL_ACTION_REQUIRED[props.action] ?? []).some((name) => !Object.hasOwn(props, name))) return null
      // A pdf is saved or fails: nothing partial or undone.
      if (props.action === 'pdf' && !['ok', 'error'].includes(props.result)) return null
      return props
    },
  },
  // A page's launch announcement (« Mes notes », the Planning, the Messagerie: `launch`):
  // the dashboard card (shown, its button, its close button) and the nav
  // item's « Nouveau » marker clicked. Versions from before the Planning's
  // only announced « Mes notes » and don't say which: counted as `grades`.
  launch_card: {
    properties: {
      action: oneOf('shown', 'cta', 'dismissed', 'tab_marker'),
      launch: oneOf('grades', 'planning', 'mail'),
    },
    required: ['action'],
    refine: (props) => {
      props.launch ??= 'grades'
      return props
    },
  },
}

function pickAllowed(source, validators) {
  const picked = {}

  for (const [name, validate] of Object.entries(validators)) {
    if (!Object.hasOwn(source, name)) continue
    const value = validate(source[name])
    if (value !== undefined) picked[name] = value
  }

  return picked
}

// Returns { event, properties } with only allowlisted data, or null.
export function sanitizeAnalyticsEvent(rawEvent, { hasSession = false } = {}) {
  if (!rawEvent || typeof rawEvent !== 'object' || typeof rawEvent.event !== 'string') {
    return null
  }

  if (!Object.hasOwn(ANALYTICS_EVENTS, rawEvent.event)) {
    return null
  }

  const definition = ANALYTICS_EVENTS[rawEvent.event]
  if (!hasSession && !definition.allowWithoutSession) {
    return null
  }

  const source = rawEvent.properties && typeof rawEvent.properties === 'object' && !Array.isArray(rawEvent.properties)
    ? rawEvent.properties
    : {}
  let properties = {
    ...pickAllowed(source, CONTEXT_PROPERTIES),
    ...pickAllowed(source, definition.properties),
  }

  if ((definition.required ?? []).some((name) => !Object.hasOwn(properties, name))) {
    return null
  }

  if (definition.refine) {
    properties = definition.refine(properties)
    if (!properties) return null
  }

  return { event: rawEvent.event, properties }
}

// Parses a request body (JSON object or the raw text sent by
// navigator.sendBeacon) into a list of sanitized events.
export function sanitizeAnalyticsBatch(body, options = {}) {
  let payload = body

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return []
    }
  }

  const rawEvents = Array.isArray(payload?.events) ? payload.events : []

  return rawEvents
    .slice(0, ANALYTICS_MAX_EVENTS_PER_BATCH)
    .map((rawEvent) => sanitizeAnalyticsEvent(rawEvent, options))
    .filter(Boolean)
}
