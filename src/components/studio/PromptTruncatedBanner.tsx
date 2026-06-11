/**
 * Prompt 截断警告横幅
 */
import { AlertTriangle, X } from "lucide-react"
import type { PromptTruncatedWarning } from "@/types/studio"

interface PromptTruncatedBannerProps {
  warning: PromptTruncatedWarning | null
  onDismiss: () => void
}

const MODULE_LABELS: Record<string, string> = {
  rag: "参考素材",
  styleGuide: "文风指南",
  canon: "正史约束",
  tropes: "桥段参考",
  worldView: "世界观设定",
  characters: "角色设定",
}

export function PromptTruncatedBanner({ warning, onDismiss }: PromptTruncatedBannerProps) {
  if (!warning) return null

  const labels = warning.modules.map(m => MODULE_LABELS[m] || m).join("、")

  return (
    <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-amber-400">Prompt 长度截断警告</h4>
          <p className="text-xs text-white/60 mt-1">
            因本次生成上下文过长，以下模块被截断：{labels}。
            这可能导致生成结果缺少部分约束，建议缩短 Brief 或减少素材引用。
          </p>
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
