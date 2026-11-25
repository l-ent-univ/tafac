# back

Tafac's backend in Rust, as it moves off the Node server (`server.js`,
`server/`) a route at a time, onto
[tonAPI](https://github.com/l-ent-univ/tonAPI).

One Cargo workspace; each crate under `crates/`. Today there is one,
`tafac-gateway`: the routes tonAPI answers in Node's place. The apps call it
in-process from their bridge (`src-tauri/src/bridge.rs`); on tafac.fr it is
a small server in front of Node. How it fits with the rest:
`docs/DESKTOP.md`, « tonAPI ».

```sh
cd back
cargo test                                   # every crate
cargo build --release -p tafac-gateway       # tafac.fr's server
```

tonAPI's repository is private for now: Cargo fetches it with git
(`.cargo/config.toml`, at the repository's root), so a build needs read
access to it.

## Where things are

A request goes down this list, top to bottom:

```
crates/tafac-gateway/
├─ Cargo.toml             tonAPI at one commit: the only place it is named
├─ build.rs               puts tonAPI's universities (its settings files) in the crate
└─ src/
   ├─ lib.rs              what the crate is, and its public names
   ├─ routes.rs           THE TABLE: each route of the page, tonAPI's or Node's, and why
   │
   ├─ gateway/            a request in, Node's own answer out, or None (Node answers)
   │  ├─ mod.rs           the Gateway: who is signed in, which route, is the answer still theirs
   │  ├─ portal.rs        routes the portal answers: the session check, the account
   │  └─ services.rs      routes another service answers: Moodle's deadlines
   │
   ├─ session/            the student's session
   │  ├─ cookie.rs        Node's session cookie, read (Node alone writes it)
   │  ├─ handed.rs        what of it tonAPI is handed: the portal's cookies, or the CAS ticket
   │  └─ memory.rs        what is remembered between two questions, in memory only
   │
   ├─ tonapi/             the questions to tonAPI, one file per thing asked
   │  ├─ mod.rs           what they share: patience, a panic caught, why there is no answer
   │  ├─ profile.rs       the portal: who the student is
   │  └─ homework.rs      Moodle: what is due
   │
   ├─ translate/          one translator per moved route: tonAPI's answer as Node gives it
   │  ├─ mod.rs           what they share: the answer's headers, « Node answers »
   │  ├─ session.rs       GET /__ent_auth/session
   │  ├─ account.rs       GET /__ent_auth/account
   │  └─ moodle_deadlines.rs   GET /__ent_auth/moodle/deadlines
   │
   ├─ node.rs             Node seen from here: what it says of itself, the sessions it ended
   ├─ universities.rs     tonAPI's settings, and where each university's services are
   │
   ├─ proxy.rs            tafac.fr: the HTTP server in front of Node
   ├─ main.rs             tafac.fr: the binary, and its settings
   │
   ├─ testing/            a made-up campus (portal, CAS, Moodle) for the tests, here and in the apps
   └─ tests/              the gateway on that campus, one file per kind of route
```

## The rules

- **One table.** `routes.rs` says which side answers each route, and for
  Node's, what tonAPI lacks. A route not listed is Node's; a test fails when
  Node gains a route the table doesn't have.
- **Node's own answer, or none.** A moved route is answered here only when
  the answer is the one Node would give, field for field. Anything else (no
  session, the demo account, another university, an error, an expired
  session, a slow university) goes to Node as it came. Each translator
  lists the cases.
- **One session: Node's.** Its cookie is read, never written. What a
  question to tonAPI is handed, and why, is in `session/handed.rs`; what is
  remembered between two questions is in `session/memory.rs`, in this
  process only.
- **Nothing of tonAPI is copied here.** Its code and its settings come from
  the commit named in `Cargo.toml`.

## To move a route

1. Its line in `routes.rs` (from `node(…)` to `moved(…)`).
2. Its question in `tonapi/`: which of tonAPI's providers is asked.
3. Its translator in `translate/`: Node's JSON from tonAPI's answer, with
   the cases that stay Node's written at the top.
4. Three lines in `gateway/` (`portal.rs` or `services.rs`).
5. Its tests in `tests/`, on the made-up campus (`testing/`).
6. The answer compared with Node's on a real account.
