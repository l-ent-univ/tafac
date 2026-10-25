import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { getPapillonUrl, PAPILLON_DEBUG_KEY, readPapillonDebugOverride } from '../../papillon'
import { isServiceNoticeHiddenByDebug, SERVICE_NOTICE_DEBUG_KEY } from '../../serviceNoticeDebug'
import { getLoadedUniversityId, writeUniversityChoice } from '../../universityRuntime'
import { replayChangelogEntry } from '../../changelogStore'
import { listHeroImages } from '../../heroImage'
import { persistTheme } from '../../theme'
import { findProfilePhotoCandidate } from '../../profilePhoto'
import { MUTED_FILL_CLASSES } from '../../settingsStyles'
import {
  getAccountInfo,
  getAdeAlerts,
  getAdeCalendarMetadata,
  getAdeStatus,
  getAdeTimetable,
  getAdeTree,
  getAdeUpcoming,
  getAverageGrade,
  getGrades,
  getLatestGrade,
  getLayout,
  getMarketplaceEntries,
  getPlanning,
  getStudentProfilePictureMeta,
  logoutFromEnt,
  requestEnt,
  searchAde,
} from '../../entApi'
import { DebugButton, DebugField, DebugRow, DebugSection, DebugSegmented, DebugSwitchRow } from './DebugControls'
import CloseButton from '../CloseButton'
import DebugOutput from './DebugOutput'
import { clearClientRuntimeState, getErrorMessage, resolveDebugImagePreviewFromSnapshot } from './debugUtils'

const DEFAULT_REQUEST_PATH = '/api/v4-3/dlm/layout.json'
// Both read once, at load (src/papillon.js, src/serviceNoticeDebug.js):
// their toggles write the override, then reload.
const PAPILLON_OVERRIDE = readPapillonDebugOverride()
const IS_PAPILLON_SHOWN = getPapillonUrl(universityConfig.branding, PAPILLON_OVERRIDE) !== null
const IS_SERVICE_NOTICE_HIDDEN = isServiceNoticeHiddenByDebug()

const THEME_OPTIONS = [['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']]
const ENT_CALLS = [
  ['Account', getAccountInfo],
  ['Layout', getLayout],
  ['Planning', getPlanning],
  ['Marketplace', getMarketplaceEntries],
  ['Grades', getGrades],
  ['Latest Grade', getLatestGrade],
  ['Average Grade', getAverageGrade],
]
const SECTIONS = [
  ['debug-session', 'Session'],
  ['debug-university', 'Université'],
  ['debug-appearance', 'Apparence'],
  ['debug-display', 'Affichage'],
  ['debug-notices', 'Notices'],
  ['debug-api', 'API'],
  ['debug-output', 'Sortie'],
]
const SIGNED_OUT_TITLE = 'Se connecter d’abord'

// Writes a load-time override, then reloads so every reader picks it up.
function writeAndReload(write) {
  try {
    write()
  } catch {
    return
  }
  window.location.reload()
}

// Dev only (lazy-loaded by App.jsx behind import.meta.env.DEV). Stays
// mounted once loaded, so the fields, the output's tab and the photo
// preview survive closing it; App owns what the rest of the app reads.
export default function DebugMenu({
  open,
  onToggle,
  onClose,
  sessionState,
  onRefreshSession,
  credentials,
  onCredentialsChange,
  onLogin,
  onLogout,
  onRestartOnboarding,
  debugState,
  onDebugStart,
  onDebugCommit,
  theme,
  onThemeChange,
  establishment,
  heroImage,
  hasCustomBackground,
  onHeroShift,
  debugNextClass,
  onDebugNextClassChange,
  hasPendingUpdate,
  onPendingUpdateChange,
  onShowInstallPrompt,
  onShowIosPrompt,
  onShowUpdatePrompt,
  onShowWelcomeFromLent,
  selectedTp,
  nextClassLookaheadDays,
}) {
  const [outputTab, setOutputTab] = useState('api')
  const [imagePreview, setImagePreview] = useState(null)
  const [requestPath, setRequestPath] = useState(DEFAULT_REQUEST_PATH)
  const [adeSearchQuery, setAdeSearchQuery] = useState('')
  const usernameInputRef = useRef(null)

  useEffect(() => {
    function handleWindowKeydown(event) {
      const key = String(event.key ?? '').toLowerCase()

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'd') {
        event.preventDefault()
        onToggle()
      }

      if (key === 'escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleWindowKeydown)
    return () => window.removeEventListener('keydown', handleWindowKeydown)
  }, [onToggle, onClose])

  // Signed out, opening the menu puts the cursor in its sign-in form.
  useEffect(() => {
    if (!open || sessionState.authenticated) {
      return undefined
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      usernameInputRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [open, sessionState.authenticated])

  const runDebugAction = useCallback(async (label, action) => {
    setOutputTab('api')
    setImagePreview(null)
    onDebugStart(label)

    try {
      const result = await action()
      onDebugCommit(label, result)
      return result
    } catch (error) {
      onDebugCommit(label, null, getErrorMessage(error))
      return null
    }
  }, [onDebugCommit, onDebugStart])

  const handleProfilePhoto = useCallback(async () => {
    setOutputTab('api')
    setImagePreview(null)
    onDebugStart('Photo profil')

    try {
      let profilePictureInfo = null

      try {
        profilePictureInfo = await getStudentProfilePictureMeta()
      } catch (profilePhotoError) {
        profilePictureInfo = {
          available: false,
          source: 'profile-photo',
          error: getErrorMessage(profilePhotoError),
        }
      }

      const profilePreviewUrl = profilePictureInfo?.available && profilePictureInfo?.previewUrl
        ? `${profilePictureInfo.previewUrl}${profilePictureInfo.previewUrl.includes('?') ? '&' : '?'}ts=${Date.now()}`
        : null

      if (profilePreviewUrl) {
        setImagePreview({
          src: profilePreviewUrl,
          fieldPath: 'student-pic',
          kind: profilePictureInfo.source ?? 'profile-photo',
        })

        onDebugCommit('Photo profil', profilePictureInfo)
        return
      }

      const accountResponse = await getAccountInfo()
      const accountPayload = accountResponse?.account ?? null
      const photoCandidate = findProfilePhotoCandidate(accountPayload)

      setImagePreview(photoCandidate ? {
        src: photoCandidate.src,
        fieldPath: photoCandidate.fieldPath,
        kind: photoCandidate.kind,
      } : null)

      onDebugCommit('Photo profil', {
        profilePicture: profilePictureInfo,
        authenticated: accountResponse?.authenticated ?? false,
        photo: photoCandidate ? {
          available: true,
          fieldPath: photoCandidate.fieldPath,
          sourceKind: photoCandidate.kind,
          previewUrl: photoCandidate.src,
        } : {
          available: false,
          reason: "Aucun champ d'image courant n'a été trouvé dans les données du compte.",
        },
        account: accountPayload,
      })
    } catch (error) {
      setImagePreview(null)
      onDebugCommit('Photo profil', null, getErrorMessage(error))
    }
  }, [onDebugCommit, onDebugStart])

  const handleFullReset = useCallback(async () => {
    onDebugStart('Reset complet')

    try {
      if (sessionState.authenticated) {
        try {
          await logoutFromEnt()
        } catch {
          // Continue with the client reset even if server logout fails.
        }
      }

      await clearClientRuntimeState()
      window.location.reload()
    } catch (error) {
      onDebugCommit('Reset complet', null, getErrorMessage(error))
    }
  }, [onDebugCommit, onDebugStart, sessionState.authenticated])

  if (!open) {
    return null
  }

  const { authenticated, checking } = sessionState
  const busy = debugState.loading
  const sessionLabel = checking
    ? 'Vérification de session…'
    : authenticated
      ? sessionState.user
        ? `Connecté : ${sessionState.user}`
        : 'Connecté'
      : 'Déconnecté'

  const heroImages = listHeroImages(establishment)
  const heroImageIndex = heroImages.findIndex((image) => image.src === heroImage.src)
  const heroStatus = hasCustomBackground
    ? 'Fond personnalisé actif : la rotation est ignorée'
    : heroImages.length > 1
      ? `${heroImageIndex + 1} / ${heroImages.length}${heroImage.credit?.author ? ` · ${heroImage.credit.author}` : ''}`
      : heroImages.length === 1 ? 'Une seule photo configurée' : 'Aucune photo : image générique'
  const canShiftHero = !hasCustomBackground && heroImages.length >= 2
  const loadedUniversityId = getLoadedUniversityId()
  const selectedAdeResourceId = selectedTp?.resourceId ?? undefined
  const adeCalls = [
    ['ADE Status', () => getAdeStatus()],
    ['ADE Calendar', () => getAdeCalendarMetadata({ resourceId: selectedAdeResourceId })],
    ['ADE Tree', () => getAdeTree()],
    ['ADE Timetable', () => getAdeTimetable({ force: true, resourceId: selectedAdeResourceId })],
    ['ADE Upcoming', () => getAdeUpcoming({
      date: new Date().toISOString().slice(0, 10),
      lookaheadDays: nextClassLookaheadDays,
      selection: selectedTp,
    })],
    ['ADE Alerts', () => getAdeAlerts()],
  ]
  // The button whose answer the output shows.
  const callTone = (label) => (debugState.label === label ? 'active' : 'default')

  function handleCustomRequest(event) {
    event.preventDefault()

    const path = requestPath.trim()
    if (!path) {
      return
    }

    void runDebugAction(`GET ${path}`, () => requestEnt(path))
  }

  function handleAdeSearch(event) {
    event.preventDefault()
    void runDebugAction(`ADE Search: ${adeSearchQuery}`, () => searchAde(adeSearchQuery))
  }

  return (
    // Above the landing header (z-40); the sheets and prompts it opens
    // (z-50) still come on top.
    <aside
      className="card-corners fixed top-3 right-3 bottom-3 z-[45] flex w-[min(560px,calc(100vw-24px))] flex-col overflow-hidden border border-border bg-bg text-text font-body shadow-[0_24px_80px_var(--color-shadow)] xl:w-[min(1160px,calc(100vw-24px))] max-md:inset-2 max-md:w-auto"
      role="dialog"
      aria-modal="false"
      aria-label="Menu debug"
    >
      <header className="flex flex-col gap-3 border-b border-border px-5 pt-4 pb-3 max-md:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="m-0 font-body text-[20px] font-semibold leading-[1.15] tracking-[-0.4px]">Debug</h1>
              <span
                className={`inline-flex h-7 min-w-0 max-w-full items-center rounded-full px-[10px] text-[12.5px] font-semibold ${authenticated ? 'bg-success-bg text-success-text' : `${MUTED_FILL_CLASSES} text-text-60`}`}
                title={sessionLabel}
              >
                <span className="truncate">{sessionLabel}</span>
              </span>
            </div>
            <p className="m-0 text-[12.5px] font-medium leading-[1.35] text-text-60 max-sm:hidden">Cmd/Ctrl + Maj + D pour afficher ou masquer, Échap pour fermer</p>
          </div>
          <div className="flex shrink-0 items-center">
            <CloseButton onClick={onClose} />
          </div>
        </div>
        <nav aria-label="Sections" className="-mx-5 flex gap-[6px] overflow-x-auto px-5 [scrollbar-width:none] max-md:-mx-4 max-md:px-4">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`h-8 shrink-0 rounded-full border border-border bg-widget-bg px-3 text-[13px] font-medium text-text cursor-pointer transition-colors duration-[120ms] hover:bg-bg-subtle ${id === 'debug-output' ? 'xl:hidden' : ''}`}
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 max-md:px-3 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:grid-rows-[minmax(0,1fr)] xl:gap-5 xl:overflow-hidden">
        <div className="flex flex-col gap-5 xl:-mr-2 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:pr-2 xl:pb-1">
          <DebugSection id="debug-session" title="Session & compte">
            <DebugRow label="Session" hint="Rafraîchit la session et affiche la réponse">
              <DebugButton
                tone={callTone('Session')}
                onClick={() => {
                  setOutputTab('api')
                  onRefreshSession()
                }}
                disabled={checking}
              >
                Vérifier
              </DebugButton>
            </DebugRow>

            {!authenticated ? (
              <form className="flex flex-col gap-3 px-4 py-3" onSubmit={onLogin}>
                <div className="flex gap-3 max-sm:flex-col">
                  <DebugField
                    ref={usernameInputRef}
                    label="Identifiant"
                    autoComplete="username"
                    type="text"
                    value={credentials.username}
                    onChange={(event) => onCredentialsChange('username', event.target.value)}
                  />
                  <DebugField
                    label="Mot de passe"
                    autoComplete="current-password"
                    type="password"
                    value={credentials.password}
                    onChange={(event) => onCredentialsChange('password', event.target.value)}
                  />
                </div>
                <div className="flex justify-end">
                  <DebugButton type="submit" tone="active" disabled={checking}>
                    {checking ? 'Connexion…' : 'Se connecter'}
                  </DebugButton>
                </div>
              </form>
            ) : (
              <DebugRow label="Connecté" hint={`Session active pour ${sessionState.user ?? 'un utilisateur connecté'}`}>
                <DebugButton onClick={onLogout} disabled={checking}>Se déconnecter</DebugButton>
              </DebugRow>
            )}

            {sessionState.error ? (
              <p className="m-0 px-4 py-3 text-[13px] font-medium text-error">{sessionState.error}</p>
            ) : null}

            <DebugRow label="Photo de profil" hint="Cherche la photo de l’ENT, sinon dans le compte">
              <DebugButton
                tone={callTone('Photo profil')}
                onClick={() => void handleProfilePhoto()}
                disabled={busy || !authenticated}
                title={authenticated ? undefined : SIGNED_OUT_TITLE}
              >
                Photo profil
              </DebugButton>
            </DebugRow>

            {/* « Forcer le choix du TP »: the TP step students reach when
                their TP isn't found, even when it is. Both close the menu. */}
            <DebugRow label="Onboarding" hint="Oublie le TP choisi et relance l’onboarding">
              <DebugButton
                onClick={() => onRestartOnboarding()}
                disabled={!authenticated || checking}
                title={authenticated ? undefined : SIGNED_OUT_TITLE}
              >
                Refaire
              </DebugButton>
              <DebugButton
                onClick={() => onRestartOnboarding({ forceTpChoice: true })}
                disabled={!authenticated || checking}
                title={authenticated ? undefined : SIGNED_OUT_TITLE}
              >
                Forcer le choix du TP
              </DebugButton>
            </DebugRow>
          </DebugSection>

          <DebugSection id="debug-university" title="Université">
            {/* Forgets the university picked on this device and reloads on
                the neutral page (src/universityRuntime.js). Signed out
                only: signed in, the session's university wins. */}
            <DebugRow
              label="Université chargée"
              hint={authenticated ? 'Connecté : la session décide' : 'Oublie le choix de cet appareil, recharge sur la page neutre'}
            >
              <span className={`inline-flex h-8 items-center rounded-full px-3 font-mono text-[12.5px] text-text ${MUTED_FILL_CLASSES}`}>
                {loadedUniversityId ?? 'aucune'}
              </span>
              <DebugButton
                onClick={() => {
                  writeUniversityChoice(null)
                  window.location.assign('/')
                }}
                disabled={authenticated}
                title={authenticated ? 'Se déconnecter d’abord : connecté, la session décide' : undefined}
              >
                Réinitialiser
              </DebugButton>
            </DebugRow>
            {/* « Fait partie de Papillon » and the rest, forced on or off on
                this device (src/papillon.js). */}
            <DebugSwitchRow
              label="Mentions Papillon"
              hint={`${PAPILLON_OVERRIDE ? 'Forcé sur cet appareil' : 'Selon l’université'}, recharge la page`}
              checked={IS_PAPILLON_SHOWN}
              onChange={() => writeAndReload(() => localStorage.setItem(PAPILLON_DEBUG_KEY, IS_PAPILLON_SHOWN ? 'off' : 'on'))}
            />
          </DebugSection>

          <DebugSection id="debug-appearance" title="Apparence">
            {/* The same setting as Réglages › Apparence, here too on the
                landing and login pages; not counted as a setting change. */}
            <DebugRow label="Thème" hint="Comme dans Réglages, aussi déconnecté">
              <DebugSegmented
                label="Thème"
                options={THEME_OPTIONS}
                value={theme}
                onChange={(value) => {
                  persistTheme(value)
                  onThemeChange(value)
                }}
              />
            </DebugRow>
            <DebugRow label="Photo du bandeau" hint={heroStatus}>
              <DebugButton className="w-9 px-0" onClick={() => onHeroShift(-1)} disabled={!canShiftHero} aria-label="Précédente" title="Précédente">
                <Icon icon="carbon:chevron-left" className="h-5 w-5" aria-hidden="true" />
              </DebugButton>
              <DebugButton className="w-9 px-0" onClick={() => onHeroShift(1)} disabled={!canShiftHero} aria-label="Suivante" title="Suivante">
                <Icon icon="carbon:chevron-right" className="h-5 w-5" aria-hidden="true" />
              </DebugButton>
            </DebugRow>
          </DebugSection>

          <DebugSection id="debug-display" title="Affichage">
            <DebugSwitchRow
              label="Prochain cours fictif"
              hint="Carte « Prochain cours » de démo, rien n’est chargé"
              checked={debugNextClass}
              onChange={onDebugNextClassChange}
            />
            <DebugSwitchRow
              label="Mise à jour disponible"
              hint="Avis « Nouvelle version » de la sidebar et de l’en-tête"
              checked={hasPendingUpdate}
              onChange={onPendingUpdateChange}
            />
          </DebugSection>

          <DebugSection id="debug-notices" title="Notices">
            <DebugRow label="Installation" hint="Invite à installer l’app">
              <DebugButton onClick={onShowInstallPrompt}>Standard</DebugButton>
              <DebugButton onClick={onShowIosPrompt}>iOS</DebugButton>
            </DebugRow>
            <DebugRow label="Mise à jour" hint="Fenêtre de nouvelle version (PWA)">
              <DebugButton onClick={onShowUpdatePrompt}>Afficher</DebugButton>
            </DebugRow>
            <DebugRow label="Arrivée depuis l’ent" hint="Accueil après le transfert des réglages">
              <DebugButton onClick={onShowWelcomeFromLent}>Afficher</DebugButton>
            </DebugRow>
            {/* Brings back a launch as on release day (the dashboard card,
                the tab's « Nouveau »), only where it applies. */}
            <DebugRow label="Nouveautés" hint="Rejoue un lancement, là où il s’applique">
              <DebugButton
                tone={callTone('Nouveautés : rejouer « Mes notes »')}
                onClick={() => void runDebugAction('Nouveautés : rejouer « Mes notes »', () => (
                  replayChangelogEntry('mes-notes')
                    ? { replayed: true }
                    : { replayed: false, note: 'L’entrée ne s’applique pas ici : pas de page Mes notes, ou relevé non BUT (ou pas encore lu).' }
                ))}
                disabled={busy}
              >
                Mes notes
              </DebugButton>
              <DebugButton
                tone={callTone('Nouveautés : rejouer « Planning »')}
                onClick={() => void runDebugAction('Nouveautés : rejouer « Planning »', () => (
                  replayChangelogEntry('planning')
                    ? { replayed: true }
                    : { replayed: false, note: 'L’entrée ne s’applique pas ici : pas de page Planning, ou pas connecté.' }
                ))}
                disabled={busy}
              >
                Planning
              </DebugButton>
            </DebugRow>
            {/* The university's outage notice (ServiceNotice), hidden on
                this device. */}
            <DebugSwitchRow
              label="Masquer l’avis de panne"
              hint="Sur cet appareil, recharge la page"
              checked={IS_SERVICE_NOTICE_HIDDEN}
              onChange={() => writeAndReload(() => (
                IS_SERVICE_NOTICE_HIDDEN
                  ? localStorage.removeItem(SERVICE_NOTICE_DEBUG_KEY)
                  : localStorage.setItem(SERVICE_NOTICE_DEBUG_KEY, '1')
              ))}
            />
          </DebugSection>

          <DebugSection id="debug-api" title="API">
            <div className="flex flex-col gap-2 px-4 py-3">
              <span className="text-[12px] font-semibold leading-none text-text-60">ENT</span>
              <div className="flex flex-wrap gap-[6px]">
                {ENT_CALLS.map(([label, action]) => (
                  <DebugButton key={label} tone={callTone(label)} onClick={() => void runDebugAction(label, action)} disabled={busy}>
                    {label}
                  </DebugButton>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 px-4 py-3">
              <span className="text-[12px] font-semibold leading-none text-text-60">ADE</span>
              <div className="flex flex-wrap gap-[6px]">
                {adeCalls.map(([label, action]) => (
                  <DebugButton key={label} tone={callTone(label)} onClick={() => void runDebugAction(label, action)} disabled={busy}>
                    {label}
                  </DebugButton>
                ))}
              </div>
            </div>
            <form className="flex items-end gap-2 px-4 py-3" onSubmit={handleAdeSearch}>
              <DebugField
                label="Recherche ADE"
                type="text"
                value={adeSearchQuery}
                onChange={(event) => setAdeSearchQuery(event.target.value)}
                placeholder="Cours, prof, groupe…"
              />
              <DebugButton type="submit" disabled={busy || !adeSearchQuery.trim()}>Chercher</DebugButton>
            </form>
            <form className="flex items-end gap-2 px-4 py-3" onSubmit={handleCustomRequest}>
              <DebugField
                label="Endpoint ENT"
                type="text"
                mono
                value={requestPath}
                onChange={(event) => setRequestPath(event.target.value)}
                placeholder={DEFAULT_REQUEST_PATH}
              />
              <DebugButton type="submit" disabled={busy || !requestPath.trim()}>GET</DebugButton>
            </form>
          </DebugSection>

          <DebugSection id="debug-reset" title="Réinitialisation">
            <DebugRow label="Reset complet" hint="Déconnecte, vide le stockage, les caches et le service worker, puis recharge">
              <DebugButton tone="danger" onClick={() => void handleFullReset()} disabled={busy || checking}>
                Tout effacer
              </DebugButton>
            </DebugRow>
          </DebugSection>
        </div>

        <div className="mt-5 flex min-w-0 xl:mt-0 xl:min-h-0">
          <DebugOutput
            id="debug-output"
            debugState={debugState}
            tab={outputTab}
            onTabChange={setOutputTab}
            imagePreview={resolveDebugImagePreviewFromSnapshot(debugState.payload) ?? imagePreview}
            sessionUser={sessionState.user}
          />
        </div>
      </div>
    </aside>
  )
}
