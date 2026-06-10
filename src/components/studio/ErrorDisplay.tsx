/**
 * 错误分类展示组件
 * 按类别展示生成失败错误，并提供重试/忽略操作
 */
import { AlertCircle, RotateCw, X, WifiOff, Clock, ShieldAlert } from "lucide-react"
import type { GenerationError } from "@/types/studio"

interface ErrorDisplayProps {
  error: GenerationError | null
  onRetry: () => void
  onDismiss: () => void
}

const ERROR_CONFIG: Record<GenerationError["type"], {
  icon: typeof AlertCircle
  title: string
  color: string
  bgColor: string
  suggestion: string
}> = {
  network: {
    icon: WifiOff,
    title: "网络连接异常",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10 border-orange-500/20",
    suggestion: "请检查网络连接后重试",
  },
  timeout: {
    icon: Clock,
    title: "请求超时",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/20",
    suggestion: "服务器响应较慢，建议缩短 Brief 或减少素材后重试",
  },
  api_error: {
    icon: ShieldAlert,
    title: "AI 服务异常",
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/20",
    suggestion: "DeepSeek API 暂时不可用，请稍后重试",
  },
  validation: {
    icon: AlertCircle,
    title: "参数校验失败",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10 border-yellow-500/20",
    suggestion: "请检查必填项是否完整",
  },
  cancelled: {
    icon: X,
    title: "生成已取消",
    color: "text-white/60",
    bgColor: "bg-white/5 border-white/10",
    suggestion: "您可以随时重新开始生成",
  },
  unknown: {
    icon: AlertCircle,
    title: "未知错误",
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/20",
    suggestion: "请刷新页面后重试，如持续出现请联系支持",
  },
}

export function ErrorDisplay({ error, onRetry, onDismiss }: ErrorDisplayProps) {
  if (!error) return null
  const config = ERROR_CONFIG[error.type]
  const Icon = config.icon

  return (
    <div className={`rounded-xl border p-4 ${config.bgColor} animate-in fade-in slide-in-from-top-2`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.color} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-medium ${config.color}`}>{config.title}</h4>
          <p className="text-xs text-white/60 mt-1">{error.message}</p>
          <p className="text-xs text-white/40 mt-1">{config.suggestion}</p>
          <div className="flex items-center gap-2 mt-3">
            {error.retryable && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 text-xs text-white/80 transition-colors"
              >
                <RotateCw className="w-3 h-3" />
                重试
              </button>
            )}
            <button
              onClick={onDismiss}
              className="px-3 py-1 rounded-full text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              忽略
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
