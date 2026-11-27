// The demo account, answered by the page. The demo never reaches a
// university, so it needs no server: each request the page would send for
// it (src/entApi.js: /__ent_auth/…) is answered here instead, with the
// status and the body the server gave a demo session, from the sample data
// (src/demoAccount.js) and the visitor's own demo mailbox (src/demoMail.js).
// One route here for each route there, so the page reads the demo as it
// reads a student's account and no screen has a demo case of its own.
//
// What a session is for doesn't apply: no cookie, no limit on how fast the
// page asks (nothing is reached that a limit would protect).
//
// Pure but for what it is given (the university's config, the storage, the
// clock): tests/demoServer.test.js.
import {
  DEMO_ACCOUNT,
  DEMO_GRADES_DEPARTMENT_MESSAGE,
  DEMO_SESSION_MODE,
  DEMO_SIGNATURE_LOGIN,
  buildDemoApps,
  buildDemoCourses,
  buildDemoEvaluationDistribution,
  buildDemoGradesPayload,
  buildDemoMoodleDeadlinesPayload,
  buildDemoSemesterGradesPayload,
  buildDemoTimetableTree,
} from './demoAccount.js'
import { createDemoMailbox } from './demoMail.js'

const AUTH_PREFIX = '/__ent_auth'
const PROXY_PREFIX = '/__ent_proxy'

// The services a university may not have: their routes then answer
// « disabled », as the server's.
const FEATURE_GATED_PREFIXES = [
  ['/timetable', 'planning'],
  ['/grades', 'grades'],
  ['/mail', 'mail'],
  ['/moodle', 'moodleDeadlines'],
]

// ScoDoc's ids are plain integers.
const readScodocId = (value) => {
  const id = String(value ?? '').trim()
  return /^\d{1,10}$/.test(id) ? id : null
}

const today = (now) => new Date(now).toISOString().slice(0, 10)

// "2026-2027" from September, "2025-2026" until August.
function currentSchoolYear(now) {
  const date = new Date(now)
  const start = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1
  return `${start}-${start + 1}`
}

// A one-page PDF saying what it is: the demo's certificat de scolarité.
export function buildDemoCertificatePdf(schoolYear) {
  const text = `Certificat de scolarite - compte demo (${schoolYear})`
  const content = `BT /F1 18 Tf 72 760 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  // Every character is ASCII: a byte each.
  return Uint8Array.from(pdf, (character) => character.charCodeAt(0))
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function readJsonBody(init) {
  try {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

// options:
//   config     the university's client config (universities/<id>/client.js):
//              its features, whether its planning is a personal one, what
//              its mails' signature shows
//   session    () → the demo's sign-in (src/demoSession.js), for /session
//   storage    where the demo's mailbox is kept (src/demoMail.js)
//   now        the clock
//   pickIcons  (services) → the tiles' { palette, icons }, or a promise of
//              them (src/appIconPicks.js, with the university's look)
//   readLogos  the automatic signature's logos (src/demoMail.js)
export function createDemoServer({
  config = {},
  session = () => null,
  storage = null,
  now = () => Date.now(),
  pickIcons = () => ({ palette: {}, icons: {} }),
  readLogos = () => [],
} = {}) {
  const features = config.features ?? {}
  const mailbox = createDemoMailbox({ storage, now, config, login: DEMO_SIGNATURE_LOGIN, readLogos })
  const signedIn = (body) => ({ authenticated: true, sessionMode: DEMO_SESSION_MODE, ...body })
  // tonAPI's answer, as the gateway passes it on: its data and `meta`.
  const tonapi = (data) => ({
    data,
    meta: { university: config.id ?? null, establishment: null, provider: 'demo', fetchedAt: new Date(now()).toISOString(), cacheSecs: null },
  })
  const listed = (written) => String(written ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  const mail = ({ status, body }) => json(status, body)

  async function route(method, path, query, init) {
    for (const [prefix, feature] of FEATURE_GATED_PREFIXES) {
      if ((path === prefix || path.startsWith(`${prefix}/`)) && !features[feature]) {
        return json(404, { ok: false, disabled: true, feature })
      }
    }

    // One semester's relevé (« Mes notes »'s semester picker).
    const semester = method === 'GET' ? /^\/grades\/semester\/([^/]+)$/.exec(path) : null
    if (semester) {
      let semesterId = null
      try {
        semesterId = readScodocId(decodeURIComponent(semester[1]))
      } catch {
        // Not an id.
      }
      if (!semesterId) return json(400, { error: 'Invalid semester id.' })
      const grades = buildDemoSemesterGradesPayload(semesterId)
      return grades ? json(200, signedIn({ grades })) : json(404, { error: 'Unknown semester.' })
    }

    switch (`${method} ${path}`) {
      case 'GET /session':
        return json(200, {
          authenticated: true,
          user: DEMO_ACCOUNT.preferred_username,
          sessionMode: DEMO_SESSION_MODE,
          sessionSource: null,
          // No session for the launch relay to sign in with.
          canUseServerLaunch: false,
          degraded: false,
          degradedReason: null,
          analyticsEnabled: session()?.analyticsEnabled === true,
          university: config.id ?? null,
        })

      case 'GET /account':
        return json(200, signedIn({ account: DEMO_ACCOUNT }))

      case 'GET /apps':
        return json(200, signedIn({ apps: buildDemoApps() }))

      // ── Grades ──

      case 'GET /grades':
        return json(200, signedIn({ grades: buildDemoGradesPayload() }))

      case 'GET /grades/department-message':
        if (!/^[A-Za-z0-9_.-]{1,40}$/.test(String(query.get('dep') ?? '').trim())) return json(400, { error: 'Invalid department.' })
        return json(200, { authenticated: true, message: DEMO_GRADES_DEPARTMENT_MESSAGE })

      case 'GET /grades/evaluation-distribution': {
        const semesterId = query.get('semestre') === 'current' ? 'current' : readScodocId(query.get('semestre'))
        const evaluationId = readScodocId(query.get('eval'))
        if (!semesterId || !evaluationId) return json(400, { error: 'Invalid semester or evaluation id.' })
        const distribution = buildDemoEvaluationDistribution(semesterId, evaluationId)
        return distribution ? json(200, { authenticated: true, ...distribution }) : json(404, { error: 'Unknown evaluation.' })
      }

      case 'GET /grades/report.pdf':
        if (!readScodocId(query.get('semestre'))) return json(400, { error: 'Invalid semester id.' })
        return json(404, { error: 'Pas de PDF en mode démo.' })

      // ── Mail (src/demoMail.js) ──

      case 'GET /mail/recent':
        return mail(mailbox.recent({ offset: query.get('offset'), q: query.get('q'), folder: query.get('folder') }))
      case 'GET /mail/message':
        return mail(mailbox.message(query.get('id') ?? ''))
      case 'GET /mail/thread':
        return mail(mailbox.thread(query.get('id') ?? '', query.get('folder')))
      case 'GET /mail/folders':
        return mail(mailbox.folders())
      case 'POST /mail/action':
        return mail(mailbox.action(readJsonBody(init)))
      case 'POST /mail/folder-action':
        return mail(mailbox.folderAction(readJsonBody(init)))
      case 'GET /mail/prefs':
        return mail(mailbox.prefs())
      case 'GET /mail/autocomplete':
        return mail(mailbox.autocomplete(query.get('q')))
      case 'POST /mail/send':
        return mail(await mailbox.send(readJsonBody(init)))
      case 'POST /mail/draft':
        return mail(mailbox.saveDraft(readJsonBody(init)))
      case 'GET /mail/draft':
        return mail(mailbox.draft(query.get('id') ?? ''))
      case 'GET /mail/signatures':
        return mail(mailbox.signatures())
      case 'POST /mail/signature':
        return mail(mailbox.saveSignature(readJsonBody(init)))
      // Its sample attachments have nothing behind them.
      case 'GET /mail/part':
        return new Response(null, { status: 404 })

      // ── Moodle ──

      case 'GET /moodle/deadlines':
        return json(200, signedIn({ deadlines: buildDemoMoodleDeadlinesPayload({ now: now() }) }))

      // ── The account's photo and documents ──

      case 'GET /student-pic':
        return query.get('meta') === '1'
          ? json(200, signedIn({ available: false, source: 'demo', previewUrl: null }))
          : json(404, { available: false, source: 'demo' })

      case 'GET /documents/school-certificate/status':
        if (!features.schoolCertificate) return json(404, { available: false })
        return json(200, { available: true, schoolYear: currentSchoolYear(now()) })

      case 'GET /documents/school-certificate': {
        if (!features.schoolCertificate) return json(404, { ok: false, error: 'No certificate service for this university.' })
        const schoolYear = currentSchoolYear(now())
        const filename = `Certificat_de_scolarite_demo_${schoolYear}.pdf`
        return new Response(buildDemoCertificatePdf(schoolYear), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Cache-Control': 'no-store',
          },
        })
      }

      // ── The tiles' icons ──

      case 'POST /app-icons': {
        const body = readJsonBody(init)
        if (!Array.isArray(body.services)) return json(400, { ok: false, error: 'Expected { services: [...] }.' })
        const { palette, icons } = await pickIcons(body.services)
        return json(200, { ok: true, palette, icons })
      }

      // Nothing to sign in to a service with: its own address, as it is.
      case 'GET /launch-preview': {
        const target = query.get('url') ?? ''
        if (!/^https?:\/\//i.test(target)) return json(400, { finalUrl: target, chain: [], useServerLaunch: false, reason: 'invalid-target-url' })
        return json(200, { finalUrl: target, chain: [], useServerLaunch: false, reason: 'demo-session', canUseServerLaunch: false, degraded: false, degradedReason: null })
      }

      // ── The planning, as tonAPI gives it (the gateway's /timetable routes) ──

      case 'GET /timetable': {
        const from = query.get('from') ?? today(now())
        return json(200, tonapi(buildDemoCourses({ from, to: query.get('to') ?? from, resources: listed(query.get('resources')) })))
      }

      case 'GET /timetable/tree':
        return json(200, tonapi(buildDemoTimetableTree(listed(query.get('kind')))))

      case 'GET /timetable/resources': {
        const words = (query.get('q') ?? '').toLocaleLowerCase('fr').split(/\s+/).filter(Boolean)
        const found = []
        const walk = (nodes, path) => nodes.forEach((node) => {
          const at = [...path, node.name]
          if (!node.folder && words.every((word) => node.name.toLocaleLowerCase('fr').includes(word))) {
            found.push({ id: node.id, name: node.name, kind: node.kind, path: at })
          }
          walk(node.children, at)
        })
        walk(buildDemoTimetableTree(listed(query.get('kind'))), [])
        return json(200, tonapi(found.slice(0, Number(query.get('limit')) || 100)))
      }

      default:
        return json(404, { error: 'Not found.' })
    }
  }

  return {
    // What fetch(url, init) would have been answered: a Response.
    async answer(url, init = {}) {
      // A request dropped before it left fails as fetch() fails it.
      if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      const { pathname, searchParams } = new URL(String(url), 'http://tafac.invalid')
      const method = String(init.method ?? 'GET').toUpperCase()
      // The demo account never reaches the university's portal.
      if (pathname.includes(PROXY_PREFIX)) return json(401, { error: 'Authentication required.' })
      const at = pathname.indexOf(AUTH_PREFIX)
      if (at === -1) return json(404, { error: 'Not found.' })
      return route(method, pathname.slice(at + AUTH_PREFIX.length) || '/', searchParams, init)
    },

    // A file picked in the composer (POST /mail/upload, which the page sends
    // by itself: src/entApi.js): read only when it is an image the mailbox
    // keeps, measured otherwise. → { status, body }.
    async upload(file, { name = null } = {}) {
      if (!features.mail) return { status: 404, body: { ok: false, disabled: true, feature: 'mail' } }
      const size = Number(file?.size)
      const keeps = size > 0 && mailbox.keepsUpload(file.type, size)
      const bytes = keeps ? new Uint8Array(await file.arrayBuffer()) : null
      return mailbox.upload({ name: name ?? file?.name, contentType: file?.type, size, bytes })
    },

    // Signed out of the demo: what the visitor did there goes.
    clear() {
      mailbox.clear()
    },
  }
}
