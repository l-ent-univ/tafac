// iOS app (Tauri) entry point of the server: the same server.js as tafac.fr,
// run inside the app on the student's phone (src-tauri/src/node.rs), with the
// environment sidecar.mjs describes: PORT is a Unix socket in the app's own
// folder, which no other app can open.
//
// The student's password and university cookies go from here straight to
// the university: they never pass through tafac.fr.
//
// Node here is nodejs-mobile's (Node 18, no JIT, no ICU):
// scripts/ios-prepare.mjs rewrites the server's files for it, and
// iosRuntime.mjs puts back what it lacks (fetch, Intl…) before the server
// loads. It shares the app's process, so nothing here may end it: no watch
// on stdin as on the desktop, the server stops when iOS stops the app.
await import('./iosRuntime.mjs')
await import('../server.js')
