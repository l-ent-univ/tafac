# iOS app (Tauri) — prototype

The iOS app is the desktop app's code (`src-tauri`, `docs/DESKTOP.md`) built
for a phone: the same page, in its phone layout, with the server running on
the phone. The login and every request to the university go from the phone
straight to the university: credentials never pass through tafac.fr.

It runs in the simulator, and was installed and started on a phone once
(« Checked », below).

## How it fits together

```
web view (tafac://localhost/)        src-tauri/src/ios.rs
   │  every request: page, /__ent_auth, /__ent_proxy
   ▼
bridge (Rust), as on the desktop     src-tauri/src/bridge.rs
   │  session cookie (jar.rs), kept login (signin.rs)
   │  the gateway, in the app: signs in, holds the session, answers what
   │  moved to tonAPI                     back/crates/tafac-gateway
   ▼  Unix socket in the app's own folder, no TCP port
server.js, unchanged                 desktop/ios.mjs
   │  inside the app's process, on Node 18  src-tauri/src/node.rs
   ▼
the university (CAS, ADE, webmail…)
```

What is shared with the desktop app: the bridge, the cookie jar, the kept
login, the session secret, the rules for where a link goes (`links.rs`),
« Moodle » (`moodle.rs`). `src-tauri/src/lib.rs` is the app; `app.rs` is the
desktop's (what `main.rs` was), `ios.rs` the phone's. What else the desktop
adds around the page is not built for iOS: menu bar, updater, saved
passwords, window state.

## Node inside the app

An iOS app can't start another program, so there is no Node process beside
it. Node runs in the app's own process, on a thread
(`src-tauri/src/node.rs`): [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile)'s
`NodeMobile.xcframework`, linked and embedded by the Xcode project
(`src-tauri/gen/apple/project.yml`).

It is the only Node there is for iOS, and it is **Node 18.20.4, without a
JIT** (iOS forbids one) **and without ICU**. The server is written for Node
24. So `scripts/ios-prepare.mjs` makes a copy of the server for it
(`desktop-build/ios/server/`, the app's `server/` resource):

- **Each module rewritten** where it is, in Node 18's syntax, the TypeScript
  ones as JavaScript (esbuild). The layout is kept: the server finds
  `dist/` and each university's folder from its modules' own addresses.
- **Each npm package as one file** (express, cookie-parser, sanitize-html,
  posthog-node): no `node_modules` to install, and a package written for a
  newer Node still loads.
- **`\p{…}` in a regex** (letters, marks, control characters) doesn't compile
  without ICU: each is written out as the characters it stands for
  (regexpu-core). Only regexes written as such: one built from a string at
  run time would still throw (the script warns when it sees one).
- **`desktop/iosRuntime.mjs`**, loaded before `server.js`, puts back what
  that Node lacks:

  | | |
  |---|---|
  | `fetch`, `Headers`, `Request`, `Response`, `FormData` | Node's own read HTTP with WebAssembly, which needs a JIT: touching one throws. Replaced by the same API over `node:http`/`node:https` (node-fetch), bodies as web streams, one connection kept per host |
  | `Intl` | absent. Dates and numbers from `@formatjs`, French and English, every time zone. The phone's time zone comes from the app (`TAFAC_TIME_ZONE`) |
  | `String.prototype.normalize` | a no-op without ICU: unorm's |
  | `String.prototype.localeCompare` | compares code units without ICU: letters, then accents, then case |
  | `crypto` (the global) | behind a flag in Node 18 |

**This is the fragile part.** The server's code is the same, but it runs on
another HTTP client and other `Intl` code than on tafac.fr and in the
desktop app. A server change that uses something Node 18 lacks (a newer
method, `Intl.Collator`, a `\p{…}` built at run time…) works everywhere
except here, and only shows when the app runs. No test covers it yet.

**The socket**: an app's data folder on iOS is longer than a Unix socket's
path may be (~104 bytes). The app works from its data folder
(`set_current_dir`) and the socket is `s.sock` there; Node, in the same
process, means the same folder.

## tonAPI

The server is moving from Node to
[tonAPI](https://github.com/l-ent-univ/tonAPI) (Rust). One crate does it for
tafac.fr and both apps: `back/crates/tafac-gateway` (its `lib.rs` says how;
`docs/DESKTOP.md`, « tonAPI », says who does what). On the phone the bridge
asks it before Node, in the app's own process: no JavaScript runs for what
it answers.

- **The gateway**, for the Université de Rennes (`routes.rs`, the one
  table): it signs the student in (tonAPI's own sign-in at the CAS), makes
  the session and its cookie, answers the session check, the account,
  Moodle's deadlines and the grades, says when the session is over, and
  signs out.
- **Node**, behind it: every other route, as before (the portal's
  applications, the planning, the mail, the documents, Rennes 2, Sorbonne
  Nouvelle, the demo account), and what the gateway asks it for (a second
  factor, the portal signed in to again, a moved route's error).
- **One session**, in one cookie, read by both: the bridge's jar holds it
  whoever set it.
- **Asked as the app starts**: the session check is the page's first
  question, and it can only ask once Node and the page have started. The app
  asks the portal as it starts instead (`bridge::start_ahead`), so the
  answer is there when the page asks.
- **Nothing to ship**: tonAPI's settings for each university are in the
  crate (taken from tonAPI's own repository as it builds). tonAPI is a git
  dependency at one commit; its repository is private, so Cargo fetches it
  with git (`.cargo/config.toml`) and a build needs read access
  to it.

Measured on a real Rennes account, iPhone 17 simulator, debug build, when
the gateway answered the session check and the account only, on sessions
Node made (`TAFAC_NO_TONAPI=1` is the same build with every route left to
Node). Not measured again since the gateway signs in:

| Cold launch | `/__ent_auth/session` | `/__ent_auth/account` |
|---|---|---|
| Node, the portal's session alive | 89 to 306 ms | 11 to 37 ms |
| tonAPI, the portal's session alive | 0 to 3 ms | 0 to 1 ms |
| Node, the portal's session lapsed | 497 to 1069 ms | 16 to 34 ms |
| tonAPI's turn, the portal's session lapsed | 402 to 807 ms, Node's | 11 to 18 ms |

The rest of a launch is Node's and unchanged: the applications (about
40 requests), grades, the planning, the mail (0.5 to 1.8 s), Moodle's
deadlines (2.2 to 3.7 s).

## The window

- **Behind the status bar**, on a phone (`src-tauri/src/ios_chrome.rs`;
  `src/overrides.css`, « iOS app · status bar »): the web view covers the
  whole screen and never changes size, and each screen draws its own top
  behind the bar, as an app does: « Accueil »'s photo, a page's tinted
  band, the sign-in screen's colour. `--status-bar` is the bar's height (0
  anywhere else), `--app-h` the screen's height below it.
  - The pages start below the bar; what sticks to the top sticks below it
    in its own colour (the planning's top, the mail list's header).
  - What scrolls up passes behind the bar under a frosted veil of the
    page's colour (`.ios-status-veil`), which comes with the scroll.
  - Sheets and dialogs size themselves on `--app-h` and keep below the
    bar; their backdrop covers it.
  - A web view that stopped below the bar left a plain strip over every
    page; one that moved its edge between « Accueil » and the other pages
    showed a step at each switch. Neither is done.
  - On a tablet (the sidebar's layout, not made for the bar yet) the web
    view stays below the status bar, which takes the page's `theme-color`.
  The bottom runs to the screen's edge, as in the web app
  (`env(safe-area-inset-bottom)`).
- **No logo in « Accueil »'s header** (`HomePhoneHeader`): the app is
  Tafac, its icon says so. The account button is alone at the top right.
- **Scrolling bounces** past the page's ends, as on iOS everywhere (Tauri
  turns it off; `ios_chrome.rs` turns it back on).
- **A page switch** is a short fade with a touch of scale
  (`:root[data-ios-app] .page-enter`, `src/overrides.css`), as the system's
  tab bar makes one, where the web's rises.
- **A page visited stays alive** behind the others, as a native tab's does:
  back on it, it is as it was left, at its scroll, with nothing built or
  asked again (`src/keptPages.js`, `src/useKeptPages.js`,
  `src/components/KeptPage.jsx`). The website and the desktop app mount a
  page as it's shown and unmount it as it's left, as before.
  - Kept: « Accueil », « Mes notes », the Planning, « Assiduité », the
    Messagerie. Not « Moodle »: its native view keeps Moodle's own state.
  - **Scroll**: each page's is saved as it's left and put back as it shows
    again (the document's on a phone, the column's on a wide screen). A
    first visit starts at the top, the selected tab pressed again still
    goes to the top, a day opened from « Prochains cours » shows the
    planning from its top.
  - **A hidden page is quiet**: out of the layout (`hidden`), so nothing in
    it is drawn or animated; its clocks and refreshes stop and « Accueil »'s
    clips too (`usePageShown`, `usePageInterval`, `src/pageVisit.js`); what
    watches a size keeps its state, as everything measures 0 there
    (`isInHiddenPage`). A sheet, a menu or a note it had open over the app
    closes with it (`useClosedWithPage`); a mail being written is hidden
    and comes back with the Messagerie.
  - **An arrival is a visit, not a mount** (`usePageVisit`,
    `usePageReturn`): `page_viewed` and `dashboard_viewed` are sent again,
    with their source; what a mount asks is asked again behind what is
    shown, the cache while fresh (grades 5 min, next classes 10 min, mail
    and deadlines at their own pace; the Messagerie looks at its folders);
    a mail, a grade or a day asked from « Accueil » opens in the page
    already there; the planning left on another day opens on today.
  - **A return** plays the page's switch effect and nothing else: the CSS
    animations that start over inside it (it comes out of `display: none`)
    are ended as it shows (`settleAnimations`), so no card or icon arrives
    twice. Reduced motion: no effect at all, as before.
  - **Dropped**: every page on sign-out; the hidden ones when the account
    or the pages there are change. Nothing of a session is kept into
    another.
- **The colour around the web view** is the page's `theme-color`, and the window's
  appearance the app's theme (« Clair », « Sombre »; « Automatique » leaves
  it to the system): the page says both through `POST /__ios/chrome`
  (`src/iosApp.js`).
- **The page knows** it is the iOS app (`isIosApp()`, `src/desktopApp.js`;
  `<html data-ios-app>`): `isNativeApp()` is either app (the server is the
  device's), `isDesktopApp()` the desktop one only. It opens on the login
  page, never offers to install the web app, and says `client: ios` in the
  anonymous statistics.
- **No command for the page**: the capability (`capabilities/default.json`)
  is the desktop's only. What the page says to the app goes through the
  app's own routes (`/__ios/*`, `ios_chrome.rs`), as on the desktop.

## The tab bar

The bar at the bottom is the system's (`UITabBar`: its glass, its selection,
VoiceOver), not the page's: a small Tauri plugin of the repository's, in
Swift (`src-tauri/plugins/tabbar`).

- **The page stays in charge** (`src/iosTabBar.js`,
  `src/components/MobileTabBar.jsx`): it says its tabs, the selected one and
  whether the bar may show, through `POST /__ios/tabbar`. A tab pressed
  comes back as a `tafac:tab` event on window, and the page does what its
  own bar did (go to a page, back to its top, open a link, say why a tab is
  greyed).
- **Tafac's icons**, not SF Symbols: the page draws each of its Phosphor
  icons as a picture (22 pt, as its own bar) and hands them over; the bar
  colours them, the selected one in the brand's colour. SF Symbols only
  stand in for an icon that couldn't be drawn.
- **It hides under what the page opens**: the bar is native, above
  everything the page draws. While a sheet, a dialog or a menu of the
  page's is where the bar is, the page says so and the bar goes (the rule
  Moodle's view has on the desktop, `isSlotCovered`).
- A link tab (the webmail, where mail isn't a page) is never selected: it
  opens over the app.
- **The page keeps the bar's place** (`[data-native-bar]`,
  `MobileTabBar`) where the bar is: along the screen's bottom edge, lower
  than the page's own bar was. Higher, it took the presses meant for what
  the page puts just over the bar (the mail reader's toolbar).

## Menus

The page's context menu (`ContextMenu`: a long press on a grade, a mail, an
app's tile; the menus opened from a button) and its dropdowns (`Dropdown`:
the semester, the planning's view, the settings' choices) are the system's
menu (`UIMenu`: its glass, its haptics, its place next to the finger), by a
second small plugin (`src-tauri/plugins/menu`).

- **The page stays in charge** (`src/iosMenu.js`): it says where the menu
  opens and what is in it through `POST /__ios/menu`; the item picked comes
  back as a `tafac:menu` event on window (nothing picked: `id: null`), and
  the page does what its own menu did.
- **Tafac's icons** again, drawn by the page (`src/iosIcons.js`); a colour
  to pick is its dot, a ticked item is ticked, a destructive one is red, a
  separator starts a new group, a count goes after the label in brackets.
- **A dropdown** keeps the page's own button; the menu hangs from it, the
  choice in force ticked, the dropdown's actions past a line. A label in
  two parts (« Semestre 5 · 2026/2027 ») is a line and a smaller one under
  it.
- **UIKit opens a menu from a control**, not at a point: the plugin puts a
  button with nothing to see where the page says (one point for a context
  menu, the box of the page's button for a dropdown), and opens its menu
  (`performPrimaryAction`, iOS 17.4). That button must stay a working
  control until the menu has closed: UIKit sends the pick through it.
- **Where it can't be the system's, it is the page's own**, as on the web:
  before iOS 17.4 (the app's route answers 501, once), and a list the
  system couldn't draw (each label in its own font).

## Glass

The controls of the page's own chrome (the pills and round buttons of a
page's header, of a bar floating over it) are of the system's glass
(`UIGlassEffect`, iOS 26: it bends and lights what passes behind it, and
gives under a finger), by a third small plugin (`src-tauri/plugins/glass`).
A page's element can't be of that glass: only a native view can.

- **The page stays in charge** (`src/iosGlass.js`): it says which controls
  there are, where each is, how it moves with the scroll and what it shows,
  through `POST /__ios/glass`. Nothing comes back.
- **Which controls**: `data-ios-glass`, on a pill (a button, a link, a
  `.button-group`) or on a header's row or a bar, whose pills it then takes
  (what the page draws a surface for); `data-ios-glass="off"` keeps one
  out. A `.lent-button`'s glass is tinted with its fill. Marked today:
  « Accueil »'s account button; the title rows of « Mes notes » and
  « Assiduité » (the semester, « Simuler », the PDF); the planning's first
  row (the day, « Aujourd’hui », the view, the actions); the mail list's
  « Actualiser » and « Nouveau message »; the mail reader's way back and
  its toolbar. Glass is for the controls floating over a page, not for
  what a page is made of: no card, no row, no widget, nothing in a sheet,
  a dialog or a menu, no text field.
- **The glass is in the web view**, in the view that holds the page's
  content (WebKit's own, found by its class's name: not found, the page
  keeps its own drawing), not over it:
  - there it scrolls with the page by itself, bounce included. What the
    page holds to the screen or sticks to its top is put back in place at
    each step of the scroll, in the same frame, by three rules (`fixed`,
    `sticky`, `page`: `controlTop`, `src/iosGlassModel.js`, as WebKit was
    seen to place the page's own elements, pulled past both ends). Nothing
    runs in the page while it scrolls, and nothing is sent;
  - a finger on the glass is a finger on the page too (WebKit's gesture
    recognizers are that view's): the glass gives under it, and the press,
    a long press or a scroll started there are the page's own, on its own
    element, still there under the glass. The glass has no action, and
    VoiceOver is left the page's element.
- **What a control shows** is a picture the page paints of it
  (`src/iosGlassPaint.js`: its text, its icons, its photo, in the page's
  own colours), which the app lays in the glass; the glass wears the page's
  theme, whatever is behind it. An icon that turns for good (« Actualiser »
  at work) is turned by the app; the app's spinner is the system's.
- **The page's own drawing is off** under a glass (`data-ios-glass-on`: a
  filter, the element still there and pressed). Glass and drawing are never
  both seen, nor neither: a new control's drawing is off before it was ever
  painted, and its glass is there with the frame that has it; one whose
  drawing shows (a sheet just closed over it) keeps it until its glass has
  faded in over it; a sheet opening, the drawing is back at once and the
  glass fades out over it.
- **Frame for frame with the page**: the app shows a change at once, where
  a page's frame takes its time to the screen (a page coming in: up to
  0.2 s in the simulator). So the page marks the frame that carries a
  change (its `theme-color`, the two last bits of each channel, nothing to
  the eye: WebKit hands the app that colour with the frame itself) and the
  app waits for that mark, a quarter of a second at most. A control comes
  in with what animates its page in (the switch's scale and fade, a mail's
  slide), from where that animation is by then; several animations at once
  are played as one, on the clock of the last to end.
- **Kept the page's own**, rather than a glass that would lag or show
  through: a control under a sheet, a dialog or a menu (the glass is over
  all of the page), in a part of the page that scrolls on its own, moved
  by a script (the planning's week strip, swiped), turned, or under an
  animation the app can't play along (anything but moves, scales and
  fades). The mail's folder pills too (they change width as one is
  picked), and Moodle's toolbar (on a phone it lies behind the status bar
  today: its place first).
- **Under the status bar** a control fades as the page's own veil covers
  it (`.ios-status-veil`): a mask the app moves with the scroll.
- **Where it isn't**: before iOS 26 and on a tablet the app's route answers
  501, once, and the page keeps its own drawing.

## Moodle

« Moodle » is a page of the app, as on the desktop (`docs/DESKTOP.md`):
Moodle itself, signed in through the launch relay, under the page's toolbar
and down to the screen's edge: it shows through the system's tab bar and
scrolls clear of it (the view's bottom margin is what lies over it; what a
Moodle page pins to its bottom stays above the bar).

- **One logic for both apps** (`src-tauri/src/moodle.rs`): what the view may
  load, how it signs in and signs in again, what the toolbar says, the
  page's routes (`/__desktop/moodle/*`, the same on iOS). Only the view
  under it differs.
- **The view** is a `WKWebView` of the app's own
  (`src-tauri/plugins/moodle`, in Swift; `moodle_ios.rs` for `moodle.rs`):
  Tauri gives a window a second web view on the desktop only. As the
  desktop's: its cookies in memory only, gone with the view (closed when the
  student signs out or in); a configuration without the app's scheme, so
  nothing in a course page can ask the app's server anything; Moodle's own
  pages in Tafac's look (`moodle_style.rs`); Safari's name in its user
  agent; a swipe from the edge goes back.
- **What it may load**: WebKit wants its answer at once, so the view
  decides by itself what stays in it, from the university's addresses the
  server lists (`MoodlePlugin.stays`, the « stays » half of `moodle.rs`'
  `classify`: keep the two in step). Any other address is not loaded and
  goes to `moodle.rs`, which opens it over the app or refuses it.
- **Files**: what Moodle sends as a file, or what the view can't show, is
  downloaded and handed to the share sheet (save to Files, open in another
  app, print).
- A link to Moodle anywhere in the app (a deadline, its tile, a link in a
  mail) opens in « Moodle », as on the desktop.

## Links

Tauri's web view tells an app about `window.open` and `target="_blank"` on
the desktop only: on iOS WebKit's request went unanswered and nothing
opened. `src-tauri/src/ios_windows.rs` gives the web view's delegate the
method WebKit asks for, which hands the address to the app's rule
(`ios::open_new_window`). A window asked without a press in the page (a tab
of the system's bar is pressed outside it) is allowed too.

- A web address (a link in a mail, a university service through the launch
  relay with its CAS ticket, Moodle) opens **over the app**, in the system's
  browser sheet (`SFSafariViewController`): « OK » comes back to the app.
- `mailto:` and `tel:` open in the app iOS has for them.
- An app page asked in a new tab loads in the window, the only one.
- Anything else is refused, by the same rule as on the desktop
  (`links::classify_navigation`).

**Files**: what the page downloads (a mail's attachment, « Certificat de
scolarité », the grades PDF, the planning's .ics, any file the page makes)
goes to the system's **share sheet** (`UIActivityViewController`: save to
Files, open in another app, AirDrop, print), as Moodle's files do, where the
desktop opens its Save panel. Written, not run yet (« Not done yet »).

- **The page makes a blob of it**: what it builds itself (the .ics, the
  certificate and the grades PDF it fetched), or a file of the app's (an
  attachment), which it fetches first with its own session and saves from
  a blob (`src/desktopDownloads.js`, as on the desktop: the web view can't
  download the app's own address). Nothing new in the page but that.
- **WebKit downloads the blob** (wry's download delegate, Tauri's
  `on_download`; `src-tauri/src/ios_downloads.rs`) into a folder of its own
  in the app's temporary folder, under a cleaned name (no folder in it, not
  hidden, « Tafac » for none). The address goes by the window's rule: a
  blob, a data link or the app's own downloads; a web file opens over the
  app, as a link; anything else is refused. Nothing is sent anywhere else.
- **Then the share sheet takes it** (`src-tauri/plugins/share`, another
  small plugin), over whatever is shown over the app. Its folder goes once
  the sheet is closed; what a closed app left there goes as it starts.
- A mail's PDF (« Enregistrer en PDF ») tries the page's own share first
  (`navigator.share`, WebKit's sheet), as in an iPhone's browser; where the
  web view has none or refuses it, it downloads as above. The week's
  picture has both: « Partager » (`navigator.share`) and its download.

## Staying signed in

As on the desktop (`signin.rs`): a release build keeps the login in the
Keychain and signs in again when the university's session dies; a debug
build keeps it in memory for the run. The session secret goes to the
Keychain too (`secret.rs`).

## Remote settings

An update takes the App Store's review. Meanwhile the app reads a small
signed file from tafac.fr, patches over its universities' settings: a
feature switched off, an address that moved within the university's own
domains. Data only, never code, never a new domain: `docs/REMOTE_SETTINGS.md`.

## Commands

| | |
|---|---|
| `npm run ios:dev -- "iPhone 17" --no-dev-server` | Builds the page and the server's copy (`ios:prepare`, before Tauri starts: Tauri copies the app's resources as it starts), then the app, and opens it in that simulator |
| `npm run ios:build -- --export-method debugging` | The app for a phone, a release build signed for development (team `P8XRQT7Z4K` in `tauri.ios.conf.json`, an Apple Development certificate in the keychain): `src-tauri/gen/apple/build/arm64/Tafac.ipa`. Onto a phone plugged in and unlocked: `xcrun devicectl device install app --device <its id, from devicectl list devices> <the .ipa>` |
| `npm run ios:prepare` | `desktop-build/ios/server/` and `desktop-build/ios/NodeMobile.xcframework` (downloaded once, checksum checked). `-- --skip-build` keeps `dist/` |

Needs Xcode, Rust with the iOS targets (`rustup target add aarch64-apple-ios
aarch64-apple-ios-sim`) and `rustup component add llvm-tools` (the Swift
plugins' symbols, in a release build), and what `tauri ios init` asks for
(Homebrew's xcodegen, libimobiledevice, cocoapods).

The Xcode project (`src-tauri/gen/apple`) is in the repository:
`project.yml` holds what was added by hand (the Node framework, French).
After a change there: `xcodegen generate` in that folder.

**In the simulator**, without rebuilding the app, after a change to the page
or the server:

```sh
npm run build && npm run ios:prepare -- --skip-build
APP=$(xcrun simctl get_app_container booted fr.tafac.ios app)
rsync -a --delete desktop-build/ios/server/ "$APP/assets/server/"
xcrun simctl terminate booted fr.tafac.ios; xcrun simctl launch booted fr.tafac.ios
```

The app's log (Node's output too):
`xcrun simctl spawn booted log show --last 1m --predicate 'subsystem == "fr.tafac.ios"'`.
`SIMCTL_CHILD_TAFAC_LOG_REQUESTS=1` logs each request of the page's, with
its answer's status, time and size, and `tonapi` after the ones tonAPI
answered (debug builds). `SIMCTL_CHILD_TAFAC_NO_TONAPI=1` leaves every route
to Node, to compare the two on the same build.
`SIMCTL_CHILD_TAFAC_START_PATH=/rennes` before `simctl launch` opens on that
page, and `SIMCTL_CHILD_TAFAC_PRESS_TAB=moodle,planning` presses those tabs
one after the other, a few seconds apart, by the way a finger does (debug
builds: nothing taps a simulator from a script).

**Signed in without tapping** (a debug build keeps the session secret in
the app's data folder): start the app, sign in over its socket, stop the
app, and write the cookie the answer set where the app keeps it.

```sh
DATA="$(xcrun simctl get_app_container booted fr.tafac.ios data)/Library/Application Support/fr.tafac.ios"
cd "$DATA" && curl --unix-socket s.sock -si http://localhost/__ent_auth/login \
  -H 'content-type: application/json' -H 'x-tafac-university: univ-rennes' \
  -d "{\"username\":\"$LOGIN\",\"password\":\"$PASSWORD\"}"
# cookies.json: {"__Host-lent_session": {"value": "<the cookie's value>", "expires_at": <Unix seconds>}}
```

The container's folder changes at each install: ask for it again.

## Releases

A release's iOS app goes to **TestFlight** by itself
(`.github/workflows/ios.yml`): built with the tag's version, signed for
distribution, uploaded to App Store Connect. The internal testers' group
there gets it once Apple has processed it (some minutes), with no review.

- **When**: with each release, called by `ci.yml` as the desktop app is,
  once the repository variable `IOS_RELEASE` is `true`; or by hand
  (Actions › iOS app › Run workflow) for a tag already pushed.
- **A test build**, the iOS app alone: by hand with no tag, a branch and a
  version (`gh workflow run ios.yml -f ref=main -f version=0.29.0`). No
  tag, no release, no image, no desktop app. Give it the next release's
  version: that release's build then follows it in TestFlight.
- **The key**: the App Store Connect API key the desktop app's notarization
  already uses (`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
  `APPLE_API_PRIVATE_KEY`). It signs (Xcode asks Apple for the distribution
  certificate and profile itself: none is kept in the secrets) and uploads,
  so its role must be Admin, or App Manager with access to certificates.
- **The version** is the tag's; **the build number** is the time of the
  build (`YYYYMMDDHHMM`), so a version built again always passes.
- **The runner** needs an Xcode with the iOS 26 SDK (the glass controls);
  the workflow takes the runner's newest and stops with a clear error
  otherwise.
- **What Apple asks of every app**, in the Xcode project
  (`src-tauri/gen/apple`): no alpha channel in the icons; the encryption
  declaration (`ITSAppUsesNonExemptEncryption: false`: HTTPS only); a
  privacy manifest (`tafac-desktop_iOS/PrivacyInfo.xcprivacy`: no tracking,
  the anonymous statistics, and the three system APIs Node and Rust use
  that need a reason). `project.yml` is the project's source: after a
  change there, `xcodegen generate` in that folder.
- **In App Store Connect, by hand, once**: the app (`fr.tafac.ios`), the
  internal testers' group, and the App Privacy answers, which must say the
  same as the manifest (usage data, not linked to the student, no
  tracking).
- **Not run yet**: the workflow was written without a run. The first one
  will say whether the key's role is enough and whether the runner's Xcode
  is recent enough.
- **Testers outside the team** need Apple's beta review of the first
  build: a login for the reviewer (the demo account), and the glass
  plugin's lookup of WebKit's content view by its class name may be
  questioned.

## Checked

In the iPhone 17 simulator (iOS 27), debug build:

- the app starts, Node starts in it (about half a second) and serves the
  page; the university picker and the demo account's dashboard show in the
  phone layout;
- behind the status bar: « Accueil »'s photo, the cream band of « Mes
  notes », the planning and the mail; no step between two tabs (a
  recording, frame by frame); scrolled, the veil over the bar on
  « Accueil » and « Mes notes », the planning's top and the mail's header
  stuck below it in their colour; « Réglages » opens below the bar, its
  backdrop over it;
- a grade's menu (opened from a script, where a long press would) is the
  system's, with the page's three items and their icons; the semester's
  dropdown is the system's menu over its button, the semester shown ticked;
- asked through the app's socket: the demo account signs in; a made-up login
  goes to the real CAS of Rennes and of Rennes 2 and comes back refused, as
  it should (`login_refused`): the HTTP client that replaces Node's does the
  CAS exchange;
- the server still answers after the app went to the background and came
  back;
- remote settings: a file served from this computer, signed with a test
  key, is checked by the Node inside the app and applied (the planning
  switched off: no « Planning » tab), and its patch to another domain is
  refused (a debug build; a release's address and key are the app's own);
- the system's tab bar shows the page's tabs with Tafac's icons; pressed
  (`TAFAC_PRESS_TAB`), « Planning » opens the planning and is selected;
- « Moodle » opens Moodle in the app, under its toolbar (the demo account
  has no session of the university's: Moodle's own sign-in page, with its
  title in the toolbar); another tab hides the view, « Moodle » again shows
  it where it was;
- pages kept (`TAFAC_PRESS_TAB=planning,home,grades,home,planning,home`,
  `TAFAC_LOG_REQUESTS=1`): each page is whole on its return, no placeholder;
  `/mail/recent` and `/moodle/deadlines` are asked once (4 times each
  before), « Accueil »'s clips about 720 times (2 789 before: some 700 as
  the page mounts, then 6 at each return); « Moodle » between two pages
  shows and hides as before.

The kept pages, in a headless Chromium: the built page from `node
server.js` at `http://tafac.localhost:<port>` with an iPhone's user agent
is the iOS app's for the page (`isIosApp()`), a tab pressed is a
`tafac:tab` event on window, the demo account signs in. Seen there: each
page's scroll back where it was left (the document's and, at 1180 px, the
column's), a first visit at the top, the selected tab to the top; no data
request on a return but the Messagerie's folders; `page_viewed` and
`dashboard_viewed` at each arrival with their source, no `*_loaded`; a
mail, a grade and « Afficher plus » from « Accueil » opening in pages
already alive; a grade's sheet and an open menu closing with their page,
the composer hidden and back; no interval left running by a hidden page;
only the switch effect playing on a return, none under reduced motion; no
page left after signing out; and the website (`http://127.0.0.1:<port>`)
unmounting its pages as before.

The glass, in the iPhone 18 Pro simulator (iOS 27), debug build, the demo
account, with a finger: a UI test's (XCUITest, on that simulator only: it
taps, drags, holds and flicks as a finger does), each run recorded and
read frame by frame:

- scrolled by flicks on « Accueil », « Mes notes », the planning and the
  mail: nothing sent to the app and no script of the glass's in the page
  while it scrolls (a look a second at most, about 1 ms); the app moves
  the controls in about 0.02 ms a frame. Before: the tab bar's script ran
  at every frame for good (9 ms of each, its colour reading woke its own
  watch of the page), the glass read the page again every 120 ms of a
  scroll (6 to 9 ms) and sent up to 7 messages a second (77 KB): the page
  drew 23 to 28 frames a second while scrolling, 60 now;
- pulled past both ends and held: a ring drawn around each page element
  under glass, the glass sits in its ring in every frame, for the three
  rules: « Accueil »'s account button down with the page, the planning's
  header down with the page past its top and held past its end, the mail
  reader's toolbar held to the screen at both ends while its way back goes
  down with the page;
- under the status bar: « Accueil »'s account button fades as the veil
  covers it, nothing crisp is left over the bar;
- a tab pressed: the page and its controls change in the same frame, a
  page seen before or not (told without the frame's mark, the glass was
  there 4 to 6 frames ahead of its page); a first visit shows what the
  page shows, a pill before its icon;
- a sheet (« Simuler ») opened from its glass button and closed: the
  page's own pills under the sheet's backdrop, no glass left over it, and
  a dissolve from the page's pill to the glass as it closes, no frame with
  neither;
- a mail opened and left: the list's controls go with the list, the
  reader's way back and toolbar come in with the mail's slide, the list's
  come back with its own; the toolbar's buttons take a press over their
  whole height (the tab bar's place took their lower half);
- pressed: the glass grows and lights under the finger, and the page's own
  button is what is pressed (a trusted click on it): the semester's menu
  opens from its glass, « Actualiser » turns its icon, a mail's flag turns
  orange in the glass; a long press on glass laid over a grade opened that
  grade's menu; a flick started on a glass control scrolls the page;
- the dark theme (set by a script): dark glass, the page's light ink, the
  tinted button in the dark theme's own colour;
- « Assiduité » (opened from « Accueil »): its semester's pill in glass.

On an iPhone 15 Pro, a release build (51 MB to install): it installs, starts
and stays running. Nothing more was seen of it from here: what its screen
shows, signing in, the Keychain keeping the login.

## Not done yet

- **A phone**: beyond starting (above), the Keychain (release builds only)
  and what iOS does to a suspended app's socket are untested.
- **A real account**: one was signed in over the app's socket, in the
  simulator (« tonAPI », above): the dashboard's requests all answer. Not
  seen: the screens themselves, the login typed in the app, a phone.
- **tonAPI**: the sign-in made in the app, the session it makes and the
  sign-out were not run on a phone or in the simulator (the bridge's tests
  run them on a made-up campus, on a Mac). On a phone nothing was measured
  (Node without a JIT is slower there than in the simulator). A release
  build's size with tonAPI in it wasn't measured either (the gateway's own
  server, built for release, is 3.4 MB on this Mac).
- **Taps**: a UI test taps the simulator as a finger does (it was written
  for the glass, « Checked », and isn't in the repository: a test target
  with `XCUIApplication(bundleIdentifier: "fr.tafac.ios")`, run with
  `xcodebuild test-without-building -destination id=<the simulator>`).
  Beyond the glass, nothing was tapped: the keyboard, the mail composer, a
  link in a mail, an app tile are unverified, and so is the tab bar hiding
  under a sheet. The system's menu was seen open, not picked from.
- **Behind the status bar, not looked at**: the sign-in and first set-up
  screens, the bottom sheets (a class, a grade), the mail's reader and
  composer, the dark theme, a pull down past « Accueil »'s top (the photo
  doesn't follow). A tablet keeps the bar's plain strip.
- **Kept pages, in WebKit**: nothing scrolls the simulator from a script,
  so a page's scroll coming back was only seen in Chromium (above), and so
  were the « open this » requests and the sheets closing. Not seen
  anywhere: « Accueil »'s clips stopped mid-turn (the tab hook presses
  after they end), a row scrolled sideways keeping its place while its page
  is hidden, a session left open for hours (the pages are kept as long as
  the web view lives).
- **Glass, not seen**: on a phone at all (how smooth the glass itself is
  under a finger at 120 Hz: the simulator draws it with the Mac's graphics
  card, at 60 Hz; the flicks' fastest frames aren't in the recordings
  either); landscape; VoiceOver (the glass is hidden from it, the page's
  elements are what it should read); « Reduce Transparency » and « Increase
  Contrast »; the PDF button of « Mes notes » and the spinner in it (not in
  the demo account); the planning's « Aujourd’hui » pill coming and going;
  a real account's pages. On a tablet there is none (501).
- **Glass, known**: a control's picture is in the page's colours and
  doesn't change with what is behind it (the glass keeps the page's
  theme, so it reads); the page's own press effect (it gives a little) is
  replaced by the glass's; several animations at once over a control are
  played as one (a few points off for a third of a second, as a mail
  comes in).
- **Moodle's toolbar on a phone** lies behind the status bar (the page is
  held to the screen's top edge): its buttons are under the clock. Not
  glass until it has its place.
- **The planning pulled past its end**: what scrolls shows over the status
  bar, above the header held below it (the header's band doesn't reach up
  there while the page bounces).
- **Downloads were written without being run** (« Links », Files): the code
  compiles, nothing more. No file was downloaded in the simulator or on a
  phone, and no test covers it. Unverified: that WebKit hands a blob link
  clicked from a script to the app's download delegate on iOS as it does
  on macOS; the share sheet showing, over the browser sheet too, and on a
  tablet (its bubble); the temporary folder going after « Enregistrer dans
  Fichiers », AirDrop, or the sheet closed; a file of the app's downloaded
  as it is, where the page didn't make a blob of it first (an app route
  answering with a file WebKit can't show), which may fail as on macOS.
- **Moodle, signed in**: only Moodle's sign-in page was seen (the demo
  account). The relay's sign-in (Rennes' goes through a page that posts
  itself), Tafac's look on Moodle's own pages, a file's share sheet, a new
  sign-in when Moodle's session runs out: unverified.
- **Saved passwords** (the system's sheet for tafac.fr): the desktop's code
  is AppKit's.
- **Updates**: the App Store's. Remote settings mend what settings can
  (above); nothing locks an old version out (`minimum`).
- **Size**: Node is 55 MB on a phone, the page's files 27 MB.
- **The icon** is the web app's 512 px picture, enlarged (its alpha
  channel taken off for the App Store); it still reads « l'ent ».
- **CI**: the TestFlight workflow has never run (« Releases »); nothing
  builds the iOS app on a pull request.
- **Android**: nodejs-mobile has it; nothing here was written for it.
