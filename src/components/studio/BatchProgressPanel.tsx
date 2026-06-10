import type { UseQueryResult } from "@tanstack/react-query"

interface BatchStatus {
  status: string
  progress?: number
  currentChapter?: number
  totalChapters?: number
  errorLog?: string
  completedChapters?: Array<{ chapterNumber: number; title: string }>
}

interface BatchProgressPanelProps {
  isBatchGenerating: boolean
  batchStatusQuery: UseQueryResult<BatchStatus | null, unknown>
  listChaptersQuery: UseQueryResult<
    Array<{
      id: number
      chapterNumber: number
      title: string | null
      content: string | null
      status: string
    }>,
    unknown
  >
}

export function BatchProgressPanel({
  isBatchGenerating,
  batchStatusQuery,
  listChaptersQuery,
}: BatchProgressPanelProps) {
  const batchData = batchStatusQuery.data
  const chapters = listChaptersQuery.data

  return (
    <>
      {/* 批量生成进度 */}
      {isBatchGenerating && batchData && (
        <div className="mt-3 space-y-2">
          <div className="flex justify-between text-xs text-white/60">
            <span>
              {batchData.currentChapter
                ? `正在生成第 ${batchData.currentChapter} 章 / 共 ${batchData.totalChapters || "?"} 章`
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
          {batchData.completedChapters && batchData.completedChapters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {batchData.completedChapters.map(c => (
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
      {chapters && chapters.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider">已生成章节</h4>
            <span className="text-[10px] text-white/30 font-mono">
              共 {chapters.length} 章 ·{" "}
              {chapters.reduce((sum, ch) => sum + (ch.content?.length || 0), 0).toLocaleString()} 字
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {chapters.map(ch => (
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
  )
}
