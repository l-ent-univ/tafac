import { useContext } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { MailSignatureContext } from '../mailSignatureContext'

// The automatic signature as the text shows it (the mailSignature node,
// src/mailSignatureNode.js): a dash above, the student's name, their group
// when known, their establishment and university, then the logos (each
// with its dark version, as the sidebar's). Not editable: it's filled in.
function MailSignatureView() {
  const signature = useContext(MailSignatureContext)
  if (!signature) return <NodeViewWrapper as="div" />
  const place = [signature.establishment, signature.university].filter(Boolean).join(' – ')
  return (
    <NodeViewWrapper as="div" className="mail-composer-signature" contentEditable={false} data-mail-signature="">
      <span className="mail-composer-signature-rule" aria-hidden="true">—</span>
      {signature.name ? <span className="mail-composer-signature-name">{signature.name}</span> : null}
      {signature.group ? <span>{signature.group}</span> : null}
      {place ? <span className="mail-composer-signature-place">{place}</span> : null}
      {signature.logos.length ? (
        <span className="mail-composer-signature-logos">
          {signature.logos.map((logo) => (
            <span key={logo.src} className="contents">
              <img src={logo.src} alt={logo.alt} className={logo.srcDark ? 'dark:hidden' : ''} draggable={false} />
              {logo.srcDark ? <img src={logo.srcDark} alt={logo.alt} className="hidden dark:block" draggable={false} /> : null}
            </span>
          ))}
        </span>
      ) : null}
    </NodeViewWrapper>
  )
}

export default MailSignatureView
