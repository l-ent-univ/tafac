# Desktop app (Tauri)

The desktop app is the same app as tafac.fr, but the server runs on the
student's computer. The login and every request to the university go from
that computer straight to the university: credentials never pass through
tafac.fr.

The iOS app is the same code built for a phone, with Node inside the app:
`docs/IOS.md`.

## How it fits together

```
window (tafac://localhost/)          src-tauri/src/main.rs
   │  every request: page, /__ent_auth, /__ent_proxy
   ▼
bridge (Rust)                        src-tauri/src/bridge.rs
   │  holds the session cookie (jar.rs): WebKit doesn't keep cookies
   │  from a custom scheme, and the page never sees it
   ├─ the gateway, in the app itself     back/crates/tafac-gateway
   │    signs in, holds the session, answers what moved to tonAPI
   ▼  Unix socket (named pipe on Windows), no TCP port
server.js, unchanged                 desktop/sidecar.mjs
   │  PORT = the socket path, SESSION_SECRET made once per install
   ▼
the university (CAS, ADE, webmail…)
```

- **The page's built files** (`/assets/…`) are asked of the server once and
  answered from memory after that (`src-tauri/src/assets.rs`), whole or in
  part. WebKit keeps nothing from the app's scheme, and reads a video a few
  bytes at a time: the home page's animated icons alone were some sixty
  requests a second to the server.
- **Links** (`src-tauri/src/links.rs`): web addresses open in the browser.
  An app address opened in a new tab (the launch relay) opens where its
  redirect points. A new tab on Moodle (a deadline, Moodle's tile, a link
  in a mail) opens in the app's « Moodle » (below). Downloads go to the
  Downloads folder. The window itself only loads the app's pages: any other
  address (`file://`, another program's scheme) is refused.
- **Data** (macOS: `~/Library/Application Support/fr.tafac.desktop/`, closed
  to other accounts): `cookies.json` (the encrypted session cookie) and
  `server/`, the remembered app icons (`DATA_DIR`). The secret that
  encrypts the cookie is not kept beside it: a packaged app puts it in the
  system's credential store (macOS Keychain, Windows Credential Manager,
  the Secret Service on Linux; `src-tauri/src/secret.rs`). Where there is
  no store, or it refuses, and in development builds, it is the
  `session-secret` file of that folder, readable by the student's account
  only.
- **The login**: the student's login and password are kept in the same
  credential store to stay signed in (below, `src-tauri/src/signin.rs`),
  never in a file.
- **Socket**: in a folder only the student's account can enter
  (`$XDG_RUNTIME_DIR`, else the data folder), never the shared `/tmp`
  (`src-tauri/src/sidecar.rs`).
- The server stops with the app: its stdin is a pipe from the app, and when
  the pipe closes the server exits, even if the app crashed.

## tonAPI

The server is moving from Node to
[tonAPI](https://github.com/l-ent-univ/tonAPI) (Rust: one provider per
software, one settings file per university). The Rust side is in charge:
it signs the student in, holds the session and answers the routes that
have moved; Node is behind it for the ones that haven't. One crate does it
for every place Tafac runs: `back/crates/tafac-gateway`. `back/` is the
Rust backend's root (a Cargo workspace, `back/README.md`); the apps use
its crates by path.

```
the page: /__ent_auth/*, /__ent_proxy/*      unchanged, the only contract
   ▼
the gateway (Rust)                           back/crates/tafac-gateway
   │  routes.rs      the one table: each route, moved or Node's
   │  gateway/       the sign-in and the sign-out, whose session a request
   │                 is, the route's question, a session that is over
   │  session/       the session's cookie read and written, what tonAPI is
   │                 handed, what the session holds in this process
   │  tonapi/        the questions to tonAPI, one file per thing asked
   │  translate/     tonAPI's answer as the page reads it today
   │  node.rs        what Node is asked and told
   ├─ login, logout, session, account, deadlines, grades ──▶ tonAPI ──▶ the university
   ▼  everything else, as it came, with the session's cookie
Node (server.js)                             ──▶ the university
```

- **In the apps** the bridge calls the gateway in the app's own process
  before it asks Node (`bridge.rs`), on the desktop and on iOS alike.
- **On tafac.fr** the same crate is a small server in front of Node
  (`cargo build --release -p tafac-gateway` in `back/`, `src/main.rs`): it
  answers what the gateway answers and passes every other request on as it
  came (headers, cookies, bodies as they stream, redirects, WebSocket). Not
  deployed.
- **For the Université de Rennes only** (`routes.rs`: `UNIVERSITIES`).
  Every other university is Node's as before, sign-in included.

What the gateway does, for Rennes:

- **Signs in** (`gateway/signin.rs`). `POST /__ent_auth/login` is answered
  by tonAPI's own sign-in: the CAS's form, the password posted once, the
  way back to the portal, the student's component. The answers are the
  ones the page and `signin.rs` know: `200`, `401` with `code:
  'login_refused'` when the CAS refuses, `429` with `Retry-After` past the
  limits (Node's numbers: 8 failures per login, 30 per address, in 15
  minutes).
- **Takes the second factor** (Esup OTP). When the CAS answers the password
  with its code page, tonAPI reads it and asks the university's API what
  the student can type a code from: the answer is Node's `401` with `code:
  'mfa_required'` and `mfa: { methods, sent }`. The student's only way to a
  code (no application, one of SMS and mail) is sent unasked, as the
  university's own page sends it, except for a sign-in the student doesn't
  see (`quiet`); `sendCode` has one sent by SMS or mail; `otp` is posted to
  the CAS after the password. Five codes per login in 15 minutes, as Node
  counts them (`mfa_send_limit`). Nothing is kept between the page's
  requests: each posts the password again, and the code the university sent
  stays good for the next.
- **Makes the session** (`session/cookie.rs`): one encrypted cookie, the
  same as before, in the format Node reads, with the same
  `SESSION_SECRET`. It holds the CAS ticket and the portal's cookies:
  nothing else is kept anywhere, and no server stores sessions. Node reads
  it for its own routes and writes it again as it answers them. Two
  fixtures hold both sides to the format
  (`tests/fixtures/session-cookie-v1.json`,
  `session-cookie-gateway-v1.json`).
- **Holds, in its own memory** (`session/memory.rs`), what tonAPI gets from
  the services while it answers: each service's session (an hour unused),
  the student's component, the profile (half a minute), and each answer for
  as long as tonAPI says it may be given again (the deadlines: five
  minutes, as Node caches them). It goes with the session and is found
  again after a restart, with the ticket.
- **Answers** `GET /__ent_auth/session`, `GET /__ent_auth/account`, `GET
  /__ent_auth/moodle/deadlines` and the five grades routes
  (`/__ent_auth/grades`, `/grades/semester/<id>`,
  `/grades/department-message`, `/grades/evaluation-distribution`,
  `/grades/report.pdf`), in the JSON the page reads today (`translate/`).
- **Lists the portal's applications** (`GET /__ent_auth/apps`,
  `gateway/services.rs`). tonAPI reads uPortal's layout into one list
  (`{ id, title, description, url, iconUrl, category, favorite }`), with
  the address each tile really opens (the portal says it tile by tile;
  tonAPI keeps the addresses six hours, for everyone). The page reads that
  list as it is (`src/portalApps.js`): it no longer reads a portal's
  layout, nor asks for a tile's fragment. The list is kept an hour for a
  session. The favourites stay in the browser, started once from the ones
  the student starred on the portal.
- **Keeps a portal session of its own.** The applications are asked with
  the CAS ticket: tonAPI opens a portal session, held with the services'
  (`session/memory.rs`), and opens it again by itself when the portal
  forgot it. The session check does the same once the portal session of
  the session's cookie lapsed (`gateway/portal.rs`): Node isn't asked to
  sign in to the portal again, and the session's cookie isn't written.
- **Says when the session is over** (`gateway/mod.rs`). When tonAPI says
  the university no longer knows the session, the gateway asks the CAS with
  the ticket: if the CAS wants the password again, the session ends here,
  with the answers the page and the apps act on (`401 { error:
  'session_expired' }`, `X-Tafac-Session: expired`, the cookie taken away;
  `expired: true` on the session check), and Node is told.
- **Signs out**: `POST /__ent_auth/logout` ends the session here, tells the
  CAS (tonAPI), and tells Node, for what Node kept of it (the webmail's
  session).
- **One User-Agent** for the whole of Tafac. The CAS binds its ticket to
  the User-Agent that signed in and deletes it when another shows it. The
  gateway and Node present themselves under the same name, the one Node
  always had (`node`): the gateway's `node.rs`, Node's
  `server/upstreamAgent`, held together by `tests/upstreamAgent.test.js`.
  So a session one of them made is used by the other.

What is still Node's, and why:

- **Every route that hasn't moved** (`routes.rs` says what tonAPI lacks for
  each): the launch relay, the planning and ADE, the mail, the documents,
  the icons, the statistics, and the portal's proxy for what is left of it
  (the account's photo, an old link to a page of the portal's).
- **A moved route's errors.** When tonAPI can't give the page's answer (a
  service down or slow, a parameter to refuse, nobody signed in), the
  request goes to Node's own route, which words it. Each translator lists
  the cases.

Neither's: **the demo account**. The page serves it by itself
(`src/demoServer.js`), with no session: its login is checked in the page
and posted nowhere, so the bridge never sees it, and its sign-in is kept
in the window's own storage (`src/demoSession.js`). The page signs out of
the server as the demo starts, which forgets a login kept (below).
- **What Node is set up for** (`analyticsEnabled`, in the session check's
  answer): read from Node now and then.

- **To move a route**: its line in `routes.rs`, its question in `tonapi/`,
  a translator in `translate/`, three lines in `gateway/`, and the answer
  compared with Node's on a real account.
- `TAFAC_LOG_REQUESTS=1` logs the page's requests in a debug build of the
  app, with `tonapi` after the ones the gateway answered; `TAFAC_NO_TONAPI=1`
  leaves every route to Node, sign-in included.

The grades come from tonAPI's own report, written back in ScoDoc's shape
for the page: on a real account every field the page reads is Node's, value
for value, but five: the list of departments allowed to see absences (one
switch says the same), the description of three evaluations of a past
semester (why isn't known yet) and the date of a jury's decision (the day
without the hour). `translate/grades/report.rs` lists them. In development
the page shows who answered each route
(`back/README.md`, « To see it work »).

On a real Rennes account, the gateway's server (a debug build, on a Mac) in
front of the development server, each asked a few times:

| | the gateway | Node |
|---|---|---|
| sign-in | 2.5 to 3.3 s | 1.8 to 1.9 s |
| session check | 40 to 100 ms | 320 to 760 ms |
| account | 1 to 4 ms | 40 ms |
| deadlines, the first time | 4.3 to 5 s | 3.7 to 4.5 s |
| grades, the first time | 1 s | 0.5 s |
| sign-out | 0.1 s | 0.15 s |

The sign-in takes a second more than Node's: tonAPI looks for the student's
component there, which the first grades used to wait for (3 s, and still do
for a session Node made). With the session the gateway made, Node's own
routes answered as with its own (the portal's applications, the planning,
ADE, the mail, the photo, the school certificate), and the answers of the
moved routes were the ones of a session Node made, field for field, where
they were before. A session over at the CAS was said so by the gateway; a
portal session lost while the CAS still knew the ticket was not; and the
gateway's sign-out ended the CAS's session. Not run on a real account: the
sign-in's refusals and limits (a wrong password is not tried on a real
account), and the page itself in a browser or in the apps (the requests
were a script's).

The second factor was run on a real account of Rennes on 26 November 2026,
one whose only way to a code is the mail: the code left unasked, then asked
for; the code typed signed in; and the session made answered the gateway's
routes (session check, account, deadlines, grades) and Node's (the portal's
layout, ADE's status, the mail's folders). A wrong code, an authenticator
application, a code by SMS and the notification were not run through the
gateway.

The applications were run on the same account the same day: the gateway's
list held the 31 applications and the 5 favourites the page read until
then from the portal's layout, each with the address its tile's fragment
gives; 2 to 3 s the first time (a portal session opened, 31 fragments
read), 3 ms once kept.

## Staying signed in

The student signs in once. The university's session dies on its own (the
Rennes CAS ends it 30 to 47 minutes after the login, whatever the student
does): the app signs in again by itself, and the login page only comes back
after « Se déconnecter » (`src-tauri/src/signin.rs`, used by `bridge.rs`).

- **Kept**: after a login of the page's that went through (`POST
  /__ent_auth/login`, 200), the bridge keeps its login, password and
  university (`university` of the body, else the `X-Tafac-University`
  header). Not a login that needed a one-time code: only the student can
  type that one, so it would never sign in alone. Any login that goes
  through replaces what was kept. The demo account's login never reaches
  the bridge (the page signs in to the demo by itself); the sign-out the
  page sends as the demo starts forgets what was kept, as the student's
  own does.
- **Where**: a packaged app keeps it in the system's credential store (macOS
  Keychain: service `fr.tafac.desktop`, account `sign-in`), read once per
  launch. A debug build keeps it in memory only, for the run (no file, and no
  keychain: an unsigned build would have macOS ask for it at each rebuild):
  after a restart, `npm run desktop:dev` asks for the password again. A store
  that refuses it leaves it in memory for the run.
- **Signed in again**: an answer with `X-Tafac-Session: expired` (the
  gateway's, when it finds the session over; the server's,
  `server/sessionExpiry/`), on any request of the window or of Moodle's view,
  makes the bridge sign in with the kept login (`quiet: true`: the server
  sends no one-time code unasked), then ask the request again: the page and
  Moodle's view get the second answer and never see the expiry. The sign-in
  goes the way the page's own does: the gateway makes it (tonAPI), in the
  app. One sign-in at a time: the requests that come back expired meanwhile
  wait for it and are asked again after. Moodle's view stays open; the
  launch relay it asks signs in to Moodle with the new session. An answer
  that takes the session's cookie away is about the session its request
  left with: when the app has signed in again by then, the new cookie stays
  (`bridge.rs`: `keep_cookies`).
- **At launch**: the page's first questions answer signed out
  (`/__ent_auth/universities` without a session, `/__ent_auth/session`
  `authenticated: false`): the bridge signs in first, so the page boots on
  the student's university, signed in, without the login page.
- **When it can't**: the answer goes to the page as it is, which signs out to
  its login form with its note, as on the web.
  - the university refuses the login (`code: 'login_refused'`: the CAS
    answered the form itself, a wrong or changed password, a locked
    account; `server/casLogin/refusal.ts`) or asks for a code (`mfa_*`): the
    kept login is forgotten;
  - anything else (no network, the CAS down or answering 5xx or 429, the
    local server down): kept. Nothing is tried again for 30 seconds; after,
    the next expired answer, or the next launch, tries again.
- **Forgotten** on the student's own sign-out (`POST /__ent_auth/logout`). The
  page's sign-out after an expiry the app couldn't get past says so
  (`X-Tafac-Logout: expired`, `logoutFromEnt({ expired: true })` in
  `src/entApi.js`) and keeps it. The bridge waits for a sign-in under way
  before the sign-out goes, so none signs the student in again behind it.
- **The password** goes from the bridge to the gateway in the app's own
  process, and from there to the university's CAS (tonAPI), as when the
  student types it; for an account with a second factor, and for a
  university the gateway doesn't sign in at, to the local server's login
  route, and from there to the CAS. It is never logged (the app's log says
  `[tafac] sign-in: kept`, `signed in again`, `refused by the university,
  forgotten`…).
- **The login page** keeps the site's wording (« Ne transite pas sur le
  serveur de Tafac », the university's `loginPasswordNote`): nothing on it
  mentions the Keychain.

## The window

- **macOS, the system's sidebar** (`src-tauri/src/window.rs`): the window
  is see-through over the sidebar material Finder and Notes use (an
  NSVisualEffectView, greyed when the window isn't active). The sidebar is
  flush with the window's edges and lets it show; the rest of the page is
  opaque (`src/overrides.css`, on `<html data-desktop-macos>`,
  `src/desktopApp.js`). The material is light or dark as the window is, and
  the page sets the window's theme to the app's (`src/desktopWindowTheme.js`:
  Clair or Sombre forces it, Automatique leaves it to the system). It needs
  `macOSPrivateApi` (tauri.conf.json): fine for Developer ID, not for the
  Mac App Store. Liquid Glass is a one-line change there
  (`Effect::LiquidGlassRegular`), darker over a dark desktop.
- **The right panels** (mail reader, « Salles et personnels ») are flush
  with the window's right edge in their own solid colour, a hairline on
  their left; the sidebar unfolding on hover sits on the material. The
  mail composer full screen starts below the window's buttons.
- **No title bar**: the page runs up to the window's top edge, the window's
  buttons sit in the sidebar's top corner, the sidebar's content below
  them. Folded, the sidebar is 84px wide instead of 72 to hold them
  (`src/sidebarWidth.js`). The window is no narrower than 1024px, the
  sidebar's layout: the phone's has no sidebar.
- **Moving it**: the sidebar is a Tauri drag region
  (`data-tauri-drag-region`), and the band along the top (52px) moves the
  window except on what's clickable there (`src/desktopWindowDrag.js`). A
  double click zooms it. Both call Tauri's IPC, which
  `src-tauri/capabilities/default.json` limits to those two commands and
  the window's theme.
- **Like an app** (`<html data-desktop-app>`, `src/overrides.css`): the
  arrow over buttons, no rubber band, links and pictures can't be dragged
  out. Elsewhere than on macOS, windows open in the app's background colour
  (no white flash). The main one comes back at its size and place (`tauri-plugin-window-state`).
- **Menu bar** (macOS, `src-tauri/src/menu.rs`), in French: Tafac (À
  propos, Rechercher les mises à jour…, Réglages… ⌘,), Fichier (Nouveau
  message ⌘N, Fermer la fenêtre
  ⌘W, Imprimer… ⌘P), Édition (+ Rechercher ⌘F), Présentation (Actualiser
  ⌘R), Aller (the university's pages, ⌘1…, the one in view ticked),
  Fenêtre. Where Moodle is a page, Aller starts with Précédent (⌘[) and
  Suivant (⌘]), Moodle's own history, and Imprimer… there prints Moodle's
  page. Commands reach the page as `tafac:command` events; the page
  sends what it has (`POST /__desktop/menu`, `src/desktopMenu.js`) and the
  menu greys what doesn't apply. `src-tauri/Info.plist` sets the app's
  language to French, so what macOS adds (Outils d'écriture, Dictée…) is
  French too.
- **Closing isn't quitting** (macOS): the main window hides, the app and
  its server keep running, a click on the Dock icon shows it again; ⌘Q
  quits.
- **Printing** (⌘P): the page in view without the app around it, a mail
  open in the reader alone (`@media print` in `src/overrides.css`).
- **Spelling** is checked as you type (WebKit's
  `WebContinuousSpellCheckingEnabled`, set once in the app's defaults).

## Moodle

Where the university has Moodle (`features.moodle`), « Moodle » is a page of
the app: Moodle itself, signed in, beside the sidebar. In the browser it
stays a link (`src/navItems.js`).

- **A web view of its own**, not an iframe (Moodle refuses to be framed):
  `src-tauri/src/moodle.rs` lays it over the page's slot
  (`src/components/MoodlePage.jsx`, `src/desktopMoodle.js`), through
  `/__desktop/moodle/*` (`desktop.rs`). It is native, so above everything
  the page draws: the page hides it while a sheet, a menu or a note is over
  the slot, and shows it again after. It is made hidden and only shown once
  Moodle's page is there: the slot shows the app's own wait until then.
- **Signing in** goes through the launch relay (`/__ent_auth/launch`): the
  server signs in to Moodle with the student's session (a CAS ticket, or for
  a Moodle behind Shibboleth a page that posts the sign-in, loaded as a
  `data:` address: Tauri's `webview-data-url`). When Moodle's own session
  runs out, the relay is asked again and the student lands on the page they
  asked for. When the server finds the student's session expired (the CAS
  says so: its `X-Tafac-Session: expired` header on the relay's answer,
  `server/sessionExpiry/`), the bridge signs in again with the kept login
  and asks the relay again (Staying signed in); only when it can't does the
  app sign out to its login form, as the site does. When the server couldn't sign in for another reason, or Moodle
  doesn't answer, the slot says « Moodle indisponible » with « Réessayer ».
  Coming back to the page tries again.
- **What it may load** comes from the server, not from the page:
  `GET /__ent_auth/moodle/view` (`server/moodleView/policy.ts`) gives Moodle's
  dashboard and the university's own hosts, as the launch relay knows them
  (Moodle, the CAS, the sign-in chain, `launch.allowedDomains`). The view's
  page only loads those; any other web address opens in the browser, and
  anything else (the app's own scheme, `file://`) is refused. Frames inside
  a page (an embedded video) load as in a browser: on macOS the view's
  navigation delegate is wrapped for that (`src-tauri/src/moodle_native.rs`),
  as Tauri's rule is asked for every frame with the address alone.
- **Apart from the app**: the view's requests to the app's scheme are
  refused (`main.rs`), so nothing in a course page can ask the local server
  anything with the student's session. Its cookies live in memory only, and
  the view is closed when the student signs out or signs in (`main.rs`, on
  `/__ent_auth/logout` and `/login`): the next student starts from nothing.
- **Toolbar**, in the window's top band: Précédent, Suivant, Recharger (or
  Arrêter while a page loads), Moodle's dashboard, the page's title,
  Télécharger when a file is in view (a PDF, a picture), Ouvrir dans le
  navigateur. The view says what it shows through `POST
  /__desktop/moodle/state`, which waits for a change.
- **Tafac's look** (`src-tauri/src/moodle_style.rs`): Moodle's own pages
  take the app's colours, faces (Collab Sans, SN Pro for headings), corners
  and pill buttons, in light and dark and with the student's palette. The
  view's script (`moodle_style.js`, run by WebKit before each page's own, in
  the top frame only) adds `moodle_style.css` (and `moodle_style_dark.css`
  in the dark theme) as constructed style sheets, and the fonts as bytes
  (`FontFace`): a page's Content-Security-Policy governs neither, so no
  inline style is needed. The colours are the app's page's own, resolved
  (`readMoodleTheme`, `src/desktopMoodle.js`), sent with `open` and on each
  change (`POST /__desktop/moodle/theme`); the open page takes a change at
  once, without a reload. The surface only, on Moodle's own class names
  (Boost, Bootstrap 4 and 5): a Moodle update can at worst lose some of it.
  One change of measure: the narrow reading column (`limitedwidth`, the
  dashboard and the courses) is as wide as Moodle's wider setting. Hidden:
  the university's logo in Moodle's bar (the sidebar shows it, the toolbar's
  house goes to the dashboard). Left alone: the sign-in pages (another host,
  or Moodle's `/login/`), frames from other sites, files Moodle serves as
  they are (`pluginfile.php`). In the dark theme, what a teacher wrote with
  colours of its own sits on white paper, as an HTML mail does.
- **Downloads** open the Save panel. What Moodle sends as a file
  (`Content-Disposition: attachment`) is saved rather than shown.
- **One view**: asked from another window, it moves there, and the first
  window says so (« Afficher ici » brings it back).
- **Two web views in a window**: once the view is there, Tauri no longer
  gives the main window as a `WebviewWindow` (`get_webview_window` answers
  None). The app's code asks for the window and its page separately
  (`window::page`, `window::pages` in `src-tauri/src/window.rs`).

## Saved passwords (macOS)

On the login page the app asks macOS for the passwords saved for tafac.fr
(Passwords, iCloud Keychain): the system's sheet opens once, a pick fills
the form and signs in. After a login typed by hand, macOS offers to save it
for tafac.fr, so Safari has it too (`src-tauri/src/passwords.rs`, through
`/__desktop/password/*`, `src-tauri/src/desktop.rs`).

Apple only allows it when the app and tafac.fr name each other:

1. **The app**: signed with the `webcredentials:tafac.fr` entitlement
   (`src-tauri/entitlements.signed.plist`, team P8XRQT7Z4K) and a
   Developer ID provisioning profile with Associated Domains, saved as
   `src-tauri/embedded.provisionprofile` (not committed). Built with
   `APPLE_SIGNING_IDENTITY="Developer ID Application: Tom Heliere (P8XRQT7Z4K)" npm run desktop:build:signed`.
   An unsigned build carrying the entitlement would be killed at launch, so
   `desktop:build` leaves it out. The bundled Node is signed again on its own
   (`scripts/desktop-sign.mjs`, `entitlements.node.plist`, JIT only): with
   the app's entitlements macOS kills it, a helper has no profile.
2. **tafac.fr**: `APPLE_APP_IDS=<team id>.fr.tafac.desktop` in the server's
   environment; `server.js` then serves
   `/.well-known/apple-app-site-association`.

Without both, the sheet has nothing to offer and the form stays as it is.
While the app keeps a login (Staying signed in: the login page shows after
a sign-in that couldn't be tried), the sheet doesn't open.

## Updates

The app updates itself: Tauri's updater plugin, the whole app each time,
driven from Rust (`src-tauri/src/updater.rs`). The page has no updater
command to call (nothing added to `capabilities/default.json`): it reads the
state and asks for the install through `/__desktop/update/*`
(`src-tauri/src/desktop.rs`, `src/desktopUpdate.js`).

- **The one file the app reads**: `https://tafac.fr/desktop/latest.json`,
  Tauri's static format plus two fields of ours (below). Checked at launch,
  every hour while the app runs, after the computer wakes (the clock is
  read every minute: a jump is a wake, a timer alone would stop with the
  computer), and from Tafac › Rechercher les mises à jour…, which answers
  with a short note (« Tafac est à jour · 0.25.0 »).
- **A newer version** is downloaded in the background, checked against its
  signature and kept in `~/Library/Caches/fr.tafac.desktop/updates/`. The
  sidebar then shows « Mise à jour prête », the web's « Nouvelle version »
  card with the rocket (`src/components/DesktopUpdateRow.jsx`,
  `UpdateNotice.jsx`); folded, the rocket with the new dot. Quitting installs it (⌘Q, not
  closing the window); « Redémarrer » does it now. What is installed is
  checked against the signature again. A package left there by a run that
  never installed it (the computer shut down) is used at the next launch,
  not downloaded again.
- **`minimum`**: a version below it can't sign in any more (a university
  changed its CAS). The page then shows « Mise à jour nécessaire » instead
  of the app, before it asks the server anything
  (`src/components/DesktopUpdateLayer.jsx`, started by `src/main.jsx`): the
  download with its progress, then the restart. The page waits for the
  launch check's answer for 3 seconds from launch at most.
- **It never blocks by accident**: only an answer that says the version is
  too old blocks. No answer (offline, tafac.fr down, a file that doesn't
  read) or a bad signature show nothing: the app goes on as it is and a
  later check tries again (15 minutes after a check without an answer). A
  package with a bad signature is not downloaded again while `latest.json`
  announces the same one. Only an install the student asked for says that it
  failed: « Non installée » on the sidebar's row, and on « Mise à jour
  nécessaire » « La mise à jour a échoué » with « Réessayer » and the
  installer's address (`installer`).
- **After an update** nothing announces it but « Nouveautés », as on the
  web: same entries, same seen ids.
- **Réglages › Mises à jour** (desktop app only,
  `src/components/DesktopUpdateSettings.jsx`): the app's card (its version,
  where its update is, the download's bar, « Redémarrer »), « Rechercher les
  mises à jour » with when the last check got an answer
  (`POST /__desktop/update/check`, the menu's note as its answer),
  « Nouveautés », and after a failed install the installer. A local 0.0.0
  build says it doesn't look for updates.
- **Quitting installs only when it takes no password**: the student's
  account can write to the app and to its folder. An app installed by
  another account waits for « Redémarrer », where macOS asks for an
  administrator's password.

```json
{
  "version": "0.26.0",
  "minimum": "0.24.0",
  "pub_date": "2026-11-20T09:00:00Z",
  "notes": "",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://github.com/l-ent-univ/tafac/releases/download/v0.26.0/Tafac_0.26.0_aarch64.app.tar.gz",
      "signature": "…",
      "installer": "https://github.com/l-ent-univ/tafac/releases/download/v0.26.0/Tafac_0.26.0_aarch64.dmg"
    },
    "darwin-x86_64": { "url": "…", "signature": "…", "installer": "…" }
  }
}
```

`minimum` and `installer` are ours; the plugin ignores them. `notes` stays
empty.

**tafac.fr** serves it (`server/desktopUpdate/`, mounted by `server.js`),
from `DESKTOP_LATEST_FILE` (a path, read again whenever the file changes: no
restart) or `DESKTOP_LATEST_JSON` (the JSON itself). A manifest that the apps
couldn't read, or whose `minimum` is above its `version`, is not served
(404, a line in the server's log): to the apps that is no answer.
`/desktop/download/<platform>` (`darwin-aarch64`, `darwin-x86_64`) sends to
that platform's `installer`: a download link that never changes and only
moves when an update is published.

**The version** is the release's: CI builds the tag `vX.Y.Z` as `X.Y.Z`
(`--config '{"version":"X.Y.Z"}'`), the same number as the web release.
`tauri.conf.json` says `0.0.0`, so any other build (`desktop:build`,
`desktop:build:signed`) is 0.0.0 and never looks for updates: a local build
isn't replaced by the release. The menu entry is greyed there.

**The signature**: updates are signed with a key of ours (minisign), not
Apple's. The public key is in `tauri.conf.json` (`plugins.updater.pubkey`);
the private key is in `~/.tauri/tafac-updater.key` and in the repository's
secrets, nowhere else. Without it no installed app accepts an update again:
keep a copy. Each signature carries its version (`requireSignedVersion`): a
`latest.json` can't pass an older release off as a newer one.

**In development**: a debug build looks for updates only when
`TAFAC_UPDATE_URL` names a `latest.json` (http allowed), whatever its
version, and logs what it does (`[tafac] update: …`). Run from a packaged
debug app (`tauri build --debug --bundles app`), not `desktop:dev`: there is
no app to replace there, and the install is refused.

## Releasing an update

1. **Tag**: merging to main creates the release `vX.Y.Z` (`ci.yml`), as for
   the web.
2. **CI** (`.github/workflows/desktop.yml`, called by `ci.yml` when the
   repository variable `DESKTOP_RELEASE` is `true`; also on a `v*` tag pushed
   by hand, or run by hand for an existing tag): for Apple Silicon and Intel,
   builds the app at that version, signs it (`scripts/desktop-sign.mjs`),
   notarizes it (`scripts/desktop-notarize.mjs`), makes the update's archive
   and signature (`scripts/desktop-updater-archive.mjs`) and the disk image
   (`scripts/desktop-dmg.mjs`), and adds them to the GitHub release with
   `latest.json` (`scripts/desktop-latest.mjs`).
3. **Publish**: by itself. tafac.fr reads the newest release's
   `latest.json` every 10 minutes and, when it changed and checks, writes it
   to `DESKTOP_LATEST_FILE`, where it serves it from
   (`server/desktopUpdate/follow.ts`). CI uploads it only once the build is
   signed and notarized, so a release whose desktop build failed, or is
   still running, has none, and what is served stays as it is.
   - **Withdrawing an update**: delete its GitHub release. The previous one is
     the newest again and its manifest comes back; apps never go back a
     version, those that hadn't installed it drop it.
   - **By hand**: `DESKTOP_LATEST_PIN=1` stops following; the file stays as
     it is, to edit (hold an update back, raise `minimum`).
     `DESKTOP_LATEST_FROM` reads another address than the newest release.

**Locking old versions out**: set `"minimum"` in the published file to the
oldest version that still works (CI's `latest.json` keeps tafac.fr's current
one; run the workflow by hand with `minimum`, or pin and edit the file). Only when
older versions really can't sign in any more: they stop at « Mise à jour
nécessaire » until updated.

**To set up once**, in the repository's secrets:

| | |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The content of `~/.tauri/tafac-updater.key` (`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if the key gets a password) |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | The Developer ID Application certificate with its key, exported from Keychain Access as .p12, in base64 (`base64 -i cert.p12`), and the export's password |
| `APPLE_SIGNING_IDENTITY` | Its name: `Developer ID Application: … (P8XRQT7Z4K)` |
| `APPLE_PROVISIONING_PROFILE` | `src-tauri/embedded.provisionprofile` in base64 |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_PRIVATE_KEY` | An App Store Connect API key for the notarization (Users and Access › Integrations › Team Keys, access Developer): its ID, the issuer's ID, the content of `AuthKey_<id>.p8` |
| `POSTHOG_PROJECT_KEY` | PostHog's public project key, as tafac.fr's: the app's anonymous statistics (below). Unset, the app sends none |

Then the repository variable `DESKTOP_RELEASE` = `true`, and
`DESKTOP_LATEST_FILE` on tafac.fr.

## Remote settings

Between two updates, the app's server reads a small signed file from
tafac.fr, patches over its universities' settings: a feature switched off,
an address that moved within the university's own domains. Data only, never
code, never a new domain. Read when the app starts (not when its window is
closed and opened again): `docs/REMOTE_SETTINGS.md`.

## Statistics

The app's own server sends the same anonymous statistics as tafac.fr
(`docs/ANALYTICS.md`), from the student's computer to PostHog, never
through tafac.fr, and only while « Statistiques anonymes » is on. Its
events carry `client: desktop` and `app_version` (a browser tab says `web`,
the installed PWA `pwa`). The key is built in by CI
(`TAFAC_POSTHOG_PROJECT_KEY`, read by `src-tauri/src/sidecar.rs`): a local
build sends nothing.

## The disk image

A first install is a disk image (`Tafac_X.Y.Z_aarch64.dmg`, `_x64.dmg`):
Tafac.app, a link to Applications, a background. Updates never use it. On
each release it is also there as `Tafac_aarch64.dmg` and `Tafac_x64.dmg`.

Its layout is `bundle.macOS.dmg` in `tauri.conf.json`:

- **Background**: `src-tauri/dmg/background.png`, 660×400 px at 72 dpi, and
  `src-tauri/dmg/background@2x.png`, 1320×800 px at 144 dpi, for Retina
  screens. Replace both. They are joined into one picture with both
  resolutions (`background.tiff`, not committed: `desktop:prepare` and
  `desktop:dmg` make it), because Finder takes one file and shows a plain
  PNG blurred on a Retina screen.
- **Icons**: 128 pt, their names in 16 pt under them. Tafac.app's centre is
  at (180, 170) and Applications' at (480, 170), in points from the
  picture's top left corner; the names sit around y = 254.
- **Window**: 660×428 pt, the picture's 400 plus a 28 pt title bar. Finder
  saves the whole window's size, title bar included: where the title bar is
  taller (32 pt on macOS 27), the picture's last 4 pt are hidden. A Finder
  with its path bar on (Présentation › Afficher la barre du chemin, the
  student's own setting) hides 28 pt more at the bottom. So nothing that
  matters in the picture's bottom 32 pt.
- Names are black in a light Finder and white in a dark one, whatever the
  picture: on a light picture they don't read in dark mode.

`npm run desktop:dmg` makes it from the built app (after
`desktop:build:signed`), signed when `APPLE_SIGNING_IDENTITY` is set and
notarized when the App Store Connect key is in the environment too
(`APPLE_API_KEY_PATH`, `APPLE_API_KEY`, `APPLE_API_ISSUER`). Finder lays it
out: a window opens for a few seconds. Tauri's own disk image
(`desktop:build`) has the same layout but holds the app as Tauri signs it,
before `desktop-sign.mjs`: fine unsigned, not for a release.

## Commands

| | |
|---|---|
| `npm run desktop:dev` | Builds `dist/`, then opens the app with the Node on the PATH and the repository's files (`TAFAC_START_PATH=/rennes` opens on that page) |
| `npm run desktop:build` | Packaged app for this computer, unsigned: runs `desktop:prepare`, then `tauri build` |
| `npm run desktop:build:signed` | The same, signed with the Developer ID certificate, entitlements and provisioning profile (saved passwords) |
| `npm run desktop:dmg` | The disk image of the app just built (`scripts/desktop-dmg.mjs`) |
| `npm run desktop:prepare` | `desktop-build/server/` (the server's files and the npm packages it imports, found through esbuild's import graph), `src-tauri/binaries/node-<triple>` (the official Node binary pinned in the Dockerfile, checksum checked) and on macOS the disk image's background |

Needs Rust (`rustup`). Frontend or server changes need no Rust work: the
next build ships them. Local builds are version 0.0.0 (see Updates); the
release scripts read the built app in `src-tauri/target/release/bundle`, or
in `TAFAC_BUNDLE_DIR`.

## Not done yet

- Staying signed in, for an account that asks for a one-time code: nothing
  is kept, the student signs in by hand at each expiry.
- Windows and Linux: builds, Windows signing, and their updates (there the
  update installs only from « Redémarrer », not on quit, and the row needs
  the sidebar, so a window at least 1024px wide).
- A bad signature is not reported anywhere (PostHog): it only shows in the
  app's own log.
- The service worker doesn't register on `tafac://`: harmless, the app
  ships its files.
- Opening an app in a new tab from the context menu (`window.open` of
  `about:blank`, then filled) is refused: that menu shows its error.
- Moodle elsewhere than on macOS: Tauri's navigation rule is asked for
  frames too (an embedded video from another site would go to the browser),
  and the toolbar can't tell whether there is a page to go back to.
- Moodle: a download shows nothing while it runs or when it is done; while
  a sheet is over the slot, the slot is empty (no picture of Moodle's page
  under it).
