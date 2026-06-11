
export interface AiProgressBarProps {
  /** 进度条模式：indeterminate = 循环动画（无精确进度），determinate = 精确百分比 */
  variant?: "indeterminate" | "determinate"
  /** 0-100 的进度百分比，仅 determinate 模式有效 */
  progress?: number
  /** 进度条标题（如"AI 审阅中"） */
  title: string
  /** 可选的描述文字（如"正在分析作品质量..."） */
  description?: string
  className?: string
}

/**
 * AI 异步操作进度条组件
 * - indeterminate 模式：用于单步阻塞 AI 调用（chatCompletion），后端无法提供中间进度
 * - determinate 模式：用于多步骤操作，需传入精确的 0-100 进度值
 */
export function AiProgressBar({
  variant = "indeterminate",
  progress = 0,
  title,
  description,
  className = "",
}: AiProgressBarProps) {
  const clampedProgress = Math.max(0, Math.min(100, progress))

  return (
    <div
      className={`rounded-xl bg-white/5 border border-white/10 p-4 ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={variant === "determinate" ? clampedProgress : undefined}
      aria-label={title}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-sm font-medium text-white/80">{title}</span>
        </div>
        {variant === "determinate" && (
          <span className="text-xs font-mono text-amber-400">
            {Math.round(clampedProgress)}%
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs text-white/50 mb-3">{description}</p>
      )}
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        {variant === "indeterminate" ? (
          <div
            className="h-full bg-amber-500 rounded-full animate-[ai-progress-indeterminate_1.5s_ease-in-out_infinite]"
            style={{ width: "50%" }}
          />
        ) : (
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${clampedProgress}%` }}
          />
        )}
      </div>
    </div>
  )
}
