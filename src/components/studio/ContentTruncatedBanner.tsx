/**
 * AI 生成内容截断警告横幅
 * 与 PromptTruncatedBanner 区分：这是 AI 输出被 max_tokens 截断，不是 Prompt 被截断
 */
import { Scissors, X } from "lucide-react"
import type { ContentTruncatedWarning } from "@/types/studio"

interface ContentTruncatedBannerProps {
  warning: ContentTruncatedWarning | null
  onDismiss: () => void
}

export function ContentTruncatedBanner({ warning, onDismiss }: ContentTruncatedBannerProps) {
  if (!warning) return null

  return (
    <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start gap-3">
        <Scissors className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-red-400">生成内容被截断</h4>
          <p className="text-xs text-white/60 mt-1">{warning.message}</p>
          <p className="text-xs text-white/40 mt-1">{warning.suggestion}</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-white/30 hover:text-white/60 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
