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

## Staying signed in

The student signs in once. The university's session dies on its own (the
Rennes CAS ends it 30 to 47 minutes after the login, whatever the student
does): the app signs in again by itself, and the login page only comes back
after « Se déconnecter » (`src-tauri/src/signin.rs`, used by `bridge.rs`).

- **Kept**: after a login of the page's that went through (`POST
  /__ent_auth/login`, 200), the bridge keeps its login, password and
  university (`university` of the body, else the `X-Tafac-University`
  header). Not the demo account's, nor a login that needed a one-time code:
  only the student can type that one, so it would never sign in alone. Any
  login that goes through replaces what was kept.
- **Where**: a packaged app keeps it in the system's credential store (macOS
  Keychain: service `fr.tafac.desktop`, account `sign-in`), read once per
  launch. A debug build keeps it in memory only, for the run (no file, and no
  keychain: an unsigned build would have macOS ask for it at each rebuild):
  after a restart, `npm run desktop:dev` asks for the password again. A store
  that refuses it leaves it in memory for the run.
- **Signed in again**: an answer with `X-Tafac-Session: expired`
  (`server/sessionExpiry/`), on any request of the window or of Moodle's view,
  makes the bridge sign in with the kept login (`quiet: true`: the server
  sends no one-time code unasked), then ask the request again: the page and
  Moodle's view get the second answer and never see the expiry. One sign-in
  at a time: the requests that come back expired meanwhile wait for it and
  are asked again after. Moodle's view stays open; the launch relay it asks
  signs in to Moodle with the new session.
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
- **The password** goes only to the local server's login route, and from
  there to the university's CAS, as when the student types it. It is never
  logged (the app's log says `[tafac] sign-in: kept`, `signed in again`,
  `refused by the university, forgotten`…).
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
`/desktop/download/<platform>` (`darwin-aarch64`, `darwin-x86_64`,
`windows-x86_64`) sends to
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

## Downloading it

On the website, a visitor on a Mac or on Windows is offered the app: signed
out, on the landing page (Windows: `LandingWindowsApp`); signed in, in the
sidebar's foot (`MacAppDownloadButton`, `WindowsAppDownloadButton`). They
read the installers of `/desktop/latest.json`: Windows' button shows only
once the newest release has a `windows-x86_64` platform
(`src/windowsAppDownload.js`). The apps themselves show nothing.

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
   For Windows (x64, on its own runner, `scripts/desktop-windows.mjs`): the
   NSIS setup (`Tafac_X.Y.Z_x64-setup.exe`, what the installed apps download)
   with its signature, and the first install, the Fluent window of
   `installer/` around that setup (`Tafac_X.Y.Z_x64.exe`, also
   `Tafac_x64.exe`). The same updater key signs it. A failed Windows build
   doesn't hold the Mac's update back: `latest.json` then has no
   `windows-x86_64`, and the site offers no Windows download.
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
- Linux: builds and updates.
- Windows: the setup isn't signed with a certificate (SmartScreen warns at the
  first launch), no ARM64 build, and its update installs only from
  « Redémarrer », not on quit (the row needs the sidebar, so a window at
  least 1024px wide).
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
