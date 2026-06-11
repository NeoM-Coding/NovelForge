import { trpc } from "@/providers/trpc"
import { useToast } from "@/providers/toast"
import { useState, useEffect } from "react"
import { Controller } from "react-hook-form"
import { useCharacterForm, formDataToCharacterPayload } from "@/hooks/useCharacterForm"
import NavBar from "@/components/NavBar"
import {
  Plus, Users, Globe, BookMarked, Trash2, Edit, X, Save,
  Calendar, Loader2, Sparkles, CheckSquare, Square,
  Database, BookOpen, Theater, CheckCircle, AlertCircle, Library,
} from "lucide-react"
import Modal from "@/components/Modal"
import LoreStatsChart from "@/components/LoreStatsChart"
import { SortableList } from "@/components/SortableList"
import RichTextEditor from "@/components/RichTextEditor"
import { AiProgressBar } from "@/components/AiProgressBar"

export default function LoreLibrary() {
  const utils = trpc.useUtils()
  const toast = useToast()
  const { data: seriesList } = trpc.lore.series.list.useQuery()
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<"characters" | "world" | "canon" | "tropes">("characters")
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [showSeriesForm, setShowSeriesForm] = useState(false)
  const [showSeriesEdit, setShowSeriesEdit] = useState(false)
  const [seriesName, setSeriesName] = useState("")
  const [seriesDesc, setSeriesDesc] = useState("")
  const [seriesUniverse, setSeriesUniverse] = useState("")

  const [showCharForm, setShowCharForm] = useState(false)
  const [showCharEdit, setShowCharEdit] = useState<number | null>(null)
  const [selectedCharIds, setSelectedCharIds] = useState<Set<number>>(new Set())
  const [showSummarizeModal, setShowSummarizeModal] = useState(false)
  const [summarizedWorld, setSummarizedWorld] = useState<{
    geography?: string
    magicSystem?: string
    technologyLevel?: string
    culturalCustoms?: string
    linguisticNotes?: string
    factions: Array<{ name: string; description: string }>
    timelineEvents: Array<{ order: number; description: string }>
  } | null>(null)

  // Character form (React Hook Form)
  const charForm = useCharacterForm()

  // World Bible form
  const [wbGeography, setWbGeography] = useState("")
  const [wbMagic, setWbMagic] = useState("")
  const [wbTech, setWbTech] = useState("")
  const [wbCustoms, setWbCustoms] = useState("")
  const [wbLinguistics, setWbLinguistics] = useState("")
  const [wbFactions, setWbFactions] = useState("")
  const [wbTimeline, setWbTimeline] = useState("")

  // 动态世界观维度 + 提取
  const [aspects, setAspects] = useState<Array<{ id: string; name: string; content: string }>>([])
  const [isEditingWorldBible, setIsEditingWorldBible] = useState(false)
  const [showExtractModal, setShowExtractModal] = useState(false)
  const [selectedMaterialIdsForExtract, setSelectedMaterialIdsForExtract] = useState<number[]>([])
  const [extractPreview, setExtractPreview] = useState<{
    aspects: Array<{ id: string; name: string; content: string }>
    factions: Array<{ name: string; description: string }>
    timelineEvents: Array<{ order: number; description: string }>
  } | null>(null)

  // Canon form
  const [canonOrder, setCanonOrder] = useState("")
  const [canonDesc, setCanonDesc] = useState("")
  const [canonImmutable, setCanonImmutable] = useState(false)

  // Trope (桥段) form
  const [tropeName, setTropeName] = useState("")
  const [tropeDesc, setTropeDesc] = useState("")
  const [tropePattern, setTropePattern] = useState("")
  const [tropeTags, setTropeTags] = useState("")
  const [tropeExamples, setTropeExamples] = useState("")
  const [showTropeForm, setShowTropeForm] = useState(false)
  const [showTropeExtract, setShowTropeExtract] = useState(false)
  const [editingTropeId, setEditingTropeId] = useState<number | null>(null)

  // 桥段提取进度（后台异步）
  const [extractTaskId, setExtractTaskId] = useState<number | null>(null)
  const [showExtractProgress, setShowExtractProgress] = useState(false)

  // 角色重复检测与合并
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null)
  const [selectedMergeIds, setSelectedMergeIds] = useState<Set<number>>(new Set())
  // 预加载重复检测（不只弹窗时查询，用于角色卡片标记和顶部提示）
  const { data: duplicateData } = trpc.lore.character.findDuplicates.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )
  // 构建「角色 id → 重复组索引」映射，用于卡片标记
  const charIdToDuplicateGroup = new Map<number, number>()
  duplicateData?.groups?.forEach((group, idx) => {
    group.ids.forEach((id: number) => {
      if (!charIdToDuplicateGroup.has(id)) charIdToDuplicateGroup.set(id, idx)
    })
  })
  const mergeCharacters = trpc.lore.character.merge.useMutation({
    onSuccess: (data) => {
      utils.lore.character.list.invalidate()
      setShowMergeModal(false)
      setMergeTargetId(null)
      setSelectedMergeIds(new Set())
      toast.success(`合并完成！已将 ${data.mergedCount} 个角色合并到「${data.keepName}」。`)
    },
  })

  // 世界观维度重复检测与合并
  const [showAspectMergeModal, setShowAspectMergeModal] = useState(false)
  const [selectedAspectMergeGroupIds, setSelectedAspectMergeGroupIds] = useState<Set<string>>(new Set())
  const { data: aspectDuplicateData } = trpc.lore.worldBible.findDuplicateAspects.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )
  // 构建「维度 id → 重复组索引」映射，用于卡片标记
  const aspectIdToDuplicateGroup = new Map<string, number>()
  aspectDuplicateData?.groups?.forEach((group, idx) => {
    group.ids.forEach((id: string) => {
      if (!aspectIdToDuplicateGroup.has(id)) aspectIdToDuplicateGroup.set(id, idx)
    })
  })
  const mergeAspectsMutation = trpc.lore.worldBible.mergeAspects.useMutation({
    onSuccess: (data) => {
      utils.lore.worldBible.get.invalidate({ seriesId: selectedSeriesId || 0 })
      setShowAspectMergeModal(false)
      setSelectedAspectMergeGroupIds(new Set())
      toast.success(`合并完成！已合并 ${data.mergedCount} 个重复维度，剩余 ${data.remainingAspects} 个维度。`)
    },
  })

  const createSeries = trpc.lore.series.create.useMutation({
    onSuccess: () => {
      utils.lore.series.list.invalidate()
      setSeriesName(""); setSeriesDesc(""); setSeriesUniverse("")
      setShowSeriesForm(false)
    },
  })
  const updateSeries = trpc.lore.series.update.useMutation({
    onSuccess: () => {
      utils.lore.series.list.invalidate()
      setShowSeriesEdit(false)
    },
  })
  const deleteSeries = trpc.lore.series.delete.useMutation({
    onSuccess: () => {
      utils.lore.series.list.invalidate()
      setSelectedSeriesId(null)
    },
  })

  const createCharacter = trpc.lore.character.create.useMutation({
    onSuccess: () => {
      utils.lore.character.list.invalidate()
      resetCharForm()
      setShowCharForm(false)
    },
  })
  const updateCharacter = trpc.lore.character.update.useMutation({
    onSuccess: () => {
      utils.lore.character.list.invalidate()
      setShowCharEdit(null)
    },
  })
  const deleteCharacter = trpc.lore.character.delete.useMutation({
    onSuccess: () => utils.lore.character.list.invalidate(),
  })
  const extractStyleProfile = trpc.lore.character.extractStyleProfile.useMutation({
    onSuccess: (data) => {
      utils.lore.character.list.invalidate()
      toast.success(`风格提炼完成！高频用词: ${(data.vocabulary as string[] || []).join(", ")}；情感基调: ${data.emotionalTone}；对话风格: ${data.dialogueStyle}`)
    },
    onError: (err) => toast.error(err.message),
  })

  const { data: characters } = trpc.lore.character.list.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )
  const { data: worldBible } = trpc.lore.worldBible.get.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )
  const upsertWorldBible = trpc.lore.worldBible.createOrUpdate.useMutation({
    onSuccess: () => utils.lore.worldBible.get.invalidate({ seriesId: selectedSeriesId || 0 }),
  })
  const reorderAspectsMutation = trpc.lore.worldBible.reorderAspects.useMutation({
    onSuccess: () => utils.lore.worldBible.get.invalidate({ seriesId: selectedSeriesId || 0 }),
  })
  const { data: canonEvents } = trpc.lore.canon.list.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )
  const createCanon = trpc.lore.canon.create.useMutation({
    onSuccess: () => utils.lore.canon.list.invalidate({ seriesId: selectedSeriesId || 0 }),
  })
  const deleteCanon = trpc.lore.canon.delete.useMutation({
    onSuccess: () => utils.lore.canon.list.invalidate({ seriesId: selectedSeriesId || 0 }),
  })
  const reorderCanon = trpc.lore.canon.reorder.useMutation({
    onSuccess: () => utils.lore.canon.list.invalidate({ seriesId: selectedSeriesId || 0 }),
  })
  const summarizeWorldMutation = trpc.lore.summarizeWorld.useMutation({
    onSuccess: (data) => {
      setSummarizedWorld(data)
      setShowSummarizeModal(true)
    },
  })

  // 系列完整度统计
  const { data: seriesSummary } = trpc.lore.series.summary.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )

  // 批量补全（提取未提取素材）—— 异步轮询模式
  const [batchTaskId, setBatchTaskId] = useState<string | null>(null)

  const batchAutoExtractMutation = trpc.material.batchAutoExtract.useMutation({
    onSuccess: (data) => {
      setBatchTaskId(data.taskId)
    },
    onError: (err) => {
      toast.error(`补全启动失败：${err.message}`)
      setBatchTaskId(null)
    },
  })

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

  useEffect(() => {
    if (batchStatus?.status === "completed" || batchStatus?.status === "failed") {
      utils.lore.character.list.invalidate()
      utils.lore.worldBible.get.invalidate()
      utils.lore.series.summary.invalidate({ seriesId: selectedSeriesId || 0 })
      if (batchStatus.status === "completed") {
        toast.success(`一键补全完成：处理 ${batchStatus.total} 条素材，新增 ${batchStatus.charactersAdded} 个角色，合并 ${batchStatus.charactersMerged} 个角色`)
      } else if (batchStatus.status === "failed") {
        toast.error(`补全失败：${batchStatus.errors?.join("\n") || "未知错误"}`)
      }
      setBatchTaskId(null)
    }
  }, [batchStatus])

  // 桥段
  const { data: tropesList } = trpc.trope.list.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )
  const createTrope = trpc.trope.create.useMutation({
    onSuccess: () => {
      utils.trope.list.invalidate({ seriesId: selectedSeriesId || 0 })
      resetTropeForm()
      setShowTropeForm(false)
    },
  })
  const updateTrope = trpc.trope.update.useMutation({
    onSuccess: () => {
      utils.trope.list.invalidate({ seriesId: selectedSeriesId || 0 })
      setEditingTropeId(null)
    },
  })
  const deleteTrope = trpc.trope.delete.useMutation({
    onSuccess: () => utils.trope.list.invalidate({ seriesId: selectedSeriesId || 0 }),
  })
  const extractTropesMutation = trpc.trope.extract.useMutation({
    onSuccess: (data) => {
      setShowTropeExtract(false)
      setExtractTaskId(data.taskId)
      setShowExtractProgress(true)
    },
  })

  // 轮询提取任务状态
  const { data: extractStatusData } = trpc.trope.extractStatus.useQuery(
    { taskId: extractTaskId || 0 },
    {
      enabled: !!extractTaskId && showExtractProgress,
      refetchInterval: 2000,
    }
  )

  // 提取完成后自动刷新桥段列表
  useEffect(() => {
    if (extractStatusData?.status === "completed") {
      utils.trope.list.invalidate({ seriesId: selectedSeriesId || 0 })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractStatusData?.status])

  // 世界观数据加载：查询返回后自动同步到本地表单 state
  useEffect(() => {
    if (worldBible) {
      setWbGeography(worldBible.geography || "")
      setWbMagic(worldBible.magicSystem || "")
      setWbTech(worldBible.technologyLevel || "")
      setWbCustoms(worldBible.culturalCustoms || "")
      setWbLinguistics(worldBible.linguisticNotes || "")
      setWbFactions(JSON.stringify(worldBible.factions || [], null, 2))
      setWbTimeline(JSON.stringify(worldBible.timelineEvents || [], null, 2))
      setAspects((worldBible.aspects || []) as Array<{ id: string; name: string; content: string }>)
    } else {
      // 无世界观时清空表单
      setWbGeography("")
      setWbMagic("")
      setWbTech("")
      setWbCustoms("")
      setWbLinguistics("")
      setWbFactions("")
      setWbTimeline("")
      setAspects([])
    }
  }, [worldBible])

  // 切换系列或离开世界观 tab 时退出编辑模式
  useEffect(() => {
    setIsEditingWorldBible(false)
  }, [selectedSeriesId, activeTab])

  const resetTropeForm = () => {
    setTropeName("")
    setTropeDesc("")
    setTropePattern("")
    setTropeTags("")
    setTropeExamples("")
    setEditingTropeId(null)
  }

  const handleCreateTrope = () => {
    if (!selectedSeriesId || !tropeName.trim()) return
    createTrope.mutate({
      seriesId: selectedSeriesId,
      name: tropeName.trim(),
      description: tropeDesc.trim() || undefined,
      pattern: tropePattern.trim() || undefined,
      tags: tropeTags.split(",").map(s => s.trim()).filter(Boolean),
      examples: tropeExamples.split("\n").map(s => s.trim()).filter(Boolean),
    })
  }

  const handleUpdateTrope = (id: number) => {
    updateTrope.mutate({
      id,
      name: tropeName.trim() || undefined,
      description: tropeDesc.trim() || undefined,
      pattern: tropePattern.trim() || undefined,
      tags: tropeTags.split(",").map(s => s.trim()).filter(Boolean),
      examples: tropeExamples.split("\n").map(s => s.trim()).filter(Boolean),
    })
  }

  const openTropeEdit = (trope: NonNullable<typeof tropesList>[number]) => {
    setEditingTropeId(trope.id)
    setTropeName(trope.name)
    setTropeDesc(trope.description || "")
    setTropePattern(trope.pattern || "")
    setTropeTags((trope.tags as string[] || []).join(", "))
    setTropeExamples((trope.examples as string[] || []).join("\n"))
    setShowTropeForm(true)
  }

  // 素材列表（用于提取世界观）
  const { data: seriesMaterials } = trpc.material.list.useQuery(
    { seriesId: selectedSeriesId || undefined },
    { enabled: !!selectedSeriesId }
  )
  const extractWorldMutation = trpc.lore.worldBible.extract.useMutation({
    onSuccess: (data) => {
      setExtractPreview({
        aspects: data.aspects,
        factions: data.factions,
        timelineEvents: data.timelineEvents,
      })
    },
  })

  const selectedSeries = seriesList?.find(s => s.id === selectedSeriesId)

  const resetCharForm = () => charForm.reset()

  const handleCreateSeries = () => {
    if (!seriesName.trim()) return
    createSeries.mutate({ name: seriesName, description: seriesDesc || undefined, universeName: seriesUniverse || undefined })
  }

  const handleUpdateSeries = () => {
    if (!selectedSeriesId || !seriesName.trim()) return
    updateSeries.mutate({ id: selectedSeriesId, name: seriesName, description: seriesDesc || undefined, universeName: seriesUniverse || undefined })
  }

  const handleCreateCharacter = () => {
    if (!selectedSeriesId) return
    const data = charForm.getValues()
    if (!data.name.trim()) return
    createCharacter.mutate({
      seriesId: selectedSeriesId,
      ...formDataToCharacterPayload(data),
    })
  }

  const handleUpdateCharacter = (charId: number) => {
    const data = charForm.getValues()
    updateCharacter.mutate({
      id: charId,
      ...formDataToCharacterPayload(data),
    })
  }

  const handleUpsertWorldBible = () => {
    if (!selectedSeriesId) return
    upsertWorldBible.mutate({
      seriesId: selectedSeriesId,
      geography: wbGeography || undefined,
      magicSystem: wbMagic || undefined,
      technologyLevel: wbTech || undefined,
      culturalCustoms: wbCustoms || undefined,
      linguisticNotes: wbLinguistics || undefined,
      factions: wbFactions ? JSON.parse(wbFactions) : undefined,
      timelineEvents: wbTimeline ? JSON.parse(wbTimeline) : undefined,
      aspects: aspects.length > 0 ? aspects : undefined,
    })
  }

  const handleCreateCanon = () => {
    if (!selectedSeriesId || !canonDesc.trim()) return
    createCanon.mutate({
      seriesId: selectedSeriesId,
      eventOrder: parseInt(canonOrder, 10) || 1,
      description: canonDesc,
      isImmutable: canonImmutable,
    })
    setCanonOrder(""); setCanonDesc(""); setCanonImmutable(false)
  }

  const openCharEdit = (char: NonNullable<typeof characters>[number]) => {
    setShowCharEdit(char.id)
    charForm.reset({
      name: char.name,
      aliases: (char.aliases as string[] || []).join(", "),
      age: char.age || "",
      personality: (char.personalityTraits as string[] || []).join(", "),
      motivations: char.coreMotivations || "",
      speech: char.speechPatterns || "",
      taboos: (char.taboos as string[] || []).join(", "),
      arc: char.canonicalArcSummary || "",
    })
  }

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <NavBar />
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold">设定库</h1>
            <p className="text-white/50 mt-2 font-mono text-sm">管理系列世界观、角色卡与正史记事</p>
          </div>
          <button
            onClick={() => { setShowSeriesForm(!showSeriesForm); setSeriesName(""); }}
            className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            创建系列
          </button>
        </div>

        {showSeriesForm && (
          <div className="mb-8 p-6 rounded-xl bg-white/5 border border-white/10">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">系列名称</label>
                <input value={seriesName} onChange={e => setSeriesName(e.target.value)} className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" placeholder="如：玄幻修仙系列" />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">世界观名</label>
                <input value={seriesUniverse} onChange={e => setSeriesUniverse(e.target.value)} className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" placeholder="如：斗气大陆" />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">描述</label>
                <input value={seriesDesc} onChange={e => setSeriesDesc(e.target.value)} className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" placeholder="系列简介" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleCreateSeries} className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium">创建</button>
              <button onClick={() => setShowSeriesForm(false)} className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full">取消</button>
            </div>
          </div>
        )}

        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="lg:hidden mb-4 flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/5 text-sm text-white/70 min-h-[44px]"
        >
          <Library className="w-4 h-4" />
          {sidebarOpen ? "收起系列" : "选择系列"}
        </button>

        <div className="flex flex-col lg:flex-row gap-8">
          <aside className={`${sidebarOpen ? "block" : "hidden"} lg:block w-full lg:w-72 shrink-0 mb-6 lg:mb-0`}>
            <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 mb-4">系列列表</h2>
            <div className="space-y-2">
              {seriesList?.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedSeriesId(s.id); setActiveTab("characters"); }}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-colors flex items-center gap-3 ${
                    s.id === selectedSeriesId
                      ? "bg-amber-500/20 border border-amber-500/30"
                      : "bg-white/[0.03] border border-transparent hover:bg-white/[0.05]"
                  }`}
                >
                  <BookMarked className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-sm">{s.name}</div>
                    {s.universeName && <div className="text-xs text-white/50 truncate">{s.universeName}</div>}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="flex-1">
            {selectedSeriesId ? (
              <>
                {/* Series header */}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="font-serif text-xl font-semibold">{selectedSeries?.name}</h2>
                    {selectedSeries?.universeName && <p className="text-white/40 text-sm font-mono mt-1">{selectedSeries.universeName}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setShowSeriesEdit(true)
                        setSeriesName(selectedSeries?.name || "")
                        setSeriesDesc(selectedSeries?.description || "")
                        setSeriesUniverse(selectedSeries?.universeName || "")
                      }}
                      className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/70 transition-colors"
                      title="编辑系列"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm("删除系列将同时删除所有关联角色、世界观和正史，确认？")) deleteSeries.mutate({ id: selectedSeriesId }); }}
                      className="p-2 rounded-lg hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-colors"
                      title="删除系列"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 完整度提示面板 */}
                {seriesSummary && (
                  <div className="mb-6 p-4 rounded-xl bg-white/[0.03] border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">📊 「{selectedSeries?.name}」设定完整度</span>
                      </div>
                      {seriesSummary.materialCount > 0 && (
                        <span className="text-xs font-mono text-white/40">
                          素材 {seriesSummary.materialCount} 条
                        </span>
                      )}
                    </div>
                    <div className="flex items-start gap-6">
                      <div className="flex items-center gap-6 flex-wrap py-2">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-sm"><span className="font-semibold text-amber-400">{seriesSummary.characterCount}</span> <span className="text-white/50 text-xs">角色</span></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-sm"><span className="font-semibold text-amber-400">{seriesSummary.worldBibleAspectCount}</span> <span className="text-white/50 text-xs">世界观维度</span></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-sm"><span className="font-semibold text-amber-400">{seriesSummary.canonEventCount}</span> <span className="text-white/50 text-xs">正史</span></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Theater className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-sm"><span className="font-semibold text-amber-400">{seriesSummary.tropeCount}</span> <span className="text-white/50 text-xs">桥段</span></span>
                        </div>
                      </div>
                      <div className="w-full sm:w-48 shrink-0 -my-2">
                        <LoreStatsChart stats={seriesSummary} />
                      </div>
                    </div>
                    {/* 疑似重复角色提示 */}
                    {(duplicateData?.duplicateCount ?? 0) > 0 && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-3">
                        <span className="text-sm text-red-400 flex items-center gap-1.5">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                          发现 <span className="font-semibold">{duplicateData?.duplicateCount}</span> 组疑似重复角色
                        </span>
                        <button
                          onClick={() => {
                            // 自动选择第一组的推荐保留角色
                            const firstGroup = duplicateData?.groups[0]
                            if (firstGroup) {
                              setMergeTargetId(firstGroup.recommendedKeepId)
                              setSelectedMergeIds(new Set(firstGroup.ids.filter((id: number) => id !== firstGroup.recommendedKeepId)))
                            }
                            setShowMergeModal(true)
                          }}
                          className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-full text-xs font-medium transition-colors"
                        >
                          查看并合并
                        </button>
                      </div>
                    )}
                    {/* 疑似重复世界观维度提示 */}
                    {(aspectDuplicateData?.duplicateCount ?? 0) > 0 && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-3">
                        <span className="text-sm text-amber-400 flex items-center gap-1.5">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                          发现 <span className="font-semibold">{aspectDuplicateData?.duplicateCount}</span> 组疑似重复世界观维度
                        </span>
                        <button
                          onClick={() => {
                            setShowAspectMergeModal(true)
                            setSelectedAspectMergeGroupIds(new Set())
                          }}
                          className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-full text-xs font-medium transition-colors"
                        >
                          查看并合并
                        </button>
                      </div>
                    )}
                    {/* 素材提取提示 */}
                    {seriesSummary.materialCount > 0 && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <span className="text-sm text-amber-400">
                          该系列有 <span className="font-semibold">{seriesSummary.materialCount}</span> 条素材可提取设定
                        </span>
                        <button
                          onClick={() => {
                            if (!selectedSeriesId) return
                            const ids = seriesMaterials?.map(m => m.id) || []
                            if (ids.length === 0) {
                              toast.warning("该系列下暂无素材")
                              return
                            }
                            if (confirm(`确定一键提取该系列下 ${ids.length} 条素材的设定？同名角色将自动合并。`)) {
                              batchAutoExtractMutation.mutate({
                                materialIds: ids,
                                seriesId: selectedSeriesId,
                              })
                            }
                          }}
                          disabled={batchAutoExtractMutation.isPending || (batchTaskId !== null && batchStatus?.status === "running")}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full text-xs font-medium transition-colors"
                        >
                          {batchAutoExtractMutation.isPending || (batchTaskId !== null && batchStatus?.status === "running") ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          {batchTaskId !== null && batchStatus?.status === "running"
                            ? `提取中 ${batchStatus.processed}/${batchStatus.total}`
                            : "一键提取全部"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Tabs */}
                <div className="flex gap-1 mb-6 bg-white/5 rounded-full p-0.5 w-fit overflow-x-auto max-w-full scrollbar-hide">
                  {[
                    { key: "characters" as const, label: "角色卡", icon: Users },
                    { key: "world" as const, label: "世界观", icon: Globe },
                    { key: "canon" as const, label: "正史", icon: Calendar },
                    { key: "tropes" as const, label: "桥段库", icon: Theater },
                  ].map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm transition-colors ${
                        activeTab === key
                          ? "bg-amber-500/20 text-amber-400"
                          : "text-white/40 hover:text-white/60"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>

                {/* Characters Tab */}
                {activeTab === "characters" && (
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white/50 flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        角色卡 ({characters?.length || 0})
                      </h3>
                      <div className="flex items-center gap-2">
                        {selectedCharIds.size > 0 && (
                          <button
                            onClick={() => {
                              if (!selectedSeriesId) return
                              summarizeWorldMutation.mutate({
                                characterIds: Array.from(selectedCharIds),
                                seriesId: selectedSeriesId,
                              })
                            }}
                            disabled={summarizeWorldMutation.isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-full text-sm transition-colors"
                          >
                            {summarizeWorldMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                            总结世界观 ({selectedCharIds.size})
                          </button>
                        )}
                        {summarizeWorldMutation.isPending && (
                          <AiProgressBar
                            variant="indeterminate"
                            title="AI 总结世界观中"
                            description="正在整合设定库中的世界观维度..."
                            className="mt-3"
                          />
                        )}
                        {characters && characters.length > 0 && (
                          <button
                            onClick={() => {
                              if (selectedCharIds.size === characters.length) {
                                setSelectedCharIds(new Set())
                              } else {
                                setSelectedCharIds(new Set(characters.map(c => c.id)))
                              }
                            }}
                            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors text-white/60"
                          >
                            {selectedCharIds.size === characters.length ? (
                              <><CheckSquare className="w-4 h-4" /> 取消全选</>
                            ) : (
                              <><Square className="w-4 h-4" /> 全选</>
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => { setShowCharForm(!showCharForm); resetCharForm(); }}
                          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          添加角色
                        </button>
                        <button
                          onClick={() => { setShowMergeModal(true); setMergeTargetId(null); setSelectedMergeIds(new Set()); }}
                          disabled={!characters || characters.length < 2}
                          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-full text-sm transition-colors text-white/60"
                        >
                          <Sparkles className="w-4 h-4" />
                          检测重复
                        </button>
                      </div>
                    </div>

                    {showCharForm && (
                      <div className="mb-6 p-5 rounded-xl bg-white/5 border border-white/10 space-y-3">
                        <CharFormFields control={charForm.control} />
                        <div className="flex gap-3 pt-2">
                          <button onClick={handleCreateCharacter} className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium text-sm">创建</button>
                          <button onClick={() => setShowCharForm(false)} className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm">取消</button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {characters?.map(char => (
                        <div key={char.id} className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-amber-500/20 transition-all"
>
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => {
                                  const next = new Set(selectedCharIds)
                                  if (next.has(char.id)) next.delete(char.id)
                                  else next.add(char.id)
                                  setSelectedCharIds(next)
                                }}
                                className={`mt-1 p-0.5 rounded transition-colors ${
                                  selectedCharIds.has(char.id)
                                    ? "text-amber-400"
                                    : "text-white/20 hover:text-white/40"
                                }`}
                                title={selectedCharIds.has(char.id) ? "取消选择" : "选择"}
                              >
                                {selectedCharIds.has(char.id) ? (
                                  <CheckSquare className="w-4 h-4" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h3 className="font-serif text-lg font-semibold">{char.name}</h3>
                                  {charIdToDuplicateGroup.has(char.id) && (
                                    <button
                                      onClick={() => {
                                        const groupIdx = charIdToDuplicateGroup.get(char.id)!
                                        const group = duplicateData!.groups[groupIdx]
                                        // 自动选择推荐的保留角色
                                        setMergeTargetId(group.recommendedKeepId)
                                        setSelectedMergeIds(new Set(group.ids.filter((id: number) => id !== group.recommendedKeepId)))
                                        setShowMergeModal(true)
                                      }}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs hover:bg-amber-500/20 transition-colors"
                                      title="该角色可能与列表中其他角色重复，点击查看"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                                      疑似重复
                                    </button>
                                  )}
                                </div>
                                {char.age && <p className="text-white/50 text-xs font-mono mt-0.5">{char.age}岁</p>}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <button
                                onClick={() => openCharEdit(char)}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/70 transition-colors"
                                title="编辑"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => { if (confirm("确认删除角色？")) deleteCharacter.mutate({ id: char.id }); }}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-colors"
                                title="删除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {(char.aliases as string[] || []).length > 0 && (
                            <p className="text-white/50 text-xs font-mono mb-2">别名: {(char.aliases as string[]).join(", ")}</p>
                          )}

                          <div className="flex flex-wrap gap-2 mb-3">
                            {(char.personalityTraits as string[] || []).map((trait: string) => (
                              <span key={trait} className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-mono">
                                {trait}
                              </span>
                            ))}
                          </div>

                          {char.coreMotivations && (
                            <p className="text-white/50 text-sm mb-2">{char.coreMotivations}</p>
                          )}
                          {char.speechPatterns && (
                            <p className="text-white/50 text-xs font-mono mb-1">语言风格: {char.speechPatterns}</p>
                          )}
                          {(char.taboos as string[] || []).length > 0 && (
                            <p className="text-red-400/40 text-xs font-mono">禁忌: {(char.taboos as string[]).join(", ")}</p>
                          )}
                          {char.canonicalArcSummary && (
                            <p className="text-white/20 text-xs mt-2 line-clamp-2">{char.canonicalArcSummary}</p>
                          )}

                          {/* 风格自动提炼按钮 */}
                          <button
                            onClick={() => {
                              if (selectedSeriesId) {
                                extractStyleProfile.mutate({ seriesId: selectedSeriesId, characterName: char.name })
                              }
                            }}
                            disabled={extractStyleProfile.isPending}
                            className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-amber-500/20 text-white/50 hover:text-amber-400 text-xs transition-colors disabled:opacity-30"
                          >
                            {extractStyleProfile.isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Sparkles className="w-3 h-3" />
                            )}
                            分析风格样本
                          </button>
                          {extractStyleProfile.isPending && (
                            <AiProgressBar
                              variant="indeterminate"
                              title="AI 分析角色风格中"
                              description="正在阅读角色样本并提炼语言风格特征..."
                              className="mt-3"
                            />
                          )}

                          {/* Edit inline form */}
                          {showCharEdit === char.id && (
                            <div className="mt-4 p-4 rounded-lg bg-white/5 border border-amber-500/20 space-y-3">
                              <CharFormFields control={charForm.control} />
                              <div className="flex gap-2">
                                <button onClick={() => handleUpdateCharacter(char.id)} className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full text-xs font-medium">保存</button>
                                <button onClick={() => setShowCharEdit(null)} className="px-4 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs">取消</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* World Bible Tab */}
                {activeTab === "world" && (
                  <div className="space-y-6">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white/50 flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        世界观圣经
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setShowExtractModal(true)
                            setExtractPreview(null)
                            setSelectedMaterialIdsForExtract([])
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors text-white/60"
                        >
                          <Database className="w-3.5 h-3.5" />
                          从素材提取
                        </button>
                        {!isEditingWorldBible && worldBible && (
                          <>
                            <button
                              onClick={() => { setShowAspectMergeModal(true); setSelectedAspectMergeGroupIds(new Set()); }}
                              disabled={!aspects || aspects.length < 2}
                              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-full text-sm transition-colors text-white/60"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              检测重复
                            </button>
                            <button
                              onClick={() => setIsEditingWorldBible(true)}
                              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors"
                            >
                              <Edit className="w-3.5 h-3.5 inline mr-1" /> 编辑
                            </button>
                          </>
                        )}
                        {!isEditingWorldBible && !worldBible && (
                          <button
                            onClick={() => setIsEditingWorldBible(true)}
                            className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-full text-sm transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5 inline mr-1" /> 添加世界观
                          </button>
                        )}
                        {isEditingWorldBible && (
                          <button
                            onClick={() => setIsEditingWorldBible(false)}
                            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors text-white/60"
                          >
                            <X className="w-3.5 h-3.5 inline mr-1" /> 取消
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 编辑模式 */}
                    {isEditingWorldBible ? (
                      <div className="space-y-6">
                        {/* 动态维度列表 */}
                        <div className="space-y-3">
                          <SortableList
                            items={aspects}
                            onReorder={(ordered) => {
                              setAspects(ordered)
                              if (selectedSeriesId && worldBible) {
                                reorderAspectsMutation.mutate({
                                  seriesId: selectedSeriesId,
                                  aspects: ordered,
                                })
                              }
                            }}
                            renderItem={(aspect, idx) => (
                              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                                <div className="flex items-center gap-2 mb-2">
                                  <input
                                    value={aspect.name}
                                    onChange={e => {
                                      const next = [...aspects]
                                      next[idx] = { ...aspect, name: e.target.value }
                                      setAspects(next)
                                    }}
                                    placeholder="维度名称，如：斗气体系"
                                    className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm font-medium"
                                  />
                                  <button
                                    onClick={() => setAspects(prev => prev.filter((_, i) => i !== idx))}
                                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <RichTextEditor
                                  value={aspect.content}
                                  onChange={(value) => {
                                    const next = [...aspects]
                                    next[idx] = { ...aspect, content: value }
                                    setAspects(next)
                                  }}
                                  placeholder="详细描述..."
                                  minHeight="80px"
                                  plainText
                                />
                              </div>
                            )}
                          />
                          <button
                            onClick={() => setAspects(prev => [...prev, { id: `aspect_${Date.now()}_${prev.length}`, name: "", content: "" }])}
                            className="w-full py-2.5 rounded-xl border border-dashed border-white/10 hover:border-amber-500/30 text-white/40 hover:text-amber-400 transition-colors text-sm flex items-center justify-center gap-2"
                          >
                            <Plus className="w-4 h-4" /> 添加维度
                          </button>
                        </div>

                        {/* 势力 & 时间线 */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/10">
                          <div>
                            <label className="block font-mono text-xs text-white/50 mb-2">势力分布 (JSON)</label>
                            <textarea
                              value={wbFactions}
                              onChange={e => setWbFactions(e.target.value)}
                              placeholder='[{"name": "势力名", "description": "描述"}]'
                              className="w-full h-24 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none font-mono placeholder:text-white/40"
                            />
                          </div>
                          <div>
                            <label className="block font-mono text-xs text-white/50 mb-2">时间线事件 (JSON)</label>
                            <textarea
                              value={wbTimeline}
                              onChange={e => setWbTimeline(e.target.value)}
                              placeholder='[{"order": 1, "description": "事件描述"}]'
                              className="w-full h-24 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none font-mono placeholder:text-white/40"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            onClick={handleUpsertWorldBible}
                            disabled={upsertWorldBible.isPending}
                            className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm"
                          >
                            {upsertWorldBible.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                            <Save className="w-4 h-4" /> 保存世界观
                          </button>
                          <button
                            onClick={() => setIsEditingWorldBible(false)}
                            className="px-6 py-2.5 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : worldBible ? (
                      /* 查看模式 */
                      <div className="space-y-6">
                        {/* 维度列表 */}
                        {aspects.length > 0 && (
                          <div className="space-y-3">
                            {aspects.map((aspect) => (
                              <div key={aspect.id} className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                                <div className="flex items-center gap-2 mb-2">
                                  <h4 className="text-sm font-medium text-amber-400">{aspect.name}</h4>
                                  {aspectIdToDuplicateGroup.has(aspect.id) && (
                                    <button
                                      onClick={() => {
                                        setShowAspectMergeModal(true)
                                        setSelectedAspectMergeGroupIds(new Set())
                                      }}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs hover:bg-amber-500/20 transition-colors"
                                      title="该维度可能与列表中其他维度重复，点击查看"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                                      疑似重复
                                    </button>
                                  )}
                                </div>
                                <div className="text-sm text-white/70 whitespace-pre-wrap">{aspect.content}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 势力 */}
                        {(worldBible.factions as Array<{ name: string; description: string }> || []).length > 0 && (
                          <div className="pt-4 border-t border-white/10">
                            <h4 className="text-sm font-medium text-white/50 mb-3">势力分布</h4>
                            <div className="space-y-2">
                              {(worldBible.factions as Array<{ name: string; description: string }>).map((f, i) => (
                                <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/10">
                                  <span className="text-sm font-medium text-[#FDFBF5]">{f.name}</span>
                                  <p className="text-xs text-white/50 mt-1">{f.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* 时间线 */}
                        {(worldBible.timelineEvents as Array<{ order: number; description: string }> || []).length > 0 && (
                          <div className="pt-4 border-t border-white/10">
                            <h4 className="text-sm font-medium text-white/50 mb-3">时间线</h4>
                            <div className="space-y-2">
                              {(worldBible.timelineEvents as Array<{ order: number; description: string }>)
                                .sort((a, b) => a.order - b.order)
                                .map((e, i) => (
                                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                                    <span className="text-xs font-mono text-amber-500 shrink-0 w-6">{e.order}</span>
                                    <p className="text-sm text-white/70">{e.description}</p>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                        {/* 空维度提示 */}
                        {aspects.length === 0 &&
                          (worldBible.factions as Array<unknown> || []).length === 0 &&
                          (worldBible.timelineEvents as Array<unknown> || []).length === 0 && (
                          <div className="text-center py-12 text-white/30">
                            <Globe className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            <p className="text-sm">世界观内容为空，点击"编辑"开始添加</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* 空状态 */
                      <div className="text-center py-16 text-white/30">
                        <Globe className="w-12 h-12 mx-auto mb-4 opacity-40" />
                        <p className="text-sm mb-2">暂无世界观设定</p>
                        <p className="text-xs text-white/20">点击"添加世界观"手动创建，或"从素材提取"让 AI 自动生成</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Canon Tab */}
                {activeTab === "canon" && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white/50 flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        正史记事
                      </h3>
                    </div>

                    <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                      <div className="flex gap-3">
                        <div className="w-20">
                          <label className="block font-mono text-xs text-white/50 mb-1">顺序</label>
                          <input
                            type="number"
                            value={canonOrder}
                            onChange={e => setCanonOrder(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                            placeholder="#"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block font-mono text-xs text-white/50 mb-1">事件描述</label>
                          <input
                            value={canonDesc}
                            onChange={e => setCanonDesc(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                            placeholder="事件描述..."
                          />
                        </div>
                        <div className="flex items-end">
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="checkbox"
                              id="immutable"
                              checked={canonImmutable}
                              onChange={e => setCanonImmutable(e.target.checked)}
                              className="w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500"
                            />
                            <label htmlFor="immutable" className="text-xs text-white/50">不可变</label>
                          </div>
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={handleCreateCanon}
                            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full text-sm font-medium"
                          >
                            添加
                          </button>
                        </div>
                      </div>
                    </div>

                    <SortableList
                      items={canonEvents || []}
                      onReorder={(ordered) => {
                        if (!selectedSeriesId) return
                        reorderCanon.mutate({
                          seriesId: selectedSeriesId,
                          orderedIds: ordered.map(e => e.id),
                        })
                      }}
                      renderItem={(event) => (
                        <div
                          className={`p-4 rounded-xl border ${event.isImmutable ? "border-amber-500/20 bg-amber-500/5" : "border-white/10 bg-white/[0.02]"} flex items-start justify-between`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="font-mono text-xs text-amber-500/60 mt-0.5">#{event.eventOrder}</span>
                            <div>
                              <p className="text-sm">{event.description}</p>
                              {event.isImmutable && <span className="text-xs text-amber-400/60 font-mono mt-1 inline-block">不可变</span>}
                            </div>
                          </div>
                          <button
                            onClick={() => { if (confirm("确认删除此事件？")) deleteCanon.mutate({ id: event.id }); }}
                            className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/20 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    />
                  </div>
                )}

                {/* Tropes Tab */}
                {activeTab === "tropes" && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white/50 flex items-center gap-2">
                        <Theater className="w-4 h-4" />
                        桥段库
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowTropeExtract(true)}
                          disabled={extractTropesMutation.isPending}
                          className="flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 rounded-full text-sm font-medium transition-colors"
                        >
                          {extractTropesMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          AI 提取
                        </button>
                        <button
                          onClick={() => { resetTropeForm(); setShowTropeForm(true); }}
                          className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full text-sm font-medium transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> 新建
                        </button>
                      </div>
                    </div>

                    {tropesList && tropesList.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3">
                        {tropesList.map((trope) => (
                          <div
                            key={trope.id}
                            className="p-4 rounded-xl border border-white/10 bg-white/[0.02] hover:border-white/20 transition-colors"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <h4 className="font-serif text-base font-semibold text-[#FDFBF5]">{trope.name}</h4>
                                {(trope.tags as string[] || []).map(tag => (
                                  <span key={tag} className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-mono">{tag}</span>
                                ))}
                                {((trope as unknown as { usageCount?: number }).usageCount ?? 0) > 0 && (
                                  <span className="px-2 py-0.5 rounded-full bg-white/5 text-white/40 text-xs font-mono">使用 {(trope as unknown as { usageCount: number }).usageCount} 次</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => openTropeEdit(trope)}
                                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/70 transition-colors"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => { if (confirm(`确认删除桥段「${trope.name}」？`)) deleteTrope.mutate({ id: trope.id }); }}
                                  className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            {trope.description && <p className="text-sm text-white/70 mb-2">{trope.description}</p>}
                            {trope.pattern && (
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-mono text-xs text-amber-500/60">模式</span>
                                <span className="text-xs text-white/50">{trope.pattern}</span>
                              </div>
                            )}
                            {/* 关联角色 */}
                            {(trope as unknown as { linkedCharacters?: Array<{ id: number; name: string; role: string | null }> }).linkedCharacters &&
                             (trope as unknown as { linkedCharacters: Array<{ id: number; name: string; role: string | null }> }).linkedCharacters.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                <span className="text-[10px] font-mono text-white/30">涉及角色:</span>
                                {(trope as unknown as { linkedCharacters: Array<{ id: number; name: string; role: string | null }> }).linkedCharacters.map(lc => (
                                  <span key={lc.id} className="px-2 py-0.5 rounded-full bg-white/5 text-white/50 text-[10px] font-mono">
                                    {lc.name}{lc.role ? ` · ${lc.role}` : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                            {/* 来源素材 */}
                            {(trope as unknown as { sourceChunks?: Array<{ title: string; type: string }> }).sourceChunks &&
                             (trope as unknown as { sourceChunks: Array<{ title: string; type: string }> }).sourceChunks.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                <span className="text-[10px] font-mono text-white/30">来源:</span>
                                {(trope as unknown as { sourceChunks: Array<{ title: string; type: string }> }).sourceChunks.map((sc, i) => (
                                  <span key={i} className="px-2 py-0.5 rounded-full bg-white/5 text-white/40 text-[10px] font-mono">{sc.title}</span>
                                ))}
                              </div>
                            )}
                            {(trope.examples as string[] || []).length > 0 && (
                              <div className="mt-2 space-y-1">
                                <span className="font-mono text-xs text-white/40">素材佐证</span>
                                {(trope.examples as string[]).map((ex, i) => (
                                  <p key={i} className="text-xs text-white/40 pl-2 border-l-2 border-white/10">{ex}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-16 text-white/30">
                        <Theater className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p className="text-sm">暂无桥段</p>
                        <p className="text-xs mt-1">使用「AI 提取」从素材中自动提取，或手动创建</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center text-white/50 py-20">
                <Globe className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>选择一个系列以查看设定</p>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Series Edit Modal */}
      {showSeriesEdit && selectedSeries && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-semibold">编辑系列</h3>
              <button onClick={() => setShowSeriesEdit(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 mb-4">
              <input value={seriesName} onChange={e => setSeriesName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" placeholder="系列名称" />
              <input value={seriesUniverse} onChange={e => setSeriesUniverse(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" placeholder="世界观名" />
              <input value={seriesDesc} onChange={e => setSeriesDesc(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" placeholder="描述" />
            </div>
            <div className="flex gap-3">
              <button onClick={handleUpdateSeries} className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium text-sm">保存</button>
              <button onClick={() => setShowSeriesEdit(false)} className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Summarize World Modal */}
      <Modal
        open={showSummarizeModal}
        onClose={() => setShowSummarizeModal(false)}
        title="AI 世界观总结"
        icon={<Sparkles className="w-5 h-5" />}
        maxWidth="3xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <p className="text-xs text-white/40">
              基于 {selectedCharIds.size} 位角色卡推理
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSummarizeModal(false)}
                className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (!selectedSeriesId || !summarizedWorld) return
                  upsertWorldBible.mutate(
                    {
                      seriesId: selectedSeriesId,
                      geography: summarizedWorld.geography || undefined,
                      magicSystem: summarizedWorld.magicSystem || undefined,
                      technologyLevel: summarizedWorld.technologyLevel || undefined,
                      culturalCustoms: summarizedWorld.culturalCustoms || undefined,
                      linguisticNotes: summarizedWorld.linguisticNotes || undefined,
                      factions: summarizedWorld.factions.length > 0 ? summarizedWorld.factions : undefined,
                      timelineEvents: summarizedWorld.timelineEvents.length > 0 ? summarizedWorld.timelineEvents : undefined,
                    },
                    {
                      onSuccess: () => {
                        setShowSummarizeModal(false)
                        setSelectedCharIds(new Set())
                      },
                    }
                  )
                }}
                disabled={upsertWorldBible.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-[#111827] rounded-full font-medium text-sm transition-colors"
              >
                {upsertWorldBible.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" /> 保存到世界观圣经
              </button>
            </div>
          </div>
        }
      >
        {summarizedWorld && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1.5">地理环境</label>
                <textarea
                  value={summarizedWorld.geography || ""}
                  onChange={e => setSummarizedWorld(prev => prev ? { ...prev, geography: e.target.value } : null)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/30"
                  placeholder="未推断出地理环境..."
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1.5">力量体系</label>
                <textarea
                  value={summarizedWorld.magicSystem || ""}
                  onChange={e => setSummarizedWorld(prev => prev ? { ...prev, magicSystem: e.target.value } : null)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/30"
                  placeholder="未推断出力量体系..."
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1.5">科技水平</label>
                <textarea
                  value={summarizedWorld.technologyLevel || ""}
                  onChange={e => setSummarizedWorld(prev => prev ? { ...prev, technologyLevel: e.target.value } : null)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/30"
                  placeholder="未推断出科技水平..."
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1.5">文化习俗</label>
                <textarea
                  value={summarizedWorld.culturalCustoms || ""}
                  onChange={e => setSummarizedWorld(prev => prev ? { ...prev, culturalCustoms: e.target.value } : null)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/30"
                  placeholder="未推断出文化习俗..."
                />
              </div>
            </div>
            <div>
              <label className="block font-mono text-xs text-white/50 mb-1.5">语言 / 命名规则</label>
              <textarea
                value={summarizedWorld.linguisticNotes || ""}
                onChange={e => setSummarizedWorld(prev => prev ? { ...prev, linguisticNotes: e.target.value } : null)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/30"
                placeholder="未推断出语言体系..."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1.5">势力分布 (JSON)</label>
                <textarea
                  value={JSON.stringify(summarizedWorld.factions, null, 2)}
                  onChange={e => {
                    try {
                      const parsed = JSON.parse(e.target.value)
                      setSummarizedWorld(prev => prev ? { ...prev, factions: parsed } : null)
                    } catch { /* ignore invalid JSON while typing */ }
                  }}
                  rows={6}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none font-mono placeholder:text-white/30"
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1.5">时间线事件 (JSON)</label>
                <textarea
                  value={JSON.stringify(summarizedWorld.timelineEvents, null, 2)}
                  onChange={e => {
                    try {
                      const parsed = JSON.parse(e.target.value)
                      setSummarizedWorld(prev => prev ? { ...prev, timelineEvents: parsed } : null)
                    } catch { /* ignore invalid JSON while typing */ }
                  }}
                  rows={6}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none font-mono placeholder:text-white/30"
                />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 从素材提取世界观模态框 */}
      {showExtractModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">从素材提取世界观</h3>
              </div>
              <button onClick={() => setShowExtractModal(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>

            {!extractPreview ? (
              <>
                <p className="text-white/50 text-sm mb-4">选择素材（不选则使用全部素材），AI 将自然地发现世界观维度。</p>
                <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
                  {seriesMaterials?.map(m => (
                    <label key={m.id} className="flex items-start gap-2 p-3 rounded-lg bg-white/5 border border-white/10 cursor-pointer hover:bg-white/[0.07] transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedMaterialIdsForExtract.includes(m.id)}
                        onChange={e => {
                          setSelectedMaterialIdsForExtract(prev =>
                            e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id)
                          )
                        }}
                        className="w-4 h-4 mt-0.5 rounded border-white/20 bg-white/5 text-amber-500 shrink-0"
                      />
                      <div>
                        <div className="text-sm text-white/80">{m.title}</div>
                        <div className="text-xs text-white/40 font-mono">{m.sourceType}</div>
                      </div>
                    </label>
                  ))}
                  {(!seriesMaterials || seriesMaterials.length === 0) && (
                    <div className="text-center text-white/40 py-8">
                      <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p>该系列暂无素材</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => setShowExtractModal(false)} className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm">取消</button>
                  <button
                    onClick={() => {
                      if (!selectedSeriesId) return
                      extractWorldMutation.mutate({
                        seriesId: selectedSeriesId,
                        materialIds: selectedMaterialIdsForExtract.length > 0 ? selectedMaterialIdsForExtract : undefined,
                      })
                    }}
                    disabled={extractWorldMutation.isPending || !seriesMaterials || seriesMaterials.length === 0}
                    className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-[#111827] rounded-full font-medium text-sm"
                  >
                    {extractWorldMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    <Sparkles className="w-4 h-4" /> 开始提取
                  </button>
                  {extractWorldMutation.isPending && (
                    <AiProgressBar
                      variant="indeterminate"
                      title="AI 提取世界观中"
                      description="正在从素材中提取世界观设定..."
                      className="mt-3"
                    />
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-white/50 text-sm mb-4">AI 从素材中提取了以下世界观设定，你可以编辑后再应用。</p>
                <div className="space-y-3 max-h-96 overflow-y-auto mb-4">
                  {extractPreview.aspects.map((aspect, idx) => (
                    <div key={aspect.id} className="p-3 rounded-lg bg-white/5 border border-white/10">
                      <input
                        value={aspect.name}
                        onChange={e => {
                          const next = [...extractPreview.aspects]
                          next[idx] = { ...aspect, name: e.target.value }
                          setExtractPreview({ ...extractPreview, aspects: next })
                        }}
                        className="w-full mb-2 px-2 py-1 rounded bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm font-medium"
                      />
                      <textarea
                        value={aspect.content}
                        onChange={e => {
                          const next = [...extractPreview.aspects]
                          next[idx] = { ...aspect, content: e.target.value }
                          setExtractPreview({ ...extractPreview, aspects: next })
                        }}
                        rows={3}
                        className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => setExtractPreview(null)} className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm">返回选择</button>
                  <button
                    onClick={() => {
                      if (!extractPreview) return
                      setAspects(prev => [...prev, ...extractPreview.aspects])
                      if (extractPreview.factions.length > 0) {
                        setWbFactions(JSON.stringify(extractPreview.factions, null, 2))
                      }
                      if (extractPreview.timelineEvents.length > 0) {
                        setWbTimeline(JSON.stringify(extractPreview.timelineEvents, null, 2))
                      }
                      setShowExtractModal(false)
                      setExtractPreview(null)
                      setIsEditingWorldBible(true)
                      setActiveTab("world")
                    }}
                    className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium text-sm"
                  >
                    <Save className="w-4 h-4" /> 应用到世界观
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Trope Create/Edit Modal */}
      {showTropeForm && selectedSeriesId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-[#1F2937] border border-white/10 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-semibold">{editingTropeId ? "编辑桥段" : "新建桥段"}</h3>
              <button onClick={() => { setShowTropeForm(false); resetTropeForm(); }} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1">桥段名称 *</label>
                <input
                  value={tropeName}
                  onChange={e => setTropeName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                  placeholder="如：秘境夺宝、师徒反目"
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1">描述</label>
                <textarea
                  value={tropeDesc}
                  onChange={e => setTropeDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none"
                  placeholder="桥段模式、触发条件和典型结果..."
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1">流程模式</label>
                <input
                  value={tropePattern}
                  onChange={e => setTropePattern(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                  placeholder="触发条件 → 发展 → 高潮 → 结果"
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1">标签（逗号分隔）</label>
                <input
                  value={tropeTags}
                  onChange={e => setTropeTags(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
                  placeholder="战斗, 情感, 转折"
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-1">素材佐证（每行一个）</label>
                <textarea
                  value={tropeExamples}
                  onChange={e => setTropeExamples(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none font-mono"
                  placeholder="素材中的具体例子..."
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => editingTropeId ? handleUpdateTrope(editingTropeId) : handleCreateTrope()}
                disabled={createTrope.isPending || updateTrope.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-[#111827] rounded-full font-medium text-sm"
              >
                {(createTrope.isPending || updateTrope.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" /> {editingTropeId ? "保存" : "创建"}
              </button>
              <button
                onClick={() => { setShowTropeForm(false); resetTropeForm(); }}
                className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trope Extract Modal */}
      {showTropeExtract && selectedSeriesId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-semibold">AI 提取桥段</h3>
              <button onClick={() => setShowTropeExtract(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-white/60 mb-4">
              将从该系列的 RAG 素材中自动提取典型桥段。素材越多，提取效果越好。
            </p>
            {seriesMaterials && seriesMaterials.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-mono text-white/40 mb-2">可选：指定素材（不选则使用全部索引片段）</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {seriesMaterials.map(m => (
                    <label key={m.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={selectedMaterialIdsForExtract.includes(m.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedMaterialIdsForExtract(prev => [...prev, m.id])
                          } else {
                            setSelectedMaterialIdsForExtract(prev => prev.filter(id => id !== m.id))
                          }
                        }}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500"
                      />
                      <span className="truncate">{m.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  extractTropesMutation.mutate({
                    seriesId: selectedSeriesId,
                    materialIds: selectedMaterialIdsForExtract.length > 0 ? selectedMaterialIdsForExtract : undefined,
                  })
                }}
                disabled={extractTropesMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-[#111827] rounded-full font-medium text-sm"
              >
                {extractTropesMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                <Sparkles className="w-4 h-4" /> 开始提取
              </button>
              <button
                onClick={() => setShowTropeExtract(false)}
                className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 角色合并 Modal */}
      {showMergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-2xl p-6 rounded-2xl bg-[#1F2937] border border-white/10 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-semibold">合并重复角色</h3>
              <button onClick={() => { setShowMergeModal(false); setMergeTargetId(null); setSelectedMergeIds(new Set()); }} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            {duplicateData?.groups && duplicateData.groups.length > 0 ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-white/50">发现 {duplicateData.groups.length} 组疑似重复角色，系统已自动推荐保留字段最全的角色。</p>
                  <button
                    onClick={() => {
                      // 一键智能合并：对每组都自动选择推荐保留角色，其余全部合并
                      const allKeepIds: number[] = []
                      const allMergeIds: number[] = []
                      duplicateData.groups.forEach((g: typeof duplicateData.groups[0]) => {
                        const keep = g.recommendedKeepId
                        allKeepIds.push(keep)
                        g.ids.forEach((id: number) => {
                          if (id !== keep) allMergeIds.push(id)
                        })
                      })
                      const groupsToMerge = duplicateData.groups
                      if (confirm(`智能合并将对 ${groupsToMerge.length} 组重复角色分别进行合并，共合并 ${allMergeIds.length} 个角色。此操作不可撤销，是否继续？`)) {
                        // 串行合并（避免冲突）
                        let idx = 0
                        async function mergeNext() {
                          if (idx >= groupsToMerge.length) {
                            utils.lore.character.list.invalidate()
                            setShowMergeModal(false)
                            setMergeTargetId(null)
                            setSelectedMergeIds(new Set())
                            toast.success("智能合并完成！")
                            return
                          }
                          const g = groupsToMerge[idx]
                          const keepId = g.recommendedKeepId
                          const mergeIds = g.ids.filter((id: number) => id !== keepId)
                          if (mergeIds.length > 0) {
                            await mergeCharacters.mutateAsync({ keepId, mergeIds })
                          }
                          idx++
                          mergeNext()
                        }
                        mergeNext()
                      }
                    }}
                    disabled={mergeCharacters.isPending}
                    className="px-4 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-full text-xs font-medium transition-colors disabled:opacity-40"
                  >
                    {mergeCharacters.isPending ? "合并中..." : "⚡ 一键智能合并"}
                  </button>
                </div>
                {duplicateData.groups.map((group: typeof duplicateData.groups[0], idx: number) => {
                  const groupChars = characters?.filter(c => group.ids.includes(c.id)) || []
                  const recommendedId = group.recommendedKeepId
                  return (
                    <div key={idx} className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                            group.matchType === "exact" ? "bg-green-500/10 text-green-400" :
                            group.matchType === "substring" ? "bg-amber-500/10 text-amber-400" :
                            "bg-red-500/10 text-red-400"
                          }`}>
                            {group.matchType === "exact" ? "精确匹配" :
                             group.matchType === "substring" ? "昵称关联" : "疑似同字"}
                            · 置信度 {(group.confidence * 100).toFixed(0)}%
                          </span>
                          <span className="text-xs text-white/40">{group.reason}</span>
                        </div>
                        <button
                          onClick={() => {
                            // 自动应用本组推荐
                            setMergeTargetId(recommendedId)
                            setSelectedMergeIds(new Set(group.ids.filter((id: number) => id !== recommendedId)))
                          }}
                          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          应用推荐
                        </button>
                      </div>
                      <div className="space-y-2">
                        {groupChars.map((char) => {
                          const isRecommended = char.id === recommendedId
                          const isTarget = mergeTargetId === char.id
                          const isSelected = selectedMergeIds.has(char.id)
                          return (
                            <div key={char.id} className={`flex items-start gap-3 p-2.5 rounded-lg border ${
                              isRecommended ? "border-emerald-500/20 bg-emerald-500/5" :
                              isTarget ? "border-amber-500/20 bg-amber-500/5" :
                              "border-white/5 bg-white/[0.02]"
                            }`}>
                              <div className="flex items-center gap-2 pt-0.5 shrink-0">
                                <input
                                  type="radio"
                                  name={`merge-target-${idx}`}
                                  checked={isTarget}
                                  onChange={() => { setMergeTargetId(char.id); setSelectedMergeIds(prev => { const next = new Set(prev); next.delete(char.id); return next; }); }}
                                  className="w-4 h-4"
                                  title="设为保留角色"
                                />
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={isTarget}
                                  onChange={(e) => {
                                    const next = new Set(selectedMergeIds)
                                    if (e.target.checked) next.add(char.id)
                                    else next.delete(char.id)
                                    setSelectedMergeIds(next)
                                  }}
                                  className="w-4 h-4"
                                  title="合并此角色"
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-sm font-medium ${isTarget ? "text-amber-400" : "text-white/80"}`}>
                                    {char.name}
                                    {isRecommended && <span className="ml-1 text-emerald-400 text-xs">⭐ 推荐保留</span>}
                                    {isTarget && !isRecommended && <span className="ml-1 text-amber-400 text-xs">(保留)</span>}
                                  </span>
                                  {(char.aliases as string[] || []).length > 0 && (
                                    <span className="text-xs text-white/30 font-mono">别名: {(char.aliases as string[]).join(", ")}</span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-white/40">
                                  {char.age && <span>年龄: {char.age}</span>}
                                  {(char.personalityTraits as string[] || []).length > 0 && <span>性格: {(char.personalityTraits as string[]).slice(0, 3).join(", ")}{(char.personalityTraits as string[]).length > 3 && "..."}</span>}
                                  {char.coreMotivations && <span>动机: {char.coreMotivations.slice(0, 30)}{char.coreMotivations.length > 30 && "..."}</span>}
                                  {Object.keys(char.relationships as Record<string, unknown> || {}).length > 0 && <span>关系: {Object.keys(char.relationships as Record<string, unknown>).length} 条</span>}
                                  {char.speechPatterns && <span>语言风格: ✓</span>}
                                  {char.canonicalArcSummary && <span>故事线: ✓</span>}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                <button
                  onClick={() => {
                    if (!mergeTargetId || selectedMergeIds.size === 0) {
                      toast.warning("请选择保留的主角色和至少一个要合并的角色")
                      return
                    }
                    const mergeIds = Array.from(selectedMergeIds).filter(id => id !== mergeTargetId)
                    if (mergeIds.length === 0) {
                      toast.warning("至少选择一个非保留角色进行合并")
                      return
                    }
                    if (confirm(`确定将 ${mergeIds.length} 个角色合并到「${characters?.find(c => c.id === mergeTargetId)?.name}」？此操作不可撤销。`)) {
                      mergeCharacters.mutate({ keepId: mergeTargetId, mergeIds })
                    }
                  }}
                  disabled={mergeCharacters.isPending}
                  className="w-full px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-[#111827] rounded-full font-medium text-sm transition-colors"
                >
                  {mergeCharacters.isPending ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                  确认合并
                </button>
              </div>
            ) : (
              <div className="text-center py-8 text-white/40">
                <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">{duplicateData ? '未发现重复角色' : '正在检测...'}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 世界观维度合并 Modal */}
      {showAspectMergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-2xl p-6 rounded-2xl bg-[#1F2937] border border-white/10 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-semibold">合并重复世界观维度</h3>
              <button onClick={() => { setShowAspectMergeModal(false); setSelectedAspectMergeGroupIds(new Set()); }} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            {aspectDuplicateData?.groups && aspectDuplicateData.groups.length > 0 ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-white/50">发现 {aspectDuplicateData.groups.length} 组疑似重复维度，系统将自动保留内容最全的维度，其余内容追加为补充。系统会自动保留内容最全的维度，其余内容追加为补充。</p>
                  <button
                    onClick={() => {
                      if (confirm(`智能合并将对 ${aspectDuplicateData.groups.length} 组重复维度进行合并。此操作不可撤销，是否继续？`)) {
                        const allGroupIds = aspectDuplicateData.groups.flatMap((g: typeof aspectDuplicateData.groups[0]) => g.ids)
                        mergeAspectsMutation.mutate({
                          seriesId: selectedSeriesId!,
                          groupIds: allGroupIds,
                        })
                      }
                    }}
                    disabled={mergeAspectsMutation.isPending}
                    className="px-4 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-full text-xs font-medium transition-colors disabled:opacity-40 shrink-0 ml-4"
                  >
                    {mergeAspectsMutation.isPending ? "合并中..." : "⚡ 一键智能合并"}
                  </button>
                </div>
                {aspectDuplicateData.groups.map((group: typeof aspectDuplicateData.groups[0], idx: number) => {
                  const groupAspects = aspects.filter(a => group.ids.includes(a.id))
                  // 找出内容最长的作为主维度
                  const keepAspect = groupAspects.reduce((best, curr) =>
                    (curr.content || "").length > (best.content || "").length ? curr : best
                  , groupAspects[0])
                  return (
                    <div key={idx} className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                            group.matchType === "exact" ? "bg-green-500/10 text-green-400" :
                            group.matchType === "substring" ? "bg-amber-500/10 text-amber-400" :
                            "bg-red-500/10 text-red-400"
                          }`}>
                            {group.matchType === "exact" ? "精确匹配" :
                             group.matchType === "substring" ? "名称包含" : "名称近似"}
                            · 置信度 {(group.confidence * 100).toFixed(0)}%
                          </span>
                          <span className="text-xs text-white/40">{group.reason}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {groupAspects.map((aspect) => {
                          const isKeep = aspect.id === keepAspect?.id
                          return (
                            <div key={aspect.id} className={`flex items-start gap-3 p-2.5 rounded-lg border ${
                              isKeep ? "border-emerald-500/20 bg-emerald-500/5" : "border-white/5 bg-white/[0.02]"
                            }`}>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-sm font-medium ${isKeep ? "text-emerald-400" : "text-white/80"}`}>
                                    {aspect.name}
                                    {isKeep && <span className="ml-1 text-emerald-400 text-xs">⭐ 保留（内容最长）</span>}
                                  </span>
                                </div>
                                <p className="text-xs text-white/40 line-clamp-2">{aspect.content}</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                <button
                  onClick={() => {
                    if (selectedAspectMergeGroupIds.size === 0) {
                      toast.warning("请至少选择一组要合并的重复维度")
                      return
                    }
                    const selectedGroups = aspectDuplicateData.groups.filter((g: typeof aspectDuplicateData.groups[0]) =>
                      g.ids.some((id: string) => selectedAspectMergeGroupIds.has(id))
                    )
                    const allGroupIds = selectedGroups.flatMap((g: typeof aspectDuplicateData.groups[0]) => g.ids)
                    if (confirm(`确定合并选中的 ${selectedGroups.length} 组重复维度？此操作不可撤销。`)) {
                      mergeAspectsMutation.mutate({
                        seriesId: selectedSeriesId!,
                        groupIds: allGroupIds,
                      })
                    }
                  }}
                  disabled={mergeAspectsMutation.isPending}
                  className="w-full px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-[#111827] rounded-full font-medium text-sm transition-colors"
                >
                  {mergeAspectsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                  确认合并选中组
                </button>
              </div>
            ) : (
              <div className="text-center py-8 text-white/40">
                <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">{aspectDuplicateData ? "未发现重复世界观维度" : "正在检测..."}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 桥段提取进度 Modal */}
      {showExtractProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-serif text-lg font-semibold">AI 提取桥段</h3>
              <button
                onClick={() => {
                  setShowExtractProgress(false)
                  setExtractTaskId(null)
                }}
                className="p-1 rounded hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-5">
              {/* 状态图标 + 消息 */}
              <div className="flex items-center gap-3">
                {extractStatusData?.status === "completed" ? (
                  <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                ) : extractStatusData?.status === "failed" || extractStatusData?.status === "not_found" ? (
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                ) : (
                  <Loader2 className="w-5 h-5 animate-spin text-amber-500 shrink-0" />
                )}
                <p className="text-sm text-white/70">{extractStatusData?.message || "准备中..."}</p>
              </div>

              {/* 进度条 */}
              <div className="space-y-1.5">
                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all duration-700"
                    style={{ width: `${extractStatusData?.progress ?? 0}%` }}
                  />
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono text-white/30">
                    {extractStatusData?.status === "completed"
                      ? "已完成"
                      : extractStatusData?.status === "failed"
                        ? "已失败"
                        : "处理中"}
                  </span>
                  <span className="text-[10px] font-mono text-white/30">{extractStatusData?.progress ?? 0}%</span>
                </div>
              </div>

              {/* 结果提示 */}
              {extractStatusData?.status === "completed" && (
                <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                  <p className="text-sm text-green-400">
                    共发现 {extractStatusData.result?.count ?? 0} 个桥段
                  </p>
                </div>
              )}
              {(extractStatusData?.status === "failed" || extractStatusData?.status === "not_found") && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <p className="text-sm text-red-400">{extractStatusData.error || "任务不存在或已过期"}</p>
                </div>
              )}

              {/* 关闭按钮 */}
              {(extractStatusData?.status === "completed" ||
                extractStatusData?.status === "failed" ||
                extractStatusData?.status === "not_found") && (
                <button
                  onClick={() => {
                    setShowExtractProgress(false)
                    setExtractTaskId(null)
                  }}
                  className="w-full px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors"
                >
                  关闭
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CharFormFields({ control }: { control: import("react-hook-form").Control<import("@/hooks/useCharacterForm").CharacterFormData> }) {
  const renderField = (name: keyof import("@/hooks/useCharacterForm").CharacterFormData, label: string, placeholder?: string, multiline?: boolean) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div>
          <label className="block font-mono text-xs text-white/50 mb-1">{label}</label>
          {multiline ? (
            <RichTextEditor value={field.value || ""} onChange={field.onChange} placeholder={placeholder} minHeight="80px" plainText />
          ) : (
            <input {...field} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm" placeholder={placeholder} />
          )}
        </div>
      )}
    />
  )

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {renderField("name", "角色名 *")}
        {renderField("age", "年龄", "如：18岁")}
      </div>
      {renderField("aliases", "别名（逗号分隔）", "如：萧炎, 炎帝")}
      {renderField("personality", "性格特征（逗号分隔）", "如：冷静, 坚毅, 重情义")}
      {renderField("motivations", "核心动机", "角色追求的核心目标...", true)}
      {renderField("speech", "语言风格", "如：豪爽直率，常用江湖切口")}
      {renderField("taboos", "禁忌（逗号分隔）", "如：不谈家事, 不杀无辜")}
      {renderField("arc", "正史弧线", "角色在正史中的成长轨迹...", true)}
    </>
  )
}

