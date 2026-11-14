import universityConfig from '@university'
import CardInfoTip from './CardInfoTip'
import { r } from '../register.js'

// Login page, under « Se connecter », desktop app only (src/desktopApp.js):
// the password never reaches Tafac's server there, since the app runs the
// server on the student's computer (docs/DESKTOP.md).
function DesktopPasswordNote() {
  const university = universityConfig.branding.nameInText ?? r('ton université', 'votre université')

  return (
    <p className="m-0 flex items-center justify-center gap-1.5 pt-3 text-[13px] font-medium leading-[1.35] text-text-muted font-body">
      <span>Ne transite pas sur le serveur de Tafac</span>
      <CardInfoTip label="Pourquoi ?">
        {r('Ton mot de passe', 'Votre mot de passe')} ne passe pas par les serveurs de Tafac mais uniquement par ceux de {university} sur l'application
      </CardInfoTip>
    </p>
  )
}

export default DesktopPasswordNote
