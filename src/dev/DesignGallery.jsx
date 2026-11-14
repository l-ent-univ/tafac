import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { PALETTES, applyPalette, getStoredPalette, getStoredTheme, paletteColors } from '../theme'
import { resolveHeroImage } from '../heroImage'
import { SECONDARY_BUTTON } from '../scodocPageUtils'
import { CARD_CLASSES as SETTINGS_CARD_CLASSES, PRESSABLE_ROW_CLASSES, ROW_CLASSES } from '../settingsStyles'
import { FIELD_CLASS } from '../components/LoginPage'
import AverageSparkline from '../components/AverageSparkline'
import BetaTag from '../components/BetaTag'
import CardInfoTip from '../components/CardInfoTip'
import CloseButton from '../components/CloseButton'
import ConfirmDialog from '../components/ConfirmDialog'
import ContextMenu from '../components/ContextMenu'
import Dropdown from '../components/Dropdown'
import FileName from '../components/FileName'
import GradeHistogram from '../components/GradeHistogram'
import { GradesNotice } from '../components/GradesNotice'
import LentButton from '../components/LentButton'
import LoadingDots from '../components/LoadingDots'
import MailSearchField from '../components/MailSearchField'
import Material from '../components/Material'
import OtpInput from '../components/OtpInput'
import PageEmptyState from '../components/PageEmptyState'
import PageLoading from '../components/PageLoading'
import SegmentedControl from '../components/SegmentedControl'
import SemesterSelect from '../components/SemesterSelect'
import SettingsGroup, { RowText } from '../components/SettingsGroup'
import Switch from '../components/Switch'
import Tooltip from '../components/Tooltip'
import UeBadge from '../components/UeBadge'
import UpdateNotice from '../components/UpdateNotice'
import WidgetListStatus from '../components/WidgetListStatus'
import { DebugButton } from '../components/debug/DebugControls'
import { auditSources, contrastOf, toHex } from './designAudit'
import SmoothSurface from '../components/SmoothSurface'

// Dev only (main.jsx mounts it at /dev/design under `import.meta.env.DEV`):
// every token and shared component of Tafac on one page, in each theme and
// palette, with a scan of the sources for what bypasses the system (hex
// colours, old token names, one-off sizes, radii and shadows). The theme and
// palette picked here are painted on <html> but never stored.

const SOURCES = import.meta.glob(
  ['../**/*.jsx', '../**/*.css', '../components/**/*.js', '../settingsStyles.js', '../scodocPageUtils.js', '!../dev/**'],
  { query: '?raw', import: 'default' },
)

const SurfaceContext = createContext('page')

// ── Small helpers ──

function sourcePath(globKey) {
  return globKey.replace(/^\.\.\//, 'src/')
}

function openInEditor(path, line) {
  const file = line ? `${path}:${line}` : path
  void fetch(`/__open-in-editor?file=${encodeURIComponent(file)}`)
}

function SourceLink({ path, line = null, className = '' }) {
  return (
    <button
      type="button"
      onClick={() => openInEditor(path, line)}
      title="Ouvrir dans l’éditeur"
      className={`group inline-flex min-w-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-ink-muted hover:text-ink ${className}`}
    >
      <span className="truncate font-mono text-[11px] group-hover:underline">{path.replace(/^src\//, '')}{line ? `:${line}` : ''}</span>
    </button>
  )
}

function readParams() {
  const params = new URLSearchParams(window.location.search)
  const storedTheme = getStoredTheme()
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const theme = params.get('theme') ?? (storedTheme === 'auto' ? (systemDark ? 'dark' : 'light') : storedTheme)
  const palette = params.get('palette') ?? getStoredPalette().id
  return {
    theme: theme === 'dark' ? 'dark' : 'light',
    palette: PALETTES.some((entry) => entry.id === palette) ? palette : 'sand',
    surface: ['page', 'card', 'glass'].includes(params.get('surface')) ? params.get('surface') : 'page',
    split: params.get('split') === '1',
    embed: params.get('embed') === '1',
  }
}

function writeParams(state) {
  const params = new URLSearchParams()
  params.set('theme', state.theme)
  params.set('palette', state.palette)
  params.set('surface', state.surface)
  if (state.split) params.set('split', '1')
  if (state.embed) params.set('embed', '1')
  window.history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`)
}

class DemoBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <p className="m-0 font-mono text-[12px] text-danger">
          Le rendu a échoué : {String(this.state.error?.message ?? this.state.error)}
        </p>
      )
    }
    return this.props.children
  }
}

// ── Layout pieces ──

const STAGE_SURFACES = {
  page: 'bg-page border border-dashed border-line-strong',
  card: 'bg-card border border-line',
  glass: 'widget-card widget-card-visible border bg-widget-bg',
}

function Demo({ title, file = null, note = null, children, stageClassName = '', fixedSurface = null }) {
  const surface = useContext(SurfaceContext)
  return (
    <article className="flex min-w-0 flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <h3 className="m-0 font-body text-[14px] font-semibold text-ink">{title}</h3>
        {file ? <SourceLink path={file} /> : null}
      </header>
      <div className={`card-corners-sm relative flex min-h-[96px] flex-wrap items-center gap-5 p-5 ${STAGE_SURFACES[fixedSurface ?? surface]} ${stageClassName}`}>
        <DemoBoundary>{children}</DemoBoundary>
      </div>
      {note ? <p className="m-0 px-1 font-body text-[12px] font-medium leading-[1.4] text-ink-muted">{note}</p> : null}
    </article>
  )
}

// A variant in a demo, its name under it.
function Variant({ label, children, className = '' }) {
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="flex min-h-[44px] items-center justify-center">{children}</div>
      <span className="font-mono text-[10px] leading-none text-ink-muted">{label}</span>
    </div>
  )
}

function Section({ id, title, intro = null, children }) {
  return (
    <section id={id} className="scroll-mt-[120px] flex flex-col gap-5 border-t border-line pt-10 first:border-t-0 first:pt-2">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-[26px] font-bold leading-[1.1] tracking-[-0.02em] text-ink">{title}</h2>
        {intro ? <p className="m-0 max-w-[720px] font-body text-[14px] font-medium leading-[1.45] text-ink-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Grid({ children, min = 320 }) {
  return <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))` }}>{children}</div>
}

function Pill({ tone = 'muted', children }) {
  const tones = {
    ok: 'bg-success-soft text-success',
    warn: 'bg-warning-soft text-warning',
    bad: 'bg-danger-soft text-danger',
    muted: 'bg-subtle text-ink-muted',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10px] font-semibold leading-none ${tones[tone]}`}>{children}</span>
}

// ── Colours, resolved from the live page ──

const ROLE_GROUPS = [
  { title: 'Surfaces', roles: ['surface-page', 'surface-sunken', 'surface-subtle', 'surface-strong', 'surface-field', 'surface-card', 'surface-raised', 'surface-raised-hover', 'surface-thumb'] },
  { title: 'Encre', roles: ['ink', 'ink-secondary', 'ink-muted', 'ink-faint'] },
  { title: 'Lignes et états', roles: ['line', 'line-strong', 'state-hover', 'state-press', 'focus-ring', 'scrim', 'shadow-tint'] },
  { title: 'Marque', roles: ['brand', 'brand-hover', 'brand-soft', 'on-brand'] },
  { title: 'Statuts', roles: ['danger', 'danger-soft', 'warning', 'warning-soft', 'success', 'success-soft', 'info', 'info-soft', 'favorite', 'flag', 'notify'] },
  { title: 'Matières', roles: ['material-glass', 'material-glass-hover', 'material-glass-edge', 'material-solid', 'material-solid-hover', 'material-solid-edge', 'material-banded', 'material-banded-hover', 'material-sidebar', 'material-sidebar-edge', 'material-sidebar-solid', 'handle-tint', 'on-photo'] },
]

// The Tailwind name of a role (index.css' @theme inline), where it has one.
const TAILWIND_NAMES = {
  'surface-page': 'page', 'surface-sunken': 'sunken', 'surface-subtle': 'subtle', 'surface-strong': 'strong',
  'surface-field': 'field', 'surface-card': 'card', 'surface-raised': 'raised', 'surface-raised-hover': 'raised-hover',
  ink: 'ink', 'ink-secondary': 'ink-secondary', 'ink-muted': 'ink-muted', 'ink-faint': 'ink-faint',
  line: 'line', 'line-strong': 'line-strong', 'state-hover': 'state-hover', 'state-press': 'state-press',
  brand: 'brand', 'brand-hover': 'brand-hover', favorite: 'favorite',
  'brand-soft': 'brand-soft', 'on-brand': 'on-brand', danger: 'danger', 'danger-soft': 'danger-soft',
  warning: 'warning', 'warning-soft': 'warning-soft', success: 'success', 'success-soft': 'success-soft',
  info: 'info', 'info-soft': 'info-soft', flag: 'flag', notify: 'notify', scrim: 'scrim', 'on-photo': 'on-photo',
}

const LEGACY_ALIASES = [
  ['color-bg', 'surface-page'], ['color-bg-surface', 'surface-sunken'], ['color-bg-subtle', 'surface-subtle'],
  ['color-bg-muted', 'surface-strong'], ['color-bg-input', 'surface-field'], ['color-widget-bg', 'surface-card'],
  ['color-text', 'ink'], ['color-text-secondary', 'ink-secondary'], ['color-text-muted', 'ink-muted'],
  ['color-text-30', 'ink 30 %'], ['color-text-50', 'ink 50 %'], ['color-text-60', 'ink 60 %'], ['color-text-70', 'ink 70 %'],
  ['color-brand', 'brand'], ['color-brand-hover', 'brand-hover'], ['color-brand-subtle', 'brand-soft'],
  ['color-border', 'line'], ['color-border-input', 'line-strong'], ['color-error', 'danger'], ['color-error-bg', 'danger-soft'],
  ['color-success-bg', 'success-soft'], ['color-success-text', 'success'], ['color-favorite', 'favorite'],
  ['color-shadow', 'shadow-tint'], ['color-backdrop', 'scrim'], ['color-context-bg', 'surface-raised'], ['color-context-hover', 'surface-raised-hover'],
]

const INK_ROLES = ['ink', 'ink-secondary', 'ink-muted', 'ink-faint', 'brand', 'danger', 'warning', 'success', 'info']
const BACKGROUND_ROLES = ['surface-page', 'surface-sunken', 'surface-subtle', 'surface-strong', 'surface-field', 'surface-card', 'surface-raised', 'surface-thumb', 'material-solid', 'material-banded']
const PAIRS = [
  ['on-brand', 'brand'], ['brand', 'brand-soft'], ['danger', 'danger-soft'], ['warning', 'warning-soft'],
  ['success', 'success-soft'], ['info', 'info-soft'], ['ink', 'state-press'],
]

// Every role as 0–255 RGBA, read through a probe inside `root` (so a role a
// container redefines reads as it does there) and a 1 px canvas (which turns
// oklch() and color-mix() into sRGB).
function resolveColors(root, names) {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  root.appendChild(probe)
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const out = {}
  for (const name of names) {
    probe.style.color = ''
    probe.style.color = `var(--${name})`
    const css = getComputedStyle(probe).color
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000'
    context.fillStyle = css
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    out[name] = { css, rgba: [r, g, b, a / 255] }
  }
  probe.remove()
  return out
}

function over(top, bottom) {
  const [r, g, b, a] = top
  return [0, 1, 2].map((index) => Math.round([r, g, b][index] * a + bottom[index] * (1 - a)))
}

// Re-read on a theme or palette change, once the palette's glide (320 ms in
// tokens.css) has settled.
function useResolvedColors(rootRef, names, revision) {
  const [colors, setColors] = useState(null)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const timer = setTimeout(() => setColors(resolveColors(root, names)), 420)
    return () => clearTimeout(timer)
  }, [rootRef, names, revision])
  return colors
}

function ratioTone(ratio) {
  if (ratio >= 4.5) return 'ok'
  if (ratio >= 3) return 'warn'
  return 'bad'
}

function Swatch({ role, color }) {
  const alpha = color ? color.rgba[3] : 1
  const tailwind = TAILWIND_NAMES[role]
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className="relative size-11 shrink-0 overflow-hidden corners-[12px] border border-line"
        style={{ backgroundImage: 'conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0)', backgroundSize: '10px 10px' }}
      >
        <span className="absolute inset-0" style={{ background: `var(--${role})` }} />
      </span>
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="truncate font-mono text-[12px] font-semibold text-ink">--{role}</span>
        <span className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ink-muted">
          {color ? toHex(color.rgba) : '…'}
          {alpha < 1 ? <Pill>{Math.round(alpha * 100)} %</Pill> : null}
          {tailwind ? <Pill>{tailwind}</Pill> : <Pill tone="warn">pas de classe</Pill>}
        </span>
      </span>
    </div>
  )
}

function ColorsSection({ rootRef, revision }) {
  const names = useMemo(() => [...new Set([...ROLE_GROUPS.flatMap((group) => group.roles), ...LEGACY_ALIASES.map(([alias]) => alias)])], [])
  const colors = useResolvedColors(rootRef, names, revision)

  const page = colors?.['surface-page']?.rgba ?? [255, 255, 255, 1]
  const flatten = (role) => over(colors[role].rgba, page.slice(0, 3))
  const matrix = colors ? INK_ROLES.map((ink) => BACKGROUND_ROLES.map((background) => {
    const back = flatten(background)
    return contrastOf(over(colors[ink].rgba, back), back)
  })) : null
  const failing = matrix ? matrix.flat().filter((ratio) => ratio < 4.5).length : 0

  return (
    <Section id="couleurs" title="Couleurs" intro="Les rôles de tokens.css, lus sur la page telle qu’elle est peinte (thème et palette du haut). Les valeurs translucides sont posées sur un damier">
      <div className="grid gap-8">
        {ROLE_GROUPS.map((group) => (
          <div key={group.title} className="grid gap-3">
            <h3 className="m-0 font-body text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{group.title}</h3>
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))' }}>
              {group.roles.map((role) => <Swatch key={role} role={role} color={colors?.[role]} />)}
            </div>
          </div>
        ))}
      </div>

      <Demo
        title={`Contraste du texte sur chaque surface · ${failing} sous 4,5:1`}
        file="src/tokens.css"
        note="Vert : AA (4,5:1). Ambre : grand texte ou graphique seulement (3:1). Rouge : sous 3:1. --ink-faint est décoratif par définition"
        fixedSurface="page"
        stageClassName="block! p-0! overflow-x-auto"
      >
        {matrix ? (
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-page p-2 text-left font-semibold text-ink-muted" />
                {BACKGROUND_ROLES.map((background) => (
                  <th key={background} className="p-2 text-center font-semibold text-ink-muted" style={{ background: `var(--${background})` }}>
                    {background.replace(/^surface-|^material-/, '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INK_ROLES.map((ink, row) => (
                <tr key={ink}>
                  <th className="sticky left-0 bg-page p-2 text-left font-semibold text-ink">{ink}</th>
                  {BACKGROUND_ROLES.map((background, column) => {
                    const ratio = matrix[row][column]
                    return (
                      <td key={background} className="p-2 text-center" style={{ background: `var(--${background})` }}>
                        <span className="block font-body text-[13px] font-semibold" style={{ color: `var(--${ink})` }}>Aa</span>
                        <Pill tone={ratioTone(ratio)}>{ratio.toFixed(1)}</Pill>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <LoadingDots />}
      </Demo>

      <Demo title="Paires texte / fond" note="Le texte d’un statut sur son fond doux, posé sur une carte" fixedSurface="card">
        {colors ? PAIRS.map(([ink, background]) => {
          const back = over(colors[background].rgba, flatten('surface-card'))
          const ratio = contrastOf(over(colors[ink].rgba, back), back)
          return (
            <Variant key={`${ink}-${background}`} label={`${ink} / ${background}`}>
              <span className="inline-flex items-center gap-2 rounded-full px-3 py-[7px] font-body text-[13px] font-semibold" style={{ background: `var(--${background})`, color: `var(--${ink})` }}>
                Texte <Pill tone={ratioTone(ratio)}>{ratio.toFixed(1)}</Pill>
              </span>
            </Variant>
          )
        }) : <LoadingDots />}
      </Demo>

      <Demo title="Anciens noms (alias à faire disparaître)" note="Les noms --color-* de tokens.css, valeur pour valeur. L’onglet Audit compte qui les lit encore" fixedSurface="page" stageClassName="block!">
        <div className="grid gap-x-6 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))' }}>
          {LEGACY_ALIASES.map(([alias, role]) => (
            <div key={alias} className="flex items-center gap-2 font-mono text-[11px]">
              <span className="size-4 shrink-0 rounded-full border border-line" style={{ background: `var(--${alias})` }} />
              <span className="text-ink">--{alias}</span>
              <span className="text-ink-muted">→ {role}</span>
            </div>
          ))}
        </div>
      </Demo>
    </Section>
  )
}

// ── Typography ──

const WEIGHTS = [400, 500, 600, 700, 800]

function TypographySection({ audit }) {
  return (
    <Section id="typographie" title="Typographie" intro="Les deux familles, puis chaque taille réellement écrite dans le code (text-[Npx] et font-size), avec son nombre d’usages. Une taille rare est souvent une taille de trop">
      <Grid min={420}>
        {[['font-display', 'Titres (--font-display)'], ['font-body', 'Texte (--font-body)']].map(([family, label]) => (
          <Demo key={family} title={label} file="src/index.css" stageClassName="flex-col! items-start! gap-2!">
            {WEIGHTS.map((weight) => (
              <p key={weight} className={`m-0 ${family} text-[22px] leading-[1.15] text-ink`} style={{ fontWeight: weight }}>
                <span className="mr-3 font-mono text-[11px] text-ink-muted">{weight}</span>
                Mes notes, Planning · 0123456789
              </p>
            ))}
          </Demo>
        ))}
      </Grid>

      <Demo title={audit ? `Tailles en px · ${audit.fontPx.values.length} distinctes, ${audit.fontPx.total} usages` : 'Tailles en px'} fixedSurface="page" stageClassName="block!">
        {audit ? (
          <div className="grid gap-1">
            {audit.fontPx.values.map((entry) => (
              <UsageRow key={entry.value} entry={entry} rare={entry.count <= 2}>
                <span className="w-[58px] shrink-0 font-mono text-[11px] text-ink-muted">{entry.value}px</span>
                <span className="min-w-0 truncate font-body font-semibold leading-[1.2] text-ink" style={{ fontSize: `${entry.value}px` }}>Prochain cours, Amphi B</span>
              </UsageRow>
            ))}
          </div>
        ) : <AuditPending />}
      </Demo>

      <Demo title="Tailles nommées de Tailwind" note="text-xs, text-sm… à côté des tailles en px : deux échelles qui se chevauchent" fixedSurface="page">
        {audit ? audit.fontNamed.values.map((entry) => (
          <Variant key={entry.value} label={`text-${entry.value} · ${entry.count}`}>
            <span className={`text-${entry.value} font-semibold text-ink`}>Aa</span>
          </Variant>
        )) : <AuditPending />}
      </Demo>
    </Section>
  )
}

// A value of the audit, its count, and the places it's used (folded).
function UsageRow({ entry, rare = false, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="grid gap-1 border-b border-line py-[6px] last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        {children}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {rare ? <Pill tone="warn">rare</Pill> : null}
          <button type="button" onClick={() => setOpen((value) => !value)} className="cursor-pointer border-0 bg-transparent p-0 text-ink-muted hover:text-ink">
            <span className="font-mono text-[11px]">{entry.count} {open ? '▴' : '▾'}</span>
          </button>
        </span>
      </div>
      {open ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-[70px]">
          {entry.uses.slice(0, 60).map((use, index) => (
            <SourceLink key={`${use.path}-${use.line}-${index}`} path={sourcePath(use.path)} line={use.line} />
          ))}
          {entry.uses.length > 60 ? <span className="font-mono text-[11px] text-ink-muted">+{entry.uses.length - 60}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

function AuditPending() {
  return <span className="inline-flex items-center gap-2 font-body text-[13px] text-ink-muted"><LoadingDots label={null} /> Lecture des sources</span>
}

// ── Shapes ──

function radiusStyle(value) {
  const css = value.replace(/_/g, ' ')
  return /^[\d.]+(px|rem|%)?$/.test(css) || /^calc|^var|^min|^max/.test(css) ? css : null
}

function ShapesSection({ audit }) {
  return (
    <Section id="formes" title="Formes" intro="Coins et ombres. Les classes nommées d’abord, puis chaque valeur écrite à la main dans le code">
      <Demo title="Coins nommés" file="src/overrides.css">
        <Variant label="card-corners"><span className="block size-20 card-corners border border-line bg-card" /></Variant>
        <Variant label="card-corners-sm"><span className="block size-20 card-corners-sm border border-line bg-card" /></Variant>
        <Variant label="modal-corners"><span className="block size-20 modal-corners border border-line bg-card" /></Variant>
        <Variant label="modal-inner-corners"><span className="block size-20 modal-inner-corners border border-line bg-card" /></Variant>
        <Variant label="rounded-full"><span className="block h-11 w-24 rounded-full border border-line bg-card" /></Variant>
      </Demo>

      <Demo title={audit ? `Rayons écrits à la main · ${audit.radii.values.length} distincts, ${audit.radii.total} usages` : 'Rayons écrits à la main'} fixedSurface="page" stageClassName="block!">
        {audit ? (
          <div className="grid gap-1">
            {audit.radii.values.map((entry) => {
              const style = radiusStyle(entry.value)
              return (
                <UsageRow key={entry.value} entry={entry} rare={entry.count <= 2}>
                  <span className="w-[58px] shrink-0 truncate font-mono text-[11px] text-ink-muted" title={entry.value}>{entry.value}</span>
                  {style ? <span className="block h-8 w-16 shrink-0 border border-line-strong bg-card" style={{ borderRadius: style }} /> : <Pill>non rendu</Pill>}
                </UsageRow>
              )
            })}
          </div>
        ) : <AuditPending />}
      </Demo>

      <Demo title={audit ? `Ombres · ${audit.shadows.values.length} distinctes, ${audit.shadows.total} usages` : 'Ombres'} note="Les ombres teintées en dur (rgb(52 18 0 …)) ne suivent pas les palettes" fixedSurface="page" stageClassName="block!">
        {audit ? (
          <div className="grid gap-x-6 gap-y-6 py-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))' }}>
            {audit.shadows.values.slice(0, 60).map((entry) => (
              <div key={entry.value} className="flex min-w-0 flex-col gap-2">
                <span className="block h-14 corners-[14px] bg-card" style={{ boxShadow: entry.value.includes('var(') || entry.value.includes('rgb') || entry.value.includes('#') || /\d/.test(entry.value) ? entry.value : undefined }} />
                <span className="line-clamp-2 font-mono text-[10px] leading-[1.3] text-ink-muted" title={entry.value}>{entry.value}</span>
                <span className="flex flex-wrap gap-x-2">
                  <Pill tone={entry.count <= 1 ? 'warn' : 'muted'}>{entry.count}×</Pill>
                  <SourceLink path={sourcePath(entry.uses[0].path)} line={entry.uses[0].line} />
                </span>
              </div>
            ))}
          </div>
        ) : <AuditPending />}
      </Demo>

      <Demo title={audit ? `Plans (z-[N]) · ${audit.zIndex.values.length} valeurs` : 'Plans (z-[N])'} fixedSurface="page">
        {audit ? audit.zIndex.values.map((entry) => (
          <Variant key={entry.value} label={`${entry.count}×`}>
            <button type="button" onClick={() => openInEditor(sourcePath(entry.uses[0].path), entry.uses[0].line)} className="cursor-pointer corners-[10px] border border-line bg-card px-3 py-2 text-ink"><span className="font-mono text-[12px]">z-{entry.value}</span></button>
          </Variant>
        )) : <AuditPending />}
      </Demo>
    </Section>
  )
}

// ── Materials ──

function MaterialsSection({ photo }) {
  return (
    <Section id="matieres" title="Matières" intro="Les surfaces composées : verre sur le fond d’écran, carte pleine, matière des boutons secondaires, groupe de boutons, piste du contrôle segmenté">
      <Grid min={360}>
        <Demo title="Verre (.widget-card) sur photo" file="src/overrides.css" fixedSurface="page" stageClassName="bg-cover! bg-center! border-0!">
          <span className="absolute inset-0 rounded-[inherit] bg-cover bg-center" style={{ backgroundImage: photo ? `url(${photo})` : 'linear-gradient(135deg,#7aa2ff,#ffb38a)' }} />
          <div className="widget-card widget-card-visible relative card-corners border bg-widget-bg p-5 text-ink">
            <p className="m-0 font-body text-[15px] font-semibold">Prochain cours</p>
            <p className="m-0 font-body text-[13px] text-ink-muted">Amphi B · 10 h 15</p>
          </div>
          <div className="widget-card widget-card-visible relative card-corners-sm border bg-widget-bg p-3 text-ink">
            <span className="font-body text-[13px] font-semibold">card-corners-sm</span>
          </div>
        </Demo>
        <Demo title="Carte pleine" file="src/scodocPageUtils.js" note="Deux CARD_CLASSES existent : scodocPageUtils.js (widget-card) et settingsStyles.js (blanc en dur)">
          <div className="card-corners border border-line bg-card p-5 text-ink">
            <p className="m-0 font-body text-[15px] font-semibold">bg-card</p>
            <p className="m-0 font-body text-[13px] text-ink-muted">border-line</p>
          </div>
          <div className={`${SETTINGS_CARD_CLASSES} p-5 text-ink`}>
            <p className="m-0 font-body text-[15px] font-semibold">Réglages</p>
            <p className="m-0 font-body text-[13px] text-ink-muted">settingsStyles CARD_CLASSES</p>
          </div>
        </Demo>
        <Demo title=".material" file="src/components/Material.jsx" note="Blanc en dur en clair (#ffffff), ne prend pas la teinte des palettes">
          <Variant label="disabled"><Material disabled className="rounded-full px-4 py-2 font-body text-[14px] font-semibold">Simuler</Material></Variant>
          <Variant label="div"><Material as="div" className="rounded-[18px] px-5 py-4 font-body text-[14px] font-semibold">Matière</Material></Variant>
          <Variant label="rainbow"><Material rainbow className="rounded-full px-4 py-2 font-body text-[14px] font-semibold">Simuler</Material></Variant>
          <Variant label="rainbow UE"><Material rainbow={['#b80004', '#f97b3d', '#feb40b', '#80cb3f']} className="rounded-full px-4 py-2 font-body text-[14px] font-semibold">Simuler</Material></Variant>
        </Demo>
        <Demo title=".button-group" file="src/components/MailToolbar.jsx">
          <div className="button-group">
            {['ph:arrow-bend-up-left', 'ph:arrow-bend-double-up-left', 'ph:arrow-bend-up-right'].map((icon) => (
              <button key={icon} type="button" className="button-group-item group" aria-label={icon}>
                <Icon icon={icon} className="size-[18px]" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="button-group">
            <button type="button" className="button-group-item group" aria-expanded="true" aria-label="Ouvert">
              <Icon icon="ph:folder-simple" className="size-[18px]" aria-hidden="true" />
            </button>
            <button type="button" className="button-group-item group" aria-label="Corbeille">
              <Icon icon="ph:trash" className="size-[18px]" aria-hidden="true" />
            </button>
          </div>
        </Demo>
      </Grid>
    </Section>
  )
}

// ── Buttons ──

function ButtonsSection() {
  const [loading, setLoading] = useState(false)
  return (
    <Section id="boutons" title="Boutons" intro="Chaque bouton partagé, dans ses variantes. Survole et appuie pour voir les états">
      <Grid>
        <Demo title="LentButton (principal)" file="src/components/LentButton.jsx">
          <Variant label="défaut"><LentButton>Se connecter</LentButton></Variant>
          <Variant label="icône"><LentButton><Icon icon="ph:paper-plane-tilt" className="size-[17px]" />Envoyer</LentButton></Variant>
          <Variant label="loading">
            <LentButton loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1600) }}>Cliquer</LentButton>
          </Variant>
          <Variant label="disabled"><LentButton disabled>Envoyer</LentButton></Variant>
          <Variant label="min-h-[52px]!"><LentButton className="min-h-[52px]! w-[200px]">Continuer</LentButton></Variant>
        </Demo>
        <Demo title="SECONDARY_BUTTON (.material)" file="src/scodocPageUtils.js">
          <Variant label="défaut"><button type="button" className={SECONDARY_BUTTON}><SmoothSurface />Simuler</button></Variant>
          <Variant label="icône"><button type="button" className={SECONDARY_BUTTON}><SmoothSurface /><Icon icon="ph:export" className="size-4" />Exporter</button></Variant>
          <Variant label="disabled"><button type="button" className={SECONDARY_BUTTON} disabled><SmoothSurface />Exporter</button></Variant>
          <Variant label="lien"><a href="#boutons" className={SECONDARY_BUTTON}><SmoothSurface />Lien</a></Variant>
        </Demo>
        <Demo title="CloseButton" file="src/components/CloseButton.jsx">
          <Variant label="plain"><CloseButton /></Variant>
          <Variant label="large"><CloseButton large /></Variant>
          <Variant label="disabled"><CloseButton disabled /></Variant>
          <Variant label="glass" className="rounded-[16px] bg-[linear-gradient(135deg,#7aa2ff,#ffb38a)] p-2"><CloseButton glass /></Variant>
        </Demo>
        <Demo title="Boutons de ConfirmDialog" file="src/components/ConfirmDialog.jsx">
          <Variant label="annuler">
            <button type="button" className="material inline-flex h-9 items-center rounded-full px-4 cursor-pointer"><SmoothSurface /><span className="text-[13px] font-semibold leading-none">Annuler</span></button>
          </Variant>
          <Variant label="confirmer">
            <button type="button" className="lent-button inline-flex h-9 items-center rounded-full px-4 cursor-pointer"><SmoothSurface /><span className="text-[13px] font-medium leading-none">Confirmer</span></button>
          </Variant>
          <Variant label="destructif">
            <button type="button" className="lent-button lent-button--danger inline-flex h-9 items-center rounded-full px-4 cursor-pointer"><SmoothSurface /><span className="text-[13px] font-medium leading-none">Supprimer</span></button>
          </Variant>
          <Variant label="disabled">
            <button type="button" disabled className="lent-button inline-flex h-9 items-center rounded-full px-4"><SmoothSurface /><span className="text-[13px] font-medium leading-none">Confirmer</span></button>
          </Variant>
        </Demo>
        <Demo title="DebugButton" file="src/components/debug/DebugControls.jsx">
          <Variant label="default"><DebugButton>Action</DebugButton></Variant>
          <Variant label="active"><DebugButton tone="active">Action</DebugButton></Variant>
          <Variant label="danger"><DebugButton tone="danger">Effacer</DebugButton></Variant>
          <Variant label="disabled"><DebugButton disabled>Action</DebugButton></Variant>
        </Demo>
        <Demo title="Bouton texte et icône seule" note="Pas de composant partagé : chaque page écrit le sien">
          <Variant label="texte (WidgetListStatus)">
            <button type="button" className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-body text-[13px] font-semibold text-text-muted underline-offset-2 hover:text-text hover:underline">
              <Icon icon="ph:arrows-clockwise" className="size-[14px]" />Réessayer
            </button>
          </Variant>
          <Variant label="icône + Tooltip">
            <button type="button" className="group relative inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink hover:bg-state-hover" aria-label="Archiver">
              <Icon icon="ph:archive" className="size-5" />
              <Tooltip title="Archiver" detail="E" side="bottom" />
            </button>
          </Variant>
        </Demo>
      </Grid>
    </Section>
  )
}

// ── Fields and controls ──

const SEMESTERS = [
  { id: 1, number: 1, year: '2024/2025' },
  { id: 2, number: 2, year: '2024/2025' },
  { id: 3, number: 3, year: '2025/2026' },
]

function ControlsSection() {
  const [switches, setSwitches] = useState({ a: true, b: false, c: true, d: false })
  const [view, setView] = useState('week')
  const [small, setSmall] = useState('light')
  const [tab, setTab] = useState('rooms')
  const [drop, setDrop] = useState('recent')
  const [semester, setSemester] = useState(2)
  const [search, setSearch] = useState('')
  const [field, setField] = useState('')
  const [otp, setOtp] = useState('')
  const toggle = (key) => (value) => setSwitches((current) => ({ ...current, [key]: value }))

  return (
    <Section id="champs" title="Champs et contrôles" intro="Tout ce qui prend une saisie ou un choix">
      <Grid>
        <Demo title="Switch" file="src/components/Switch.jsx" note="Glisse le bouton ou clique. Traits seulement allumé (couleur principale), doux éteint">
          <Variant label="on"><Switch checked={switches.a} onChange={toggle('a')} label="A" /></Variant>
          <Variant label="off"><Switch checked={switches.b} onChange={toggle('b')} label="B" /></Variant>
          <Variant label="small on"><Switch small checked={switches.c} onChange={toggle('c')} label="C" /></Variant>
          <Variant label="small off"><Switch small checked={switches.d} onChange={toggle('d')} label="D" /></Variant>
        </Demo>
        <Demo title="SegmentedControl" file="src/components/SegmentedControl.jsx" stageClassName="flex-col! items-stretch!">
          <SegmentedControl label="Vue" value={view} onChange={setView} options={[{ value: 'day', label: 'Jour' }, { value: 'week', label: 'Semaine' }, { value: 'list', label: 'Liste' }]} />
          <SegmentedControl label="Thème" size="sm" stretch={false} value={small} onChange={setSmall} options={[{ value: 'auto', label: 'Auto', icon: 'ph:circle-half' }, { value: 'light', label: 'Clair', icon: 'ph:sun' }, { value: 'dark', label: 'Sombre', icon: 'ph:moon' }]} />
          <SegmentedControl label="Onglets" kind="tabs" size="sm" stretch={false} value={tab} onChange={setTab} options={[{ value: 'rooms', label: 'Salles' }, { value: 'staff', label: 'Personnels' }]} />
        </Demo>
        <Demo title="Champ (LoginPage FIELD_CLASS)" file="src/components/LoginPage.jsx" stageClassName="flex-col! items-stretch!">
          <input className={FIELD_CLASS} placeholder="Identifiant" value={field} onChange={(event) => setField(event.target.value)} />
          <input className={FIELD_CLASS} placeholder="Désactivé" disabled />
        </Demo>
        <Demo title="MailSearchField" file="src/components/MailSearchField.jsx" stageClassName="flex-col! items-stretch!">
          <MailSearchField value={search} onChange={setSearch} />
          <MailSearchField value="partiel de maths" onChange={() => {}} />
        </Demo>
        <Demo title="Dropdown" file="src/components/Dropdown.jsx">
          <Variant label="SECONDARY_BUTTON">
            <Dropdown
              label="Tri"
              value={drop}
              onChange={setDrop}
              options={[{ value: 'recent', label: 'Plus récents' }, { value: 'old', label: 'Plus anciens' }, { value: 'unread', label: 'Non lus d’abord' }]}
              actions={[{ id: 'more', label: 'Salles et personnels', icon: 'ph:door', onSelect: () => {} }]}
              triggerClassName={`${SECONDARY_BUTTON} cursor-pointer`}
            />
          </Variant>
          <Variant label="SemesterSelect">
            <SemesterSelect semesters={SEMESTERS} value={semester} onChange={setSemester} />
          </Variant>
          <Variant label="disabled">
            <Dropdown label="Tri" value="recent" onChange={() => {}} options={[{ value: 'recent', label: 'Plus récents' }]} disabled triggerClassName={`${SECONDARY_BUTTON}`} />
          </Variant>
        </Demo>
        <Demo title="OtpInput" file="src/components/OtpInput.jsx" note="Couleurs des cases en dur (BOX_COLORS)">
          {[
            ['dsg-otp-live', 'Saisis le code', otp, setOtp, {}],
            ['dsg-otp-partial', 'partiel', '123', () => {}, {}],
            ['dsg-otp-busy', 'busy', '123456', () => {}, { busy: true }],
            ['dsg-otp-invalid', 'Code refusé', '', () => {}, { invalid: true }],
          ].map(([id, label, value, onChange, flags]) => (
            <div key={id} className="w-[300px] max-w-full">
              <OtpInput id={id} label={label} value={value} onChange={onChange} {...flags} />
            </div>
          ))}
        </Demo>
      </Grid>
    </Section>
  )
}

// ── Feedback ──

function FeedbackSection() {
  return (
    <Section id="retours" title="Retours et états" intro="Chargement, étiquettes, bulles, avis, états vides">
      <Grid>
        <Demo title="LoadingDots" file="src/components/LoadingDots.jsx">
          <Variant label="ink"><LoadingDots /></Variant>
          <Variant label="brand"><LoadingDots className="text-brand" /></Variant>
          <Variant label="muted"><LoadingDots className="text-ink-muted" /></Variant>
        </Demo>
        <Demo title="BetaTag" file="src/components/BetaTag.jsx">
          <Variant label="sm"><BetaTag /></Variant>
          <Variant label="lg"><BetaTag size="lg" /></Variant>
          <Variant label="onSky" className="rounded-[14px] bg-[linear-gradient(180deg,#5aa0ff,#9cc8ff)] px-3"><BetaTag onSky /></Variant>
        </Demo>
        <Demo title="Tooltip" file="src/components/Tooltip.jsx" note="Noir et blanc en dur, hors des rôles. Forcé visible ici" stageClassName="min-h-[120px]! items-start!">
          {['right', 'bottom'].map((side) => (
            <Variant key={side} label={side} className="mr-24">
              <span className="relative inline-flex size-9 items-center justify-center rounded-full bg-subtle">
                <Icon icon="ph:house" className="size-5" />
                <Tooltip title="Accueil" detail="⌘1" side={side} className="visible! opacity-100! scale-100! translate-x-0! translate-y-0!" />
              </span>
            </Variant>
          ))}
        </Demo>
        <Demo title="CardInfoTip" file="src/components/CardInfoTip.jsx" note="Survole ou touche">
          <Variant label="ⓘ"><CardInfoTip label="À propos">La moyenne est calculée avec les coefficients de ScoDoc.</CardInfoTip></Variant>
          <Variant label="warning"><CardInfoTip label="Attention" icon="ph:warning-circle" iconClassName="text-warning">UE sous 10.</CardInfoTip></Variant>
          <Variant label="text"><CardInfoTip label="Jury" text="ADM">Admis par le jury.</CardInfoTip></Variant>
        </Demo>
        <Demo title="UpdateNotice" file="src/components/UpdateNotice.jsx" stageClassName="flex-col! items-stretch!">
          <UpdateNotice onUpdateClick={() => new Promise((resolve) => setTimeout(resolve, 1200))} />
        </Demo>
        <Demo title="« Nouveautés » (balisage de ChangelogPill)" file="src/components/ChangelogPill.jsx" note="Recopié : le composant lit le store et ne s’affiche qu’avec du neuf">
          <button type="button" className="changelog-pill inline-flex h-8 items-center gap-[7px] rounded-full border px-3 text-text cursor-pointer">
            <span className="changelog-new-dot h-[7px] w-[7px] shrink-0 rounded-full" />
            <span className="font-body text-[13px] font-semibold leading-none">Nouveautés</span>
          </button>
        </Demo>
        <Demo title="GradesNotice" file="src/components/GradesNotice.jsx" stageClassName="flex-col! items-stretch!">
          <GradesNotice icon="ph:megaphone" label="Message" title="Message du département" badge="Nouveau" collapsible onDismiss={() => {}}>
            Les jurys du semestre 5 auront lieu le 28 janvier. Pensez à vérifier vos notes et à signaler toute erreur à votre enseignant avant le 20 janvier. Les rattrapages se dérouleront la semaine du 12 janvier.
          </GradesNotice>
          <GradesNotice icon="ph:info" label="Info" title="Notes provisoires" tint="#80cb3f">Elles peuvent encore changer</GradesNotice>
        </Demo>
        <Demo title="WidgetListStatus" file="src/components/WidgetListStatus.jsx">
          <div className="flex h-[120px] w-[260px] card-corners-sm border border-line bg-card p-4 text-ink">
            <WidgetListStatus icon="ph:tray" title="Aucun mail" body="Rien de nouveau depuis hier" />
          </div>
          <div className="flex h-[120px] w-[260px] card-corners-sm border border-line bg-card p-4 text-ink">
            <WidgetListStatus icon="ph:cloud-slash" title="Chargement impossible" body="Le webmail n’a pas répondu" action={{ label: 'Réessayer', onClick: () => {} }} />
          </div>
        </Demo>
        <Demo title="PageEmptyState" file="src/components/PageEmptyState.jsx" stageClassName="justify-center!">
          <PageEmptyState icon="ph:calendar-blank" title="Aucun cours cette semaine" action={<LentButton>Semaine suivante</LentButton>}>
            Ton emploi du temps apparaîtra ici dès qu’il sera publié
          </PageEmptyState>
        </Demo>
        <PageLoadingDemo />
        <Demo title="FileName (coupé au milieu)" file="src/components/FileName.jsx" stageClassName="flex-col! items-stretch!">
          <div className="w-[220px] rounded-[10px] bg-subtle px-3 py-2 font-body text-[13px] text-ink"><FileName name="Rapport_de_stage_version_finale_corrigée_v3.pdf" /></div>
          <div className="w-[140px] rounded-[10px] bg-subtle px-3 py-2 font-body text-[13px] text-ink"><FileName name="Rapport_de_stage_version_finale_corrigée_v3.pdf" /></div>
        </Demo>
      </Grid>
    </Section>
  )
}

function PageLoadingDemo() {
  const [run, setRun] = useState(0)
  return (
    <Demo title="PageLoading" file="src/components/PageLoading.jsx" note="Nouvelle ligne à 3 s, 8 s et 15 s" stageClassName="flex-col! items-stretch!">
      <PageLoading key={run} className="min-h-[220px]! py-6!" />
      <button type="button" className={`${SECONDARY_BUTTON} self-center cursor-pointer`} onClick={() => setRun((value) => value + 1)}><SmoothSurface />Rejouer</button>
    </Demo>
  )
}

// ── Overlays ──

function OverlaysSection() {
  const [dialog, setDialog] = useState(null)
  const [menu, setMenu] = useState(null)
  const openMenu = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    setMenu({ x: box.left, y: box.bottom + 8, anchor: event.currentTarget })
  }

  return (
    <Section id="calques" title="Calques" intro="Ce qui s’ouvre par-dessus la page">
      <Grid>
        <Demo title="ConfirmDialog" file="src/components/ConfirmDialog.jsx">
          <button type="button" className={SECONDARY_BUTTON} onClick={() => setDialog('plain')}><SmoothSurface />Normal</button>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => setDialog('destructive')}><SmoothSurface />Destructif</button>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => setDialog('extra')}><SmoothSurface />Trois choix</button>
        </Demo>
        <Demo title="ContextMenu" file="src/components/ContextMenu.jsx" note="Titre, icônes, pastilles, dossiers indentés, désactivé, destructif">
          <button type="button" className={SECONDARY_BUTTON} onClick={openMenu}><SmoothSurface />Ouvrir le menu</button>
        </Demo>
      </Grid>
      <ConfirmDialog
        open={dialog !== null}
        title={dialog === 'destructive' ? 'Supprimer définitivement ?' : dialog === 'extra' ? 'Enregistrer le brouillon ?' : 'Marquer tout comme lu ?'}
        confirmLabel={dialog === 'destructive' ? 'Supprimer' : dialog === 'extra' ? 'Enregistrer' : 'Confirmer'}
        destructive={dialog === 'destructive'}
        extraLabel={dialog === 'extra' ? 'Supprimer' : null}
        onExtra={dialog === 'extra' ? () => setDialog(null) : null}
        onConfirm={() => setDialog(null)}
        onCancel={() => setDialog(null)}
      >
        {dialog === 'destructive' ? 'Ce mail ne pourra pas être récupéré' : 'Une ligne sur ce qui va se passer'}
      </ConfirmDialog>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          label="Démo"
          title="3 mails sélectionnés"
          onClose={() => setMenu(null)}
          items={[
            { id: 'read', label: 'Marquer comme lu', icon: 'ph:envelope-open', onSelect: () => {} },
            { id: 'flag', label: 'Signaler', icon: 'ph:flag', onSelect: () => {} },
            { id: 'off', label: 'Indisponible', icon: 'ph:prohibit', disabled: true, onSelect: () => {} },
            'separator',
            { id: 'red', label: 'Rouge', swatch: '#d1342f', onSelect: () => {} },
            { id: 'none', label: 'Aucune couleur', swatch: '', onSelect: () => {} },
            'separator',
            { id: 'inbox', label: 'Boîte de réception', icon: 'ph:tray', checked: true, detail: '12', onSelect: () => {} },
            { id: 'sub', label: 'Cours', icon: 'ph:folder-simple', depth: 1, detail: '3', hint: 'INBOX/Cours', onSelect: () => {} },
            'separator',
            { id: 'delete', label: 'Supprimer', icon: 'ph:trash', destructive: true, onSelect: () => {} },
          ]}
        />
      ) : null}
    </Section>
  )
}

// ── Grades and data ──

const UES = [
  ['UE 5.1', '#b80004'], ['UE 5.2', '#f97b3d'], ['UE 5.3', '#feb40b'], ['UE 5.4', '#80cb3f'], ['UE 5.5', '#05162e'],
]

const HISTORY = [
  { date: '2026-09-22', average: 11.2 }, { date: '2026-10-03', average: 12.4 }, { date: '2026-10-14', average: 12.1 },
  { date: '2026-10-28', average: 13.6 }, { date: '2026-11-06', average: 13.1 }, { date: '2026-11-12', average: 14.2 },
]

const COUNTS = Array.from({ length: 21 }, (_, index) => Math.round(9 * Math.exp(-((index - 12) ** 2) / 14)))

function DataSection() {
  return (
    <Section id="notes" title="Notes et données" intro="Les composants dessinés de Mes notes, avec des données de démo">
      <Grid>
        <Demo title="UeBadge" file="src/components/UeBadge.jsx" note="Couleur de l’UE, encre choisie pour 4,5:1">
          {UES.map(([code, color]) => <Variant key={code} label={color}><UeBadge code={code} color={color} /></Variant>)}
        </Demo>
        <Demo title="AverageSparkline" file="src/components/AverageSparkline.jsx" stageClassName="flex-col! items-stretch!">
          <div className="h-[110px] text-ink"><AverageSparkline history={HISTORY} semesterEnd="2027-01-31" className="h-full w-full" /></div>
        </Demo>
        <Demo title="GradeHistogram · données" file="src/components/GradeHistogram.jsx" stageClassName="flex-col! items-stretch!">
          <GradeHistogram state={{ status: 'ok', counts: COUNTS, total: COUNTS.reduce((sum, count) => sum + count, 0) }} studentBucket={14} />
        </Demo>
        <Demo title="GradeHistogram · états" file="src/components/GradeHistogram.jsx" stageClassName="flex-col! items-stretch!">
          <GradeHistogram state={{ status: 'loading' }} />
          <GradeHistogram state={{ status: 'unavailable', reason: 'too-few' }} />
          <GradeHistogram state={{ status: 'error' }} onRetry={() => {}} />
        </Demo>
      </Grid>
    </Section>
  )
}

// ── Settings ──

function SettingsSection() {
  const [on, setOn] = useState(true)
  const [theme, setTheme] = useState('auto')
  return (
    <Section id="reglages" title="Réglages" intro="Les cartes et rangées de Réglages (settingsStyles.js), qui écrivent leurs couleurs en hex">
      <Grid min={480}>
        <Demo title="SettingsGroup" file="src/components/SettingsGroup.jsx" stageClassName="block!">
          <SettingsGroup title="Apparence" footer="S’applique à cet appareil">
            <div className={ROW_CLASSES}>
              <RowText icon="ph:moon" label="Thème" description="Suit le système en automatique" />
              <SegmentedControl label="Thème" size="sm" stretch={false} value={theme} onChange={setTheme} options={[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }]} />
            </div>
            <div className={ROW_CLASSES}>
              <RowText icon="ph:image" label="Fond d’écran" />
              <Switch checked={on} onChange={setOn} label="Fond d’écran" />
            </div>
            <button type="button" className={PRESSABLE_ROW_CLASSES}>
              <RowText icon="ph:user" label="Mon compte" description="Photo, nom affiché" />
              <Icon icon="ph:caret-right" className="size-4 text-ink-muted" />
            </button>
          </SettingsGroup>
        </Demo>
      </Grid>
    </Section>
  )
}

// ── Audit ──

const AUDIT_CARDS = [
  { key: 'hex', title: 'Hex en dur', hint: 'Hors tokens.css', tone: 'bad' },
  { key: 'rgb', title: 'rgb() en dur', hint: 'Ombres et voiles surtout', tone: 'warn' },
  { key: 'legacyClasses', title: 'Classes aux anciens noms', hint: 'text-text-muted, bg-widget-bg…', tone: 'warn' },
  { key: 'legacyVars', title: 'var(--color-*)', hint: 'Les alias de tokens.css', tone: 'warn' },
  { key: 'darkArbitrary', title: 'dark: avec une couleur', hint: 'Le thème sombre réécrit à la main', tone: 'bad' },
]

function AuditSection({ audit, error }) {
  const [open, setOpen] = useState('hex')
  if (error) return <Section id="audit" title="Audit du code"><p className="m-0 text-danger">{error}</p></Section>
  return (
    <Section id="audit" title="Audit du code" intro={audit ? `${audit.scanned} fichiers lus (src/**/*.jsx, *.css, components/**/*.js). Clique un fichier pour l’ouvrir dans l’éditeur` : 'Lecture des sources'}>
      {audit ? (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))' }}>
            {AUDIT_CARDS.map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={() => setOpen(card.key)}
                aria-pressed={open === card.key}
                className={`flex cursor-pointer flex-col items-start gap-1 card-corners-sm border p-4 text-left transition-colors ${open === card.key ? 'border-ink bg-card' : 'border-line bg-card hover:bg-subtle'}`}
              >
                <span className="font-display text-[30px] font-bold leading-none text-ink">{audit[card.key].total}</span>
                <span className="font-body text-[13px] font-semibold text-ink">{card.title}</span>
                <span className="font-body text-[12px] text-ink-muted">{audit[card.key].values.length} valeurs · {card.hint}</span>
              </button>
            ))}
            <div className="flex flex-col items-start gap-1 card-corners-sm border border-line bg-card p-4">
              <span className="font-display text-[30px] font-bold leading-none text-ink">{audit.fontPx.values.length}</span>
              <span className="font-body text-[13px] font-semibold text-ink">Tailles de texte</span>
              <span className="font-body text-[12px] text-ink-muted">+ {audit.fontNamed.values.length} nommées · voir Typographie</span>
            </div>
            <div className="flex flex-col items-start gap-1 card-corners-sm border border-line bg-card p-4">
              <span className="font-display text-[30px] font-bold leading-none text-ink">{audit.radii.values.length} / {audit.shadows.values.length}</span>
              <span className="font-body text-[13px] font-semibold text-ink">Rayons / ombres</span>
              <span className="font-body text-[12px] text-ink-muted">Valeurs distinctes · voir Formes</span>
            </div>
          </div>
          <AuditDetail key={open} data={audit[open]} kind={open} />
        </>
      ) : <AuditPending />}
    </Section>
  )
}

function AuditDetail({ data, kind }) {
  const isColor = kind === 'hex' || kind === 'rgb'
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Demo title="Par fichier" fixedSurface="page" stageClassName="block!">
        <div className="grid gap-1">
          {data.files.slice(0, 40).map((entry) => (
            <div key={entry.path} className="flex items-center gap-3 border-b border-line py-[5px] last:border-b-0">
              <SourceLink path={sourcePath(entry.path)} />
              <span className="ml-auto h-[6px] rounded-full bg-ink-faint" style={{ width: `${Math.min(140, entry.count * 3)}px` }} />
              <span className="w-8 text-right font-mono text-[11px] text-ink-muted">{entry.count}</span>
            </div>
          ))}
        </div>
      </Demo>
      <Demo title="Par valeur" fixedSurface="page" stageClassName="block!">
        <div className="grid gap-0">
          {data.values.slice(0, 80).map((entry) => (
            <UsageRow key={entry.value} entry={entry}>
              {isColor ? <span className="size-5 shrink-0 rounded-full border border-line" style={{ background: entry.value }} /> : null}
              <span className="min-w-0 truncate font-mono text-[12px] text-ink" title={entry.value}>{entry.value}</span>
            </UsageRow>
          ))}
        </div>
      </Demo>
    </div>
  )
}

// ── The page ──

const SECTIONS = [
  ['couleurs', 'Couleurs'], ['typographie', 'Typographie'], ['formes', 'Formes'], ['matieres', 'Matières'],
  ['boutons', 'Boutons'], ['champs', 'Champs'], ['retours', 'Retours'], ['calques', 'Calques'],
  ['notes', 'Notes'], ['reglages', 'Réglages'], ['audit', 'Audit'],
]

function useAudit() {
  const [state, setState] = useState({ audit: null, error: null })
  useEffect(() => {
    let cancelled = false
    Promise.all(Object.entries(SOURCES).map(async ([path, load]) => [path, await load()]))
      .then((entries) => {
        if (!cancelled) setState({ audit: auditSources(Object.fromEntries(entries)), error: null })
      })
      .catch((error) => {
        if (!cancelled) setState({ audit: null, error: String(error?.message ?? error) })
      })
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

// Bumps on any repaint of <html>'s theme or palette.
function useThemeRevision() {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const observer = new MutationObserver(() => setRevision((value) => value + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'style'] })
    return () => observer.disconnect()
  }, [])
  return revision
}

function Toolbar({ state, update }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="mr-auto flex items-center gap-2">
        <span className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">Design system</span>
        <Pill tone="warn">dev</Pill>
      </div>
      <SegmentedControl
        label="Thème"
        size="sm"
        stretch={false}
        value={state.theme}
        onChange={(theme) => update({ theme })}
        options={[{ value: 'light', label: 'Clair', icon: 'ph:sun' }, { value: 'dark', label: 'Sombre', icon: 'ph:moon' }]}
      />
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Palette">
        {PALETTES.map((palette) => {
          const colors = paletteColors(palette)
          const active = palette.id === state.palette
          return (
            <button
              key={palette.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={palette.label}
              onClick={() => update({ palette: palette.id })}
              className={`size-7 cursor-pointer rounded-full border-2 p-0 transition-transform hover:scale-110 ${active ? 'border-ink' : 'border-transparent'}`}
              style={{ background: state.theme === 'dark' ? colors.swatchDark : colors.swatch, boxShadow: 'inset 0 0 0 2px var(--surface-page)' }}
            />
          )
        })}
      </div>
      <SegmentedControl
        label="Fond des démos"
        size="sm"
        stretch={false}
        value={state.surface}
        onChange={(surface) => update({ surface })}
        options={[{ value: 'page', label: 'Page' }, { value: 'card', label: 'Carte' }, { value: 'glass', label: 'Verre' }]}
      />
      <label className="flex cursor-pointer items-center gap-2 font-body text-[13px] font-semibold text-ink">
        <Switch small checked={state.split} onChange={(split) => update({ split })} label="Clair et sombre côte à côte" />
        Côte à côte
      </label>
    </div>
  )
}

function Nav() {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Sections">
      {SECTIONS.map(([id, label]) => (
        <a key={id} href={`#${id}`} className="shrink-0 rounded-full px-3 py-[6px] font-body text-[13px] font-semibold text-ink-muted no-underline hover:bg-state-hover hover:text-ink">{label}</a>
      ))}
    </nav>
  )
}

function Content({ rootRef, revision, photo }) {
  const { audit, error } = useAudit()
  return (
    <div className="flex flex-col gap-14">
      <ColorsSection rootRef={rootRef} revision={revision} />
      <TypographySection audit={audit} />
      <ShapesSection audit={audit} />
      <MaterialsSection photo={photo} />
      <ButtonsSection />
      <ControlsSection />
      <FeedbackSection />
      <OverlaysSection />
      <DataSection />
      <SettingsSection />
      <AuditSection audit={audit} error={error} />
    </div>
  )
}

export default function DesignGallery() {
  const [state, setState] = useState(readParams)
  const rootRef = useRef(null)
  const revision = useThemeRevision()
  const photo = useMemo(() => {
    try {
      return resolveHeroImage()?.src ?? null
    } catch {
      return null
    }
  }, [])

  const update = useCallback((patch) => setState((current) => ({ ...current, ...patch })), [])

  // Painted on <html> as the app does, never stored.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = state.theme
    applyPalette(PALETTES.find((palette) => palette.id === state.palette) ?? PALETTES[0])
    writeParams(state)
  }, [state])

  useEffect(() => {
    document.title = 'Design system · Tafac (dev)'
  }, [])

  const glass = state.surface === 'glass'
  const frameParams = (theme) => `/dev/design?embed=1&theme=${theme}&palette=${state.palette}&surface=${state.surface}${window.location.hash}`

  return (
    <SurfaceContext.Provider value={state.surface}>
      <div
        ref={rootRef}
        className="min-h-dvh bg-page font-body text-ink"
        style={glass && photo ? { backgroundImage: `url(${photo})`, backgroundSize: 'cover', backgroundAttachment: 'fixed', backgroundPosition: 'center' } : undefined}
      >
        {state.embed ? null : (
          <header className="sticky top-0 z-50 border-b border-line bg-[color-mix(in_srgb,var(--surface-page)_86%,transparent)] px-6 pt-4 pb-2 backdrop-blur-xl max-sm:px-4">
            <div className="mx-auto flex max-w-[1280px] flex-col gap-3">
              <Toolbar state={state} update={update} />
              {state.split ? null : <Nav />}
            </div>
          </header>
        )}
        {state.split && !state.embed ? (
          <div className="grid grid-cols-2 max-md:grid-cols-1">
            {['light', 'dark'].map((theme) => (
              <iframe key={theme} title={theme} src={frameParams(theme)} className="h-[calc(100dvh-74px)] w-full border-0 border-r border-line" />
            ))}
          </div>
        ) : (
          <main className="mx-auto max-w-[1280px] px-6 py-8 max-sm:px-4">
            <Content rootRef={rootRef} revision={`${revision}-${state.theme}-${state.palette}`} photo={photo} />
          </main>
        )}
      </div>
    </SurfaceContext.Provider>
  )
}
