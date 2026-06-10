import { X, Sparkles } from "lucide-react"
import type { UseQueryResult } from "@tanstack/react-query"

interface OutlineScene {
  id: string
  title: string
  description: string
}

interface BatchStatus {
  status: string
  progress?: number
  currentChapter?: number
  totalChapters?: number
  errorLog?: string
  completedChapters?: Array<{ chapterNumber: number; title: string }>
}

interface OutlineEditorProps {
  outlineType: "overview" | "scenes" | "both"
  outlineOverview: string
  outlineScenes: OutlineScene[]
  isGenerating: boolean
  generatedWorkId: number | null
  isBatchGenerating: boolean
  batchStatusQuery: UseQueryResult<BatchStatus | null, unknown>
  setOutlineType: (v: "overview" | "scenes" | "both") => void
  setOutlineOverview: (v: string) => void
  setOutlineScenes: (v: OutlineScene[] | ((prev: OutlineScene[]) => OutlineScene[])) => void
  onGenerateOutline: () => void
  onGenerate: () => void
  onBatchGenerate: () => void
}

export function OutlineEditor({
  outlineType,
  outlineOverview,
  outlineScenes,
  isGenerating,
  generatedWorkId,
  isBatchGenerating,
  batchStatusQuery,
  setOutlineType,
  setOutlineOverview,
  setOutlineScenes,
  onGenerateOutline,
  onGenerate,
  onBatchGenerate,
}: OutlineEditorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          大纲
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setOutlineType("overview")
            }}
            className={`text-xs px-2 py-1 rounded-full transition-colors ${
              outlineType === "overview"
                ? "bg-amber-500/20 text-amber-400"
                : "bg-white/5 text-white/50 hover:text-white/70"
            }`}
          >
            概述
          </button>
          <button
            onClick={() => {
              setOutlineType("scenes")
            }}
            className={`text-xs px-2 py-1 rounded-full transition-colors ${
              outlineType === "scenes"
                ? "bg-amber-500/20 text-amber-400"
                : "bg-white/5 text-white/50 hover:text-white/70"
            }`}
          >
            场景
          </button>
          <button
            onClick={() => {
              setOutlineType("both")
            }}
            className={`text-xs px-2 py-1 rounded-full transition-colors ${
              outlineType === "both"
                ? "bg-amber-500/20 text-amber-400"
                : "bg-white/5 text-white/50 hover:text-white/70"
            }`}
          >
            两者
          </button>
        </div>
      </div>

      {!outlineOverview && outlineScenes.length === 0 ? (
        <button
          onClick={onGenerateOutline}
          disabled={isGenerating}
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

          {/* BatchProgressPanel removed - handled by parent */}
        </>
      )}
    </div>
  )
}
