// Polyfill/silence deprecation warning for util._extend (DEP0060).
// Third-party packages such as http-proxy (used by http-proxy-middleware)
// still call require('util')._extend, which triggers DEP0060 in modern Node.js runtimes.
// Node's official recommendation for util._extend is Object.assign.
import util from 'node:util'

if (typeof util._extend === 'function' && util._extend !== Object.assign) {
  util._extend = Object.assign
}
