import {
  Lock,
  Unlock,
  RotateCw,
  Sparkles,
  Wand2,
  ChevronRight,
  Database,
  Loader2,
  AlertCircle,
  Shield,
  Clock,
  BookOpen,
  Trash2,
} from "lucide-react"
import type { RagCall } from "@/types/studio"
import type { UseMutateFunction } from "@tanstack/react-query"

interface WorkItem {
  id: number
  title: string | null
  brief: string | null
  status: string
  createdAt: string | Date
  generatedContent: string | null
  seriesId: number | null
  parentNovelId: number | null
  parameters?: unknown
  outline?: unknown
}

interface SeriesItem {
  id: number
  name: string
}

interface ContentEditorProps {
  activeTab: "edit" | "history"
  displayContent: string
  isGenerating: boolean
  isTyping: boolean
  generatedWorkId: number | null
  currentWork: { parameters?: Record<string, unknown> } | null | undefined
  paragraphs: string[]
  lockedParagraphs: Set<number>
  regenIndex: number | null
  regenBrief: string
  ragCalls: RagCall[] | null
  feedbackState: "pending" | "helpful" | "unhelpful" | null
  showFeedbackDetail: boolean
  searchQuery: string
  searchSeriesId: number | undefined
  searchDays: number | undefined
  searchSortBy: "createdAt" | "updatedAt" | "title"
  seriesList: SeriesItem[] | undefined
  worksList: WorkItem[] | undefined
  regenerateMutationPending: boolean
  deleteWorkMutationPending: boolean
  setSearchQuery: (v: string) => void
  setSearchSeriesId: (v: number | undefined) => void
  setSearchDays: (v: number | undefined) => void
  setSearchSortBy: (v: "createdAt" | "updatedAt" | "title") => void
  setShowRagPanel: (v: boolean) => void
  setFeedbackState: (v: "pending" | "helpful" | "unhelpful" | null) => void
  setShowFeedbackDetail: (v: boolean) => void
  setRegenIndex: (v: number | null) => void
  setRegenBrief: (v: string) => void
  onToggleLock: (index: number) => void
  onRegenerate: (index: number) => void
  onContinue: () => void
  onLoadWork: (work: WorkItem) => void
  onDeleteWork: UseMutateFunction<unknown, unknown, { id: number }, unknown>
  onFeedback: UseMutateFunction<unknown, unknown, { generationId: number; wasHelpful: boolean; reason?: string }, unknown>
}

export function ContentEditor({
  activeTab,
  displayContent,
  isGenerating,
  isTyping,
  generatedWorkId,
  currentWork,
  paragraphs,
  lockedParagraphs,
  regenIndex,
  regenBrief,
  ragCalls,
  feedbackState,
  showFeedbackDetail,
  searchQuery,
  searchSeriesId,
  searchDays,
  searchSortBy,
  seriesList,
  worksList,
  regenerateMutationPending,
  deleteWorkMutationPending,
  setSearchQuery,
  setSearchSeriesId,
  setSearchDays,
  setSearchSortBy,
  setShowRagPanel,
  setFeedbackState,
  setShowFeedbackDetail,
  setRegenIndex,
  setRegenBrief,
  onToggleLock,
  onRegenerate,
  onContinue,
  onLoadWork,
  onDeleteWork,
  onFeedback,
}: ContentEditorProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8">
      {activeTab === "history" ? (
        <div className="max-w-3xl mx-auto">
          <h2 className="font-mono text-xs uppercase tracking-wider text-white/70 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            历史作品
          </h2>

          {/* 搜索 + 筛选 + 排序 */}
          <div className="mb-6 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索标题或简介..."
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-sm text-[#FDFBF5] placeholder:text-white/30"
              />
              <select
                value={searchSortBy}
                onChange={e => setSearchSortBy(e.target.value as "createdAt" | "updatedAt" | "title")}
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-[#FDFBF5] outline-none focus:border-amber-500"
              >
                <option value="createdAt">最近生成</option>
                <option value="updatedAt">最近修改</option>
                <option value="title">标题字母序</option>
              </select>
            </div>
            <div className="flex gap-2">
              <select
                value={searchSeriesId ?? ""}
                onChange={e => setSearchSeriesId(e.target.value ? Number(e.target.value) : undefined)}
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-[#FDFBF5] outline-none focus:border-amber-500"
              >
                <option value="">全部系列</option>
                {seriesList?.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <select
                value={searchDays ?? ""}
                onChange={e => setSearchDays(e.target.value ? Number(e.target.value) : undefined)}
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-[#FDFBF5] outline-none focus:border-amber-500"
              >
                <option value="">全部时间</option>
                <option value={7}>最近7天</option>
                <option value={30}>最近30天</option>
              </select>
            </div>
          </div>

          {worksList?.length === 0 ? (
            <div className="text-center text-white/60 py-20">
              <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>暂无历史作品</p>
            </div>
          ) : (
            <div className="space-y-3">
              {worksList?.map(work => (
                <div
                  key={work.id}
                  className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-amber-500/20 transition-all group cursor-pointer"
                  onClick={() => onLoadWork(work)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-serif text-lg font-semibold">{work.title || `作品 #${work.id}`}</h3>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                        work.status === "saved" ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/50"
                      }`}>
                        {work.status === "saved" ? "已保存" : "草稿"}
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          if (confirm(`确定删除「${work.title || `作品 #${work.id}`}」？此操作不可撤销。`)) {
                            onDeleteWork({ id: work.id })
                          }
                        }}
                        disabled={deleteWorkMutationPending}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-white/40 text-sm line-clamp-2 mb-2">{work.brief}</p>
                  <p className="text-white/20 text-xs font-mono">
                    {typeof work.createdAt === "string" ? new Date(work.createdAt).toLocaleDateString() : new Date(work.createdAt).toLocaleDateString()} · {(work.generatedContent || "").length} 字
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : displayContent ? (
        <div className="max-w-3xl mx-auto space-y-4">
          {/* 生成后自检结果 */}
          {(() => {
            const sc = (currentWork?.parameters as Record<string, unknown> | undefined)?.selfCritique as { passed: boolean; issues: string[] } | undefined
            if (!sc) return null
            return sc.passed ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                <Shield className="w-4 h-4" />
                <span>自检通过 — 未发现设定违规</span>
              </div>
            ) : (
              <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-400 text-sm mb-2">
                  <AlertCircle className="w-4 h-4" />
                  <span>自检发现 {sc.issues.length} 处可能的问题：</span>
                </div>
                <ul className="space-y-1">
                  {sc.issues.map((issue, i) => (
                    <li key={i} className="text-red-300/80 text-xs pl-5 relative">
                      <span className="absolute left-1.5 top-0.5">·</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}
          {paragraphs.map((para, idx) => (
            <div
              key={idx}
              className={`group relative p-4 rounded-lg transition-colors ${
                lockedParagraphs.has(idx)
                  ? "bg-amber-500/5 border border-amber-500/20"
                  : "hover:bg-white/[0.02] border border-transparent"
              }`}
            >
              <p className="font-serif leading-[1.8] text-[#FDFBF5] whitespace-pre-wrap">
                {para}
              </p>
              <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onToggleLock(idx)}
                  className={`p-1.5 rounded ${
                    lockedParagraphs.has(idx)
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-white/5 text-white/60 hover:text-white/90"
                  }`}
                  title={lockedParagraphs.has(idx) ? "解锁" : "锁定"}
                >
                  {lockedParagraphs.has(idx) ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => { setRegenIndex(idx); setRegenBrief(""); }}
                  className="p-1.5 rounded bg-white/5 text-white/50 hover:text-amber-400"
                  title="重写"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Regenerate form */}
              {regenIndex === idx && (
                <div className="mt-3 p-3 rounded-lg bg-white/5 border border-amber-500/20">
                  <p className="text-xs text-amber-400 mb-2 font-mono">重写要求</p>
                  <textarea
                    value={regenBrief}
                    onChange={e => setRegenBrief(e.target.value)}
                    placeholder="描述你想如何修改这一段..."
                    className="w-full h-20 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => onRegenerate(idx)}
                      disabled={regenerateMutationPending || !regenBrief.trim()}
                      className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full text-xs font-medium"
                    >
                      {regenerateMutationPending ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                      重写
                    </button>
                    <button
                      onClick={() => { setRegenIndex(null); setRegenBrief(""); }}
                      className="px-4 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="flex items-center gap-2 text-amber-500 animate-pulse">
              <Sparkles className="w-4 h-4" />
              <span className="font-mono text-xs">输出中...</span>
            </div>
          )}
        </div>
      ) : (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <Wand2 className="w-12 h-12 text-white/10 mx-auto mb-4" />
            <p className="text-white/60 font-mono text-sm">在右侧面板选择系列并填写创作要求</p>
          </div>
        </div>
      )}

      {/* RAG 查看按钮 */}
      {ragCalls && activeTab === "edit" && (
        <div className="max-w-3xl mx-auto mt-4">
          <button
            onClick={() => setShowRagPanel(true)}
            className="w-full py-2 bg-white/5 hover:bg-white/10 text-white/50 hover:text-amber-400 rounded-full text-sm transition-colors flex items-center justify-center gap-2"
          >
            <Database className="w-4 h-4" />
            查看 RAG 检索详情 ({ragCalls.length} 条)
          </button>
        </div>
      )}

      {/* RAG 反馈闭环 — 👍/👎 */}
      {displayContent && generatedWorkId && activeTab === "edit" && feedbackState !== "helpful" && (
        <div className="max-w-3xl mx-auto mt-4">
          {feedbackState === null ? (
            <div className="flex items-center justify-center gap-3 py-2">
              <span className="text-white/40 text-sm">本次生成满意吗？</span>
              <button
                onClick={() => {
                  if (generatedWorkId) {
                    void onFeedback({ generationId: generatedWorkId, wasHelpful: true })
                    setFeedbackState("helpful")
                  }
                }}
                className="px-4 py-1.5 rounded-full bg-green-500/10 hover:bg-green-500/20 text-green-400 text-sm transition-colors"
              >
                👍 满意
              </button>
              <button
                onClick={() => setFeedbackState("unhelpful")}
                className="px-4 py-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition-colors"
              >
                👎 不满意
              </button>
            </div>
          ) : feedbackState === "unhelpful" ? (
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-white/60 text-sm mb-3">哪方面不对？（可多选）</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {["角色性格不对（OOC）", "风格不像原作", "世界观矛盾", "其他"].map(reason => (
                  <button
                    key={reason}
                    onClick={() => {
                      if (generatedWorkId) {
                        void onFeedback({ generationId: generatedWorkId, wasHelpful: false, reason })
                        setShowFeedbackDetail(true)
                      }
                    }}
                    className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-red-500/20 text-white/60 hover:text-red-400 text-xs transition-colors"
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setFeedbackState(null)}
                className="text-white/30 hover:text-white/60 text-xs"
              >
                取消
              </button>
            </div>
          ) : null}
        </div>
      )}
      {feedbackState === "helpful" && (
        <div className="max-w-3xl mx-auto mt-4 text-center">
          <span className="text-green-400 text-sm">✓ 感谢反馈，已记录</span>
        </div>
      )}
      {showFeedbackDetail && (
        <div className="max-w-3xl mx-auto mt-4 text-center">
          <span className="text-white/40 text-sm">✓ 反馈已提交，我们会据此优化素材检索</span>
        </div>
      )}

      {/* 续写按钮 */}
      {displayContent && generatedWorkId && activeTab === "edit" && (
        <div className="max-w-3xl mx-auto mt-4">
          <button
            onClick={onContinue}
            disabled={isGenerating}
            className="w-full py-3 bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/70 rounded-full text-sm transition-colors flex items-center justify-center gap-2"
          >
            <ChevronRight className="w-4 h-4" />
            续写
          </button>
        </div>
      )}
    </div>
  )
}
