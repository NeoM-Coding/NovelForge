/**
 * DeepSeek API 封装服务
 * 提供：聊天完成、流式生成、embedding 生成
 */

import { env } from "../lib/env"

const BASE_URL = env.DEEPSEEK_BASE_URL
const API_KEY = env.DEEPSEEK_API_KEY

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  model?: string
}

interface RetryConfig {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  retryableStatuses?: number[]
  timeoutMs?: number
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatuses: [429, 500, 502, 503, 504],
  timeoutMs: 60000,
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retryConfig: RetryConfig = {}
): Promise<Response> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs)

    // 如果调用方传入了 signal，监听其 abort 事件并转发到本地 controller
    let abortListener: (() => void) | undefined
    if (init.signal) {
      abortListener = () => controller.abort()
      init.signal.addEventListener("abort", abortListener, { once: true })
    }

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      if (init.signal && abortListener) {
        init.signal.removeEventListener("abort", abortListener)
      }

      if (response.ok) {
        return response
      }

      if (!config.retryableStatuses.includes(response.status)) {
        return response
      }

      lastError = new Error(`DeepSeek API error: ${response.status}`)

      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempt),
          config.maxDelayMs
        )
        console.warn(`[fetchWithRetry] Attempt ${attempt + 1} failed with ${response.status}, retrying in ${delay}ms...`)
        await sleep(delay)
      }
    } catch (err) {
      clearTimeout(timeoutId)
      if (init.signal && abortListener) {
        init.signal.removeEventListener("abort", abortListener)
      }

      if (err instanceof Error && err.name === "AbortError") {
        // 外部取消优先，立即抛出
        if (init.signal?.aborted) {
          throw new Error("Request cancelled by caller")
        }
        lastError = new Error(`Request timeout after ${config.timeoutMs}ms`)
        console.warn(`[fetchWithRetry] Attempt ${attempt + 1} timed out`)
      } else {
        lastError = err instanceof Error ? err : new Error(String(err))
        console.warn(`[fetchWithRetry] Attempt ${attempt + 1} network error: ${lastError.message}`)
      }

      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempt),
          config.maxDelayMs
        )
        await sleep(delay)
      }
    }
  }

  throw lastError || new Error("All retry attempts failed")
}

export async function* streamChat(options: ChatOptions) {
  const response = await fetchWithRetry(
    `${BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: options.model || "deepseek-v4-pro",
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4000,
        stream: true,
      }),
    },
    { timeoutMs: 300000 }
  )

  if (!response.ok || !response.body) {
    throw new Error(`DeepSeek API error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.trim() === "" || line.trim() === "data: [DONE]") continue
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6))
            const content = data.choices?.[0]?.delta?.content
            if (content) yield content
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function chatCompletion(options: ChatOptions): Promise<string> {
  const response = await fetchWithRetry(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || "deepseek-v4-pro",
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4000,
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status}`)
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content || ""
}

export async function getEmbedding(text: string): Promise<number[]> {
  const results = await getEmbeddingsBatch([text], 1)
  return results[0] || []
}

/**
 * 批量 Embedding — 一次调用处理多条文本，大幅提速索引
 * DashScope text-embedding-v4 限制：单次最多 20 条
 */
export async function getEmbeddingsBatch(
  texts: string[],
  batchSize: number = 20
): Promise<number[][]> {
  const embedBaseUrl = env.EMBEDDING_BASE_URL
  const embedApiKey = env.EMBEDDING_API_KEY
  const embedModel = env.EMBEDDING_MODEL

  if (!embedApiKey) {
    throw new Error(
      "未配置 Embedding API Key。请在 .env 中设置 EMBEDDING_API_KEY 和 EMBEDDING_BASE_URL。"
    )
  }

  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)

    const response = await fetch(`${embedBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${embedApiKey}`,
      },
      body: JSON.stringify({
        model: embedModel,
        input: batch,
        dimensions: env.EMBEDDING_DIMENSION,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Embedding API error: ${response.status} ${body}`)
    }

    const data = await response.json() as {
      data?: Array<{ embedding?: number[]; index?: number }>
    }

    // 按 index 排序后提取 embedding
    const batchResults = (data.data || [])
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(d => d.embedding || [])

    allEmbeddings.push(...batchResults)
  }

  return allEmbeddings
}
