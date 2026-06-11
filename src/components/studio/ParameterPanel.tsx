import {
  BookText,
  BookOpen,
  Wand2,
  Sparkles,
  Theater,
  Database,
  PenTool,
  Thermometer,
  Music,
  FileText,
  Shield,
  Loader2,
  X,
  AlertCircle,
} from "lucide-react"
import type { GenParams, GenProgress, InspireFocus, GenerationError, InspireCanonFidelity } from "@/types/studio"
import type { UseQueryResult } from "@tanstack/react-query"
import { ErrorDisplay } from "./ErrorDisplay"

interface CharacterItem {
  id: number
  name: string
}

interface TropeItem {
  id: number
  name: string
  description: string | null
}

interface MaterialItem {
  id: number
  title: string
  sourceType: string
  status: string
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

interface ParameterPanelProps {
  // Data
  seriesList: Array<{ id: number; name: string }> | undefined
  novelList: Array<{ id: number; title: string }> | undefined
  characters: CharacterItem[] | undefined
  seriesTropes: TropeItem[] | undefined
  hotkeyTropes: { hotkeys: Array<{ id: number }> } | undefined
  hotkeyTropeIdSet: Set<number>
  seriesMaterials: MaterialItem[] | undefined

  // State
  selectedSeriesId: number | null
  selectedParentNovelId: number | null
  selectedCharacterIds: number[]
  selectedTropeIds: number[]
  selectedMaterialIds: number[]
  useMaterials: boolean
  brief: string
  userPrompt: string
  params: GenParams
  warnings: string[]
  inspireFocus: InspireFocus
  inspireCanonFidelity: InspireCanonFidelity
  setInspireCanonFidelity: (v: InspireCanonFidelity) => void
  isGenerating: boolean
  generatedWorkId: number | null
  genProgress: GenProgress | null
  generationError: GenerationError | null
  panelOpen: boolean
  isPresearching: boolean
  presearchResults: Array<{ id: number; title: string; relevance: number }>
  useOutlineMode: boolean
  setUseOutlineMode: (v: boolean | ((prev: boolean) => boolean)) => void
  setShowOutlinePanel: (v: boolean) => void

  // Mutations
  inspireMutationPending: boolean
  feedbackMutationPending: boolean

  // Handlers
  setSelectedSeriesId: (v: number | null) => void
  setSelectedParentNovelId: (v: number | null) => void
  setSelectedCharacterIds: (v: number[] | ((prev: number[]) => number[])) => void
  setSelectedTropeIds: (v: number[] | ((prev: number[]) => number[])) => void
  setSelectedMaterialIds: (v: number[] | ((prev: number[]) => number[])) => void
  setUseMaterials: (v: boolean) => void
  setBrief: (v: string) => void
  setUserPrompt: (v: string) => void
  setParams: (v: GenParams | ((prev: GenParams) => GenParams)) => void
  setWarnings: (v: string[] | ((prev: string[]) => string[])) => void
  setInspireFocus: (v: InspireFocus) => void
  setPanelOpen: (v: boolean) => void
  setGenerationError: (v: GenerationError | null) => void
  onInspire: () => void
  onGenerate: () => void
  onCancelGeneration: () => void

  // Outline
  outlineType: "overview" | "scenes" | "both"
  outlineOverview: string
  outlineScenes: Array<{ id: string; title: string; description: string }>
  isBatchGenerating: boolean
  batchStatusQuery: UseQueryResult<unknown, unknown>
  listChaptersQuery: UseQueryResult<unknown, unknown>
  setOutlineType: (v: "overview" | "scenes" | "both") => void
  setOutlineOverview: (v: string) => void
  setOutlineScenes: (v: Array<{ id: string; title: string; description: string }> | ((prev: Array<{ id: string; title: string; description: string }>) => Array<{ id: string; title: string; description: string }>)) => void
  onGenerateOutline: () => void
  onBatchGenerate: () => void

  // CustomSelect component
  CustomSelect: (props: CustomSelectProps) => React.ReactElement
}

const MODE_OPTIONS: { value: GenParams["writingMode"]; label: string; description: string }[] = [
  { value: "canon_continuation", label: "正史续写", description: "严格遵循正史，只使用指定角色" },
  { value: "character_spinoff", label: "角色外传", description: "聚焦已有角色的独立故事" },
  { value: "original_in_universe", label: "同世界观原创", description: "创作新故事，不强制已有角色" },
  { value: "alternate_universe", label: "AU/平行宇宙", description: "保留角色内核，世界观可改" },
]

const TONE_OPTIONS = [
  { value: "dark", label: "黑暗压抑" },
  { value: "romantic", label: "浪漫温情" },
  { value: "action", label: "紧张激烈" },
  { value: "slice_of_life", label: "日常轻松" },
  { value: "mysterious", label: "悬疑诡秘" },
  { value: "epic", label: "史诗壮阔" },
]

const DEFAULT_STEPS = [
  { step: 1, label: "检索素材" },
  { step: 2, label: "组装指令" },
  { step: 3, label: "构建上下文" },
  { step: 4, label: "AI创作中" },
  { step: 5, label: "后处理" },
  { step: 6, label: "保存作品" },
]

const OUTLINE_STEPS = [
  { step: 1, label: "检索素材" },
  { step: 2, label: "组装指令" },
  { step: 3, label: "AI生成中" },
  { step: 4, label: "解析大纲" },
  { step: 5, label: "保存" },
]

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  description,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  description: string
}) {
  const percentage = ((value - min) / (max - min)) * 100

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-white/70">{label}</span>
        <span className="font-mono text-xs text-amber-500">{value.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <div className="relative">
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
      <p className="text-white/50 text-xs mt-1">{description}</p>
    </div>
  )
}

function GenerationStepper({ progress, steps = DEFAULT_STEPS }: { progress: GenProgress; steps?: Array<{ step: number; label: string }> }) {
  const currentStep = progress.step
  return (
    <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/10">
      <p className="text-xs font-mono text-white/50 mb-2 text-center">{progress.message}</p>
      {progress.detail && (
        <p className="text-xs text-emerald-400/80 mb-2 text-center animate-pulse">{progress.detail}</p>
      )}
      <div className="flex items-center justify-between">
        {steps.map((s, i) => {
          const isDone = currentStep > s.step || (progress.completed && currentStep >= s.step)
          const isActive = currentStep === s.step && !progress.completed
          return (
            <div key={s.step} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                    isDone
                      ? "bg-green-500/20 text-green-400 border border-green-500/30"
                      : isActive
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse"
                      : "bg-white/5 text-white/30 border border-white/10"
                  }`}
                >
                  {isDone ? "✓" : s.step}
                </div>
                <span
                  className={`text-[10px] mt-1 font-mono ${
                    isDone ? "text-green-400/70" : isActive ? "text-amber-400/70" : "text-white/30"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`w-4 h-px ${
                    currentStep > s.step ? "bg-green-500/30" : "bg-white/10"
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ParameterPanel({
  seriesList,
  novelList,
  characters,
  seriesTropes,
  hotkeyTropes,
  hotkeyTropeIdSet,
  seriesMaterials,
  selectedSeriesId,
  selectedParentNovelId,
  selectedCharacterIds,
  selectedTropeIds,
  selectedMaterialIds,
  useMaterials,
  brief,
  userPrompt,
  params,
  warnings,
  inspireFocus,
  isGenerating,
  generatedWorkId,
  genProgress,
  generationError,
  panelOpen,
  isPresearching,
  presearchResults,
  useOutlineMode,
  setUseOutlineMode,
  setShowOutlinePanel,
  inspireMutationPending,
  inspireCanonFidelity,
  setSelectedSeriesId,
  setSelectedParentNovelId,
  setSelectedCharacterIds,
  setSelectedTropeIds,
  setSelectedMaterialIds,
  setUseMaterials,
  setBrief,
  setUserPrompt,
  setParams,
  setWarnings,
  setInspireFocus,
  setInspireCanonFidelity,
  setPanelOpen,
  setGenerationError,
  onInspire,
  onGenerate,
  onCancelGeneration,
  outlineType,
  outlineOverview,
  outlineScenes,
  isBatchGenerating,
  batchStatusQuery,
  listChaptersQuery,
  setOutlineType,
  setOutlineOverview,
  setOutlineScenes,
  onGenerateOutline,
  onBatchGenerate,
  CustomSelect,
}: ParameterPanelProps) {
  return (
    <aside className={`${panelOpen ? "fixed inset-0 z-30" : "hidden"} md:block md:static md:inset-auto md:z-auto w-full md:w-[360px] border-l border-white/10 bg-[#111827]/95 backdrop-blur-md overflow-y-auto`}>
      <div className="md:hidden flex items-center justify-between p-4 border-b border-white/10">
        <span className="font-mono text-xs text-white/70">创作设置</span>
        <button onClick={() => setPanelOpen(false)} className="p-2 rounded-lg hover:bg-white/10 min-h-[44px] min-w-[44px]">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-6 space-y-6">
        {/* 系列选择 */}
        <div>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
            <BookText className="w-3.5 h-3.5" />
            选择系列
          </label>
          <CustomSelect
            value={selectedSeriesId?.toString() || ""}
            onChange={v => setSelectedSeriesId(Number(v) || null)}
            options={[
              { value: "", label: "选择一个系列..." },
              ...(seriesList?.map(s => ({ value: s.id.toString(), label: s.name })) || []),
            ]}
          />
        </div>

        {/* 父小说选择 */}
        <div>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
            <BookOpen className="w-3.5 h-3.5" />
            关联原作（可选）
          </label>
          <CustomSelect
            value={selectedParentNovelId?.toString() || ""}
            onChange={v => setSelectedParentNovelId(Number(v) || null)}
            options={[
              { value: "", label: "不关联原作" },
              ...(novelList?.map(n => ({ value: n.id.toString(), label: n.title })) || []),
            ]}
          />
        </div>

        {/* 创作模式 */}
        <div>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
            <Wand2 className="w-3.5 h-3.5" />
            创作模式
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MODE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setParams(p => ({ ...p, writingMode: opt.value }))}
                className={`text-left px-3 py-2.5 rounded-xl text-sm transition-colors border min-h-[44px] ${
                  params.writingMode === opt.value
                    ? "bg-amber-500/20 border-amber-500/30 text-amber-400"
                    : "bg-white/5 border-transparent hover:bg-white/10 text-white/60"
                }`}
                title={opt.description}
              >
                <div className="font-medium">{opt.label}</div>
                <div className="text-[10px] text-white/40 mt-0.5 leading-tight">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 角色选择 */}
        {selectedSeriesId && characters && characters.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70">
                <Sparkles className="w-3.5 h-3.5" />
                参演角色
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedCharacterIds(characters.map(c => c.id))}
                  className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                >
                  全选
                </button>
                <span className="text-white/20">|</span>
                <button
                  onClick={() => setSelectedCharacterIds([])}
                  className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                >
                  清空
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {characters.map(char => {
                const isSelected = selectedCharacterIds.includes(char.id)
                return (
                  <button
                    key={char.id}
                    onClick={() => {
                      setSelectedCharacterIds(prev =>
                        isSelected
                          ? prev.filter(id => id !== char.id)
                          : [...prev, char.id]
                      )
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${
                      isSelected
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        : "bg-white/[0.03] text-white/40 border-white/10 hover:border-white/20"
                    }`}
                  >
                    {isSelected ? "✓ " : ""}{char.name}
                  </button>
                )
              })}
            </div>
            {selectedCharacterIds.length === 0 && (
              <p className={`text-[10px] font-mono mt-2 ${params.writingMode === "original_in_universe" ? "text-amber-400/70" : "text-white/30"}`}>
                {params.writingMode === "original_in_universe"
                  ? "🌟 纯原创模式：未选择任何已有角色，AI 将创作全新的原创角色和故事，不使用任何已有角色"
                  : params.writingMode === "alternate_universe"
                  ? "未选择角色，AI 将自主创作新角色或根据 Brief 使用已有角色"
                  : "未选择任何角色，请至少选择一位"
                }
              </p>
            )}
          </div>
        )}

        {/* 桥段选择 */}
        {selectedSeriesId && seriesTropes && seriesTropes.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70">
                <Theater className="w-3.5 h-3.5" />
                参考桥段
                {hotkeyTropes && hotkeyTropes.hotkeys.length > 0 && (
                  <span className="text-[10px] text-amber-500/60 ml-1"
                  >
                    🔥 {hotkeyTropes.hotkeys.length} 个热键推荐
                  </span>
                )}
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedTropeIds(seriesTropes.map(t => t.id))}
                  className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                >
                  全选
                </button>
                <span className="text-white/20">|</span>
                <button
                  onClick={() => setSelectedTropeIds([])}
                  className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                >
                  清空
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {seriesTropes.map(trope => {
                const isSelected = selectedTropeIds.includes(trope.id)
                const isHotkey = hotkeyTropeIdSet.has(trope.id)
                return (
                  <button
                    key={trope.id}
                    onClick={() => {
                      setSelectedTropeIds(prev =>
                        isSelected
                          ? prev.filter(id => id !== trope.id)
                          : [...prev, trope.id]
                      )
                    }}
                    title={trope.description || trope.name}
                    className={`px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${
                      isSelected
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        : isHotkey
                          ? "bg-red-500/5 text-red-300/70 border-red-500/20 hover:border-red-500/40"
                          : "bg-white/[0.03] text-white/40 border-white/10 hover:border-white/20"
                    }`}
                  >
                    {isSelected ? "✓ " : ""}
                    {isHotkey && !isSelected ? "🔥 " : ""}
                    {trope.name}
                  </button>
                )
              })}
            </div>
            {selectedTropeIds.length === 0 && (
              <p className="text-[10px] font-mono mt-2 text-white/30">
                未选择桥段。🔥 标记的是你历史创作中高频使用的热键桥段，点击即可选用。
              </p>
            )}
          </div>
        )}

        {/* 素材作用域 */}
        {selectedSeriesId && (
          <div>
            <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
              <Database className="w-3.5 h-3.5" />
              素材作用域
            </label>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                id="use-materials"
                checked={useMaterials}
                onChange={e => {
                  setUseMaterials(e.target.checked)
                  if (!e.target.checked) setSelectedMaterialIds([])
                }}
                className="w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500"
              />
              <label htmlFor="use-materials" className="text-sm text-white/70">
                包含素材池中的投喂素材
              </label>
            </div>
            {/* 预搜索结果 */}
            {useMaterials && presearchResults.length > 0 && (
              <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10 mb-2">
                <p className="text-[10px] font-mono text-amber-400/70 mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  根据 Brief 推荐素材
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {presearchResults.map(r => {
                    const isSelected = selectedMaterialIds.includes(r.id)
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          setSelectedMaterialIds(prev =>
                            isSelected ? prev.filter(id => id !== r.id) : [...prev, r.id]
                          )
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                          isSelected
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                        }`}
                      >
                        {isSelected ? "✓" : "+"} {r.title}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {useMaterials && isPresearching && (
              <div className="flex items-center gap-2 text-[10px] text-white/30 mb-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                正在分析相关素材...
              </div>
            )}

            {useMaterials && seriesMaterials && seriesMaterials.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {seriesMaterials.map(m => (
                  <label
                    key={m.id}
                    className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 cursor-pointer transition-colors"
                  >
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
                      className="w-3.5 h-3.5 mt-0.5 rounded border-white/20 bg-white/5 text-amber-500 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-white/60 truncate">{m.title}</div>
                      <div className="text-[10px] text-white/50 font-mono mt-0.5">
                        {m.sourceType === "parallel_corpus" ? "平行语料" :
                         m.sourceType === "reference_novel" ? "参考小说" : "知识文档"}
                        {m.status === "indexed" ? " · 已索引" : m.status === "indexing" ? " · 索引中" : ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {useMaterials && seriesMaterials && seriesMaterials.length === 0 && (
              <p className="text-xs text-white/50 font-mono">该系列暂无素材</p>
            )}
          </div>
        )}

        {/* 创作要求 */}
        <div>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
            <PenTool className="w-3.5 h-3.5" />
            创作要求 (Brief)
          </label>
          <textarea
            value={brief}
            onChange={e => {
              setBrief(e.target.value)
              // 清除 warnings，因为用户正在修改 brief
              if (warnings.length > 0) setWarnings([])
            }}
            placeholder="描述你想创作的内容，如：萧炎在魔兽山脉修炼时遇到一位神秘老者的故事"
            className="w-full h-32 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
          />
          {/* Brief 冲突警告 */}
          {warnings.length > 0 && (
            <div className="mt-3 space-y-2">
              {warnings.map((w, i) => {
                const charMatch = w.match(/"([^"]+)"/)
                const charName = charMatch?.[1]
                const char = characters?.find(c => c.name === charName)
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
                  >
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-amber-300 leading-relaxed">{w}</p>
                      {char && !selectedCharacterIds.includes(char.id) && (
                        <button
                          onClick={() => {
                            setSelectedCharacterIds(prev => [...prev, char.id])
                            // 移除已处理的 warning
                            setWarnings(prev => prev.filter((_, idx) => idx !== i))
                          }}
                          className="mt-1.5 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                        >
                          + 添加 {char.name}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {/* 灵感激发按钮 */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onInspire}
              disabled={inspireMutationPending || !selectedSeriesId}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-30 text-cyan-400 text-sm transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              {inspireMutationPending ? "搜索灵感中..." : "获取灵感"}
            </button>
            <CustomSelect
              value={inspireFocus}
              onChange={(v) => setInspireFocus(v as InspireFocus)}
              options={[
                { value: "full", label: "综合" },
                { value: "plot", label: "情节" },
                { value: "character", label: "角色" },
                { value: "worldview", label: "世界观" },
                { value: "writing", label: "文笔" },
              ]}
            />
          </div>
          <div className="mt-2">
            <p className="text-[10px] text-white/40 mb-1">设定遵循度</p>
            <div className="flex bg-white/5 rounded-lg p-0.5">
              {[
                { value: "strict" as const, label: "严格", desc: "完全绑定设定库" },
                { value: "moderate" as const, label: "适度", desc: "允许次要扩展" },
                { value: "inspired" as const, label: "启发", desc: "大胆重新组合" },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setInspireCanonFidelity(opt.value)}
                  title={opt.desc}
                  className={`flex-1 px-2 py-1 rounded-md text-[10px] transition-colors ${
                    inspireCanonFidelity === opt.value
                      ? "bg-amber-500/20 text-amber-400"
                      : "text-white/50 hover:text-white/70"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 大纲面板 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70">
              <FileText className="w-3.5 h-3.5" />
              大纲
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setUseOutlineMode(prev => {
                    const next = !prev
                    setShowOutlinePanel(next)
                    return next
                  })
                }}
                className={`text-xs px-2 py-1 rounded-full transition-colors ${
                  useOutlineMode
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-white/5 text-white/50 hover:text-white/70"
                }`}
              >
                {useOutlineMode ? "先大纲后正文" : "直接生成正文"}
              </button>
            </div>
          </div>

          {useOutlineMode && (
            <div className="space-y-3">
              {/* 生成类型选择 */}
              <div className="flex gap-2">
                {[
                  { value: "overview" as const, label: "概述" },
                  { value: "scenes" as const, label: "结构化" },
                  { value: "both" as const, label: "两者" },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setOutlineType(opt.value)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                      outlineType === opt.value
                        ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                        : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* AI 生成大纲按钮 */}
              {!outlineOverview && outlineScenes.length === 0 ? (
                <button
                  onClick={onGenerateOutline}
                  disabled={isGenerating || !selectedSeriesId || !brief.trim()}
                  className="w-full py-2 bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/70 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  AI 生成大纲
                </button>
              ) : (
                <>
                  {/* 概述编辑区 */}
                  {(outlineType === "overview" || outlineType === "both") && (
                    <div>
                      <label className="text-xs text-white/50 font-mono mb-1 block">整体概述</label>
                      <textarea
                        value={outlineOverview}
                        onChange={e => setOutlineOverview(e.target.value)}
                        placeholder="大纲概述..."
                        className="w-full h-24 px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
                      />
                    </div>
                  )}

                  {/* 场景列表 */}
                  {(outlineType === "scenes" || outlineType === "both") && (
                    <div className="space-y-2">
                      <label className="text-xs text-white/50 font-mono block">场景列表</label>
                      {outlineScenes.map((scene, idx) => (
                        <div key={scene.id} className="p-2 rounded-lg bg-white/[0.03] border border-white/10 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-white/30 font-mono w-6">{idx + 1}.</span>
                            <input
                              value={scene.title}
                              onChange={e => {
                                const next = [...outlineScenes]
                                next[idx] = { ...scene, title: e.target.value }
                                setOutlineScenes(next)
                              }}
                              placeholder="场景标题"
                              className="flex-1 bg-transparent text-sm text-[#FDFBF5] outline-none placeholder:text-white/30"
                            />
                            <button
                              onClick={() => setOutlineScenes(prev => prev.filter((_, i) => i !== idx))}
                              className="p-1 rounded hover:bg-red-500/20 text-white/30 hover:text-red-400"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <textarea
                            value={scene.description}
                            onChange={e => {
                              const next = [...outlineScenes]
                              next[idx] = { ...scene, description: e.target.value }
                              setOutlineScenes(next)
                            }}
                            placeholder="场景描述..."
                            className="w-full h-16 px-2 py-1 rounded bg-white/5 border border-white/5 focus:border-amber-500/30 outline-none text-xs text-[#FDFBF5] resize-none placeholder:text-white/30"
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => setOutlineScenes(prev => [...prev, { id: crypto.randomUUID(), title: "", description: "" }])}
                        className="w-full py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/70 text-xs transition-colors"
                      >
                        + 添加场景
                      </button>
                    </div>
                  )}

                  {/* 生成按钮组 */}
                  {outlineScenes && outlineScenes.length > 0 && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={onGenerate}
                        disabled={isGenerating || !generatedWorkId}
                        className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-lg text-sm font-medium text-black transition-colors"
                      >
                        {isGenerating ? "生成中..." : "确认并生成正文"}
                      </button>
                      <button
                        onClick={onBatchGenerate}
                        disabled={isBatchGenerating || !generatedWorkId}
                        className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
                      >
                        {isBatchGenerating
                          ? `批量生成中 (${(batchStatusQuery.data as { progress?: number })?.progress?.toFixed(0) || 0}%)`
                          : `一键生成 ${outlineScenes.length} 章`}
                      </button>
                    </div>
                  )}

                  {/* 批量生成进度 */}
                  {isBatchGenerating && batchStatusQuery.data && (
                    <div className="mt-3 space-y-2">
                      <div className="flex justify-between text-xs text-white/60">
                        <span>
                          {(batchStatusQuery.data as { currentChapter?: number; totalChapters?: number }).currentChapter
                            ? `正在生成第 ${(batchStatusQuery.data as { currentChapter?: number }).currentChapter} 章 / 共 ${(batchStatusQuery.data as { totalChapters?: number }).totalChapters || "?"} 章`
                            : "批量生成进度"}
                        </span>
                        <span className="font-mono text-emerald-400">{(batchStatusQuery.data as { progress?: number }).progress?.toFixed(0) || 0}%</span>
                      </div>
                      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700 relative"
                          style={{ width: `${(batchStatusQuery.data as { progress?: number }).progress || 0}%` }}
                        >
                          {(batchStatusQuery.data as { progress?: number }).progress && (batchStatusQuery.data as { progress?: number }).progress! < 100 && (
                            <div className="absolute inset-0 bg-white/20 animate-pulse" />
                          )}
                        </div>
                      </div>
                      {(batchStatusQuery.data as { completedChapters?: Array<{ chapterNumber: number; title: string }> }).completedChapters && (batchStatusQuery.data as { completedChapters?: Array<{ chapterNumber: number; title: string }> }).completedChapters!.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {(batchStatusQuery.data as { completedChapters?: Array<{ chapterNumber: number; title: string }> }).completedChapters!.map(c => (
                            <span
                              key={c.chapterNumber}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400"
                            >
                              ✓ 第{c.chapterNumber}章
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 已生成章节列表 */}
                  {listChaptersQuery.data && (listChaptersQuery.data as Array<{ id: number; chapterNumber: number; title: string | null; content: string | null; status: string }>).length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider">已生成章节</h4>
                        <span className="text-[10px] text-white/30 font-mono">
                          共 {(listChaptersQuery.data as Array<{ id: number; chapterNumber: number; title: string | null; content: string | null; status: string }>).length} 章 ·{" "}
                          {(listChaptersQuery.data as Array<{ id: number; chapterNumber: number; title: string | null; content: string | null; status: string }>).reduce((sum, ch) => sum + (ch.content?.length || 0), 0).toLocaleString()} 字
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {(listChaptersQuery.data as Array<{ id: number; chapterNumber: number; title: string | null; content: string | null; status: string }>).map(ch => (
                          <div
                            key={ch.id}
                            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm border ${
                              ch.status === "generated"
                                ? "bg-emerald-500/5 border-emerald-500/10"
                                : "bg-white/5 border-white/5"
                            }`}
                          >
                            <span className="text-amber-400 text-xs font-mono w-12 shrink-0">第{ch.chapterNumber}章</span>
                            <span className="text-white/80 truncate flex-1">{ch.title || "未命名"}</span>
                            <span className="text-[10px] text-white/30 font-mono shrink-0">
                              {(ch.content?.length || 0).toLocaleString()} 字
                            </span>
                            <span
                              className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                ch.status === "generated"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : "bg-white/10 text-white/40"
                              }`}
                            >
                              {ch.status === "generated" ? "已完成" : ch.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 用户自定义提示词 */}
        <div>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
            <Wand2 className="w-3.5 h-3.5" />
            自定义系统提示词 (可选)
          </label>
          <textarea
            value={userPrompt}
            onChange={e => setUserPrompt(e.target.value)}
            placeholder="追加到系统提示词的自定义指令，优先级最高。如：模仿金庸风格，多用环境描写..."
            className="w-full h-24 px-4 py-3 rounded-xl bg-white/5 border border-amber-500/20 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
          />
        </div>

        {/* 参数滑块 */}
        <div className="space-y-5">
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70">
            <Thermometer className="w-3.5 h-3.5" />
            生成参数
          </label>

          <SliderControl
            label="创造力 (Temperature)"
            value={params.temperature}
            min={0}
            max={2}
            step={0.05}
            onChange={v => setParams(p => ({ ...p, temperature: v }))}
            description="值越高输出越发散有创意，越低越保守"
          />

          <SliderControl
            label="风格忠实度"
            value={params.styleFidelity}
            min={1}
            max={10}
            step={1}
            onChange={v => setParams(p => ({ ...p, styleFidelity: v }))}
            description="对原作写作风格的模仿程度"
          />

          <SliderControl
            label="RAG 检索条数"
            value={params.ragLimit}
            min={1}
            max={10}
            step={1}
            onChange={v => setParams(p => ({ ...p, ragLimit: v }))}
            description={
              params.ragLimit <= 3
                ? `保守模式：检索 ${params.ragLimit} 条，Token 占用少，适合短场景`
                : params.ragLimit <= 6
                ? `推荐模式：检索 ${params.ragLimit} 条，兼顾质量与效率（推荐）`
                : `深度模式：检索 ${params.ragLimit} 条，参考更全面，适合长篇章或素材丰富的场景`
            }
          />

          <SliderControl
            label="角色忠诚度"
            value={params.characterLoyalty}
            min={1}
            max={10}
            step={1}
            onChange={v => setParams(p => ({ ...p, characterLoyalty: v }))}
            description="对角色设定卡的遵守严格程度"
          />
        </div>

        {/* 氛围选择 */}
        <div>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
            <Music className="w-3.5 h-3.5" />
            氛围
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TONE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setParams(p => ({ ...p, tone: opt.value }))}
                className={`px-3 py-2 rounded-xl text-sm transition-colors min-h-[44px] ${
                  params.tone === opt.value
                    ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                    : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 长度目标 */}
        <div>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
            <FileText className="w-3.5 h-3.5" />
            长度
          </label>
          <div className="flex gap-2">
            {[
              { value: "short" as const, label: "短场景" },
              { value: "chapter" as const, label: "完整章" },
              { value: "arc" as const, label: "故事线" },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setParams(p => ({ ...p, lengthTarget: opt.value }))}
                className={`flex-1 px-3 py-2 rounded-xl text-sm transition-colors ${
                  params.lengthTarget === opt.value
                    ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                    : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 正史约束 */}
        <div>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
            <Shield className="w-3.5 h-3.5" />
            正史约束
          </label>
          <div className="flex gap-2">
            {[
              { value: "strict" as const, label: "严格" },
              { value: "loose" as const, label: "宽松" },
              { value: "au" as const, label: "AU" },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setParams(p => ({ ...p, canonConstraint: opt.value }))}
                className={`flex-1 px-3 py-2 rounded-xl text-sm transition-colors ${
                  params.canonConstraint === opt.value
                    ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                    : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 生成按钮 */}
        {!useOutlineMode && (
          <>
            {isGenerating ? (
              <button
                onClick={onCancelGeneration}
                className="w-full py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-full font-medium text-sm transition-colors flex items-center justify-center gap-2 animate-pulse"
              >
                <X className="w-4 h-4" />
                取消生成
              </button>
            ) : (
              <button
                onClick={onGenerate}
                disabled={!selectedSeriesId || !brief.trim()}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-[#111827] rounded-full font-medium text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Wand2 className="w-4 h-4" />
                开始创作
              </button>
            )}
          </>
        )}

        {/* 生成进度步骤条 */}
        {genProgress && (
          <GenerationStepper progress={genProgress} steps={useOutlineMode ? OUTLINE_STEPS : DEFAULT_STEPS} />
        )}

        {/* 错误展示 */}
        <ErrorDisplay
          error={generationError}
          onRetry={() => {
            setGenerationError(null)
            onGenerate()
          }}
          onDismiss={() => setGenerationError(null)}
        />
      </div>
    </aside>
  )
}
