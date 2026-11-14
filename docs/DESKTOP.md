# Desktop app (Tauri)

The desktop app is the same app as tafac.fr, but the server runs on the
student's computer. The login and every request to the university go from
that computer straight to the university: credentials never pass through
tafac.fr.

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

- **Links** (`src-tauri/src/links.rs`): web addresses open in the browser.
  An app address opened in a new tab (the launch relay) opens where its
  redirect points. Downloads go to the Downloads folder.
- **Data** (macOS: `~/Library/Application Support/fr.tafac.desktop/`):
  `session-secret` and `cookies.json` (the encrypted session cookie), both
  readable by the student's account only. `server/` holds remembered app
  icons (`DATA_DIR`).
- The server stops with the app: its stdin is a pipe from the app, and when
  the pipe closes the server exits, even if the app crashed.

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
  propos, Réglages… ⌘,), Fichier (Nouveau message ⌘N, Fermer la fenêtre
  ⌘W, Imprimer… ⌘P), Édition (+ Rechercher ⌘F), Présentation (Actualiser
  ⌘R), Aller (the university's pages, ⌘1…, the one in view ticked),
  Fenêtre. Commands reach the page as `tafac:command` events; the page
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

## Commands

| | |
|---|---|
| `npm run desktop:dev` | Builds `dist/`, then opens the app with the Node on the PATH and the repository's files (`TAFAC_START_PATH=/rennes` opens on that page) |
| `npm run desktop:build` | Packaged app for this computer: runs `desktop:prepare`, then `tauri build` |
| `npm run desktop:build:signed` | The same, signed with the Developer ID certificate, entitlements and provisioning profile (saved passwords); not notarized yet |
| `npm run desktop:prepare` | `desktop-build/server/` (the server's files and the npm packages it imports, found through esbuild's import graph) and `src-tauri/binaries/node-<triple>` (the official Node binary pinned in the Dockerfile, checksum checked) |

Needs Rust (`rustup`). Frontend or server changes need no Rust work: the
next build ships them.

## Not done yet

- Signing and notarization (macOS), Windows signing, the updater, and a
  CI build for each OS on version tags.
- A minimum version the app checks at launch, so old installs show
  "update required" instead of breaking when a university changes its CAS.
- `SESSION_SECRET` in the Keychain instead of a file.
- The service worker doesn't register on `tafac://`: harmless, the app
  ships its files.
- Opening an app in a new tab from the context menu (`window.open` of
  `about:blank`, then filled) is refused: that menu shows its error.
