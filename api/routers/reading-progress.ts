import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { readingProgress } from "@db/schema"
import { eq, desc } from "drizzle-orm"

export const readingProgressRouter = createRouter({
  get: publicQuery
    .input(z.object({ novelId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [progress] = await db
        .select()
        .from(readingProgress)
        .where(eq(readingProgress.novelId, input.novelId))
        .orderBy(desc(readingProgress.updatedAt))
        .limit(1)
      return progress || null
    }),

  list: publicQuery.query(async () => {
    const db = getDb()
    return db.select().from(readingProgress).orderBy(desc(readingProgress.updatedAt))
  }),

  save: publicQuery
    .input(z.object({
      novelId: z.number(),
      chapterId: z.number(),
      chapterNumber: z.number().optional(),
      chapterTitle: z.string().optional(),
      totalChapters: z.number().optional(),
      scrollPosition: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const existing = await db
        .select()
        .from(readingProgress)
        .where(eq(readingProgress.novelId, input.novelId))
        .limit(1)

      if (existing.length > 0) {
        const [updated] = await db
          .update(readingProgress)
          .set({
            chapterId: input.chapterId,
            chapterNumber: input.chapterNumber ?? existing[0].chapterNumber,
            chapterTitle: input.chapterTitle ?? existing[0].chapterTitle,
            totalChapters: input.totalChapters ?? existing[0].totalChapters,
            scrollPosition: input.scrollPosition,
            updatedAt: new Date(),
          })
          .where(eq(readingProgress.id, existing[0].id))
          .returning()
        return updated
      } else {
        const [created] = await db
          .insert(readingProgress)
          .values({
            novelId: input.novelId,
            chapterId: input.chapterId,
            chapterNumber: input.chapterNumber ?? 1,
            chapterTitle: input.chapterTitle,
            totalChapters: input.totalChapters ?? 1,
            scrollPosition: input.scrollPosition,
          })
          .returning()
        return created
      }
    }),

  delete: publicQuery
    .input(z.object({ novelId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      await db
        .delete(readingProgress)
        .where(eq(readingProgress.novelId, input.novelId))
      return { success: true }
    }),
})