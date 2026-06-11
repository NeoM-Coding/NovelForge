import { useState, useRef, useEffect, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { trpc } from "@/providers/trpc"
import { useToast } from "@/providers/toast"
import NavBar from "@/components/NavBar"
import Select from "@/components/Select"
import Modal from "@/components/Modal"
import { VirtualList } from "@/components/VirtualList"
import { AiProgressBar } from "@/components/AiProgressBar"
import {
  Database, Upload, FileText, BookOpen, Lightbulb,
  Trash2, Tag, Sparkles, AlertCircle, CheckCircle, Loader2,
  Eye, X, ArrowLeftRight, Library, Zap
} from "lucide-react"
import type { ExtractedLore } from "@contracts/schemas"

const SOURCE_TYPES = [
  { value: "parallel_corpus", label: "平行语料", desc: "原文+译文对照，用于翻译风格学习", icon: BookOpen },
  { value: "reference_novel", label: "参考小说", desc: "同系列/同题材的参考作品，用于风格模仿", icon: FileText },
  { value: "knowledge_doc", label: "知识文档", desc: "设定集、世界观笔记、角色设定等", icon: Lightbulb },
]

type UploadMode = "single" | "dual"

const STATUS_CONFIG = {
  pending: { label: "待索引", color: "text-white/40", icon: AlertCircle },
  indexing: { label: "索引中", color: "text-amber-400", icon: Loader2 },
  indexed: { label: "已索引", color: "text-green-400", icon: CheckCircle },
  failed: { label: "失败", color: "text-red-400", icon: AlertCircle },
}

// Client-side paragraph split (mirrors backend logic)
function splitTextIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

export default function MaterialPool() {
  const utils = trpc.useUtils()
  const toast = useToast()
  const { data: materialList, isLoading } = trpc.material.list.useQuery(undefined, {
    refetchInterval: (query) => {
      const data = query.state.data as { status: string }[] | undefined
      return data?.some((m) => m.status === "indexing") ? 3000 : false
    },
  })
  const { data: seriesList } = trpc.lore.series.list.useQuery()

  const createMutation = trpc.material.create.useMutation({
    onSuccess: () => {
      utils.material.list.invalidate()
      setShowForm(false)
      resetForm()
    },
  })

  const createFromAlignedPairsMutation = trpc.material.createFromAlignedPairs.useMutation({
    onSuccess: () => {
      utils.material.list.invalidate()
      setShowForm(false)
      resetForm()
    },
  })

  const indexAsyncMutation = trpc.material.indexAsync.useMutation({
    onSuccess: (data) => {
      setIndexJobId(data.jobId)
    },
    onError: (err) => {
      toast.error(`索引启动失败：${err.message}`)
    },
  })

  const parseFileMutation = trpc.material.parseFile.useMutation()

  const deleteMutation = trpc.material.delete.useMutation({
    onSuccess: () => utils.material.list.invalidate(),
  })

  const extractLoreMutation = trpc.material.extractLore.useMutation({
    onSuccess: (data) => {
      setExtractedData(data)
      setSelectedCharIndexes(new Set(data.characters.map((_, i) => i)))
      setSaveWorldBible(true)
    },
  })

  const createCharacterMutation = trpc.lore.character.create.useMutation({
    onSuccess: () => utils.lore.character.list.invalidate(),
  })

  const createWorldBibleMutation = trpc.lore.worldBible.createOrUpdate.useMutation({
    onSuccess: () => utils.lore.worldBible.get.invalidate(),
  })

  const importToNovelMutation = trpc.novel.importFromMaterial.useMutation({
    onSuccess: () => {
      toast.success("已成功导入小说管理")
      utils.novel.list.invalidate()
    },
  })

  const importMaterialsMutation = trpc.novel.importMaterials.useMutation({
    onSuccess: (data) => {
      toast.success(`成功导入 ${data.imported} 本小说到小说管理`)
      utils.novel.list.invalidate()
      setSelectedMaterialIds([])
    },
  })

  const autoExtractLoreMutation = trpc.material.autoExtractLore.useMutation({
    onSuccess: (data) => {
      const parts: string[] = []
      if (data.charactersAdded > 0) parts.push(`新增 ${data.charactersAdded} 个角色`)
      if (data.charactersMerged > 0) parts.push(`合并 ${data.charactersMerged} 个角色`)
      if (data.worldBibleCreated) parts.push("新建世界观")
      if (data.worldBibleMerged) parts.push("合并世界观")
      const msg = parts.length > 0 ? parts.join("，") : "未提取到新设定"

      // 潜在重复提示
      const dupes = data.potentialDuplicates || []
      if (dupes.length > 0) {
        const dupeText = dupes.map(d => `  · ${d.newCharacterName} → 可能与「${d.matchedCharacterName}」重复（${d.reason}）`).join("\n")
        toast.warning(`「${data.materialTitle}」提取完成：${msg}。发现 ${dupes.length} 个角色可能存在重复，请到设定库确认：${dupeText}`)
      } else {
        toast.success(`「${data.materialTitle}」提取完成：${msg}`)
      }
      utils.lore.character.list.invalidate()
      utils.lore.worldBible.get.invalidate()
    },
    onError: (err) => {
      toast.error(`提取失败：${err.message}`)
    },
  })

  const batchAutoExtractMutation = trpc.material.batchAutoExtract.useMutation({
    onSuccess: (data) => {
      setBatchTaskId(data.taskId)
    },
    onError: (err) => {
      toast.error(`批量提取启动失败：${err.message}`)
      setBatchTaskId(null)
    },
  })

  const [showForm, setShowForm] = useState(false)
  const [uploadMode, setUploadMode] = useState<UploadMode>("dual")
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [sourceText, setSourceText] = useState("")
  const [translatedText, setTranslatedText] = useState("")
  const [alignedPairs, setAlignedPairs] = useState<Array<{ source: string; translated: string }> | null>(null)
  const [sourceType, setSourceType] = useState<"parallel_corpus" | "reference_novel" | "knowledge_doc">("parallel_corpus")
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null)
  const [tagInput, setTagInput] = useState("")
  const [description, setDescription] = useState("")
  const [detailMaterialId, setDetailMaterialId] = useState<number | null>(null)
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([])
  const detailMaterial = materialList?.find(m => m.id === detailMaterialId) ?? null
  const [extractMaterialId, setExtractMaterialId] = useState<number | null>(null)
  const [extractedData, setExtractedData] = useState<ExtractedLore | null>(null)
  const [extractTargetSeriesId, setExtractTargetSeriesId] = useState<number | null>(null)
  const [selectedCharIndexes, setSelectedCharIndexes] = useState<Set<number>>(new Set())
  const [saveWorldBible, setSaveWorldBible] = useState(true)

  // 一键提取系列选择弹窗
  const [showAutoExtractModal, setShowAutoExtractModal] = useState(false)
  const [autoExtractMaterialId, setAutoExtractMaterialId] = useState<number | null>(null)
  const [autoExtractSeriesId, setAutoExtractSeriesId] = useState<number | null>(null)

  // 批量提取系列选择弹窗
  const [showBatchExtractModal, setShowBatchExtractModal] = useState(false)
  const [batchExtractSeriesId, setBatchExtractSeriesId] = useState<number | null>(null)
  const [batchTaskId, setBatchTaskId] = useState<string | null>(null)
  const [indexJobId, setIndexJobId] = useState<string | null>(null)

  // Single 模式拖拽上传
  const onDropSingle = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (file) handleFileSelect(file, "content")
  }, [])

  const singleDropzone = useDropzone({
    onDrop: onDropSingle,
    accept: { 'text/plain': ['.txt'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
    multiple: false,
    noClick: true,
  })

  // 轮询批量提取进度
  const { data: batchStatus } = trpc.material.batchAutoExtractStatus.useQuery(
    { taskId: batchTaskId! },
    {
      enabled: batchTaskId !== null,
      refetchInterval: (query) => {
        const data = query.state.data
        return data?.status === "running" ? 2000 : false
      },
    }
  )

  // 轮询异步索引进度
  const { data: indexJobStatus } = trpc.material.indexAsyncStatus.useQuery(
    { jobId: indexJobId! },
    {
      enabled: indexJobId !== null,
      refetchInterval: (query) => {
        const data = query.state.data
        return data?.status === "running" ? 2000 : false
      },
    }
  )

  // 索引完成时自动刷新素材列表
  useEffect(() => {
    if (indexJobStatus?.status === "completed" || indexJobStatus?.status === "failed") {
      utils.material.list.invalidate()
      setIndexJobId(null)
      if (indexJobStatus?.status === "completed") {
        toast.success(`「${indexJobStatus.materialTitle}」索引完成，共 ${indexJobStatus.indexedChunks} 个 chunks`)
      }
      if (indexJobStatus?.status === "failed" && indexJobStatus.error) {
        toast.error(`索引失败：${indexJobStatus.error}`)
      }
    }
  }, [indexJobStatus])

  // 批量提取完成时自动刷新
  useEffect(() => {
    if (batchStatus?.status === "completed" || batchStatus?.status === "failed") {
      utils.lore.character.list.invalidate()
      utils.lore.worldBible.get.invalidate()
      utils.material.list.invalidate()
      if (batchStatus.status === "completed") {
        const dupes = batchStatus.potentialDuplicates || []
        let msg = `批量提取完成：处理 ${batchStatus.total} 条素材，新增 ${batchStatus.charactersAdded} 个角色，合并 ${batchStatus.charactersMerged} 个角色`
        if (dupes.length > 0) {
          msg += `\n\n⚠️ 发现 ${dupes.length} 个角色可能存在重复，请到设定库确认。`
        }
        toast.success(msg)
      } else if (batchStatus.status === "failed") {
        toast.error(`批量提取失败：${batchStatus.errors?.join("\n") || "未知错误"}`)
      }
      setBatchTaskId(null)
      setSelectedMaterialIds([])
      setShowBatchExtractModal(false)
    }
  }, [batchStatus])

  const { data: chunkList, isLoading: chunksLoading } = trpc.material.getChunks.useQuery(
    { materialId: detailMaterialId! },
    { enabled: detailMaterialId !== null }
  )

  const singleFileInputRef = useRef<HTMLInputElement>(null)
  const sourceFileInputRef = useRef<HTMLInputElement>(null)
  const translatedFileInputRef = useRef<HTMLInputElement>(null)

  const resetForm = () => {
    setTitle(""); setContent(""); setSourceText(""); setTranslatedText("")
    setAlignedPairs(null); setSourceType("parallel_corpus")
    setSelectedSeriesId(null); setTagInput(""); setDescription("")
  }

  const handleFileSelect = async (file: File, target: "content" | "source" | "translated") => {
    const ext = file.name.split(".").pop()?.toLowerCase()
    if (!ext || !["txt", "docx"].includes(ext)) {
      toast.error("不支持的文件格式，仅支持 .txt 和 .docx")
      return
    }

    // 自动将文件名（去掉扩展名）填入标题
    const fileTitle = file.name.replace(/\.[^/.]+$/, "")
    if (!title.trim()) setTitle(fileTitle)

    if (ext === "txt") {
      const text = await file.text()
      if (target === "content") setContent(text)
      if (target === "source") { setSourceText(text); setAlignedPairs(null) }
      if (target === "translated") { setTranslatedText(text); setAlignedPairs(null) }
      return
    }

    // docx: send to backend via FileReader.readAsDataURL (reliable binary handling)
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(",")[1] // strip data:... prefix
      try {
        const result = await parseFileMutation.mutateAsync({ fileName: file.name, fileData: base64 })
        if (target === "content") setContent(result.text)
        if (target === "source") { setSourceText(result.text); setAlignedPairs(null) }
        if (target === "translated") { setTranslatedText(result.text); setAlignedPairs(null) }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "文件解析失败")
      }
    }
    reader.onerror = () => toast.error("文件读取失败")
    reader.readAsDataURL(file)
  }

  const handlePreviewAlign = () => {
    if (!sourceText.trim() || !translatedText.trim()) return
    const sourceParagraphs = splitTextIntoParagraphs(sourceText)
    const translatedParagraphs = splitTextIntoParagraphs(translatedText)
    const pairCount = Math.min(sourceParagraphs.length, translatedParagraphs.length)
    const pairs: Array<{ source: string; translated: string }> = []
    for (let i = 0; i < pairCount; i++) {
      if (sourceParagraphs[i].trim().length > 5 && translatedParagraphs[i].trim().length > 2) {
        pairs.push({ source: sourceParagraphs[i].trim(), translated: translatedParagraphs[i].trim() })
      }
    }
    setAlignedPairs(pairs)
  }

  const handleRemovePair = (index: number) => {
    if (!alignedPairs) return
    const next = [...alignedPairs]
    next.splice(index, 1)
    setAlignedPairs(next)
  }

  const handleSwapPair = (index: number) => {
    if (!alignedPairs) return
    const next = [...alignedPairs]
    next[index] = { source: next[index].translated, translated: next[index].source }
    setAlignedPairs(next)
  }

  const handleSaveAligned = () => {
    if (!title.trim() || !alignedPairs || alignedPairs.length === 0) return
    createFromAlignedPairsMutation.mutate({
      title: title.trim(),
      alignedPairs,
      seriesId: selectedSeriesId || undefined,
      tags: tagInput.split(",").map(t => t.trim()).filter(Boolean),
      description: description || `手动对齐: ${alignedPairs.length} 对段落`,
    })
  }

  const handleCreate = () => {
    if (!title.trim() || !content.trim()) return
    createMutation.mutate({
      title: title.trim(), content: content.trim(), sourceType,
      seriesId: selectedSeriesId || undefined,
      tags: tagInput.split(",").map(t => t.trim()).filter(Boolean),
      description: description || undefined,
    })
  }

  const canSaveAligned = alignedPairs && alignedPairs.length > 0 && title.trim()

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <NavBar />
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Database className="w-6 h-6 text-amber-500" />
              <h1 className="text-3xl font-serif font-bold">素材池</h1>
            </div>
            <p className="text-white/70 font-mono text-sm">
              向 RAG 记忆库投喂素材，增强 AI 翻译与二创的风格一致性
            </p>
          </div>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors">
            <Upload className="w-4 h-4" /> 投喂素材
          </button>
        </div>

        {showForm && (
          <div className="mb-8 p-6 rounded-2xl bg-white/5 border border-white/10 space-y-5">
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider text-white/70 mb-3">素材类型</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {SOURCE_TYPES.map(({ value, label, desc, icon: Icon }) => (
                  <button key={value} onClick={() => setSourceType(value as typeof sourceType)}
                    className={`p-4 rounded-xl border text-left transition-colors ${
                      sourceType === value ? "bg-amber-500/10 border-amber-500/30" : "bg-white/[0.02] border-white/10 hover:bg-white/[0.05]"
                    }`}>
                    <Icon className={`w-5 h-5 mb-2 ${sourceType === value ? "text-amber-500" : "text-white/40"}`} />
                    <div className={`text-sm font-medium ${sourceType === value ? "text-amber-400" : "text-white/70"}`}>{label}</div>
                    <div className="text-xs text-white/40 mt-1">{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {sourceType === "parallel_corpus" && (
              <div>
                <label className="block font-mono text-xs text-white/70 mb-2">上传方式</label>
                <div className="flex gap-2">
                  <button onClick={() => { setUploadMode("dual"); setAlignedPairs(null); }}
                    className={`flex-1 px-4 py-2 rounded-xl text-sm transition-colors ${
                      uploadMode === "dual" ? "bg-amber-500/20 border border-amber-500/30 text-amber-400" : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}>双文件对齐（推荐）</button>
                  <button onClick={() => { setUploadMode("single"); setAlignedPairs(null); }}
                    className={`flex-1 px-4 py-2 rounded-xl text-sm transition-colors ${
                      uploadMode === "single" ? "bg-amber-500/20 border border-amber-500/30 text-amber-400" : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}>单文件/粘贴</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-xs text-white/70 mb-2">标题</label>
                <input value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="如：斗破苍穹 前三章原文"
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm" />
              </div>
              <Select
                label="归属系列"
                value={String(selectedSeriesId || "")}
                placeholder="不绑定系列"
                options={[
                  { value: "", label: "不绑定系列" },
                  ...(seriesList?.map(s => ({ value: String(s.id), label: s.name })) || []),
                ]}
                onChange={v => setSelectedSeriesId(v ? Number(v) : null)}
              />
            </div>

            {sourceType === "parallel_corpus" && uploadMode === "dual" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="relative flex items-center justify-between mb-2">
                    <label className="font-mono text-xs text-white/70 flex items-center gap-1">
                      <FileText className="w-3 h-3" /> 原文（外文）
                    </label>
                    <button
                      type="button"
                      onClick={() => sourceFileInputRef.current?.click()}
                      disabled={parseFileMutation.isPending}
                      className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                    >
                      <Upload className="w-3 h-3" />
                      {parseFileMutation.isPending ? "解析中..." : "上传文件"}
                    </button>
                    <input
                      ref={sourceFileInputRef}
                      type="file"
                      accept=".txt,.docx"
                      tabIndex={-1}
                      className="absolute opacity-0 w-0 h-0 pointer-events-none"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleFileSelect(file, "source")
                        e.target.value = ""
                      }}
                    />
                  </div>
                  <textarea value={sourceText} onChange={e => { setSourceText(e.target.value); setAlignedPairs(null); }}
                    placeholder="粘贴或上传原文..."
                    className="w-full h-48 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40" />
                </div>
                <div>
                  <div className="relative flex items-center justify-between mb-2">
                    <label className="font-mono text-xs text-white/70 flex items-center gap-1">
                      <BookOpen className="w-3 h-3" /> 译文（中文）
                    </label>
                    <button
                      type="button"
                      onClick={() => translatedFileInputRef.current?.click()}
                      disabled={parseFileMutation.isPending}
                      className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                    >
                      <Upload className="w-3 h-3" />
                      {parseFileMutation.isPending ? "解析中..." : "上传文件"}
                    </button>
                    <input
                      ref={translatedFileInputRef}
                      type="file"
                      accept=".txt,.docx"
                      tabIndex={-1}
                      className="absolute opacity-0 w-0 h-0 pointer-events-none"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleFileSelect(file, "translated")
                        e.target.value = ""
                      }}
                    />
                  </div>
                  <textarea value={translatedText} onChange={e => { setTranslatedText(e.target.value); setAlignedPairs(null); }}
                    placeholder="粘贴或上传译文..."
                    className="w-full h-48 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40" />
                </div>
              </div>
            ) : (
              <div>
                <div className="relative flex items-center justify-between mb-2">
                  <label className="font-mono text-xs text-white/70">内容</label>
                  <button
                    type="button"
                    onClick={() => singleFileInputRef.current?.click()}
                    disabled={parseFileMutation.isPending}
                    className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                  >
                    <Upload className="w-3 h-3" />
                    {parseFileMutation.isPending ? "解析中..." : "上传文件"}
                  </button>
                  <input
                    ref={singleFileInputRef}
                    type="file"
                    accept=".txt,.docx"
                    tabIndex={-1}
                    className="absolute opacity-0 w-0 h-0 pointer-events-none"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) handleFileSelect(file, "content")
                      e.target.value = ""
                    }}
                  />
                </div>
                <div
                  {...singleDropzone.getRootProps()}
                  className={`relative rounded-xl transition-colors ${singleDropzone.isDragActive ? 'ring-2 ring-amber-500 bg-amber-500/5' : ''}`}
                >
                  <input {...singleDropzone.getInputProps()} />
                  {singleDropzone.isDragActive && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-amber-500/10 z-10 pointer-events-none">
                      <p className="text-amber-400 text-sm font-medium">松开以上传文件</p>
                    </div>
                  )}
                  <textarea value={content} onChange={e => setContent(e.target.value)}
                    placeholder={sourceType === "parallel_corpus"
                      ? "粘贴对照内容，用 === 分隔原文和译文...\n\nHello.\n===\n你好。"
                      : "粘贴素材内容..."
                    }
                    className="w-full h-48 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40" />
                </div>
              </div>
            )}

            {sourceType === "parallel_corpus" && uploadMode === "dual" && (
              <div className="flex gap-3">
                <button
                  onClick={handlePreviewAlign}
                  disabled={!sourceText.trim() || !translatedText.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/70 rounded-full font-medium text-sm transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  预览对齐
                </button>
                {canSaveAligned && (
                  <button
                    onClick={handleSaveAligned}
                    disabled={createFromAlignedPairsMutation.isPending}
                    className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm"
                  >
                    {createFromAlignedPairsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    确认保存
                  </button>
                )}
              </div>
            )}

            {alignedPairs && alignedPairs.length > 0 && (
              <div className="p-4 rounded-xl bg-white/5 border border-amber-500/20">
                <label className="block font-mono text-xs text-amber-400 mb-3 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  对齐结果（{alignedPairs.length} 对段落）— 可删除不匹配项或交换原文/译文
                </label>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {alignedPairs.map((pair, i) => (
                    <div key={i} className="p-3 rounded-lg bg-white/[0.03] border border-white/10 group">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-xs text-amber-500/60">#{i + 1}</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleSwapPair(i)}
                            className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-amber-400"
                            title="交换原文/译文"
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemovePair(i)}
                            className="p-1 rounded hover:bg-red-500/20 text-white/30 hover:text-red-400"
                            title="删除"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="text-xs text-white/40 font-mono mb-1 line-clamp-2">原文: {pair.source}</div>
                      <div className="text-xs text-amber-400/60 font-mono line-clamp-2">译文: {pair.translated}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {alignedPairs && alignedPairs.length === 0 && (
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                <p className="text-sm text-white/40">未找到有效段落对，请检查原文和译文内容</p>
              </div>
            )}

            {uploadMode === "single" && (
              <div className="flex gap-3">
                <button onClick={handleCreate}
                  disabled={createMutation.isPending || !title.trim() || !content.trim()}
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm flex items-center gap-2">
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  上传素材
                </button>
                <button onClick={() => { setShowForm(false); resetForm(); }} className="px-6 py-2.5 bg-white/5 hover:bg-white/10 rounded-full text-sm">取消</button>
              </div>
            )}

            {sourceType !== "parallel_corpus" && (
              <div className="flex gap-3">
                <button onClick={handleCreate}
                  disabled={createMutation.isPending || !title.trim() || !content.trim()}
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm flex items-center gap-2">
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  上传素材
                </button>
                <button onClick={() => { setShowForm(false); resetForm(); }} className="px-6 py-2.5 bg-white/5 hover:bg-white/10 rounded-full text-sm">取消</button>
              </div>
            )}
          </div>
        )}

        {indexJobStatus?.status === "running" && (
          <AiProgressBar
            variant="determinate"
            progress={indexJobStatus.totalCandidates && indexJobStatus.totalCandidates > 0
              ? Math.min(100, (indexJobStatus.indexedChunks / indexJobStatus.totalCandidates) * 100)
              : 0}
            title="素材索引中"
            description={`已处理 ${indexJobStatus.indexedChunks}${indexJobStatus.totalCandidates ? ` / ${indexJobStatus.totalCandidates}` : ""} 个片段`}
            className="mb-4"
          />
        )}

        {isLoading ? (
          <div className="text-center text-white/60 py-20"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />加载中...</div>
        ) : materialList?.length === 0 ? (
          <div className="text-center text-white/60 py-20">
            <Database className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>素材池为空</p>
            <p className="text-sm">点击上方&quot;投喂素材&quot;添加</p>
          </div>
        ) : (
          <div>
            {/* 批量操作栏 */}
            <div className="flex flex-wrap items-center justify-between mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/10 gap-2">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={materialList ? materialList.length > 0 && selectedMaterialIds.length === materialList.length : false}
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedMaterialIds(materialList?.map(m => m.id) || [])
                    } else {
                      setSelectedMaterialIds([])
                    }
                  }}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500"
                />
                <span className="text-sm text-white/70">
                  已选 {selectedMaterialIds.length} / {materialList?.length || 0} 条
                </span>
              </div>
              {selectedMaterialIds.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setBatchExtractSeriesId(null)
                      setShowBatchExtractModal(true)
                    }}
                    disabled={batchAutoExtractMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-full text-sm font-medium transition-colors"
                  >
                    <Zap className="w-4 h-4" />
                    批量提取设定
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`确定将选中的 ${selectedMaterialIds.length} 条素材批量导入小说管理？`)) {
                        importMaterialsMutation.mutate({ materialIds: selectedMaterialIds })
                      }
                    }}
                    disabled={importMaterialsMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full text-sm font-medium transition-colors"
                  >
                    {importMaterialsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                    批量导入为小说
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3">
            {materialList?.map(m => {
              const st = STATUS_CONFIG[m.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending
              const SIcon = st.icon
              const stLabel = SOURCE_TYPES.find(s => s.value === m.sourceType)?.label || m.sourceType
              return (
                <div key={m.id} className={`relative p-5 rounded-xl bg-white/[0.03] border transition-all group ${m.status === "indexing" ? "border-amber-500/40 animate-pulse" : "border-white/10 hover:border-white/20"}`}>
                  {m.status === "indexing" && (
                    <div className="absolute inset-0 rounded-xl border-2 border-amber-500/20 animate-ping pointer-events-none" />
                  )}
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <input
                          type="checkbox"
                          checked={selectedMaterialIds.includes(m.id)}
                          onChange={e => {
                            setSelectedMaterialIds(prev =>
                              e.target.checked
                                ? [...prev, m.id]
                                : prev.filter(id => id !== m.id)
                            )
                          }}
                          className="w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500 shrink-0"
                        />
                        <h3 className="font-serif text-lg font-semibold truncate">{m.title}</h3>
                        <span className={`flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded-full ${m.status === "indexing" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : ""} ${st.color}`}>
                          <SIcon className={`w-3.5 h-3.5 ${m.status === "indexing" ? "animate-spin" : ""}`} />{st.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-white/60 font-mono mb-2">
                        <span className="px-2 py-0.5 rounded-full bg-white/5">{stLabel}</span>
                        {(m.tags as string[]).length > 0 && <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{(m.tags as string[]).join(", ")}</span>}
                        {m.indexedChunks ? <span>{m.indexedChunks} chunks</span> : null}
                      </div>
                      {m.analytics && (
                        <div className="flex items-center gap-2 mt-2">
                          {m.analytics.retrievalCount > 10 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                              🔥 高频使用
                            </span>
                          )}
                          {m.analytics.retrievalCount === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">
                              ⚪ 未命中
                            </span>
                          )}
                          <span className="text-[10px] text-white/30 font-mono">
                            命中 {m.analytics.retrievalCount} 次
                          </span>
                        </div>
                      )}
                      <p className="text-white/50 text-xs line-clamp-2">{m.content.slice(0, 200)}...</p>
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0 flex-wrap">
                      <button
                        onClick={() => setDetailMaterialId(m.id)}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-amber-400 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title="查看详情"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {m.sourceType === "reference_novel" && (
                        <button
                          onClick={() => {
                            if (confirm(`将「${m.title}」导入小说管理？导入后可进行阅读和翻译。`)) {
                              importToNovelMutation.mutate({ materialId: m.id })
                            }
                          }}
                          disabled={importToNovelMutation.isPending}
                          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-green-400 min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="转为小说"
                        >
                          <BookOpen className="w-4 h-4" />
                        </button>
                      )}
                      {(m.status === "pending" || m.status === "failed" || m.status === "indexed") && (
                        <button
                          onClick={() => {
                            if (m.status === "indexed") {
                              if (confirm(`「${m.title}」已索引 ${m.indexedChunks} 个 chunks，重新索引将覆盖现有向量数据，确认继续？`)) {
                                indexAsyncMutation.mutate({ id: m.id })
                              }
                            } else {
                              indexAsyncMutation.mutate({ id: m.id })
                            }
                          }}
                          disabled={indexAsyncMutation.isPending || (indexJobStatus?.status === "running")}
                          className="p-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title={m.status === "indexed" ? "重新索引（将覆盖现有数据）" : "开始索引"}
                        >
                          <Sparkles className="w-4 h-4" />
                        </button>
                      )}
                      {m.status === "indexed" && (
                        <>
                          <button
                            onClick={() => {
                              setExtractMaterialId(m.id)
                              setExtractTargetSeriesId(m.seriesId || null)
                              extractLoreMutation.mutate({ materialId: m.id })
                            }}
                            disabled={extractLoreMutation.isPending}
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-amber-400 min-w-[44px] min-h-[44px] flex items-center justify-center"
                            title="提取设定（可编辑）"
                          >
                            <Library className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (m.seriesId) {
                                autoExtractLoreMutation.mutate({ materialId: m.id, seriesId: m.seriesId })
                              } else {
                                setAutoExtractMaterialId(m.id)
                                setAutoExtractSeriesId(null)
                                setShowAutoExtractModal(true)
                              }
                            }}
                            disabled={autoExtractLoreMutation.isPending}
                            className="p-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 min-w-[44px] min-h-[44px] flex items-center justify-center"
                            title="一键提取设定（自动保存）"
                          >
                            {autoExtractLoreMutation.isPending && autoExtractMaterialId === m.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Zap className="w-4 h-4" />
                            )}
                          </button>
                        </>
                      )}
                      <button onClick={() => { if (confirm("确认删除？")) deleteMutation.mutate({ id: m.id }); }}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-white/50 hover:text-red-400 min-w-[44px] min-h-[44px] flex items-center justify-center" title="删除">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        )}

        {/* Detail Modal */}
        <Modal
          open={detailMaterialId !== null}
          onClose={() => setDetailMaterialId(null)}
          title={detailMaterial?.title || "素材详情"}
          maxWidth="2xl"
        >
          {detailMaterial && (() => {
            const m = detailMaterial
            const st = STATUS_CONFIG[m.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending
            const stLabel = SOURCE_TYPES.find(s => s.value === m.sourceType)?.label || m.sourceType
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-xs text-white/60 font-mono">
                  <span className="px-2 py-0.5 rounded-full bg-white/5">{stLabel}</span>
                  <span className={`flex items-center gap-1 ${st.color}`}>
                    <st.icon className="w-3.5 h-3.5" />{st.label}
                  </span>
                  {(m.tags as string[]).length > 0 && <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{(m.tags as string[]).join(", ")}</span>}
                  <span>{m.indexedChunks ?? 0} chunks 已索引</span>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10">
                  <p className="text-xs text-white/50 font-mono mb-1">内容预览</p>
                  <p className="text-sm text-white/70 whitespace-pre-wrap">{m.content.slice(0, 800)}{m.content.length > 800 ? "..." : ""}</p>
                </div>
                <div>
                  <p className="text-xs text-white/50 font-mono mb-3">向量化 chunks ({chunksLoading ? "加载中..." : `${chunkList?.length ?? 0} 条`})</p>
                  {chunksLoading ? (
                    <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto text-white/30" /></div>
                  ) : chunkList && chunkList.length > 0 ? (
                    <div className="h-80">
                      <VirtualList
                        items={chunkList}
                        estimateSize={80}
                        renderItem={(chunk, i) => (
                          <div className="mb-2 p-3 rounded-lg bg-white/[0.03] border border-white/10">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs text-amber-500/60">#{i + 1}</span>
                              <span className="text-xs text-white/30 font-mono">{chunk.sourceType}</span>
                            </div>
                            <p className="text-sm text-white/60 line-clamp-3">{chunk.content}</p>
                          </div>
                        )}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-white/30 text-center py-4">暂无向量化数据</p>
                  )}
                </div>
              </div>
            )
          })()}
        </Modal>

        {/* Extract Lore Modal */}
        <Modal
          open={extractMaterialId !== null}
          onClose={() => {
            setExtractMaterialId(null)
            setExtractedData(null)
            setExtractTargetSeriesId(null)
            setSelectedCharIndexes(new Set())
            setSaveWorldBible(true)
          }}
          title="从素材提取设定"
          icon={<Library className="w-5 h-5" />}
          maxWidth="3xl"
        >
          {extractLoreMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-20 px-8">
              <AiProgressBar
                variant="indeterminate"
                title="AI 提取设定中"
                description="正在分析素材内容并提取角色、世界观等设定..."
                className="w-full max-w-md"
              />
            </div>
          ) : extractLoreMutation.isError ? (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              提取失败: {extractLoreMutation.error instanceof Error ? extractLoreMutation.error.message : "未知错误"}
            </div>
          ) : extractedData ? (
            <div className="space-y-5">
                  {/* 归属系列 */}
                  <Select
                    label="归属系列 *"
                    value={String(extractTargetSeriesId || "")}
                    placeholder="请选择系列"
                    options={[
                      { value: "", label: "请选择系列" },
                      ...(seriesList?.map(s => ({ value: String(s.id), label: s.name })) || []),
                    ]}
                    onChange={v => setExtractTargetSeriesId(v ? Number(v) : null)}
                  />

                  {/* 角色卡 */}
                  {extractedData.characters.length > 0 && (
                    <div>
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white/70 mb-3">角色卡 ({extractedData.characters.length})</h3>
                      <div className="space-y-3">
                        {extractedData.characters.map((char: ExtractedLore["characters"][number], idx: number) => (
                          <div key={idx} className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-3">
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={selectedCharIndexes.has(idx)}
                                onChange={e => {
                                  const next = new Set(selectedCharIndexes)
                                  if (e.target.checked) next.add(idx)
                                  else next.delete(idx)
                                  setSelectedCharIndexes(next)
                                }}
                                className="w-4 h-4 accent-amber-500"
                              />
                              <span className="font-serif font-semibold text-amber-400">{char.name}</span>
                            </div>
                            {selectedCharIndexes.has(idx) && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
                                <div>
                                  <label className="block font-mono text-xs text-white/50 mb-1">别名（逗号分隔）</label>
                                  <input
                                    value={(extractedData.characters[idx].aliases || []).join(", ")}
                                    onChange={e => {
                                      const next = { ...extractedData }
                                      next.characters = [...next.characters]
                                      next.characters[idx] = { ...next.characters[idx], aliases: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }
                                      setExtractedData(next)
                                    }}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block font-mono text-xs text-white/50 mb-1">年龄</label>
                                  <input
                                    value={extractedData.characters[idx].age || ""}
                                    onChange={e => {
                                      const next = { ...extractedData }
                                      next.characters = [...next.characters]
                                      next.characters[idx] = { ...next.characters[idx], age: e.target.value }
                                      setExtractedData(next)
                                    }}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block font-mono text-xs text-white/50 mb-1">外貌标签（逗号分隔）</label>
                                  <input
                                    value={(extractedData.characters[idx].appearanceTags || []).join(", ")}
                                    onChange={e => {
                                      const next = { ...extractedData }
                                      next.characters = [...next.characters]
                                      next.characters[idx] = { ...next.characters[idx], appearanceTags: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }
                                      setExtractedData(next)
                                    }}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block font-mono text-xs text-white/50 mb-1">性格特点（逗号分隔）</label>
                                  <input
                                    value={(extractedData.characters[idx].personalityTraits || []).join(", ")}
                                    onChange={e => {
                                      const next = { ...extractedData }
                                      next.characters = [...next.characters]
                                      next.characters[idx] = { ...next.characters[idx], personalityTraits: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }
                                      setExtractedData(next)
                                    }}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                                  />
                                </div>
                                <div className="col-span-2">
                                  <label className="block font-mono text-xs text-white/50 mb-1">核心动机</label>
                                  <textarea
                                    value={extractedData.characters[idx].coreMotivations || ""}
                                    onChange={e => {
                                      const next = { ...extractedData }
                                      next.characters = [...next.characters]
                                      next.characters[idx] = { ...next.characters[idx], coreMotivations: e.target.value }
                                      setExtractedData(next)
                                    }}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none h-16"
                                  />
                                </div>
                                <div className="col-span-2">
                                  <label className="block font-mono text-xs text-white/50 mb-1">说话方式</label>
                                  <input
                                    value={extractedData.characters[idx].speechPatterns || ""}
                                    onChange={e => {
                                      const next = { ...extractedData }
                                      next.characters = [...next.characters]
                                      next.characters[idx] = { ...next.characters[idx], speechPatterns: e.target.value }
                                      setExtractedData(next)
                                    }}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                                  />
                                </div>
                                <div className="col-span-2">
                                  <label className="block font-mono text-xs text-white/50 mb-1">禁忌（逗号分隔）</label>
                                  <input
                                    value={(extractedData.characters[idx].taboos || []).join(", ")}
                                    onChange={e => {
                                      const next = { ...extractedData }
                                      next.characters = [...next.characters]
                                      next.characters[idx] = { ...next.characters[idx], taboos: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }
                                      setExtractedData(next)
                                    }}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                                  />
                                </div>
                                <div className="col-span-2">
                                  <label className="block font-mono text-xs text-white/50 mb-1">正史故事线</label>
                                  <textarea
                                    value={extractedData.characters[idx].canonicalArcSummary || ""}
                                    onChange={e => {
                                      const next = { ...extractedData }
                                      next.characters = [...next.characters]
                                      next.characters[idx] = { ...next.characters[idx], canonicalArcSummary: e.target.value }
                                      setExtractedData(next)
                                    }}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none h-20"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 世界观圣经 */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        checked={saveWorldBible}
                        onChange={e => setSaveWorldBible(e.target.checked)}
                        className="w-4 h-4 accent-amber-500"
                      />
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white/70">世界观圣经</h3>
                    </div>
                    {saveWorldBible && (
                      <div className="pl-7 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block font-mono text-xs text-white/50 mb-1">地理环境</label>
                            <textarea
                              value={extractedData.worldBible.geography || ""}
                              onChange={e => {
                                const next = { ...extractedData, worldBible: { ...extractedData.worldBible, geography: e.target.value } }
                                setExtractedData(next)
                              }}
                              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none h-20"
                            />
                          </div>
                          <div>
                            <label className="block font-mono text-xs text-white/50 mb-1">魔法/超自然系统</label>
                            <textarea
                              value={extractedData.worldBible.magicSystem || ""}
                              onChange={e => {
                                const next = { ...extractedData, worldBible: { ...extractedData.worldBible, magicSystem: e.target.value } }
                                setExtractedData(next)
                              }}
                              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none h-20"
                            />
                          </div>
                          <div>
                            <label className="block font-mono text-xs text-white/50 mb-1">科技水平</label>
                            <input
                              value={extractedData.worldBible.technologyLevel || ""}
                              onChange={e => {
                                const next = { ...extractedData, worldBible: { ...extractedData.worldBible, technologyLevel: e.target.value } }
                                setExtractedData(next)
                              }}
                              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                            />
                          </div>
                          <div>
                            <label className="block font-mono text-xs text-white/50 mb-1">文化习俗</label>
                            <textarea
                              value={extractedData.worldBible.culturalCustoms || ""}
                              onChange={e => {
                                const next = { ...extractedData, worldBible: { ...extractedData.worldBible, culturalCustoms: e.target.value } }
                                setExtractedData(next)
                              }}
                              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none h-20"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block font-mono text-xs text-white/50 mb-1">语言/命名规则</label>
                          <textarea
                            value={extractedData.worldBible.linguisticNotes || ""}
                            onChange={e => {
                              const next = { ...extractedData, worldBible: { ...extractedData.worldBible, linguisticNotes: e.target.value } }
                              setExtractedData(next)
                            }}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none h-16"
                          />
                        </div>
                        <div>
                          <label className="block font-mono text-xs text-white/50 mb-1">派系势力（JSON 数组，每项含 name 和 description）</label>
                          <textarea
                            value={JSON.stringify(extractedData.worldBible.factions || [], null, 2)}
                            onChange={e => {
                              try {
                                const factions = JSON.parse(e.target.value)
                                const next = { ...extractedData, worldBible: { ...extractedData.worldBible, factions } }
                                setExtractedData(next)
                              } catch {
                                // ignore invalid JSON during typing
                              }
                            }}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none h-24 font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label className="block font-mono text-xs text-white/50 mb-1">时间线事件（JSON 数组，每项含 order 和 description）</label>
                          <textarea
                            value={JSON.stringify(extractedData.worldBible.timelineEvents || [], null, 2)}
                            onChange={e => {
                              try {
                                const timelineEvents = JSON.parse(e.target.value)
                                const next = { ...extractedData, worldBible: { ...extractedData.worldBible, timelineEvents } }
                                setExtractedData(next)
                              } catch {
                                // ignore invalid JSON during typing
                              }
                            }}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none h-24 font-mono text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 保存按钮 */}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => {
                        setExtractMaterialId(null)
                        setExtractedData(null)
                        setExtractTargetSeriesId(null)
                        setSelectedCharIndexes(new Set())
                        setSaveWorldBible(true)
                      }}
                      className="px-6 py-2.5 bg-white/5 hover:bg-white/10 rounded-full text-sm"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        if (!extractTargetSeriesId) {
                          toast.warning("请选择归属系列")
                          return
                        }
                        // 保存选中的角色
                        selectedCharIndexes.forEach(idx => {
                          const char = extractedData.characters[idx]
                          createCharacterMutation.mutate({
                            seriesId: extractTargetSeriesId,
                            name: char.name,
                            aliases: char.aliases || [],
                            age: char.age || undefined,
                            appearanceTags: char.appearanceTags || [],
                            personalityTraits: char.personalityTraits || [],
                            coreMotivations: char.coreMotivations || undefined,
                            relationships: char.relationships || {},
                            speechPatterns: char.speechPatterns || undefined,
                            taboos: char.taboos || [],
                            canonicalArcSummary: char.canonicalArcSummary || undefined,
                          })
                        })
                        // 保存世界观
                        if (saveWorldBible) {
                          createWorldBibleMutation.mutate({
                            seriesId: extractTargetSeriesId,
                            geography: extractedData.worldBible.geography || undefined,
                            magicSystem: extractedData.worldBible.magicSystem || undefined,
                            technologyLevel: extractedData.worldBible.technologyLevel || undefined,
                            factions: extractedData.worldBible.factions || [],
                            timelineEvents: extractedData.worldBible.timelineEvents || [],
                            culturalCustoms: extractedData.worldBible.culturalCustoms || undefined,
                            linguisticNotes: extractedData.worldBible.linguisticNotes || undefined,
                          })
                        }
                        // 关闭弹窗
                        setExtractMaterialId(null)
                        setExtractedData(null)
                        setExtractTargetSeriesId(null)
                        setSelectedCharIndexes(new Set())
                        setSaveWorldBible(true)
                        toast.success("设定已保存到设定库")
                      }}
                      disabled={createCharacterMutation.isPending || createWorldBibleMutation.isPending}
                      className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm"
                    >
                      {createCharacterMutation.isPending || createWorldBibleMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin inline mr-1" />
                      ) : null}
                      保存到设定库
                    </button>
                  </div>
                </div>
              ) : null}
          </Modal>

          {/* 一键提取 — 选择系列弹窗 */}
          <Modal
            open={showAutoExtractModal}
            onClose={() => setShowAutoExtractModal(false)}
            title="选择目标系列"
            maxWidth="md"
          >
            <div className="space-y-4">
              <p className="text-sm text-white/60">该素材未绑定系列，请选择要保存设定到的目标系列：</p>
              <Select
                label="目标系列"
                value={String(autoExtractSeriesId || "")}
                placeholder="请选择系列"
                options={[
                  { value: "", label: "请选择系列" },
                  ...(seriesList?.map(s => ({ value: String(s.id), label: s.name })) || []),
                ]}
                onChange={v => setAutoExtractSeriesId(v ? Number(v) : null)}
              />
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAutoExtractModal(false)} className="px-6 py-2.5 bg-white/5 hover:bg-white/10 rounded-full text-sm">取消</button>
                <button
                  onClick={() => {
                    if (!autoExtractSeriesId || !autoExtractMaterialId) {
                      toast.warning("请选择目标系列")
                      return
                    }
                    autoExtractLoreMutation.mutate({
                      materialId: autoExtractMaterialId,
                      seriesId: autoExtractSeriesId,
                    })
                    setShowAutoExtractModal(false)
                  }}
                  disabled={autoExtractLoreMutation.isPending}
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm"
                >
                  {autoExtractLoreMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                  确认提取
                </button>
              </div>
            </div>
          </Modal>

          {/* 批量提取 — 选择系列弹窗 */}
          <Modal
            open={showBatchExtractModal}
            onClose={() => setShowBatchExtractModal(false)}
            title="批量提取设定"
            maxWidth="md"
          >
            <div className="space-y-4">
              <p className="text-sm text-white/60">将选中的 {selectedMaterialIds.length} 条素材的设定自动提取并保存到目标系列：</p>
              <Select
                label="目标系列"
                value={String(batchExtractSeriesId || "")}
                placeholder="请选择系列"
                options={[
                  { value: "", label: "请选择系列" },
                  ...(seriesList?.map(s => ({ value: String(s.id), label: s.name })) || []),
                ]}
                onChange={v => setBatchExtractSeriesId(v ? Number(v) : null)}
              />
              {batchTaskId && batchStatus?.status === "running" && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/60">
                      正在处理 {batchStatus.processed}/{batchStatus.total} 条素材
                    </span>
                    <span className="text-amber-400">
                      {batchStatus.currentMaterialTitle || "准备中..."}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all duration-500"
                      style={{ width: `${batchStatus.total > 0 ? (batchStatus.processed / batchStatus.total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="text-xs text-white/40">
                    新增角色: {batchStatus.charactersAdded} · 合并角色: {batchStatus.charactersMerged}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowBatchExtractModal(false)
                    setBatchTaskId(null)
                  }}
                  disabled={batchTaskId !== null && batchStatus?.status === "running"}
                  className="px-6 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-full text-sm"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (!batchExtractSeriesId) {
                      toast.warning("请选择目标系列")
                      return
                    }
                    if (selectedMaterialIds.length === 0) {
                      toast.warning("请先选择素材")
                      return
                    }
                    batchAutoExtractMutation.mutate({
                      materialIds: selectedMaterialIds,
                      seriesId: batchExtractSeriesId,
                    })
                  }}
                  disabled={batchAutoExtractMutation.isPending || (batchTaskId !== null && batchStatus?.status === "running")}
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm"
                >
                  {batchAutoExtractMutation.isPending || (batchTaskId !== null && batchStatus?.status === "running") ? (
                    <Loader2 className="w-4 h-4 animate-spin inline mr-1" />
                  ) : (
                    <Zap className="w-4 h-4 inline mr-1" />
                  )}
                  开始批量提取
                </button>
              </div>
            </div>
          </Modal>
        </div>
      </div>
  )
}
