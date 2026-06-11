import { useParams, useNavigate } from "react-router"
import { trpc } from "@/providers/trpc"
import { useToast } from "@/providers/toast"
import { useState, useEffect, useRef } from "react"
import type React from "react"
import NavBar from "@/components/NavBar"
import { AiProgressBar } from "@/components/AiProgressBar"
import {
  ChevronLeft, ChevronRight, List, Languages, Type, ArrowLeft,
  Play, Download, Bookmark, BookmarkPlus, X, Loader2, Settings, Save,
  Highlighter, PenLine, Database, Upload
} from "lucide-react"

export default function Reader() {
  const { novelId } = useParams<{ novelId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const id = parseInt(novelId || "0")
  const [currentChapterId, setCurrentChapterId] = useState<number | null>(null)
  const [bilingualMode, setBilingualMode] = useState<"original" | "translated" | "bilingual">("translated")
  const [hoveredParagraph, setHoveredParagraph] = useState<number | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [fontSize, setFontSize] = useState(18)
  const [theme, setTheme] = useState<"light" | "sepia" | "dark" | "oled">("dark")
  const [fontFamily, setFontFamily] = useState<"serif" | "sans" | "mono">("serif")
  const [lineHeight, setLineHeight] = useState(1.8)
  const [paragraphSpacing, setParagraphSpacing] = useState(1.5)
  const [marginSize, setMarginSize] = useState(24)
  const [layoutMode, setLayoutMode] = useState<"continuous" | "paginated">("continuous")
  const [currentPage, setCurrentPage] = useState(1)
  const [showSettings, setShowSettings] = useState(false)
  const [jumpInput, setJumpInput] = useState("")
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [editingChapter, setEditingChapter] = useState(false)
  const [editContent, setEditContent] = useState("")
  const [bookmarkNote, setBookmarkNote] = useState("")
  const [showBookmarkForm, setShowBookmarkForm] = useState(false)

  // Annotations / Highlights
  const [showAnnotations, setShowAnnotations] = useState(false)
  const [selectedText, setSelectedText] = useState("")
  const [selectedParagraphIndex, setSelectedParagraphIndex] = useState<number | null>(null)
  const [annotationNote, setAnnotationNote] = useState("")
  const [annotationColor, setAnnotationColor] = useState("yellow")
  const [showAnnotationForm, setShowAnnotationForm] = useState(false)

  // 段落对齐检测
  const [paragraphMismatch, setParagraphMismatch] = useState<{
    original: number
    translated: number
    diffPercent: number
  } | null>(null)

  // 逐章翻译进度
  const [translateProgress, setTranslateProgress] = useState<{
    current: number
    total: number
    chapterTitle: string
    isTranslating: boolean
  } | null>(null)

  // 回到顶部按钮
  const [showBackToTop, setShowBackToTop] = useState(false)

  // 翻译设置
  const [translateStyle, setTranslateStyle] = useState<"literal" | "fluent" | "literary">("fluent")
  const [translatePrompt, setTranslatePrompt] = useState("")
  const [translateRagCalls, setTranslateRagCalls] = useState<Array<{ type: string; content: string; score?: number; sourceType?: string }> | null>(null)
  const [showRagPanel, setShowRagPanel] = useState(false)
  const [ragTopK, setRagTopK] = useState(3)
  const [ragLimit, setRagLimit] = useState(2)

  const { data: chapterList } = trpc.chapter.list.useQuery({ novelId: id })
  const { data: currentChapter } = trpc.chapter.getById.useQuery(
    { id: currentChapterId || 0 },
    { enabled: !!currentChapterId }
  )
  const { data: novel } = trpc.novel.getById.useQuery({ id })
  const { data: bookmarks } = trpc.chapter.bookmark.list.useQuery({ novelId: id })
  const { data: savedProgress } = trpc.readingProgress.get.useQuery(
    { novelId: id },
    { enabled: id > 0 }
  )
  const utils = trpc.useUtils()

  const saveProgressMutation = trpc.readingProgress.save.useMutation()
  const updateNovelStatusMutation = trpc.novel.update.useMutation({
    onSuccess: () => utils.novel.list.invalidate(),
  })

  const updateChapterMutation = trpc.chapter.update.useMutation({
    onSuccess: () => {
      utils.chapter.getById.invalidate({ id: currentChapterId || 0 })
      setEditingChapter(false)
    },
  })
  const createBookmarkMutation = trpc.chapter.bookmark.create.useMutation({
    onSuccess: () => utils.chapter.bookmark.list.invalidate({ novelId: id }),
  })
  const deleteBookmarkMutation = trpc.chapter.bookmark.delete.useMutation({
    onSuccess: () => utils.chapter.bookmark.list.invalidate({ novelId: id }),
  })
  const translateChapterMutation = trpc.translate.chapter.useMutation({
    onSuccess: () => {
      // 每章翻译完成后立即刷新相关查询，确保 UI 及时更新
      utils.chapter.list.refetch({ novelId: id })
      utils.novel.getById.refetch({ id })
      if (currentChapterId) {
        utils.chapter.getById.refetch({ id: currentChapterId })
      }
    },
  })
  const indexMutation = trpc.rag.indexNovel.useMutation()
  const importToMaterialMutation = trpc.novel.importToMaterial.useMutation({
    onSuccess: () => {
      utils.material.list.invalidate()
      toast.success("已导入素材库")
    },
    onError: (err) => toast.error("导入失败：" + err.message),
  })
  const updateNovelMutation = trpc.novel.update.useMutation({
    onSuccess: () => {
      utils.novel.getById.invalidate({ id })
      utils.novel.list.invalidate()
    },
  })
  const trpcUtils = trpc.useUtils()

  // Reader 页面操作菜单
  const [showActionMenu, setShowActionMenu] = useState(false)
  const [bindSeriesModal, setBindSeriesModal] = useState(false)
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null)
  const { data: seriesList } = trpc.lore.series.list.useQuery()

  // Annotations
  const { data: annotationList } = trpc.annotation.list.useQuery(
    { chapterId: currentChapterId || 0 },
    { enabled: !!currentChapterId }
  )
  const createAnnotationMutation = trpc.annotation.create.useMutation({
    onSuccess: () => {
      utils.annotation.list.invalidate({ chapterId: currentChapterId || 0 })
      setShowAnnotationForm(false)
      setSelectedText("")
      setSelectedParagraphIndex(null)
      setAnnotationNote("")
    },
  })
  const deleteAnnotationMutation = trpc.annotation.delete.useMutation({
    onSuccess: () => utils.annotation.list.invalidate({ chapterId: currentChapterId || 0 }),
  })

  // 从阅读进度恢复章节（或默认第一章）
  useEffect(() => {
    if (chapterList && chapterList.length > 0 && !currentChapterId) {
      if (savedProgress) {
        const chapterExists = chapterList.some(ch => ch.id === savedProgress.chapterId)
        setCurrentChapterId(chapterExists ? savedProgress.chapterId : chapterList[0].id)
      } else {
        setCurrentChapterId(chapterList[0].id)
      }
    }
  }, [chapterList, currentChapterId, savedProgress])

  // 自动切换阅读模式：无翻译时默认显示原文
  useEffect(() => {
    if (chapterList && chapterList.length > 0 && !chapterList.some(ch => ch.contentTranslated)) {
      setBilingualMode("original")
    }
  }, [chapterList])

  // 检测段落对齐：双语模式下译文段落数与原文差异 >20% 时警告
  useEffect(() => {
    const orig = currentChapter?.contentOriginal
    const trans = currentChapter?.contentTranslated
    if (bilingualMode === "bilingual" && orig && trans) {
      const countOriginal = orig.split(/\n\s*\n/).filter(p => p.trim().length > 0).length
      const countTranslated = trans.split(/\n\s*\n/).filter(p => p.trim().length > 0).length
      const diff = Math.abs(countOriginal - countTranslated)
      const diffPercent = countOriginal > 0 ? diff / countOriginal : 0
      if (diffPercent > 0.2) {
        setParagraphMismatch({ original: countOriginal, translated: countTranslated, diffPercent: Math.round(diffPercent * 100) })
      } else {
        setParagraphMismatch(null)
      }
    } else {
      setParagraphMismatch(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bilingualMode, currentChapter?.contentOriginal, currentChapter?.contentTranslated])

  useEffect(() => {
    if (currentChapter?.contentTranslated) {
      setEditContent(currentChapter.contentTranslated)
    }
  }, [currentChapter?.contentTranslated])

  // 滚动监听：显示/隐藏回到顶部按钮 + 自动保存阅读进度
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 500)
    }
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // 用 ref 存储 saveProgressMutation.mutate，避免 useEffect 依赖循环
  const saveProgressRef = useRef(saveProgressMutation.mutate)
  saveProgressRef.current = saveProgressMutation.mutate

  // 自动保存阅读进度（2秒防抖）
  useEffect(() => {
    if (!currentChapterId || !chapterList) return

    let debounceTimer: ReturnType<typeof setTimeout>

    const handleScrollForSave = () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const idx = chapterList.findIndex(ch => ch.id === currentChapterId)
        saveProgressRef.current({
          novelId: id,
          chapterId: currentChapterId,
          chapterNumber: idx + 1,
          chapterTitle: currentChapter?.title || undefined,
          totalChapters: chapterList.length,
          scrollPosition: window.scrollY,
        })
      }, 2000)
    }

    window.addEventListener("scroll", handleScrollForSave, { passive: true })
    return () => {
      window.removeEventListener("scroll", handleScrollForSave)
      clearTimeout(debounceTimer)
      // 离开/卸载时立即 flush（通过 ref 避免依赖循环）
      if (currentChapterId) {
        const idx = chapterList.findIndex(ch => ch.id === currentChapterId)
        saveProgressRef.current({
          novelId: id,
          chapterId: currentChapterId,
          chapterNumber: idx + 1,
          chapterTitle: currentChapter?.title || undefined,
          totalChapters: chapterList.length,
          scrollPosition: window.scrollY,
        })
      }
    }
    // 注意：saveProgressMutation 不放入依赖，通过 ref 访问
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapterId, id, chapterList, currentChapter?.title])

  // 章节切换时从阅读进度恢复滚动位置，并重置分页
  useEffect(() => {
    if (!currentChapterId) return

    setCurrentPage(1)
    const savedScroll = savedProgress?.chapterId === currentChapterId
      ? savedProgress.scrollPosition
      : 0

    requestAnimationFrame(() => {
      window.scrollTo({ top: layoutMode === "paginated" ? 0 : savedScroll, behavior: "instant" })
    })

    // 首次打开小说时，若状态为 unread 则标记为 reading
    if (novel?.status === "unread") {
      updateNovelStatusMutation.mutate({ id, status: "reading" })
    }
    // 注意：layoutMode 不放在依赖数组中，避免切换布局模式时反复重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapterId, id, savedProgress, novel?.status])

  const currentIndex = chapterList?.findIndex(ch => ch.id === currentChapterId) ?? -1
  const totalChapters = chapterList?.length ?? 0
  const progressPercent = totalChapters > 0 ? ((currentIndex + 1) / totalChapters) * 100 : 0

  const cycleBilingualMode = () => {
    setBilingualMode(prev =>
      prev === "original" ? "translated" : prev === "translated" ? "bilingual" : "original"
    )
  }

  // 分页：按段落边界将文本切分为多个页面（目标每页约 3000 字符）
  const paginateContent = (text: string, targetCharsPerPage = 3000): string[] => {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
    if (paragraphs.length === 0) return [""]
    const pages: string[] = []
    let currentPage = ""
    for (const para of paragraphs) {
      if (currentPage.length + para.length > targetCharsPerPage && currentPage.length > targetCharsPerPage * 0.3) {
        pages.push(currentPage.trim())
        currentPage = para
      } else {
        currentPage += (currentPage ? "\n\n" : "") + para
      }
    }
    if (currentPage.trim().length > 0) {
      pages.push(currentPage.trim())
    }
    return pages.length > 0 ? pages : [text]
  }

  // 用 ref 存储分页回调，避免 useEffect 依赖循环
  const handlePrevPageRef = useRef(() => {
    setCurrentPage(prev => Math.max(1, prev - 1))
    window.scrollTo({ top: 0, behavior: "instant" })
  })

  const handleNextPageRef = useRef(() => {
    const content = bilingualMode === "original"
      ? currentChapter?.contentOriginal || ""
      : currentChapter?.contentTranslated || currentChapter?.contentOriginal || ""
    const totalPages = paginateContent(content).length
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1)
      window.scrollTo({ top: 0, behavior: "instant" })
    } else if (chapterList && currentIndex < chapterList.length - 1) {
      setCurrentChapterId(chapterList[currentIndex + 1].id)
    }
  })

  // 保持 ref 中存储最新回调
  handlePrevPageRef.current = () => {
    setCurrentPage(prev => Math.max(1, prev - 1))
    window.scrollTo({ top: 0, behavior: "instant" })
  }

  handleNextPageRef.current = () => {
    const content = bilingualMode === "original"
      ? currentChapter?.contentOriginal || ""
      : currentChapter?.contentTranslated || currentChapter?.contentOriginal || ""
    const totalPages = paginateContent(content).length
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1)
      window.scrollTo({ top: 0, behavior: "instant" })
    } else if (chapterList && currentIndex < chapterList.length - 1) {
      setCurrentChapterId(chapterList[currentIndex + 1].id)
    }
  }

  // 键盘翻页 — 仅依赖 layoutMode，回调通过 ref 访问
  useEffect(() => {
    if (layoutMode !== "paginated") return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault()
        handleNextPageRef.current()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        handlePrevPageRef.current()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [layoutMode])

  const handlePrevPage = () => handlePrevPageRef.current()
  const handleNextPage = () => handleNextPageRef.current()

  const handleJump = () => {
    const num = parseInt(jumpInput, 10)
    if (chapterList && num >= 1 && num <= chapterList.length) {
      setCurrentChapterId(chapterList[num - 1].id)
      setJumpInput("")
    }
  }

  const handleExport = async () => {
    const result = await trpcUtils.translate.export.fetch({ novelId: id, format: "pure" })
    const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${novel?.title || "novel"}_纯中文.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveEdit = () => {
    if (!currentChapterId) return
    updateChapterMutation.mutate({ id: currentChapterId, contentTranslated: editContent })
  }

  // 逐章翻译
  const handleTranslate = async () => {
    if (!chapterList || chapterList.length === 0) {
      toast.error("该小说暂无章节内容")
      return
    }

    setTranslateProgress({ current: 0, total: chapterList.length, chapterTitle: "", isTranslating: true })
    const allRagCalls: typeof translateRagCalls = []

    try {
      for (let i = 0; i < chapterList.length; i++) {
        const ch = chapterList[i]
        setTranslateProgress({
          current: i,
          total: chapterList.length,
          chapterTitle: ch.title || `第${ch.chapterNumber}章`,
          isTranslating: true,
        })

        const result = await translateChapterMutation.mutateAsync({
          novelId: id,
          chapterId: ch.id,
          style: translateStyle,
          userPrompt: translatePrompt.trim() || undefined,
          ragTopK,
          ragLimit,
        })

        if (result.ragCalls && result.ragCalls.length > 0) {
          allRagCalls?.push(...result.ragCalls)
        }
      }

      await utils.chapter.list.invalidate({ novelId: id })
      await utils.novel.getById.invalidate({ id })
      if (currentChapterId) {
        await utils.chapter.getById.invalidate({ id: currentChapterId })
      }

      // 标记小说为已翻译
      await updateNovelMutation.mutateAsync({ id, status: "translated" })
      // 显式刷新小说列表，确保 NovelManager 中状态同步
      await utils.novel.list.invalidate()

      setTranslateProgress({ current: chapterList.length, total: chapterList.length, chapterTitle: "", isTranslating: false })
      toast.success(`翻译完成，共 ${chapterList.length} 章`)

      // 显示 RAG 报告
      if (allRagCalls && allRagCalls.length > 0) {
        const seen = new Set<string>()
        const deduped = allRagCalls.filter(c => {
          const key = c.type + "|" + c.content.slice(0, 80)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        setTranslateRagCalls(deduped)
        setShowRagPanel(true)
      }
    } catch (err) {
      toast.error("翻译中断: " + String(err))
      setTranslateProgress(prev => prev ? { ...prev, isTranslating: false } : null)
    }
  }

  // Text selection handler for annotations
  const handleTextSelection = (paragraphIndex: number) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      setShowAnnotationForm(false)
      return
    }
    const text = selection.toString().trim()
    if (text.length < 1) {
      setShowAnnotationForm(false)
      return
    }
    setSelectedText(text)
    setSelectedParagraphIndex(paragraphIndex)
    setShowAnnotationForm(true)
  }

  const handleCreateAnnotation = () => {
    if (!currentChapterId || selectedParagraphIndex === null || !selectedText) return
    createAnnotationMutation.mutate({
      novelId: id,
      chapterId: currentChapterId,
      paragraphIndex: selectedParagraphIndex,
      startOffset: 0,
      endOffset: selectedText.length,
      selectedText,
      note: annotationNote.trim() || undefined,
      color: annotationColor as "yellow" | "green" | "blue" | "pink" | "purple",
    })
  }

  const handleAddBookmark = () => {
    if (!currentChapterId) return
    createBookmarkMutation.mutate({
      novelId: id,
      chapterId: currentChapterId,
      note: bookmarkNote.trim() || undefined,
    })
    setBookmarkNote("")
    setShowBookmarkForm(false)
  }

  const isBookmarked = bookmarks?.some(bm => bm.chapterId === currentChapterId)

  const themeConfig = {
    light: {
      bg: "bg-white",
      text: "text-gray-900",
      subText: "text-gray-500",
      border: "border-gray-200",
      cardBg: "bg-gray-50",
      hoverBg: "hover:bg-gray-100",
      activeBg: "bg-amber-100 text-amber-700",
      divider: "border-gray-200",
      label: "text-amber-600/80",
      inputBg: "bg-gray-50",
      stickyBg: "bg-white/90",
    },
    sepia: {
      bg: "bg-[#F5E6C8]",
      text: "text-[#433422]",
      subText: "text-[#8B7355]",
      border: "border-[#D4C4A8]",
      cardBg: "bg-[#EDE0C0]",
      hoverBg: "hover:bg-[#E5D5B0]",
      activeBg: "bg-amber-200/50 text-amber-800",
      divider: "border-[#D4C4A8]",
      label: "text-amber-700/80",
      inputBg: "bg-[#FAF0D8]",
      stickyBg: "bg-[#F5E6C8]/90",
    },
    dark: {
      bg: "bg-[#111827]",
      text: "text-[#FDFBF5]",
      subText: "text-white/60",
      border: "border-white/10",
      cardBg: "bg-[#1F2937]",
      hoverBg: "hover:bg-white/10",
      activeBg: "bg-amber-500/20 text-amber-400",
      divider: "border-white/10",
      label: "text-amber-500/60",
      inputBg: "bg-white/5",
      stickyBg: "bg-[#111827]/90",
    },
    oled: {
      bg: "bg-black",
      text: "text-white",
      subText: "text-white/50",
      border: "border-white/10",
      cardBg: "bg-[#0A0A0A]",
      hoverBg: "hover:bg-white/10",
      activeBg: "bg-amber-500/20 text-amber-400",
      divider: "border-white/10",
      label: "text-amber-500/60",
      inputBg: "bg-white/5",
      stickyBg: "bg-black/90",
    },
  } as const

  const t = themeConfig[theme]
  const bgColor = t.bg
  const textColor = t.text
  const subTextColor = t.subText
  const borderColor = t.border
  const cardBg = t.cardBg
  const hoverBg = t.hoverBg
  const activeBg = t.activeBg
  const labelColor = t.label
  const isLightTheme = theme === "light" || theme === "sepia"
  const inactiveText = isLightTheme ? "text-black/40 hover:bg-black/10" : "text-white/40 hover:bg-white/10"
  const inactiveBg = isLightTheme ? "bg-black/5" : "bg-white/5"
  const chapterText = isLightTheme ? "text-black/70 hover:bg-black/5" : "text-white/70 hover:bg-white/5"

  const hasTranslation = chapterList?.some(ch => ch.contentTranslated)

  // 分页内容计算
  const getPagedText = (text: string): string => {
    if (layoutMode !== "paginated") return text
    const pages = paginateContent(text)
    return pages[currentPage - 1] || text
  }

  const originalPages = layoutMode === "paginated" ? paginateContent(currentChapter?.contentOriginal || "") : []
  const translatedPages = layoutMode === "paginated" ? paginateContent(currentChapter?.contentTranslated || currentChapter?.contentOriginal || "") : []
  const totalPages = bilingualMode === "bilingual"
    ? Math.max(originalPages.length, translatedPages.length)
    : (bilingualMode === "original" ? originalPages.length : translatedPages.length)

  return (
    <div className={`min-h-screen ${bgColor} ${textColor} transition-colors duration-300`}>
      <NavBar />

      <header className={`sticky top-14 z-40 ${t.stickyBg} backdrop-blur-md border-b ${borderColor}`}>
        <div className="max-w-[800px] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/library")} className={`p-2 ${hoverBg} rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center`} title="返回小说库">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button onClick={() => setShowSidebar(!showSidebar)} className={`p-2 ${hoverBg} rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center`}>
              <List className="w-5 h-5" />
            </button>
            <button onClick={() => setShowBookmarks(!showBookmarks)} className={`p-2 ${hoverBg} rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${showBookmarks ? "text-amber-400" : ""}`} title="书签">
              <Bookmark className="w-5 h-5" />
            </button>
            <button onClick={() => setShowAnnotations(!showAnnotations)} className={`p-2 ${hoverBg} rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${showAnnotations ? "text-amber-400" : ""}`} title="批注">
              <Highlighter className="w-5 h-5" />
            </button>
          </div>
          <span className={`font-mono text-sm ${subTextColor} truncate max-w-[120px] sm:max-w-[200px]`}>
            {currentChapter?.title || "选择章节"}
          </span>
          <div className="flex gap-2">
            <button onClick={cycleBilingualMode} className={`p-2 ${hoverBg} rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center`} title="切换双语">
              <Languages className="w-5 h-5" />
            </button>
            <button onClick={() => setFontSize(s => Math.min(s + 2, 28))} className={`p-2 ${hoverBg} rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center`} title="增大字体">
              <Type className="w-5 h-5" />
            </button>
            <button onClick={() => setFontSize(s => Math.max(s - 2, 12))} className={`p-2 ${hoverBg} rounded-lg transition-colors hidden sm:block min-h-[44px] min-w-[44px] flex items-center justify-center`} title="减小字体">
              <Type className="w-4 h-4" />
            </button>

            {/* 更多操作下拉 */}
            <div className="relative">
              <button
                onClick={() => setShowActionMenu(!showActionMenu)}
                className={`p-2 ${hoverBg} rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${showActionMenu ? "text-amber-400" : ""}`}
                title="更多操作"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" /></svg>
              </button>
              {showActionMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowActionMenu(false)} />
                  <div className={`absolute right-0 top-full mt-1 w-48 ${cardBg} border ${borderColor} rounded-xl shadow-xl z-40 py-1 overflow-hidden`}>
                    {novel?.seriesId && (
                      <div className="px-3 py-1.5 text-xs text-white/40 font-mono truncate border-b border-white/5">
                        系列: {seriesList?.find(s => s.id === novel.seriesId)?.name || "..."}
                      </div>
                    )}
                    <button
                      onClick={() => { setShowActionMenu(false); setBindSeriesModal(true); setSelectedSeriesId(novel?.seriesId || null); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-amber-400 hover:bg-white/5 transition-colors text-left"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                      {novel?.seriesId ? "更换系列" : "绑定系列"}
                    </button>
                    <button
                      onClick={() => { setShowActionMenu(false); indexMutation.mutate({ novelId: id }); toast.success("已开始索引到 RAG"); }}
                      disabled={indexMutation.isPending}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-amber-400 hover:bg-white/5 transition-colors text-left disabled:opacity-30"
                    >
                      <Database className="w-4 h-4" />
                      {indexMutation.isPending ? "索引中..." : "索引到 RAG"}
                    </button>
                    <button
                      onClick={() => { setShowActionMenu(false); importToMaterialMutation.mutate({ novelId: id }); }}
                      disabled={importToMaterialMutation.isPending}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-amber-400 hover:bg-white/5 transition-colors text-left disabled:opacity-30"
                    >
                      <Upload className="w-4 h-4" />
                      {importToMaterialMutation.isPending ? "导入中..." : "导入素材库"}
                    </button>
                    {hasTranslation && (
                      <button
                        onClick={() => {
                          setShowActionMenu(false)
                          if (window.confirm("重新翻译将覆盖现有译文，是否继续？")) {
                            updateNovelMutation.mutateAsync({ id, status: "unread" }).then(() => {
                              utils.chapter.list.invalidate({ novelId: id })
                              utils.novel.getById.invalidate({ id })
                              toast.success("已重置，可以重新翻译")
                            })
                          }
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-amber-400 hover:bg-white/5 transition-colors text-left"
                      >
                        <Languages className="w-4 h-4" />
                        重新翻译
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <button onClick={() => setShowSettings(!showSettings)} className={`p-2 ${hoverBg} rounded-lg transition-colors`} title="阅读设置">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className={`h-0.5 ${isLightTheme ? "bg-black/5" : "bg-white/5"}`}>
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className={`max-w-[800px] mx-auto px-4 pb-1 flex justify-between text-xs font-mono ${subTextColor}`}>
          <span>
            第 {currentIndex + 1} / {totalChapters} 章
            {layoutMode === "paginated" && totalPages > 1 && (
              <span className="ml-2 opacity-60">· 第 {currentPage} / {totalPages} 页</span>
            )}
          </span>
          <span>{progressPercent.toFixed(0)}%</span>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className={`max-w-[800px] mx-auto px-4 md:px-6 pt-4`}>
          <div className={`p-5 rounded-xl ${cardBg} border ${borderColor} space-y-5`}>
            <div className="flex items-center justify-between">
              <h3 className={`font-mono text-xs uppercase tracking-wider ${subTextColor}`}>阅读设置</h3>
              <button onClick={() => setShowSettings(false)} className={`p-1 rounded ${hoverBg}`}><X className="w-4 h-4" /></button>
            </div>

            {/* Theme */}
            <div>
              <label className={`block font-mono text-xs ${subTextColor} mb-2`}>主题</label>
              <div className="flex gap-2">
                {[
                  { key: "light" as const, label: "明亮", bg: "bg-white", text: "text-gray-900", border: "border-gray-300" },
                  { key: "sepia" as const, label: " sepia", bg: "bg-[#F5E6C8]", text: "text-[#433422]", border: "border-[#D4C4A8]" },
                  { key: "dark" as const, label: "暗色", bg: "bg-[#111827]", text: "text-[#FDFBF5]", border: "border-white/20" },
                  { key: "oled" as const, label: "OLED", bg: "bg-black", text: "text-white", border: "border-white/20" },
                ].map(({ key, label, bg, text, border }) => (
                  <button
                    key={key}
                    onClick={() => setTheme(key)}
                    className={`flex-1 py-2 rounded-xl text-sm border-2 transition-all ${bg} ${text} ${theme === key ? border + " ring-2 ring-amber-500/40" : "border-transparent opacity-60 hover:opacity-100"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Family */}
            <div>
              <label className={`block font-mono text-xs ${subTextColor} mb-2`}>字体</label>
              <div className="flex gap-2">
                {[
                  { key: "serif" as const, label: "衬线体", className: "font-serif" },
                  { key: "sans" as const, label: "无衬线", className: "font-sans" },
                  { key: "mono" as const, label: "等宽", className: "font-mono" },
                ].map(({ key, label, className }) => (
                  <button
                    key={key}
                    onClick={() => setFontFamily(key)}
                    className={`flex-1 py-2 rounded-xl text-sm border transition-colors ${className} ${fontFamily === key ? "bg-amber-500/20 border-amber-500/30 text-amber-400" : "bg-white/5 border-transparent hover:bg-white/10 text-white/60"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Layout Mode */}
            <div>
              <label className={`block font-mono text-xs ${subTextColor} mb-2`}>布局</label>
              <div className="flex gap-2">
                {[
                  { key: "continuous" as const, label: "连续滚动" },
                  { key: "paginated" as const, label: "分页" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setLayoutMode(key)}
                    className={`flex-1 py-2 rounded-xl text-sm border transition-colors ${layoutMode === key ? "bg-amber-500/20 border-amber-500/30 text-amber-400" : "bg-white/5 border-transparent hover:bg-white/10 text-white/60"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sliders */}
            <div className="space-y-4">
              <ReaderSlider label="字体大小" value={fontSize} min={12} max={28} step={1} unit="px" onChange={setFontSize} />
              <ReaderSlider label="行间距" value={lineHeight} min={1.2} max={2.5} step={0.1} unit="" onChange={setLineHeight} />
              <ReaderSlider label="段落间距" value={paragraphSpacing} min={0.5} max={3} step={0.25} unit="rem" onChange={setParagraphSpacing} />
              <ReaderSlider label="边距" value={marginSize} min={8} max={48} step={4} unit="px" onChange={setMarginSize} />
            </div>
          </div>
        </div>
      )}

      {/* Translation banner */}
      {(!hasTranslation || novel?.status === "unread") && (
        <div className={`max-w-[800px] mx-auto px-4 md:px-6 pt-4`}>
          <div className={`p-4 rounded-xl bg-amber-500/10 border border-amber-500/20`}>
            {translateProgress?.isTranslating ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/70 font-mono">
                    {translateProgress.current > 0
                      ? `已完成 ${translateProgress.current}/${translateProgress.total} 章`
                      : `准备翻译 ${translateProgress.total} 章...`}
                  </span>
                  <span className="text-amber-400 text-xs font-mono">
                    {translateProgress.chapterTitle}
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{
                      width: `${translateProgress.total > 0 ? (translateProgress.current / translateProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 text-amber-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>正在翻译 {translateProgress.chapterTitle || "..."}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Play className="w-5 h-5 text-amber-500" />
                    <span className="text-sm text-amber-400">该小说尚未翻译</span>
                  </div>
                  <button
                    onClick={handleTranslate}
                    disabled={translateChapterMutation.isPending}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full text-sm font-medium transition-colors flex items-center gap-1.5"
                  >
                    {translateChapterMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {translateChapterMutation.isPending ? "翻译中..." : "开始翻译"}
                  </button>
                </div>
                {translateChapterMutation.isPending && !translateProgress?.isTranslating && (
                  <AiProgressBar
                    variant="indeterminate"
                    title="AI 翻译中"
                    description="正在检索参考素材并翻译当前章节..."
                    className="mt-3"
                  />
                )}
                {/* 翻译风格选择 */}
                <div className="flex gap-2">
                  {[
                    { label: "直译", value: "literal" as const },
                    { label: "流畅", value: "fluent" as const },
                    { label: "文学", value: "literary" as const },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setTranslateStyle(opt.value)}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        translateStyle === opt.value
                          ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                          : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {/* RAG 参考数量配置 */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1">翻译记忆条数</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 5, 10].map(n => (
                        <button
                          key={n}
                          onClick={() => setRagTopK(n)}
                          className={`flex-1 py-1 rounded text-[10px] transition-colors ${
                            ragTopK === n
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-white/5 text-white/40 hover:bg-white/10"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1">向量检索条数</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 5, 10].map(n => (
                        <button
                          key={n}
                          onClick={() => setRagLimit(n)}
                          className={`flex-1 py-1 rounded text-[10px] transition-colors ${
                            ragLimit === n
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-white/5 text-white/40 hover:bg-white/10"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {/* 自定义要求 */}
                <textarea
                  value={translatePrompt}
                  onChange={e => setTranslatePrompt(e.target.value)}
                  placeholder="自定义要求（可选）：如保持原文段落结构、使用古风表达、人名统一译为..."
                  className="w-full h-16 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-xs resize-none placeholder:text-white/40"
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex relative">
        {/* Chapter sidebar */}
        {showSidebar && (
          <aside className={`fixed left-0 top-[7.5rem] bottom-0 w-full sm:w-72 ${cardBg} border-r ${borderColor} overflow-y-auto z-40 transition-colors`}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-mono text-xs uppercase tracking-wider ${subTextColor}`}>章节列表</h3>
                <button onClick={() => setShowSidebar(false)} className={`p-1 rounded ${hoverBg}`}><X className="w-4 h-4" /></button>
              </div>

              {/* Jump to chapter */}
              <div className="flex gap-2 mb-4">
                <input
                  type="number"
                  min={1}
                  max={totalChapters}
                  value={jumpInput}
                  onChange={e => setJumpInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleJump()}
                  placeholder={`1-${totalChapters}`}
                  className={`flex-1 px-3 py-1.5 rounded-lg bg-white/5 border ${borderColor} focus:border-amber-500 outline-none text-sm text-[#FDFBF5] placeholder:text-white/40`}
                />
                <button
                  onClick={handleJump}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-lg text-sm font-medium"
                >
                  跳转
                </button>
              </div>

              {chapterList?.map((ch, idx) => (
                <button
                  key={ch.id}
                  onClick={() => { setCurrentChapterId(ch.id); setShowSidebar(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    ch.id === currentChapterId
                      ? activeBg
                      : `${chapterText}`
                  }`}
                >
                  <span className={`font-mono text-xs ${subTextColor} mr-2`}>{idx + 1}</span>
                  {ch.title || `第${idx + 1}章`}
                  {bookmarks?.some(bm => bm.chapterId === ch.id) && (
                    <Bookmark className="w-3 h-3 inline ml-1.5 text-amber-500" />
                  )}
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Bookmarks sidebar */}
        {showBookmarks && (
          <aside className={`fixed right-0 top-[7.5rem] bottom-0 w-full sm:w-72 ${cardBg} border-l ${borderColor} overflow-y-auto z-40 transition-colors`}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-mono text-xs uppercase tracking-wider ${subTextColor}`}>我的书签</h3>
                <button onClick={() => setShowBookmarks(false)} className={`p-1 rounded ${hoverBg}`}><X className="w-4 h-4" /></button>
              </div>

              {bookmarks?.length === 0 ? (
                <p className={`text-sm ${subTextColor} text-center py-8`}>暂无书签</p>
              ) : (
                <div className="space-y-2">
                  {bookmarks?.map(bm => {
                    const ch = chapterList?.find(c => c.id === bm.chapterId)
                    return (
                      <div key={bm.id} className={`p-3 rounded-lg ${isLightTheme ? "bg-black/5" : "bg-white/5"} group`}>
                        <button
                          onClick={() => {
                            setCurrentChapterId(bm.chapterId)
                            setShowBookmarks(false)
                          }}
                          className="text-left text-sm w-full mb-1 truncate"
                        >
                          {ch?.title || `章节 #${bm.chapterId}`}
                        </button>
                        {bm.note && <p className="text-xs text-white/50 mb-1">{bm.note}</p>}
                        <button
                          onClick={() => deleteBookmarkMutation.mutate({ id: bm.id })}
                          className="text-xs text-red-400/60 hover:text-red-400"
                        >
                          删除
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Annotations sidebar */}
        {showAnnotations && (
          <aside className={`fixed right-0 top-[7.5rem] bottom-0 w-full sm:w-80 ${cardBg} border-l ${borderColor} overflow-y-auto z-40 transition-colors`}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-mono text-xs uppercase tracking-wider ${subTextColor}`}>批注列表</h3>
                <button onClick={() => setShowAnnotations(false)} className={`p-1 rounded ${hoverBg}`}><X className="w-4 h-4" /></button>
              </div>

              {annotationList?.length === 0 ? (
                <p className={`text-sm ${subTextColor} text-center py-8`}>暂无批注<br /><span className="text-xs opacity-60">选中文字即可添加高亮和批注</span></p>
              ) : (
                <div className="space-y-3">
                  {annotationList?.map(ann => (
                    <div key={ann.id} className={`p-3 rounded-lg ${inactiveBg} group`}>
                      <div className="flex items-start gap-2 mb-2">
                        <span className={`w-3 h-3 rounded-full shrink-0 mt-0.5 ${
                          ann.color === "yellow" ? "bg-yellow-400" :
                          ann.color === "green" ? "bg-green-400" :
                          ann.color === "blue" ? "bg-blue-400" :
                          ann.color === "pink" ? "bg-pink-400" :
                          "bg-purple-400"
                        }`} />
                        <p className="text-sm line-clamp-2 flex-1">{ann.selectedText}</p>
                      </div>
                      {ann.note && (
                        <div className="flex items-start gap-1.5 mb-2">
                          <PenLine className="w-3 h-3 text-white/50 mt-0.5 shrink-0" />
                          <p className="text-xs text-white/50">{ann.note}</p>
                        </div>
                      )}
                      <button
                        onClick={() => deleteAnnotationMutation.mutate({ id: ann.id })}
                        className="text-xs text-red-400/60 hover:text-red-400"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        <main className="flex-1 max-w-[800px] mx-auto px-4 md:px-6 py-8">
          {currentChapter ? (
            <article
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: lineHeight,
                paddingLeft: `${marginSize}px`,
                paddingRight: `${marginSize}px`,
              }}
              className={fontFamily === "serif" ? "font-serif" : fontFamily === "sans" ? "font-sans" : "font-mono"}
            >
              {/* Bookmark button */}
              <div className="flex items-center justify-end gap-2 mb-4">
                <button
                  onClick={() => {
                    if (isBookmarked) {
                      const bm = bookmarks?.find(b => b.chapterId === currentChapterId)
                      if (bm) deleteBookmarkMutation.mutate({ id: bm.id })
                    } else {
                      setShowBookmarkForm(true)
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-colors ${
                    isBookmarked
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/20"
                      : `${inactiveBg + " " + inactiveText}`
                  }`}
                >
                  {isBookmarked ? <Bookmark className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                  {isBookmarked ? "已书签" : "添加书签"}
                </button>

                {bilingualMode === "translated" && (
                  <>
                    <button
                      onClick={() => setEditingChapter(!editingChapter)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-colors ${
                        editingChapter
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/20"
                          : `${inactiveBg + " " + inactiveText}`
                      }`}
                    >
                      <Settings className="w-3.5 h-3.5" />
                      {editingChapter ? "取消编辑" : "编辑译文"}
                    </button>
                    <button
                      onClick={handleExport}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-colors ${
                        inactiveBg + " " + inactiveText
                      }`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      导出
                    </button>
                  </>
                )}
              </div>

              {/* Bookmark form */}
              {showBookmarkForm && (
                <div className={`mb-6 p-4 rounded-xl ${isLightTheme ? "bg-black/5" : "bg-white/5"} border ${borderColor}`}>
                  <p className="text-sm mb-2">添加书签</p>
                  <input
                    value={bookmarkNote}
                    onChange={e => setBookmarkNote(e.target.value)}
                    placeholder="备注（可选）"
                    className={`w-full px-3 py-2 rounded-lg bg-white/5 border ${borderColor} focus:border-amber-500 outline-none text-sm mb-2 text-[#FDFBF5]`}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddBookmark}
                      disabled={createBookmarkMutation.isPending}
                      className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full text-xs font-medium"
                    >
                      添加
                    </button>
                    <button
                      onClick={() => { setShowBookmarkForm(false); setBookmarkNote(""); }}
                      className="px-4 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* Annotation form */}
              {showAnnotationForm && selectedText && (
                <div className={`mb-6 p-4 rounded-xl ${isLightTheme ? "bg-black/5" : "bg-white/5"} border border-amber-500/20`}>
                  <p className="text-sm mb-2 flex items-center gap-2">
                    <Highlighter className="w-4 h-4 text-amber-500" />
                    添加批注
                  </p>
                  <p className="text-xs text-white/40 mb-3 line-clamp-2 font-mono">"{selectedText}"</p>
                  <div className="flex gap-2 mb-3">
                    {["yellow", "green", "blue", "pink", "purple"].map(color => (
                      <button
                        key={color}
                        onClick={() => setAnnotationColor(color)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${
                          annotationColor === color ? "border-white scale-110" : "border-transparent"
                        } ${
                          color === "yellow" ? "bg-yellow-400" :
                          color === "green" ? "bg-green-400" :
                          color === "blue" ? "bg-blue-400" :
                          color === "pink" ? "bg-pink-400" :
                          "bg-purple-400"
                        }`}
                      />
                    ))}
                  </div>
                  <textarea
                    value={annotationNote}
                    onChange={e => setAnnotationNote(e.target.value)}
                    placeholder="添加批注（可选）..."
                    className={`w-full h-16 px-3 py-2 rounded-lg bg-white/5 border ${borderColor} focus:border-amber-500 outline-none text-sm mb-2 text-[#FDFBF5] resize-none`}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateAnnotation}
                      disabled={createAnnotationMutation.isPending}
                      className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full text-xs font-medium"
                    >
                      {createAnnotationMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                      保存
                    </button>
                    <button
                      onClick={() => { setShowAnnotationForm(false); setSelectedText(""); setAnnotationNote(""); }}
                      className="px-4 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* 段落对齐警告 */}
              {paragraphMismatch && bilingualMode === "bilingual" && (
                <div className={`mb-6 p-4 rounded-xl border border-amber-500/30 ${isLightTheme ? "bg-amber-500/10" : "bg-amber-500/5"}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-amber-500 text-lg leading-none mt-0.5">⚠️</span>
                    <div className="flex-1">
                      <p className="text-sm text-[#FDFBF5] mb-1">
                        段落对齐警告：原文 {paragraphMismatch.original} 段，译文 {paragraphMismatch.translated} 段，差异 {paragraphMismatch.diffPercent}%
                      </p>
                      <p className="text-xs text-white/50 mb-2">
                        AI 翻译可能将多个段落合并输出，导致双语对照时段落错位。可点击下方按钮进入编辑模式手动调整。
                      </p>
                      <button
                        onClick={() => {
                          setEditContent(currentChapter.contentTranslated || "")
                          setEditingChapter(true)
                        }}
                        className="text-xs px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-full transition-colors"
                      >
                        编辑修正
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {bilingualMode === "bilingual" ? (
                <div className="md:grid md:grid-cols-2 md:gap-8">
                  {/* 原文 */}
                  <div>
                    <p className={`font-mono text-xs ${labelColor} mb-4 uppercase tracking-wider`}>原文</p>
                    <div className={isLightTheme ? "text-black/80" : "text-white/80"}>
                      {renderParagraphs(
                        getPagedText(currentChapter.contentOriginal || ""),
                        paragraphSpacing,
                        0,
                        handleTextSelection,
                        annotationList,
                        hoveredParagraph,
                        setHoveredParagraph
                      )}
                    </div>
                  </div>
                  {/* 译文 */}
                  <div>
                    <p className={`font-mono text-xs ${labelColor} mb-4 uppercase tracking-wider`}>译文</p>
                    {editingChapter ? (
                    <div>
                      <textarea
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        className={`w-full h-96 px-4 py-3 rounded-xl bg-white/5 border ${borderColor} focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none font-serif leading-[1.8]`}
                        style={{ fontSize: `${fontSize}px` }}
                      />
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={handleSaveEdit}
                          disabled={updateChapterMutation.isPending}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full text-sm font-medium"
                        >
                          <Save className="w-3.5 h-3.5" /> 保存
                        </button>
                        <button
                          onClick={() => setEditingChapter(false)}
                          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {renderParagraphs(
                        getPagedText(currentChapter.contentTranslated || currentChapter.contentOriginal || "暂无翻译"),
                        paragraphSpacing,
                        1000,
                        handleTextSelection,
                        annotationList,
                        hoveredParagraph,
                        setHoveredParagraph
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {(bilingualMode === "original" || bilingualMode === "translated") && (
                  <>
                    {bilingualMode === "original" && (
                      <div className={isLightTheme ? "text-black/80" : "text-white/80"}>
                        {renderParagraphs(getPagedText(currentChapter.contentOriginal || ""), paragraphSpacing, 0, handleTextSelection, annotationList)}
                      </div>
                    )}
                    {bilingualMode === "translated" && (
                      <div>
                        {editingChapter ? (
                          <div>
                            <textarea
                              value={editContent}
                              onChange={e => setEditContent(e.target.value)}
                              className={`w-full h-96 px-4 py-3 rounded-xl bg-white/5 border ${borderColor} focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none font-serif leading-[1.8]`}
                              style={{ fontSize: `${fontSize}px` }}
                            />
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={handleSaveEdit}
                                disabled={updateChapterMutation.isPending}
                                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full text-sm font-medium"
                              >
                                <Save className="w-3.5 h-3.5" /> 保存
                              </button>
                              <button
                                onClick={() => setEditingChapter(false)}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            {renderParagraphs(getPagedText(currentChapter.contentTranslated || currentChapter.contentOriginal || "暂无翻译"), paragraphSpacing, 1000, handleTextSelection, annotationList)}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            </article>
          ) : (
            <div className={`text-center ${subTextColor} mt-20`}>请选择章节开始阅读</div>
          )}

          {/* 分页导航 */}
          {layoutMode === "paginated" && totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-12 mb-4">
              <button
                onClick={handlePrevPage}
                disabled={currentPage <= 1}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm ${inactiveBg} ${isLightTheme ? "hover:bg-black/10" : "hover:bg-white/10"} disabled:opacity-30 transition-colors`}
              >
                <ChevronLeft className="w-4 h-4" />
                上一页
              </button>
              <span className={`font-mono text-sm ${subTextColor}`}>
                第 {currentPage} / {totalPages} 页
              </span>
              <button
                onClick={handleNextPage}
                disabled={currentPage >= totalPages && currentIndex >= totalChapters - 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-amber-500 hover:bg-amber-400 text-[#111827] disabled:opacity-30 transition-colors"
              >
                下一页
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex justify-between mt-16">
            <button
              onClick={() => {
                if (currentIndex > 0 && chapterList) {
                  setCurrentChapterId(chapterList[currentIndex - 1].id)
                }
              }}
              disabled={currentIndex <= 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-full ${inactiveBg + " " + (isLightTheme ? "hover:bg-black/10" : "hover:bg-white/10")} disabled:opacity-30 disabled:cursor-not-allowed transition-colors`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="font-mono text-sm">上一章</span>
            </button>
            <button
              onClick={() => {
                if (chapterList && currentIndex < chapterList.length - 1) {
                  setCurrentChapterId(chapterList[currentIndex + 1].id)
                }
              }}
              disabled={!chapterList || currentIndex >= chapterList.length - 1}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-400 text-[#111827] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="font-mono text-sm font-medium">下一章</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* 回到顶部按钮 */}
          {showBackToTop && (
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="fixed bottom-6 right-6 z-30 w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-400 text-[#111827] shadow-lg flex items-center justify-center transition-all hover:scale-110"
              title="回到顶部"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          )}
        </main>
      </div>

      {/* RAG 调用信息面板 */}
      {showRagPanel && translateRagCalls && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">RAG 检索详情</h3>
              </div>
              <button onClick={() => setShowRagPanel(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">本次翻译共检索到 {translateRagCalls.length} 条参考</p>
            <div className="space-y-3">
              {translateRagCalls.map((call, i) => (
                <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={
                      call.type === "translation_memory" ? "text-amber-400 text-xs font-mono" :
                      call.type === "vector_search" ? "text-green-400 text-xs font-mono" :
                      "text-blue-400 text-xs font-mono"
                    }>
                      {call.type === "translation_memory" ? "翻译记忆" :
                       call.type === "vector_search" ? "向量检索" : "全文检索"}
                    </span>
                    {call.score !== undefined && (
                      <span className="text-white/40 text-xs font-mono">相似度: {(call.score * 100).toFixed(1)}%</span>
                    )}
                    {call.sourceType && (
                      <span className="text-white/30 text-xs font-mono">来源: {call.sourceType}</span>
                    )}
                  </div>
                  <p className="text-white/80 text-sm line-clamp-4">{call.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bind Series Modal */}
      {bindSeriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                <h3 className="font-serif text-lg font-semibold">{novel?.seriesId ? "更换系列" : "绑定系列"}</h3>
              </div>
              <button onClick={() => { setBindSeriesModal(false); setSelectedSeriesId(null); }} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">《{novel?.title}》</p>
            <div className="space-y-2 mb-6">
              {(seriesList || []).map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSeriesId(s.id)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition-colors ${
                    selectedSeriesId === s.id
                      ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                      : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                  }`}
                >
                  {s.name}
                </button>
              ))}
              {(!seriesList || seriesList.length === 0) && (
                <p className="text-white/40 text-sm text-center py-4">暂无系列，请先在设定库中创建</p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  if (!selectedSeriesId) return
                  await updateNovelMutation.mutateAsync({ id, seriesId: selectedSeriesId })
                  toast.success(`已绑定到「${seriesList?.find(s => s.id === selectedSeriesId)?.name}」`)
                  setBindSeriesModal(false)
                  setSelectedSeriesId(null)
                }}
                disabled={!selectedSeriesId || updateNovelMutation.isPending}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm transition-colors"
              >
                {updateNovelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "确认绑定"}
              </button>
              <button
                onClick={() => { setBindSeriesModal(false); setSelectedSeriesId(null); }}
                className="px-5 py-2.5 bg-white/5 hover:bg-white/10 rounded-full text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type AnnotationItem = {
  id: number
  paragraphIndex: number
  selectedText: string
  color: string
  note: string | null
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "bg-yellow-400/30",
  green: "bg-green-400/30",
  blue: "bg-blue-400/30",
  pink: "bg-pink-400/30",
  purple: "bg-purple-400/30",
}

// Render text split into paragraphs with configurable spacing and highlight support
function renderParagraphs(
  text: string,
  spacing: number,
  paragraphIndexOffset: number,
  onTextSelect: (paragraphIndex: number) => void,
  annotationList?: AnnotationItem[] | null,
  hoveredIndex?: number | null,
  onHover?: (index: number | null) => void
) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  return paragraphs.map((para, i) => {
    const pIdx = paragraphIndexOffset + i
    const paraAnnotations = annotationList?.filter(a => a.paragraphIndex === pIdx) || []
    const isHovered = hoveredIndex === i
    return (
      <p
        key={i}
        className={`whitespace-pre-wrap select-text rounded px-1 -mx-1 transition-colors ${
          isHovered ? "bg-amber-500/10" : ""
        }`}
        style={{ marginBottom: `${spacing}rem` }}
        onMouseUp={() => onTextSelect(pIdx)}
        onMouseEnter={() => onHover?.(i)}
        onMouseLeave={() => onHover?.(null)}
      >
        {renderHighlightedText(para.trim(), paraAnnotations)}
      </p>
    )
  })
}

function renderHighlightedText(text: string, annotations: AnnotationItem[]) {
  if (annotations.length === 0) return text
  // Sort by position in text
  const sorted = [...annotations].sort((a, b) => text.indexOf(a.selectedText) - text.indexOf(b.selectedText))
  const result: React.ReactNode[] = []
  let lastIndex = 0
  for (const ann of sorted) {
    const idx = text.indexOf(ann.selectedText, lastIndex)
    if (idx === -1) continue
    if (idx > lastIndex) {
      result.push(text.slice(lastIndex, idx))
    }
    result.push(
      <mark
        key={ann.id}
        className={`${HIGHLIGHT_COLORS[ann.color] || HIGHLIGHT_COLORS.yellow} rounded px-0.5 cursor-pointer`}
        title={ann.note || undefined}
      >
        {ann.selectedText}
      </mark>
    )
    lastIndex = idx + ann.selectedText.length
  }
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }
  return result.length > 0 ? result : text
}

// Reader settings slider component
function ReaderSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  const percentage = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-white/70">{label}</span>
        <span className="font-mono text-xs text-amber-500">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #F59E0B ${percentage}%, rgba(255,255,255,0.1) ${percentage}%)`,
        }}
      />
    </div>
  )
}
