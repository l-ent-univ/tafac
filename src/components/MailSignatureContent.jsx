import { signatureLoginLine } from '../mailSignatureChoice'
import MailSignatureHtml from './MailSignatureHtml'

// The signature as the composer's text shows it (MailSignatureView) and as
// Réglages › Messagerie previews it, from what MailSignatureContext holds:
// { kind, auto, own: { status, signature } }.
//
// The automatic one: a dash above, the student's name, their CAS login
// where the university shows it (mail.signature.showLogin), their group
// when known, their establishment and university, then the logos (each
// with its dark version, or inverted in dark mode without one, as the
// sidebar's). The student's own (« Partage », « Personnalisée »): its HTML,
// as the server cleaned it (MailSignatureHtml), or why there's none.
function AutoSignature({ signature }) {
  // Said once when the establishment is the university (Rennes 2), as the
  // sent mail's (server/mailSend.js).
  const place = [...new Set([signature.establishment, signature.university].filter(Boolean))].join(' – ')
  return (
    <>
      <span className="mail-composer-signature-rule" aria-hidden="true">—</span>
      {signature.name ? <span className="mail-composer-signature-name">{signature.name}</span> : null}
      {signature.login ? <span>{signatureLoginLine(signature.login)}</span> : null}
      {signature.group ? <span>{signature.group}</span> : null}
      {place ? <span className="mail-composer-signature-place">{place}</span> : null}
      {signature.logos.length ? (
        <span className="mail-composer-signature-logos">
          {signature.logos.map((logo) => (
            <span key={logo.src} className="contents">
              <img src={logo.src} alt={logo.alt} className={logo.srcDark ? 'dark:hidden' : 'dark:invert'} draggable={false} />
              {logo.srcDark ? <img src={logo.srcDark} alt={logo.alt} className="hidden dark:block" draggable={false} /> : null}
            </span>
          ))}
        </span>
      ) : null}
    </>
  )
}

const OWN_SIGNATURE_EMPTY = {
  partage: 'Aucune signature dans Partage',
  custom: 'Signature personnalisée vide',
}

function MailSignatureContent({ value }) {
  if (!value) return null
  if (value.kind === 'auto') return value.auto ? <AutoSignature signature={value.auto} /> : null
  if (value.own?.signature) return <MailSignatureHtml html={value.own.signature.html} />
  return (
    <span className="mail-composer-signature-hint">
      {value.own?.status === 'loading' ? 'Chargement de la signature…' : value.own?.status === 'error' ? 'Signature indisponible pour le moment' : OWN_SIGNATURE_EMPTY[value.kind]}
    </span>
  )
}

export default MailSignatureContent
