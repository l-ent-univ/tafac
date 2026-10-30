import { createContext } from 'react'

// The text's images as the composer holds them (useInlineImages), for their
// view in the editor (MailInlineImageView): { items: Map(cid → item, with
// its `url`), retry(cid) } or null.
export const MailInlineImageContext = createContext(null)
