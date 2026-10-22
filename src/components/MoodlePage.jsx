import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import {
  getMoodleAssignmentDetails,
  getMoodleCourseContents,
  getMoodleCourses,
  getMoodleDeadlines,
  getMoodleFolderContents,
  removeMoodleAssignmentFile,
  submitMoodleAssignment,
} from '../entApi'
import { CARD_CLASSES, HELP_TOUR_BUTTON, SECONDARY_BUTTON, revealStyle } from '../scodocPageUtils'
import { APP_NAME } from '../seo'
import { getOfflineCache, setOfflineCache } from '../offlineStorage'
import { AppPage, ICON_ONLY, PageButton } from './AppPage'
import PageGuidedTour from './PageGuidedTour'
import {
  LoadingDots,
  SectionTitle,
  SegmentedControl,
  StatusMessage,
} from './ScodocUi'
import {
  SHIMMER_CLASSES,
  calendarDayDiff,
  formatClockTime,
  parseDate,
} from './widgetListUtils'

const MOODLE_VIEW_STORAGE_KEY = 'l-ent:moodle-view-mode'
const MOODLE_RECENT_COURSES_KEY = 'l-ent:moodle-recent-courses'
const MOODLE_SHOW_EMPTY_SECTIONS_KEY = 'l-ent:moodle-show-empty-sections'

function formatCategoryLabel(raw) {
  if (!raw) return 'Général'
  let label = String(raw).trim()
  if (/École nationale supérieure des sciences appliquées et de technologie/i.test(label)) {
    return 'ENSSAT'
  }
  label = label.replace(/^FISE\s+/i, '')
  label = label.replace(/^Formations?\s+d['’]ingénieurs?\s*:\s*/i, 'Ingénieurs: ')
  label = label.replace(/^Master\s*:\s*/i, 'Master ')
  label = label.replace(/^Licence\s*:\s*/i, 'Licence ')
  return label
}

const MOODLE_TOUR_STEPS = [
  {
    id: 'intro',
    title: 'Bienvenue sur Moodle',
    body: 'Retrouve tous tes cours, espaces pédagogiques et ressources universitaires directement dans Tafac, sans reconnexions intempestives.',
    icon: 'carbon:education',
  },
  {
    id: 'overview',
    target: 'moodle-overview',
    title: 'Bilan & Devoirs à rendre',
    body: 'Consulte tes échéances imminentes, tes devoirs à déposer et tes tests en ligne directement depuis ce tableau de bord.',
    icon: 'carbon:delivery-parcel',
  },
  {
    id: 'courses',
    target: 'moodle-courses',
    title: 'Tes cours & matières',
    body: 'Parcours l’ensemble de tes espaces de cours Moodle. Filtre-les par catégorie ou bascule entre la vue Cartes et la vue Liste.',
    icon: 'carbon:list-boxes',
  },
  {
    id: 'resources',
    target: 'moodle-resources',
    title: 'Documents & Supports de cours',
    body: 'Clique directement sur un cours pour explorer ses sections, ouvrir un PDF dans le lecteur natif ou télécharger les polycopiés d’un simple clic.',
    icon: 'carbon:document-pdf',
  },
]

const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
})

function formatFileSize(bytes) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function formatRelativeDueDate(dueAtString, now = new Date()) {
  const date = parseDate(dueAtString)
  if (!date) return ''
  const dayDiff = calendarDayDiff(date, now)
  if (dayDiff === 0) return `Aujourd'hui à ${formatClockTime(date)}`
  if (dayDiff === 1) return `Demain à ${formatClockTime(date)}`
  if (dayDiff === -1) return `Hier à ${formatClockTime(date)}`
  if (dayDiff < -1) return `En retard (${dayMonthFormatter.format(date)})`
  return dayMonthFormatter.format(date)
}

function getModuleKind(modname) {
  const mod = String(modname || '').toLowerCase()
  if (mod === 'resource') return 'file'
  if (mod === 'folder') return 'folder'
  if (mod === 'assign') return 'assign'
  if (mod === 'quiz') return 'quiz'
  if (mod === 'forum') return 'forum'
  if (mod === 'url') return 'link'
  if (mod === 'page' || mod === 'book') return 'page'
  return 'other'
}

function getModuleIcon(kind, filename = '') {
  const ext = String(filename).split('.').pop()?.toLowerCase() || ''
  if (kind === 'file') {
    if (ext === 'pdf') return { icon: 'carbon:document-pdf', color: 'text-error bg-error-bg' }
    if (['zip', 'rar', 'tar', 'gz', '7z', 'bz2'].includes(ext)) {
      return { icon: 'carbon:zip', color: 'text-accent-text bg-accent-bg' }
    }
    if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
      return { icon: 'carbon:document-word', color: 'text-blue-500 bg-blue-500/10' }
    }
    if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(ext)) {
      return { icon: 'carbon:table', color: 'text-success-text bg-success-bg' }
    }
    if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) {
      return { icon: 'carbon:presentation-file', color: 'text-orange-500 bg-orange-500/10' }
    }
    if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'html', 'css', 'json', 'yaml', 'yml', 'xml', 'sql', 'sh', 'bash', 'rs', 'go'].includes(ext)) {
      return { icon: 'carbon:code', color: 'text-purple-500 bg-purple-500/10' }
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) {
      return { icon: 'carbon:image', color: 'text-pink-500 bg-pink-500/10' }
    }
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
      return { icon: 'carbon:music', color: 'text-cyan-500 bg-cyan-500/10' }
    }
    if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) {
      return { icon: 'carbon:video', color: 'text-rose-500 bg-rose-500/10' }
    }
    if (['txt', 'md'].includes(ext)) {
      return { icon: 'carbon:document-blank', color: 'text-text-secondary bg-muted-fill' }
    }
    return { icon: 'carbon:document', color: 'text-blue-500 bg-blue-500/10' }
  }
  if (kind === 'folder') return { icon: 'carbon:folder', color: 'text-accent-text bg-accent-bg' }
  if (kind === 'assign') return { icon: 'carbon:task', color: 'text-purple-500 bg-purple-500/10' }
  if (kind === 'quiz') return { icon: 'carbon:help', color: 'text-success-text bg-success-bg' }
  if (kind === 'forum') return { icon: 'carbon:chat', color: 'text-sky-500 bg-sky-500/10' }
  if (kind === 'link') return { icon: 'carbon:launch', color: 'text-indigo-500 bg-indigo-500/10' }
  if (kind === 'page') return { icon: 'carbon:notebook', color: 'text-teal-500 bg-teal-500/10' }
  return { icon: 'carbon:circle-dash', color: 'text-text-secondary bg-muted-fill' }
}

export default function MoodlePage() {
  const [courses, setCourses] = useState([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [coursesError, setCoursesError] = useState(null)
  // Moodle's own address when it refused Tafac (403): the student opens it there.
  const [coursesServiceHref, setCoursesServiceHref] = useState(null)
  const [moodleWebHref, setMoodleWebHref] = useState(null)

  const [deadlines, setDeadlines] = useState([])

  const [selectedCourse, setSelectedCourse] = useState(null)
  const [contentsCache, setContentsCache] = useState({})
  const [loadingContents, setLoadingContents] = useState(false)
  const [contentsError, setContentsError] = useState(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [moduleTypeFilter, setModuleTypeFilter] = useState('all')
  const [collapsedSections, setCollapsedSections] = useState({})
  const [tourTrigger, setTourTrigger] = useState(0)

  // Folder drill-down & inline expansion state
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [expandedFolders, setExpandedFolders] = useState({})
  const [folderFilesCache, setFolderFilesCache] = useState({})
  const [loadingFolderFiles, setLoadingFolderFiles] = useState(false)
  const [folderError, setFolderError] = useState(null)
  const [folderSearchQuery, setFolderSearchQuery] = useState('')

  // Assignment Modal & submission state
  const [activeAssignment, setActiveAssignment] = useState(null)
  const [assignmentDetails, setAssignmentDetails] = useState(null)
  const [loadingAssignment, setLoadingAssignment] = useState(false)
  const [assignmentError, setAssignmentError] = useState(null)
  const [stagedFiles, setStagedFiles] = useState([])
  const [submissionOnlineText, setSubmissionOnlineText] = useState('')
  const [submittingAssignment, setSubmittingAssignment] = useState(false)
  const [assignmentSuccessMsg, setAssignmentSuccessMsg] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)

  // View mode preference: 'grid' (cards) or 'list'
  const [viewLayout, setViewLayout] = useState(() => {
    try {
      return localStorage.getItem(MOODLE_VIEW_STORAGE_KEY) || 'grid'
    } catch {
      return 'grid'
    }
  })

  // Recent courses tracking
  const [recentCourseIds, setRecentCourseIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(MOODLE_RECENT_COURSES_KEY) || '[]')
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    const previousTitle = document.title
    document.title = `Moodle · ${APP_NAME}`
    return () => {
      document.title = previousTitle
    }
  }, [])

  const handleLayoutChange = useCallback((mode) => {
    setViewLayout(mode)
    try {
      localStorage.setItem(MOODLE_VIEW_STORAGE_KEY, mode)
    } catch {
      // Best effort: nothing to do when it fails.
    }
  }, [])

  const loadCourses = useCallback(async () => {
    setLoadingCourses(true)
    setCoursesError(null)
    setCoursesServiceHref(null)
    try {
      const result = await getMoodleCourses()
      if (result.status === 'ok') {
        const list = result.courses || []
        setCourses(list)
        setMoodleWebHref(result.moodleHref || null)
        void setOfflineCache('moodle:courses', list)
      } else if (result.status === 'error') {
        const offline = await getOfflineCache('moodle:courses')
        if (offline?.data?.length) {
          setCourses(offline.data)
        } else {
          setCoursesError(result.error || 'Impossible de récupérer vos cours Moodle.')
          setCoursesServiceHref(result.serviceHref ?? null)
        }
      } else if (result.status === 'unauthenticated') {
        setCoursesError('Veuillez vous reconnecter pour accéder à Moodle.')
      }
    } catch (err) {
      const offline = await getOfflineCache('moodle:courses')
      if (offline?.data?.length) {
        setCourses(offline.data)
      } else {
        setCoursesError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setLoadingCourses(false)
    }
  }, [])

  const loadDeadlines = useCallback(async () => {
    try {
      const result = await getMoodleDeadlines()
      if (result.status === 'ok') {
        const items = result.items || []
        setDeadlines(items)
        void setOfflineCache('moodle:deadlines', items)
      }
    } catch {
      const offline = await getOfflineCache('moodle:deadlines')
      if (offline?.data?.length) {
        setDeadlines(offline.data)
      }
    }
  }, [])

  const openAssignmentModal = useCallback(async (assignInfo) => {
    setActiveAssignment(assignInfo)
    setAssignmentDetails(null)
    setStagedFiles([])
    setSubmissionOnlineText('')
    setAssignmentSuccessMsg(null)
    setAssignmentError(null)
    setLoadingAssignment(true)

    try {
      const res = await getMoodleAssignmentDetails(assignInfo.cmid, assignInfo.courseId)
      if (res.status === 'ok') {
        setAssignmentDetails(res.assignment)
      } else {
        setAssignmentError(res.error || 'Impossible de charger les détails du devoir.')
      }
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Erreur de connexion.')
    } finally {
      setLoadingAssignment(false)
    }
  }, [])

  const closeAssignmentModal = useCallback(() => {
    setActiveAssignment(null)
    setAssignmentDetails(null)
    setStagedFiles([])
    setAssignmentSuccessMsg(null)
    setAssignmentError(null)
  }, [])

  const handleStageFiles = useCallback((filesToStage) => {
    const list = Array.from(filesToStage || [])
    if (!list.length) return

    for (const file of list) {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = typeof reader.result === 'string' ? reader.result.split(',')[1] : ''
        setStagedFiles((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            base64,
          },
        ])
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const handleRemoveStagedFile = useCallback((index) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleRemoveSubmittedFile = useCallback(async (filename) => {
    if (!activeAssignment?.cmid) return
    try {
      const res = await removeMoodleAssignmentFile({
        cmid: activeAssignment.cmid,
        filename,
      })
      if (res.status === 'ok' && res.assignment) {
        setAssignmentDetails(res.assignment)
      }
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Erreur lors du retrait du fichier.')
    }
  }, [activeAssignment])

  const handleSubmitAssignment = useCallback(async (finalize = false) => {
    if (!activeAssignment?.cmid) return
    if (!stagedFiles.length && !submissionOnlineText.trim() && !finalize) return

    setSubmittingAssignment(true)
    setAssignmentError(null)
    setAssignmentSuccessMsg(null)

    try {
      const res = await submitMoodleAssignment({
        cmid: activeAssignment.cmid,
        files: stagedFiles,
        onlineText: submissionOnlineText,
        finalize,
      })

      if (res.status === 'ok' && res.assignment) {
        setAssignmentDetails(res.assignment)
        setStagedFiles([])
        setAssignmentSuccessMsg(res.message || 'Devoir téléversé avec succès sur Moodle !')
        void loadDeadlines()
      } else {
        setAssignmentError(res.error || 'Erreur lors de la soumission du devoir.')
      }
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Erreur de communication avec Moodle.')
    } finally {
      setSubmittingAssignment(false)
    }
  }, [activeAssignment, stagedFiles, submissionOnlineText, loadDeadlines])

  useEffect(() => {
    if (!activeAssignment) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeAssignmentModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeAssignment, closeAssignmentModal])

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const assignCmid = urlParams.get('assign') || urlParams.get('cmid')
    if (assignCmid) {
      const num = Number(assignCmid)
      if (num && Number.isFinite(num)) {
        void openAssignmentModal({ cmid: num, name: `Devoir ${num}` })
      }
    }
  }, [openAssignmentModal])

  useEffect(() => {
    void loadCourses()
    void loadDeadlines()
  }, [loadCourses, loadDeadlines])

  const loadCourseContents = useCallback(async (course) => {
    if (!course?.id) return
    setSelectedCourse(course)
    setSelectedFolder(null)
    setExpandedFolders({})
    setFolderSearchQuery('')
    setFolderError(null)
    setSearchQuery('')
    setModuleTypeFilter('all')
    setCollapsedSections({})

    // Save to recents
    setRecentCourseIds((prev) => {
      const next = [course.id, ...prev.filter((id) => id !== course.id)].slice(0, 5)
      try {
        localStorage.setItem(MOODLE_RECENT_COURSES_KEY, JSON.stringify(next))
      } catch {
        // Best effort: nothing to do when it fails.
      }
      return next
    })

    if (contentsCache[course.id]) {
      return
    }

    setLoadingContents(true)
    setContentsError(null)

    try {
      const result = await getMoodleCourseContents(course.id)
      if (result.status === 'ok') {
        setContentsCache((prev) => ({
          ...prev,
          [course.id]: result.sections || [],
        }))
      } else if (result.status === 'error') {
        setContentsError(result.error || 'Impossible de charger le contenu de ce cours.')
      }
    } catch (err) {
      setContentsError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingContents(false)
    }
  }, [contentsCache])

  const categories = useMemo(() => {
    const set = new Set()
    for (const c of courses) {
      if (c.category) set.add(c.category)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [courses])

  const filteredCourses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return courses.filter((course) => {
      const matchCat = categoryFilter === 'all' || course.category === categoryFilter
      if (!matchCat) return false
      if (!query) return true
      const full = (course.fullname || '').toLowerCase()
      const short = (course.shortname || '').toLowerCase()
      const cat = (course.category || '').toLowerCase()
      return full.includes(query) || short.includes(query) || cat.includes(query)
    })
  }, [courses, categoryFilter, searchQuery])

  const recentCourses = useMemo(() => {
    return recentCourseIds
      .map((id) => courses.find((c) => c.id === id))
      .filter(Boolean)
  }, [recentCourseIds, courses])

  const currentSections = useMemo(() => {
    if (!selectedCourse) return []
    return contentsCache[selectedCourse.id] || []
  }, [selectedCourse, contentsCache])

  // Show empty sections toggle (disabled by default)
  const [showEmptySections, setShowEmptySections] = useState(() => {
    try {
      return localStorage.getItem(MOODLE_SHOW_EMPTY_SECTIONS_KEY) === 'true'
    } catch {
      return false
    }
  })

  const handleToggleEmptySections = useCallback((val) => {
    setShowEmptySections((prev) => {
      const next = typeof val === 'boolean' ? val : !prev
      try {
        localStorage.setItem(MOODLE_SHOW_EMPTY_SECTIONS_KEY, String(next))
      } catch {
        // Best effort: nothing to do when it fails.
      }
      return next
    })
  }, [])

  const filteredSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return currentSections.map((section) => {
      const matchingModules = (section.modules || []).filter((mod) => {
        const kind = getModuleKind(mod.modname)
        if (moduleTypeFilter !== 'all') {
          if (moduleTypeFilter === 'files' && kind !== 'file' && kind !== 'folder') return false
          if (moduleTypeFilter === 'tasks' && kind !== 'assign' && kind !== 'quiz') return false
          if (moduleTypeFilter === 'forums' && kind !== 'forum' && kind !== 'link') return false
        }
        if (!query) return true
        const name = (mod.name || '').toLowerCase()
        const files = (mod.contents || []).map((f) => (f.filename || '').toLowerCase()).join(' ')
        return name.includes(query) || files.includes(query)
      })

      return {
        ...section,
        filteredModules: matchingModules,
      }
    }).filter((section) => {
      // By default (unless enabled in settings), hide sections with 0 matching modules
      if (!showEmptySections && section.filteredModules.length === 0) {
        return false
      }
      if (!query) return true
      const sectionNameMatches = (section.name || '').toLowerCase().includes(query)
      return sectionNameMatches || section.filteredModules.length > 0
    })
  }, [currentSections, moduleTypeFilter, searchQuery, showEmptySections])

  const totalCourseResources = useMemo(() => {
    return currentSections.reduce((acc, s) => acc + (s.modules?.length || 0), 0)
  }, [currentSections])

  const allSectionsCollapsed = useMemo(() => {
    if (filteredSections.length === 0) return false
    return filteredSections.every((s) => Boolean(collapsedSections[s.id]))
  }, [filteredSections, collapsedSections])

  const toggleAllSections = useCallback(() => {
    if (allSectionsCollapsed) {
      setCollapsedSections({})
    } else {
      const next = {}
      for (const s of filteredSections) {
        next[s.id] = true
      }
      setCollapsedSections(next)
    }
  }, [allSectionsCollapsed, filteredSections])

  const toggleSection = useCallback((sectionId) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }))
  }, [])

  const openFolder = useCallback(async (folder, sectionName) => {
    const folderData = {
      ...folder,
      sectionName: sectionName || folder.sectionName || '',
      courseName: selectedCourse?.fullname || '',
    }
    setSelectedFolder(folderData)
    setFolderSearchQuery('')
    setFolderError(null)

    if ((!folder.contents || folder.contents.length === 0) && !folderFilesCache[folder.id]) {
      setLoadingFolderFiles(true)
      try {
        const res = await getMoodleFolderContents(folder.id, selectedCourse?.id)
        if (res.status === 'ok') {
          setFolderFilesCache((prev) => ({
            ...prev,
            [folder.id]: res.files || [],
          }))
          if (res.downloadFolderProxyUrl) {
            setSelectedFolder((prev) => (prev ? { ...prev, downloadFolderProxyUrl: res.downloadFolderProxyUrl } : null))
          }
        } else if (res.status === 'error') {
          setFolderError(res.error || 'Impossible de charger les fichiers de ce dossier.')
        }
      } catch (err) {
        setFolderError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingFolderFiles(false)
      }
    }
  }, [selectedCourse, folderFilesCache])

  const toggleFolderExpanded = useCallback(async (folder) => {
    const nextExpanded = !expandedFolders[folder.id]
    setExpandedFolders((prev) => ({
      ...prev,
      [folder.id]: nextExpanded,
    }))

    if (nextExpanded && (!folder.contents || folder.contents.length === 0) && !folderFilesCache[folder.id]) {
      try {
        const res = await getMoodleFolderContents(folder.id, selectedCourse?.id)
        if (res.status === 'ok') {
          setFolderFilesCache((prev) => ({
            ...prev,
            [folder.id]: res.files || [],
          }))
        }
      } catch (err) {
        void err
      }
    }
  }, [expandedFolders, folderFilesCache, selectedCourse])

  const currentFolderFiles = useMemo(() => {
    if (!selectedFolder) return []
    if (selectedFolder.contents && selectedFolder.contents.length > 0) {
      return selectedFolder.contents
    }
    return folderFilesCache[selectedFolder.id] || []
  }, [selectedFolder, folderFilesCache])

  const filteredFolderFiles = useMemo(() => {
    const query = folderSearchQuery.trim().toLowerCase()
    if (!query) return currentFolderFiles
    return currentFolderFiles.filter((file) => {
      const filename = (file.filename || '').toLowerCase()
      const filepath = (file.filepath || '').toLowerCase()
      return filename.includes(query) || filepath.includes(query)
    })
  }, [currentFolderFiles, folderSearchQuery])

  const totalFolderBytes = useMemo(() => {
    return currentFolderFiles.reduce((acc, f) => acc + (f.filesize || 0), 0)
  }, [currentFolderFiles])

  const categoryOptions = useMemo(() => {
    if (categories.length === 0) return []
    const opts = [{ value: 'all', label: 'Tous', count: courses.length }]
    for (const cat of categories) {
      const count = courses.filter((c) => c.category === cat).length
      if (count === 0 && !showEmptySections) continue
      opts.push({
        value: cat,
        label: formatCategoryLabel(cat),
        count,
      })
    }
    return opts
  }, [categories, courses, showEmptySections])

  const effectiveMoodleHref = selectedFolder?.launchHref || selectedCourse?.moodleHref || moodleWebHref

  // The band's overview, like « Dernières notes » on Mes notes: what's due,
  // soonest first, as cards in a row (sideways on a phone). Overdue in red,
  // due today or tomorrow in the accent, handed in in green.
  const pendingDeadlines = deadlines.filter((item) => !item.submitted)
  const overdueCount = pendingDeadlines.filter((item) => item.overdue).length
  const deadlineOverview = deadlines.length ? (
    <div data-tour="moodle-overview" className="grid gap-3">
      <div className="flex items-center gap-[5px] text-brand">
        <Icon icon="carbon:delivery-parcel" className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
        <h2 className="m-0 font-body text-base font-medium leading-[1.06]">
          À rendre
          <span className="ml-1.5 text-text-muted">{pendingDeadlines.length}</span>
          {overdueCount ? <span className="ml-2 text-error">· {overdueCount} en retard</span> : null}
        </h2>
      </div>
      <ul className="m-0 flex list-none gap-3 overflow-x-auto p-0 -mx-6 -mt-2 -mb-7 px-6 pt-2 pb-7 snap-x scroll-px-6 max-md:-mx-3 max-md:gap-2 max-md:snap-x max-md:snap-mandatory max-md:scroll-px-3 max-md:px-3 max-md:pt-2 max-md:pb-7 favorites-scroll-hide">
        {deadlines.slice(0, 6).map((item) => {
          const due = formatRelativeDueDate(item.dueAt)
          const urgent = !item.submitted && (item.overdue || due.startsWith('Aujourd') || due.startsWith('Demain'))
          const canSubmit = item.type === 'assign'
          const open = canSubmit
            ? () => void openAssignmentModal({ cmid: item.cmid || item.id, name: item.title, courseName: item.courseName })
            : item.href ? () => window.open(item.href, '_blank', 'noopener,noreferrer') : null
          return (
            <li key={item.id} className="flex w-[260px] shrink-0 snap-start max-md:w-[78%]">
              <button
                type="button"
                onClick={open ?? undefined}
                disabled={!open}
                className="latest-grade-card widget-card widget-card-visible flex w-full min-w-0 flex-col gap-[6px] rounded-[22px] border border-white bg-widget-bg p-3 text-left text-text shadow-md cursor-pointer disabled:cursor-default max-md:rounded-[20px] dark:border-border"
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-body text-[13px] font-medium text-text-muted">{item.courseName}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 font-body text-[12px] font-semibold ${
                    item.submitted ? 'bg-success-bg text-success-text' : item.overdue ? 'bg-error-bg text-error' : urgent ? 'bg-accent-bg text-accent-text' : 'bg-muted-fill text-text-secondary'
                  }`}
                  >
                    {item.submitted ? 'Rendu' : due}
                  </span>
                </span>
                <span className="line-clamp-2 font-body text-[15px] font-semibold leading-snug text-text">{item.title}</span>
                {canSubmit && !item.submitted ? (
                  <span className="mt-auto inline-flex items-center gap-1 pt-1 font-body text-[13px] font-semibold text-text-secondary">
                    <Icon icon="carbon:upload" className="size-3.5" aria-hidden="true" />
                    Déposer dans Tafac
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  ) : null

  return (
    <AppPage
      titleId="moodle-page-title"
      title={selectedFolder ? selectedFolder.name : (selectedCourse ? (selectedCourse.shortname || 'Cours Moodle') : 'Moodle')}
      controls={(
        <span className="inline-flex flex-wrap items-center gap-x-2 font-body text-[15px] font-semibold leading-none text-text-secondary max-md:hidden">
          {selectedFolder
            ? `${selectedCourse?.shortname || selectedCourse?.fullname} · ${selectedFolder.sectionName || 'Dossier'}`
            : selectedCourse
              ? (selectedCourse.category || 'Ressources')
              : (courses.length ? `${courses.length} cours` : null)}
          {loadingCourses ? (
            <span className="scodoc-refreshing inline-flex items-center gap-1 text-[13px] font-medium text-text-muted" role="status">
              <Icon icon="carbon:renew" className="size-3.5 animate-spin" aria-hidden="true" />
              Actualisation…
            </span>
          ) : null}
        </span>
      )}
      actions={(
        <>
          <PageButton
            icon="carbon:renew"
            label="Actualiser les cours"
            onClick={() => void loadCourses()}
            disabled={loadingCourses}
            className={`${ICON_ONLY} ${loadingCourses ? '[&_svg]:animate-spin' : ''}`}
          />
          {effectiveMoodleHref ? <PageButton icon="carbon:arrow-up-right" label="Moodle" href={effectiveMoodleHref} /> : null}
          <PageButton
            icon="carbon:help"
            label="Visite guidée"
            onClick={() => {
              setSelectedFolder(null)
              setSelectedCourse(null)
              setTourTrigger((c) => c + 1)
            }}
            className={ICON_ONLY}
          />
        </>
      )}
      overview={!selectedCourse && (deadlineOverview || categoryOptions.length > 2) ? (
        <div className="grid gap-5 max-md:gap-4">
          {deadlineOverview}
          {categoryOptions.length > 2 ? (
            <div className="flex max-w-full items-center overflow-x-auto [scrollbar-width:none]">
              <SegmentedControl
                label="Catégories de cours"
                options={categoryOptions}
                value={categoryFilter}
                onChange={setCategoryFilter}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      bare={Boolean(selectedCourse)}
    >
      <div className="flex w-full min-w-0 flex-col gap-8 max-md:gap-6">
        {/* ── COURSE & FOLDER DETAIL VIEW ── */}
        {selectedCourse ? (
          selectedFolder ? (
            <Fragment key={selectedFolder.id}>
              {/* Folder presentation banner card */}
              <article style={revealStyle(0)} className={`${CARD_CLASSES} grades-reveal flex flex-col gap-5 p-6 max-md:p-4 shadow-sm`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFolder(null)
                      setFolderSearchQuery('')
                    }}
                    className={`${SECONDARY_BUTTON} self-start`}
                  >
                    <Icon icon="carbon:arrow-left" className="size-4" aria-hidden="true" />
                    <span>Retour à {selectedCourse.shortname || selectedCourse.fullname}</span>
                  </button>

                  <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                    {selectedFolder.downloadFolderProxyUrl && (
                      <a
                        href={selectedFolder.downloadFolderProxyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${SECONDARY_BUTTON} border-accent-border text-accent-text dark:text-accent-text hover:bg-accent-bg font-medium`}
                        title="Télécharger tous les fichiers du dossier en archive .zip"
                      >
                        <Icon icon="carbon:zip" className="size-4 text-accent-text" />
                        <span>Télécharger le dossier (.zip)</span>
                      </a>
                    )}

                    {selectedFolder.launchHref && (
                      <a
                        href={selectedFolder.launchHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={SECONDARY_BUTTON}
                        title="Consulter le dossier sur Moodle officiel"
                      >
                        <span>Moodle officiel</span>
                        <Icon icon="carbon:arrow-up-right" className="size-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Folder Header presentation */}
                <div className="flex items-start gap-4">
                  <div className="size-14 rounded-2xl flex items-center justify-center shrink-0 text-accent-text bg-accent-bg border border-accent-border shadow-sm">
                    <Icon icon="carbon:folder-open" className="size-8" />
                  </div>

                  <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-body text-[12px] font-bold px-2.5 py-0.5 rounded-full bg-accent-bg text-accent-text dark:text-accent-text uppercase tracking-wider border border-accent-border">
                        Dossier pédagogique
                      </span>
                      {selectedFolder.sectionName && (
                        <span className="font-body text-[13px] text-text-muted">
                          {selectedFolder.sectionName}
                        </span>
                      )}
                      {currentFolderFiles.length > 0 && (
                        <span className="font-body text-[13px] text-text-muted">
                          · {currentFolderFiles.length} fichier{currentFolderFiles.length > 1 ? 's' : ''}
                          {totalFolderBytes > 0 ? ` (${formatFileSize(totalFolderBytes)})` : ''}
                        </span>
                      )}
                    </div>

                    <h2 className="m-0 text-[26px] leading-snug max-md:text-[22px] font-bold text-text">
                      {selectedFolder.name}
                    </h2>

                    <div className="text-[13px] text-text-secondary flex items-center gap-1.5">
                      <Icon icon="carbon:education" className="size-4 text-text-muted shrink-0" />
                      <span className="truncate">{selectedCourse.fullname}</span>
                    </div>
                  </div>
                </div>

                {/* Search / filter within folder files */}
                {currentFolderFiles.length > 2 && (
                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
                    <div className="relative flex-1 max-w-sm">
                      <Icon
                        icon="carbon:search"
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-text-muted pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        value={folderSearchQuery}
                        onChange={(e) => setFolderSearchQuery(e.target.value)}
                        placeholder="Filtrer les fichiers de ce dossier…"
                        className="w-full h-9 pl-9 pr-8 rounded-full border border-border bg-widget-bg text-[14px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none transition-colors"
                      />
                      {folderSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setFolderSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text"
                          aria-label="Effacer le filtre"
                        >
                          <Icon icon="carbon:close" className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </article>

              {/* Folder file items list */}
              <div className="flex flex-col gap-4">
                {loadingFolderFiles ? (
                  <div className={`${CARD_CLASSES} p-8 flex flex-col items-center justify-center gap-3`}>
                    <LoadingDots label="Chargement des documents du dossier…" />
                  </div>
                ) : folderError ? (
                  <StatusMessage
                    icon="carbon:warning"
                    title="Erreur lors du chargement des fichiers"
                    detail={folderError}
                    action={(
                      <button
                        type="button"
                        className="rounded-full border-0 bg-brand px-4 py-2 font-body text-[14px] font-semibold text-bg hover:bg-brand-hover transition-colors"
                        onClick={() => void openFolder(selectedFolder, selectedFolder.sectionName)}
                      >
                        Réessayer
                      </button>
                    )}
                  />
                ) : filteredFolderFiles.length === 0 ? (
                  <StatusMessage
                    icon="carbon:folder-off"
                    title={folderSearchQuery ? 'Aucun document ne correspond à la recherche' : 'Ce dossier est vide'}
                    detail={folderSearchQuery ? 'Modifiez vos mots-clés pour retrouver un document.' : 'Aucun fichier n’a été publié dans ce dossier pour le moment.'}
                    action={selectedFolder.launchHref ? (
                      <a href={selectedFolder.launchHref} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
                        <span>Consulter sur Moodle</span>
                        <Icon icon="carbon:arrow-up-right" className="size-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                  />
                ) : (
                  <article className={`${CARD_CLASSES} overflow-hidden p-0 shadow-sm`}>
                    <div className="px-5 py-3.5 bg-bg-subtle/50 border-b border-border flex items-center justify-between">
                      <span className="font-body text-[13px] font-semibold text-text-secondary">
                        Contenu du dossier ({filteredFolderFiles.length} fichier{filteredFolderFiles.length > 1 ? 's' : ''})
                      </span>
                      {selectedFolder.downloadFolderProxyUrl && (
                        <a
                          href={selectedFolder.downloadFolderProxyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-body text-[12.5px] font-medium text-accent-text dark:text-accent-text hover:underline flex items-center gap-1"
                        >
                          <Icon icon="carbon:zip" className="size-3.5" />
                          <span>Tout télécharger</span>
                        </a>
                      )}
                    </div>

                    <ul className="m-0 p-0 list-none divide-y divide-border">
                      {filteredFolderFiles.map((file, fIdx) => {
                        const fileIcon = getModuleIcon('file', file.filename)
                        const downloadUrl = file.proxyUrl ? `${file.proxyUrl}&download=1` : null

                        return (
                          <li
                            key={file.fileurl || file.filename || fIdx}
                            className="flex items-center justify-between gap-3 px-5 py-3.5 text-text hover:bg-bg-subtle/60 transition-colors duration-150 group"
                          >
                            <div className="flex items-center gap-3.5 min-w-0 flex-1">
                              {file.proxyUrl ? (
                                <a
                                  href={file.proxyUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${fileIcon.color} transition-transform group-hover:scale-105`}
                                  title={`Ouvrir ${file.filename}`}
                                >
                                  <Icon icon={fileIcon.icon} className="size-5" />
                                </a>
                              ) : (
                                <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${fileIcon.color}`}>
                                  <Icon icon={fileIcon.icon} className="size-5" />
                                </div>
                              )}

                              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                {file.proxyUrl ? (
                                  <a
                                    href={file.proxyUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-body text-[14.5px] font-semibold leading-snug text-text group-hover:text-brand hover:underline transition-colors truncate block"
                                    title={`Ouvrir ${file.filename}`}
                                  >
                                    {file.filename}
                                  </a>
                                ) : (
                                  <span className="font-body text-[14.5px] font-semibold leading-snug text-text truncate">
                                    {file.filename}
                                  </span>
                                )}

                                <div className="flex items-center gap-2 font-body text-[12px] text-text-muted">
                                  {file.filepath && file.filepath !== '/' && (
                                    <>
                                      <span className="px-1.5 py-0.2 rounded bg-bg-subtle border border-border/50 text-[11px] font-mono">
                                        {file.filepath}
                                      </span>
                                      <span>·</span>
                                    </>
                                  )}
                                  {file.filesize > 0 && (
                                    <span>{formatFileSize(file.filesize)}</span>
                                  )}
                                  {file.timemodified > 0 && (
                                    <>
                                      <span>·</span>
                                      <span>{new Date(file.timemodified * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {file.proxyUrl && (
                                <a
                                  href={file.proxyUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`${SECONDARY_BUTTON} py-1.5 px-3 text-[12px] shadow-2xs hover:border-brand/40`}
                                  title={`Consulter ${file.filename}`}
                                >
                                  <Icon icon="carbon:view" className="size-3.5 text-brand" />
                                  <span className="font-medium">Ouvrir</span>
                                </a>
                              )}

                              {downloadUrl && (
                                <a
                                  href={downloadUrl}
                                  download={file.filename}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`${SECONDARY_BUTTON} py-1.5 px-3 text-[12px] shadow-2xs hover:border-brand/40`}
                                  title={`Télécharger ${file.filename}`}
                                >
                                  <Icon icon="carbon:download" className="size-3.5 text-text-muted hover:text-text" />
                                  <span className="max-xs:hidden font-medium">Télécharger</span>
                                </a>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </article>
                )}
              </div>
            </Fragment>
          ) : (
            <Fragment key={selectedCourse.id}>
              {/* Top course presentation banner card */}
              <article style={revealStyle(0)} className={`${CARD_CLASSES} grades-reveal flex flex-col gap-5 p-6 max-md:p-4 shadow-sm`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFolder(null)
                      setSelectedCourse(null)
                      setSearchQuery('')
                      setFolderSearchQuery('')
                    }}
                    className={`${SECONDARY_BUTTON} self-start`}
                  >
                    <Icon icon="carbon:arrow-left" className="size-4" aria-hidden="true" />
                    <span>Tous les cours</span>
                  </button>

                <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                  {selectedCourse.moodleHref && (
                    <a
                      href={selectedCourse.moodleHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={SECONDARY_BUTTON}
                    >
                      <span>Moodle officiel</span>
                      <Icon icon="carbon:arrow-up-right" className="size-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-body text-[12px] font-bold px-2.5 py-0.5 rounded-full bg-brand/15 text-brand uppercase tracking-wider">
                    {selectedCourse.shortname || 'COURS'}
                  </span>
                  {selectedCourse.category && (
                    <span className="font-body text-[13px] text-text-muted">
                      {selectedCourse.category}
                    </span>
                  )}
                  {totalCourseResources > 0 && (
                    <span className="font-body text-[13px] text-text-muted">
                      · {totalCourseResources} ressource{totalCourseResources > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                <h2 className="m-0 text-[24px] leading-snug max-md:text-[20px] font-bold text-text">
                  {selectedCourse.fullname}
                </h2>
              </div>

              {/* Search & Resource Filter within this course */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-border">
                <div className="relative flex-1 max-w-sm">
                  <Icon
                    icon="carbon:search"
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-text-muted pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filtrer dans ce cours…"
                    className="w-full h-9 pl-9 pr-8 rounded-full border border-border bg-widget-bg text-[14px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text"
                      aria-label="Effacer le filtre"
                    >
                      <Icon icon="carbon:close" className="size-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
                  <SegmentedControl
                    label="Filtrer les contenus"
                    value={moduleTypeFilter}
                    onChange={setModuleTypeFilter}
                    options={[
                      { value: 'all', label: 'Tout' },
                      { value: 'files', label: 'Documents' },
                      { value: 'tasks', label: 'Devoirs' },
                      { value: 'forums', label: 'Liens' },
                    ]}
                  />

                  {filteredSections.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAllSections}
                      className={`${SECONDARY_BUTTON} shrink-0 py-1.5 px-3 text-[13px]`}
                      title={allSectionsCollapsed ? 'Tout déplier' : 'Tout replier'}
                    >
                      <Icon icon={allSectionsCollapsed ? 'carbon:expand-all' : 'carbon:collapse-all'} className="size-4" />
                      <span className="max-xs:hidden">{allSectionsCollapsed ? 'Tout déplier' : 'Tout replier'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleToggleEmptySections()}
                    className={`${SECONDARY_BUTTON} shrink-0 py-1.5 px-3 text-[13px] ${
                      showEmptySections ? 'border-brand text-brand bg-brand/10' : ''
                    }`}
                    title={showEmptySections ? 'Sections vides affichées (clique pour masquer)' : 'Sections vides masquées par défaut (clique pour afficher)'}
                    aria-pressed={showEmptySections}
                  >
                    <Icon icon={showEmptySections ? 'carbon:view' : 'carbon:view-off'} className="size-4" />
                    <span className="max-xs:hidden">
                      {showEmptySections ? 'Sections vides visibles' : 'Masquer les vides'}
                    </span>
                  </button>
                </div>
              </div>
            </article>

            {/* Sections & Modules Section */}
            <div data-tour="moodle-resources" className="flex flex-col gap-4">
              {loadingContents ? (
                <div className={`${CARD_CLASSES} p-8 flex flex-col items-center justify-center gap-3`}>
                  <LoadingDots label="Chargement des documents du cours…" />
                </div>
              ) : contentsError ? (
                <StatusMessage
                  icon="carbon:warning"
                  title="Erreur lors du chargement des contenus"
                  detail={contentsError}
                  action={(
                    <button
                      type="button"
                      className="rounded-full border-0 bg-brand px-4 py-2 font-body text-[14px] font-semibold text-bg hover:bg-brand-hover transition-colors"
                      onClick={() => void loadCourseContents(selectedCourse)}
                    >
                      Réessayer
                    </button>
                  )}
                />
              ) : filteredSections.length === 0 ? (
                <StatusMessage
                  icon="carbon:document-blank"
                  title="Aucune ressource disponible"
                  detail="Cet espace de cours ne contient pas encore de document ou de devoir publié."
                  action={selectedCourse.moodleHref ? (
                    <a href={selectedCourse.moodleHref} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
                      <span>Ouvrir dans Moodle</span>
                      <Icon icon="carbon:arrow-up-right" className="size-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  {filteredSections.map((section, idx) => {
                    const isCollapsed = Boolean(collapsedSections[section.id])
                    const moduleCount = section.filteredModules.length

                    return (
                      <article
                        key={section.id}
                        style={revealStyle(idx + 1)}
                        className={`${CARD_CLASSES} grades-reveal flex flex-col overflow-hidden p-0 shadow-sm`}
                      >
                        {/* Section Accordion Header */}
                        <button
                          type="button"
                          onClick={() => toggleSection(section.id)}
                          className="flex w-full items-center justify-between gap-3 border-0 bg-transparent px-5 py-4 text-left text-text transition-colors duration-150 hover:bg-bg-subtle cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Icon
                              icon="carbon:chevron-right"
                              className={`size-4 shrink-0 text-text-muted transition-transform duration-200 ${
                                isCollapsed ? '' : 'rotate-90'
                              }`}
                              aria-hidden="true"
                            />
                            <h3 className="m-0 font-body text-[16px] font-semibold leading-snug text-text truncate">
                              {section.name}
                            </h3>
                          </div>

                          <span className="shrink-0 rounded-full bg-bg-subtle px-2.5 py-0.5 font-body text-[12px] font-semibold text-text-secondary border border-border/50">
                            {moduleCount} ressource{moduleCount > 1 ? 's' : ''}
                          </span>
                        </button>

                        {/* Section Summary Description if provided */}
                        {!isCollapsed && section.summary && (
                          <div
                            className="px-5 py-3 text-[13px] text-text-secondary bg-bg-subtle/30 border-t border-border prose prose-sm dark:prose-invert max-w-none"
                            dangerouslySetInnerHTML={{ __html: section.summary }}
                          />
                        )}

                        {/* Resource list inside section */}
                        {!isCollapsed && (
                          <ul className="m-0 p-0 list-none divide-y divide-border border-t border-border">
                            {moduleCount === 0 ? (
                              <li className="px-5 py-3.5 font-body text-[13px] text-text-muted italic">
                                Aucun élément dans cette section.
                              </li>
                            ) : (
                              section.filteredModules.map((mod) => {
                                const kind = getModuleKind(mod.modname)

                                if (kind === 'folder') {
                                  const isExpanded = Boolean(expandedFolders[mod.id])
                                  const files = (mod.contents && mod.contents.length > 0) ? mod.contents : (folderFilesCache[mod.id] || [])
                                  const fileCount = files.length
                                  const totalBytes = files.reduce((acc, f) => acc + (f.filesize || 0), 0)

                                  return (
                                    <li key={mod.id} className="flex flex-col border-b border-border/60 last:border-b-0">
                                      <div className="flex items-center justify-between gap-3 px-5 py-3.5 text-text hover:bg-bg-subtle/60 transition-colors duration-150 group">
                                        <div
                                          className="flex items-center gap-3.5 min-w-0 flex-1 cursor-pointer select-none"
                                          onClick={() => void openFolder(mod, section.name)}
                                          role="button"
                                          tabIndex={0}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault()
                                              void openFolder(mod, section.name)
                                            }
                                          }}
                                          title={`Entrer dans le dossier ${mod.name}`}
                                        >
                                          <div className="size-9 rounded-xl flex items-center justify-center shrink-0 text-accent-text bg-accent-bg border border-accent-border shadow-2xs group-hover:scale-105 group-hover:bg-accent-bg transition-transform">
                                            <Icon icon={isExpanded ? 'carbon:folder-open' : 'carbon:folder'} className="size-5" />
                                          </div>

                                          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                              <span className="font-body text-[14.5px] font-semibold leading-snug text-text group-hover:text-brand transition-colors truncate">
                                                {mod.name}
                                              </span>
                                              <span className="shrink-0 text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-accent-bg text-accent-text dark:text-accent-text border border-accent-border">
                                                Dossier
                                              </span>
                                            </div>

                                            <div className="flex items-center gap-2 font-body text-[12px] text-text-muted">
                                              <span>{fileCount > 0 ? `${fileCount} fichier${fileCount > 1 ? 's' : ''}` : 'Dossier'}</span>
                                              {totalBytes > 0 && (
                                                <>
                                                  <span>·</span>
                                                  <span>{formatFileSize(totalBytes)}</span>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                          <button
                                            type="button"
                                            onClick={() => void openFolder(mod, section.name)}
                                            className={`${SECONDARY_BUTTON} py-1.5 px-3 text-[12px] font-medium shadow-2xs hover:border-brand/40 text-brand bg-brand/5`}
                                            title={`Entrer dans ${mod.name}`}
                                          >
                                            <Icon icon="carbon:folder" className="size-3.5" />
                                            <span>Entrer</span>
                                            <Icon icon="carbon:arrow-right" className="size-3" />
                                          </button>

                                          {fileCount > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => void toggleFolderExpanded(mod)}
                                              className={`${SECONDARY_BUTTON} py-1.5 px-2.5 text-[12px] shadow-2xs`}
                                              title={isExpanded ? 'Replier l’aperçu' : 'Aperçu rapide des fichiers'}
                                              aria-expanded={isExpanded}
                                            >
                                              <Icon
                                                icon="carbon:chevron-down"
                                                className={`size-3.5 text-text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                              />
                                              <span className="max-xs:hidden text-[11px]">{isExpanded ? 'Replier' : 'Aperçu'}</span>
                                            </button>
                                          )}

                                          {mod.downloadFolderProxyUrl && (
                                            <a
                                              href={mod.downloadFolderProxyUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className={`${SECONDARY_BUTTON} py-1.5 px-3 text-[12px] shadow-2xs`}
                                              title={`Télécharger tout le dossier (${mod.name}.zip)`}
                                            >
                                              <Icon icon="carbon:zip" className="size-3.5 text-accent-text" />
                                              <span className="max-sm:hidden font-medium">.zip</span>
                                            </a>
                                          )}

                                          {mod.launchHref && (
                                            <a
                                              href={mod.launchHref}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="size-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-widget-bg transition-colors"
                                              title="Ouvrir dans l'interface Moodle"
                                            >
                                              <Icon icon="carbon:arrow-up-right" className="size-4" />
                                            </a>
                                          )}
                                        </div>
                                      </div>

                                      {isExpanded && (
                                        <div className="bg-bg-subtle/40 border-t border-border/70 pl-8 pr-5 py-2 flex flex-col gap-1.5">
                                          {files.length === 0 ? (
                                            <div className="py-2 text-[13px] text-text-muted italic">
                                              Ce dossier ne contient aucun fichier.
                                            </div>
                                          ) : (
                                            <ul className="m-0 p-0 list-none divide-y divide-border/40">
                                              {files.map((file, fIdx) => {
                                                const fIcon = getModuleIcon('file', file.filename)
                                                const fDownloadUrl = file.proxyUrl ? `${file.proxyUrl}&download=1` : null

                                                return (
                                                  <li key={file.fileurl || file.filename || fIdx} className="flex items-center justify-between gap-3 py-2 text-text">
                                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                      <div className={`size-7 rounded-lg flex items-center justify-center shrink-0 ${fIcon.color}`}>
                                                        <Icon icon={fIcon.icon} className="size-4" />
                                                      </div>
                                                      <div className="flex flex-col min-w-0 flex-1">
                                                        {file.proxyUrl ? (
                                                          <a
                                                            href={file.proxyUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="font-body text-[13.5px] font-medium text-text hover:text-brand hover:underline transition-colors truncate block"
                                                            title={`Ouvrir ${file.filename}`}
                                                          >
                                                            {file.filename}
                                                          </a>
                                                        ) : (
                                                          <span className="font-body text-[13.5px] font-medium text-text truncate">
                                                            {file.filename}
                                                          </span>
                                                        )}
                                                        {file.filesize > 0 && (
                                                          <span className="text-[11.5px] text-text-muted">
                                                            {formatFileSize(file.filesize)}
                                                          </span>
                                                        )}
                                                      </div>
                                                    </div>

                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                      {file.proxyUrl && (
                                                        <a
                                                          href={file.proxyUrl}
                                                          target="_blank"
                                                          rel="noopener noreferrer"
                                                          className={`${SECONDARY_BUTTON} py-1 px-2.5 text-[11px]`}
                                                          title={`Ouvrir ${file.filename}`}
                                                        >
                                                          <Icon icon="carbon:view" className="size-3 text-brand" />
                                                          <span>Ouvrir</span>
                                                        </a>
                                                      )}
                                                      {fDownloadUrl && (
                                                        <a
                                                          href={fDownloadUrl}
                                                          download={file.filename}
                                                          target="_blank"
                                                          rel="noopener noreferrer"
                                                          className={`${SECONDARY_BUTTON} py-1 px-2.5 text-[11px]`}
                                                          title={`Télécharger ${file.filename}`}
                                                        >
                                                          <Icon icon="carbon:download" className="size-3 text-text-muted" />
                                                        </a>
                                                      )}
                                                    </div>
                                                  </li>
                                                )
                                              })}
                                            </ul>
                                          )}

                                          <div className="pt-2 border-t border-border/40 flex items-center justify-end">
                                            <button
                                              type="button"
                                              onClick={() => void openFolder(mod, section.name)}
                                              className="font-body text-[12.5px] font-semibold text-brand hover:underline flex items-center gap-1"
                                            >
                                              <span>Accéder à la vue complète du dossier</span>
                                              <Icon icon="carbon:arrow-right" className="size-3" />
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </li>
                                  )
                                }

                                const isResource = mod.modname === 'resource' || (mod.url && mod.url.includes('/mod/resource/'))
                                const fallbackFile = isResource && mod.url ? {
                                  filename: mod.name?.includes('.') ? mod.name : `${mod.name}.pdf`,
                                  filesize: 0,
                                  proxyUrl: `/__ent_auth/moodle/file?url=${encodeURIComponent(mod.url.includes('redirect=1') ? mod.url : `${mod.url}${mod.url.includes('?') ? '&' : '?'}redirect=1`)}&name=${encodeURIComponent(mod.name?.includes('.') ? mod.name : `${mod.name}.pdf`)}`,
                                } : null
                                const primaryFile = mod.contents?.[0] || fallbackFile
                                const iconInfo = getModuleIcon(kind, primaryFile?.filename)
                                const isDownloadable = Boolean(primaryFile?.proxyUrl)
                                const openTargetUrl = primaryFile?.proxyUrl || mod.launchHref

                                return (
                                  <li
                                    key={mod.id}
                                    className="flex items-center justify-between gap-3 px-5 py-3.5 text-text hover:bg-bg-subtle/60 transition-colors duration-150 group"
                                  >
                                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                      {/* Document icon */}
                                      {openTargetUrl ? (
                                        <a
                                          href={openTargetUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`size-9 rounded-xl flex items-center justify-center shrink-0 ${iconInfo.color} transition-transform group-hover:scale-105`}
                                          title={`Ouvrir ${mod.name}`}
                                        >
                                          <Icon icon={iconInfo.icon} className="size-5" />
                                        </a>
                                      ) : (
                                        <div
                                          className={`size-9 rounded-xl flex items-center justify-center shrink-0 ${iconInfo.color}`}
                                        >
                                          <Icon icon={iconInfo.icon} className="size-5" />
                                        </div>
                                      )}

                                      {/* Document Title & Meta */}
                                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                        {kind === 'assign' ? (
                                          <button
                                            type="button"
                                            onClick={() => void openAssignmentModal({
                                              cmid: mod.id,
                                              name: mod.name,
                                              courseId: selectedCourse?.id,
                                              courseName: selectedCourse?.shortname || selectedCourse?.fullname,
                                            })}
                                            className="font-body text-[14.5px] font-semibold leading-snug text-text group-hover:text-brand hover:underline transition-colors truncate block text-left cursor-pointer"
                                            title={`Déposer ou consulter ${mod.name}`}
                                          >
                                            {mod.name}
                                          </button>
                                        ) : openTargetUrl ? (
                                          <a
                                            href={openTargetUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-body text-[14.5px] font-semibold leading-snug text-text group-hover:text-brand hover:underline transition-colors truncate block"
                                            title={`Ouvrir ${mod.name}`}
                                          >
                                            {mod.name}
                                          </a>
                                        ) : (
                                          <span className="font-body text-[14.5px] font-semibold leading-snug text-text truncate">
                                            {mod.name}
                                          </span>
                                        )}

                                        <div className="flex items-center gap-2 font-body text-[12px] text-text-muted">
                                          <span className="capitalize">{mod.modplural || kind}</span>
                                          {primaryFile?.filesize > 0 && (
                                            <>
                                              <span>·</span>
                                              <span>{formatFileSize(primaryFile.filesize)}</span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Action buttons */}
                                    <div className="flex items-center gap-2 shrink-0">
                                      {kind === 'assign' && (
                                        <button
                                          type="button"
                                          onClick={() => void openAssignmentModal({
                                            cmid: mod.id,
                                            name: mod.name,
                                            courseId: selectedCourse?.id,
                                            courseName: selectedCourse?.shortname || selectedCourse?.fullname,
                                          })}
                                          className={`${SECONDARY_BUTTON} py-1.5 px-3 text-[12px] bg-brand/10 text-brand border-brand/25 hover:bg-brand/15 hover:border-brand/40 shadow-2xs font-semibold flex items-center gap-1.5`}
                                          title="Déposer ou consulter ce devoir dans Tafac"
                                        >
                                          <Icon icon="carbon:upload" className="size-3.5 text-brand" />
                                          <span>Déposer</span>
                                        </button>
                                      )}

                                      {openTargetUrl && kind !== 'assign' && (
                                        <a
                                          href={openTargetUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`${SECONDARY_BUTTON} py-1.5 px-3 text-[12px] shadow-2xs hover:border-brand/40`}
                                          title={`Consulter ${mod.name} sans télécharger`}
                                        >
                                          <Icon icon="carbon:view" className="size-3.5 text-brand" />
                                          <span className="font-medium">Ouvrir</span>
                                        </a>
                                      )}

                                      {isDownloadable && (
                                        <a
                                          href={`${primaryFile.proxyUrl}&download=1`}
                                          download={primaryFile.filename}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`${SECONDARY_BUTTON} py-1.5 px-3 text-[12px] shadow-2xs hover:border-brand/40`}
                                          title={`Télécharger ${primaryFile.filename}`}
                                        >
                                          <Icon icon="carbon:download" className="size-3.5 text-text-muted hover:text-text" />
                                          <span className="max-xs:hidden font-medium">Télécharger</span>
                                        </a>
                                      )}

                                      {mod.launchHref && !isResource && (
                                        <a
                                          href={mod.launchHref}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="size-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-widget-bg transition-colors"
                                          title="Ouvrir dans l'interface Moodle"
                                        >
                                          <Icon icon="carbon:arrow-up-right" className="size-4" />
                                        </a>
                                      )}
                                    </div>
                                  </li>
                                )
                              })
                            )}
                          </ul>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          </Fragment>
          )
        ) : (
          /* ── COURSES LIST & DASHBOARD VIEW ── */
          <Fragment>
            {/* Recent courses: one tap back to a course opened lately. */}
            {recentCourses.length ? (
              <section className="grid gap-3" aria-labelledby="moodle-recent-title">
                <div className="flex items-center gap-[5px] text-brand">
                  <Icon icon="carbon:recently-viewed" className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
                  <h2 id="moodle-recent-title" className="m-0 font-body text-base font-medium leading-[1.06]">Ouverts récemment</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentCourses.slice(0, 4).map((course) => (
                    <button
                      key={course.id}
                      type="button"
                      onClick={() => void loadCourseContents(course)}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-white bg-widget-bg px-3.5 py-2 font-body text-[14px] font-semibold text-text shadow-[0_1px_3px_rgba(0,0,0,0.06)] cursor-pointer transition-colors hover:bg-row-hover dark:border-border"
                    >
                      <Icon icon="carbon:notebook" className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                      <span className="truncate">{course.shortname || course.fullname}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Courses Section with Search Bar, Layout Toggle and SectionTitle */}
            <section data-tour="moodle-courses" className="flex flex-col gap-4" aria-labelledby="moodle-courses-title">
              <SectionTitle
                id="moodle-courses-title"
                icon="carbon:notebook"
                count={courses.length}
                aside={(
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    {/* Search bar */}
                    <div className="relative flex-1 sm:w-60">
                      <Icon
                        icon="carbon:search"
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-text-muted pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Rechercher un cours…"
                        className="w-full h-9 pl-9 pr-8 rounded-full border border-border bg-widget-bg text-[14px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none transition-colors"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text"
                          aria-label="Effacer la recherche"
                        >
                          <Icon icon="carbon:close" className="size-3.5" />
                        </button>
                      )}
                    </div>

                    {/* View mode toggle (Cards vs List) */}
                    <div className="inline-flex rounded-full border border-border bg-widget-bg p-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLayoutChange('grid')}
                        className={`size-8 rounded-full flex items-center justify-center transition-colors ${
                          viewLayout === 'grid' ? 'bg-brand text-bg' : 'text-text-muted hover:text-text'
                        }`}
                        title="Affichage en cartes"
                        aria-label="Affichage en cartes"
                      >
                        <Icon icon="carbon:grid" className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLayoutChange('list')}
                        className={`size-8 rounded-full flex items-center justify-center transition-colors ${
                          viewLayout === 'list' ? 'bg-brand text-bg' : 'text-text-muted hover:text-text'
                        }`}
                        title="Affichage en liste"
                        aria-label="Affichage en liste"
                      >
                        <Icon icon="carbon:list" className="size-4" />
                      </button>
                    </div>
                  </div>
                )}
              >
                Mes cours
              </SectionTitle>

              {loadingCourses ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className={`${CARD_CLASSES} p-5 flex flex-col gap-3`}>
                      <div className={`h-3 w-16 rounded ${SHIMMER_CLASSES}`} />
                      <div className={`h-5 w-4/5 rounded ${SHIMMER_CLASSES}`} />
                      <div className={`h-3 w-1/2 rounded ${SHIMMER_CLASSES}`} />
                    </div>
                  ))}
                </div>
              ) : coursesError ? (
                <StatusMessage
                  icon="carbon:cloud-offline"
                  title="Impossible de charger tes cours"
                  detail={coursesError}
                  action={(
                    <div className="flex flex-wrap justify-center gap-2">
                      {coursesServiceHref ? (
                        <a
                          href={coursesServiceHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border-0 bg-brand px-4 py-2 font-body text-[14px] font-semibold text-bg no-underline hover:bg-brand-hover transition-colors"
                        >
                          Ouvrir Moodle
                          <Icon icon="carbon:arrow-up-right" className="size-4" aria-hidden="true" />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className={coursesServiceHref
                          ? 'rounded-full border border-border bg-widget-bg px-4 py-2 font-body text-[14px] font-semibold text-text hover:bg-bg-subtle transition-colors'
                          : 'rounded-full border-0 bg-brand px-4 py-2 font-body text-[14px] font-semibold text-bg hover:bg-brand-hover transition-colors'}
                        onClick={() => void loadCourses()}
                      >
                        Réessayer
                      </button>
                    </div>
                  )}
                />
              ) : filteredCourses.length === 0 ? (
                <StatusMessage
                  icon="carbon:document-blank"
                  title="Aucun cours trouvé"
                  detail={searchQuery ? `Aucun résultat pour « ${searchQuery} ».` : 'Tu n’as aucun espace de cours rattaché pour l’instant.'}
                />
              ) : viewLayout === 'grid' ? (
                /* ── CARDS GRID VIEW (Ergonomic & Visual like Dashboard) ── */
                <div style={revealStyle(1)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 grades-reveal">
                  {filteredCourses.map((course, index) => {
                    const hasDeadlines = deadlines.some(
                      (d) =>
                        (course.fullname && d.courseName && course.fullname.toLowerCase().includes(d.courseName.toLowerCase())) ||
                        (course.shortname && d.courseName && d.courseName.toLowerCase().includes(course.shortname.toLowerCase()))
                    )

                    return (
                      <button
                        key={course.id}
                        type="button"
                        data-tour={index === 0 ? 'moodle-resources' : undefined}
                        onClick={() => void loadCourseContents(course)}
                        className={`${CARD_CLASSES} p-5 text-left flex flex-col justify-between gap-4 cursor-pointer hover:border-brand/40 hover:shadow-md transition-all duration-200 group relative overflow-hidden`}
                      >
                        <div className="flex flex-col gap-2 min-w-0">
                          {/* Course Tag & Alerts */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-body text-[11.5px] font-bold px-2 py-0.5 rounded-full bg-brand/15 text-brand tracking-wide truncate max-w-[140px]">
                              {course.shortname || 'COURS'}
                            </span>

                            {hasDeadlines && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-error-bg px-2 py-0.5 text-[11px] font-semibold text-error dark:text-error shrink-0">
                                <span className="size-1.5 rounded-full bg-error" />
                                Devoir
                              </span>
                            )}
                          </div>

                          {/* Course Full Title */}
                          <h3 className="m-0 font-body text-[16px] font-semibold leading-snug text-text group-hover:text-brand transition-colors line-clamp-2">
                            {course.fullname}
                          </h3>
                        </div>

                        {/* Footer: Category & Chevron */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 text-text-muted text-[12px]">
                          <span className="truncate min-w-0 font-medium">
                            {course.category || 'Moodle'}
                          </span>

                          <div className="flex items-center gap-1.5 shrink-0 text-text-secondary group-hover:text-brand transition-colors font-medium">
                            <span className="text-[12px]">Accéder</span>
                            <Icon icon="carbon:chevron-right" className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                /* ── COMPACT LIST VIEW (Classic ScoDoc) ── */
                <ul style={revealStyle(1)} className={`${CARD_CLASSES} grades-reveal m-0 flex flex-col overflow-hidden p-0 list-none shadow-sm`}>
                  {filteredCourses.map((course, index) => {
                    const hasDeadlines = deadlines.some(
                      (d) =>
                        (course.fullname && d.courseName && course.fullname.toLowerCase().includes(d.courseName.toLowerCase())) ||
                        (course.shortname && d.courseName && d.courseName.toLowerCase().includes(course.shortname.toLowerCase()))
                    )

                    return (
                      <li key={course.id} className="border-b border-border last:border-b-0">
                        <button
                          type="button"
                          data-tour={index === 0 ? 'moodle-resources' : undefined}
                          onClick={() => void loadCourseContents(course)}
                          className="flex w-full items-center justify-between gap-4 border-0 bg-transparent px-5 py-4 max-md:px-4 max-md:py-3.5 text-left text-text transition-colors duration-150 hover:bg-bg-subtle cursor-pointer group"
                        >
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-body text-[12px] font-semibold text-text-muted">
                                {course.shortname || 'COURS'}
                              </span>
                              {hasDeadlines && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-error-bg px-2 py-0.5 text-[11px] font-semibold text-error dark:text-error">
                                  <span className="size-1.5 rounded-full bg-error" />
                                  Devoir à rendre
                                </span>
                              )}
                            </div>

                            <span className="font-body text-[16px] font-semibold text-text group-hover:text-brand transition-colors leading-snug line-clamp-1">
                              {course.fullname}
                            </span>

                            {course.category && (
                              <span className="font-body text-[13px] text-text-muted truncate">
                                {course.category}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            {course.hasprogress && typeof course.progress === 'number' && (
                              <span className="font-body text-[13px] font-bold text-text-secondary max-xs:hidden">
                                {course.progress}%
                              </span>
                            )}
                            <Icon
                              icon="carbon:chevron-right"
                              className="size-4 text-text-muted group-hover:text-text group-hover:translate-x-0.5 transition-all"
                              aria-hidden="true"
                            />
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </Fragment>
        )}

        {/* Footer info note */}
        <p className="m-0 font-body text-[12px] leading-relaxed text-text-muted">
          Espaces et documents synchronisés avec la plateforme Moodle officielle de ton université.
        </p>
      </div>

      {/* Assignment Submission Modal */}
      {activeAssignment && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="assignment-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAssignmentModal()
          }}
        >
          <div
            className="relative w-full max-w-2xl bg-widget-bg border border-border rounded-3xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* En-tête Modal */}
            <div className="flex items-start justify-between gap-4 p-5 sm:p-6 border-b border-border/60 bg-bg-subtle/30 shrink-0">
              <div className="flex items-start gap-3.5 min-w-0 flex-1">
                <div className="size-11 rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 border border-purple-500/20 shadow-xs">
                  <Icon icon="carbon:task" className="size-6" aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-body text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">
                      {activeAssignment.courseName || selectedCourse?.shortname || 'Moodle'}
                    </span>
                    {assignmentDetails?.status && (
                      <span
                        className={`font-body text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 border ${
                          assignmentDetails.status === 'submitted'
                            ? 'bg-success-bg text-success-text dark:text-success-text border-success-text/40'
                            : assignmentDetails.status === 'draft'
                            ? 'bg-accent-bg text-accent-text dark:text-accent-text border-accent-border'
                            : 'bg-muted-fill text-text-muted border-border'
                        }`}
                      >
                        <Icon
                          icon={
                            assignmentDetails.status === 'submitted'
                              ? 'carbon:checkmark-filled'
                              : assignmentDetails.status === 'draft'
                              ? 'carbon:time'
                              : 'carbon:circle-dash'
                          }
                          className="size-3"
                        />
                        <span>{assignmentDetails.statusLabel || 'Non remis'}</span>
                      </span>
                    )}
                  </div>
                  <h2 id="assignment-modal-title" className="m-0 font-title text-[20px] font-bold text-text leading-snug">
                    {assignmentDetails?.name || activeAssignment.name}
                  </h2>
                  {assignmentDetails?.dueDateFormatted && (
                    <p className="m-0 font-body text-[12.5px] text-text-muted flex items-center gap-1.5">
                      <Icon icon="carbon:calendar" className="size-3.5" />
                      <span>Date limite : <strong>{assignmentDetails.dueDateFormatted}</strong></span>
                      {assignmentDetails.timeRemaining && (
                        <span className="text-text-secondary">({assignmentDetails.timeRemaining})</span>
                      )}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {(assignmentDetails?.launchHref || activeAssignment.launchHref) && (
                  <a
                    href={assignmentDetails?.launchHref || activeAssignment.launchHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="size-9 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-subtle transition-colors"
                    title="Ouvrir ce devoir sur le Moodle universitaire"
                  >
                    <Icon icon="carbon:launch" className="size-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={closeAssignmentModal}
                  className="size-9 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-subtle transition-colors cursor-pointer"
                  title="Fermer"
                  aria-label="Fermer"
                >
                  <Icon icon="carbon:close" className="size-5" />
                </button>
              </div>
            </div>

            {/* Corps Modal */}
            <div className="p-5 sm:p-6 overflow-y-auto flex flex-col gap-5 flex-1 [scrollbar-width:thin]">
              {loadingAssignment ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-text-muted">
                  <LoadingDots text="Chargement des consignes et du statut Moodle…" />
                </div>
              ) : assignmentError ? (
                <div className="p-4 rounded-2xl bg-error-bg border border-error/40 text-error dark:text-error font-body text-[13.5px] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon icon="carbon:warning-filled" className="size-5 shrink-0" />
                    <span>{assignmentError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openAssignmentModal(activeAssignment)}
                    className="underline font-semibold cursor-pointer shrink-0"
                  >
                    Réessayer
                  </button>
                </div>
              ) : (
                <>
                  {/* Message de succès après téléversement */}
                  {assignmentSuccessMsg && (
                    <div className="p-4 rounded-2xl bg-success-bg border border-success-text/40 text-success-text dark:text-success-text font-body text-[13.5px] flex items-center gap-2.5 animate-in fade-in duration-200">
                      <Icon icon="carbon:checkmark-filled" className="size-5 text-success-text shrink-0" />
                      <span className="font-semibold">{assignmentSuccessMsg}</span>
                    </div>
                  )}

                  {/* Consignes du devoir */}
                  {assignmentDetails?.introHtml && (
                    <div className="flex flex-col gap-2">
                      <span className="font-body text-[12.5px] font-bold uppercase tracking-wider text-text-muted">
                        Consignes de l’enseignant
                      </span>
                      <div
                        className="p-4 rounded-2xl bg-bg-subtle/50 border border-border/70 font-body text-[13.5px] leading-relaxed text-text prose dark:prose-invert max-w-none overflow-x-auto"
                        dangerouslySetInnerHTML={{ __html: assignmentDetails.introHtml }}
                      />
                    </div>
                  )}

                  {/* Note et évaluation de l'enseignant si corrigé */}
                  {(assignmentDetails?.grade || assignmentDetails?.feedbackComments) && (
                    <div className="flex flex-col gap-2 p-4 rounded-2xl bg-success-bg border border-success-text/40 animate-fadeIn">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-body text-[12.5px] font-bold uppercase tracking-wider text-success-text dark:text-success-text flex items-center gap-1.5">
                          <Icon icon="carbon:certificate" className="size-4 text-success-text dark:text-success-text" />
                          Évaluation de l'enseignant
                        </span>
                        {assignmentDetails.grade && (
                          <span className="font-mono text-[14px] font-bold px-3 py-0.5 rounded-full bg-success-bg text-success-text dark:text-success-text">
                            {assignmentDetails.grade}
                          </span>
                        )}
                      </div>
                      {assignmentDetails.feedbackComments && (
                        <p className="m-0 font-body text-[13px] leading-relaxed text-text mt-1">
                          {assignmentDetails.feedbackComments}
                        </p>
                      )}
                      {assignmentDetails.gradedBy && (
                        <span className="font-body text-[11.5px] text-text-muted mt-0.5">
                          Corrigé par {assignmentDetails.gradedBy}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Fichiers déjà remis */}
                  {assignmentDetails?.submittedFiles && assignmentDetails.submittedFiles.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-body text-[12.5px] font-bold uppercase tracking-wider text-text-muted">
                          Fichiers déposés sur Moodle ({assignmentDetails.submittedFiles.length})
                        </span>
                        {assignmentDetails.lastModified && (
                          <span className="font-body text-[11.5px] text-text-muted">
                            Modifié le {assignmentDetails.lastModified}
                          </span>
                        )}
                      </div>

                      <ul className="m-0 p-0 list-none flex flex-col gap-2">
                        {assignmentDetails.submittedFiles.map((file, idx) => {
                          const fIcon = getModuleIcon('file', file.filename)
                          return (
                            <li
                              key={`${file.filename}-${idx}`}
                              className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-bg-subtle/60 border border-border/80"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${fIcon.color}`}>
                                  <Icon icon={fIcon.icon} className="size-4" />
                                </div>
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span className="font-body text-[13.5px] font-semibold text-text truncate" title={file.filename}>
                                    {file.filename}
                                  </span>
                                  {file.filesize > 0 && (
                                    <span className="font-body text-[11.5px] text-text-muted">
                                      {formatFileSize(file.filesize)}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {file.proxyUrl && (
                                  <a
                                    href={file.proxyUrl}
                                    download={file.filename}
                                    className="size-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-widget-bg border border-border/60 transition-colors"
                                    title={`Télécharger ${file.filename}`}
                                  >
                                    <Icon icon="carbon:download" className="size-4" />
                                  </a>
                                )}
                                {assignmentDetails.canRemove && (
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveSubmittedFile(file.filename)}
                                    className="size-8 rounded-lg flex items-center justify-center text-error hover:text-error hover:bg-error-bg border border-error/40 transition-colors cursor-pointer"
                                    title="Retirer ce fichier"
                                  >
                                    <Icon icon="carbon:trash-can" className="size-4" />
                                  </button>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Zone de Dépôt / Téléversement */}
                  {assignmentDetails?.canSubmit ? (
                    <div className="flex flex-col gap-3">
                      <span className="font-body text-[12.5px] font-bold uppercase tracking-wider text-text-muted">
                        Téléverser un nouveau rendu
                      </span>

                      {/* Drag and Drop Zone */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setIsDragOver(true)
                        }}
                        onDragLeave={() => setIsDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault()
                          setIsDragOver(false)
                          if (e.dataTransfer.files?.length) {
                            handleStageFiles(e.dataTransfer.files)
                          }
                        }}
                        className={`relative border-2 border-dashed rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center gap-2.5 text-center transition-all cursor-pointer ${
                          isDragOver
                            ? 'border-brand bg-brand/10 scale-[1.01]'
                            : 'border-border/80 hover:border-brand/50 hover:bg-bg-subtle/40'
                        }`}
                        onClick={() => document.getElementById('assignment-file-input')?.click()}
                      >
                        <input
                          id="assignment-file-input"
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files?.length) {
                              handleStageFiles(e.target.files)
                              e.target.value = ''
                            }
                          }}
                        />
                        <div className="size-12 rounded-2xl bg-brand/10 text-brand flex items-center justify-center shadow-xs">
                          <Icon icon="carbon:cloud-upload" className="size-6" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <p className="m-0 font-body text-[14.5px] font-semibold text-text">
                            Glissez et déposez votre fichier ici
                          </p>
                          <p className="m-0 font-body text-[12.5px] text-text-muted">
                            ou <span className="text-brand font-medium underline">parcourez vos documents</span> (ex: <code>rendu.md</code>, zip, pdf...)
                          </p>
                        </div>
                        {assignmentDetails.acceptedTypes && assignmentDetails.acceptedTypes.length > 0 && (
                          <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2">
                            {assignmentDetails.acceptedTypes.slice(0, 7).map((t) => (
                              <span key={t} className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-bg-subtle border border-border/60 text-text-muted">
                                {t}
                              </span>
                            ))}
                            <span className="font-body text-[11px] text-text-muted ml-1">
                              (max {assignmentDetails.maxFileSizeFormatted || '50 Mo'})
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Staged files ready to be uploaded */}
                      {stagedFiles.length > 0 && (
                        <div className="flex flex-col gap-2 mt-1">
                          <span className="font-body text-[12px] font-semibold text-text">
                            Fichiers prêts à être envoyés ({stagedFiles.length}) :
                          </span>
                          <ul className="m-0 p-0 list-none flex flex-col gap-2">
                            {stagedFiles.map((staged, i) => {
                              const fIcon = getModuleIcon('file', staged.name)
                              return (
                                <li
                                  key={`${staged.name}-${i}`}
                                  className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-brand/5 border border-brand/20 animate-in fade-in duration-150"
                                >
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${fIcon.color}`}>
                                      <Icon icon={fIcon.icon} className="size-4" />
                                    </div>
                                    <div className="flex flex-col min-w-0 flex-1">
                                      <span className="font-body text-[13.5px] font-semibold text-text truncate" title={staged.name}>
                                        {staged.name}
                                      </span>
                                      <span className="font-body text-[11.5px] text-text-muted">
                                        {formatFileSize(staged.size)}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveStagedFile(i)}
                                    className="size-7 rounded-full flex items-center justify-center text-text-muted hover:text-error hover:bg-error-bg transition-colors cursor-pointer"
                                    title="Retirer de la liste"
                                  >
                                    <Icon icon="carbon:close" className="size-4" />
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Online text comment */}
                      <div className="flex flex-col gap-1.5 mt-1">
                        <label htmlFor="assignment-comment" className="font-body text-[12px] font-medium text-text-muted">
                          Commentaire ou texte d’accompagnement (optionnel) :
                        </label>
                        <textarea
                          id="assignment-comment"
                          rows={2}
                          value={submissionOnlineText}
                          onChange={(e) => setSubmissionOnlineText(e.target.value)}
                          placeholder="Remarques pour l'enseignant..."
                          className="w-full rounded-2xl bg-bg-subtle/50 border border-border p-3 text-[13px] font-body text-text placeholder:text-text-muted focus:outline-none focus:border-brand transition-colors resize-none"
                        />
                      </div>

                      {/* Submit action button */}
                      <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/60 mt-1">
                        <button
                          type="button"
                          onClick={closeAssignmentModal}
                          disabled={submittingAssignment}
                          className={SECONDARY_BUTTON}
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSubmitAssignment(false)}
                          disabled={submittingAssignment || (!stagedFiles.length && !submissionOnlineText.trim())}
                          className="cursor-pointer font-body text-[13.5px] font-bold px-5 py-2.5 rounded-2xl bg-brand text-bg shadow-md hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {submittingAssignment ? (
                            <>
                              <Icon icon="carbon:renew" className="size-4 animate-spin" />
                              <span>Téléversement vers Moodle…</span>
                            </>
                          ) : (
                            <>
                              <Icon icon="carbon:send-alt" className="size-4" />
                              <span>Téléverser mon devoir sur Moodle</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl bg-bg-subtle border border-border text-text-muted font-body text-[13px] flex items-center gap-2">
                      <Icon icon="carbon:locked" className="size-4 shrink-0" />
                      <span>Les dépôts sont actuellement fermés ou verrouillés pour ce devoir sur Moodle.</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Guided Tour Modal */}
      <PageGuidedTour
        storageKey="l-ent:tour:moodle"
        steps={MOODLE_TOUR_STEPS}
        manualTrigger={tourTrigger}
      />
    </AppPage>
  )
}
