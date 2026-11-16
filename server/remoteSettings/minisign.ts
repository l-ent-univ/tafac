// A minisign signature, checked: the format of the desktop app's updates
// (`tauri signer sign`), so the remote settings are signed with the same
// key and the same command.
//
// The public key and the signature come as Tauri writes them: the minisign
// file's text, in base64. A signature made by `tauri signer` is over the
// file's BLAKE2b-512 digest (« ED »); the older form over the file itself
// (« Ed ») is read too. The trusted comment (the date, the file's name) is
// signed with it: both are checked.
import { createHash, createPublicKey, verify } from 'node:crypto'

// What goes before a raw Ed25519 public key for Node to read it (SPKI, DER).
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex')
const TRUSTED_COMMENT = 'trusted comment: '

// The file's text, whether given as it is or in base64.
function fileText(value: string): string {
  const text = value.trim()
  return text.includes('comment:') ? text : Buffer.from(text, 'base64').toString('utf8').trim()
}

interface Key { id: Buffer, key: Buffer }
interface Signature { prehashed: boolean, id: Buffer, signature: Buffer, trustedComment: string, globalSignature: Buffer }

function parsePublicKey(value: string): Key | null {
  const line = fileText(value).split('\n').map((entry) => entry.trim()).filter((entry) => entry && !entry.includes('comment:')).at(-1)
  const bytes = Buffer.from(line ?? '', 'base64')
  if (bytes.length !== 42 || bytes.subarray(0, 2).toString('latin1') !== 'Ed') return null
  return { id: bytes.subarray(2, 10), key: bytes.subarray(10) }
}

function parseSignature(value: string): Signature | null {
  const lines = fileText(value).split('\n').map((entry) => entry.trim()).filter(Boolean)
  const commentAt = lines.findIndex((entry) => entry.startsWith(TRUSTED_COMMENT))
  if (commentAt < 1 || commentAt + 1 >= lines.length) return null
  const bytes = Buffer.from(lines[commentAt - 1] ?? '', 'base64')
  const algorithm = bytes.subarray(0, 2).toString('latin1')
  const globalSignature = Buffer.from(lines[commentAt + 1] ?? '', 'base64')
  if (bytes.length !== 74 || !['Ed', 'ED'].includes(algorithm) || globalSignature.length !== 64) return null
  return {
    prehashed: algorithm === 'ED',
    id: bytes.subarray(2, 10),
    signature: bytes.subarray(10),
    trustedComment: (lines[commentAt] ?? '').slice(TRUSTED_COMMENT.length),
    globalSignature,
  }
}

// Whether `signature` is `publicKey`'s over `data`. Anything that doesn't
// read (a key, a signature, a text that isn't one) is a no.
export function verifySignature(data: Uint8Array, signature: string, publicKey: string): boolean {
  try {
    const key = parsePublicKey(publicKey)
    const signed = parseSignature(signature)
    if (!key || !signed || !key.id.equals(signed.id)) return false
    const publicKeyObject = createPublicKey({ key: Buffer.concat([ED25519_SPKI, key.key]), format: 'der', type: 'spki' })
    const message = signed.prehashed ? createHash('blake2b512').update(data).digest() : Buffer.from(data)
    if (!verify(null, message, publicKeyObject, signed.signature)) return false
    return verify(null, Buffer.concat([signed.signature, Buffer.from(signed.trustedComment, 'utf8')]), publicKeyObject, signed.globalSignature)
  } catch {
    return false
  }
}
