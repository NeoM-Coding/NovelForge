import { useCallback } from "react"
import type { UseQueryResult } from "@tanstack/react-query"
import { RotateCw, AlertCircle, Loader2, CheckCircle, Clock } from "lucide-react"

interface ChapterStatusItem {
  chapterNumber: number
  title: string | null
  status: string
}

interface FailedChapterItem {
  chapterNumber: number
  title: string
  error: string
}

interface BatchStatus {
  status: string
  progress?: number
  currentChapter?: number
  totalChapters?: number
  errorLog?: string
  completedChapters?: ChapterStatusItem[]
  failedChapters?: FailedChapterItem[]
}

interface BatchProgressPanelProps {
  isBatchGenerating: boolean
  batchStatusQuery: UseQueryResult<BatchStatus | null, unknown>
  listChaptersQuery: UseQueryResult<ChapterStatusItem[], unknown>
  retryingChapters: Set<number>
  onRetryChapter: (chapterNumber: number) => void
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; label: string; color: string; bgColor: string }> = {
  pending: { icon: Clock, label: "等待中", color: "text-white/40", bgColor: "bg-white/5" },
  generating: { icon: Loader2, label: "生成中", color: "text-amber-400", bgColor: "bg-amber-500/10" },
  generated: { icon: CheckCircle, label: "已完成", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  failed: { icon: AlertCircle, label: "失败", color: "text-red-400", bgColor: "bg-red-500/10" },
}

export function BatchProgressPanel({
  isBatchGenerating,
  batchStatusQuery,
  listChaptersQuery,
  retryingChapters,
  onRetryChapter,
}: BatchProgressPanelProps) {
  const batchData = batchStatusQuery.data
  const chapters = listChaptersQuery.data || []

  const handleRetry = useCallback((chapterNumber: number) => {
    if (retryingChapters.has(chapterNumber)) return
    onRetryChapter(chapterNumber)
  }, [retryingChapters, onRetryChapter])

  return (
    <div className="space-y-3">
      {/* 总体进度 */}
      {isBatchGenerating && batchData && (
        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
          <div className="flex justify-between text-xs text-white/60 mb-2">
            <span>
              {batchData.currentChapter
                ? `正在处理第 ${batchData.currentChapter} 章 / 共 ${batchData.totalChapters || "?"} 章`
                : "批量生成进度"}
            </span>
            <span className="font-mono text-emerald-400">{batchData.progress?.toFixed(0) || 0}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700 relative"
              style={{ width: `${batchData.progress || 0}%` }}
            >
              {batchData.progress && batchData.progress < 100 && (
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
              )}
            </div>
          </div>
          {batchData.errorLog && (
            <p className="text-xs text-red-400/80 mt-2 line-clamp-2">{batchData.errorLog}</p>
          )}
        </div>
      )}

      {/* 章节列表 */}
      {chapters.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider">章节状态</h4>
            <span className="text-[10px] text-white/30 font-mono">
              共 {chapters.length} 章 ·{" "}
              {chapters.reduce((sum, ch) => sum + ((ch as unknown as { content?: string }).content?.length || 0), 0).toLocaleString()} 字
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {chapters.map(ch => {
              const config = STATUS_CONFIG[ch.status] || STATUS_CONFIG.pending
              const Icon = config.icon
              const isRetrying = retryingChapters.has(ch.chapterNumber)

              return (
                <div
                  key={ch.chapterNumber}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm border ${config.bgColor} border-white/5`}
                >
                  <Icon className={`w-3.5 h-3.5 ${config.color} shrink-0 ${ch.status === "generating" ? "animate-spin" : ""}`} />
                  <span className="text-amber-400 text-xs font-mono w-12 shrink-0">第{ch.chapterNumber}章</span>
                  <span className="text-white/80 truncate flex-1">{ch.title || "未命名"}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${config.bgColor} ${config.color}`}>
                    {config.label}
                  </span>
                  {ch.status === "failed" && (
                    <button
                      onClick={() => handleRetry(ch.chapterNumber)}
                      disabled={isRetrying}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-white/10 hover:bg-white/15 text-white/70 disabled:opacity-50 transition-colors"
                    >
                      <RotateCw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
                      {isRetrying ? "重试中" : "重试"}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
