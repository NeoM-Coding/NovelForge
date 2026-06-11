/**
 * RAG 素材引用展示面板
 * 生成完成后展示本次生成引用了哪些素材
 */
import { X, BookOpen, Database, Tag } from "lucide-react"
import type { RagReference } from "@/types/studio"

interface RagReferencePanelProps {
  references: RagReference[]
  visible: boolean
  onClose: () => void
}

const TYPE_ICONS: Record<string, typeof BookOpen> = {
  novel_style: BookOpen,
  material: Database,
  keyword: Tag,
}

const TYPE_LABELS: Record<string, string> = {
  novel_style: "原作风格",
  material: "投喂素材",
  keyword: "关键词匹配",
}

export function RagReferencePanel({ references, visible, onClose }: RagReferencePanelProps) {
  if (!visible || references.length === 0) return null

  return (
    <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white/80 flex items-center gap-2">
          <Database className="w-4 h-4 text-amber-400" />
          本次生成引用了 {references.length} 条素材
        </h4>
        <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {references.map((ref, i) => {
          const Icon = TYPE_ICONS[ref.type] || Tag
          return (
            <div
              key={i}
              className="flex items-start gap-2 p-2 rounded-lg bg-white/3 border border-white/5"
            >
              <Icon className="w-3.5 h-3.5 text-white/40 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">
                    {TYPE_LABELS[ref.type] || ref.type}
                  </span>
                  {ref.sourceTitle && (
                    <span className="text-[10px] text-white/40 truncate">{ref.sourceTitle}</span>
                  )}
                  {ref.score !== undefined && (
                    <span className="text-[10px] text-emerald-400/60 font-mono">
                      {(ref.score * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/50 mt-1 line-clamp-2">{ref.content}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
