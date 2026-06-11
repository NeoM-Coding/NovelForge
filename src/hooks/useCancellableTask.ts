/**
 * 可取消的异步任务管理 Hook
 * 封装任务启动、轮询、完成/失败/取消处理
 */

import { useState, useCallback, useEffect, useRef } from "react"

type TaskStatus = "idle" | "running" | "completed" | "failed" | "cancelled"

interface UseCancellableTaskOptions<TStatusData> {
  /** 查询任务状态的 hook 结果 */
  statusData?: TStatusData | null
  /** 轮询间隔（毫秒），默认 2000 */
  pollInterval?: number
  /** 任务完成回调 */
  onComplete?: (data: TStatusData) => void
  /** 任务失败回调 */
  onError?: (data: TStatusData) => void
  /** 任务被取消回调 */
  onCancel?: () => void
  /** 从状态数据中提取 status 字符串的函数 */
  getStatus?: (data: TStatusData) => string
}

export function useCancellableTask<TStatusData>(
  options: UseCancellableTaskOptions<TStatusData>
) {
  const { statusData, onComplete, onError, onCancel, getStatus } = options

  const [taskId, setTaskId] = useState<string | number | null>(null)
  const [status, setStatus] = useState<TaskStatus>("idle")
  const [error, setError] = useState<string | null>(null)

  // 跟踪是否由用户主动取消
  const userCancelledRef = useRef(false)

  useEffect(() => {
    if (!statusData || taskId === null) return

    const statusStr = getStatus ? getStatus(statusData) : (statusData as unknown as { status: string }).status

    if (statusStr === "running" || statusStr === "processing" || statusStr === "pending") {
      setStatus("running")
    } else if (statusStr === "completed") {
      setStatus("completed")
      onComplete?.(statusData)
      setTaskId(null)
    } else if (statusStr === "failed") {
      setStatus("failed")
      setError((statusData as unknown as { error?: string }).error || "任务失败")
      onError?.(statusData)
      setTaskId(null)
    } else if (statusStr === "cancelled") {
      setStatus("cancelled")
      if (!userCancelledRef.current) {
        onCancel?.()
      }
      setTaskId(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusData, taskId, getStatus])

  const start = useCallback((id: string | number) => {
    userCancelledRef.current = false
    setTaskId(id)
    setStatus("running")
    setError(null)
  }, [])

  const cancel = useCallback((cancelFn?: (taskId: string | number) => void) => {
    if (taskId === null) return
    userCancelledRef.current = true
    setStatus("cancelled")
    cancelFn?.(taskId)
    setTaskId(null)
    onCancel?.()
  }, [taskId, onCancel])

  const reset = useCallback(() => {
    userCancelledRef.current = false
    setTaskId(null)
    setStatus("idle")
    setError(null)
  }, [])

  return {
    taskId,
    setTaskId,
    status,
    error,
    start,
    cancel,
    reset,
    isRunning: status === "running",
    isCompleted: status === "completed",
    isFailed: status === "failed",
    isCancelled: status === "cancelled",
  }
}
