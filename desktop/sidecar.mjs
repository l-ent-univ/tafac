// Desktop app (Tauri) entry point of the server: the same server.js as
// tafac.fr, run on the student's computer. src-tauri starts it with:
//
//   PORT            a Unix socket path (a named pipe on Windows), not a TCP
//                   port: nothing listens on the network, the window reaches
//                   it through the tafac:// scheme (src-tauri/src/bridge.rs);
//   SESSION_SECRET  generated once per install, kept in the app's data folder;
//   DATA_DIR        the app's data folder (remembered app icons).
//
// The student's password and university cookies go from here straight to
// the university: they never pass through tafac.fr.
//
// stdin is a pipe from the app: when the app quits (or crashes) it closes,
// and the server stops with it.
process.stdin.on('end', () => process.exit(0))
process.stdin.on('error', () => process.exit(0))
process.stdin.resume()

await import('../server.js')
