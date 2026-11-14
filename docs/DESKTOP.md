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

## Saved passwords (macOS)

On the login page the app asks macOS for the passwords saved for tafac.fr
(Passwords, iCloud Keychain): the system's sheet opens once, a pick fills
the form and signs in. After a login typed by hand, macOS offers to save it
for tafac.fr, so Safari has it too (`src-tauri/src/passwords.rs`, through
`/__desktop/password/*`, `src-tauri/src/desktop.rs`).

Apple only allows it when the app and tafac.fr name each other:

1. **The app**: signed with the `webcredentials:tafac.fr` entitlement
   (`src-tauri/entitlements.signed.plist`, its `TEAM_ID` filled in) and a
   Developer ID provisioning profile with Associated Domains, saved as
   `src-tauri/embedded.provisionprofile` (not committed). Built with
   `npm run desktop:build:signed`. An unsigned build carrying the
   entitlement would be killed at launch, so `desktop:build` leaves it out.
2. **tafac.fr**: `APPLE_APP_IDS=<team id>.fr.tafac.desktop` in the server's
   environment; `server.js` then serves
   `/.well-known/apple-app-site-association`.

Without both, the sheet has nothing to offer and the form stays as it is.
Unchecked until the first signed build: that the Node sidecar runs with the
same entitlements (JIT allowed in `entitlements.signed.plist`).

## Commands

| | |
|---|---|
| `npm run desktop:dev` | Builds `dist/`, then opens the app with the Node on the PATH and the repository's files (`TAFAC_START_PATH=/rennes` opens on that page) |
| `npm run desktop:build` | Packaged app for this computer: runs `desktop:prepare`, then `tauri build` |
| `npm run desktop:build:signed` | The same, with the entitlements and provisioning profile (saved passwords) |
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
