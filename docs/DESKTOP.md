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

## Commands

| | |
|---|---|
| `npm run desktop:dev` | Builds `dist/`, then opens the app with the Node on the PATH and the repository's files |
| `npm run desktop:build` | Packaged app for this computer: runs `desktop:prepare`, then `tauri build` |
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
