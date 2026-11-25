import { createContext } from 'react'

// The mail a forward sends on, for MailForwardedView to show it (MailComposer
// provides it): { messageId, message (getMailMessage's, when the composer
// has it already: a forward just opened) }, or null.
export const MailForwardedContext = createContext(null)
