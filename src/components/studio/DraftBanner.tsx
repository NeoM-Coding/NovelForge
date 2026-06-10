import { Clock } from "lucide-react"

interface DraftBannerProps {
  draftInfo: { savedAt: string } | null
  onRestore: () => void
  onDiscard: () => void
}

function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return "刚刚"
  if (diffMins < 60) return `${diffMins}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 7) return `${diffDays}天前`
  return date.toLocaleDateString()
}

export function DraftBanner({ draftInfo, onRestore, onDiscard }: DraftBannerProps) {
  if (!draftInfo) return null

  return (
    <div className="shrink-0 px-4 md:px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm">
        <Clock className="w-4 h-4 text-amber-400" />
        <span className="text-white/70">
          发现 {formatTimeAgo(draftInfo.savedAt)} 的未保存草稿
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onRestore}
          className="px-3 py-1 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs transition-colors"
        >
          恢复编辑
        </button>
        <button
          onClick={onDiscard}
          className="px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/70 text-xs transition-colors"
        >
          丢弃
        </button>
      </div>
    </div>
  )
}
