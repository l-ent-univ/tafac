import { Icon } from '@iconify/react'
import CardInfoTip from './CardInfoTip'
import { r } from '../register.js'

// Login page, desktop app only (src/desktopApp.js): the password never
// reaches Tafac's server there, since the app runs the server on the
// student's computer (docs/DESKTOP.md). The ⓘ says why the site differs.
// `afterNote`: under the university's password note, which already names
// the password.
function DesktopPasswordNote({ afterNote = false }) {
  return (
    <p className="m-0 inline-flex items-center justify-center gap-1.5">
      {afterNote ? null : <Icon icon="ph:lock" className="h-[14px] w-[14px] shrink-0" aria-hidden="true" />}
      <span>
        {afterNote
          ? 'Il ne passe pas par Tafac'
          : r('Ton mot de passe ne passe pas par Tafac', 'Votre mot de passe ne passe pas par Tafac')}
      </span>
      <CardInfoTip label="Pourquoi ?">
        {r(
          "Dans l'appli, ton mot de passe va directement à ton université. Sur le site, il passe par Tafac, car un navigateur ne peut pas se connecter seul à l'université.",
          "Dans l'appli, votre mot de passe va directement à votre université. Sur le site, il passe par Tafac, car un navigateur ne peut pas se connecter seul à l'université.",
        )}
      </CardInfoTip>
    </p>
  )
}

export default DesktopPasswordNote
