import { useNavigate } from "react-router"
import { trpc } from "@/providers/trpc"
import { useToast } from "@/providers/toast"
import { useState, useMemo, useCallback, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import NavBar from "@/components/NavBar"
import type { inferRouterOutputs } from "@trpc/server"
import type { AppRouter } from "../../api/router"
import {
  BookOpen, Trash2, Plus, Search, Upload, Play, Download,
  Tag, Edit, X, Loader2, Database, Sparkles, ChevronDown
} from "lucide-react"

type RouterOutput = inferRouterOutputs<AppRouter>
type NovelItem = RouterOutput["novel"]["list"][number]

export default function NovelManager() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const toast = useToast()
  const { data: novels, isLoading } = trpc.novel.list.useQuery()
  const { data: allTags } = trpc.tag.list.useQuery()
  const { data: tagMap } = trpc.novel.tagMap.useQuery()
  const { data: seriesList } = trpc.lore.series.list.useQuery()
  const { data: allProgress } = trpc.readingProgress.list.useQuery()
  const createMutation = trpc.novel.create.useMutation({
    onSuccess: () => utils.novel.list.invalidate(),
  })
  const deleteMutation = trpc.novel.delete.useMutation({
    onSuccess: () => utils.novel.list.invalidate(),
  })
  const updateMutation = trpc.novel.update.useMutation({
    onSuccess: () => utils.novel.list.invalidate(),
  })
  const translateChapterMutation = trpc.translate.chapter.useMutation({
    onSuccess: () => {
      // 每章翻译完成后立即刷新列表，确保 UI 及时更新
      utils.novel.list.refetch()
    },
  })
  const indexMutation = trpc.rag.indexNovel.useMutation()
  const importToMaterialMutation = trpc.novel.importToMaterial.useMutation({
    onSuccess: (data) => {
      utils.material.list.invalidate()
      const typeLabel = data.sourceType === "parallel_corpus" ? "双语平行语料" : "参考小说"
      const extra = data.sourceType === "parallel_corpus" && data.pairCount
        ? `（${data.pairCount} 对段落）`
        : ""
      toast.success(`已导入为${typeLabel}：${data.title}${extra}，请前往素材池索引`)
    },
    onError: (err) => {
      toast.error(`导入失败：${err.message}`)
    },
  })
  const assignTagMutation = trpc.tag.assign.useMutation({
    onSuccess: () => utils.novel.tags.invalidate(),
  })
  const removeTagMutation = trpc.tag.remove.useMutation({
    onSuccess: () => utils.novel.tags.invalidate(),
  })

  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState("")
  const [author, setAuthor] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 })

  const [editingNovel, setEditingNovel] = useState<{ id: number; title: string; author: string } | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editAuthor, setEditAuthor] = useState("")

  const [translateNovel, setTranslateNovel] = useState<NovelItem | null>(null)
  const [translateStyle, setTranslateStyle] = useState<"literal" | "fluent" | "literary">("fluent")
  const [translatePrompt, setTranslatePrompt] = useState("")
  const [translateRagCalls, setTranslateRagCalls] = useState<Array<{ type: string; content: string; score?: number; sourceType?: string }> | null>(null)
  const [showRagPanel, setShowRagPanel] = useState(false)

  // 逐章翻译进度
  const [translateProgress, setTranslateProgress] = useState<{
    current: number
    total: number
    chapterTitle: string
    isTranslating: boolean
  } | null>(null)

  const [exportNovel, setExportNovel] = useState<NovelItem | null>(null)
  const [exportFormat, setExportFormat] = useState<"pure" | "parallel">("pure")

  const [tagNovel, setTagNovel] = useState<NovelItem | null>(null)
  const [bindSeriesNovel, setBindSeriesNovel] = useState<NovelItem | null>(null)
  const [selectedSeriesForBind, setSelectedSeriesForBind] = useState<number | null>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  // 批量操作
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedNovelIds, setSelectedNovelIds] = useState<Set<number>>(new Set())
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; label: string } | null>(null)
  const [batchSeriesModal, setBatchSeriesModal] = useState(false)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/pdf': ['.pdf'],
    },
    multiple: true,
  })

  const filteredNovels = useMemo(() => {
    if (!novels) return []
    if (!searchQuery.trim()) return novels
    const q = searchQuery.toLowerCase()
    return novels.filter(n =>
      n.title.toLowerCase().includes(q) ||
      (n.author ?? "").toLowerCase().includes(q)
    )
  }, [novels, searchQuery])

  // 恢复滚动位置
  useEffect(() => {
    const saved = sessionStorage.getItem("novelmanager_scroll")
    if (saved) {
      const pos = parseInt(saved, 10)
      requestAnimationFrame(() => {
        window.scrollTo({ top: pos, behavior: "instant" })
      })
      sessionStorage.removeItem("novelmanager_scroll")
    }
  }, [])

  const getNovelTags = (novelId: number) => {
    if (!allTags || !tagMap) return []
    const tagIds = tagMap.filter(tm => tm.novelId === novelId).map(tm => tm.tagId)
    return allTags.filter(t => tagIds.includes(t.id))
  }

  const getNovelProgress = (novelId: number) => {
    if (!allProgress) return null
    return allProgress.find(p => p.novelId === novelId) || null
  }

  // 批量操作：全选 / 反选
  const toggleSelectAll = () => {
    if (!filteredNovels) return
    if (selectedNovelIds.size === filteredNovels.length) {
      setSelectedNovelIds(new Set())
    } else {
      setSelectedNovelIds(new Set(filteredNovels.map(n => n.id)))
    }
  }

  const toggleSelectNovel = (novelId: number) => {
    setSelectedNovelIds(prev => {
      const next = new Set(prev)
      if (next.has(novelId)) next.delete(novelId)
      else next.add(novelId)
      return next
    })
  }

  // 批量索引
  const handleBatchIndex = async () => {
    if (selectedNovelIds.size === 0) return
    const ids = Array.from(selectedNovelIds)
    setBatchProgress({ current: 0, total: ids.length, label: "索引到 RAG" })
    try {
      for (let i = 0; i < ids.length; i++) {
        setBatchProgress({ current: i, total: ids.length, label: `索引到 RAG：${ids[i]}` })
        await indexMutation.mutateAsync({ novelId: ids[i] })
      }
      toast.success(`已完成 ${ids.length} 本小说的索引`)
    } catch (err) {
      toast.error("批量索引中断: " + String(err))
    } finally {
      setBatchProgress(null)
    }
  }

  // 批量导入素材库
  const handleBatchImport = async () => {
    if (selectedNovelIds.size === 0) return
    const ids = Array.from(selectedNovelIds)
    setBatchProgress({ current: 0, total: ids.length, label: "导入素材库" })
    try {
      for (let i = 0; i < ids.length; i++) {
        setBatchProgress({ current: i, total: ids.length, label: `导入素材库：${ids[i]}` })
        await importToMaterialMutation.mutateAsync({ novelId: ids[i] })
      }
      toast.success(`已导入 ${ids.length} 本小说到素材库`)
      utils.material.list.invalidate()
    } catch (err) {
      toast.error("批量导入中断: " + String(err))
    } finally {
      setBatchProgress(null)
    }
  }

  // 批量绑定系列
  const handleBatchBindSeries = async () => {
    if (selectedNovelIds.size === 0) return
    if (!selectedSeriesForBind) {
      toast.warning("请先选择要绑定的系列")
      return
    }
    const ids = Array.from(selectedNovelIds)
    setBatchProgress({ current: 0, total: ids.length, label: "绑定系列" })
    try {
      for (let i = 0; i < ids.length; i++) {
        setBatchProgress({ current: i, total: ids.length, label: `绑定系列：${ids[i]}` })
        await updateMutation.mutateAsync({ id: ids[i], seriesId: selectedSeriesForBind })
      }
      toast.success(`已将 ${ids.length} 本小说绑定到系列`)
    } catch (err) {
      toast.error("批量绑定中断: " + String(err))
    } finally {
      setBatchProgress(null)
      setBatchSeriesModal(false)
      setSelectedSeriesForBind(null)
    }
  }

  const handleCreate = () => {
    if (!title.trim()) return
    createMutation.mutate({ title, author: author || undefined })
    setTitle("")
    setAuthor("")
    setShowForm(false)
  }

  const handleFileUpload = async () => {
    if (files.length === 0) return
    setUploading(true)
    setUploadProgress({ current: 0, total: files.length })
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const formData = new FormData()
        formData.append("file", file)
        // 批量上传时，使用文件名（去掉扩展名）作为默认标题；单文件时使用输入框标题
        const fileTitle = file.name.replace(/\.[^/.]+$/, "")
        formData.append("title", files.length === 1 && title.trim() ? title.trim() : fileTitle)
        formData.append("author", author)
        const res = await fetch("/api/upload", { method: "POST", body: formData })
        if (!res.ok) throw new Error(`Upload failed for ${file.name}`)
        setUploadProgress({ current: i + 1, total: files.length })
      }
      await utils.novel.list.invalidate()
      setShowForm(false)
      setTitle("")
      setAuthor("")
      setFiles([])
    } catch (err) {
      toast.error("上传失败: " + String(err))
    } finally {
      setUploading(false)
      setUploadProgress({ current: 0, total: 0 })
    }
  }

  const handleUpdate = () => {
    if (!editingNovel || !editTitle.trim()) return
    updateMutation.mutate({ id: editingNovel.id, title: editTitle, author: editAuthor || undefined })
    setEditingNovel(null)
  }

  const handleTranslate = async () => {
    if (!translateNovel) return

    // 检查是否绑定了系列
    if (!translateNovel.seriesId) {
      toast.warning("该小说尚未绑定系列，翻译时将无法复用世界观素材。建议先绑定系列后再翻译。")
      // 继续翻译，不阻断
    }

    // 获取章节列表
    const chapterList = await utils.chapter.list.fetch({ novelId: translateNovel.id })
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
          novelId: translateNovel.id,
          chapterId: ch.id,
          style: translateStyle,
          userPrompt: translatePrompt.trim() || undefined,
        })

        if (result.ragCalls && result.ragCalls.length > 0) {
          allRagCalls?.push(...result.ragCalls)
        }
      }

      // 更新小说状态为已翻译
      await updateMutation.mutateAsync({ id: translateNovel.id, status: "translated" })
      await utils.novel.list.invalidate()

      setTranslateProgress({ current: chapterList.length, total: chapterList.length, chapterTitle: "", isTranslating: false })
      toast.success(`《${translateNovel.title}》翻译完成，共 ${chapterList.length} 章`)

      setTranslateNovel(null)
      setTranslatePrompt("")

      if (allRagCalls && allRagCalls.length > 0) {
        // 去重
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

  const handleExport = async () => {
    if (!exportNovel) return
    const result = await utils.translate.export.fetch({
      novelId: exportNovel.id,
      format: exportFormat,
    })
    const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${exportNovel.title}_${exportFormat === "pure" ? "纯中文" : "对照"}.txt`
    a.click()
    URL.revokeObjectURL(url)
    setExportNovel(null)
  }

  const handleAssignTag = (novelId: number, tagId: number) => {
    assignTagMutation.mutate({ novelId, tagId })
  }

  const handleRemoveTag = (novelId: number, tagId: number) => {
    removeTagMutation.mutate({ novelId, tagId })
  }

  const isTranslated = (novel: NovelItem) => novel.status === "translated"

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <NavBar />
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold">我的小说文库</h1>
            <p className="text-white/70 mt-2 font-mono text-sm">管理你的翻译与阅读项目</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {isBatchMode ? (
              <button
                onClick={() => { setIsBatchMode(false); setSelectedNovelIds(new Set()); }}
                className="px-4 py-2 rounded-full text-sm bg-white/5 hover:bg-white/10 text-white/70 transition-colors"
              >
                完成
              </button>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索小说..."
                    className="pl-9 pr-4 py-2 rounded-full bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-sm w-full sm:w-56 text-[#FDFBF5] placeholder:text-white/40"
                  />
                </div>
                {filteredNovels.length > 0 && (
                  <button
                    onClick={() => setIsBatchMode(true)}
                    className="px-4 py-2 rounded-full text-sm bg-white/5 hover:bg-white/10 text-white/70 hover:text-amber-400 transition-colors"
                  >
                    批量选择
                  </button>
                )}
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  添加小说
                </button>
              </>
            )}
          </div>
        </div>

        {/* Add novel form */}
        {showForm && (
          <div className="mb-8 p-6 rounded-xl bg-white/5 border border-white/10 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-xs text-white/70 mb-2">标题</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                  placeholder="小说标题"
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/70 mb-2">作者</label>
                <input
                  value={author}
                  onChange={e => setAuthor(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                  placeholder="作者名"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-xs text-white/70 mb-2">上传文件（txt/docx/pdf，可多选批量上传）</label>
              <div
                {...getRootProps()}
                className={`w-full px-4 py-6 rounded-xl border-2 border-dashed text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-white/20 bg-white/5 hover:border-white/40'
                }`}
              >
                <input {...getInputProps()} />
                <Upload className="w-6 h-6 mx-auto mb-2 text-white/40" />
                {isDragActive ? (
                  <p className="text-amber-400 text-sm">松开以添加文件...</p>
                ) : (
                  <p className="text-white/50 text-sm">拖拽文件到此处，或点击选择</p>
                )}
                <p className="text-white/30 text-xs mt-1 font-mono">支持 .txt / .docx / .pdf</p>
              </div>
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-white/40 text-xs font-mono">
                      <span className="truncate">{i + 1}. {f.name}</span>
                      <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-white/30 hover:text-red-400 ml-2">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {uploading && uploadProgress.total > 0 && (
                <p className="text-amber-400 text-xs mt-2 font-mono">
                  上传中... {uploadProgress.current}/{uploadProgress.total}
                </p>
              )}
            </div>

            <div className="flex gap-3">
              {files.length > 0 ? (
                <button
                  onClick={handleFileUpload}
                  disabled={uploading || (files.length === 1 && !title.trim())}
                  className="flex items-center gap-2 px-6 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium"
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploading ? "上传解析中..." : `上传并解析 (${files.length})`}
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={createMutation.isPending || !title.trim()}
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium"
                >
                  创建
                </button>
              )}
              <button onClick={() => { setShowForm(false); setFiles([]); setTitle(""); setAuthor(""); }} className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full">
                取消
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center text-white/40 py-20">加载中...</div>
        ) : filteredNovels.length === 0 ? (
          <div className="text-center text-white/40 py-20">
            <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>{searchQuery ? "未找到匹配的小说" : "还没有小说，点击上方按钮添加"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredNovels.map(novel => {
              const novelTags = getNovelTags(novel.id)
              return (
                <div
                  key={novel.id}
                  className={`group p-6 rounded-xl border transition-all cursor-pointer relative ${
                    selectedNovelIds.has(novel.id)
                      ? "bg-amber-500/5 border-amber-500/30"
                      : "bg-white/[0.03] border-white/10 hover:border-amber-500/30 hover:bg-white/[0.05]"
                  }`}
                  onClick={() => {
                    if (isBatchMode) {
                      toggleSelectNovel(novel.id)
                    } else {
                      sessionStorage.setItem("novelmanager_scroll", String(window.scrollY))
                      navigate(`/reader/${novel.id}`)
                    }
                  }}
                >
                  {/* 选择复选框 — 批量模式下显示 */}
                  {isBatchMode && (
                    <div className="absolute top-3 left-3">
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          toggleSelectNovel(novel.id)
                        }}
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                          selectedNovelIds.has(novel.id)
                            ? "bg-amber-500 border-amber-500"
                            : "border-white/20 bg-white/5 group-hover:border-white/40"
                        }`}
                      >
                        {selectedNovelIds.has(novel.id) && (
                          <svg className="w-3 h-3 text-[#111827]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        )}
                      </button>
                    </div>
                  )}

                  <div className={`flex items-start justify-between mb-4 ${isBatchMode ? "pl-7" : ""}`}>
                    <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                      <BookOpen className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setEditingNovel({ id: novel.id, title: novel.title, author: novel.author || "" })
                          setEditTitle(novel.title)
                          setEditAuthor(novel.author || "")
                        }}
                        className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/70 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title="编辑"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setOpenMenuId(openMenuId === novel.id ? null : novel.id)
                        }}
                        className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/70 transition-colors relative min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title="更多"
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform ${openMenuId === novel.id ? "rotate-180" : ""}`} />
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          if (confirm("确认删除？")) deleteMutation.mutate({ id: novel.id })
                        }}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-white/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <h3 className="font-serif text-lg font-semibold mb-2 line-clamp-2">{novel.title}</h3>
                  <p className="text-white/50 text-sm mb-3">{novel.author || "未知作者"}</p>

                  {novelTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {novelTags.map(tag => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 rounded-full text-xs font-mono bg-white/5 text-white/50"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                      novel.status === "translated"
                        ? "bg-green-500/20 text-green-400"
                        : novel.status === "reading"
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-white/10 text-white/50"
                    }`}>
                      {novel.status === "translated" ? "已翻译" : novel.status === "reading" ? "阅读中" : "未读"}
                    </span>
                    {novel.seriesId && seriesList && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-blue-500/10 text-blue-400">
                        {seriesList.find(s => s.id === novel.seriesId)?.name || "系列"}
                      </span>
                    )}
                  </div>

                  {/* 阅读进度 */}
                  {(() => {
                    const progress = getNovelProgress(novel.id)
                    if (!progress || progress.totalChapters <= 0) return null
                    const pct = Math.round((progress.chapterNumber / progress.totalChapters) * 100)
                    return (
                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/50 font-mono truncate max-w-[200px]">
                            读到：{progress.chapterTitle || `第${progress.chapterNumber}章`}
                          </span>
                          <span className="text-amber-500/60 font-mono">{pct}%</span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500/60 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })()}

                  {/* Dropdown menu */}
                  {openMenuId === novel.id && (
                    <div
                      className="mt-3 p-2 rounded-lg bg-[#1F2937] border border-white/10 space-y-1"
                      onClick={e => e.stopPropagation()}
                    >
                      {(() => {
                        const progress = getNovelProgress(novel.id)
                        if (progress) {
                          return (
                            <button
                              onClick={() => {
                                setOpenMenuId(null)
                                navigate(`/reader/${novel.id}`)
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-amber-400 hover:text-amber-300 transition-colors"
                            >
                              <BookOpen className="w-3.5 h-3.5" /> 继续阅读（第{progress.chapterNumber}章）
                            </button>
                          )
                        }
                        return (
                          <button
                            onClick={() => {
                              setOpenMenuId(null)
                              navigate(`/reader/${novel.id}`)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
                          >
                            <BookOpen className="w-3.5 h-3.5" /> {isTranslated(novel) ? "阅读" : "阅读原文"}
                          </button>
                        )
                      })()}
                      {!isTranslated(novel) && (
                        <button
                          onClick={() => {
                            setOpenMenuId(null)
                            setTranslateNovel(novel)
                            const meta = (novel.metadata as Record<string, unknown> | null) || {}
                            const savedStyle = meta.lastTranslateStyle as "literal" | "fluent" | "literary" | undefined
                            const savedPrompt = meta.lastTranslatePrompt as string | undefined
                            if (savedStyle) setTranslateStyle(savedStyle)
                            if (savedPrompt !== undefined) setTranslatePrompt(savedPrompt)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" /> 开始翻译
                        </button>
                      )}
                      {isTranslated(novel) && (
                        <button
                          onClick={() => { setOpenMenuId(null); setExportNovel(novel); }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" /> 导出翻译
                        </button>
                      )}
                      <button
                        onClick={() => { setOpenMenuId(null); setTagNovel(novel); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
                      >
                        <Tag className="w-3.5 h-3.5" /> 编辑标签
                      </button>
                      <button
                        onClick={() => {
                          setOpenMenuId(null)
                          setBindSeriesNovel(novel)
                          setSelectedSeriesForBind(novel.seriesId || null)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                        {novel.seriesId ? "更换系列" : "绑定系列"}
                      </button>
                      <button
                        onClick={() => {
                          setOpenMenuId(null)
                          indexMutation.mutate({ novelId: novel.id })
                        }}
                        disabled={indexMutation.isPending}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors disabled:opacity-30"
                      >
                        <Database className="w-3.5 h-3.5" /> 索引到 RAG
                      </button>
                      <button
                        onClick={() => {
                          setOpenMenuId(null)
                          importToMaterialMutation.mutate({ novelId: novel.id })
                        }}
                        disabled={importToMaterialMutation.isPending}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors disabled:opacity-30"
                      >
                        <Upload className="w-3.5 h-3.5" /> 导入素材库
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingNovel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-semibold">编辑小说</h3>
              <button onClick={() => setEditingNovel(null)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block font-mono text-xs text-white/70 mb-1">标题</label>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/70 mb-1">作者</label>
                <input value={editAuthor} onChange={e => setEditAuthor(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleUpdate} className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium text-sm">保存</button>
              <button onClick={() => setEditingNovel(null)} className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Translate Modal */}
      {translateNovel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">开始翻译</h3>
              </div>
              <button onClick={() => { setTranslateNovel(null); setTranslateProgress(null); }} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">《{translateNovel.title}》</p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-white/70 mb-2">翻译风格</label>
                <div className="flex gap-2">
                  {([
                    { value: "literal" as const, label: "直译" },
                    { value: "fluent" as const, label: "意译" },
                    { value: "literary" as const, label: "文学性" },
                  ]).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setTranslateStyle(opt.value)}
                      className={`flex-1 px-3 py-2 rounded-xl text-sm transition-colors ${
                        translateStyle === opt.value
                          ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                          : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-white/70 mb-2">自定义要求（可选）</label>
                <textarea
                  value={translatePrompt}
                  onChange={e => setTranslatePrompt(e.target.value)}
                  placeholder="如：保持原文段落结构、使用古风表达、人名统一译为..."
                  className="w-full h-24 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
                />
              </div>
            </div>

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
              <button
                onClick={handleTranslate}
                disabled={translateChapterMutation.isPending}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium transition-colors flex items-center justify-center gap-2"
              >
                {translateChapterMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {translateChapterMutation.isPending ? "翻译中..." : "开始翻译"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Export Modal */}
      {exportNovel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">导出翻译</h3>
              </div>
              <button onClick={() => setExportNovel(null)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">《{exportNovel.title}》</p>
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setExportFormat("pure")}
                className={`flex-1 px-4 py-3 rounded-xl text-sm transition-colors ${
                  exportFormat === "pure"
                    ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                    : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                }`}
              >
                纯中文模式
              </button>
              <button
                onClick={() => setExportFormat("parallel")}
                className={`flex-1 px-4 py-3 rounded-xl text-sm transition-colors ${
                  exportFormat === "parallel"
                    ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                    : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                }`}
              >
                对照模式
              </button>
            </div>
            <button
              onClick={handleExport}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              下载文件
            </button>
          </div>
        </div>
      )}

      {/* Tag Modal */}
      {tagNovel && allTags && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">编辑标签</h3>
              </div>
              <button onClick={() => setTagNovel(null)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">《{tagNovel.title}》</p>
            <div className="flex flex-wrap gap-2">
              {allTags.map(tag => {
                const isAssigned = tagMap?.some(tm => tm.novelId === tagNovel.id && tm.tagId === tag.id)
                return (
                  <button
                    key={tag.id}
                    onClick={() => {
                      if (isAssigned) handleRemoveTag(tagNovel.id, tag.id)
                      else handleAssignTag(tagNovel.id, tag.id)
                    }}
                    className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                      isAssigned
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        : "bg-white/5 text-white/40 border border-transparent hover:bg-white/10 hover:text-white/60"
                    }`}
                  >
                    {isAssigned ? "✓ " : "+ "}{tag.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bind Series Modal */}
      {bindSeriesNovel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                <h3 className="font-serif text-lg font-semibold">
                  {bindSeriesNovel.seriesId ? "更换系列" : "绑定系列"}
                </h3>
              </div>
              <button onClick={() => { setBindSeriesNovel(null); setSelectedSeriesForBind(null); }} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">《{bindSeriesNovel.title}》</p>
            <div className="space-y-2 mb-6">
              {(seriesList || []).map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSeriesForBind(s.id)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition-colors ${
                    selectedSeriesForBind === s.id
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
                onClick={() => {
                  if (!bindSeriesNovel || !selectedSeriesForBind) return
                  updateMutation.mutate({
                    id: bindSeriesNovel.id,
                    seriesId: selectedSeriesForBind,
                  }, {
                    onSuccess: () => {
                      toast.success(`已绑定到「${seriesList?.find(s => s.id === selectedSeriesForBind)?.name}」`)
                      setBindSeriesNovel(null)
                      setSelectedSeriesForBind(null)
                    },
                  })
                }}
                disabled={!selectedSeriesForBind || updateMutation.isPending}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm transition-colors"
              >
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "确认绑定"}
              </button>
              <button
                onClick={() => { setBindSeriesNovel(null); setSelectedSeriesForBind(null); }}
                className="px-5 py-2.5 bg-white/5 hover:bg-white/10 rounded-full text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 底部批量操作栏 */}
      {isBatchMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#1F2937]/95 backdrop-blur border-t border-white/10 px-4 md:px-8 py-3">
          <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSelectAll}
                className="text-sm text-white/60 hover:text-white/90 transition-colors"
              >
                {filteredNovels && selectedNovelIds.size === filteredNovels.length ? "取消全选" : `全选 (${selectedNovelIds.size})`}
              </button>
              <span className="text-white/40 text-sm">已选择 {selectedNovelIds.size} 本小说</span>
            </div>
            <div className="flex items-center gap-2">
              {batchProgress ? (
                <div className="flex items-center gap-3">
                  <span className="text-white/60 text-sm font-mono">{batchProgress.label} {batchProgress.current}/{batchProgress.total}</span>
                  <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                </div>
              ) : (
                <>
                  <button
                    onClick={() => { setBatchSeriesModal(true); setSelectedSeriesForBind(null); }}
                    className="px-4 py-2 rounded-full text-sm bg-white/5 hover:bg-white/10 text-white/70 hover:text-amber-400 transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    批量绑定系列
                  </button>
                  <button
                    onClick={handleBatchImport}
                    disabled={importToMaterialMutation.isPending}
                    className="px-4 py-2 rounded-full text-sm bg-white/5 hover:bg-white/10 text-white/70 hover:text-amber-400 transition-colors flex items-center gap-1.5 disabled:opacity-30"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    批量导入素材
                  </button>
                  <button
                    onClick={handleBatchIndex}
                    disabled={indexMutation.isPending}
                    className="px-4 py-2 rounded-full text-sm bg-amber-500 hover:bg-amber-400 text-[#111827] font-medium transition-colors flex items-center gap-1.5 disabled:opacity-30"
                  >
                    <Database className="w-3.5 h-3.5" />
                    批量索引
                  </button>
                  <button
                    onClick={() => setSelectedNovelIds(new Set())}
                    className="px-3 py-2 rounded-full text-sm text-white/40 hover:text-white/70 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 批量绑定系列 Modal */}
      {batchSeriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                <h3 className="font-serif text-lg font-semibold">批量绑定系列</h3>
              </div>
              <button onClick={() => { setBatchSeriesModal(false); setSelectedSeriesForBind(null); }} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">将为 {selectedNovelIds.size} 本小说绑定到同一系列</p>
            <div className="space-y-2 mb-6">
              {(seriesList || []).map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSeriesForBind(s.id)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition-colors ${
                    selectedSeriesForBind === s.id
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
                onClick={handleBatchBindSeries}
                disabled={!selectedSeriesForBind || updateMutation.isPending}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm transition-colors"
              >
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "确认绑定"}
              </button>
              <button
                onClick={() => { setBatchSeriesModal(false); setSelectedSeriesForBind(null); }}
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
