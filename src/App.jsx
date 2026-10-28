import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import favicon from './assets/favicon.png'
import AppHeader from './components/AppHeader'
import AppFooter from './components/AppFooter'
import Sidebar from './components/Sidebar'
import AccountModal from './components/AccountModal'
import ChangelogPill from './components/ChangelogPill'
import { markChangelogEntrySeen, setChangelogAudience } from './changelogStore'
import ChangelogSheet from './components/ChangelogSheet'
import LandingPage from './components/LandingPage'
import LoginPage from './components/LoginPage'
import OnboardingCompletionPage from './components/OnboardingCompletionPage'
import PwaInstallPrompt from './components/PwaInstallPrompt'
import OnboardingPage from './components/OnboardingPage'
import PwaUpdateManager from './components/PwaUpdateManager'
import UpdateNotice from './components/UpdateNotice'
import WelcomeFromLent from './components/WelcomeFromLent'
import { settingsTransfer } from './settingsTransferBoot'
import { appendPreviewToken, findProfilePhotoCandidate } from './profilePhoto'
import { DEMO_CREDENTIALS, DEMO_SESSION_MODE, DEMO_SIGNATURE_LOGIN } from './demoAccount'
import { signatureLogin } from './mailSignatureChoice'
import { storeBrowserPasswordCredential } from './browserCredentials'
import { syncRuntimeSeo } from './seo'
import {
  ESTABLISHMENT_KEY,
  STUDENT_TP_KEY,
  ADE_LOOKAHEAD_DAY_OPTIONS,
  clearStoredTpSelection,
  getStoredAdeLookaheadDays,
  getStoredAnonymousAnalytics,
  getStoredEstablishment,
  getStoredHiddenWidgets,
  getStoredShowAppDescriptions,
  getStoredShowPlanningWeekend,
  getStoredLogoSource,
  getStoredShowUniversityLogo,
  getStoredShowWallpaper,
  getStoredTpSelection,
  persistAdeLookaheadDays,
  persistAnonymousAnalytics,
  persistEstablishment,
  persistHiddenWidgets,
  persistShowAppDescriptions,
  persistShowPlanningWeekend,
  persistLogoSource,
  persistShowUniversityLogo,
  persistShowWallpaper,
  persistTpSelection,
} from './profileStorage'
import { getStoredSidebarCompact, persistSidebarCompact } from './sidebarWidth'
import WidgetContainer from './components/WidgetContainer'
import GradesPage from './components/GradesPage'
import PlanningPage from './components/PlanningPage'
import MailPage from './components/MailPage'
import LoadingDots from './components/LoadingDots'
import { resolveHeroImage } from './heroImage'
import { getStoredTheme, persistTheme, watchTheme } from './theme'
import MobileTabBar from './components/MobileTabBar'
import { getMobileTabItems } from './navItems'
import { getAvailableWidgets } from './dashboardWidgets'
import { bindHistorySession, readHistoryNav, writeHistoryNav } from './appHistory'
import { clearMailReadCache } from './mailReadCache'
import { clearMailSignatures } from './mailSignatureStore'
import { clearMailSends, flushMailSends } from './useMailSend'
import useGradesFormation from './useGradesFormation'
import { clearStoredCustomBackground, getStoredCustomBackground, saveCustomBackground } from './customBackground'
import {
  flushAnalytics,
  setAnalyticsAvailable,
  setAnalyticsEstablishment,
  setAnalyticsFormation,
  setAnalyticsUserEnabled,
  track,
  useAnalyticsAvailable,
} from './analytics'
import {
  clearAdeTimetableCache,
  clearGradesCache,
  detectScodocGroupSelection,
  findAdeGroupForScodoc,
  getAccountInfo,
  getAdeTree,
  getAuthSession,
  getGrades,
  getStudentProfilePictureMeta,
  loginToEnt,
  logoutFromEnt,
  preloadSchoolCertificateStatus,
} from './entApi'

// How far the hero photo extends below the widget row before fully fading.
const HERO_FADE_OVERHANG_PX = 80

// The planning is the student's own (TEMPO): no group to choose in Mon compte.
const HAS_PERSONAL_PLANNING = universityConfig.planning?.personal === true

const DEBUG_MENU_ENABLED = import.meta.env.DEV
// Dev only: a constant false in production builds, so the menu's chunk is
// never emitted there.
const DebugMenu = DEBUG_MENU_ENABLED ? lazy(() => import('./components/debug/DebugMenu')) : null
const ACCOUNT_MODAL_PROFILE_PHOTO_TIMEOUT_MS = 3000
const ONBOARDING_COMPLETION_SCREEN_MS = 1000
const LEGACY_SESSION_CACHE_KEY = 'l-ent:session-cache'

function clearLegacySensitiveClientCaches() {
  try {
    localStorage.removeItem(LEGACY_SESSION_CACHE_KEY)
  } catch {
    // Ignore storage failures
  }

  clearGradesCache()
  clearAdeTimetableCache()
}

// What the mail page keeps at the module's level for the signed-in student:
// the mails read, their webmail signatures, a send waiting or held. Logging
// out doesn't reload the page, so it goes on logout and whenever the
// signed-in user changes.
function forgetMailAccount() {
  clearMailReadCache()
  clearMailSignatures()
  clearMailSends()
}

// Signed in to another university than the one the page runs for (the demo
// from the neutral page, before any pick): the page boots again for it, as
// every module read the config when it loaded (src/university.js).
function reloadForOtherUniversity(result) {
  const university = result?.university
  if (!university || university === universityConfig.id) {
    return false
  }

  window.location.reload()
  return true
}

function getTrimmedString(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue || null
}

function getFirstAvailableString(...values) {
  for (const value of values) {
    const normalizedValue = getTrimmedString(value)

    if (normalizedValue) {
      return normalizedValue
    }
  }

  return null
}

function getAccountDisplayInfo(account, fallbackUser = null, fallbackGivenName = null) {
  const fullName = getFirstAvailableString(account?.name, account?.display_name, account?.preferred_username)
  const fullNameParts = fullName ? fullName.split(/\s+/).filter(Boolean) : []
  const derivedFirstName = fullNameParts[0] ?? null
  const derivedLastName = fullNameParts.length > 1 ? fullNameParts.slice(1).join(' ') : null

  return {
    firstName: getFirstAvailableString(account?.given_name, account?.givenName, fallbackGivenName, derivedFirstName) ?? '',
    lastName: getFirstAvailableString(account?.family_name, account?.familyName, account?.last_name, account?.surname, derivedLastName) ?? '',
    email: getFirstAvailableString(account?.email, account?.mail, account?.email_address, fallbackUser?.includes('@') ? fallbackUser : null) ?? '',
  }
}

function buildStoredSelectionOption(resourceId, label, parentResourceId = null, parentLabel = null, contextLabel = null) {
  const normalizedResourceId = String(resourceId ?? '').trim()
  const normalizedLabel = getTrimmedString(label)

  if (!normalizedResourceId || !normalizedLabel) {
    return null
  }

  return {
    resourceId: normalizedResourceId,
    label: normalizedLabel,
    parentResourceId: parentResourceId == null ? null : String(parentResourceId),
    parentLabel: getTrimmedString(parentLabel),
    contextLabel: getTrimmedString(contextLabel),
  }
}

function findTpOptionByResourceId(options, resourceId) {
  const normalizedResourceId = String(resourceId ?? '').trim()

  if (!normalizedResourceId) {
    return null
  }

  return (options ?? []).find((option) => option?.resourceId === normalizedResourceId) ?? null
}

function normalizeSelectionLabel(label) {
  return String(label ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeSelectionCompactLabel(label) {
  return normalizeSelectionLabel(label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function selectionLabelsMatch(left, right) {
  const normalizedLeft = normalizeSelectionLabel(left)
  const normalizedRight = normalizeSelectionLabel(right)

  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  const compactLeft = normalizeSelectionCompactLabel(left)
  const compactRight = normalizeSelectionCompactLabel(right)
  const canUseCompactSuffixMatch = compactLeft.length >= 3 && compactRight.length >= 3

  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight} `)
    || normalizedRight.startsWith(`${normalizedLeft} `)
    || normalizedLeft.endsWith(` ${normalizedRight}`)
    || normalizedRight.endsWith(` ${normalizedLeft}`)
    || (
      compactLeft.length >= 2
      && compactRight.length >= 2
      && (
        compactLeft === compactRight
        || (
          canUseCompactSuffixMatch
          && (compactLeft.endsWith(compactRight) || compactRight.endsWith(compactLeft))
        )
      )
    )
}

function findTpOptionByLabel(options, labelOrLabels) {
  const labels = Array.isArray(labelOrLabels) ? labelOrLabels : [labelOrLabels]
  const normalizedLabels = labels.filter((label) => normalizeSelectionLabel(label))

  if (normalizedLabels.length === 0) {
    return null
  }

  for (const label of normalizedLabels) {
    const match = (options ?? []).find((option) => selectionLabelsMatch(option?.label, label))
    if (match) {
      return match
    }
  }

  return null
}

async function loadTdOptionsForAccountModal(yearOption) {
  const treeResponse = await getAdeTree(yearOption.resourceId)
  return buildNextTpStepFromTree(treeResponse?.tree)
}

async function loadTpOptionsForAccountModal(tdOption) {
  const treeResponse = await getAdeTree(tdOption.resourceId)
  return buildNextTpStepFromTree(treeResponse?.tree)
}

function createEmptyAccountModalPlanningState(overrides = {}) {
  return {
    loading: false,
    applying: false,
    loadingMessage: '',
    errorMessage: '',
    contextLabel: '',
    program: null,
    yearOptions: [],
    tdOptions: [],
    tpOptions: [],
    draftYear: null,
    draftTd: null,
    draftTp: null,
    ...overrides,
  }
}

function createStoredPlanningDraftState(selection, overrides = {}) {
  return createEmptyAccountModalPlanningState({
    contextLabel: getTrimmedString(selection?.contextLabel) ?? '',
    draftYear: buildStoredSelectionOption(
      selection?.yearResourceId,
      selection?.yearLabel,
      selection?.programResourceId,
      selection?.programLabel,
      selection?.contextLabel,
    ),
    draftTd: buildStoredSelectionOption(
      selection?.tdResourceId,
      selection?.tdLabel,
      selection?.yearResourceId,
      selection?.yearLabel,
      selection?.contextLabel,
    ),
    draftTp: buildStoredSelectionOption(
      selection?.tpResourceId,
      selection?.tpLabel,
      selection?.tdResourceId,
      selection?.tdLabel,
      selection?.contextLabel,
    ),
    ...overrides,
  })
}

async function buildAccountModalPlanningState(selection) {
  let treeResponse = await getAdeTree()
  let planningState = buildInitialTpOnboardingState(treeResponse?.tree)

  if (planningState.program?.resourceId && planningState.yearOptions.length === 0) {
    treeResponse = await getAdeTree(planningState.program.resourceId)
    planningState = buildInitialTpOnboardingState(treeResponse?.tree)
  }

  const storedYear = buildStoredSelectionOption(
    selection?.yearResourceId,
    selection?.yearLabel,
    selection?.programResourceId,
    selection?.programLabel,
    selection?.contextLabel,
  )
  const storedTd = buildStoredSelectionOption(
    selection?.tdResourceId,
    selection?.tdLabel,
    selection?.yearResourceId,
    selection?.yearLabel,
    selection?.contextLabel,
  )
  const storedTp = buildStoredSelectionOption(
    selection?.tpResourceId,
    selection?.tpLabel,
    selection?.tdResourceId,
    selection?.tdLabel,
    selection?.contextLabel,
  )

  let contextLabel = getFirstAvailableString(selection?.contextLabel, planningState.contextLabel) ?? ''
  const draftYear = storedYear
    ? findTpOptionByResourceId(planningState.yearOptions, storedYear.resourceId) ?? storedYear
    : planningState.detectedSelections.year
  let draftTd = null
  let draftTp = null
  let tdOptions = []
  let tpOptions = []

  if (draftYear?.resourceId) {
    const yearStep = await loadTdOptionsForAccountModal(draftYear)
    contextLabel = getFirstAvailableString(yearStep.contextLabel, contextLabel) ?? ''
    tdOptions = yearStep.options
    draftTd = storedTd
      ? findTpOptionByResourceId(tdOptions, storedTd.resourceId) ?? storedTd
      : planningState.detectedSelections.td

    if (draftTd?.resourceId) {
      const tdStep = await loadTpOptionsForAccountModal(draftTd)
      contextLabel = getFirstAvailableString(tdStep.contextLabel, contextLabel) ?? ''
      tpOptions = tdStep.options
      draftTp = storedTp
        ? findTpOptionByResourceId(tpOptions, storedTp.resourceId) ?? storedTp
        : planningState.detectedSelections.tp
    }
  }

  return createEmptyAccountModalPlanningState({
    contextLabel,
    program: planningState.program,
    yearOptions: planningState.yearOptions,
    tdOptions,
    tpOptions,
    draftYear,
    draftTd,
    draftTp,
  })
}

async function resolveAccountProfilePhoto(account, { timeoutMs = ACCOUNT_MODAL_PROFILE_PHOTO_TIMEOUT_MS } = {}) {
  const fallbackPhotoSrc = findProfilePhotoCandidate(account)?.src ?? null
  let timeoutId = null

  try {
    const profilePictureResult = await Promise.race([
      getStudentProfilePictureMeta()
        .then((profilePictureInfo) => ({ status: 'resolved', profilePictureInfo }))
        .catch((error) => ({ status: 'unreachable', error })),
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => {
          resolve({ status: 'timeout' })
        }, timeoutMs)
      }),
    ])

    if (profilePictureResult.status === 'resolved') {
      const { profilePictureInfo } = profilePictureResult

      if (profilePictureInfo?.available && profilePictureInfo.previewUrl) {
        return appendPreviewToken(profilePictureInfo.previewUrl, String(Date.now()))
      }
    }
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }

  return fallbackPhotoSrc
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function getFrenchAuthErrorMessage(error, context = 'login') {
  // The server's 429 says "Too many login attempts", which matched none of
  // the checks below and showed as wrong credentials.
  if (error?.status === 429) {
    const minutes = Math.ceil((error.retryAfterSeconds ?? 0) / 60)
    return minutes > 0
      ? `Trop de tentatives de connexion, réessaie dans ${minutes} min`
      : 'Trop de tentatives de connexion. Réessaie dans quelques instants'
  }

  const rawMessage = getErrorMessage(error).trim()
  const normalizedMessage = rawMessage.toLowerCase()
  const mentionsUsername = normalizedMessage.includes('username') || normalizedMessage.includes('identifiant')
  const mentionsPassword = normalizedMessage.includes('password') || normalizedMessage.includes('mot de passe')
  const mentionsRequired = (
    normalizedMessage.includes('required')
    || normalizedMessage.includes('requis')
    || normalizedMessage.includes('missing')
  )

  if (
    (mentionsUsername && mentionsPassword && mentionsRequired)
    || normalizedMessage.includes('missing username')
    || normalizedMessage.includes('missing password')
    || normalizedMessage.includes('mot de passe requis')
  ) {
    return 'Remplis ton identifiant et ton mot de passe'
  }

  if (
    normalizedMessage.includes('cas login failed')
    || normalizedMessage.includes('check your username and password')
    || normalizedMessage.includes('invalid credentials')
    || normalizedMessage.includes('bad credentials')
    || normalizedMessage.includes('invalid username')
    || normalizedMessage.includes('invalid password')
    || normalizedMessage.includes('incorrect password')
    || normalizedMessage.includes('portal session was not established')
    || normalizedMessage.includes('unauthorized')
    || normalizedMessage.includes('status 401')
    || normalizedMessage.includes('status 403')
    || normalizedMessage.includes('forbidden')
  ) {
    return 'Identifiant ou mot de passe incorrect'
  }

  if (normalizedMessage.includes('status 429') || normalizedMessage.includes('too many requests')) {
    return 'Trop de tentatives de connexion. Réessaie dans quelques instants'
  }

  if (
    normalizedMessage.includes('networkerror')
    || normalizedMessage.includes('failed to fetch')
    || normalizedMessage.includes('load failed')
    || normalizedMessage.includes('network request failed')
    || normalizedMessage.includes('fetch')
  ) {
    return context === 'session'
      ? 'Impossible de vérifier la session, réessaie dans quelques instants'
      : 'Impossible de joindre le service de connexion, vérifie ta connexion puis réessaie'
  }

  if (normalizedMessage.includes('status 5') || normalizedMessage.includes('internal server error')) {
    return context === 'session'
      ? 'Le service de session est indisponible pour le moment'
      : 'Le service de connexion est indisponible pour le moment'
  }

  return context === 'session'
    ? 'Impossible de vérifier la session pour le moment'
    : 'La connexion a échoué, vérifie tes identifiants puis réessaie'
}

function getSessionWarningMessage(session) {
  if (!session?.authenticated || !session?.degraded) {
    return ''
  }

  if (session.degradedReason === 'missing-cas-tgc') {
    return session.sessionSource === 'cookie'
      ? "Certains services sont indisponibles, reconnecte-toi pour les afficher."
      : "Certains services sont indisponibles, reconnecte-toi pour les afficher."
  }

  return "Certains services sont indisponibles, reconnecte-toi pour les afficher."
}

function buildDebugSnapshot(label, data, error = '') {
  return {
    label,
    capturedAt: new Date().toISOString(),
    error,
    data,
  }
}

function createEmptyTpOnboardingState(overrides = {}) {
  return {
    contextLabel: '',
    program: null,
    yearOptions: [],
    tdOptions: [],
    tpOptions: [],
    selectedYear: null,
    selectedTd: null,
    detectedSelections: {
      year: null,
      td: null,
      tp: null,
    },
    errorMessage: '',
    loadingStep: null,
    loadingMessage: '',
    ...overrides,
  }
}

function findAdeTreeNodeById(rootNode, targetId) {
  if (!rootNode) {
    return null
  }

  if (String(rootNode.id) === String(targetId)) {
    return rootNode
  }

  for (const child of rootNode.children ?? []) {
    const match = findAdeTreeNodeById(child, targetId)
    if (match) {
      return match
    }
  }

  return null
}

function detectEstablishmentFromAdeTree(treePayload) {
  const establishments = universityConfig.establishments
  if (!establishments) {
    return null
  }

  const root = treePayload?.root
  const currentPathIds = Array.isArray(treePayload?.currentPathIds) ? treePayload.currentPathIds : []
  const currentNodes = currentPathIds
    .map((nodeId) => findAdeTreeNodeById(root, nodeId))
    .filter(Boolean)

  const searchHaystack = currentNodes.flatMap((node) => [
    String(node.name ?? ''),
    String(node.path ?? ''),
  ]).join(' | ').toLowerCase()

  for (const rule of establishments.detectFromAdeTree ?? []) {
    if ((rule.includes ?? []).some((needle) => searchHaystack.includes(needle))) {
      return rule.id
    }
  }

  return establishments.fallbackId ?? null
}

function normalizeAdePathLabels(nodes) {
  return nodes
    .map((node) => String(node?.name ?? '').trim())
    .filter((label) => label && label.toLowerCase() !== 'ressources' && label.toLowerCase() !== 'etudiants')
}

function getAdeTreePathNodes(treePayload) {
  const root = treePayload?.root
  const currentPathIds = Array.isArray(treePayload?.selectionPathIds)
    ? treePayload.selectionPathIds
    : Array.isArray(treePayload?.currentPathIds)
      ? treePayload.currentPathIds
      : []

  return currentPathIds
    .map((nodeId) => findAdeTreeNodeById(root, nodeId))
    .filter(Boolean)
    .filter((node) => !['-100', '-1'].includes(String(node.id)))
}

function buildTpSelectionOption(node, parentNode, contextLabel, extraFields = {}) {
  if (!node) {
    return null
  }

  const resourceId = String(node.id ?? '').trim()
  const label = String(node.name ?? node.path ?? '').trim()

  if (!resourceId || !label) {
    return null
  }

  return {
    resourceId,
    label,
    parentResourceId: parentNode?.id == null ? null : String(parentNode.id),
    parentLabel: parentNode?.name ? String(parentNode.name) : null,
    contextLabel: contextLabel || null,
    ...extraFields,
  }
}

function buildTpSelectionOptions(nodes, parentNode, contextLabel, extraFields = {}) {
  return (nodes ?? [])
    .map((node) => buildTpSelectionOption(node, parentNode, contextLabel, extraFields))
    .filter(Boolean)
}

function buildInitialTpOnboardingState(treePayload) {
  const pathNodes = getAdeTreePathNodes(treePayload)
  const pathLabels = normalizeAdePathLabels(pathNodes)
  const programNode = pathNodes.length >= 2 ? pathNodes[1] : pathNodes[0] ?? null
  const programIndex = programNode
    ? pathNodes.findIndex((node) => String(node.id) === String(programNode.id))
    : -1
  const contextLabel = programIndex >= 0
    ? pathLabels.slice(0, programIndex + 1).join(' / ')
    : pathLabels.join(' / ')
  const yearNodes = programNode?.children ?? []
  const detectedYearNode = programIndex >= 0 ? pathNodes[programIndex + 1] ?? null : null
  const detectedTdNode = programIndex >= 0 ? pathNodes[programIndex + 2] ?? null : null
  const detectedTpNode = programIndex >= 0 ? pathNodes[programIndex + 3] ?? null : null

  return createEmptyTpOnboardingState({
    contextLabel,
    program: buildTpSelectionOption(programNode, pathNodes[programIndex - 1] ?? null, contextLabel),
    yearOptions: buildTpSelectionOptions(yearNodes, programNode, contextLabel),
    detectedSelections: {
      year: buildTpSelectionOption(detectedYearNode, programNode, contextLabel),
      td: buildTpSelectionOption(detectedTdNode, detectedYearNode, contextLabel),
      tp: buildTpSelectionOption(detectedTpNode, detectedTdNode, contextLabel),
    },
    errorMessage: yearNodes.length > 0 ? '' : "Aucun groupe d'année n'a été trouvé pour le moment",
  })
}

function buildNextTpStepFromTree(treePayload) {
  const root = treePayload?.root
  const pathNodes = getAdeTreePathNodes(treePayload)
  const pathLabels = normalizeAdePathLabels(pathNodes)
  const focusNodeId = treePayload?.focusResourceId ?? treePayload?.currentResourceId ?? null
  const focusNode = findAdeTreeNodeById(root, focusNodeId)

  return {
    contextLabel: pathLabels.join(' / '),
    parentOption: buildTpSelectionOption(focusNode, pathNodes[pathNodes.length - 2] ?? null, pathLabels.join(' / ')),
    options: buildTpSelectionOptions(focusNode?.children ?? [], focusNode, pathLabels.join(' / ')),
  }
}

function buildStoredTpSelection(program, year, td, tp, contextLabel) {
  const finalSelection = tp ?? td ?? year
  const parentSelection = tp ? (td ?? year ?? program) : td ? (year ?? program) : program

  if (!finalSelection) {
    return null
  }

  return {
    resourceId: finalSelection.resourceId,
    label: finalSelection.label,
    parentResourceId: parentSelection?.resourceId ?? null,
    parentLabel: parentSelection?.label ?? null,
    contextLabel,
    programResourceId: program?.resourceId ?? null,
    programLabel: program?.label ?? null,
    yearResourceId: year?.resourceId ?? null,
    yearLabel: year?.label ?? null,
    tdResourceId: td?.resourceId ?? null,
    tdLabel: td?.label ?? null,
    tpResourceId: tp?.resourceId ?? null,
    tpLabel: tp?.label ?? null,
  }
}

// Some ADE accounts are attached to the TD node instead of the TP leaf (BUT
// INFO-COM Lannion: "A1 J" holds "1A1 J" and "1A2 J"), and ADE only returns
// events on those TP leaves. Pick the TP among the TD children with the ScoDoc
// group, as the manual onboarding does for accounts without an ADE default.
// When none matches, the TD's TPs come back as `tpChoice` and the onboarding
// asks for the TP (year and TD already picked) rather than saving a TD-only
// selection with an empty timetable. `forceChoice` (debug panel) asks even
// when the TP is known.
async function resolveDefaultSelectionTp(adeDefaultSelection, { tdAliases = [], tpAliases = [], forceChoice = false } = {}) {
  const defaultSelection = await correctDefaultSelectionWithScodoc(adeDefaultSelection, tdAliases, tpAliases)
  const keepDefault = { selection: defaultSelection }
  if (!defaultSelection?.tdResourceId || (defaultSelection.tpResourceId && !forceChoice)) {
    return keepDefault
  }

  try {
    const tdTreeResponse = await getAdeTree(defaultSelection.tdResourceId)
    const tpOptions = buildNextTpStepFromTree(tdTreeResponse?.tree).options
    // No TP under it: the TD is the leaf, ADE has its events.
    if (tpOptions.length === 0) {
      return keepDefault
    }

    const tp = tpAliases?.length ? findTpOptionByLabel(tpOptions, tpAliases) : null
    if (tp && !forceChoice) {
      return {
        selection: buildStoredTpSelection(
          buildStoredSelectionOption(defaultSelection.programResourceId, defaultSelection.programLabel),
          buildStoredSelectionOption(defaultSelection.yearResourceId, defaultSelection.yearLabel),
          buildStoredSelectionOption(defaultSelection.tdResourceId, defaultSelection.tdLabel),
          tp,
          defaultSelection.contextLabel,
        ),
      }
    }

    const detectedTp = tp ?? tpOptions.find((option) => String(option.resourceId) === String(defaultSelection.tpResourceId)) ?? null
    return { tpChoice: { baseSelection: defaultSelection, tpOptions, detectedTp } }
  } catch {
    // The ADE default stays usable without the TP; it can be picked in settings.
    return keepDefault
  }
}

// ADE's default can name the wrong group: Rennes ADE puts a 2A2 MMI student
// on "2B2-StratUX MMI" while ScoDoc says TD 2A, TP 2A2. When ScoDoc names a TP
// the default doesn't match, ScoDoc wins if its TD exists under the default's
// year and its TP under that TD; otherwise ADE's default stays.
async function correctDefaultSelectionWithScodoc(defaultSelection, tdAliases, tpAliases) {
  const isDefaultTpScodocs = tpAliases.some((alias) => selectionLabelsMatch(defaultSelection?.tpLabel, alias))
  if (!defaultSelection?.yearResourceId || !defaultSelection.tpResourceId || !tpAliases.length || !tdAliases.length || isDefaultTpScodocs) {
    return defaultSelection
  }

  try {
    const yearTreeResponse = await getAdeTree(defaultSelection.yearResourceId)
    const td = findTpOptionByLabel(buildNextTpStepFromTree(yearTreeResponse?.tree).options, tdAliases)
    if (!td?.resourceId) {
      return defaultSelection
    }

    const tdTreeResponse = await getAdeTree(td.resourceId)
    const tp = findTpOptionByLabel(buildNextTpStepFromTree(tdTreeResponse?.tree).options, tpAliases)
    if (!tp?.resourceId) {
      return defaultSelection
    }

    return buildStoredTpSelection(
      buildStoredSelectionOption(defaultSelection.programResourceId, defaultSelection.programLabel),
      buildStoredSelectionOption(defaultSelection.yearResourceId, defaultSelection.yearLabel),
      td,
      tp,
      defaultSelection.contextLabel,
    )
  } catch {
    return defaultSelection
  }
}

// The onboarding at its TP step, with ADE's default year and TD already
// picked. The year and TD lists are loaded too, so "back" works as usual.
async function buildTpChoiceOnboardingState(treePayload, defaultSelection, { tpOptions, detectedTp }) {
  let state = buildInitialTpOnboardingState(treePayload)
  if (state.program?.resourceId && state.yearOptions.length === 0) {
    const programTreeResponse = await getAdeTree(state.program.resourceId)
    state = buildInitialTpOnboardingState(programTreeResponse?.tree)
  }

  const isOption = (option, resourceId) => String(option?.resourceId) === String(resourceId)
  const year = state.yearOptions.find((option) => isOption(option, defaultSelection.yearResourceId))
    ?? buildStoredSelectionOption(defaultSelection.yearResourceId, defaultSelection.yearLabel)
  const yearStep = buildNextTpStepFromTree((await getAdeTree(year.resourceId))?.tree)
  const td = yearStep.options.find((option) => isOption(option, defaultSelection.tdResourceId))
    ?? buildStoredSelectionOption(defaultSelection.tdResourceId, defaultSelection.tdLabel)

  return {
    ...state,
    contextLabel: state.contextLabel || defaultSelection.contextLabel || yearStep.contextLabel,
    selectedYear: year,
    tdOptions: yearStep.options,
    selectedTd: td,
    tpOptions,
    detectedSelections: { year, td, tp: detectedTp },
    errorMessage: '',
  }
}

function getCurrentTpOnboardingStep(tpOnboardingState) {
  if (!tpOnboardingState.selectedYear) {
    return 'year'
  }

  if (!tpOnboardingState.selectedTd) {
    return 'td'
  }

  return 'tp'
}

function getCurrentTpStepOptions(tpOnboardingState) {
  const currentStep = getCurrentTpOnboardingStep(tpOnboardingState)

  if (currentStep === 'year') {
    return tpOnboardingState.yearOptions
  }

  if (currentStep === 'td') {
    return tpOnboardingState.tdOptions
  }

  return tpOnboardingState.tpOptions
}

function getDetectedSelectionForStep(tpOnboardingState, stepKey) {
  return tpOnboardingState.detectedSelections?.[stepKey] ?? null
}

function getFrenchTpLoadErrorMessage(error) {
  const normalizedMessage = getErrorMessage(error).trim().toLowerCase()

  if (
    normalizedMessage.includes('networkerror')
    || normalizedMessage.includes('failed to fetch')
    || normalizedMessage.includes('load failed')
    || normalizedMessage.includes('network request failed')
  ) {
    return "Impossible de récupérer les groupes TP pour le moment, vérifie ta connexion puis réessaie"
  }

  return 'ADE est indisponible pour le moment'
}

let settingsTransferReported = false

// One event per arrival from the old l'ent address. Called right after the
// session says whether analytics is on: track() drops anything sent earlier.
function reportSettingsTransfer() {
  if (!settingsTransfer.arrived || settingsTransferReported) return
  settingsTransferReported = true
  track('settings_imported', { has_settings: settingsTransfer.importedKeys.length > 0 })
}

const LOGIN_PATH = '/login'

// Installed app and arrivals from the old l'ent address skip the landing page.
function shouldOpenOnLogin() {
  return settingsTransfer.arrived
    || window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

function App() {
  const [debugOpen, setDebugOpen] = useState(false)
  const toggleDebugMenu = useCallback(() => setDebugOpen((current) => !current), [])
  const closeDebugMenu = useCallback(() => setDebugOpen(false), [])
  // Debug menu: shifts the daily hero photo pick to preview the others.
  const [heroOffset, setHeroOffset] = useState(0)
  const [forceInstallPrompt, setForceInstallPrompt] = useState(false)
  const [forceIosPrompt, setForceIosPrompt] = useState(false)
  const [forceUpdatePrompt, setForceUpdatePrompt] = useState(false)
  const [welcomeFromLentOpen, setWelcomeFromLentOpen] = useState(false)
  const [isInstallPromptVisible, setIsInstallPromptVisible] = useState(false)

  useEffect(() => {
    if (!settingsTransfer.arrived) return undefined
    const timer = setTimeout(() => setWelcomeFromLentOpen(true), 600)
    return () => clearTimeout(timer)
  }, [])

  const showInstallPrompt = useCallback(() => {
    setForceInstallPrompt(true)
    setTimeout(() => setForceInstallPrompt(false), 100)
  }, [])
  const [hasPendingUpdate, setHasPendingUpdate] = useState(false)
  // The « Nouveautés » pill waits for the "Nouvelle version" notice (same
  // slot; the update reload brings the new entries anyway) and for any sheet
  // that opened by itself.
  const showChangelogPill = !hasPendingUpdate && !welcomeFromLentOpen && !isInstallPromptVisible
  const applyUpdateRef = useRef(null)
  const handleApplyUpdate = useCallback(async () => {
    if (applyUpdateRef.current) {
      await applyUpdateRef.current()
    } else {
      window.location.reload()
    }
  }, [])
  const [debugNextClass, setDebugNextClass] = useState(false)
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  })
  const [establishment, setEstablishment] = useState(() => getStoredEstablishment())
  const [selectedTp, setSelectedTp] = useState(() => getStoredTpSelection())
  const [nextClassLookaheadDays, setNextClassLookaheadDays] = useState(() => getStoredAdeLookaheadDays())
  const [hiddenWidgets, setHiddenWidgets] = useState(() => getStoredHiddenWidgets())
  const [customBackground, setCustomBackground] = useState(() => getStoredCustomBackground())
  const [showWallpaper, setShowWallpaper] = useState(() => getStoredShowWallpaper())
  const [showUniversityLogo, setShowUniversityLogo] = useState(() => getStoredShowUniversityLogo())
  const [logoSource, setLogoSource] = useState(() => getStoredLogoSource())
  // Page shown next to the sidebar: 'dashboard' or 'grades'. Each switch is
  // a history entry (see appHistory.js): back and forward move between
  // pages, and a reload stays on the page.
  const [activePage, setActivePage] = useState(() => readHistoryNav().page)
  const activePageRef = useRef(activePage)
  // How the student last came to « Mes notes », for its page_viewed
  // (src/gradesAnalytics.js): a reload already on it counts as history.
  const [gradesArrivalSource, setGradesArrivalSource] = useState(() => (readHistoryNav().page === 'grades' ? 'history' : 'other'))
  // Likewise for the planning page (src/planningAnalytics.js).
  const [planningArrivalSource, setPlanningArrivalSource] = useState(() => (readHistoryNav().page === 'planning' ? 'history' : 'other'))
  // Page-switch animations only once the user has switched, not on first load.
  const [hasSwitchedPage, setHasSwitchedPage] = useState(false)
  const [theme, setTheme] = useState(() => getStoredTheme())
  const [showAppDescriptions, setShowAppDescriptions] = useState(() => getStoredShowAppDescriptions())
  // Compact sidebar (icons alone): kept for the device, like its width.
  // Toggled from the sidebar's handle and the settings.
  const [sidebarCompact, setSidebarCompact] = useState(getStoredSidebarCompact)
  const [mailReaderOpen, setMailReaderOpen] = useState(false)
  const [sidebarAutoCompactDismissed, setSidebarAutoCompactDismissed] = useState(false)
  const [showPlanningWeekend, setShowPlanningWeekend] = useState(() => getStoredShowPlanningWeekend())
  const [anonymousAnalytics, setAnonymousAnalytics] = useState(() => getStoredAnonymousAnalytics())
  const isAnalyticsAvailable = useAnalyticsAvailable()
  // Lookahead actually fed to the next-class widget. Re-synced only while the
  // account modal is closed, so moving the slider doesn't refetch the widget
  // on every step.
  const [appliedLookaheadDays, setAppliedLookaheadDays] = useState(nextClassLookaheadDays)
  const [profileUser, setProfileUser] = useState(null)
  const [isHydratingProfile, setIsHydratingProfile] = useState(false)
  const [hasHydratedProfile, setHasHydratedProfile] = useState(false)
  const [profileReloadNonce, setProfileReloadNonce] = useState(0)
  // Set by the debug panel's "forcer le choix du TP", read once by the next
  // profile hydration.
  const debugForceTpChoiceRef = useRef(false)
  const [tpOnboardingState, setTpOnboardingState] = useState(createEmptyTpOnboardingState)
  const [tpTransitionDirection, setTpTransitionDirection] = useState('initial')
  const [completionScreenState, setCompletionScreenState] = useState({
    visible: false,
    leaving: false,
    userName: '',
  })
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
  const [accountModalPhoto, setAccountModalPhoto] = useState(null)
  const [accountModalPlanningState, setAccountModalPlanningState] = useState(createEmptyAccountModalPlanningState)
  // 'idle' | 'loading' | 'done' — once the ADE tree has loaded (or failed),
  // reopening the account modal reuses the in-memory state instead of
  // reloading everything.
  const accountModalAdeLoadRef = useRef('idle')
  const [dashboardRevealNonce, setDashboardRevealNonce] = useState(0)
  const [isSidebarViewport, setIsSidebarViewport] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  ))
  const [favoritesSlotEl, setFavoritesSlotEl] = useState(null)
  const [sessionState, setSessionState] = useState({
    checking: true,
    authenticated: false,
    user: null,
    givenName: null,
    account: null,
    degraded: false,
    degradedReason: null,
    sessionSource: null,
    canUseServerLaunch: false,
    warning: '',
    error: '',
  })
  const [hasCheckedInitialSession, setHasCheckedInitialSession] = useState(false)
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [opensOnLogin] = useState(shouldOpenOnLogin)
  const [debugState, setDebugState] = useState({
    loading: false,
    label: 'Session',
    error: '',
    payload: buildDebugSnapshot('Session', { status: 'initializing' }),
  })

  // The debug menu's « Appels » output: the session, sign-in and sign-out
  // flows report into it too, so it lives here.
  const startDebugState = useCallback((label) => {
    setDebugState((current) => ({
      ...current,
      loading: true,
      label,
      error: '',
    }))
  }, [])

  const commitDebugState = useCallback((label, data, error = '') => {
    setDebugState({
      loading: false,
      label,
      error,
      payload: buildDebugSnapshot(label, data, error),
    })
  }, [])

  const refreshSession = useCallback(async (options = {}) => {
    const { exposeOutput = false } = options

    setSessionState((current) => ({
      ...current,
      checking: true,
      error: '',
    }))

    if (exposeOutput) {
      startDebugState('Session')
    }

    try {
      const session = await getAuthSession()
      setAnalyticsAvailable(session?.analyticsEnabled)
      reportSettingsTransfer()
      let givenName = null
      let account = null

      if (session.authenticated) {
        try {
          const accountResponse = await getAccountInfo()
          account = accountResponse.account ?? null
          givenName = account?.given_name ?? null
        } catch {
          // Account info is best-effort
        }
      }

      const authenticated = Boolean(session.authenticated)
      const user = session.user ?? null
      const warning = getSessionWarningMessage(session)

      setSessionState({
        checking: false,
        authenticated,
        user,
        givenName,
        account,
        degraded: Boolean(session.degraded),
        degradedReason: session.degradedReason ?? null,
        sessionSource: session.sessionSource ?? null,
        canUseServerLaunch: Boolean(session.canUseServerLaunch),
        warning,
        error: '',
      })

      if (!authenticated) {
        clearLegacySensitiveClientCaches()
      }

      if (exposeOutput) {
        commitDebugState('Session', session)
      }

      return session
    } catch (error) {
      const message = getFrenchAuthErrorMessage(error, 'session')

      setSessionState({
        checking: false,
        authenticated: false,
        user: null,
        givenName: null,
        account: null,
        degraded: false,
        degradedReason: null,
        sessionSource: null,
        canUseServerLaunch: false,
        warning: '',
        error: message,
      })
      clearLegacySensitiveClientCaches()

      if (exposeOutput) {
        commitDebugState('Session', null, message)
      }

      return null
    } finally {
      setHasCheckedInitialSession(true)
    }
  }, [commitDebugState, startDebugState])

  useEffect(() => {
    clearLegacySensitiveClientCaches()
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshSession({ exposeOutput: DEBUG_MENU_ENABLED })
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [refreshSession])

  useEffect(() => {
    let faviconLink = document.querySelector("link[rel='icon']")

    if (!faviconLink) {
      faviconLink = document.createElement('link')
      faviconLink.setAttribute('rel', 'icon')
      document.head.appendChild(faviconLink)
    }

    faviconLink.setAttribute('type', 'image/png')
    faviconLink.setAttribute('href', favicon)
  }, [])

  const navigate = useCallback((path, { replace = false } = {}) => {
    if (window.location.pathname !== path) {
      // Replacing keeps the entry's state (the in-app page, see appHistory.js).
      if (replace) window.history.replaceState(window.history.state, '', path)
      else window.history.pushState(null, '', path)
    }
    setPathname(path)
  }, [])

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Signed out, the app shows the landing page at / and the login page at
  // /login. Signing in leaves /login for /, signing out (or the session
  // expiring) goes to the landing page.
  const showLoginPage = pathname === LOGIN_PATH || opensOnLogin
  const wasAuthenticatedRef = useRef(false)
  useEffect(() => {
    if (sessionState.checking) return
    if (sessionState.authenticated) {
      wasAuthenticatedRef.current = true
      if (pathname === LOGIN_PATH) navigate('/', { replace: true })
      return
    }
    if (wasAuthenticatedRef.current) {
      wasAuthenticatedRef.current = false
      navigate('/', { replace: true })
    } else if (showLoginPage && pathname !== LOGIN_PATH) {
      navigate(LOGIN_PATH, { replace: true })
    }
  }, [sessionState.checking, sessionState.authenticated, pathname, showLoginPage, navigate])

  useEffect(() => {
    syncRuntimeSeo({ authenticated: sessionState.authenticated })
  }, [sessionState.authenticated, pathname])

  useEffect(() => {
    if (!completionScreenState.visible) {
      return undefined
    }

    const leaveTimeoutId = window.setTimeout(() => {
      setCompletionScreenState((current) => ({
        ...current,
        leaving: true,
      }))
    }, ONBOARDING_COMPLETION_SCREEN_MS - 280)

    const dismissTimeoutId = window.setTimeout(() => {
      setCompletionScreenState((current) => ({
        ...current,
        visible: false,
        leaving: false,
      }))
      setDashboardRevealNonce((current) => current + 1)
    }, ONBOARDING_COMPLETION_SCREEN_MS)

    return () => {
      window.clearTimeout(leaveTimeoutId)
      window.clearTimeout(dismissTimeoutId)
    }
  }, [completionScreenState.visible])

  useEffect(() => {
    if (sessionState.authenticated && profileUser === sessionState.user) {
      return undefined
    }

    setCompletionScreenState({
      visible: false,
      userName: '',
    })

    return undefined
  }, [profileUser, sessionState.authenticated, sessionState.user])

  useEffect(() => {
    if (sessionState.checking) {
      return undefined
    }

    if (!sessionState.authenticated || !sessionState.user) {
      setProfileUser(null)
      setEstablishment(null)
      setSelectedTp(null)
      setHasHydratedProfile(false)
      setTpOnboardingState(createEmptyTpOnboardingState())
      setIsHydratingProfile(false)
      return undefined
    }

    if (profileUser === sessionState.user) {
      return undefined
    }

    setProfileUser(sessionState.user)
    setEstablishment(getStoredEstablishment(sessionState.user))
    setSelectedTp(getStoredTpSelection(sessionState.user))
    setNextClassLookaheadDays(getStoredAdeLookaheadDays(sessionState.user))
    setHiddenWidgets(getStoredHiddenWidgets(sessionState.user))
    setCustomBackground(getStoredCustomBackground(sessionState.user))
    setShowWallpaper(getStoredShowWallpaper(sessionState.user))
    setShowUniversityLogo(getStoredShowUniversityLogo(sessionState.user))
    setLogoSource(getStoredLogoSource(sessionState.user))
    setShowAppDescriptions(getStoredShowAppDescriptions(sessionState.user))
    setShowPlanningWeekend(getStoredShowPlanningWeekend(sessionState.user))
    // Applied to the analytics module right away (not in an effect) so the
    // first dashboard events already honour this user's choice.
    const storedAnonymousAnalytics = getStoredAnonymousAnalytics(sessionState.user)
    setAnalyticsUserEnabled(storedAnonymousAnalytics)
    setAnonymousAnalytics(storedAnonymousAnalytics)
    setHasHydratedProfile(false)
    setTpOnboardingState(createEmptyTpOnboardingState())

    return undefined
  }, [profileUser, sessionState.authenticated, sessionState.checking, sessionState.user])

  useEffect(() => {
    if (!sessionState.authenticated || sessionState.checking || !sessionState.user) {
      return undefined
    }

    if (profileUser !== sessionState.user || hasHydratedProfile) {
      return undefined
    }

    let cancelled = false
    setIsHydratingProfile(true)
    setTpOnboardingState((current) => createEmptyTpOnboardingState({
      ...current,
      loadingStep: 'year',
      loadingMessage: "Récupération de ton groupe...",
      errorMessage: '',
    }))

    async function hydrateProfile() {
      try {
        const storedSelection = getStoredTpSelection(sessionState.user)

        if (storedSelection) {
          if (cancelled) {
            return
          }

          setSelectedTp(storedSelection)
          setTpOnboardingState(createEmptyTpOnboardingState({
            contextLabel: storedSelection.contextLabel ?? '',
            program: storedSelection.programResourceId
              ? {
                  resourceId: storedSelection.programResourceId,
                  label: storedSelection.programLabel ?? '',
                }
              : null,
          }))
          return
        }

        let scodocGroupSelection = null
        try {
          const gradesResponse = await getGrades()
          if (gradesResponse?.authenticated && !gradesResponse?.disabled) {
            scodocGroupSelection = detectScodocGroupSelection(gradesResponse.grades)
          }
        } catch {
          // Grades are best-effort for onboarding auto-selection.
        }

        // Debug panel, one shot: stop at the TP step even when it's detected.
        const forceTpChoice = debugForceTpChoiceRef.current
        debugForceTpChoiceRef.current = false

        let treeResponse = await getAdeTree()
        // Planning never set up on the account (no group of its own): its
        // ScoDoc group, found in the planning, stands in for it.
        if (!treeResponse?.tree?.defaultSelection?.resourceId && scodocGroupSelection?.tpAliases?.length) {
          const fallbackGroup = await findAdeGroupForScodoc(scodocGroupSelection).catch(() => null)
          if (fallbackGroup) {
            treeResponse = await getAdeTree('', { fallback: fallbackGroup.id })
          }
        }
        let treePayload = treeResponse?.tree
        const detectedEstablishment = detectEstablishmentFromAdeTree(treePayload)
        const resolvedDefault = treePayload?.defaultSelection?.resourceId
          ? await resolveDefaultSelectionTp(treePayload.defaultSelection, {
            tdAliases: scodocGroupSelection?.tdAliases ?? [],
            tpAliases: scodocGroupSelection?.tpAliases ?? [],
            forceChoice: forceTpChoice,
          })
          : null

        if (resolvedDefault?.tpChoice) {
          const tpChoiceState = await buildTpChoiceOnboardingState(treePayload, resolvedDefault.tpChoice.baseSelection, resolvedDefault.tpChoice)
          if (cancelled) {
            return
          }

          persistEstablishment(detectedEstablishment, sessionState.user)
          setEstablishment(detectedEstablishment)
          setSelectedTp(null)
          setTpOnboardingState(tpChoiceState)
          return
        }

        const defaultSelection = resolvedDefault?.selection ?? null

        if (defaultSelection) {
          if (cancelled) {
            return
          }

          persistEstablishment(detectedEstablishment, sessionState.user)
          setEstablishment(detectedEstablishment)
          persistTpSelection(defaultSelection, sessionState.user)
          clearAdeTimetableCache()
          setSelectedTp(defaultSelection)
          setTpOnboardingState(createEmptyTpOnboardingState({
            contextLabel: defaultSelection.contextLabel ?? '',
            program: defaultSelection.programResourceId
              ? {
                  resourceId: defaultSelection.programResourceId,
                  label: defaultSelection.programLabel ?? '',
                }
              : null,
          }))
          return
        }

        let nextTpOnboardingState = buildInitialTpOnboardingState(treePayload)

        if (nextTpOnboardingState.program?.resourceId && nextTpOnboardingState.yearOptions.length === 0) {
          treeResponse = await getAdeTree(nextTpOnboardingState.program.resourceId)
          treePayload = treeResponse?.tree
          nextTpOnboardingState = buildInitialTpOnboardingState(treePayload)
        }

        if (cancelled) {
          return
        }

        persistEstablishment(detectedEstablishment, sessionState.user)
        setEstablishment(detectedEstablishment)

        const detectedYear = nextTpOnboardingState.detectedSelections.year

        if (detectedYear?.resourceId) {
          const detectedYearTreeResponse = await getAdeTree(detectedYear.resourceId)
          const detectedYearStep = buildNextTpStepFromTree(detectedYearTreeResponse?.tree)

          if (cancelled) {
            return
          }

          nextTpOnboardingState = {
            ...nextTpOnboardingState,
            contextLabel: nextTpOnboardingState.contextLabel || detectedYearStep.contextLabel,
            selectedYear: detectedYear,
            tdOptions: detectedYearStep.options,
            errorMessage: detectedYearStep.options.length > 0
              ? ''
              : "Aucun groupe TD n'a été trouvé pour le moment",
          }

          const autoDetectedTd = findTpOptionByLabel(
            detectedYearStep.options,
            scodocGroupSelection?.tdAliases?.length
              ? scodocGroupSelection.tdAliases
              : scodocGroupSelection?.tdLabel,
          )

          if (autoDetectedTd?.resourceId) {
            const detectedTdTreeResponse = await getAdeTree(autoDetectedTd.resourceId)
            const detectedTdStep = buildNextTpStepFromTree(detectedTdTreeResponse?.tree)

            if (cancelled) {
              return
            }

            const autoDetectedTp = findTpOptionByLabel(
              detectedTdStep.options,
              scodocGroupSelection?.tpAliases?.length
                ? scodocGroupSelection.tpAliases
                : scodocGroupSelection?.tpLabel,
            )
            const autoStoredSelection = buildStoredTpSelection(
              nextTpOnboardingState.program,
              detectedYear,
              autoDetectedTd,
              autoDetectedTp,
              nextTpOnboardingState.contextLabel || detectedTdStep.contextLabel,
            )

            if (autoStoredSelection && ((autoDetectedTp?.resourceId && !forceTpChoice) || detectedTdStep.options.length === 0)) {
              persistTpSelection(autoStoredSelection, sessionState.user)
              clearAdeTimetableCache()
              setSelectedTp(autoStoredSelection)
              setTpOnboardingState(createEmptyTpOnboardingState({
                contextLabel: autoStoredSelection.contextLabel ?? '',
                program: nextTpOnboardingState.program,
                selectedYear: detectedYear,
                selectedTd: autoDetectedTd,
              }))
              return
            }

            nextTpOnboardingState = {
              ...nextTpOnboardingState,
              contextLabel: nextTpOnboardingState.contextLabel || detectedTdStep.contextLabel,
              selectedTd: autoDetectedTd,
              tpOptions: detectedTdStep.options,
              detectedSelections: {
                ...nextTpOnboardingState.detectedSelections,
                td: autoDetectedTd,
                tp: autoDetectedTp,
              },
            }
          }
        }

        setSelectedTp(null)
        setTpOnboardingState(nextTpOnboardingState)
      } catch {
        if (cancelled) {
          return
        }

        if (!establishment) {
          persistEstablishment('other', sessionState.user)
          setEstablishment('other')
        }

        setSelectedTp({ resourceId: null, skipped: true })
        setTpOnboardingState(createEmptyTpOnboardingState())
      } finally {
        if (!cancelled) {
          setIsHydratingProfile(false)
          setHasHydratedProfile(true)
        }
      }
    }

    void hydrateProfile()

    return () => {
      cancelled = true
    }
  }, [
    establishment,
    hasHydratedProfile,
    profileReloadNonce,
    profileUser,
    sessionState.authenticated,
    sessionState.checking,
    sessionState.user,
  ])

  const commitTpSelection = useCallback((program, contextLabel, year, td, tp) => {
    const storedSelection = buildStoredTpSelection(program, year, td, tp, contextLabel)
    if (!storedSelection) {
      return
    }

    persistTpSelection(storedSelection, sessionState.user)
    clearAdeTimetableCache()
    setSelectedTp(storedSelection)
    setTpOnboardingState(createEmptyTpOnboardingState({
      contextLabel,
      program,
      selectedYear: year,
      selectedTd: td,
    }))
    setCompletionScreenState({
      visible: true,
      leaving: false,
      userName: sessionState.givenName ?? sessionState.user ?? '',
    })
  }, [sessionState.givenName, sessionState.user])

  const loadTdOptions = useCallback(async (yearOption) => {
    setTpOnboardingState((current) => ({
      ...current,
      selectedYear: yearOption,
      selectedTd: null,
      tdOptions: [],
      tpOptions: [],
      errorMessage: '',
      loadingStep: 'td',
      loadingMessage: 'Récupération des TD...',
    }))

    try {
      const treeResponse = await getAdeTree(yearOption.resourceId)
      const nextStep = buildNextTpStepFromTree(treeResponse?.tree)

      if (nextStep.options.length === 0) {
        commitTpSelection(
          tpOnboardingState.program,
          tpOnboardingState.contextLabel || nextStep.contextLabel,
          yearOption,
          null,
          null,
        )
        return
      }

      setTpOnboardingState((current) => ({
        ...current,
        contextLabel: current.contextLabel || nextStep.contextLabel,
        selectedYear: yearOption,
        selectedTd: null,
        tdOptions: nextStep.options,
        tpOptions: [],
        errorMessage: '',
        loadingStep: null,
        loadingMessage: '',
      }))
    } catch (error) {
      setTpOnboardingState((current) => ({
        ...current,
        selectedYear: yearOption,
        selectedTd: null,
        tdOptions: [],
        tpOptions: [],
        errorMessage: getFrenchTpLoadErrorMessage(error),
        loadingStep: null,
        loadingMessage: '',
      }))
    }
  }, [commitTpSelection, tpOnboardingState.contextLabel, tpOnboardingState.program])

  const loadTpOptions = useCallback(async (tdOption) => {
    setTpOnboardingState((current) => ({
      ...current,
      selectedTd: tdOption,
      tpOptions: [],
      errorMessage: '',
      loadingStep: 'tp',
      loadingMessage: 'Récupération des TP...',
    }))

    try {
      const treeResponse = await getAdeTree(tdOption.resourceId)
      const nextStep = buildNextTpStepFromTree(treeResponse?.tree)

      if (nextStep.options.length === 0) {
        commitTpSelection(
          tpOnboardingState.program,
          tpOnboardingState.contextLabel || nextStep.contextLabel,
          tpOnboardingState.selectedYear,
          tdOption,
          null,
        )
        return
      }

      setTpOnboardingState((current) => ({
        ...current,
        contextLabel: current.contextLabel || nextStep.contextLabel,
        selectedTd: tdOption,
        tpOptions: nextStep.options,
        errorMessage: '',
        loadingStep: null,
        loadingMessage: '',
      }))
    } catch (error) {
      setTpOnboardingState((current) => ({
        ...current,
        selectedTd: tdOption,
        tpOptions: [],
        errorMessage: getFrenchTpLoadErrorMessage(error),
        loadingStep: null,
        loadingMessage: '',
      }))
    }
  }, [commitTpSelection, tpOnboardingState.contextLabel, tpOnboardingState.program, tpOnboardingState.selectedYear])

  useEffect(() => {
    if (sessionState.authenticated) {
      return
    }

    setIsAccountModalOpen(false)
    setAccountModalPhoto(null)
    setAccountModalPlanningState(createEmptyAccountModalPlanningState())
    accountModalAdeLoadRef.current = 'idle'
  }, [sessionState.authenticated])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(min-width: 1024px)')
    const handleChange = (event) => setIsSidebarViewport(event.matches)
    setIsSidebarViewport(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  useEffect(() => {
    if (!sessionState.authenticated) {
      return undefined
    }

    let cancelled = false

    void resolveAccountProfilePhoto(sessionState.account).then((photoSrc) => {
      if (!cancelled) {
        setAccountModalPhoto(photoSrc)
      }
    })

    return () => {
      cancelled = true
    }
  }, [sessionState.authenticated, sessionState.account])

  // The school certificate's status, asked in the background a moment after
  // sign-in (the dashboard's own data first): Réglages shows it at once.
  useEffect(() => {
    if (!sessionState.authenticated || sessionState.checking) {
      return undefined
    }

    const timeoutId = window.setTimeout(preloadSchoolCertificateStatus, 2000)
    return () => window.clearTimeout(timeoutId)
  }, [sessionState.authenticated, sessionState.checking])

  useEffect(() => {
    // A personal timetable has no group to choose (planning.personal).
    if (!isAccountModalOpen || !sessionState.authenticated || HAS_PERSONAL_PLANNING) {
      return undefined
    }

    // ADE already loaded (or failed) — keep the current planning state
    // instead of reloading the whole thing on every open.
    if (accountModalAdeLoadRef.current !== 'idle') {
      return undefined
    }

    let cancelled = false
    accountModalAdeLoadRef.current = 'loading'

    setAccountModalPlanningState(createStoredPlanningDraftState(selectedTp, {
      loading: true,
      loadingMessage: 'Chargement...',
    }))

    void buildAccountModalPlanningState(selectedTp)
      .then((nextPlanningState) => {
        if (!cancelled) {
          accountModalAdeLoadRef.current = 'done'
          setAccountModalPlanningState(nextPlanningState)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          accountModalAdeLoadRef.current = 'done'
          setAccountModalPlanningState(createStoredPlanningDraftState(selectedTp, {
            loading: false,
            loadingMessage: '',
            errorMessage: getFrenchTpLoadErrorMessage(error),
          }))
        }
      })

    return () => {
      cancelled = true
      if (accountModalAdeLoadRef.current === 'loading') {
        accountModalAdeLoadRef.current = 'idle'
      }
    }
  }, [isAccountModalOpen, selectedTp, sessionState.authenticated])

  const handleOpenAccountModal = useCallback(() => {
    if (!sessionState.authenticated || sessionState.checking) {
      return
    }

    setIsAccountModalOpen(true)
  }, [sessionState.authenticated, sessionState.checking])

  // Closing the modal (X, backdrop, Escape) applies the draft planning
  // selection — there is no separate "Appliquer" step. No-ops when the
  // selection is incomplete or unchanged.
  const handleCloseAccountModal = useCallback(() => {
    setIsAccountModalOpen(false)

    if (!sessionState.user || HAS_PERSONAL_PLANNING) {
      return
    }

    const nextSelection = buildStoredTpSelection(
      accountModalPlanningState.program,
      accountModalPlanningState.draftYear,
      accountModalPlanningState.draftTd,
      accountModalPlanningState.draftTp,
      accountModalPlanningState.contextLabel,
    )

    if (!nextSelection) {
      return
    }

    const isSameSelection = Boolean(selectedTp)
      && selectedTp.resourceId === nextSelection.resourceId
      && (selectedTp.yearResourceId ?? null) === (nextSelection.yearResourceId ?? null)
      && (selectedTp.tdResourceId ?? null) === (nextSelection.tdResourceId ?? null)
      && (selectedTp.tpResourceId ?? null) === (nextSelection.tpResourceId ?? null)

    if (isSameSelection) {
      return
    }

    persistTpSelection(nextSelection, sessionState.user)
    clearAdeTimetableCache()
    setSelectedTp(nextSelection)
    setTpOnboardingState(createEmptyTpOnboardingState({
      contextLabel: accountModalPlanningState.contextLabel,
      program: accountModalPlanningState.program,
      selectedYear: accountModalPlanningState.draftYear,
      selectedTd: accountModalPlanningState.draftTd,
    }))
  }, [accountModalPlanningState, selectedTp, sessionState.user])

  const handleNextClassLookaheadChange = useCallback((days) => {
    persistAdeLookaheadDays(days, sessionState.user)
    setNextClassLookaheadDays(days)
  }, [sessionState.user])

  const heroImage = useMemo(() => (
    customBackground
      ? { src: customBackground, position: null, credit: null }
      : resolveHeroImage(establishment, new Date(), heroOffset)
  ), [customBackground, establishment, heroOffset])
  // BUT-only features ("Mes notes", the grade card) hide for a student whose
  // relevé is another formation's; unknown keeps them (no flicker for BUT).
  const gradesFormation = useGradesFormation({
    enabled: Boolean(sessionState.authenticated && universityConfig.establishments?.byId?.[establishment]?.gradeWidgets),
    user: sessionState.user,
  })
  const gradesSupported = gradesFormation !== 'other'
  const hasGradesPage = useMemo(
    () => getMobileTabItems(establishment, { gradesSupported }).some((item) => item.page === 'grades'),
    [establishment, gradesSupported],
  )
  // The in-app planning page, on the same terms as its nav item
  // (features.planning): the planning service's links open it instead.
  const hasPlanningPage = useMemo(
    () => getMobileTabItems(establishment, { gradesSupported }).some((item) => item.page === 'planning'),
    [establishment, gradesSupported],
  )
  // The in-app mail page (features.mail, mail.page in client.js): the
  // dashboard's mail card opens it, Réglages › Messagerie comes with it.
  const hasMailPage = useMemo(
    () => getMobileTabItems(establishment, { gradesSupported }).some((item) => item.page === 'mail'),
    [establishment, gradesSupported],
  )
  const hasMobileTabBar =useMemo(() => getMobileTabItems(establishment, { gradesSupported }).length > 0, [establishment, gradesSupported])
  // « Nouveautés » about « Mes notes » only reach students who have it: a
  // school with the page and a relevé confirmed BUT (not while unknown, so
  // the pill doesn't come and go). Those about the Planning page, students
  // signed in at a school with it.
  const hasConfirmedGradesPage = hasGradesPage && gradesFormation === 'BUT'
  const hasConfirmedPlanningPage = hasPlanningPage && sessionState.authenticated
  useEffect(() => {
    setChangelogAudience([
      ...(hasConfirmedGradesPage ? ['grades-page'] : []),
      ...(hasConfirmedPlanningPage ? ['planning-page'] : []),
    ])
  }, [hasConfirmedGradesPage, hasConfirmedPlanningPage])
  // Falls back to the dashboard if the grades item goes away (establishment
  // without grade widgets, feature switched off, a relevé that isn't BUT).
  const isGradesPage = useMemo(
    () => activePage === 'grades' && getMobileTabItems(establishment, { gradesSupported }).some((item) => item.page === 'grades'),
    [activePage, establishment, gradesSupported],
  )
  // Likewise for the planning page (features.planning).
  const isPlanningPage = useMemo(
    () => activePage === 'planning' && getMobileTabItems(establishment, { gradesSupported }).some((item) => item.page === 'planning'),
    [activePage, establishment, gradesSupported],
  )
  // Likewise for the mail page (features.mail).
  const isMailPage = useMemo(
    () => activePage === 'mail' && getMobileTabItems(establishment, { gradesSupported }).some((item) => item.page === 'mail'),
    [activePage, establishment, gradesSupported],
  )
  // Folded for a mail open beside the list (handleMailReaderOpenChange).
  const isSidebarAutoCompact = isMailPage && mailReaderOpen && !sidebarCompact && !sidebarAutoCompactDismissed
  // The page the sidebar and the tab bar show as selected.
  const shownPage = isGradesPage ? 'grades' : isPlanningPage ? 'planning' : isMailPage ? 'mail' : 'dashboard'
  // Being on « Mes notes » is having seen its launch, however the student
  // got there (tab, card, "Dernière note", app list, a reload on the page):
  // the dashboard card and the tab's « Nouveau » go. After the audience
  // effect above, so an entry it brings in while on the page goes too.
  useEffect(() => {
    if (isGradesPage && hasConfirmedGradesPage) markChangelogEntrySeen('mes-notes')
  }, [isGradesPage, hasConfirmedGradesPage])
  // Likewise for the Planning's launch.
  useEffect(() => {
    if (isPlanningPage && hasConfirmedPlanningPage) markChangelogEntrySeen('planning')
  }, [isPlanningPage, hasConfirmedPlanningPage])
  // The other pages sit on the plain background, like with the wallpaper off.
  const isWallpaperShown = showWallpaper && shownPage === 'dashboard'

  // Rejects with a user-facing message (shown in Mon compte) on failure.
  const handleCustomBackgroundChange = useCallback(async (file) => {
    const dataUrl = await saveCustomBackground(file, sessionState.user)
    setCustomBackground(dataUrl)
    track('setting_changed', { setting: 'custom_background', value: 'on' })
  }, [sessionState.user])

  const handleCustomBackgroundReset = useCallback(() => {
    clearStoredCustomBackground()
    setCustomBackground(null)
    track('setting_changed', { setting: 'custom_background', value: 'off' })
  }, [])

  useEffect(() => watchTheme(theme), [theme])

  const handleThemeChange = useCallback((nextTheme) => {
    persistTheme(nextTheme)
    setTheme(nextTheme)
    track('setting_changed', { setting: 'theme', value: nextTheme })
  }, [])

  const handleShowWallpaperChange = useCallback((show) => {
    persistShowWallpaper(show, sessionState.user)
    setShowWallpaper(show)
    track('setting_changed', { setting: 'wallpaper', value: show ? 'on' : 'off' })
  }, [sessionState.user])
  const handleShowUniversityLogoChange = useCallback((show) => {
    persistShowUniversityLogo(show, sessionState.user)
    setShowUniversityLogo(show)
    track('setting_changed', { setting: 'university_logo', value: show ? 'on' : 'off' })
  }, [sessionState.user])
  const handleLogoSourceChange = useCallback((source) => {
    persistLogoSource(source, sessionState.user)
    setLogoSource(source)
  }, [sessionState.user])
  const [heroHeight, setHeroHeight] = useState(null)
  const heroObserverRef = useRef(null)
  const dashboardColumnElementRef = useRef(null)

  // The hero photo runs behind the header and the whole widget row (one or
  // two lines, fewer when widgets are hidden), then fades just below it.
  // Callback ref: the dashboard column mounts after auth/onboarding settle.
  const dashboardColumnRef = useCallback((column) => {
    dashboardColumnElementRef.current = column
    heroObserverRef.current?.disconnect()
    heroObserverRef.current = null

    const widgetRow = column?.querySelector('.widget-row')
    if (!column || !widgetRow || typeof ResizeObserver === 'undefined') {
      return
    }

    const measure = () => {
      const columnTop = column.getBoundingClientRect().top - column.scrollTop
      setHeroHeight(Math.round(widgetRow.getBoundingClientRect().bottom - columnTop + HERO_FADE_OVERHANG_PX))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(widgetRow)
    observer.observe(column)
    heroObserverRef.current = observer
  }, [])

  // Shows a page at its top, once it's rendered. Wide screens scroll the
  // column itself, narrower ones the window.
  // `source`: how « Mes notes » or the planning was reached
  // (src/gradesAnalytics.js, src/planningAnalytics.js).
  const showPage = useCallback((page, source = 'other') => {
    if (page === 'grades') setGradesArrivalSource(source)
    if (page === 'planning') setPlanningArrivalSource(source)
    setActivePage(page)
    setHasSwitchedPage(true)
    window.requestAnimationFrame(() => {
      dashboardColumnElementRef.current?.scrollTo({ top: 0 })
      window.scrollTo({ top: 0 })
    })
  }, [])

  // Sidebar / tab bar page switch: a new history entry. `source` says where
  // from, for « Mes notes »'s and the planning's page_viewed ('nav',
  // 'tabbar'…).
  const handleNavigatePage = useCallback((page, source = 'other') => {
    if (page !== activePageRef.current) writeHistoryNav({ page })
    showPage(page, source)
  }, [showPage])

  // The dashboard's "Dernière note" (or the sidebar's, `source`): "Mes
  // notes", opened on that grade.
  const [pendingGradeRequest, setPendingGradeRequest] = useState(null)
  const handleOpenLatestGrade = useCallback((grade, source = 'dashboard_card') => {
    setPendingGradeRequest({ evaluationId: grade.id, moduleCode: grade.resource })
    handleNavigatePage('grades', source)
  }, [handleNavigatePage])
  const handleOpenSidebarGrade = useCallback((grade) => handleOpenLatestGrade(grade, 'sidebar_card'), [handleOpenLatestGrade])
  const clearPendingGradeRequest = useCallback(() => setPendingGradeRequest(null), [])
  // The grade service's app in the app lists ('tile': "Mes notes" rather
  // than ScoDoc) and the launch card ('launch_card') say which they are.
  const handleOpenGradesPage = useCallback((source = 'tile') => handleNavigatePage('grades', source), [handleNavigatePage])
  // The planning service's app in the app lists ('tile': the planning page
  // rather than the service) and its launch card ('launch_card').
  const handleOpenPlanningPage = useCallback((source = 'tile') => handleNavigatePage('planning', source), [handleNavigatePage])
  // The dashboard's "Prochain cours": the planning page, opened on that
  // class's day (today without one).
  const [pendingPlanningDay, setPendingPlanningDay] = useState(null)
  const handleOpenPlanningDay = useCallback((day) => {
    setPendingPlanningDay(day ?? null)
    handleNavigatePage('planning', 'dashboard_card')
  }, [handleNavigatePage])
  const clearPendingPlanningDay = useCallback(() => setPendingPlanningDay(null), [])
  // The webmail's app in the app lists ('tile'): the mail page rather than
  // the webmail.
  const handleOpenMailPage = useCallback((source = 'tile') => handleNavigatePage('mail', source), [handleNavigatePage])
  // The dashboard's "Mails récents": the mail page, on a mail (its history
  // entry names it, which the page reads as it opens).
  const handleOpenMail = useCallback((id) => {
    if (id) {
      writeHistoryNav({ page: 'mail', mail: id })
      showPage('mail', 'dashboard_card')
      return
    }
    handleNavigatePage('mail', 'dashboard_card')
  }, [showPage, handleNavigatePage])

  // The current entry says which page it is (the first one included); the
  // app sets scroll positions itself. Back and forward show the entry's page
  // (a UE opened full page is handled by the grades page).
  useEffect(() => {
    activePageRef.current = activePage
  }, [activePage])
  useEffect(() => {
    try {
      window.history.scrollRestoration = 'manual'
    } catch {
      // Older browsers: their own restoration is harmless.
    }
    writeHistoryNav(readHistoryNav(), { replace: true })
    const handlePopState = (event) => {
      const { page } = readHistoryNav(event.state)
      if (page !== activePageRef.current) showPage(page, 'history')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [showPage])

  const handleWidgetVisibilityChange = useCallback((widgetId, visible) => {
    track('setting_changed', { setting: 'widget_visibility', value: visible ? 'on' : 'off', widget: widgetId })
    setHiddenWidgets((current) => {
      const next = visible
        ? current.filter((id) => id !== widgetId)
        : [...current.filter((id) => id !== widgetId), widgetId]
      persistHiddenWidgets(next, sessionState.user)
      return next
    })
  }, [sessionState.user])

  const widgetToggles = useMemo(() => getAvailableWidgets(establishment).map((widget) => ({
    id: widget.id,
    label: widget.label,
    icon: widget.icon,
    visible: !hiddenWidgets.includes(widget.id),
  })), [establishment, hiddenWidgets])

  const handleShowPlanningWeekendChange = useCallback((show) => {
    persistShowPlanningWeekend(show, sessionState.user)
    setShowPlanningWeekend(show)
  }, [sessionState.user])

  // `persist` false: live under the pointer, stored on release.
  const handleSidebarCompactChange = useCallback((compact, { persist = true } = {}) => {
    setSidebarCompact(compact)
    if (persist) persistSidebarCompact(compact)
    // Unfolded by hand while a mail is open: it stays so until it closes.
    if (!compact) setSidebarAutoCompactDismissed(true)
  }, [])

  // A mail open in the side panel folds the sidebar for the list's room
  // (unless already folded by hand); it unfolds over the page on hover.
  const handleMailReaderOpenChange = useCallback((open) => {
    setMailReaderOpen(open)
    setSidebarAutoCompactDismissed(false)
  }, [])

  const handleShowAppDescriptionsChange = useCallback((show) => {
    persistShowAppDescriptions(show, sessionState.user)
    setShowAppDescriptions(show)
    track('setting_changed', { setting: 'app_descriptions', value: show ? 'on' : 'off' })
  }, [sessionState.user])

  // "Statistiques anonymes": switching it off stops tracking before anything
  // else happens, so the change itself is never reported.
  const handleAnonymousAnalyticsChange = useCallback((enabled) => {
    setAnalyticsUserEnabled(enabled)
    persistAnonymousAnalytics(enabled, sessionState.user)
    setAnonymousAnalytics(enabled)
    if (enabled) {
      track('setting_changed', { setting: 'analytics', value: 'on' })
    }
  }, [sessionState.user])

  useEffect(() => {
    setAnalyticsEstablishment(establishment)
  }, [establishment])

  useEffect(() => {
    setAnalyticsFormation(selectedTp?.programLabel ?? null)
  }, [selectedTp?.programLabel])

  useEffect(() => {
    if (!isAccountModalOpen) {
      setAppliedLookaheadDays(nextClassLookaheadDays)
    }
  }, [isAccountModalOpen, nextClassLookaheadDays])

  const handleAccountModalYearChange = useCallback(async (yearResourceId) => {
    const nextYear = findTpOptionByResourceId(accountModalPlanningState.yearOptions, yearResourceId)

    if (!nextYear) {
      return
    }

    setAccountModalPlanningState((current) => ({
      ...current,
      loading: true,
      loadingMessage: 'Chargement des TD...',
      errorMessage: '',
      draftYear: nextYear,
      draftTd: null,
      draftTp: null,
      tdOptions: [],
      tpOptions: [],
    }))

    try {
      const nextStep = await loadTdOptionsForAccountModal(nextYear)

      setAccountModalPlanningState((current) => ({
        ...current,
        loading: false,
        loadingMessage: '',
        contextLabel: getFirstAvailableString(nextStep.contextLabel, current.contextLabel) ?? '',
        draftYear: nextYear,
        draftTd: null,
        draftTp: null,
        tdOptions: nextStep.options,
        tpOptions: [],
        errorMessage: '',
      }))
    } catch (error) {
      setAccountModalPlanningState((current) => ({
        ...current,
        loading: false,
        loadingMessage: '',
        draftYear: nextYear,
        draftTd: null,
        draftTp: null,
        tdOptions: [],
        tpOptions: [],
        errorMessage: getFrenchTpLoadErrorMessage(error),
      }))
    }
  }, [accountModalPlanningState.yearOptions])

  const handleAccountModalTdChange = useCallback(async (tdResourceId) => {
    const nextTd = findTpOptionByResourceId(accountModalPlanningState.tdOptions, tdResourceId)

    if (!nextTd) {
      return
    }

    setAccountModalPlanningState((current) => ({
      ...current,
      loading: true,
      loadingMessage: 'Chargement des TP...',
      errorMessage: '',
      draftTd: nextTd,
      draftTp: null,
      tpOptions: [],
    }))

    try {
      const nextStep = await loadTpOptionsForAccountModal(nextTd)

      setAccountModalPlanningState((current) => ({
        ...current,
        loading: false,
        loadingMessage: '',
        contextLabel: getFirstAvailableString(nextStep.contextLabel, current.contextLabel) ?? '',
        draftTd: nextTd,
        draftTp: null,
        tpOptions: nextStep.options,
        errorMessage: '',
      }))
    } catch (error) {
      setAccountModalPlanningState((current) => ({
        ...current,
        loading: false,
        loadingMessage: '',
        draftTd: nextTd,
        draftTp: null,
        tpOptions: [],
        errorMessage: getFrenchTpLoadErrorMessage(error),
      }))
    }
  }, [accountModalPlanningState.tdOptions])

  const handleAccountModalTpChange = useCallback((tpResourceId) => {
    const nextTp = findTpOptionByResourceId(accountModalPlanningState.tpOptions, tpResourceId)

    setAccountModalPlanningState((current) => ({
      ...current,
      draftTp: nextTp,
      errorMessage: '',
    }))
  }, [accountModalPlanningState.tpOptions])

  const manageAccountUrl = universityConfig.links?.manageAccount ?? null
  const handleManageAccount = useCallback(() => {
    if (!manageAccountUrl) {
      return
    }

    window.location.assign(manageAccountUrl)
  }, [manageAccountUrl])

  function handleOnboardingBack() {
    setTpTransitionDirection('back')
    const currentStep = getCurrentTpOnboardingStep(tpOnboardingState)

    if (currentStep === 'td') {
      setTpOnboardingState((current) => ({
        ...current,
        selectedYear: null,
        selectedTd: null,
        tdOptions: [],
        tpOptions: [],
        errorMessage: '',
        loadingStep: null,
        loadingMessage: '',
      }))
      return
    }

    if (currentStep === 'tp') {
      setTpOnboardingState((current) => ({
        ...current,
        selectedTd: null,
        tpOptions: [],
        errorMessage: '',
        loadingStep: null,
        loadingMessage: '',
      }))
    }
  }

  function handleOnboardingRetry() {
    const currentStep = getCurrentTpOnboardingStep(tpOnboardingState)

    if (currentStep === 'year') {
      setHasHydratedProfile(false)
      setTpOnboardingState(createEmptyTpOnboardingState())
      setProfileReloadNonce((current) => current + 1)
      return
    }

    if (currentStep === 'td' && tpOnboardingState.selectedYear) {
      void loadTdOptions(tpOnboardingState.selectedYear)
      return
    }

    if (currentStep === 'tp' && tpOnboardingState.selectedTd) {
      void loadTpOptions(tpOnboardingState.selectedTd)
    }
  }

  function handleOnboardingSelect(nextOption) {
    setTpTransitionDirection('forward')
    const currentStep = getCurrentTpOnboardingStep(tpOnboardingState)

    if (currentStep === 'year') {
      void loadTdOptions(nextOption)
      return
    }

    if (currentStep === 'td') {
      void loadTpOptions(nextOption)
      return
    }

    commitTpSelection(
      tpOnboardingState.program,
      tpOnboardingState.contextLabel,
      tpOnboardingState.selectedYear,
      tpOnboardingState.selectedTd,
      nextOption,
    )
  }

  function handleOnboardingIgnore() {
    setTpTransitionDirection('forward')
    const currentStep = getCurrentTpOnboardingStep(tpOnboardingState)

    if (currentStep === 'td') {
      commitTpSelection(
        tpOnboardingState.program,
        tpOnboardingState.contextLabel,
        tpOnboardingState.selectedYear,
        null,
        null,
      )
      return
    }

    if (currentStep !== 'tp') {
      return
    }

    commitTpSelection(
      tpOnboardingState.program,
      tpOnboardingState.contextLabel,
      tpOnboardingState.selectedYear,
      tpOnboardingState.selectedTd,
      null,
    )
  }

  async function handleLogin(event) {
    event.preventDefault()

    setSessionState((current) => ({
      ...current,
      checking: true,
      error: '',
    }))
    startDebugState('Connexion')

    try {
      const result = await loginToEnt(credentials)
      const isDemo = result?.sessionMode === DEMO_SESSION_MODE
      track('login_result', { result: 'success', demo: isDemo })
      flushAnalytics()
      // Offer the accepted login to the browser's password manager (Chrome's
      // Credential Management API; others rely on the form submission).
      if (!isDemo) {
        storeBrowserPasswordCredential(credentials)
      }
      setCredentials((current) => ({
        ...current,
        password: '',
      }))
      commitDebugState('Connexion', result)
      if (reloadForOtherUniversity(result)) return
      await refreshSession()
    } catch (error) {
      const message = getFrenchAuthErrorMessage(error, 'login')
      clearLegacySensitiveClientCaches()
      setSessionState({
        checking: false,
        authenticated: false,
        user: null,
        givenName: null,
        account: null,
        degraded: false,
        degradedReason: null,
        sessionSource: null,
        canUseServerLaunch: false,
        warning: '',
        error: message,
      })
      track('login_result', { result: 'failure', demo: false })
      flushAnalytics()
      commitDebugState('Connexion', null, message)
    }
  }

  async function handleDemoLogin() {
    setCredentials({
      username: DEMO_CREDENTIALS.username,
      password: DEMO_CREDENTIALS.password,
    })

    setSessionState((current) => ({
      ...current,
      checking: true,
      error: '',
    }))
    startDebugState('Connexion demo')

    try {
      const result = await loginToEnt(DEMO_CREDENTIALS)
      track('login_result', { result: 'success', demo: true })
      flushAnalytics()
      setCredentials((current) => ({
        ...current,
        password: '',
      }))
      commitDebugState('Connexion demo', result)
      if (reloadForOtherUniversity(result)) return
      await refreshSession()
    } catch (error) {
      const message = getFrenchAuthErrorMessage(error, 'login')
      clearLegacySensitiveClientCaches()
      setSessionState({
        checking: false,
        authenticated: false,
        user: null,
        givenName: null,
        account: null,
        degraded: false,
        degradedReason: null,
        sessionSource: null,
        canUseServerLaunch: false,
        warning: '',
        error: message,
      })
      track('login_result', { result: 'failure', demo: true })
      flushAnalytics()
      commitDebugState('Connexion demo', null, message)
    }
  }

  async function handleLogout() {
    setSessionState((current) => ({
      ...current,
      checking: true,
      error: '',
    }))
    startDebugState('Deconnexion')

    // A mail sent within its « Annuler » time goes now, while the session
    // still can send it (src/mailSendQueue.js). One that fails stops the
    // logout: the mail page shows the composer again with why, rather than
    // the mail being dropped with the session.
    const unsent = await flushMailSends()
    if (unsent) {
      setSessionState((current) => ({ ...current, checking: false }))
      commitDebugState('Deconnexion', null, 'Un mail n’a pas pu partir')
      handleNavigatePage('mail')
      return
    }

    try {
      const result = await logoutFromEnt()
      clearLegacySensitiveClientCaches()
      // No reload follows: the mails read, the signatures, any send and the
      // history's mail entries must not carry over to whoever signs in
      // next in this tab.
      forgetMailAccount()
      bindHistorySession(null)
      setActivePage('dashboard')
      writeHistoryNav({ page: 'dashboard' }, { replace: true })
      setSessionState({
        checking: false,
        authenticated: false,
        user: null,
        givenName: null,
        account: null,
        degraded: false,
        degradedReason: null,
        sessionSource: null,
        canUseServerLaunch: false,
        warning: '',
        error: '',
      })
      commitDebugState('Deconnexion', result)
    } catch (error) {
      const message = getErrorMessage(error)
      setSessionState((current) => ({
        ...current,
        checking: false,
        error: message,
      }))
      commitDebugState('Deconnexion', null, message)
    }
  }

  // The mail page's « Se reconnecter » (its session expired: the app's own,
  // or only the server's CAS sign-in behind the webmail, which a new
  // sign-in alone renews). Signed out as by the header's button, then
  // straight to the login form rather than the landing page an expiry
  // otherwise leads to (wasAuthenticatedRef's effect above).
  async function handleSignInAgain() {
    wasAuthenticatedRef.current = false
    await handleLogout()
    navigate(LOGIN_PATH, { replace: true })
  }

  function handleHeaderAction() {
    if (sessionState.checking) {
      return
    }

    if (sessionState.authenticated) {
      void handleLogout()
      return
    }

    setDebugOpen(true)
  }

  const handleDebugRestartOnboarding = useCallback(({ forceTpChoice = false } = {}) => {
    if (!sessionState.authenticated || !sessionState.user) {
      return
    }

    debugForceTpChoiceRef.current = forceTpChoice

    clearStoredTpSelection()
    clearAdeTimetableCache()
    setSelectedTp(null)
    setHasHydratedProfile(false)
    setTpTransitionDirection('initial')
    setCompletionScreenState({
      visible: false,
      leaving: false,
      userName: '',
    })
    setTpOnboardingState(createEmptyTpOnboardingState())
    setProfileReloadNonce((current) => current + 1)
    setDebugOpen(false)
  }, [sessionState.authenticated, sessionState.user])

  // The signed-in student owns the mail page's history entries, read cache,
  // signatures and sends (see appHistory.js, mailReadCache.js,
  // mailSignatureStore.js, mailSendQueue.js). Done while rendering, not in
  // an effect: the mail page reads its entry and the cache in its own first
  // render, which comes before any effect of this one. Idempotent.
  if (sessionState.authenticated && sessionState.user && bindHistorySession(sessionState.user)) forgetMailAccount()

  const shouldHoldInitialRender = !hasCheckedInitialSession && sessionState.checking
  const isProfileSwitching = sessionState.authenticated && profileUser !== sessionState.user
  const shouldShowTpSetup = sessionState.authenticated && !selectedTp
  const shouldShowCompletionScreen = sessionState.authenticated && completionScreenState.visible && Boolean(selectedTp)
  const currentTpOnboardingStep = getCurrentTpOnboardingStep(tpOnboardingState)
  const currentTpStepOptions = getCurrentTpStepOptions(tpOnboardingState)
  const currentDetectedSelection = getDetectedSelectionForStep(tpOnboardingState, currentTpOnboardingStep)
  const accountDisplayInfo = getAccountDisplayInfo(
    sessionState.account,
    sessionState.user,
    sessionState.givenName,
  )
  const simpleLoadingDots = <LoadingDots className="text-text-muted" />
  // The composer's « De : » (MailPage): the account's name and address,
  // and its automatic signature's lines: the name, the group picked for the
  // planning (its year and TP, or TD, when there's one), the establishment
  // (the student's composante, when it has its own entry) and the
  // university, and their logos (each with its dark version).
  const mailSenderName = [accountDisplayInfo.firstName, accountDisplayInfo.lastName].filter(Boolean).join(' ')
  const ownEstablishment = universityConfig.establishments?.byId?.[establishment] ?? null
  const mailSender = {
    name: mailSenderName,
    email: accountDisplayInfo.email,
    signature: {
      name: mailSenderName,
      // The CAS login, where the university shows it (mail.signature.showLogin):
      // the server writes its own copy from the session, never this one.
      login: universityConfig.mail?.signature?.showLogin === true
        ? signatureLogin(sessionState.user === DEMO_CREDENTIALS.username ? DEMO_SIGNATURE_LOGIN : sessionState.user)
        : null,
      group: HAS_PERSONAL_PLANNING ? null : [selectedTp?.yearLabel, selectedTp?.tpLabel ?? selectedTp?.tdLabel].filter(Boolean).join(' · ') || selectedTp?.label || null,
      establishment: ownEstablishment?.label ?? null,
      // Its id, all the server takes of it (the sent mail's signature is
      // built there, server/mailSend.js).
      establishmentId: ownEstablishment ? establishment : null,
      university: universityConfig.university?.name ?? null,
      logos: [
        ownEstablishment?.logo ? { src: ownEstablishment.logo, srcDark: ownEstablishment.logoDark ?? null, alt: ownEstablishment.logoAlt ?? ownEstablishment.label ?? '' } : null,
        universityConfig.branding?.logo ? { src: universityConfig.branding.logo, srcDark: universityConfig.branding.logoDark ?? null, alt: universityConfig.university?.name ?? '' } : null,
      ].filter(Boolean),
    },
  }

  return (
    <main className="relative min-h-screen flex flex-col bg-bg overflow-x-clip">
      {shouldHoldInitialRender ? (
        <div className="flex-1 min-h-0 bg-bg" aria-hidden="true" />
      ) : isProfileSwitching ? (
        <div className="flex-1 min-h-0 bg-bg flex items-center justify-center p-8">
          {simpleLoadingDots}
        </div>
      ) : shouldShowTpSetup && isHydratingProfile && tpOnboardingState.yearOptions.length === 0 ? (
        <div className="flex-1 min-h-0 bg-bg flex items-center justify-center p-8">
          {simpleLoadingDots}
        </div>
      ) : shouldShowTpSetup ? (
        <OnboardingPage
          userName={sessionState.givenName ?? sessionState.user}
          contextLabel={tpOnboardingState.contextLabel}
          currentStep={currentTpOnboardingStep}
          stepOptions={currentTpStepOptions}
          selectedYear={tpOnboardingState.selectedYear}
          selectedTd={tpOnboardingState.selectedTd}
          detectedResourceId={currentDetectedSelection?.resourceId ?? null}
          errorMessage={tpOnboardingState.errorMessage}
          isLoading={isHydratingProfile || tpOnboardingState.loadingStep !== null}
          loadingMessage={tpOnboardingState.loadingMessage}
          onRetry={handleOnboardingRetry}
          onBack={handleOnboardingBack}
          onIgnore={handleOnboardingIgnore}
          onSelect={handleOnboardingSelect}
          transitionDirection={tpTransitionDirection}
        />
      ) : shouldShowCompletionScreen ? (
        <OnboardingCompletionPage userName={completionScreenState.userName} isLeaving={completionScreenState.leaving} />
      ) : sessionState.authenticated ? (
        <div key={`dashboard-${dashboardRevealNonce}`} className={`${dashboardRevealNonce > 0 ? 'dashboard-reveal-shell ' : ''}${isWallpaperShown ? '' : 'dashboard-no-wallpaper '}flex flex-col min-h-screen 4xl:h-screen 4xl:min-h-0 4xl:overflow-hidden`}>
          <Sidebar
            authenticated={sessionState.authenticated}
            checking={sessionState.checking}
            userName={[
              sessionState.account?.given_name,
              sessionState.account?.family_name,
            ].filter(Boolean).join(' ') || sessionState.account?.name || sessionState.givenName || sessionState.user}
            userSubtitle={HAS_PERSONAL_PLANNING ? null : selectedTp?.label ?? selectedTp?.tpLabel ?? selectedTp?.tdLabel ?? selectedTp?.yearLabel ?? null}
            profilePhotoSrc={accountModalPhoto}
            onLogout={handleHeaderAction}
            onAccountClick={handleOpenAccountModal}
            favoritesSlotRef={setFavoritesSlotEl}
            hasPendingUpdate={hasPendingUpdate}
            onUpdateClick={handleApplyUpdate}
            showChangelogPill={showChangelogPill}
            establishment={establishment}
            showUniversityLogo={showUniversityLogo}
            logoSource={logoSource}
            gradesSupported={gradesSupported}
            activePage={shownPage}
            onNavigatePage={handleNavigatePage}
            onOpenLatestGrade={universityConfig.features?.sidebarLatestGrade === true && sessionState.authenticated && hasGradesPage ? handleOpenSidebarGrade : null}
            compact={sidebarCompact || isSidebarAutoCompact}
            canPeek={isSidebarAutoCompact}
            onCompactChange={handleSidebarCompactChange}
          />
          <div ref={dashboardColumnRef} className={`app-column relative isolate flex flex-col flex-1 min-w-0 4xl:h-screen 4xl:overflow-y-auto 4xl:pl-[calc(var(--sidebar-width,280px)+12px)] ${hasMobileTabBar ? (isMailPage && mailReaderOpen ? 'max-4xl:pb-[calc(env(safe-area-inset-bottom)+148px)]' : 'max-4xl:pb-[calc(env(safe-area-inset-bottom)+84px)]') : ''}`}>
            {/* Hero image behind the header and widget cards, fading into the solid background. */}
            {isWallpaperShown ? (
              <div
                aria-hidden="true"
                className="dashboard-hero pointer-events-none absolute inset-x-0 top-0 -z-10 h-[230px] bg-cover bg-[center_40%] max-md:h-[260px] dark:opacity-60"
                style={{
                  ...(heroHeight ? { height: heroHeight } : null),
                  backgroundImage: `url("${heroImage.src}")`,
                  ...(heroImage.position ? { backgroundPosition: heroImage.position } : null),
                }}
              />
            ) : null}
            {/* On a phone, "Mes notes" and the planning start with their own
                header: no top bar. */}
            <div className={`${shownPage !== 'dashboard' ? 'max-md:hidden ' : ''}4xl:hidden`}>
              <AppHeader
                authenticated={sessionState.authenticated}
                checking={sessionState.checking}
                establishment={establishment}
                showUniversityLogo={showUniversityLogo}
                logoSource={logoSource}
                onPrimaryAction={handleHeaderAction}
                onAccountAction={handleOpenAccountModal}
              />
            </div>
            {hasPendingUpdate ? (
              <div className="4xl:hidden px-6 pt-3 max-md:px-3">
                <UpdateNotice onUpdateClick={handleApplyUpdate} />
              </div>
            ) : null}
            {showChangelogPill ? (
              // Right under the header buttons, eating into the space above
              // the cards rather than pushing them down a full row: over
              // them (relative z-10), not cut by the page's block coming up
              // under it. On a phone, with the top bar: on the dashboard
              // only (the other pages start with their own header).
              <ChangelogPill className={`${shownPage !== 'dashboard' ? 'max-md:hidden ' : ''}relative z-10 4xl:hidden flex justify-end px-6 pt-2 -mb-2 max-md:px-3 max-md:pt-1.5`} />
            ) : null}
            {sessionState.warning ? (
              <div className="px-6 pt-3 max-md:px-3 4xl:pt-5">
                <div className="flex items-start gap-3 corners-[20px] border border-[#f2cf8f] bg-[#fff7e8] px-4 py-3 text-text shadow-[0_10px_30px_rgba(0,0,0,0.05)] dark:border-[#6a4d15] dark:bg-[#2f2410]">
                  <Icon icon="carbon:warning-filled" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#b76e00]" aria-hidden="true" />
                  <p className="m-0 text-sm font-medium leading-[1.5] font-body">{sessionState.warning}</p>
                </div>
              </div>
            ) : null}
            {/* Kept mounted behind other pages: coming back is instant and the
                favorites it portals into the sidebar stay put. */}
            <div className={`${hasSwitchedPage ? 'page-enter ' : ''}flex-1 min-h-0 4xl:flex-none 4xl:min-h-0`} hidden={shownPage !== 'dashboard'}>
              <WidgetContainer
                userName={sessionState.givenName ?? sessionState.user}
                isSessionReady={!sessionState.checking}
                establishment={establishment}
                gradesSupported={gradesSupported}
                sessionUser={sessionState.user}
                selectedPlanningSelection={selectedTp}
                nextClassLookaheadDays={appliedLookaheadDays}
                debugNextClass={debugNextClass}
                canUseServerLaunch={sessionState.canUseServerLaunch}
                favoritesPortalTarget={isSidebarViewport ? favoritesSlotEl : null}
                hiddenWidgets={hiddenWidgets}
                onDismissGreeting={() => handleWidgetVisibilityChange('greeting', false)}
                onOpenGrade={hasGradesPage ? handleOpenLatestGrade : null}
                onOpenGradesPage={hasGradesPage ? handleOpenGradesPage : null}
                onOpenPlanningPage={hasPlanningPage ? handleOpenPlanningPage : null}
                onOpenPlanningDay={hasPlanningPage ? handleOpenPlanningDay : null}
                onOpenMail={hasMailPage ? handleOpenMail : null}
                onOpenMailPage={hasMailPage ? handleOpenMailPage : null}
                showAppDescriptions={showAppDescriptions}
              />
            </div>
            {isGradesPage ? (
              <div className="page-enter flex-1 min-h-0 4xl:flex-none 4xl:min-h-0">
                <GradesPage user={sessionState.user} arrivalSource={gradesArrivalSource} initialGradeRequest={pendingGradeRequest} onInitialGradeRequestHandled={clearPendingGradeRequest} />
              </div>
            ) : null}
            {isPlanningPage ? (
              <div className="page-enter flex-1 min-h-0 4xl:flex-none 4xl:min-h-0">
                <PlanningPage selection={selectedTp} user={sessionState.user} showWeekend={showPlanningWeekend} onOpenAccount={handleOpenAccountModal} initialDay={pendingPlanningDay} onInitialDayHandled={clearPendingPlanningDay} arrivalSource={planningArrivalSource} />
              </div>
            ) : null}
            {isMailPage ? (
              <div className="page-enter flex-1 min-h-0 4xl:flex-none 4xl:min-h-0">
                <MailPage onReaderOpenChange={handleMailReaderOpenChange} onSignInAgain={() => void handleSignInAgain()} sender={mailSender} />
              </div>
            ) : null}
            <div className="4xl:mt-auto">
              <AppFooter heroCredit={isWallpaperShown ? heroImage.credit : null} />
            </div>
            {/* Fades each page switch in (see .page-switch-veil). Keyed by page
                so it replays on every switch. */}
            {hasSwitchedPage ? (
              <div key={activePage} aria-hidden="true" className="page-switch-veil pointer-events-none absolute inset-0 z-20" />
            ) : null}
          </div>
          <MobileTabBar
            establishment={establishment}
            gradesSupported={gradesSupported}
            activePage={shownPage}
            onNavigatePage={handleNavigatePage}
          />
        </div>
      ) : !showLoginPage ? (
        <LandingPage onLogin={() => navigate(LOGIN_PATH)} />
      ) : (
        <LoginPage
          credentials={credentials}
          checking={sessionState.checking}
          errorMessage={sessionState.error}
          onCredentialsChange={(field, value) => setCredentials((current) => ({ ...current, [field]: value }))}
          onDemoLogin={() => void handleDemoLogin()}
          onSubmit={handleLogin}
        />
      )}
      <AccountModal
        open={isAccountModalOpen}
        onClose={handleCloseAccountModal}
        onManageAccount={sessionState.user === DEMO_CREDENTIALS.username || !manageAccountUrl ? null : handleManageAccount}
        onYearChange={handleAccountModalYearChange}
        onTdChange={handleAccountModalTdChange}
        onTpChange={handleAccountModalTpChange}
        displayInfo={accountDisplayInfo}
        profilePhotoSrc={accountModalPhoto}
        planningState={accountModalPlanningState}
        planningFieldLabels={universityConfig.planning?.selectionLabels}
        lookaheadDays={nextClassLookaheadDays}
        lookaheadOptions={ADE_LOOKAHEAD_DAY_OPTIONS}
        onLookaheadChange={handleNextClassLookaheadChange}
        widgetToggles={widgetToggles}
        onWidgetVisibilityChange={handleWidgetVisibilityChange}
        backgroundPreviewSrc={heroImage.src}
        showWallpaper={showWallpaper}
        onShowWallpaperChange={handleShowWallpaperChange}
        showUniversityLogo={showUniversityLogo}
        onShowUniversityLogoChange={handleShowUniversityLogoChange}
        establishmentLogoLabel={universityConfig.establishments?.byId?.[establishment]?.logo ? universityConfig.establishments.byId[establishment].label : null}
        logoSource={logoSource}
        onLogoSourceChange={handleLogoSourceChange}
        theme={theme}
        onThemeChange={handleThemeChange}
        hasCustomBackground={Boolean(customBackground)}
        onCustomBackgroundChange={handleCustomBackgroundChange}
        onCustomBackgroundReset={handleCustomBackgroundReset}
        showAppDescriptions={showAppDescriptions}
        onShowAppDescriptionsChange={handleShowAppDescriptionsChange}
        sidebarCompact={sidebarCompact}
        onSidebarCompactChange={handleSidebarCompactChange}
        showPlanningWeekend={showPlanningWeekend}
        onShowPlanningWeekendChange={handleShowPlanningWeekendChange}
        planningSelection={selectedTp}
        anonymousAnalytics={anonymousAnalytics}
        onAnonymousAnalyticsChange={isAnalyticsAvailable ? handleAnonymousAnalyticsChange : null}
        mailSignature={hasMailPage && sessionState.authenticated ? { auto: mailSenderName ? mailSender.signature : null } : null}
      />
      <WelcomeFromLent
        visible={welcomeFromLentOpen}
        importedKeys={settingsTransfer.importedKeys}
        signedIn={sessionState.authenticated}
        onInstall={showInstallPrompt}
        onDismiss={() => setWelcomeFromLentOpen(false)}
      />
      <PwaInstallPrompt
        forceShow={forceInstallPrompt || forceIosPrompt}
        forceIos={forceIosPrompt}
        autoOpen={sessionState.authenticated && !settingsTransfer.arrived}
        onVisibleChange={setIsInstallPromptVisible}
      />
      <ChangelogSheet />
      <PwaUpdateManager
        forceOpen={forceUpdatePrompt}
        onForceOpenChange={setForceUpdatePrompt}
        onUpdateAvailable={() => setHasPendingUpdate(true)}
        onApplyHandlerChange={(fn) => { applyUpdateRef.current = fn }}
      />

      {DebugMenu ? (
        <Suspense fallback={null}>
          <DebugMenu
            open={debugOpen}
            onToggle={toggleDebugMenu}
            onClose={closeDebugMenu}
            sessionState={sessionState}
            onRefreshSession={() => void refreshSession({ exposeOutput: true })}
            credentials={credentials}
            onCredentialsChange={(field, value) => setCredentials((current) => ({ ...current, [field]: value }))}
            onLogin={handleLogin}
            onLogout={() => void handleLogout()}
            onRestartOnboarding={handleDebugRestartOnboarding}
            debugState={debugState}
            onDebugStart={startDebugState}
            onDebugCommit={commitDebugState}
            theme={theme}
            onThemeChange={setTheme}
            establishment={establishment}
            heroImage={heroImage}
            hasCustomBackground={Boolean(customBackground)}
            onHeroShift={(step) => setHeroOffset((current) => current + step)}
            debugNextClass={debugNextClass}
            onDebugNextClassChange={setDebugNextClass}
            hasPendingUpdate={hasPendingUpdate}
            onPendingUpdateChange={setHasPendingUpdate}
            onShowInstallPrompt={showInstallPrompt}
            onShowIosPrompt={() => { setForceIosPrompt(true); setTimeout(() => setForceIosPrompt(false), 100) }}
            onShowUpdatePrompt={() => setForceUpdatePrompt(true)}
            onShowWelcomeFromLent={() => setWelcomeFromLentOpen(true)}
            selectedTp={selectedTp}
            nextClassLookaheadDays={nextClassLookaheadDays}
          />
        </Suspense>
      ) : null}
    </main>
  )
}

export default App
