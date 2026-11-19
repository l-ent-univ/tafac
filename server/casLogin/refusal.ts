// The CAS's answer to the login and password, when it is not a sign-in.
//
// The CAS lets a sign-in through with a redirect. Any other answer of its own
// to the form (the form again with « wrong password », a locked account, a
// password to change, a step the server can't take) is a refusal: the same
// login and password would be refused again. The login route says so with
// `code: 'login_refused'`, and the desktop app then forgets the login it
// kept to sign in again by itself (src-tauri/src/signin.rs). An outage (5xx)
// or the CAS slowing logins down (429) is not a refusal: the same login may
// go through later.

export const LOGIN_REFUSED = 'login_refused'

export class CasLoginRefusedError extends Error {
  readonly code = LOGIN_REFUSED
}

export function isCasRefusal(status: number): boolean {
  if (status === 429) return false
  if (status >= 300 && status < 400) return false
  return status >= 200 && status < 500
}
