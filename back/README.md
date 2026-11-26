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
                   │                            (CAS, portal, Moodle, ScoDoc)
                   └──▶ Node ──────────────────▶ the university
                        the routes that haven't moved,    (planning, mail,
                        with the session made above        documents)
```

- **The gateway** answers `POST /login`, `POST /logout`, `GET /session`,
  `GET /account`, the portal's applications (`GET /apps`), the Moodle
  deadlines and the five grades routes, for the universities of `routes.rs`
  (today: Rennes). It makes the session at the
  sign-in and says when it is over.
- **Node** answers everything else: the launch relay, the planning and
  ADE, the mail, the documents, the icons, the statistics, the account's
  photo (the portal's proxy), and every route of the other universities,
  sign-in and applications included. `routes.rs` lists them with what
  keeps each there.
- **The demo account is nobody's here.** The page serves it by itself,
  with no session (`src/demoServer.js`, `src/demoSession.js`): its login
  is never posted, and posted all the same it is a login like any other,
  which the CAS refuses. A session cookie that says `demo` (Node made
  those when it served the demo) is read as nobody signed in, by the
  gateway (`session/cookie.rs`) as by Node.
- **Node is also asked** for the wording of a service's error (a moved
  route that fails goes to Node's own route), and for what it is set up for
  (`node.rs`). A sign-in at Rennes asks Node nothing, the CAS's second
  factor included; nor does a portal session that lapsed, which tonAPI
  opens again with the CAS ticket.

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
   │  ├─ mod.rs           the Gateway: which route, whose session, and a session the university no longer knows
   │  ├─ signin.rs        POST /login and /logout: the session made (tonAPI signs in, one-time code included), and ended
   │  ├─ attempts.rs      the sign-in's limits, the codes sent, and the address a request came from
   │  ├─ portal.rs        routes the portal answers: the session check, the account
   │  └─ services.rs      routes a service answers: the portal's applications, Moodle's deadlines, ScoDoc's grades
   │
   ├─ session/            the student's session
   │  ├─ cookie.rs        its cookie, read and written, in the format Node reads
   │  ├─ handed.rs        what of it tonAPI is handed, and what a new session's cookie is written with
   │  └─ memory.rs        what it holds in this process: services' sessions, component, answers kept, sessions ended
   │
   ├─ tonapi/             the questions to tonAPI, one file per thing asked
   │  ├─ mod.rs           what they share: patience, a panic caught, why there is no answer
   │  ├─ signin.rs        the CAS: signed in, a code sent and given, signed out, asked whether it still knows a session
   │  ├─ profile.rs       the portal: who the student is
   │  ├─ apps.rs          the portal: the applications it lists
   │  ├─ homework.rs      Moodle: what is due
   │  └─ grades.rs        ScoDoc: the report, a department's notice, a distribution, the PDF
   │
   ├─ translate/          one translator per moved route: tonAPI's answer as the page reads it today
   │  ├─ mod.rs           what they share: the answer's headers, « Node answers », « the session is lost »
   │  ├─ signin.rs        POST /__ent_auth/login and /logout
   │  ├─ expired.rs       any route, once the CAS says the session is over
   │  ├─ session.rs       GET /__ent_auth/session
   │  ├─ account.rs       GET /__ent_auth/account
   │  ├─ apps.rs          GET /__ent_auth/apps: tonAPI's own list, as the page reads it
   │  ├─ moodle_deadlines.rs   GET /__ent_auth/moodle/deadlines
   │  └─ grades/          the grades' routes: ScoDoc's shape written back from tonAPI's report
   │     ├─ report.rs        GET /__ent_auth/grades and /grades/semester/<id>
   │     ├─ message.rs       GET /__ent_auth/grades/department-message
   │     ├─ distribution.rs  GET /__ent_auth/grades/evaluation-distribution
   │     └─ transcript.rs    GET /__ent_auth/grades/report.pdf
   │
   ├─ node.rs             Node behind: what it is asked and told, and the User-Agent the two share
   ├─ universities.rs     tonAPI's settings, and where each university's services are
   │
   ├─ proxy.rs            tafac.fr: the HTTP server in front of Node
   ├─ main.rs             tafac.fr: the binary, and its settings
   │
   ├─ testing/            a made-up campus (portal, CAS, Moodle, ScoDoc) for the tests, here and in the apps
   └─ tests/              the gateway on that campus, one file per kind of route
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
- **The page changes one screen at a time.** A moved route is answered
  here in the JSON and the status the page reads today, which are Node's
  (`translate/`), until its screen reads tonAPI's own model: the
  applications do (`translate/apps.rs`, `src/portalApps.js`), and Node
  gives the same list for the portals it reads itself. Where the answer
  is one only Node gives, the request goes to
  Node as it came: each translator lists the cases.
- **Nothing of tonAPI is copied here.** Its code and its settings come from
  the commit named in `Cargo.toml`.

## To move a route

1. Its line in `routes.rs` (from `node(…)` to `moved(…)`).
2. Its question in `tonapi/`: which of tonAPI's providers is asked.
3. Its translator in `translate/`: the page's JSON from tonAPI's answer,
   with the cases that stay Node's written at the top.
4. Three lines in `gateway/` (`portal.rs` or `services.rs`).
5. Its tests in `tests/`, on the made-up campus (`testing/`).
6. The answer compared with Node's on a real account.

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
log says each request it left to Node, and why.
