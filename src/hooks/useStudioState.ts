import { useState, useEffect, useRef, useCallback } from "react"
import { useParams } from "react-router"
import { trpc } from "@/providers/trpc"
import { useToast } from "@/providers/toast"
import type {
  WritingMode,
  GenParams,
  StudioDraft,
  ReviewResult,
  InspireResult,
  InspireFocus,
  RagCall,
  GenProgress,
} from "@/types/studio"

const DRAFT_KEY = "novelforge_studio_draft"
const DRAFT_MAX_AGE_DAYS = 7

const DEFAULT_PARAMS: GenParams = {
  temperature: 0.8,
  styleFidelity: 7,
  characterLoyalty: 8,
  tone: "dramatic",
  lengthTarget: "chapter",
  canonConstraint: "strict",
  writingMode: "canon_continuation",
  ragLimit: 5,
}

export function useStudioState() {
  const { workId } = useParams<{ workId: string }>()
  const utils = trpc.useUtils()
  const toast = useToast()

  // tRPC queries
  const { data: seriesList } = trpc.lore.series.list.useQuery()
  const { data: novelList } = trpc.novel.list.useQuery()

  // 历史作品搜索筛选状态
  const [searchQuery, setSearchQuery] = useState("")
  const [searchSeriesId, setSearchSeriesId] = useState<number | undefined>(undefined)
  const [searchDays, setSearchDays] = useState<number | undefined>(undefined)
  const [searchSortBy, setSearchSortBy] = useState<"createdAt" | "updatedAt" | "title">("createdAt")
  const { data: worksList } = trpc.generate.search.useQuery({
    query: searchQuery.trim() || undefined,
    seriesId: searchSeriesId,
    days: searchDays,
    sortBy: searchSortBy,
    limit: 20,
  })

  // 核心状态
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null)
  const [selectedParentNovelId, setSelectedParentNovelId] = useState<number | null>(null)
  const { data: characters } = trpc.lore.character.list.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )

  const [activeTab, setActiveTab] = useState<"edit" | "history">("edit")
  const [content, setContent] = useState("")
  const [displayContent, setDisplayContent] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [brief, setBrief] = useState("")
  const [title, setTitle] = useState("")
  const [userPrompt, setUserPrompt] = useState("")
  const [params, setParams] = useState<GenParams>(DEFAULT_PARAMS)
  const [lockedParagraphs, setLockedParagraphs] = useState<Set<number>>(new Set())
  const [generatedWorkId, setGeneratedWorkId] = useState<number | null>(null)
  const [useMaterials, setUseMaterials] = useState(true)
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [ragCalls, setRagCalls] = useState<RagCall[] | null>(null)
  const [showRagPanel, setShowRagPanel] = useState(false)
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>([])
  const [selectedTropeIds, setSelectedTropeIds] = useState<number[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  // AI Review 相关状态
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)
  const [showReviewPanel, setShowReviewPanel] = useState(false)

  // 灵感激发相关状态
  const [inspireResult, setInspireResult] = useState<InspireResult | null>(null)
  const [showInspirePanel, setShowInspirePanel] = useState(false)
  const [inspireFocus, setInspireFocus] = useState<InspireFocus>("full")

  // 大纲相关状态
  const [useOutlineMode, setUseOutlineMode] = useState(false)
  const [outlineType, setOutlineType] = useState<"overview" | "scenes" | "both">("both")
  const [outlineOverview, setOutlineOverview] = useState("")
  const [outlineScenes, setOutlineScenes] = useState<Array<{ id: string; title: string; description: string }>>([])
  const [showOutlinePanel, setShowOutlinePanel] = useState(false)

  // 本地草稿自动保存
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [draftInfo, setDraftInfo] = useState<{ savedAt: string } | null>(null)
  const lastSavedHashRef = useRef<string>("")

  // 保存为风格样本
  const [showStyleSampleModal, setShowStyleSampleModal] = useState(false)
  const [styleSampleCharacterTag, setStyleSampleCharacterTag] = useState("")
  const [styleSampleSceneTag, setStyleSampleSceneTag] = useState("")

  // 移动端参数面板
  const [panelOpen, setPanelOpen] = useState(false)

  // 查询该系列的桥段
  const { data: seriesTropes } = trpc.trope.list.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )
  // 查询热key桥段（用户历史高频使用）
  const { data: hotkeyTropes } = trpc.trope.hotkeys.useQuery(
    { seriesId: selectedSeriesId || 0, limit: 5 },
    { enabled: !!selectedSeriesId }
  )
  const hotkeyTropeIdSet = new Set(hotkeyTropes?.hotkeys.map(t => t.id) || [])

  // 查询该系列的素材列表
  const { data: seriesMaterials } = trpc.material.list.useQuery(
    { seriesId: selectedSeriesId || undefined },
    { enabled: !!selectedSeriesId }
  )

  // 重写相关
  const [regenIndex, setRegenIndex] = useState<number | null>(null)
  const [regenBrief, setRegenBrief] = useState("")

  // 生成进度可视化
  const [genProgress, setGenProgress] = useState<GenProgress | null>(null)
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 生成 mutation
  const generateMutation = trpc.generate.fanfiction.useMutation({
    onSuccess: () => {
      utils.generate.list.invalidate()
    },
  })

  const outlineMutation = trpc.generate.outline.useMutation({
    onSuccess: () => {
      utils.generate.list.invalidate()
    },
  })

  const updateWorkMutation = trpc.generate.updateWork.useMutation({
    onSuccess: () => {
      utils.generate.list.invalidate()
    },
  })

  const continueMutation = trpc.generate.continue.useMutation()
  const regenerateMutation = trpc.generate.regenerate.useMutation()

  const batchMutation = trpc.generate.batch.useMutation()
  const exportMutation = trpc.generate.export.useMutation()
  const reviewMutation = trpc.generate.review.useMutation()
  const inspireMutation = trpc.generate.inspire.useMutation()

  const [batchJobId, setBatchJobId] = useState(0)
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)

  const batchStatusQuery = trpc.generate.batchStatus.useQuery(
    { jobId: batchJobId },
    { enabled: batchJobId > 0 && isBatchGenerating, refetchInterval: 2000 }
  )

  const listChaptersQuery = trpc.generate.listChapters.useQuery(
    { workId: generatedWorkId || 0 },
    { enabled: !!generatedWorkId }
  )

  const saveAsStyleSampleMutation = trpc.material.saveAsStyleSample.useMutation({
    onSuccess: () => {
      utils.material.list.invalidate()
      setShowStyleSampleModal(false)
      setStyleSampleCharacterTag("")
      setStyleSampleSceneTag("")
      toast.success("已保存为风格样本")
    },
  })

  const deleteWorkMutation = trpc.generate.deleteWork.useMutation({
    onSuccess: () => {
      utils.generate.list.invalidate()
      if (generatedWorkId && !worksList?.some(w => w.id === generatedWorkId)) {
        setGeneratedWorkId(null)
        setContent("")
        setDisplayContent("")
      }
    },
  })

  // RAG 反馈闭环
  const feedbackMutation = trpc.rag.feedback.useMutation()
  const [feedbackState, setFeedbackState] = useState<"pending" | "helpful" | "unhelpful" | null>(null)
  const [showFeedbackDetail, setShowFeedbackDetail] = useState(false)

  // 加载已有作品
  const { data: loadedWork } = trpc.generate.getWork.useQuery(
    { id: parseInt(workId || "0", 10) },
    { enabled: !!workId && workId !== "undefined" }
  )

  // 查询当前生成作品的详情（用于展示自检结果）
  const { data: currentWork } = trpc.generate.getWork.useQuery(
    { id: generatedWorkId ?? 0 },
    { enabled: generatedWorkId !== null }
  )

  // 保存为小说
  const saveAsNovelMutation = trpc.generate.saveAsNovel.useMutation({
    onSuccess: () => {
      utils.novel.list.invalidate()
    },
  })

  // 系列切换时重置角色选择和桥段选择
  useEffect(() => {
    setSelectedCharacterIds([])
    setSelectedTropeIds([])
  }, [selectedSeriesId])

  // 模式切换时自动调整角色默认值 + temperature
  useEffect(() => {
    if (!characters) return
    if (params.writingMode === "canon_continuation" || params.writingMode === "character_spinoff") {
      setSelectedCharacterIds(characters.map(c => c.id))
    } else {
      setSelectedCharacterIds([])
    }
    // 智能 temperature 默认值
    const tempMap: Record<WritingMode, number> = {
      canon_continuation: 0.6,
      character_spinoff: 0.75,
      original_in_universe: 0.9,
      alternate_universe: 1.0,
    }
    setParams(p => ({ ...p, temperature: tempMap[p.writingMode] }))
  }, [params.writingMode, characters, setSelectedCharacterIds, setParams])

  // 系列切换时重置素材选择
  useEffect(() => {
    setSelectedMaterialIds([])
  }, [selectedSeriesId])

  // 加载已有作品
  useEffect(() => {
    if (loadedWork && workId) {
      setGeneratedWorkId(loadedWork.id)
      setTitle(loadedWork.title || "")
      setContent(loadedWork.generatedContent || "")
      setDisplayContent(loadedWork.generatedContent || "")
      setBrief(loadedWork.brief || "")
      setSelectedSeriesId(loadedWork.seriesId)
      setSelectedParentNovelId(loadedWork.parentNovelId)
      setSelectedMaterialIds([])
      if (loadedWork.parameters) {
        const p = loadedWork.parameters as unknown as Partial<GenParams> & { selectedCharacterIds?: number[]; selectedTropeIds?: number[] }
        setParams({
          temperature: p.temperature ?? DEFAULT_PARAMS.temperature,
          styleFidelity: p.styleFidelity ?? DEFAULT_PARAMS.styleFidelity,
          characterLoyalty: p.characterLoyalty ?? DEFAULT_PARAMS.characterLoyalty,
          tone: p.tone ?? DEFAULT_PARAMS.tone,
          lengthTarget: p.lengthTarget ?? DEFAULT_PARAMS.lengthTarget,
          canonConstraint: p.canonConstraint ?? DEFAULT_PARAMS.canonConstraint,
          writingMode: (p.writingMode as WritingMode) || DEFAULT_PARAMS.writingMode,
          ragLimit: p.ragLimit ?? DEFAULT_PARAMS.ragLimit,
        })
        setSelectedCharacterIds(p.selectedCharacterIds || [])
        setSelectedTropeIds(p.selectedTropeIds || [])
      }
      // 加载大纲（如果存在）
      if (loadedWork.outline) {
        const outline = loadedWork.outline as unknown as { overview?: string; scenes?: Array<{ id: string; title: string; description: string }>; outlineType?: "overview" | "scenes" | "both" }
        setUseOutlineMode(true)
        setShowOutlinePanel(true)
        setOutlineType(outline.outlineType || "both")
        setOutlineOverview(outline.overview || "")
        setOutlineScenes(outline.scenes || [])
      } else {
        setUseOutlineMode(false)
        setShowOutlinePanel(false)
        setOutlineOverview("")
        setOutlineScenes([])
      }
    }
  }, [loadedWork, workId])

  // 页面加载时检查本地草稿
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as StudioDraft
      if (draft.version !== 2) {
        localStorage.removeItem(DRAFT_KEY)
        return
      }
      const savedAt = new Date(draft.savedAt)
      const ageDays = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60 * 24)
      if (ageDays > DRAFT_MAX_AGE_DAYS) {
        localStorage.removeItem(DRAFT_KEY)
        return
      }
      // 若用户明确通过 URL 打开了某作品，不提示恢复草稿
      if (workId && workId !== "undefined") return
      setShowDraftBanner(true)
      setDraftInfo({ savedAt: draft.savedAt })
    } catch {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [workId])

  // 每 10 秒自动保存草稿（仅在内容有变化时写入）
  useEffect(() => {
    const interval = setInterval(() => {
      // 无任何编辑内容时不保存
      if (!selectedSeriesId && !brief.trim() && !title.trim() && !content) return

      const draft: StudioDraft = {
        version: 2,
        savedAt: new Date().toISOString(),
        selectedSeriesId,
        selectedParentNovelId,
        title,
        brief,
        userPrompt,
        params,
        selectedCharacterIds,
        selectedTropeIds,
        selectedMaterialIds,
        content,
        generatedWorkId,
        useOutlineMode,
        outlineType,
        outlineOverview,
        outlineScenes,
      }
      const json = JSON.stringify(draft)
      if (json === lastSavedHashRef.current) return
      lastSavedHashRef.current = json
      localStorage.setItem(DRAFT_KEY, json)
    }, 10000)
    return () => clearInterval(interval)
  }, [selectedSeriesId, selectedParentNovelId, title, brief, userPrompt, params, selectedCharacterIds, selectedTropeIds, selectedMaterialIds, content, generatedWorkId, useOutlineMode, outlineType, outlineOverview, outlineScenes])

  // 模拟流式显示效果
  useEffect(() => {
    if (!content || isTyping) return
    setIsTyping(true)
    setDisplayContent("")
    let i = 0
    const chunkSize = 2
    const interval = setInterval(() => {
      i += chunkSize
      if (i >= content.length) {
        setDisplayContent(content)
        clearInterval(interval)
        setIsTyping(false)
      } else {
        setDisplayContent(content.slice(0, i))
      }
    }, 12)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey

      // Esc：关闭弹窗（按优先级）
      if (e.key === "Escape") {
        if (showInspirePanel) { setShowInspirePanel(false); return }
        if (showReviewPanel) { setShowReviewPanel(false); return }
        if (showRagPanel) { setShowRagPanel(false); return }
        if (showFeedbackDetail) { setShowFeedbackDetail(false); return }
        if (showStyleSampleModal) { setShowStyleSampleModal(false); return }
      }

      // Ctrl/Cmd + Enter：开始生成
      if (isMod && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (!isGenerating && selectedSeriesId && brief.trim()) {
          // 大纲模式下：若无内容则生成大纲，否则生成正文
          const hasOutlineContent = outlineOverview.trim().length > 0 || outlineScenes.length > 0
          if (useOutlineMode && !hasOutlineContent) {
            handleGenerateOutline()
          } else {
            handleGenerate()
          }
        }
        return
      }

      // Ctrl/Cmd + S：保存作品
      if (isMod && e.key === "s") {
        e.preventDefault()
        if (generatedWorkId) {
          handleSave()
        }
        return
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, selectedSeriesId, brief, generatedWorkId, showInspirePanel, showReviewPanel, showRagPanel, showFeedbackDetail, showStyleSampleModal, useOutlineMode, outlineScenes.length])

  // 批量生成完成监听
  useEffect(() => {
    if (batchStatusQuery.data?.status === "completed") {
      setIsBatchGenerating(false)
      toast.success("批量生成完成！")
      listChaptersQuery.refetch()
    } else if (batchStatusQuery.data?.status === "failed") {
      setIsBatchGenerating(false)
      toast.error(`批量生成失败：${batchStatusQuery.data.errorLog}`)
    }
  }, [batchStatusQuery.data])

  // 处理生成
  const handleGenerate = useCallback(async () => {
    if (!selectedSeriesId || !brief.trim()) return

    // 大纲模式下校验数据完整性
    if (useOutlineMode) {
      if ((outlineType === "overview" || outlineType === "both") && !outlineOverview.trim()) {
        toast.error("整体概述不能为空，请填写大纲概述")
        return
      }
      if ((outlineType === "scenes" || outlineType === "both")) {
        if (outlineScenes.length === 0) {
          toast.error("场景列表不能为空，请至少添加一个场景")
          return
        }
        const emptyScene = outlineScenes.find(s => !s.title.trim() || !s.description.trim())
        if (emptyScene) {
          toast.error("每个场景都必须填写标题和描述")
          return
        }
      }
    }

    setIsGenerating(true)
    setContent("")
    setDisplayContent("")
    setFeedbackState(null)
    setShowFeedbackDetail(false)

    // 大纲模式下：先将用户编辑的大纲同步到数据库，再生成正文
    if (useOutlineMode && generatedWorkId) {
      try {
        await updateWorkMutation.mutateAsync({
          id: generatedWorkId,
          outline: {
            overview: outlineOverview,
            scenes: outlineScenes,
            generatedAt: new Date().toISOString(),
            outlineType,
          },
        })
      } catch {
        toast.warning("大纲保存失败，将使用数据库中已有版本继续生成")
      }
    }

    const taskId = crypto.randomUUID()
    setGenProgress({ step: 0, message: "正在启动..." })

    // 启动进度轮询（先清理已有轮询防止重复）
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current)
    progressIntervalRef.current = setInterval(async () => {
      try {
        const p = await utils.client.generate.progress.query({ taskId })
        if (p) {
          setGenProgress({ step: p.step, message: p.message, detail: p.detail, completed: p.completed })
          if (p.completed && progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current)
            progressIntervalRef.current = null
          }
        }
      } catch {
        // 轮询失败静默处理
      }
    }, 1500)

    try {
      const result = await generateMutation.mutateAsync({
        seriesId: selectedSeriesId,
        brief: brief.trim(),
        parameters: params,
        title: title || undefined,
        userPrompt: userPrompt.trim() || undefined,
        parentNovelId: selectedParentNovelId || undefined,
        useMaterials,
        materialIds: selectedMaterialIds.length > 0 ? selectedMaterialIds : undefined,
        selectedCharacterIds: selectedCharacterIds.length > 0 ? selectedCharacterIds : undefined,
        selectedTropeIds: selectedTropeIds.length > 0 ? selectedTropeIds : undefined,
        taskId,
        // 新增：如果在大纲模式下且有 workId，传入 useOutline
        ...(useOutlineMode && generatedWorkId ? {
          useOutline: true,
          workId: generatedWorkId,
        } : {}),
      })

      setGeneratedWorkId(result.workId)
      setContent(result.content)
      // 若用户未手动填写标题，自动填充 AI 生成的标题
      if (result.autoTitle && (!title || title.trim() === "")) {
        setTitle(result.autoTitle)
      }
      if (result.ragCalls && result.ragCalls.length > 0) {
        setRagCalls(result.ragCalls)
        setShowRagPanel(true)
      }
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings)
      } else {
        setWarnings([])
      }
    } catch (error) {
      console.error("Generation failed:", error)
      setGenProgress(prev => prev ? { ...prev, message: "生成失败", completed: true } : null)
    } finally {
      setIsGenerating(false)
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
    }
  }, [selectedSeriesId, brief, useOutlineMode, outlineType, outlineOverview, outlineScenes, generatedWorkId, updateWorkMutation, params, title, userPrompt, selectedParentNovelId, useMaterials, selectedMaterialIds, selectedCharacterIds, selectedTropeIds, generateMutation, utils.client.generate.progress, toast])

  // 处理大纲生成
  const handleGenerateOutline = useCallback(async () => {
    if (!selectedSeriesId || !brief.trim()) return
    setIsGenerating(true)

    const taskId = crypto.randomUUID()
    setGenProgress({ step: 0, message: "正在启动..." })

    // 启动进度轮询（先清理已有轮询防止重复）
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current)
    progressIntervalRef.current = setInterval(async () => {
      try {
        const p = await utils.client.generate.progress.query({ taskId })
        if (p) {
          setGenProgress({ step: p.step, message: p.message, detail: p.detail, completed: p.completed })
          if (p.completed && progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current)
            progressIntervalRef.current = null
          }
        }
      } catch {
        // 轮询失败静默处理
      }
    }, 1500)

    try {
      const result = await outlineMutation.mutateAsync({
        seriesId: selectedSeriesId,
        brief: brief.trim(),
        parameters: params,
        parentNovelId: selectedParentNovelId || undefined,
        userPrompt: userPrompt.trim() || undefined,
        useMaterials,
        materialIds: selectedMaterialIds.length > 0 ? selectedMaterialIds : undefined,
        selectedCharacterIds: selectedCharacterIds.length > 0 ? selectedCharacterIds : undefined,
        selectedTropeIds: selectedTropeIds.length > 0 ? selectedTropeIds : undefined,
        outlineType,
        taskId,
      })

      setGeneratedWorkId(result.workId)
      setOutlineOverview(result.outline.overview ?? "")
      setOutlineScenes(result.outline.scenes ?? [])
      setShowOutlinePanel(true)
      if (result.ragCalls && result.ragCalls.length > 0) {
        setRagCalls(result.ragCalls)
      }
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings)
      } else {
        setWarnings([])
      }
    } catch (error) {
      console.error("Outline generation failed:", error)
      setGenProgress(prev => prev ? { ...prev, message: "大纲生成失败", completed: true } : null)
    } finally {
      setIsGenerating(false)
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
    }
  }, [selectedSeriesId, brief, params, selectedParentNovelId, userPrompt, useMaterials, selectedMaterialIds, selectedCharacterIds, selectedTropeIds, outlineType, outlineMutation, utils.client.generate.progress])

  // 段落分割
  const paragraphs = displayContent
    .split("\n\n")
    .filter(p => p.trim().length > 0)

  // 锁定/解锁段落
  const toggleLock = useCallback((index: number) => {
    setLockedParagraphs(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  // 保存为小说
  const handleSave = useCallback(() => {
    if (!generatedWorkId) return
    saveAsNovelMutation.mutate({ workId: generatedWorkId }, {
      onSuccess: () => {
        localStorage.removeItem(DRAFT_KEY)
        lastSavedHashRef.current = ""
        toast.success("已保存到小说管理")
      },
    })
  }, [generatedWorkId, saveAsNovelMutation, toast])

  // 恢复草稿
  const handleRestoreDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as StudioDraft
      setSelectedSeriesId(draft.selectedSeriesId)
      setSelectedParentNovelId(draft.selectedParentNovelId)
      setTitle(draft.title)
      setBrief(draft.brief)
      setUserPrompt(draft.userPrompt)
      setParams(draft.params)
      setSelectedCharacterIds(draft.selectedCharacterIds)
      setSelectedTropeIds(draft.selectedTropeIds)
      setSelectedMaterialIds(draft.selectedMaterialIds)
      setContent(draft.content)
      setDisplayContent(draft.content)
      setGeneratedWorkId(draft.generatedWorkId)
      setUseOutlineMode(draft.useOutlineMode)
      setOutlineType(draft.outlineType)
      setOutlineOverview(draft.outlineOverview)
      setOutlineScenes(draft.outlineScenes)
      setShowOutlinePanel(draft.useOutlineMode)
      setShowDraftBanner(false)
      toast.info("草稿已恢复")
    } catch {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [toast])

  // 丢弃草稿
  const handleDiscardDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY)
    lastSavedHashRef.current = ""
    setShowDraftBanner(false)
    toast.info("草稿已丢弃")
  }, [toast])

  // 批量生成
  const handleBatchGenerate = useCallback(async () => {
    if (!generatedWorkId) {
      toast.error("请先保存作品")
      return
    }
    if (!outlineScenes || outlineScenes.length === 0) {
      toast.error("请先生成或创建大纲场景")
      return
    }

    const chapterConfigs = outlineScenes.map((scene, index) => ({
      chapterNumber: index + 1,
      title: scene.title,
      brief: scene.description,
    }))

    try {
      setIsBatchGenerating(true)
      const result = await batchMutation.mutateAsync({
        workId: generatedWorkId,
        chapterConfigs,
        params: {
          temperature: params.temperature,
          styleFidelity: params.styleFidelity,
          characterLoyalty: params.characterLoyalty,
          tone: params.tone,
          lengthTarget: params.lengthTarget,
          canonConstraint: params.canonConstraint,
          writingMode: params.writingMode,
          ragLimit: params.ragLimit,
        },
      })
      setBatchJobId(result.jobId)
      toast.success(`批量生成已启动（jobId: ${result.jobId}）`)
    } catch (err) {
      toast.error(String(err))
      setIsBatchGenerating(false)
    }
  }, [generatedWorkId, outlineScenes, batchMutation, params, toast])

  // 导出
  const handleExport = useCallback(async (format: "txt" | "markdown" = "txt") => {
    if (!generatedWorkId) {
      toast.error("没有可导出的作品")
      return
    }
    try {
      const result = await exportMutation.mutateAsync({ workId: generatedWorkId, format })
      const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = result.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${result.chapterCount} 章`)
    } catch (err) {
      toast.error(String(err))
    }
  }, [generatedWorkId, exportMutation, toast])

  // AI 审阅
  const handleReview = useCallback(async (focus: "full" | "worldview" | "character" | "writing" | "plot" = "full") => {
    if (!generatedWorkId) {
      toast.error("没有可审阅的作品")
      return
    }
    try {
      const result = await reviewMutation.mutateAsync({ workId: generatedWorkId, focus })
      setReviewResult(result)
      setShowReviewPanel(true)
    } catch (err) {
      toast.error(String(err))
    }
  }, [generatedWorkId, reviewMutation, toast])

  // 灵感激发
  const handleInspire = useCallback(async () => {
    if (!selectedSeriesId || !brief.trim()) {
      toast.error("请先选择系列并填写创作方向")
      return
    }
    try {
      const result = await inspireMutation.mutateAsync({
        seriesId: selectedSeriesId,
        brief: brief.trim(),
        materialIds: selectedMaterialIds.length > 0 ? selectedMaterialIds : undefined,
        focus: inspireFocus,
      })
      setInspireResult(result)
      setShowInspirePanel(true)
    } catch (err) {
      toast.error(String(err))
    }
  }, [selectedSeriesId, brief, selectedMaterialIds, inspireFocus, inspireMutation, toast])

  // 续写
  const handleContinue = useCallback(async () => {
    if (!generatedWorkId || isGenerating) return
    setIsGenerating(true)
    setFeedbackState(null)
    setShowFeedbackDetail(false)
    try {
      const result = await continueMutation.mutateAsync({
        workId: generatedWorkId,
        useMaterials,
        materialIds: selectedMaterialIds.length > 0 ? selectedMaterialIds : undefined,
      })
      setContent(prev => prev + "\n\n" + result.content)
      if (result.ragCalls && result.ragCalls.length > 0) {
        setRagCalls(result.ragCalls)
        setShowRagPanel(true)
      }
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings)
      } else {
        setWarnings([])
      }
    } catch (error) {
      console.error("Continue failed:", error)
    } finally {
      setIsGenerating(false)
    }
  }, [generatedWorkId, isGenerating, continueMutation, useMaterials, selectedMaterialIds])

  // 段落重写
  const handleRegenerate = useCallback(async (index: number) => {
    if (!generatedWorkId || !regenBrief.trim()) return
    const originalText = paragraphs[index]
    try {
      const result = await regenerateMutation.mutateAsync({
        workId: generatedWorkId,
        originalText,
        modifiedBrief: regenBrief.trim(),
        useMaterials,
        materialIds: selectedMaterialIds.length > 0 ? selectedMaterialIds : undefined,
      })
      setContent(result.fullContent)
      setDisplayContent(result.fullContent)
      setRegenIndex(null)
      setRegenBrief("")
      if (result.ragCalls && result.ragCalls.length > 0) {
        setRagCalls(result.ragCalls)
        setShowRagPanel(true)
      }
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings)
      } else {
        setWarnings([])
      }
    } catch (error) {
      console.error("Regenerate failed:", error)
    }
  }, [generatedWorkId, regenBrief, paragraphs, regenerateMutation, useMaterials, selectedMaterialIds])

  // 加载作品
  const handleLoadWork = useCallback((work: NonNullable<typeof worksList>[number]) => {
    if (!work) return
    setGeneratedWorkId(work.id)
    setTitle(work.title || "")
    setContent(work.generatedContent || "")
    setDisplayContent(work.generatedContent || "")
    setBrief(work.brief || "")
    setSelectedSeriesId(work.seriesId)
    setSelectedParentNovelId(work.parentNovelId)
    setActiveTab("edit")
    if (work.parameters) {
      const p = work.parameters as unknown as Partial<GenParams> & { selectedCharacterIds?: number[]; selectedTropeIds?: number[] }
      setParams({
        temperature: p.temperature ?? DEFAULT_PARAMS.temperature,
        styleFidelity: p.styleFidelity ?? DEFAULT_PARAMS.styleFidelity,
        characterLoyalty: p.characterLoyalty ?? DEFAULT_PARAMS.characterLoyalty,
        tone: p.tone ?? DEFAULT_PARAMS.tone,
        lengthTarget: p.lengthTarget ?? DEFAULT_PARAMS.lengthTarget,
        canonConstraint: p.canonConstraint ?? DEFAULT_PARAMS.canonConstraint,
        writingMode: (p.writingMode as WritingMode) || DEFAULT_PARAMS.writingMode,
        ragLimit: p.ragLimit ?? DEFAULT_PARAMS.ragLimit,
      })
      setSelectedCharacterIds(p.selectedCharacterIds || [])
      setSelectedTropeIds(p.selectedTropeIds || [])
    }
    // 加载大纲（如果存在）
    if (work.outline) {
      const outline = work.outline as unknown as { overview?: string; scenes?: Array<{ id: string; title: string; description: string }>; outlineType?: "overview" | "scenes" | "both" }
      setUseOutlineMode(true)
      setShowOutlinePanel(true)
      setOutlineType(outline.outlineType || "both")
      setOutlineOverview(outline.overview || "")
      setOutlineScenes(outline.scenes || [])
    } else {
      setUseOutlineMode(false)
      setShowOutlinePanel(false)
      setOutlineOverview("")
      setOutlineScenes([])
    }
  }, [worksList])

  return {
    // URL params
    workId,

    // tRPC queries
    seriesList,
    novelList,
    worksList,
    characters,
    seriesTropes,
    hotkeyTropes,
    hotkeyTropeIdSet,
    seriesMaterials,
    loadedWork,
    currentWork,
    batchStatusQuery,
    listChaptersQuery,

    // 历史作品搜索状态
    searchQuery,
    setSearchQuery,
    searchSeriesId,
    setSearchSeriesId,
    searchDays,
    setSearchDays,
    searchSortBy,
    setSearchSortBy,

    // 核心状态
    selectedSeriesId,
    setSelectedSeriesId,
    selectedParentNovelId,
    setSelectedParentNovelId,
    activeTab,
    setActiveTab,
    content,
    setContent,
    displayContent,
    setDisplayContent,
    isGenerating,
    setIsGenerating,
    brief,
    setBrief,
    title,
    setTitle,
    userPrompt,
    setUserPrompt,
    params,
    setParams,
    lockedParagraphs,
    setLockedParagraphs,
    generatedWorkId,
    setGeneratedWorkId,
    useMaterials,
    setUseMaterials,
    selectedMaterialIds,
    setSelectedMaterialIds,
    isTyping,
    setIsTyping,
    ragCalls,
    setRagCalls,
    showRagPanel,
    setShowRagPanel,
    selectedCharacterIds,
    setSelectedCharacterIds,
    selectedTropeIds,
    setSelectedTropeIds,
    warnings,
    setWarnings,

    // AI Review
    reviewResult,
    setReviewResult,
    showReviewPanel,
    setShowReviewPanel,

    // 灵感激发
    inspireResult,
    setInspireResult,
    showInspirePanel,
    setShowInspirePanel,
    inspireFocus,
    setInspireFocus,

    // 大纲
    useOutlineMode,
    setUseOutlineMode,
    outlineType,
    setOutlineType,
    outlineOverview,
    setOutlineOverview,
    outlineScenes,
    setOutlineScenes,
    showOutlinePanel,
    setShowOutlinePanel,

    // 本地草稿
    showDraftBanner,
    setShowDraftBanner,
    draftInfo,
    setDraftInfo,

    // 风格样本
    showStyleSampleModal,
    setShowStyleSampleModal,
    styleSampleCharacterTag,
    setStyleSampleCharacterTag,
    styleSampleSceneTag,
    setStyleSampleSceneTag,

    // 移动端面板
    panelOpen,
    setPanelOpen,

    // 重写
    regenIndex,
    setRegenIndex,
    regenBrief,
    setRegenBrief,

    // 生成进度
    genProgress,
    setGenProgress,

    // 批量生成
    batchJobId,
    setBatchJobId,
    isBatchGenerating,
    setIsBatchGenerating,

    // RAG 反馈
    feedbackState,
    setFeedbackState,
    showFeedbackDetail,
    setShowFeedbackDetail,

    // tRPC mutations (暴露 isPending 等状态给 UI)
    generateMutation,
    outlineMutation,
    updateWorkMutation,
    continueMutation,
    regenerateMutation,
    batchMutation,
    exportMutation,
    reviewMutation,
    inspireMutation,
    saveAsStyleSampleMutation,
    deleteWorkMutation,
    saveAsNovelMutation,
    feedbackMutation,

    // handlers
    handleGenerate,
    handleGenerateOutline,
    handleSave,
    handleRestoreDraft,
    handleDiscardDraft,
    handleBatchGenerate,
    handleExport,
    handleReview,
    handleInspire,
    handleContinue,
    handleRegenerate,
    handleLoadWork,
    toggleLock,

    // 派生数据
    paragraphs,

    // 常量
    DEFAULT_PARAMS,
  }
}
