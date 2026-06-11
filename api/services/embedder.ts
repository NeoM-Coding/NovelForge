/**
 * 文本向量化服务
 * 将文本切分为语义 chunks 并生成向量
 */
import { splitIntoSemanticChunks } from "../lib/chunk-utils"

import { getEmbedding, getEmbeddingsBatch } from "./deepseek"
import { getDb } from "../queries/connection"
import { vectorChunks, embeddingCache } from "@db/schema"
import { sql, eq } from "drizzle-orm"
import crypto from "node:crypto"

// ========== 索引 ==========

export async function indexNovel(
  novelId: number,
  content: string,
  options: {
    seriesId?: number
    sourceType?: string
    sourceTitle?: string
    chapterNumber?: number
  } = {}
): Promise<{ chunkCount: number }> {
  const {
    seriesId,
    sourceType = "reference",
    sourceTitle = "",
    chapterNumber,
  } = options

  const chunks = splitIntoSemanticChunks(content, {
    sourceId: novelId,
    sourceTitle: sourceTitle || `novel_${novelId}`,
    chapterNumber,
  })

  const db = getDb()

  // 过滤有效 chunks
  const validChunks = chunks.filter(c => c.content.trim().length >= 50)
  if (validChunks.length === 0) return { chunkCount: 0 }

  // 批量计算 embedding（一次 API 调用处理 10 条，大幅提速）
  let embeddings: number[][] = []
  try {
    embeddings = await getEmbeddingsBatch(validChunks.map(c => c.content.trim()), 10)
  } catch (error) {
    console.error("Batch embedding failed:", error)
    // 批量失败时回退到逐条处理
    embeddings = []
    for (const chunk of validChunks) {
      try {
        const e = await getEmbedding(chunk.content.trim())
        embeddings.push(e)
      } catch {
        embeddings.push([])
      }
    }
  }

  // 构建批量插入数据
  const insertValues = validChunks.map((chunk, i) => {
    const embedding = embeddings[i]
    if (!embedding || embedding.length === 0) return null

    // 计算素材质量分
    let qualityScore = 1.0
    const len = chunk.content.length
    if (len < 100) qualityScore -= 0.2
    if (len > 800) qualityScore += 0.1
    if (sourceType === "style_sample") qualityScore += 0.5
    qualityScore = Math.max(0.1, Math.min(2.0, qualityScore))

    return {
      content: chunk.content,
      embedding: embedding as unknown as number[],
      sourceType,
      novelId,
      seriesId: seriesId || null,
      metadata: {
        indexedAt: new Date().toISOString(),
        sourceId: chunk.sourceId,
        sourceTitle: chunk.sourceTitle,
        chapterNumber: chunk.chapterNumber,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        contextBefore: chunk.contextBefore,
        contextAfter: chunk.contextAfter,
        qualityScore,
      },
    }
  }).filter(Boolean) as Array<{
    content: string
    embedding: number[]
    sourceType: string
    novelId: number
    seriesId: number | null
    metadata: Record<string, unknown>
  }>

  if (insertValues.length > 0) {
    // Drizzle 支持一次插入多条
    await db.insert(vectorChunks).values(insertValues)
  }

  return { chunkCount: insertValues.length }
}

// ========== 检索 ==========

export interface SearchResult {
  id?: number
  content: string
  /** 拼接了 contextBefore + content + contextAfter 的富化内容，供 prompt 注入使用 */
  enrichedContent?: string
  similarity: number
  sourceType: string
  sourceTitle?: string
  chapterNumber?: number
  chunkIndex?: number
  totalChunks?: number
  contextBefore?: string
  contextAfter?: string
  /** 检索召回方式：strict = 正常检索；expanded = 去掉 novelId 按 seriesId 全局检索；fallback = pg_trgm 最低阈值兜底 */
  recallMethod?: "strict" | "expanded" | "fallback"
}

export async function searchSimilar(
  query: string,
  options?: {
    novelId?: number
    seriesId?: number
    limit?: number
    materialIds?: number[]
    embedding?: number[] // ← 新增：允许外部传入预计算的 embedding，避免重复调用
  }
): Promise<SearchResult[]> {
  const db = getDb()
  const embedding = options?.embedding || await getEmbedding(query)
  const limit = options?.limit || 5
  const embeddingJson = JSON.stringify(embedding)

  // 1. 向量搜索
  const vectorResults = await db.execute(sql`
    SELECT id, content, source_type, 1 - (embedding <=> ${embeddingJson}) as similarity,
      metadata
    FROM vector_chunks
    WHERE (${options?.novelId ?? null}::int IS NULL OR novel_id = ${options?.novelId ?? null})
      AND (${options?.seriesId ?? null}::int IS NULL OR series_id = ${options?.seriesId ?? null})
    ORDER BY embedding <=> ${embeddingJson}
    LIMIT ${limit}
  `)

  // 2. pg_trgm 模糊搜索（中文全文搜索的主要替代方案）
  let trgmResults: Array<Record<string, unknown>> = []
  try {
    const trgmQuery = query.slice(0, 100)
    const trgm = await db.execute(sql`
      SELECT id, content, source_type, metadata,
        similarity(content, ${trgmQuery}) as similarity
      FROM vector_chunks
      WHERE content % ${trgmQuery}
        AND (${options?.seriesId ?? null}::int IS NULL OR series_id = ${options?.seriesId ?? null})
        AND (${options?.novelId ?? null}::int IS NULL OR novel_id = ${options?.novelId ?? null})
      ORDER BY similarity(content, ${trgmQuery}) DESC
      LIMIT ${Math.ceil(limit * 1.5)}
    `)
    trgmResults = Array.isArray(trgm) ? trgm : []
  } catch {
    // pg_trgm 可选，失败时忽略
  }

  // 3. 合并结果（去重）
  const seenIds = new Set<number>()
  const merged: Array<Record<string, unknown> & { _similarity: number }> = []

  // 先加入向量搜索结果
  const vectorRows = Array.isArray(vectorResults) ? vectorResults : []
  for (const row of vectorRows) {
    const id = row.id ? Number(row.id) : undefined
    if (id !== undefined) seenIds.add(id)
    merged.push({ ...row, _similarity: Number(row.similarity) })
  }

  // 加入 pg_trgm 结果（去重，提升权重补偿 simple tsvector 失效）
  for (const row of trgmResults) {
    const id = row.id ? Number(row.id) : undefined
    if (id === undefined || seenIds.has(id)) continue

    const sim = Number(row.similarity) || 0
    // 提升 20% 权重，补偿 tsvector 对中文无效
    const boostedSim = Math.min(sim * 1.2, 1.0)
    if (boostedSim > 0.15) {
      merged.push({ ...row, _similarity: boostedSim })
      seenIds.add(id)
    }
  }

  // 映射为 SearchResult
  const mapped = merged.map((row) => {
    const metadata = (row.metadata as Record<string, unknown>) || {}
    const content = String(row.content)
    const contextBefore = metadata.contextBefore ? String(metadata.contextBefore) : undefined
    const contextAfter = metadata.contextAfter ? String(metadata.contextAfter) : undefined

    // 拼接上下文形成富化内容（供 prompt 注入使用）
    const enrichedParts: string[] = []
    if (contextBefore) enrichedParts.push(`【上文】${contextBefore}`)
    enrichedParts.push(content)
    if (contextAfter) enrichedParts.push(`【下文】${contextAfter}`)

    return {
      id: row.id ? Number(row.id) : undefined,
      content,
      enrichedContent: enrichedParts.join("\n"),
      similarity: row._similarity,
      sourceType: String(row.source_type),
      sourceTitle: metadata.sourceTitle ? String(metadata.sourceTitle) : undefined,
      chapterNumber: metadata.chapterNumber ? Number(metadata.chapterNumber) : undefined,
      chunkIndex: metadata.chunkIndex ? Number(metadata.chunkIndex) : undefined,
      totalChunks: metadata.totalChunks ? Number(metadata.totalChunks) : undefined,
      contextBefore,
      contextAfter,
      qualityScore: Number(metadata.qualityScore || 1.0),
      recallMethod: "strict" as const,
    }
  })

  // 按素材质量分加权重排序（高质量素材提升排名）
  mapped.sort((a, b) => {
    const scoreA = (a.similarity || 0) * (a.qualityScore || 1.0)
    const scoreB = (b.similarity || 0) * (b.qualityScore || 1.0)
    return scoreB - scoreA
  })

  // 相邻 Chunk 召回（Parent Document Retrieval）：对 top 结果补充相邻片段上下文
  if (mapped.length > 0) {
    const enriched = await enrichWithAdjacentChunks(mapped)
    return enriched
  }

  // ========== 空结果降级逻辑 ==========
  // 1. expanded：去掉 novelId 限制，按 seriesId 全局检索
  if (options?.novelId && options?.seriesId) {
    console.warn(`[searchSimilar] 严格检索无结果，降级为 expanded（去掉 novelId=${options.novelId}，保留 seriesId=${options.seriesId}）`)
    const expandedResults = await searchSimilar(query, {
      seriesId: options.seriesId,
      limit,
      embedding,
      materialIds: options.materialIds,
    })
    if (expandedResults.length > 0) {
      return expandedResults.map(r => ({ ...r, recallMethod: "expanded" as const }))
    }
  }

  // 2. fallback：使用 pg_trgm % 操作符最低阈值兜底（仅当 seriesId 存在时）
  if (options?.seriesId) {
    try {
      const fallbackQuery = query.slice(0, 100)
      const fallback = await db.execute(sql`
        SELECT id, content, source_type, metadata,
          similarity(content, ${fallbackQuery}) as similarity
        FROM vector_chunks
        WHERE series_id = ${options.seriesId}
          AND content % ${fallbackQuery}
        ORDER BY similarity(content, ${fallbackQuery}) DESC
        LIMIT ${limit}
      `)
      const fallbackRows = Array.isArray(fallback) ? fallback : []
      if (fallbackRows.length > 0) {
        console.warn(`[searchSimilar] expanded 仍无结果，降级为 fallback（pg_trgm，seriesId=${options.seriesId}）`)
        return fallbackRows.map((row: Record<string, unknown>) => {
          const metadata = (row.metadata as Record<string, unknown>) || {}
          return {
            id: row.id ? Number(row.id) : undefined,
            content: String(row.content),
            similarity: Number(row.similarity) || 0,
            sourceType: String(row.source_type),
            sourceTitle: metadata.sourceTitle ? String(metadata.sourceTitle) : undefined,
            chapterNumber: metadata.chapterNumber ? Number(metadata.chapterNumber) : undefined,
            chunkIndex: metadata.chunkIndex ? Number(metadata.chunkIndex) : undefined,
            totalChunks: metadata.totalChunks ? Number(metadata.totalChunks) : undefined,
            recallMethod: "fallback" as const,
          }
        })
      }
    } catch {
      // pg_trgm 可能未安装，忽略
    }
  }

  return mapped
}

/**
 * 为检索结果补充相邻 chunks 的上下文
 * 同一 sourceId + chapterNumber 下，chunkIndex ± 1 的片段
 */
async function enrichWithAdjacentChunks(
  results: SearchResult[]
): Promise<SearchResult[]> {
  const db = getDb()

  // 由于 metadata 是 JSONB，我们对每个有完整 metadata 的结果单独查询相邻 chunks
  const enrichedResults: SearchResult[] = []

  for (const r of results) {
    if (!r.chunkIndex || r.totalChunks === undefined || r.totalChunks <= 1) {
      enrichedResults.push(r)
      continue
    }

    const adjacentIndices: number[] = []
    if (r.chunkIndex > 0) adjacentIndices.push(r.chunkIndex - 1)
    if (r.chunkIndex < r.totalChunks - 1) adjacentIndices.push(r.chunkIndex + 1)

    if (adjacentIndices.length === 0) {
      enrichedResults.push(r)
      continue
    }

    try {
      // 通过 metadata 中的 sourceTitle + chapterNumber 匹配相邻 chunks
      const adj = await db.execute(sql`
        SELECT content, metadata
        FROM vector_chunks
        WHERE source_type = ${r.sourceType}
          AND (
            (metadata->>'sourceTitle')::text = ${r.sourceTitle || ""}
            OR (metadata->>'sourceTitle') IS NULL
          )
          AND (
            ${r.chapterNumber}::int IS NULL
            OR (metadata->>'chapterNumber')::int = ${r.chapterNumber ?? null}::int
          )
          AND (metadata->>'chunkIndex')::int = ANY(${JSON.stringify(adjacentIndices)})
        LIMIT 2
      `)
      const adjRows = Array.isArray(adj) ? adj : []

      if (adjRows.length > 0) {
        const adjContents: string[] = []
        for (const row of adjRows) {
          const adjMeta = (row.metadata as Record<string, unknown>) || {}
          const adjContent = String(row.content)
          const adjBefore = adjMeta.contextBefore ? String(adjMeta.contextBefore) : undefined
          const adjAfter = adjMeta.contextAfter ? String(adjMeta.contextAfter) : undefined
          const parts: string[] = []
          if (adjBefore) parts.push(`【上文】${adjBefore}`)
          parts.push(adjContent)
          if (adjAfter) parts.push(`【下文】${adjAfter}`)
          adjContents.push(parts.join("\n"))
        }

        // 将相邻 chunks 拼接到 enrichedContent 前面/后面
        const enrichedParts: string[] = []
        // 按 chunkIndex 排序，相邻 chunk 在前
        enrichedParts.push(...adjContents)
        enrichedParts.push(r.enrichedContent || r.content)

        enrichedResults.push({
          ...r,
          enrichedContent: enrichedParts.join("\n\n【相邻片段】\n\n"),
        })
      } else {
        enrichedResults.push(r)
      }
    } catch {
      enrichedResults.push(r)
    }
  }

  return enrichedResults
}

// ========== Embedding 缓存层 ==========

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex")
}

/**
 * 带缓存的 Embedding 获取
 * 相同文本前 100 字的 SHA-256 hash 命中缓存时，直接返回缓存的 embedding
 * 未命中时调用 API，异步写入缓存
 */
export async function getEmbeddingWithCache(text: string): Promise<number[]> {
  const db = getDb()
  const preview = text.slice(0, 100)
  const hash = sha256(preview)

  // 1. 查缓存
  const cached = await db
    .select()
    .from(embeddingCache)
    .where(eq(embeddingCache.textHash, hash))
    .limit(1)

  if (cached.length > 0) {
    return cached[0].embedding as unknown as number[]
  }

  // 2. 未命中：调用 API
  const embedding = await getEmbedding(text)

  // 3. 异步写入缓存（不阻塞返回）
  db.insert(embeddingCache).values({
    textHash: hash,
    textPreview: text.slice(0, 200),
    embedding: embedding as unknown as Record<string, unknown>,
  }).catch(() => { /* 缓存写入失败不影响主流程 */ })

  return embedding
}
