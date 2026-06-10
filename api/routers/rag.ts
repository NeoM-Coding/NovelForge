import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { vectorChunks, chapters, novels, ragFeedback } from "@db/schema"
import { eq, sql } from "drizzle-orm"
import { indexNovel, searchSimilar } from "../services/embedder"

export const ragRouter = createRouter({
  search: publicQuery
    .input(z.object({
      query: z.string().min(1),
      novelId: z.number().optional(),
      seriesId: z.number().optional(),
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => {
      const results = await searchSimilar(input.query, {
        novelId: input.novelId,
        seriesId: input.seriesId,
        limit: input.limit,
      })
      return results
    }),

  indexNovel: publicQuery
    .input(z.object({
      novelId: z.number(),
      seriesId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))

      const fullText = chapterList
        .map(ch => ch.contentOriginal)
        .filter(Boolean)
        .join("\n\n")

      if (!fullText) {
        return { chunkCount: 0 }
      }

      // 先删除旧索引
      await db
        .delete(vectorChunks)
        .where(eq(vectorChunks.novelId, input.novelId))

      // 获取小说标题
      const [novelInfo] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.novelId))

      // 创建新索引
      const result = await indexNovel(
        input.novelId,
        fullText,
        {
          seriesId: input.seriesId,
          sourceType: "reference",
          sourceTitle: novelInfo?.title || `novel_${input.novelId}`,
        }
      )

      return result
    }),

  // 素材预搜索 — 根据 Brief 推荐相关素材
  presearchMaterials: publicQuery
    .input(z.object({
      seriesId: z.number(),
      query: z.string().min(1),
      limit: z.number().min(1).max(10).default(5),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const query = `%${input.query}%`
      const results = await db.execute(sql`
        SELECT id, title,
          CASE
            WHEN title ILIKE ${query} THEN 100
            WHEN content ILIKE ${query} THEN 80
            ELSE 50
          END as relevance
        FROM materials
        WHERE series_id = ${input.seriesId}
          AND status = 'indexed'
          AND (title ILIKE ${query} OR content ILIKE ${query})
        ORDER BY relevance DESC, created_at DESC
        LIMIT ${input.limit}
      `)
      const rows = results as unknown as Array<{ id: number; title: string; relevance: number }>
      return rows.map(r => ({
        id: r.id,
        title: r.title,
        relevance: r.relevance,
      }))
    }),

  // RAG 效果反馈闭环 — 用户评分
  feedback: publicQuery
    .input(z.object({
      generationId: z.number(),
      wasHelpful: z.boolean(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      // 找到该 generation 对应的所有 ragFeedback 记录，更新 wasHelpful
      await db.update(ragFeedback)
        .set({ wasHelpful: input.wasHelpful })
        .where(eq(ragFeedback.generationId, input.generationId))

      // 同步更新对应 vector_chunks 的 qualityScore（👍 +0.3，👎 -0.3）
      const delta = input.wasHelpful ? 0.3 : -0.3
      const feedbacks = await db
        .select()
        .from(ragFeedback)
        .where(eq(ragFeedback.generationId, input.generationId))

      for (const fb of feedbacks) {
        if (!fb.chunkId) continue
        await db.execute(sql`
          UPDATE vector_chunks
          SET metadata = jsonb_set(
            COALESCE(metadata, '{}'),
            '{qualityScore}',
            to_jsonb(LEAST(2.0, GREATEST(0.1,
              COALESCE((metadata->>'qualityScore')::real, 1.0) + ${delta}
            )))
          )
          WHERE id = ${fb.chunkId}
        `)
      }

      return { success: true }
    }),
})
