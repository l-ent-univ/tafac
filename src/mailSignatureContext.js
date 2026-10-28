import { createContext } from 'react'

// The automatic signature's lines and logos (MailComposer provides them,
// MailSignatureView draws them inside the text): { name, group,
// establishment, university, logos: [{ src, srcDark, alt }] }, or null.
export const MailSignatureContext = createContext(null)
