import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'

const TEXT_COLORS = [
  { label: 'Par défaut', value: 'inherit', color: 'currentColor' },
  { label: 'Bleu', value: '#2563eb', color: '#2563eb' },
  { label: 'Indigo', value: '#4f46e5', color: '#4f46e5' },
  { label: 'Émeraude', value: '#059669', color: '#059669' },
  { label: 'Ambre', value: '#d97706', color: '#d97706' },
  { label: 'Rouge', value: '#dc2626', color: '#dc2626' },
  { label: 'Violet', value: '#9333ea', color: '#9333ea' },
  { label: 'Gris neutre', value: '#64748b', color: '#64748b' },
]

const HIGHLIGHT_COLORS = [
  { label: 'Aucun', value: 'transparent', color: 'transparent' },
  { label: 'Jaune doux', value: '#fef08a', color: '#fef08a' },
  { label: 'Vert menthe', value: '#bbf7d0', color: '#bbf7d0' },
  { label: 'Bleu ciel', value: '#bfdbfe', color: '#bfdbfe' },
  { label: 'Pêche', value: '#fed7aa', color: '#fed7aa' },
  { label: 'Rose doux', value: '#fbcfe8', color: '#fbcfe8' },
]

const EMAIL_TEMPLATES = [
  {
    id: 'rdv',
    title: 'Demande de rendez-vous',
    description: 'Contacter un professeur ou responsable',
    icon: 'carbon:calendar',
    html: `
      <p>Bonjour Madame, Monsieur,</p>
      <p>Je me permets de vous contacter afin de solliciter un rendez-vous concernant <em>[préciser le cours / le projet / le sujet]</em>.</p>
      <p>Je suis disponible principalement sur les créneaux suivants :</p>
      <ul>
        <li><strong>Jour 1 :</strong> [ex: Lundi après-midi à partir de 14h]</li>
        <li><strong>Jour 2 :</strong> [ex: Mercredi matin entre 9h et 12h]</li>
      </ul>
      <p>Seriez-vous disponible à l'un de ces moments, ou auriez-vous une autre préférence ?</p>
      <p>En vous remerciant par avance pour votre retour,<br/>Bien cordialement,</p>
      <p><strong>[Prénom Nom]</strong><br/><em>[Formation / Groupe TD-TP]</em></p>
    `,
  },
  {
    id: 'absence',
    title: "Justification d'absence",
    description: 'Informer le secrétariat ou les enseignants',
    icon: 'carbon:document-attachment',
    html: `
      <p>Bonjour,</p>
      <p>Je vous informe par la présente de mon absence au cours de <strong>[Nom de la matière]</strong> prévu le <strong>[Date et heure]</strong> en raison de <em>[motif de l'absence / raisons médicales]</em>.</p>
      <blockquote>
        <p><strong>Information :</strong> Mon justificatif officiel <em>[certificat médical / convocation]</em> est joint à ce message / vous sera transmis dans les plus brefs délais.</p>
      </blockquote>
      <p>Je me tiens à votre disposition pour tout rattrapage ou travail à effectuer.</p>
      <p>Bien cordialement,<br/><strong>[Prénom Nom]</strong><br/><em>[Formation / Numéro étudiant]</em></p>
    `,
  },
  {
    id: 'question',
    title: 'Question sur un cours ou un TP',
    description: 'Demander une précision pédagogique',
    icon: 'carbon:help',
    html: `
      <p>Bonjour Madame, Monsieur,</p>
      <p>Dans le cadre du travail sur <strong>[Matière / TP n°X]</strong>, je rencontre une difficulté concernant :</p>
      <p><em>[Expliquer brièvement et précisément votre question ou le blocage rencontré]</em>.</p>
      <p>J'ai déjà essayé <em>[résumé des tests ou lectures effectués]</em> mais le problème persiste.</p>
      <p>Auriez-vous une indication ou un conseil pour m'orienter ?</p>
      <p>Merci beaucoup pour votre temps et vos conseils,<br/>Bien cordialement,</p>
      <p><strong>[Prénom Nom]</strong><br/><em>[Groupe TD/TP]</em></p>
    `,
  },
  {
    id: 'polite_closing',
    title: 'Formule de politesse soignée',
    description: 'Signature formelle et courtoise',
    icon: 'carbon:chat',
    html: `
      <p>Restant à votre entière disposition pour tout renseignement complémentaire.</p>
      <p>En vous souhaitant une excellente journée,<br/>Bien cordialement,</p>
      <p><strong>[Prénom Nom]</strong><br/><em>Étudiant(e) à l'Université de Rennes</em></p>
    `,
  },
]

export default function RichTextEditor({
  value = '',
  onChange,
  placeholder = 'Rédigez votre message ici…',
  minHeight = '280px',
}) {
  const editorRef = useRef(null)
  const isUpdatingFromProps = useRef(false)
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ul: false,
    ol: false,
    blockquote: false,
  })
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showHighlightPicker, setShowHighlightPicker] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const [viewMode, setViewMode] = useState('edit') // 'edit' | 'preview'
  const savedSelectionRef = useRef(null)

  // Sync value from props into editor only when external change happens
  useEffect(() => {
    if (editorRef.current && !isUpdatingFromProps.current) {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value || ''
      }
    }
  }, [value])

  const saveSelection = () => {
    if (typeof window === 'undefined') return
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange()
    }
  }

  const restoreSelection = () => {
    if (typeof window === 'undefined' || !savedSelectionRef.current) return
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(savedSelectionRef.current)
  }

  const updateActiveFormats = useCallback(() => {
    if (typeof document === 'undefined') return
    try {
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
        blockquote: Boolean(
          window.getSelection()?.anchorNode?.parentElement?.closest('blockquote'),
        ),
      })
    } catch {
      // Ignored
    }
  }, [])

  const handleInput = () => {
    if (!editorRef.current) return
    isUpdatingFromProps.current = true
    const html = editorRef.current.innerHTML
    onChange?.(html === '<br>' ? '' : html)
    updateActiveFormats()
    setTimeout(() => {
      isUpdatingFromProps.current = false
    }, 0)
  }

  const execCmd = (command, value = null) => {
    if (!editorRef.current) return
    editorRef.current.focus()
    document.execCommand(command, false, value)
    handleInput()
  }

  const handleBlockFormat = (tag) => {
    if (!editorRef.current) return
    editorRef.current.focus()
    if (tag === 'blockquote') {
      execCmd('formatBlock', '<blockquote>')
    } else if (tag === 'pre') {
      execCmd('formatBlock', '<pre>')
    } else if (tag.startsWith('h')) {
      execCmd('formatBlock', `<${tag}>`)
    } else {
      execCmd('formatBlock', '<p>')
    }
  }

  const handleInsertLink = () => {
    if (!linkUrl) return
    restoreSelection()
    let url = linkUrl.trim()
    if (!/^https?:\/\//i.test(url) && !url.startsWith('mailto:')) {
      url = `https://${url}`
    }

    if (linkText) {
      const html = `<a href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`
      execCmd('insertHTML', html)
    } else {
      execCmd('createLink', url)
    }

    setShowLinkModal(false)
    setLinkUrl('')
    setLinkText('')
  }

  const handleOpenLinkModal = () => {
    saveSelection()
    const sel = window.getSelection()
    const selectedText = sel ? sel.toString().trim() : ''
    setLinkText(selectedText)
    setLinkUrl('')
    setShowLinkModal(true)
  }

  const handleApplyTemplate = (templateHtml) => {
    if (!editorRef.current) return
    editorRef.current.focus()
    // Append or replace
    const current = editorRef.current.innerHTML.trim()
    const newHtml = current && current !== '<br>' ? `${current}<br/><hr/><br/>${templateHtml}` : templateHtml
    editorRef.current.innerHTML = newHtml
    onChange?.(newHtml)
    setShowTemplates(false)
  }

  return (
    <div className="flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-widget-bg shadow-xs overflow-hidden transition-all">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-bg-subtle/70 px-3 py-2 flex-wrap gap-1.5 backdrop-blur-xs select-none">
        <div className="flex items-center flex-wrap gap-1">
          {/* Paragraph / Heading Select */}
          <select
            onChange={(e) => handleBlockFormat(e.target.value)}
            defaultValue="p"
            className="h-8 rounded-lg border border-border bg-widget-bg px-2.5 text-[12px] font-medium text-text hover:border-brand/40 focus:border-brand focus:outline-none transition-colors"
            title="Style de texte"
            disabled={viewMode === 'preview'}
          >
            <option value="p">Normal (Paragraphe)</option>
            <option value="h1">Grand titre (H1)</option>
            <option value="h2">Titre de section (H2)</option>
            <option value="h3">Sous-titre (H3)</option>
            <option value="blockquote">Citation</option>
            <option value="pre">Bloc de code</option>
          </select>

          <div className="h-4 w-px bg-border mx-1 max-xs:hidden" />

          {/* Inline styles */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => execCmd('bold')}
              disabled={viewMode === 'preview'}
              className={`flex size-8 items-center justify-center rounded-lg text-text transition-colors ${
                activeFormats.bold ? 'bg-brand/15 text-brand font-bold' : 'hover:bg-bg-subtle'
              }`}
              title="Gras (Ctrl+B)"
            >
              <Icon icon="carbon:text-bold" className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => execCmd('italic')}
              disabled={viewMode === 'preview'}
              className={`flex size-8 items-center justify-center rounded-lg text-text transition-colors ${
                activeFormats.italic ? 'bg-brand/15 text-brand font-bold' : 'hover:bg-bg-subtle'
              }`}
              title="Italique (Ctrl+I)"
            >
              <Icon icon="carbon:text-italic" className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => execCmd('underline')}
              disabled={viewMode === 'preview'}
              className={`flex size-8 items-center justify-center rounded-lg text-text transition-colors ${
                activeFormats.underline ? 'bg-brand/15 text-brand font-bold' : 'hover:bg-bg-subtle'
              }`}
              title="Souligné (Ctrl+U)"
            >
              <Icon icon="carbon:text-underline" className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => execCmd('strikeThrough')}
              disabled={viewMode === 'preview'}
              className={`flex size-8 items-center justify-center rounded-lg text-text transition-colors ${
                activeFormats.strike ? 'bg-brand/15 text-brand font-bold' : 'hover:bg-bg-subtle'
              }`}
              title="Barré"
            >
              <Icon icon="carbon:text-strikethrough" className="size-4" />
            </button>
          </div>

          <div className="h-4 w-px bg-border mx-1 max-xs:hidden" />

          {/* Color & Highlight */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowHighlightPicker(false)
                setShowColorPicker(!showColorPicker)
              }}
              disabled={viewMode === 'preview'}
              className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-bg-subtle transition-colors"
              title="Couleur du texte"
            >
              <Icon icon="carbon:color-palette" className="size-4 text-brand" />
            </button>

            {showColorPicker && (
              <div className="absolute left-0 top-full z-50 mt-1 flex flex-col gap-1 rounded-xl border border-border bg-widget-bg p-2 shadow-xl backdrop-blur-md min-w-[140px]">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted px-1.5 py-0.5">
                  Couleur du texte
                </span>
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => {
                      execCmd('foreColor', c.value)
                      setShowColorPicker(false)
                    }}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-medium text-text hover:bg-bg-subtle transition-colors"
                  >
                    <span
                      className="size-3.5 rounded-full border border-black/15 shadow-2xs"
                      style={{ backgroundColor: c.color }}
                    />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowColorPicker(false)
                setShowHighlightPicker(!showHighlightPicker)
              }}
              disabled={viewMode === 'preview'}
              className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-bg-subtle transition-colors"
              title="Surlignage"
            >
              <Icon icon="carbon:text-highlight" className="size-4 text-amber-500" />
            </button>

            {showHighlightPicker && (
              <div className="absolute left-0 top-full z-50 mt-1 flex flex-col gap-1 rounded-xl border border-border bg-widget-bg p-2 shadow-xl backdrop-blur-md min-w-[140px]">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted px-1.5 py-0.5">
                  Surlignage
                </span>
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => {
                      execCmd('hiliteColor', c.value)
                      setShowHighlightPicker(false)
                    }}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-medium text-text hover:bg-bg-subtle transition-colors"
                  >
                    <span
                      className="size-3.5 rounded-sm border border-black/15 shadow-2xs"
                      style={{ backgroundColor: c.color }}
                    />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-border mx-1 max-xs:hidden" />

          {/* Alignment */}
          <div className="flex items-center gap-0.5 max-sm:hidden">
            <button
              type="button"
              onClick={() => execCmd('justifyLeft')}
              disabled={viewMode === 'preview'}
              className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-bg-subtle transition-colors"
              title="Aligner à gauche"
            >
              <Icon icon="carbon:align-left" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => execCmd('justifyCenter')}
              disabled={viewMode === 'preview'}
              className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-bg-subtle transition-colors"
              title="Centrer"
            >
              <Icon icon="carbon:align-center" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => execCmd('justifyRight')}
              disabled={viewMode === 'preview'}
              className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-bg-subtle transition-colors"
              title="Aligner à droite"
            >
              <Icon icon="carbon:align-right" className="size-4" />
            </button>
          </div>

          <div className="h-4 w-px bg-border mx-1 max-sm:hidden" />

          {/* Lists & Insertions */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => execCmd('insertUnorderedList')}
              disabled={viewMode === 'preview'}
              className={`flex size-8 items-center justify-center rounded-lg text-text transition-colors ${
                activeFormats.ul ? 'bg-brand/15 text-brand font-bold' : 'hover:bg-bg-subtle'
              }`}
              title="Liste à puces"
            >
              <Icon icon="carbon:list-bulleted" className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => execCmd('insertOrderedList')}
              disabled={viewMode === 'preview'}
              className={`flex size-8 items-center justify-center rounded-lg text-text transition-colors ${
                activeFormats.ol ? 'bg-brand/15 text-brand font-bold' : 'hover:bg-bg-subtle'
              }`}
              title="Liste numérotée"
            >
              <Icon icon="carbon:list-numbered" className="size-4" />
            </button>

            <button
              type="button"
              onClick={handleOpenLinkModal}
              disabled={viewMode === 'preview'}
              className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-bg-subtle transition-colors"
              title="Insérer un lien"
            >
              <Icon icon="carbon:link" className="size-4 text-blue-500" />
            </button>

            <button
              type="button"
              onClick={() => execCmd('insertHorizontalRule')}
              disabled={viewMode === 'preview'}
              className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-bg-subtle transition-colors max-sm:hidden"
              title="Ligne de séparation"
            >
              <Icon icon="carbon:subtract" className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => execCmd('removeFormat')}
              disabled={viewMode === 'preview'}
              className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-bg-subtle transition-colors max-sm:hidden"
              title="Effacer la mise en forme"
            >
              <Icon icon="carbon:clean" className="size-4 opacity-70" />
            </button>
          </div>
        </div>

        {/* Right side toolbar: Templates & View Toggle */}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Templates Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTemplates(!showTemplates)}
              disabled={viewMode === 'preview'}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-widget-bg px-2.5 py-1 text-[12px] font-semibold text-text hover:border-brand/40 hover:bg-bg-subtle transition-colors shadow-2xs"
              title="Modèles d'e-mails universitaires prêts à l'emploi"
            >
              <Icon icon="carbon:template" className="size-3.5 text-brand" />
              <span className="max-xs:hidden">Modèles</span>
              <Icon icon="carbon:chevron-down" className="size-3 opacity-60" />
            </button>

            {showTemplates && (
              <div className="absolute right-0 top-full z-50 mt-1 flex flex-col gap-1 rounded-2xl border border-border bg-widget-bg p-2 shadow-2xl backdrop-blur-xl w-[280px]">
                <div className="px-2 py-1 border-b border-border mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Modèles universitaires
                  </span>
                  <p className="text-[11px] text-text-muted m-0">Insère une trame soignée en 1 clic</p>
                </div>
                {EMAIL_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => handleApplyTemplate(tmpl.html)}
                    className="flex items-start gap-2.5 rounded-xl p-2 text-left hover:bg-brand/10 transition-colors group"
                  >
                    <div className="size-7 rounded-lg bg-bg-subtle flex items-center justify-center text-brand shrink-0 group-hover:bg-brand group-hover:text-white transition-colors">
                      <Icon icon={tmpl.icon} className="size-4" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[12px] font-bold text-text group-hover:text-brand transition-colors">
                        {tmpl.title}
                      </span>
                      <span className="text-[11px] text-text-muted line-clamp-1">
                        {tmpl.description}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mode Switch (Edit / Preview) */}
          <div className="flex items-center rounded-lg bg-bg-subtle p-0.5 border border-border text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('edit')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 transition-all ${
                viewMode === 'edit'
                  ? 'bg-widget-bg text-text shadow-2xs font-bold'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              <Icon icon="carbon:edit" className="size-3" />
              <span>Rédiger</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 transition-all ${
                viewMode === 'preview'
                  ? 'bg-widget-bg text-text shadow-2xs font-bold'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              <Icon icon="carbon:view" className="size-3" />
              <span>Aperçu</span>
            </button>
          </div>
        </div>
      </div>

      {/* Editor Content Area */}
      <div className="relative flex-1 p-4 bg-widget-bg" style={{ minHeight }}>
        {viewMode === 'edit' ? (
          <div
            ref={editorRef}
            contentEditable
            onInput={handleInput}
            onKeyUp={updateActiveFormats}
            onMouseUp={updateActiveFormats}
            data-placeholder={placeholder}
            className="prose dark:prose-invert max-w-none text-[15px] leading-relaxed text-text outline-none min-h-[220px] focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-text-muted/60 empty:before:pointer-events-none"
            style={{
              wordBreak: 'break-word',
            }}
          />
        ) : (
          /* Preview Mode: Shows the email exactly as the recipient will receive it */
          <div className="rounded-xl border border-border bg-white dark:bg-zinc-950 p-6 shadow-xs">
            <div className="mb-4 pb-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-[12px] text-text-muted">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon icon="carbon:email" className="size-4 text-brand" />
                Rendu final dans la boîte du destinataire
              </span>
              <span className="text-[11px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-semibold">
                HTML + Plain Text
              </span>
            </div>
            {value ? (
              <div
                className="prose dark:prose-invert max-w-none text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100"
                dangerouslySetInnerHTML={{ __html: value }}
              />
            ) : (
              <p className="text-[14px] text-text-muted italic py-4">
                Le corps de votre message est actuellement vide.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Link Modal */}
      {showLinkModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLinkModal(false)
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-widget-bg p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="m-0 text-[15px] font-bold text-text flex items-center gap-2">
                <Icon icon="carbon:link" className="size-4 text-brand" />
                Insérer un lien
              </h3>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="size-7 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-subtle"
              >
                <Icon icon="carbon:close" className="size-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-text">
                <span>URL de destination *</span>
                <input
                  type="url"
                  placeholder="https://exemple.fr ou mailto:..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  autoFocus
                  className="h-9 rounded-lg border border-border bg-bg-subtle px-3 text-[13px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1 text-[12px] font-semibold text-text">
                <span>Texte affiché (optionnel)</span>
                <input
                  type="text"
                  placeholder="Mon lien"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-bg-subtle px-3 text-[13px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-text-muted hover:bg-bg-subtle transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleInsertLink}
                disabled={!linkUrl.trim()}
                className="rounded-lg bg-brand px-4 py-1.5 text-[13px] font-semibold text-bg shadow-xs hover:opacity-90 disabled:opacity-50 transition-all"
              >
                Insérer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
