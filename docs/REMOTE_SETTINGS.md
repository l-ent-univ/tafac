# Remote settings

A way to mend an app in the students' hands without a new version of it.

The apps run the server on the student's device (`docs/DESKTOP.md`,
`docs/IOS.md`). What breaks there waits for an update of the app: on iOS,
for the App Store's review. So an app also reads a small signed file from
tafac.fr: **patches over its universities' settings, data only**.

Both apps read it, iOS and desktop. tafac.fr itself and a self-hosted
server don't: they run their own settings.

## What a patch can do, and can't

It can:

- **switch a feature off** (`features`), for the server and the page: the
  planning, the mail, Moodle's deadlines… as if the university didn't have
  it;
- **follow an address that moved**, or change any other setting of a
  university's `server.js` and `client.js` (a path, a caption, a limit).

It can't, whoever signed it (`server/remoteSettings/guard.ts`):

- **send anything to a new domain.** Every address a patch names must be
  one of the university's own, as the app ships them: the hosts of the
  addresses in its settings, and the domains it lists
  (`launch.allowedDomains`, the sign-in chains' `signInDomains`). The CAS can
  move to `sso2.univ-rennes.fr`; it can't move to another domain. That takes
  a new version of the app;
- name a file of the device (a mail's logo is read from one), or change
  which university the settings are;
- add code. Logic that changed at a university (a new step in its sign-in)
  still takes an update.

A patch that names something it may not is refused whole, with a line in
the app's log; the others still apply.

## The file

```json
{
  "serial": 3,
  "patches": [
    {
      "id": "rennes-cas-moved",
      "university": "univ-rennes",
      "apps": ["ios"],
      "maxVersion": "0.27.2",
      "features": { "mail": false },
      "server": { "origins": { "cas": "https://sso2.univ-rennes.fr" } },
      "client": {}
    }
  ]
}
```

| | |
|---|---|
| `serial` | Grows with each file published. An app never takes a file older than the one it has |
| `id` | The patch's name, for the log |
| `university` | The university's id (`universities/<id>/`) |
| `apps` | Optional: the apps it is for (`ios`, `desktop`). All without it |
| `minVersion`, `maxVersion` | Optional: the app's versions it is for, both included. A patch for a bug of 0.27 says `"maxVersion": "0.27.2"`, so the version that mends it for good doesn't take it |
| `features` | Switches, laid over the `features` of both the server's and the page's settings |
| `server` | Laid over `universities/<id>/server.js` |
| `client` | Laid over `universities/<id>/client.js`, in the page |

Objects are merged key by key; anything else (a text, a number, a list,
`null`) takes the place of what was there. A file that doesn't read (a key
this doesn't know, a version that isn't one) is refused whole: a typo never
half-applies.

**To take patches away**, publish a file with a higher `serial` and without
them (`"patches": []`). Removing the file from tafac.fr changes nothing in
the apps that have it.

## Publishing

1. Write `settings.json`, with a `serial` above the last one published.
2. Sign it with the key of the desktop app's updates
   (`docs/DESKTOP.md`, « The signature »):

   ```sh
   npx tauri signer sign -f ~/.tauri/tafac-updater.key -p "" settings.json
   ```

   It writes `settings.json.sig` beside it.
3. Put both on tafac.fr, where `APP_SETTINGS_FILE` points
   (`settings.json`; its signature is read at the same path plus `.sig`).
   The server sends them as they are (`GET /app/settings.json`,
   `/app/settings.json.sig`), read again at each request: no restart.

tafac.fr holds no key: whoever got into it could not make a file the apps
take. The signature is the private key's, which is on the maintainer's
computer and in the repository's secrets, nowhere else.

**Try a file before publishing it**: a debug build of either app reads the
file `TAFAC_SETTINGS_URL` names (http on this computer allowed), signed
with the key `TAFAC_SETTINGS_PUBKEY` names when it isn't the real one. In
the simulator (`docs/IOS.md`):

```sh
python3 -m http.server 8787 --bind 127.0.0.1   # in the folder of settings.json and its .sig
SIMCTL_CHILD_TAFAC_SETTINGS_URL=http://127.0.0.1:8787/settings.json \
  xcrun simctl launch booted fr.tafac.ios
```

For the desktop app: `TAFAC_SETTINGS_URL=… npm run desktop:dev`.

The app's log says what it took (`Remote settings: univ-rennes:
rennes-cas-moved (serial 3)`) and what it refused, and why.

A packaged build made here (version 0.0.0) asks for nothing, as it looks
for no update: a patch for a release is none of its business.

## When an app takes it

- **As it starts.** The universities' settings are read once, when the
  server starts: the file in force is the one there then.
- **The file is asked for at each start**, and every hour while the app
  runs. When tafac.fr last answered more than 6 hours ago, the start waits
  for the answer, 1.5 seconds at most; otherwise it starts with the file it
  kept, and a newer one is kept for the next start.
- So a patch reaches a student at their next start of the app, or the one
  after when they had opened it within the last 6 hours.
- **On a Mac that can be long**: closing the window doesn't quit the app
  (`docs/DESKTOP.md`), and its server keeps the settings it started with
  until the app is quit (⌘Q) and opened again. The desktop app also updates
  itself within the hour, which mends more than a patch can.
- **It never gets in the way.** No answer (offline, tafac.fr down), a file
  that doesn't read, a bad signature, an older file: the app goes on with
  what it has. The kept copy (`remote-settings.json` in the app's data
  folder) is checked against its signature each time it is read.

## Where it is

| | |
|---|---|
| `server/remoteSettings/` | `minisign.ts` (the signature), `document.ts` (the file), `guard.ts` (what a patch may not do), `index.ts` (asking, keeping, applying; tafac.fr's routes) |
| `src/remoteSettings.js` | Laying one set of settings over another, for the server and the page |
| `server/universitiesApp.js` | Each university's settings pass through it as the server starts; the page's part goes out with `/__ent_auth/universities` |
| `src/universityBoot.js` | The page lays its part over `client.js` |
| `src-tauri/src/remote_settings.rs` | Each app says which app it is, where the file is and whose signature it takes (`TAFAC_APP`, `TAFAC_APP_VERSION`, `REMOTE_SETTINGS_*`), to its server: `sidecar.rs` on the desktop, `node.rs` on iOS |
| `tests/remoteSettings.test.ts` | With files signed by a key made for the tests |

## Not done yet

- **The desktop app takes a patch only when it starts**: its server could
  be started again when a newer file comes (it is a process of its own),
  which iOS can't do.
- **A minimum version** for iOS, as the desktop's `minimum`: nothing tells
  a student their version can no longer sign in.
- **No notice in the page** that a newer file waits for the next start.
- **tafac.fr** has no `APP_SETTINGS_FILE` yet: until it does, the apps get
  no file and change nothing.
