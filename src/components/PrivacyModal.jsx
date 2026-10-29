import { useEffect } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { isPostHogAvailable } from '../analytics'
import lentLogo from '../assets/lent-logo.svg'
import cloudsTexture from '../assets/privacy/clouds.webp'
import busImage from '../assets/privacy/bus.webp'
import treeImage from '../assets/privacy/tree.webp'
import studentsImage from '../assets/privacy/students.webp'
import flowerImage from '../assets/privacy/flower.webp'
import bikeImage from '../assets/privacy/bike.webp'
import housesImage from '../assets/privacy/houses.webp'
import butterflyImage from '../assets/privacy/butterfly.webp'
import { APP_NAME } from '../seo'
import CloseButton from './CloseButton'
import LentButton from './LentButton'

// "Tes données restent à toi": what the anonymous audience measurement does
// and doesn't do, in the illustrated style of the Figma presentation screens
// (toutatice, node 543:959). Shown inline in Réglages › Confidentialité, and
// as a modal from À propos.

// Header collage rebuilt from the Figma layers (frame "illu", 402×293) so the
// sky gradient can follow the theme. Geometry is Figma's, in frame pixels:
// [left, top, width, height] of the rotated bounding box, then the element's
// own size and rotation inside it. Converted to percentages below.
const FRAME_W = 402
const FRAME_H = 293
const COLLAGE = [
  { src: busImage, box: [-83, 46, 235.902, 118.044], size: [226, 88], rotate: 7.85 },
  { src: treeImage, box: [186, 47, 187.269, 181.114], size: [143.435, 127.865], rotate: -28.77, crop: '189.43%' },
  { src: studentsImage, box: [99, 11, 198.71, 247], size: [198.71, 247], rotate: 0 },
  { src: flowerImage, box: [74, 133, 92.848, 92.848], size: [76.501, 76.501], rotate: 14.12 },
  { src: lentLogo, box: [111.43, 172, 180.134, 101], size: [180.134, 101], rotate: 0, contain: true },
  { src: bikeImage, box: [-30, 126, 130.885, 130.885], size: [107.332, 107.332], rotate: -14.57 },
  { src: housesImage, box: [277, 72, 230.503, 190.891], size: [203.825, 152.868], rotate: -11.65 },
  { src: butterflyImage, box: [241, 210, 86.397, 86.397], size: [73, 73], rotate: -11.81 },
]

const pct = (value, total) => `${(value / total) * 100}%`

function PrivacyIllustration() {
  return (
    <div className="privacy-illustration relative w-full aspect-[402/293] overflow-hidden select-none [mask-image:linear-gradient(to_bottom,#000_86%,transparent)]" aria-hidden="true">
      <img
        src={cloudsTexture}
        alt=""
        className="privacy-illustration-clouds absolute max-w-none object-cover mix-blend-soft-light -scale-y-100"
        style={{ left: pct(-348, FRAME_W), top: pct(-473, FRAME_H), width: pct(1160.24, FRAME_W), height: pct(780.7, FRAME_H) }}
      />
      {COLLAGE.map(({ src, box: [left, top, width, height], size: [innerWidth, innerHeight], rotate, crop, contain }) => (
        <div
          key={src}
          className="absolute flex items-center justify-center"
          style={{ left: pct(left, FRAME_W), top: pct(top, FRAME_H), width: pct(width, FRAME_W), height: pct(height, FRAME_H) }}
        >
          <div
            className="relative shrink-0 overflow-hidden"
            style={{ width: pct(innerWidth, width), height: pct(innerHeight, height), rotate: `${rotate}deg` }}
          >
            <img
              src={src}
              alt=""
              draggable="false"
              className={`absolute left-0 top-0 max-w-none w-full ${contain ? 'h-full object-contain' : crop ? '' : 'h-full object-cover'}`}
              style={crop ? { height: crop } : undefined}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

const ANALYTICS_DOC_URL = universityConfig.branding.about?.repoUrl
  ? `${universityConfig.branding.about.repoUrl.replace(/\/$/, '')}/blob/main/docs/ANALYTICS.md`
  : null

function getToolsSentence() {
  return isPostHogAvailable()
    ? 'Un seul outil, hébergé dans l’Union européenne\u202f: PostHog, appelé par le serveur, jamais par ton navigateur'
    : 'L’outil de mesure est hébergé dans l’Union européenne'
}

const getSections = (embedded) => [
  {
    emoji: '🕶️',
    title: 'Anonyme',
    body: () => 'Aucun nom, identifiant, note, mail ou devoir n\'est collecté, juste des compteurs de visites et les erreurs rencontrées',
  },
  {
    emoji: '🍪',
    title: 'Sans cookie',
    body: () => 'Rien n’est déposé sur ton appareil pour te suivre, aucun suivi permanent.',
  },
  {
    emoji: '🇪🇺',
    title: 'Hébergé en Europe',
    body: getToolsSentence,
  },
  {
    emoji: '🎚️',
    title: 'Tu gardes la main',
    body: () => (embedded
      ? 'Coupe « Statistiques anonymes » juste au-dessus et plus rien n’est envoyé'
      : 'Désactive « Statistiques anonymes » dans les réglages et plus rien n’est envoyé'),
  },
]

// Illustration, promise and the four points. `control` (the analytics
// switch, when embedded) sits between the promise and the points; `actions`
// sits above the link to the full list.
export function PrivacyContent({ embedded = false, control = null, actions = null }) {
  return (
    <>
      <div className={embedded ? 'mx-auto w-full max-w-[420px] shrink-0 overflow-hidden corners-[20px]' : ''}>
        <PrivacyIllustration />
      </div>

      <div className={`flex flex-col items-center gap-7 text-center ${embedded ? 'pt-1' : 'px-7 pt-1 pb-7 max-sm:px-5'}`}>
        <div className="flex flex-col items-center gap-2">
          <p
            id={embedded ? undefined : 'privacy-modal-title'}
            role="heading"
            aria-level={embedded ? 4 : 2}
            className={`m-0 font-display font-bold leading-[1.05] tracking-[-0.01em] ${embedded ? 'text-[28px] max-sm:text-[24px]' : 'text-[32px] max-sm:text-[28px]'}`}
          >
            Tes données restent à toi
          </p>
          <p className="m-0 text-[15px] font-medium leading-[1.35] opacity-90">
            {APP_NAME} compte ses visites pour savoir ce qui sert vraiment et réparer ce qui casse
          </p>
        </div>

        {control ? <div className="w-full text-left">{control}</div> : null}

        <div className="grid w-full grid-cols-2 gap-x-5 gap-y-6 max-sm:grid-cols-1">
          {getSections(embedded).map((section) => (
            <div key={section.title} className="flex flex-col items-center gap-1.5">
              <span className="privacy-modal-emoji text-[44px] leading-none" aria-hidden="true">{section.emoji}</span>
              <p role="heading" aria-level={embedded ? 5 : 3} className="m-0 font-display text-[19px] font-bold leading-[1.1] tracking-[-0.01em]">
                {section.title}
              </p>
              <p className="m-0 text-[14px] font-medium leading-[1.35] opacity-80">
                {section.body()}
              </p>
            </div>
          ))}
        </div>

        {actions || ANALYTICS_DOC_URL ? (
          <div className="flex flex-col items-center gap-3">
            {actions}
            {ANALYTICS_DOC_URL ? (
              <a
                href={ANALYTICS_DOC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-medium underline underline-offset-2 opacity-70 hover:opacity-100"
              >
                Voir le détail de ce qui est collecté
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )
}

function PrivacyModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined
    // Capture phase so Escape closes only this modal, not the account modal below.
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="weather-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-backdrop p-5 animate-modal-backdrop-in max-sm:p-[14px]"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
      role="presentation"
    >
      <section
        className="privacy-modal relative font-body w-[min(500px,100%)] max-h-[calc(100dvh-40px)] overflow-y-auto overflow-x-hidden corners-[28px] border border-[var(--color-border)] bg-[#f5f3ed] text-[#341200] animate-modal-card-in dark:bg-[var(--color-bg)] dark:text-[var(--color-text)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <CloseButton glass className="absolute top-3 right-3 z-10" onClick={onClose} />

        <PrivacyContent
          actions={(
            <LentButton className="px-7!" onClick={onClose}>
              Compris
            </LentButton>
          )}
        />
      </section>
    </div>
  )
}

export default PrivacyModal
