import { createContext } from 'react'

// The signature MailSignatureView draws inside the text (MailComposer
// provides it): { kind: 'auto' | 'partage' | 'custom', auto: { name,
// login, group, establishment, university, logos: [{ src, srcDark, alt }] }
// | null, own: { status, signature: { html, text, hasImages } | null } },
// or null.
export const MailSignatureContext = createContext(null)
