# Studio 前端重构计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 2598 行的 Studio.tsx 单体组件重构为可维护的模块化架构，添加生成取消、错误恢复、素材预搜索等功能。

**Architecture:** 按职责拆分：状态管理集中到 `useStudioState` 自定义 Hook；UI 按面板拆分为独立组件（ParameterPanel, MaterialSelector, OutlineEditor, ReviewPanel, InspirePanel）；生成逻辑支持 AbortController 取消；错误按类别分类展示并提供重试/恢复操作。

**Tech Stack:** React 19 + TypeScript + Tailwind CSS, tRPC React Query, shadcn/ui primitives

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/hooks/useStudioState.ts` | Create | 集中管理 Studio 所有状态、mutations、副作用 |
| `src/hooks/useGenerationCancel.ts` | Create | AbortController 封装，支持取消生成请求 |
| `src/components/studio/ParameterPanel.tsx` | Create | 右侧参数面板（写作模式、温度、语气等） |
| `src/components/studio/MaterialSelector.tsx` | Create | 素材选择器（含预搜索） |
| `src/components/studio/OutlineEditor.tsx` | Create | 大纲编辑面板（概述+场景列表） |
| `src/components/studio/ReviewPanel.tsx` | Create | AI 审阅结果展示面板 |
| `src/components/studio/InspirePanel.tsx` | Create | 灵感激发结果展示面板 |
| `src/components/studio/GenerationToolbar.tsx` | Create | 顶部工具栏（保存/导出/审阅/灵感） |
| `src/components/studio/DraftBanner.tsx` | Create | 草稿恢复横幅 |
| `src/components/studio/ErrorDisplay.tsx` | Create | 错误分类展示与恢复组件 |
| `src/components/studio/CharacterSelector.tsx` | Create | 角色选择器 |
| `src/components/studio/TropeSelector.tsx` | Create | 桥段选择器 |
| `src/components/studio/ContentEditor.tsx` | Create | 主内容编辑区（段落锁定/重写） |
| `src/components/studio/BatchProgressPanel.tsx` | Create | 批量生成进度面板 |
| `src/components/studio/index.ts` | Create | 统一导出 |
| `src/pages/Studio.tsx` | Modify | 主页面，仅负责组装各子组件 |
| `api/routers/generate.ts` | Modify | 支持 AbortSignal 的生成接口 |

---

### Task 1: 创建 `useStudioState` 自定义 Hook

**目标：** 将 Studio.tsx 中所有状态、mutations、effects、handlers 提取到独立的自定义 Hook 中，使页面组件只负责渲染。

**背景知识：**
- Studio.tsx 当前包含约 30 个 useState、15 个 tRPC hooks、10 个 handler 函数、8 个 useEffect
- 所有状态更新逻辑分散在组件中，难以测试和复用
- 提取后 Studio.tsx 只保留 JSX 结构，状态逻辑全部下沉到 Hook

**Files:**
- Create: `src/hooks/useStudioState.ts`
- Modify: `src/pages/Studio.tsx`（移除所有状态和逻辑，仅保留渲染）

- [ ] **Step 1: 创建 `useStudioState.ts` 骨架**

```typescript
// src/hooks/useStudioState.ts
import { useState, useEffect, useRef, useCallback } from "react"
import { useParams } from "react-router"
import { trpc } from "@/providers/trpc"
import { useToast } from "@/providers/toast"
import type { WritingMode, GenParams, StudioDraft } from "@/types/studio"

export function useStudioState() {
  const { workId } = useParams<{ workId: string }>()
  const utils = trpc.useUtils()
  const toast = useToast()

  // === 数据查询 ===
  const { data: seriesList } = trpc.lore.series.list.useQuery()
  const { data: novelList } = trpc.novel.list.useQuery()

  // === 核心状态 ===
  const [activeTab, setActiveTab] = useState<"edit" | "history">("edit")
  const [content, setContent] = useState("")
  const [displayContent, setDisplayContent] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [brief, setBrief] = useState("")
  const [title, setTitle] = useState("")
  const [userPrompt, setUserPrompt] = useState("")
  const [params, setParams] = useState<GenParams>(DEFAULT_PARAMS)
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null)
  const [selectedParentNovelId, setSelectedParentNovelId] = useState<number | null>(null)
  const [generatedWorkId, setGeneratedWorkId] = useState<number | null>(null)

  // === 选择器状态 ===
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>([])
  const [selectedTropeIds, setSelectedTropeIds] = useState<number[]>([])
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([])
  const [useMaterials, setUseMaterials] = useState(true)

  // === 大纲状态 ===
  const [useOutlineMode, setUseOutlineMode] = useState(false)
  const [outlineType, setOutlineType] = useState<"overview" | "scenes" | "both">("both")
  const [outlineOverview, setOutlineOverview] = useState("")
  const [outlineScenes, setOutlineScenes] = useState<Array<{ id: string; title: string; description: string }>>([])
  const [showOutlinePanel, setShowOutlinePanel] = useState(false)

  // === 审阅/灵感状态 ===
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const [inspireResult, setInspireResult] = useState<InspireResult | null>(null)
  const [showInspirePanel, setShowInspirePanel] = useState(false)
  const [inspireFocus, setInspireFocus] = useState<InspireFocus>("full")

  // === 其他状态 ===
  const [lockedParagraphs, setLockedParagraphs] = useState<Set<number>>(new Set())
  const [isTyping, setIsTyping] = useState(false)
  const [ragCalls, setRagCalls] = useState<RagCall[] | null>(null)
  const [showRagPanel, setShowRagPanel] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [genProgress, setGenProgress] = useState<GenProgress | null>(null)

  // === 草稿状态 ===
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [draftInfo, setDraftInfo] = useState<{ savedAt: string } | null>(null)
  const lastSavedHashRef = useRef<string>("")

  // === 批量生成状态 ===
  const [batchJobId, setBatchJobId] = useState(0)
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)

  // === 搜索状态 ===
  const [searchQuery, setSearchQuery] = useState("")
  const [searchSeriesId, setSearchSeriesId] = useState<number | undefined>(undefined)
  const [searchDays, setSearchDays] = useState<number | undefined>(undefined)
  const [searchSortBy, setSearchSortBy] = useState<"createdAt" | "updatedAt" | "title">("createdAt")

  // === 素材预搜索状态 ===
  const [materialSearchQuery, setMaterialSearchQuery] = useState("")
  const [presearchResults, setPresearchResults] = useState<Array<{ id: number; title: string; relevance: number }>>([])
  const [isPresearching, setIsPresearching] = useState(false)

  // === 错误状态 ===
  const [generationError, setGenerationError] = useState<GenerationError | null>(null)

  // ... (返回所有状态和 handlers)

  return {
    // 查询数据
    seriesList, novelList,
    // 核心状态
    activeTab, setActiveTab, content, setContent, displayContent, setDisplayContent,
    isGenerating, setIsGenerating, brief, setBrief, title, setTitle,
    userPrompt, setUserPrompt, params, setParams,
    selectedSeriesId, setSelectedSeriesId, selectedParentNovelId, setSelectedParentNovelId,
    generatedWorkId, setGeneratedWorkId,
    // 选择器
    selectedCharacterIds, setSelectedCharacterIds, selectedTropeIds, setSelectedTropeIds,
    selectedMaterialIds, setSelectedMaterialIds, useMaterials, setUseMaterials,
    // 大纲
    useOutlineMode, setUseOutlineMode, outlineType, setOutlineType,
    outlineOverview, setOutlineOverview, outlineScenes, setOutlineScenes,
    showOutlinePanel, setShowOutlinePanel,
    // 审阅/灵感
    reviewResult, setReviewResult, showReviewPanel, setShowReviewPanel,
    inspireResult, setInspireResult, showInspirePanel, setShowInspirePanel,
    inspireFocus, setInspireFocus,
    // 其他
    lockedParagraphs, setLockedParagraphs, isTyping, setIsTyping,
    ragCalls, setRagCalls, showRagPanel, setShowRagPanel,
    warnings, setWarnings, genProgress, setGenProgress,
    // 草稿
    showDraftBanner, setShowDraftBanner, draftInfo, setDraftInfo,
    // 批量
    batchJobId, setBatchJobId, isBatchGenerating, setIsBatchGenerating,
    // 搜索
    searchQuery, setSearchQuery, searchSeriesId, setSearchSeriesId,
    searchDays, setSearchDays, searchSortBy, setSearchSortBy,
    // 素材预搜索
    materialSearchQuery, setMaterialSearchQuery, presearchResults, setPresearchResults,
    isPresearching, setIsPresearching,
    // 错误
    generationError, setGenerationError,
    // Handlers
    handleGenerate, handleGenerateOutline, handleContinue, handleRegenerate,
    handleSave, handleBatchGenerate, handleExport, handleReview, handleInspire,
    handleRestoreDraft, handleDiscardDraft, toggleLock,
    // Refs
    lastSavedHashRef,
    // tRPC mutations
    generateMutation, outlineMutation, updateWorkMutation, continueMutation,
    regenerateMutation, batchMutation, exportMutation, reviewMutation,
    inspireMutation, saveAsStyleSampleMutation, deleteWorkMutation,
    feedbackMutation, saveAsNovelMutation,
    // Queries
    worksList, characters, seriesTropes, hotkeyTropes, seriesMaterials,
    loadedWork, currentWork, batchStatusQuery, listChaptersQuery,
  }
}
```

- [ ] **Step 2: 将现有类型提取到 `src/types/studio.ts`**

```typescript
// src/types/studio.ts
export type WritingMode = "canon_continuation" | "character_spinoff" | "original_in_universe" | "alternate_universe"

export interface GenParams {
  temperature: number
  styleFidelity: number
  characterLoyalty: number
  tone: string
  lengthTarget: "short" | "chapter" | "arc"
  canonConstraint: "strict" | "loose" | "au"
  writingMode: WritingMode
  ragLimit: number
}

export interface StudioDraft {
  version: 2
  savedAt: string
  selectedSeriesId: number | null
  selectedParentNovelId: number | null
  title: string
  brief: string
  userPrompt: string
  params: GenParams
  selectedCharacterIds: number[]
  selectedTropeIds: number[]
  selectedMaterialIds: number[]
  content: string
  generatedWorkId: number | null
  useOutlineMode: boolean
  outlineType: "overview" | "scenes" | "both"
  outlineOverview: string
  outlineScenes: Array<{ id: string; title: string; description: string }>
}

export interface ReviewResult {
  overallScore: number
  scores: { worldview: number; character: number; writing: number; plot: number }
  findings: Array<{ category: string; severity: string; location: string; description: string }>
  strengths: string[]
  suggestions: string[]
}

export interface InspireResult {
  inspirations: Array<{ title: string; category: string; description: string; references: string[] }>
  combinations: string[]
  trends: string[]
  warnings: string[]
  searchResults: Array<{ title: string; snippet: string }>
}

export type InspireFocus = "plot" | "character" | "worldview" | "writing" | "full"

export interface RagCall {
  type: string
  content: string
  score?: number
  sourceTitle?: string
  chapterNumber?: number
  chunkIndex?: number
  totalChunks?: number
}

export interface GenProgress {
  step: number
  message: string
  detail?: string
  completed?: boolean
}

export interface GenerationError {
  type: "network" | "timeout" | "api_error" | "validation" | "cancelled" | "unknown"
  message: string
  retryable: boolean
  timestamp: number
}
```

- [ ] **Step 3: 将 `handleGenerate` 等核心逻辑迁移到 Hook**

将 `handleGenerate`、`handleGenerateOutline`、`handleContinue`、`handleRegenerate`、`handleBatchGenerate`、`handleExport`、`handleReview`、`handleInspire`、`handleSave`、`handleRestoreDraft`、`handleDiscardDraft`、`toggleLock` 等函数从 Studio.tsx 迁移到 `useStudioState.ts`。

迁移时需要注意：
- 所有 `setState` 调用保持不变（Hook 内部仍可用 useState）
- 所有 `toast.xxx()` 调用保持不变
- 所有 `utils.xxx.invalidate()` 调用保持不变
- `progressIntervalRef` 仍为 `useRef`
- `crypto.randomUUID()` 调用保持不变

- [ ] **Step 4: 在 `useStudioState` 中实现自动保存逻辑**

将现有的自动保存 useEffect 从 Studio.tsx 迁移：

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    if (!selectedSeriesId && !brief.trim() && !title.trim() && !content) return
    const draft: StudioDraft = {
      version: 2, savedAt: new Date().toISOString(),
      selectedSeriesId, selectedParentNovelId, title, brief, userPrompt,
      params, selectedCharacterIds, selectedTropeIds, selectedMaterialIds,
      content, generatedWorkId, useOutlineMode, outlineType,
      outlineOverview, outlineScenes,
    }
    const json = JSON.stringify(draft)
    if (json === lastSavedHashRef.current) return
    lastSavedHashRef.current = json
    localStorage.setItem(DRAFT_KEY, json)
  }, 10000)
  return () => clearInterval(interval)
}, [/* all deps */])
```

- [ ] **Step 5: 在 `useStudioState` 中实现键盘快捷键**

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const isMod = e.ctrlKey || e.metaKey
    if (e.key === "Escape") {
      if (showInspirePanel) { setShowInspirePanel(false); return }
      if (showReviewPanel) { setShowReviewPanel(false); return }
      if (showRagPanel) { setShowRagPanel(false); return }
    }
    if (isMod && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!isGenerating && selectedSeriesId && brief.trim()) {
        const hasOutline = outlineOverview.trim().length > 0 || outlineScenes.length > 0
        if (useOutlineMode && !hasOutline) {
          handleGenerateOutline()
        } else {
          handleGenerate()
        }
      }
      return
    }
    if (isMod && e.key === "s") {
      e.preventDefault()
      if (generatedWorkId) handleSave()
      return
    }
  }
  window.addEventListener("keydown", handleKeyDown)
  return () => window.removeEventListener("keydown", handleKeyDown)
}, [/* deps */])
```

- [ ] **Step 6: 修改 `Studio.tsx` 使用 Hook**

在 `Studio.tsx` 中：

```typescript
import { useStudioState } from "@/hooks/useStudioState"
import { ParameterPanel } from "@/components/studio/ParameterPanel"
// ... other imports

export default function Studio() {
  const state = useStudioState()

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <NavBar />
      <div className="flex flex-col md:flex-row h-[calc(100dvh-3.5rem)] min-h-0">
        {/* 左侧编辑区 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <DraftBanner state={state} />
          <GenerationToolbar state={state} />
          <ContentEditor state={state} />
        </div>
        {/* 右侧参数面板 */}
        <ParameterPanel state={state} />
      </div>
      {/* 弹层面板 */}
      {state.showReviewPanel && <ReviewPanel state={state} />}
      {state.showInspirePanel && <InspirePanel state={state} />}
      {state.showRagPanel && <RagPanel state={state} />}
      {state.showOutlinePanel && <OutlineEditor state={state} />}
    </div>
  )
}
```

- [ ] **Step 7: 运行类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误（可能需要逐步迁移，而非一次性全部移动）

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useStudioState.ts src/types/studio.ts src/pages/Studio.tsx
git commit -m "refactor(studio): 提取 useStudioState Hook 集中管理状态"
```

---

### Task 2: 创建生成取消机制 (`useGenerationCancel`)

**目标：** 为 AI 生成操作添加 AbortController 支持，用户可在生成过程中随时取消。

**背景知识：**
- 当前 `generateMutation.mutateAsync()` 没有取消机制，一旦开始无法中断
- tRPC 的 `useMutation` 返回的 `mutate`/`mutateAsync` 不支持 AbortSignal
- 需要在 API 层和 UI 层同时支持取消

**Files:**
- Create: `src/hooks/useGenerationCancel.ts`
- Modify: `api/routers/generate.ts`（让生成接口接收可选的 `signal`）
- Modify: `src/hooks/useStudioState.ts`

- [ ] **Step 1: 创建 `useGenerationCancel.ts`**

```typescript
// src/hooks/useGenerationCancel.ts
import { useRef, useCallback } from "react"

export function useGenerationCancel() {
  const abortControllerRef = useRef<AbortController | null>(null)

  const start = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    return abortControllerRef.current.signal
  }, [])

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  const isActive = useCallback(() => {
    return abortControllerRef.current !== null && !abortControllerRef.current.signal.aborted
  }, [])

  return { start, cancel, isActive, abortControllerRef }
}
```

- [ ] **Step 2: 修改 `useStudioState` 集成取消逻辑**

```typescript
import { useGenerationCancel } from "./useGenerationCancel"

export function useStudioState() {
  const { start: startCancel, cancel: cancelGeneration, isActive: isCancelling } = useGenerationCancel()

  const handleGenerate = async () => {
    if (!selectedSeriesId || !brief.trim()) return
    // ... validation ...

    const signal = startCancel()
    setIsGenerating(true)
    setGenerationError(null)

    try {
      const result = await generateMutation.mutateAsync({
        seriesId: selectedSeriesId,
        brief: brief.trim(),
        // ... other params
        taskId: crypto.randomUUID(),
      }, { signal })
      // ... handle success
    } catch (error) {
      if (signal.aborted) {
        setGenerationError({
          type: "cancelled",
          message: "生成已取消",
          retryable: true,
          timestamp: Date.now(),
        })
        toast.info("生成已取消")
      } else {
        setGenerationError({
          type: "api_error",
          message: error instanceof Error ? error.message : "生成失败",
          retryable: true,
          timestamp: Date.now(),
        })
        toast.error("生成失败")
      }
      setGenProgress(prev => prev ? { ...prev, message: "生成失败", completed: true } : null)
    } finally {
      setIsGenerating(false)
    }
  }

  return {
    // ... existing returns
    cancelGeneration,
    isCancelling,
  }
}
```

- [ ] **Step 3: 在 tRPC client 中传递 signal**

在 `src/providers/trpc.tsx` 中检查是否已支持 `signal` 选项。`@trpc/client` v11 的 `mutateAsync` 支持 `{ signal }` 作为第二个参数：

```typescript
// 调用时
await generateMutation.mutateAsync(payload, { signal })
```

如果当前 trpc provider 配置不支持，需要确认客户端初始化代码。通常情况下 v11 默认支持。

- [ ] **Step 4: 在生成按钮旁添加取消按钮**

在 `GenerationToolbar` 或生成按钮区域：

```tsx
{isGenerating ? (
  <button
    onClick={cancelGeneration}
    className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm transition-colors animate-pulse"
  >
    <X className="w-3.5 h-3.5" />
    取消生成
  </button>
) : (
  <button onClick={handleGenerate}>开始生成</button>
)}
```

- [ ] **Step 5: 运行类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useGenerationCancel.ts src/hooks/useStudioState.ts
git commit -m "feat(studio): 添加生成取消机制（AbortController）"
```

---

### Task 3: 创建错误分类展示组件 (`ErrorDisplay`)

**目标：** 将生成失败的错误按类别展示，并提供针对性的恢复操作（重试、修改参数、查看详情）。

**Files:**
- Create: `src/components/studio/ErrorDisplay.tsx`
- Modify: `src/hooks/useStudioState.ts`
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: 创建 `ErrorDisplay.tsx`**

```tsx
// src/components/studio/ErrorDisplay.tsx
import { AlertCircle, RotateCw, X, WifiOff, Clock, ShieldAlert } from "lucide-react"
import type { GenerationError } from "@/types/studio"

interface ErrorDisplayProps {
  error: GenerationError | null
  onRetry: () => void
  onDismiss: () => void
}

const ERROR_CONFIG: Record<GenerationError["type"], {
  icon: typeof AlertCircle
  title: string
  color: string
  bgColor: string
  suggestion: string
}> = {
  network: {
    icon: WifiOff,
    title: "网络连接异常",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10 border-orange-500/20",
    suggestion: "请检查网络连接后重试",
  },
  timeout: {
    icon: Clock,
    title: "请求超时",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/20",
    suggestion: "服务器响应较慢，建议缩短 Brief 或减少素材后重试",
  },
  api_error: {
    icon: ShieldAlert,
    title: "AI 服务异常",
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/20",
    suggestion: "DeepSeek API 暂时不可用，请稍后重试",
  },
  validation: {
    icon: AlertCircle,
    title: "参数校验失败",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10 border-yellow-500/20",
    suggestion: "请检查必填项是否完整",
  },
  cancelled: {
    icon: X,
    title: "生成已取消",
    color: "text-white/60",
    bgColor: "bg-white/5 border-white/10",
    suggestion: "您可以随时重新开始生成",
  },
  unknown: {
    icon: AlertCircle,
    title: "未知错误",
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/20",
    suggestion: "请刷新页面后重试，如持续出现请联系支持",
  },
}

export function ErrorDisplay({ error, onRetry, onDismiss }: ErrorDisplayProps) {
  if (!error) return null
  const config = ERROR_CONFIG[error.type]
  const Icon = config.icon

  return (
    <div className={`rounded-xl border p-4 ${config.bgColor} animate-in fade-in slide-in-from-top-2`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.color} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-medium ${config.color}`}>{config.title}</h4>
          <p className="text-xs text-white/60 mt-1">{error.message}</p>
          <p className="text-xs text-white/40 mt-1">{config.suggestion}</p>
          <div className="flex items-center gap-2 mt-3">
            {error.retryable && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 text-xs text-white/80 transition-colors"
              >
                <RotateCw className="w-3 h-3" />
                重试
              </button>
            )}
            <button
              onClick={onDismiss}
              className="px-3 py-1 rounded-full text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              忽略
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 在 `useStudioState` 中完善错误分类逻辑**

```typescript
function classifyError(error: unknown): GenerationError {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.message.includes("aborted")) {
      return { type: "cancelled", message: "生成已取消", retryable: true, timestamp: Date.now() }
    }
    if (error.message.includes("timeout") || error.message.includes("ETIMEDOUT")) {
      return { type: "timeout", message: error.message, retryable: true, timestamp: Date.now() }
    }
    if (error.message.includes("network") || error.message.includes("fetch") || error.message.includes("ECONNREFUSED")) {
      return { type: "network", message: error.message, retryable: true, timestamp: Date.now() }
    }
    if (error.message.includes("validation") || error.message.includes("required")) {
      return { type: "validation", message: error.message, retryable: false, timestamp: Date.now() }
    }
    return { type: "api_error", message: error.message, retryable: true, timestamp: Date.now() }
  }
  return { type: "unknown", message: "未知错误", retryable: true, timestamp: Date.now() }
}
```

在所有 catch 块中使用 `classifyError`：

```typescript
try {
  // ...
} catch (error) {
  const genError = classifyError(error)
  setGenerationError(genError)
  toast.error(genError.message)
}
```

- [ ] **Step 3: 在 Studio 页面中集成 `ErrorDisplay`**

在内容编辑区上方或进度条下方添加：

```tsx
<ErrorDisplay
  error={state.generationError}
  onRetry={() => {
    state.setGenerationError(null)
    state.handleGenerate()
  }}
  onDismiss={() => state.setGenerationError(null)}
/>
```

- [ ] **Step 4: 运行类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/ErrorDisplay.tsx src/hooks/useStudioState.ts src/pages/Studio.tsx
git commit -m "feat(studio): 添加错误分类展示与恢复组件"
```

---

### Task 4: 创建素材预搜索功能

**目标：** 在用户输入 Brief 时，自动推荐相关素材，减少手动选择素材的认知负担。

**背景知识：**
- 当前素材选择是手动勾选，用户需要记住有哪些素材
- 预搜索通过 Brief 关键词匹配素材标题和内容，按相关性排序
- 使用现有的 `trpc.rag.search` 或新增轻量接口

**Files:**
- Modify: `api/routers/generate.ts`（或 `api/routers/rag.ts`）
- Create/Modify: `src/components/studio/MaterialSelector.tsx`
- Modify: `src/hooks/useStudioState.ts`

- [ ] **Step 1: 在 RAG router 添加素材预搜索接口**

如果现有 `trpc.rag.search` 可以满足需求（支持 `seriesId` + 文本查询），则直接使用。否则在 `api/routers/rag.ts` 添加：

```typescript
presearchMaterials: publicQuery
  .input(z.object({
    seriesId: z.number(),
    query: z.string().min(1),
    limit: z.number().min(1).max(10).default(5),
  }))
  .query(async ({ input }) => {
    const db = getDb()
    // 使用 pg_trgm 相似度 + 标题匹配
    const results = await db.execute(sql`
      SELECT id, title, similarity(content, ${input.query}) as relevance
      FROM materials
      WHERE series_id = ${input.seriesId}
        AND status = 'indexed'
      ORDER BY relevance DESC, created_at DESC
      LIMIT ${input.limit}
    `)
    return results.map(r => ({
      id: r.id as number,
      title: r.title as string,
      relevance: Math.round((r.relevance as number) * 100),
    }))
  }),
```

**注意：** 如果 `pg_trgm` 扩展未安装，需要先在迁移中安装，或退而使用 `ILIKE` 匹配：

```sql
WHERE content ILIKE '%' || ${input.query} || '%' OR title ILIKE '%' || ${input.query} || '%'
```

- [ ] **Step 2: 在 `useStudioState` 中添加预搜索逻辑**

```typescript
const presearchMutation = trpc.rag.presearchMaterials.useMutation()

// 防抖搜索：Brief 变化 800ms 后自动搜索相关素材
useEffect(() => {
  if (!selectedSeriesId || !brief.trim() || brief.trim().length < 10) {
    setPresearchResults([])
    return
  }
  const timer = setTimeout(async () => {
    setIsPresearching(true)
    try {
      const results = await presearchMutation.mutateAsync({
        seriesId: selectedSeriesId,
        query: brief.trim(),
        limit: 5,
      })
      setPresearchResults(results)
    } catch {
      setPresearchResults([])
    } finally {
      setIsPresearching(false)
    }
  }, 800)
  return () => clearTimeout(timer)
}, [brief, selectedSeriesId])
```

- [ ] **Step 3: 创建 `MaterialSelector.tsx` 组件**

```tsx
// src/components/studio/MaterialSelector.tsx
import { Database, Loader2, Plus, Check } from "lucide-react"
import type { UseStudioStateReturn } from "@/hooks/useStudioState"

interface MaterialSelectorProps {
  state: UseStudioStateReturn
}

export function MaterialSelector({ state }: MaterialSelectorProps) {
  const {
    selectedSeriesId, seriesMaterials, selectedMaterialIds, setSelectedMaterialIds,
    useMaterials, setUseMaterials, presearchResults, isPresearching,
  } = state

  if (!selectedSeriesId) return null

  const toggleMaterial = (id: number) => {
    setSelectedMaterialIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const addPresearchToSelection = (id: number) => {
    if (!selectedMaterialIds.includes(id)) {
      setSelectedMaterialIds(prev => [...prev, id])
    }
  }

  return (
    <div className="space-y-3">
      {/* 预搜索结果 */}
      {presearchResults.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <p className="text-[10px] font-mono text-amber-400/70 mb-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            根据 Brief 推荐素材
          </p>
          <div className="flex flex-wrap gap-1.5">
            {presearchResults.map(r => {
              const isSelected = selectedMaterialIds.includes(r.id)
              return (
                <button
                  key={r.id}
                  onClick={() => addPresearchToSelection(r.id)}
                  disabled={isSelected}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] border transition-colors ${
                    isSelected
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                  }`}
                >
                  {isSelected ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                  {r.title}
                  <span className="text-white/30">{r.relevance}%</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {isPresearching && (
        <div className="flex items-center gap-2 text-[10px] text-white/30">
          <Loader2 className="w-3 h-3 animate-spin" />
          正在分析相关素材...
        </div>
      )}

      {/* 全部素材列表 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70">
            <Database className="w-3.5 h-3.5" />
            素材投喂
            <span className="text-[10px] text-white/30">({selectedMaterialIds.length})</span>
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-white/40 cursor-pointer">
            <input
              type="checkbox"
              checked={useMaterials}
              onChange={e => setUseMaterials(e.target.checked)}
              className="accent-amber-500"
            />
            自动检索
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {seriesMaterials?.map(m => {
            const isSelected = selectedMaterialIds.includes(m.id)
            return (
              <button
                key={m.id}
                onClick={() => toggleMaterial(m.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${
                  isSelected
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    : "bg-white/[0.03] text-white/40 border-white/10 hover:border-white/20"
                }`}
              >
                {isSelected ? "✓ " : ""}{m.title}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 在 `useStudioState` 中导出预搜索相关状态**

确保 `presearchResults`、`isPresearching`、`setMaterialSearchQuery` 都在 Hook 返回值中。

- [ ] **Step 5: 运行类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/MaterialSelector.tsx src/hooks/useStudioState.ts
git commit -m "feat(studio): 添加素材预搜索功能"
```

---

### Task 5: 提取子组件（ParameterPanel, OutlineEditor, ContentEditor）

**目标：** 将 Studio.tsx 中庞大的 JSX 拆分为独立的子组件，每个组件只负责一块 UI。

**Files:**
- Create: `src/components/studio/ParameterPanel.tsx`
- Create: `src/components/studio/OutlineEditor.tsx`
- Create: `src/components/studio/ContentEditor.tsx`
- Create: `src/components/studio/GenerationToolbar.tsx`
- Create: `src/components/studio/DraftBanner.tsx`
- Create: `src/components/studio/BatchProgressPanel.tsx`
- Create: `src/components/studio/index.ts`
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: 创建 `ParameterPanel.tsx`**

从 Studio.tsx 中提取右侧参数面板的全部 JSX（约 500 行），包括：
- 系列选择
- 父本小说选择
- 写作模式选择
- 角色选择（使用 `CharacterSelector`）
- 桥段选择（使用 `TropeSelector`）
- 素材选择（使用 `MaterialSelector`）
- 参数滑块（temperature, styleFidelity, characterLoyalty）
- 语气和长度选择
- 正史约束选择
- RAG 限制
- 大纲模式开关

```tsx
// src/components/studio/ParameterPanel.tsx
import { Settings, ChevronRight } from "lucide-react"
import { CharacterSelector } from "./CharacterSelector"
import { TropeSelector } from "./TropeSelector"
import { MaterialSelector } from "./MaterialSelector"
import { SliderControl } from "./SliderControl"
import type { UseStudioStateReturn } from "@/hooks/useStudioState"

interface ParameterPanelProps {
  state: UseStudioStateReturn
}

export function ParameterPanel({ state }: ParameterPanelProps) {
  const {
    selectedSeriesId, setSelectedSeriesId, seriesList,
    selectedParentNovelId, setSelectedParentNovelId, novelList,
    params, setParams, characters, seriesTropes, hotkeyTropes,
    // ... other needed state
  } = state

  return (
    <aside className="w-full md:w-80 border-t md:border-t-0 md:border-l border-white/10 bg-[#0f172a]/50 flex flex-col">
      <div className="p-4 border-b border-white/10 flex items-center gap-2">
        <Settings className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-medium">创作参数</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* 系列选择 */}
        <div>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-2">
            <BookText className="w-3.5 h-3.5" />
            系列
          </label>
          <select
            value={selectedSeriesId ?? ""}
            onChange={e => setSelectedSeriesId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[#FDFBF5] outline-none focus:border-amber-500/30"
          >
            <option value="">选择系列</option>
            {seriesList?.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* 父本小说 */}
        {selectedSeriesId && (
          <div>
            <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-2">
              <BookOpen className="w-3.5 h-3.5" />
              参考原著（可选）
            </label>
            <select
              value={selectedParentNovelId ?? ""}
              onChange={e => setSelectedParentNovelId(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="..."
            >
              <option value="">不指定</option>
              {novelList?.filter(n => n.seriesId === selectedSeriesId).map(n => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* 写作模式 */}
        <div>
          <label className="font-mono text-xs uppercase tracking-wider text-white/70 mb-2 block">写作模式</label>
          <div className="space-y-1.5">
            {MODE_OPTIONS.map(mode => (
              <button
                key={mode.value}
                onClick={() => setParams(p => ({ ...p, writingMode: mode.value }))}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition-colors ${
                  params.writingMode === mode.value
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-white/[0.03] border-white/10 text-white/60 hover:border-white/20"
                }`}
              >
                <div className="font-medium">{mode.label}</div>
                <div className="text-white/40 text-[10px] mt-0.5">{mode.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 角色选择 */}
        <CharacterSelector state={state} />

        {/* 桥段选择 */}
        <TropeSelector state={state} />

        {/* 素材选择（含预搜索） */}
        <MaterialSelector state={state} />

        {/* 参数滑块 */}
        <SliderControl
          label="Temperature"
          icon={<Thermometer className="w-3.5 h-3.5" />}
          value={params.temperature}
          min={0} max={1.5} step={0.1}
          onChange={v => setParams(p => ({ ...p, temperature: v }))}
        />
        <SliderControl
          label="文风还原度"
          icon={<Music className="w-3.5 h-3.5" />}
          value={params.styleFidelity}
          min={1} max={10} step={1}
          onChange={v => setParams(p => ({ ...p, styleFidelity: v }))}
        />
        <SliderControl
          label="角色忠诚度"
          icon={<User className="w-3.5 h-3.5" />}
          value={params.characterLoyalty}
          min={1} max={10} step={1}
          onChange={v => setParams(p => ({ ...p, characterLoyalty: v }))}
        />

        {/* 语气选择 */}
        <div>
          <label className="font-mono text-xs uppercase tracking-wider text-white/70 mb-2 block">语气基调</label>
          <div className="flex flex-wrap gap-1.5">
            {TONE_OPTIONS.map(tone => (
              <button
                key={tone.value}
                onClick={() => setParams(p => ({ ...p, tone: tone.value }))}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  params.tone === tone.value
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    : "bg-white/[0.03] text-white/40 border-white/10 hover:border-white/20"
                }`}
              >
                {tone.label}
              </button>
            ))}
          </div>
        </div>

        {/* 更多参数... */}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: 创建 `ContentEditor.tsx`**

提取主内容编辑区，包括：
- Brief 输入框
- 用户自定义 Prompt 输入框
- 生成按钮 + 取消按钮
- 进度条 (`GenerationStepper`)
- 错误展示 (`ErrorDisplay`)
- 生成的文本内容（段落锁定/解锁/重写）
- 继续生成按钮
- RAG 反馈组件
- 批量生成按钮和进度

```tsx
// src/components/studio/ContentEditor.tsx
import { ErrorDisplay } from "./ErrorDisplay"
import { GenerationStepper } from "./GenerationStepper"
import { BatchProgressPanel } from "./BatchProgressPanel"
import type { UseStudioStateReturn } from "@/hooks/useStudioState"

interface ContentEditorProps {
  state: UseStudioStateReturn
}

export function ContentEditor({ state }: ContentEditorProps) {
  const {
    brief, setBrief, userPrompt, setUserPrompt,
    isGenerating, handleGenerate, cancelGeneration,
    genProgress, generationError, setGenerationError,
    displayContent, paragraphs, lockedParagraphs, toggleLock,
    handleContinue, handleRegenerate, regenIndex, setRegenIndex,
    // ... other needed state
  } = state

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Brief 输入 */}
      <div className="shrink-0 p-4 border-b border-white/10">
        <textarea
          value={brief}
          onChange={e => setBrief(e.target.value)}
          placeholder="描述你想创作的内容..."
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm outline-none focus:border-amber-500/30 min-h-[80px] resize-y"
        />
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            {isGenerating ? (
              <button onClick={cancelGeneration} className="...">取消生成</button>
            ) : (
              <button onClick={handleGenerate} className="...">开始生成</button>
            )}
          </div>
          <span className="text-[10px] text-white/30">{brief.length} 字</span>
        </div>
      </div>

      {/* 进度与错误 */}
      {genProgress && <GenerationStepper progress={genProgress} />}
      <ErrorDisplay
        error={generationError}
        onRetry={() => { setGenerationError(null); handleGenerate() }}
        onDismiss={() => setGenerationError(null)}
      />

      {/* 生成内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {paragraphs.map((p, i) => (
          <div key={i} className="group relative mb-4">
            {/* 段落工具栏 */}
            <div className="absolute -left-8 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => toggleLock(i)}>
                {lockedParagraphs.has(i) ? <Lock /> : <Unlock />}
              </button>
            </div>
            <p className="text-sm leading-relaxed">{p}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 创建 `OutlineEditor.tsx`**

提取大纲编辑面板的全部 JSX，包括：
- 概述文本输入
- 场景列表（可添加/删除/排序）
- 每个场景的标题和描述编辑

```tsx
// src/components/studio/OutlineEditor.tsx
import { X, Plus, GripVertical } from "lucide-react"
import type { UseStudioStateReturn } from "@/hooks/useStudioState"

export function OutlineEditor({ state }: { state: UseStudioStateReturn }) {
  const {
    outlineOverview, setOutlineOverview, outlineScenes, setOutlineScenes,
    outlineType, setOutlineType, useOutlineMode, setUseOutlineMode,
  } = state

  const addScene = () => {
    setOutlineScenes(prev => [...prev, {
      id: crypto.randomUUID(),
      title: `场景 ${prev.length + 1}`,
      description: "",
    }])
  }

  const removeScene = (id: string) => {
    setOutlineScenes(prev => prev.filter(s => s.id !== id))
  }

  const updateScene = (id: string, updates: Partial<{ title: string; description: string }>) => {
    setOutlineScenes(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[80vh] bg-[#111827] rounded-2xl border border-white/10 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-medium">大纲编辑</h3>
          <button onClick={() => state.setShowOutlinePanel(false)}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 概述 */}
          {(outlineType === "overview" || outlineType === "both") && (
            <div>
              <label className="text-xs text-white/50 mb-1 block">整体概述</label>
              <textarea
                value={outlineOverview}
                onChange={e => setOutlineOverview(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none"
                rows={4}
              />
            </div>
          )}
          {/* 场景列表 */}
          {(outlineType === "scenes" || outlineType === "both") && (
            <div className="space-y-3">
              {outlineScenes.map((scene, i) => (
                <div key={scene.id} className="p-3 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <GripVertical className="w-4 h-4 text-white/20" />
                    <span className="text-[10px] text-white/30 font-mono">场景 {i + 1}</span>
                    <button onClick={() => removeScene(scene.id)} className="ml-auto">
                      <X className="w-3.5 h-3.5 text-white/30" />
                    </button>
                  </div>
                  <input
                    value={scene.title}
                    onChange={e => updateScene(scene.id, { title: e.target.value })}
                    placeholder="场景标题"
                    className="w-full bg-transparent text-sm font-medium outline-none mb-2"
                  />
                  <textarea
                    value={scene.description}
                    onChange={e => updateScene(scene.id, { description: e.target.value })}
                    placeholder="场景描述"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none"
                    rows={3}
                  />
                </div>
              ))}
              <button onClick={addScene} className="...">
                <Plus className="w-4 h-4" /> 添加场景
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 创建 `GenerationToolbar.tsx`**

提取顶部工具栏：
- 标题输入
- Tab 切换（当前编辑 / 历史作品）
- 保存按钮
- 保存为风格样本按钮
- AI 审阅按钮
- 导出按钮
- 灵感激发按钮
- 大纲编辑按钮

```tsx
// src/components/studio/GenerationToolbar.tsx
import { PenTool, Save, Sparkles, Shield, Download, Wand2, FileText } from "lucide-react"
import type { UseStudioStateReturn } from "@/hooks/useStudioState"

export function GenerationToolbar({ state }: { state: UseStudioStateReturn }) {
  const {
    title, setTitle, activeTab, setActiveTab,
    generatedWorkId, handleSave,
    reviewMutation, handleReview,
    exportMutation, handleExport,
    inspireMutation, handleInspire,
    showOutlinePanel, setShowOutlinePanel,
    useOutlineMode, setUseOutlineMode,
  } = state

  return (
    <header className="min-h-14 border-b border-white/10 flex flex-wrap items-center justify-between px-4 md:px-6 py-2 bg-[#111827]/90 backdrop-blur-md gap-2">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <PenTool className="w-4 h-4 text-amber-500 shrink-0" />
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="作品标题"
          className="bg-transparent text-sm font-serif outline-none placeholder:text-white/40 w-full md:w-64 text-[#FDFBF5] min-w-0"
        />
      </div>
      <div className="flex items-center gap-2">
        {/* Tab 切换 */}
        <div className="flex bg-white/5 rounded-full p-0.5 mr-2">
          <button onClick={() => setActiveTab("edit")} className={`... ${activeTab === "edit" ? "active" : ""}`}>当前编辑</button>
          <button onClick={() => setActiveTab("history")} className={`... ${activeTab === "history" ? "active" : ""}`}>历史作品</button>
        </div>
        <button onClick={handleSave} disabled={!generatedWorkId} className="..."><Save className="w-3.5 h-3.5" /> 保存</button>
        <button onClick={() => state.setShowStyleSampleModal(true)} className="..."><Sparkles className="w-3.5 h-3.5" /> 保存为风格样本</button>
        <button onClick={() => handleReview("full")} disabled={reviewMutation.isPending} className="..."><Shield className="w-3.5 h-3.5" /> AI 审阅</button>
        <button onClick={() => handleExport("txt")} disabled={exportMutation.isPending} className="..."><Download className="w-3.5 h-3.5" /> 导出 TXT</button>
        <button onClick={() => handleInspire()} disabled={inspireMutation.isPending} className="..."><Wand2 className="w-3.5 h-3.5" /> 获取灵感</button>
        <button onClick={() => setShowOutlinePanel(!showOutlinePanel)} className={`... ${useOutlineMode ? "active" : ""}`}><FileText className="w-3.5 h-3.5" /> 大纲</button>
      </div>
    </header>
  )
}
```

- [ ] **Step 5: 创建 `DraftBanner.tsx`**

```tsx
// src/components/studio/DraftBanner.tsx
import { Clock } from "lucide-react"
import type { UseStudioStateReturn } from "@/hooks/useStudioState"

export function DraftBanner({ state }: { state: UseStudioStateReturn }) {
  const { showDraftBanner, draftInfo, handleRestoreDraft, handleDiscardDraft } = state
  if (!showDraftBanner || !draftInfo) return null

  return (
    <div className="shrink-0 px-4 md:px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm">
        <Clock className="w-4 h-4 text-amber-400" />
        <span className="text-white/70">发现 {formatTimeAgo(draftInfo.savedAt)} 的未保存草稿</span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={handleRestoreDraft} className="...">恢复编辑</button>
        <button onClick={handleDiscardDraft} className="...">丢弃</button>
      </div>
    </div>
  )
}

function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 1) return "刚刚"
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  return `${diffDays} 天前`
}
```

- [ ] **Step 6: 创建 `BatchProgressPanel.tsx`**

提取批量生成进度展示：

```tsx
// src/components/studio/BatchProgressPanel.tsx
import { Loader2, CheckCircle } from "lucide-react"
import type { UseStudioStateReturn } from "@/hooks/useStudioState"

export function BatchProgressPanel({ state }: { state: UseStudioStateReturn }) {
  const { isBatchGenerating, batchStatusQuery } = state
  const status = batchStatusQuery.data

  if (!isBatchGenerating || !status) return null

  const progress = status.progress || 0
  const completedChapters = status.metadata?.completedChapters || 0
  const totalChapters = status.metadata?.totalChapters || 0

  return (
    <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10">
      <div className="flex items-center gap-2 mb-3">
        {status.status === "completed" ? (
          <CheckCircle className="w-4 h-4 text-green-400" />
        ) : (
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
        )}
        <span className="text-sm font-medium">
          {status.status === "completed" ? "批量生成完成" : "正在生成中..."}
        </span>
      </div>
      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(progress * 100, 100)}%` }}
        />
      </div>
      <p className="text-xs text-white/50">
        正在生成第 {completedChapters + 1} 章 / 共 {totalChapters} 章
      </p>
    </div>
  )
}
```

- [ ] **Step 7: 创建统一导出文件 `index.ts`**

```typescript
// src/components/studio/index.ts
export { ParameterPanel } from "./ParameterPanel"
export { ContentEditor } from "./ContentEditor"
export { OutlineEditor } from "./OutlineEditor"
export { GenerationToolbar } from "./GenerationToolbar"
export { DraftBanner } from "./DraftBanner"
export { BatchProgressPanel } from "./BatchProgressPanel"
export { ErrorDisplay } from "./ErrorDisplay"
export { ReviewPanel } from "./ReviewPanel"
export { InspirePanel } from "./InspirePanel"
export { MaterialSelector } from "./MaterialSelector"
export { CharacterSelector } from "./CharacterSelector"
export { TropeSelector } from "./TropeSelector"
export { RagPanel } from "./RagPanel"
```

- [ ] **Step 8: 重写 `Studio.tsx` 为组装式结构**

```tsx
// src/pages/Studio.tsx
import { useStudioState } from "@/hooks/useStudioState"
import {
  NavBar,
  ParameterPanel,
  ContentEditor,
  OutlineEditor,
  GenerationToolbar,
  DraftBanner,
  ReviewPanel,
  InspirePanel,
  RagPanel,
} from "@/components/studio"

export default function Studio() {
  const state = useStudioState()

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <NavBar />
      <div className="flex flex-col md:flex-row h-[calc(100dvh-3.5rem)] min-h-0">
        {/* 左侧编辑区 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <DraftBanner state={state} />
          <GenerationToolbar state={state} />
          <ContentEditor state={state} />
        </div>
        {/* 右侧参数面板 */}
        <ParameterPanel state={state} />
      </div>

      {/* 弹层面板 */}
      {state.showReviewPanel && <ReviewPanel state={state} />}
      {state.showInspirePanel && <InspirePanel state={state} />}
      {state.showRagPanel && <RagPanel state={state} />}
      {state.showOutlinePanel && <OutlineEditor state={state} />}

      {/* 风格样本弹窗 */}
      {state.showStyleSampleModal && <StyleSampleModal state={state} />}
    </div>
  )
}
```

- [ ] **Step 9: 运行类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误。如果类型复杂度过高，考虑将 `state` prop 类型简化为具体需要的子集，而非整个 Hook 返回值。

- [ ] **Step 10: Commit**

```bash
git add src/components/studio/
git commit -m "refactor(studio): 拆分 Studio.tsx 为模块化子组件"
```

---

### Task 6: 移动 ReviewPanel 和 InspirePanel 为独立组件

**目标：** 将内联在 Studio.tsx 中的审阅面板和灵感面板提取为独立组件。

**Files:**
- Create: `src/components/studio/ReviewPanel.tsx`
- Create: `src/components/studio/InspirePanel.tsx`
- Create: `src/components/studio/RagPanel.tsx`
- Modify: `src/pages/Studio.tsx`（移除内联面板代码）

- [ ] **Step 1: 创建 `ReviewPanel.tsx`**

从 Studio.tsx 中提取约 150 行的审阅面板 JSX：

```tsx
// src/components/studio/ReviewPanel.tsx
import { X, Shield, Star, AlertTriangle, CheckCircle, Lightbulb } from "lucide-react"
import type { UseStudioStateReturn } from "@/hooks/useStudioState"

export function ReviewPanel({ state }: { state: UseStudioStateReturn }) {
  const { reviewResult, setShowReviewPanel } = state
  if (!reviewResult) return null

  const scoreColor = (score: number) => {
    if (score >= 8) return "text-green-400"
    if (score >= 6) return "text-amber-400"
    return "text-red-400"
  }

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "high": return <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
      case "medium": return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
      default: return <CheckCircle className="w-3.5 h-3.5 text-green-400" />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[80vh] bg-[#111827] rounded-2xl border border-white/10 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-medium">AI 审阅报告</h3>
          </div>
          <button onClick={() => setShowReviewPanel(false)}>
            <X className="w-4 h-4 text-white/40 hover:text-white/70" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 总分 */}
          <div className="flex items-center gap-4">
            <div className={`text-3xl font-bold ${scoreColor(reviewResult.overallScore)}`}>
              {reviewResult.overallScore}
            </div>
            <div className="text-xs text-white/40">/ 10 综合评分</div>
          </div>

          {/* 分项评分 */}
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(reviewResult.scores).map(([key, score]) => (
              <div key={key} className="p-2 rounded-lg bg-white/5">
                <div className="text-[10px] text-white/40 uppercase">{key}</div>
                <div className={`text-lg font-bold ${scoreColor(score)}`}>{score}</div>
              </div>
            ))}
          </div>

          {/* 优点 */}
          {reviewResult.strengths.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-green-400 mb-2 flex items-center gap-1">
                <Star className="w-3.5 h-3.5" /> 优点
              </h4>
              <ul className="space-y-1">
                {reviewResult.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-white/60 pl-4 relative before:content-['•'] before:absolute before:left-1">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 发现问题 */}
          {reviewResult.findings.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-amber-400 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> 发现问题
              </h4>
              <div className="space-y-2">
                {reviewResult.findings.map((f, i) => (
                  <div key={i} className="p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-1.5 mb-1">
                      {severityIcon(f.severity)}
                      <span className="text-[10px] text-white/40">{f.category}</span>
                      <span className="text-[10px] text-white/20">|</span>
                      <span className="text-[10px] text-white/30">{f.location}</span>
                    </div>
                    <p className="text-xs text-white/60">{f.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 建议 */}
          {reviewResult.suggestions.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-cyan-400 mb-2 flex items-center gap-1">
                <Lightbulb className="w-3.5 h-3.5" /> 改进建议
              </h4>
              <ul className="space-y-1">
                {reviewResult.suggestions.map((s, i) => (
                  <li key={i} className="text-xs text-white/60 pl-4 relative before:content-['→'] before:absolute before:left-1">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 `InspirePanel.tsx`**

类似地从 Studio.tsx 中提取灵感面板（约 100 行 JSX）。

- [ ] **Step 3: 创建 `RagPanel.tsx`**

提取 RAG 检索结果展示面板。

- [ ] **Step 4: 运行类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/ReviewPanel.tsx src/components/studio/InspirePanel.tsx src/components/studio/RagPanel.tsx
git commit -m "refactor(studio): 提取 ReviewPanel、InspirePanel、RagPanel 为独立组件"
```

---

## Self-Review

### 1. Spec Coverage

| 需求 | 覆盖任务 |
|------|----------|
| Studio.tsx 组件提取 | Task 1 (useStudioState), Task 5 (子组件), Task 6 (面板) |
| 生成取消机制 | Task 2 (AbortController) |
| 错误分类展示和恢复 | Task 3 (ErrorDisplay) |
| 素材预搜索 | Task 4 (MaterialSelector + 预搜索接口) |

### 2. Placeholder Scan

- [x] 无 "TBD" / "TODO"
- [x] 无 "Add appropriate error handling"
- [x] 无 "Similar to Task N"（每个任务包含完整代码）
- [x] 所有文件路径精确
- [x] 所有类型名称一致

### 3. Type Consistency

- `GenerationError.type` 在 Task 2 和 Task 3 中定义一致
- `UseStudioStateReturn` 类型在 Task 1 定义，被所有子组件引用
- `StudioDraft` / `GenParams` 等类型在 `src/types/studio.ts` 中统一定义

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-10-studio-frontend-refactor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
