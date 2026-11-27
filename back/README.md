# back

Tafac's backend in Rust. It signs the student in, holds the session and
answers the routes that have moved to
[tonAPI](https://github.com/l-ent-univ/tonAPI); the Node server (`server.js`,
`server/`) is behind it for the routes that haven't.

One Cargo workspace; each crate under `crates/`. Today there is one,
`tafac-gateway`. The apps call it in-process from their bridge
(`src-tauri/src/bridge.rs`); on tafac.fr it is a small server in front of
Node. How it fits with the rest: `docs/DESKTOP.md`, « tonAPI ».

```sh
cd back
cargo test                                   # every crate
cargo build --release -p tafac-gateway       # tafac.fr's server
```

tonAPI's repository is private for now: Cargo fetches it with git
(`.cargo/config.toml`, at the repository's root), so a build needs read
access to it.

## Who does what

```
the page ──▶ the gateway (Rust) ──▶ tonAPI ──▶ the university
                   │                            (CAS, portal, Moodle, ScoDoc,
                   │                             school records, planning,
                   │                             the webmail)
                   └──▶ Node
                        the routes that haven't moved,
                        with the session made above
```

- **The gateway** answers `POST /login`, `POST /logout`, `GET /session`,
  `GET /account`, the portal's applications (`GET /apps`), the Moodle
  deadlines and the five grades routes, for the universities of `routes.rs`
  (today: Rennes). It makes the session at the
  sign-in and says when it is over. It is also the launch relay (`GET
  /launch`, `/launch-preview`: a service opened signed in, `launch/`), and
  answers what Moodle's view in the apps may show (`GET /moodle/view`), the
  student's photo (`GET /student-pic`, from ScoDoc) and the school
  certificate (`GET /documents/school-certificate`, and its `/status`).
  The planning is answered here too, with no translator: `GET /timetable`,
  `/timetable/tree` and `/timetable/resources` give the page tonAPI's own
  answers, as tonAPI's server gives them on its `/v1` routes of the same
  names, its refusals as problems (`gateway/planning.rs`). The page makes
  of them what it shows (`src/planningTree.js`, `src/planningEvents.js`).
  The mail is answered here too, every path under `/__ent_auth/mail` in
  any case (`gateway/mail/`): the webmail (Zimbra, RENATER Partage at
  Rennes and Rennes 2) signed in to with the CAS ticket through its SAML
  chain, once per session, by tonAPI (`tonapi_providers::zimbra::webmail`:
  each hop and the final origin held to the webmail's sign-in domains,
  `launch/targets.rs`), then Node's sixteen routes with Node's JSON,
  statuses and error codes, its checks in Node's order (another site, the
  body, the feature, the mail's own limits, `mail/`), the part and the
  upload streamed as they come (`proxy.rs`). A sign-out ends the webmail's
  session too. Checked against a made-up webmail only (`tests/mail.rs`),
  not yet on a real account.
  With Node's `DATA_DIR`, it answers the applications' icons too (`POST
  /app-icons`, `own/icons.rs`), from and into Node's own file; and with
  the page's build (`TAFAC_GATEWAY_DIST`, tafac.fr's server only), the
  page's files, `robots.txt` and Apple's file (`own/statics.rs`), and the
  page itself with its sitemap (`own/page.rs`, `own/shell.rs`): the same
  bytes and the same headers as Node's, its security policy included,
  held to Node's own answers by fixtures and compared with `server.js`
  running on a real build.
  For a session it holds, it answers all of these whatever happens: a
  service down or slow, a parameter to refuse, are said here in the status
  and the words Node's own route has for them (`translate/failed.rs`;
  `gateway/settled.rs` for the launch relay, Moodle's view, the photo and
  the certificate).
- **Tafac's own routes** are no university's (`own/`): which universities
  the server serves and their logos (`own/universities.rs`), from
  `universities/directory.json`, written from the settings Node reads
  (`scripts/universities-directory.mjs`; a test holds the file to them).
  The server tells the gateway what it serves from the same environment
  Node reads (`UNIVERSITY`, `UNIVERSITIES`, `MULTI_UNIVERSITY`); the
  session check of a request without a cookie is then answered here too,
  at the university the request is for. In the apps these stay Node's.
  On tafac.fr it also answers Tafac's own statistics (`POST /analytics`,
  `own/analytics.rs`), signed in or not, and sends them to PostHog itself;
  in the apps that route is still Node's.
- **tafac.fr's own routes** are its server's, whoever asks and whatever
  the session (`own/`): the apps' remote settings (`GET /app/settings.json`
  and its `.sig`, sent as they are) and the desktop app's update (`GET
  /desktop/latest.json`, `/desktop/download/<platform>`, and the newest
  release's manifest followed). The apps ask tafac.fr for them, never their
  bridge: none of it is in the library they embed. Their settings are
  Node's (`APP_SETTINGS_FILE`, `DESKTOP_LATEST_*`), read by `main.rs`.
- **Node** answers everything else: the
  account's photo (the portal's proxy), the icons, the page and its files
  where the gateway isn't given what they need (the apps: their Node keeps
  them), and every route of the other universities, sign-in and
  applications included.
  `routes.rs` lists them with what keeps each there. The moved routes are
  still Node's for the sessions the gateway doesn't hold: nobody signed in,
  another university.
  Rennes 2 and the Sorbonne Nouvelle are answered here like Rennes: see
  « Rennes 2 and the Sorbonne Nouvelle ».
- **The demo account is nobody's here.** The page serves it by itself,
  with no session (`src/demoServer.js`, `src/demoSession.js`): its login
  is never posted, and posted all the same it is a login like any other,
  which the CAS refuses. A session cookie that says `demo` (Node made
  those when it served the demo) is read as nobody signed in, by the
  gateway (`session/cookie.rs`) as by Node.
- **Node is told** when a session ends here (signed out, or found expired:
  `node.rs`), for what it kept of it. The gateway asks it nothing else: a
  sign-in at Rennes is made here, the CAS's second factor included; a
  portal session that lapsed is opened again by tonAPI, with the CAS
  ticket; an error is worded here; and whether the statistics are on
  (`analyticsEnabled`, in the session check) is read from the setting Node
  reads, `POSTHOG_PROJECT_KEY`.

## Where things are

A request goes down this list, top to bottom:

```
crates/tafac-gateway/
├─ Cargo.toml             tonAPI at one commit: the only place it is named
├─ build.rs               puts tonAPI's universities (its settings files) in the crate
└─ src/
   ├─ lib.rs              what the crate is, and its public names
   ├─ routes.rs           THE TABLE: each route of the page, moved or Node's, and why
   │
   ├─ gateway/            a request in, its answer out, or None (Node answers)
   │  ├─ mod.rs           the Gateway: which route, whose session, a route that fails, and a session the university no longer knows
   │  ├─ signin.rs        POST /login and /logout: the session made (tonAPI signs in, one-time code included), and ended
   │  ├─ attempts.rs      the sign-in's limits, the codes sent, and the address a request came from
   │  ├─ portal.rs        routes the portal answers: the session check, the account
   │  ├─ services.rs      routes a service answers: the portal's applications, Moodle's deadlines, ScoDoc's grades
   │  ├─ behind.rs        the home page's three answers: an old one given while the university is asked again, all three asked at the sign-in
   │  ├─ settled.rs       routes answered to their end here, failures included: the two files below
   │  ├─ launch.rs        GET /launch and /launch-preview: the target, who asks, the walk
   │  └─ student.rs       the student's own files: ScoDoc's photo, the school certificate
   │
   ├─ own/                Tafac's own routes, which no university answers
   │  ├─ universities.rs  the universities served, the one a request is for, GET /universities and the logos
   │  ├─ shell.rs         the page itself: index.html filled for each request, and the sitemap
   │  ├─ analytics.rs     POST /analytics: the statistics, the allowlist (analytics/schema.rs), sent on to PostHog (analytics/posthog.rs)
   │  ├─ icons.rs         POST /app-icons: Node's file, the picking of src/appIconPicks.js from icons.json (scripts/gateway-data.mjs writes it)
   │  ├─ js.rs            what JavaScript does to text where Rust does otherwise
   │  │                   tafac.fr's server's alone, answered before the gateway and Node:
   │  ├─ express.rs       what Express does around a route of Node's: the path matched, HEAD, the headers, a redirect
   │  ├─ settings.rs      GET /app/settings.json and its .sig; settings/: the apps' checks of the file (minisign, what it says, what a patch may not do), not called yet
   │  ├─ desktop_update.rs   GET /desktop/latest.json, /desktop/download/*; desktop_update/: the manifest, the releases followed
   │  ├─ statics.rs       the page's built files, robots.txt, Apple's file
   │  ├─ conditional.rs   what Express puts in a file's answer: ETags, dates, a copy still good, a range
   │  └─ page_headers.rs  the page's security headers, for whoever serves the page
   │
   ├─ session/            the student's session
   │  ├─ cookie.rs        its cookie, read and written, in the format Node reads
   │  ├─ handed.rs        what of it tonAPI is handed, and what a new session's cookie is written with
   │  └─ memory.rs        what it holds in this process: services' sessions, component, sessions ended, and the student's answers kept
   │
   ├─ tonapi/             the questions to tonAPI, one file per thing asked
   │  ├─ mod.rs           what they share: patience, a panic caught, why there is no answer
   │  ├─ signin.rs        the CAS: signed in, a code sent and given, signed out, asked whether it still knows a session
   │  ├─ profile.rs       the portal: who the student is
   │  ├─ apps.rs          the portal: the applications it lists
   │  ├─ homework.rs      Moodle: what is due
   │  ├─ grades.rs        ScoDoc: the report, a department's notice, a distribution, the PDF
   │  ├─ picture.rs       ScoDoc: the student's photo
   │  └─ documents.rs     the school records: the documents listed, the file of one
   │
   ├─ launch/             the launch relay, Tafac's own: a service's sign-in walked with the CAS ticket
   │  ├─ targets.rs       which addresses it may ask and send to: the university's services, over https
   │  ├─ site.rs          a request another site started is not the student asking
   │  ├─ walk.rs          the steps: the chain followed for the preview, and for the launch
   │  ├─ moodle.rs        Moodle behind the federation: the chain as far as the form the browser posts
   │  ├─ html.rs, page.rs what a page of a chain says of where to go next; the page that hands a form over
   │  └─ tickets.rs       a service ticket's value never goes to the page
   │
   ├─ translate/          one translator per moved route: tonAPI's answer as the page reads it today
   │  ├─ mod.rs           what they share: the answer's headers, « no answer », « the session is lost »
   │  ├─ signin.rs        POST /__ent_auth/login and /logout
   │  ├─ expired.rs       any route, once the CAS says the session is over
   │  ├─ failed.rs        any route, when it has no answer of its own: Node's errors, worded here
   │  ├─ session.rs       GET /__ent_auth/session
   │  ├─ account.rs       GET /__ent_auth/account
   │  ├─ apps.rs          GET /__ent_auth/apps: tonAPI's own list, as the page reads it
   │  ├─ moodle_deadlines.rs   GET /__ent_auth/moodle/deadlines
   │  ├─ grades/          the grades' routes: ScoDoc's shape written back from tonAPI's report
   │  │  ├─ report.rs        GET /__ent_auth/grades and /grades/semester/<id>
   │  │  ├─ message.rs       GET /__ent_auth/grades/department-message
   │  │  ├─ distribution.rs  GET /__ent_auth/grades/evaluation-distribution
   │  │  └─ transcript.rs    GET /__ent_auth/grades/report.pdf
   │  ├─ settled.rs       what a route answered to its end comes to: its answer, or a session to ask the CAS about
   │  ├─ launch.rs        GET /__ent_auth/launch and /launch-preview
   │  ├─ moodle_view.rs   GET /__ent_auth/moodle/view
   │  ├─ student_pic.rs   GET /__ent_auth/student-pic
   │  └─ school_certificate.rs   GET /__ent_auth/documents/school-certificate and its /status
   │
   ├─ node.rs             Node behind: what it is told, and what the two share (the User-Agent, whether the statistics are on)
   ├─ universities.rs     tonAPI's settings, and where each university's services are
   ├─ portals.rs          what differs from one portal software to another (uPortal, Drupal, iSorbonne)
   │
   ├─ proxy.rs            tafac.fr: the HTTP server in front of Node
   ├─ main.rs             tafac.fr: the binary, and its settings
   │
   ├─ testing/            a made-up campus (portal, CAS, Moodle, ScoDoc, school records, a federation) for the tests, here and in the apps,
   │                      and two more whose portal is not uPortal (other_portals.rs, pages/)
   └─ tests/              the gateway on those campuses, one file per kind of route
```

## The rules

- **One table.** `routes.rs` says which side answers each route, and for
  Node's, what tonAPI lacks. A route not listed is Node's; a test fails when
  Node gains a route the table doesn't have.
- **The session is made here.** tonAPI signs in at the CAS; the gateway
  writes the session's cookie (`session/cookie.rs`) and ends the session
  (signed out, or found expired: only the CAS says a session is over). It
  lives in one encrypted cookie the browser holds, and nowhere else: no
  server keeps sessions. What tonAPI gets from the services while it answers
  (Moodle's session, ScoDoc's, a portal session of its own, the student's
  component) is held in this process with the session's id (`session/memory.rs`), not in the cookie:
  two requests at once would each write it, and it has 4 kB.
- **Node reads the same cookie.** Its format is the one Node reads, with
  the same `SESSION_SECRET`; two fixtures hold both sides to it. Node writes
  it again as it answers its own routes (the portal's cookies it got since):
  the gateway reads it at each request, as it is then. So a session Node
  made (one from before the gateway was there) is one like any other.
- **One User-Agent.** The CAS binds its ticket to the User-Agent that signed
  in. The gateway and Node present themselves under the same one
  (`node.rs`, `server/upstreamAgent`; `tests/upstreamAgent.test.js`).
- **Node's lists are not typed again.** The icons' keywords, concepts,
  hues and each university's look come from `own/icons.json`, which
  `scripts/gateway-data.mjs` writes from `src/appIconPicks.js`; the same
  script writes the fixtures the icons and the page's files are held to
  on both sides (`tests/fixtures/app-icon-picks.json`, `static-files.json`).
  The Node tests fail when one is out of date.
- **The page changes one screen at a time.** A moved route is answered
  here in the JSON and the status the page reads today, which are Node's
  (`translate/`), until its screen reads tonAPI's own model: the
  applications do (`translate/apps.rs`, `src/portalApps.js`), and Node
  gives the same list for the portals it reads itself. A route's errors
  are Node's words too (`translate/failed.rs`): one fixed sentence where
  Node runs in production, the reason on a development server (which the
  session cookie's name tells apart). Each translator lists Node's answers,
  and the ones that are still Node's to give: those of a session the
  gateway doesn't hold.
- **The home page doesn't wait for the university twice.** The
  applications, Moodle's deadlines and the grades' report take the
  university seconds each, and a student asked for them at every sign-in.
  Their answers are kept for the student, not the session
  (`session/memory.rs`): fresh as long as tonAPI says, then old, up to a
  day after they were read. An old one is given at once, marked
  `X-Tafac-Refreshing: 1`, while the university is asked again behind it;
  the page shows it and asks once more with `?fresh=1`, a request that
  waits for the answer that comes (`gateway/behind.rs`, `src/entApi.js`).
  A sign-in asks the three at once, before the page does. They are held
  in this process only, never written, and go when the student signs out.
  What is asked behind an answer ends no session: one the university no
  longer knows takes the old answer away, and the next request finds it.
- **Nothing of tonAPI is copied here.** Its code and its settings come from
  the commit named in `Cargo.toml`.
- **The relay opens the university's services only.** The launch relay
  asks a target with the student's CAS ticket and sends the browser where
  the CAS sends it: only an address of the university's own services, over
  https, is asked or sent to (`launch/targets.rs`: the hosts tonAPI's
  settings name, and Tafac's own list of domains, held to Node's settings
  by a test). A request another site started gets no sign-in, and a service
  ticket's value never goes to the page.

## To move a route

1. Its line in `routes.rs` (from `node(…)` to `moved(…)`).
2. Its question in `tonapi/`: which of tonAPI's providers is asked.
3. Its translator in `translate/`: the page's JSON from tonAPI's answer,
   with each of Node's answers written at the top, its errors and its
   refusals too (`translate/failed.rs` words them).
4. Three lines in `gateway/` (`portal.rs` or `services.rs`).
5. Its tests in `tests/`, on the made-up campus (`testing/`).
6. The answer compared with Node's on a real account.

## Rennes 2 and the Sorbonne Nouvelle

Rennes 2 (`univ-rennes-2`) and the Sorbonne Nouvelle
(`univ-sorbonne-nouvelle`) have their settings and their providers in
tonAPI (a Drupal portal and TEMPO for the first, the iSorbonne portal for
the second), written from this repository's Node code. Both ids are in
`routes::UNIVERSITIES` since 2026-11-26: the gateway answers every moved
route for them, and the launch relay has their own lists
(`launch/targets.rs`). Its tests run on two made-up campuses whose
settings are tonAPI's own files with the addresses changed
(`tests/other_portals.rs`).

What that rests on: a real account signed in at each, in development,
through the page, on a gateway with the id added; the student found the
page working, and the gateway's log (`TAFAC_LOG_REQUESTS=1`) said no route
failed or was refused. The lists below were not gone through one by one:
they stay as what to look at when one of them goes wrong. « Node's
answer » is the same request asked of Node directly, on its own port. Not
tried at all: an account the CAS asks a one-time code of, a session that
lapses, and whether the school certificate (tonAPI's `mon-dossier-web`)
was downloaded. Neither university has grades (`features.grades` is off,
the page doesn't ask): the routes answer 500 here, as for a component
without ScoDoc.

Another university is added the same way: its id in `UNIVERSITIES`, its
lists in `launch/targets.rs` (a test holds them to Node's settings), and
a real account.

What is known to differ from Node, at both:

- the account has no `email`. Neither portal says one; Node reads Rennes
  2's in the webmail (Partage), which hasn't moved. The page shows an empty
  address in « Mon compte » until it does, or until the account is left to
  Node for that university;
- the account has a `sub` (the login), which Node's doesn't; the page
  doesn't read it;
- an application the portal lists twice (two categories) shows once.

### Rennes 2

1. **Sign-in.** `POST /login` is answered here (`x-tafac-answered-by:
   tonapi`) with `user` the login in lower case. tonAPI goes from the
   portal's root to the CAS and back through `/casservice`; the session
   cookie holds the CAS's `TGC` and the portal's session cookie. A wrong
   password is refused in the CAS's own words. An account the CAS asks a
   one-time code of: Node refuses those today (no `auth.mfa` in its
   settings); see what the gateway does with one.
2. **Services with that session.** The mail and the planning (TEMPO's)
   are the gateway's own (`gateway/mail/`, `gateway/planning.rs`), signed
   in to with the cookie's CAS ticket: Rennes 2's CAS binds its ticket to
   the User-Agent that signed in. The launch relay is
   the gateway's, for the services under `univ-rennes2.fr`.
3. **Session check.** `GET /session` is answered here from one request to
   the portal's `/user` page, with the cookie's own portal cookies (the log
   says nothing was left to Node). Then again once the portal's session has
   lapsed: the gateway opens one with the ticket, the page sees nothing and
   the cookie isn't written. Whether Drupal writes its session cookie anew
   at each request isn't known; if it does, every check goes that second
   way, which works, with a portal session of the gateway's own.
4. **Account.** `name`, `given_name` and `family_name` are Node's answer's;
   `email` is missing (above).
5. **Applications.** `GET /apps` gives the list Node's answer gives for the
   same account: the same ids (`portal-tool-…`), in the same order, with
   the same titles, descriptions, addresses and categories. The page's
   favourites and its order stay as they were.
6. **Moodle's deadlines.** Cursus signs in through its own CAS login with
   the ticket; the items are Node's.
7. **Sign-out.** `POST /logout` ends the CAS's session (`/logout`): the
   university's own sign-in page asks for the password again.
8. **A session that is over.** While the CAS knows the ticket, its `/login`
   without a service shows its « signed in » page; once it doesn't (its
   own lifetime), it shows its form, and the next route asked answers
   `session_expired` and clears the cookie.

### Sorbonne Nouvelle

Node's own settings still list it in development only (`devOnly`, « until
a real sign-in is checked »): the first account there checks Node's side
too.

1. **Sign-in.** As at Rennes 2, from the portal's page
   `/ENT/secure/index.xhtml` and with the CAS under `/cas/`; the cookie
   holds the `TGC` and iSorbonne's session cookie.
2. **The planning.** ADE 6.12 has no provider in tonAPI: the planning's
   routes answer tonAPI's `service_absent`, and the page says there is no
   timetable there (Node's own reader, `planningRpc.js`, is no longer
   asked). The launch relay
   is the gateway's, for the services under `sorbonne-nouvelle.fr` and
   `univ-paris3.fr`.
3. **Session check.** One request to the portal's page with the cookie's
   own portal cookies; then, the portal's session lapsed, one the gateway
   opens with the ticket.
4. **Account.** The name is read from the logout link, family name first:
   `given_name` is its last word, as Node's.
5. **Applications.** The list Node's answer gives: ids `portal-tool-<n>`,
   the categories in the order of the portal's buttons, descriptions cut
   at 160 characters.
6. **Moodle's deadlines.** iCampus (`icampus.univ-paris3.fr`) signs in
   through its own CAS login with the ticket.
7. **Sign-out.** `POST /logout` ends the CAS's session (`/cas/logout`).
8. **A session that is over.** The gateway asks `/cas/login`; Node asks
   `/login` on the same host, without `/cas`. Check that `/cas/login` shows
   the « signed in » page while the ticket lives and the form once it
   doesn't.

The timetables are tonAPI's at Rennes (ADE's portal) and Rennes 2 (TEMPO,
tried on a real account on 27/11/2026). The Sorbonne Nouvelle's ADE 6.12
has no provider in tonAPI (tonAPI's `docs/recherche/sorbonne-nouvelle.md`).
Node's `/__ent_auth/planning` and `/__ent_auth/ade/*` are no longer asked
by the page.

## To see it work

In front of the development server, with the page saying who answered what:

```sh
export SESSION_SECRET="$(openssl rand -hex 32)"
npm run dev -- --port 5173 --strictPort                       # the page and Node
cd back && TAFAC_GATEWAY_DEV=1 TAFAC_GATEWAY_NODE=127.0.0.1:5173 \
  TAFAC_LOG_REQUESTS=1 cargo run -p tafac-gateway             # the gateway, on :3100
```

Open http://127.0.0.1:3100 and sign in there: the gateway makes the session.
In development the page outlines each widget and page by who answered its
route (orange: the gateway, through tonAPI; green: Node) and lists every
route asked, with its time (`src/dev/BackendMarks.jsx`). The gateway's own
log says each moved route that failed, and why; the page gets the reason
too, as from the development server. The statistics are off there, as the
development server's are, unless the gateway is started with
`POSTHOG_IN_DEV=1` and `POSTHOG_PROJECT_KEY` as that server is (the gateway
reads its environment only, not `.env.local`; `POSTHOG_HOST` and
`ANALYTICS_EXCLUDED_USERS` too, which it then sends with).
