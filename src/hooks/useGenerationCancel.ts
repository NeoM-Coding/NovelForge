/**
 * 生成取消控制 Hook
 * 封装 AbortController，支持启动/取消 AI 生成请求
 */
import { useRef, useCallback } from "react"

export function useGenerationCancel() {
  const abortControllerRef = useRef<AbortController | null>(null)

  const start = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    return abortControllerRef.current.signal
  }, [])

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  const isActive = useCallback(() => {
    return abortControllerRef.current !== null && !abortControllerRef.current.signal.aborted
  }, [])

  return { start, cancel, isActive, abortControllerRef }
}
