import {
  PenTool,
  Save,
  Sparkles,
  Shield,
  Download,
  FileText,
} from "lucide-react"

interface GenerationToolbarProps {
  title: string
  setTitle: (v: string) => void
  activeTab: "edit" | "history"
  setActiveTab: (tab: "edit" | "history") => void
  generatedWorkId: number | null
  content: string
  selectedSeriesId: number | null
  reviewMutationPending: boolean
  exportMutationPending: boolean
  listChaptersData: { content?: string }[] | undefined
  onSave: () => void
  onExport: (format: "txt" | "markdown") => void
  onReview: (focus: "full") => void
  onShowStyleSampleModal: () => void
}

export function GenerationToolbar({
  title,
  setTitle,
  activeTab,
  setActiveTab,
  generatedWorkId,
  content,
  selectedSeriesId,
  reviewMutationPending,
  exportMutationPending,
  listChaptersData,
  onSave,
  onExport,
  onReview,
  onShowStyleSampleModal,
}: GenerationToolbarProps) {
  const hasContent = !!content || !!listChaptersData?.length

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
          <button
            onClick={() => setActiveTab("edit")}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              activeTab === "edit" ? "bg-amber-500/20 text-amber-400" : "text-white/70 hover:text-white/90"
            }`}
          >
            当前编辑
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              activeTab === "history" ? "bg-amber-500/20 text-amber-400" : "text-white/70 hover:text-white/90"
            }`}
          >
            历史作品
          </button>
        </div>
        <button
          onClick={onSave}
          disabled={!generatedWorkId || !content}
          className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-sm transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          保存
        </button>
        <button
          onClick={onShowStyleSampleModal}
          disabled={!content || !selectedSeriesId}
          className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-30 text-amber-400 text-sm transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          保存为风格样本
        </button>
        <button
          onClick={() => onReview("full")}
          disabled={reviewMutationPending || !generatedWorkId || !hasContent}
          className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-30 text-cyan-400 text-sm transition-colors"
        >
          <Shield className="w-3.5 h-3.5" />
          {reviewMutationPending ? "审阅中..." : "AI 审阅"}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onExport("txt")}
            disabled={exportMutationPending || !hasContent}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-lg text-xs text-white/70 transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            导出 TXT
          </button>
          <button
            onClick={() => onExport("markdown")}
            disabled={exportMutationPending || !hasContent}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-lg text-xs text-white/70 transition-colors flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5" />
            导出 MD
          </button>
        </div>
      </div>
    </header>
  )
}
