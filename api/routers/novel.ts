import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { novels, chapters, novelTags, tags, materials, readingProgress } from "@db/schema"
import { eq, desc, like } from "drizzle-orm"

export const novelRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb()
    return db.select().from(novels).orderBy(desc(novels.createdAt))
  }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [novel] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.id))
      return novel || null
    }),

  create: publicQuery
    .input(z.object({
      title: z.string().min(1),
      author: z.string().optional(),
      originalLanguage: z.string().optional(),
      seriesId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [novel] = await db
        .insert(novels)
        .values(input)
        .returning()
      return novel
    }),

  update: publicQuery
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      author: z.string().optional(),
      status: z.enum(["unread", "reading", "translated", "completed"]).optional(),
      seriesId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const { id, ...data } = input
      const [novel] = await db
        .update(novels)
        .set(data)
        .where(eq(novels.id, id))
        .returning()
      return novel
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()

      // 记录删除前的快照（用于撤销）
      const [novel] = await db.select().from(novels).where(eq(novels.id, input.id))
      const chapterList = await db.select().from(chapters).where(eq(chapters.novelId, input.id))
      if (novel) {
        const { logAudit } = await import("../routers/audit")
        await logAudit({
          action: "novel_delete",
          entityType: "novel",
          entityId: input.id,
          snapshot: { novel, chapters: chapterList },
          description: `删除小说《${novel.title}》及 ${chapterList.length} 个章节`,
        })
      }

      // 先删除关联数据
      await db.delete(chapters).where(eq(chapters.novelId, input.id))
      await db.delete(novelTags).where(eq(novelTags.novelId, input.id))
      await db.delete(readingProgress).where(eq(readingProgress.novelId, input.id))
      await db.delete(novels).where(eq(novels.id, input.id))
      return { success: true }
    }),

  search: publicQuery
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      const db = getDb()
      return db
        .select()
        .from(novels)
        .where(like(novels.title, `%${input.query}%`))
    }),

  importFromMaterial: publicQuery
    .input(z.object({ materialId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [material] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, input.materialId))

      if (!material) throw new Error("素材不存在")
      if (!material.content) throw new Error("素材内容为空")

      // 创建小说记录
      const [novel] = await db
        .insert(novels)
        .values({
          title: material.title,
          status: "unread",
          metadata: { importedFromMaterialId: material.id },
        })
        .returning()

      // 按章节分割内容（每章约 8000 字，优先按段落边界分割）
      const content = material.content
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
      const chapterInputs: Array<{ chapterNumber: number; title: string; contentOriginal: string }> = []
      let currentChunk = ""
      let chapterNum = 1
      const targetSize = 8000

      for (const para of paragraphs) {
        if (currentChunk.length + para.length > targetSize && currentChunk.length > 0) {
          chapterInputs.push({
            chapterNumber: chapterNum++,
            title: `第${chapterNum - 1}章`,
            contentOriginal: currentChunk.trim(),
          })
          currentChunk = para
        } else {
          currentChunk += (currentChunk ? "\n\n" : "") + para
        }
      }
      if (currentChunk.trim().length > 0) {
        chapterInputs.push({
          chapterNumber: chapterNum++,
          title: `第${chapterNum - 1}章`,
          contentOriginal: currentChunk.trim(),
        })
      }

      // 如果内容很短（不足一章），仍然创建一章
      if (chapterInputs.length === 0 && content.trim().length > 0) {
        chapterInputs.push({
          chapterNumber: 1,
          title: "第1章",
          contentOriginal: content.trim(),
        })
      }

      for (const ch of chapterInputs) {
        await db.insert(chapters).values({
          novelId: novel.id,
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          contentOriginal: ch.contentOriginal,
        })
      }

      return { novelId: novel.id, chapterCount: chapterInputs.length }
    }),

  // 批量导入素材为小说
  importMaterials: publicQuery
    .input(z.object({ materialIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const results: Array<{ materialId: number; novelId: number; chapterCount: number }> = []

      for (const materialId of input.materialIds) {
        const [material] = await db
          .select()
          .from(materials)
          .where(eq(materials.id, materialId))

        if (!material || !material.content) continue

        // 创建小说记录
        const [novel] = await db
          .insert(novels)
          .values({
            title: material.title,
            status: "unread",
            metadata: { importedFromMaterialId: material.id },
          })
          .returning()

        // 按章节分割内容
        const content = material.content
        const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
        const chapterInputs: Array<{ chapterNumber: number; title: string; contentOriginal: string }> = []
        let currentChunk = ""
        let chapterNum = 1
        const targetSize = 8000

        for (const para of paragraphs) {
          if (currentChunk.length + para.length > targetSize && currentChunk.length > 0) {
            chapterInputs.push({
              chapterNumber: chapterNum++,
              title: `第${chapterNum - 1}章`,
              contentOriginal: currentChunk.trim(),
            })
            currentChunk = para
          } else {
            currentChunk += (currentChunk ? "\n\n" : "") + para
          }
        }
        if (currentChunk.trim().length > 0) {
          chapterInputs.push({
            chapterNumber: chapterNum++,
            title: `第${chapterNum - 1}章`,
            contentOriginal: currentChunk.trim(),
          })
        }
        if (chapterInputs.length === 0 && content.trim().length > 0) {
          chapterInputs.push({
            chapterNumber: 1,
            title: "第1章",
            contentOriginal: content.trim(),
          })
        }

        for (const ch of chapterInputs) {
          await db.insert(chapters).values({
            novelId: novel.id,
            chapterNumber: ch.chapterNumber,
            title: ch.title,
            contentOriginal: ch.contentOriginal,
          })
        }

        results.push({ materialId, novelId: novel.id, chapterCount: chapterInputs.length })
      }

      return { imported: results.length, results }
    }),

  // 将小说导入素材库（已翻译→双语平行语料，未翻译→参考小说）
  importToMaterial: publicQuery
    .input(z.object({ novelId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const [novel] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.novelId))

      if (!novel) throw new Error("小说不存在")

      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))
        .orderBy(chapters.chapterNumber)

      if (chapterList.length === 0) throw new Error("小说没有章节")

      // 检查是否有翻译内容
      const hasTranslation = chapterList.some(
        ch => ch.contentTranslated && ch.contentTranslated.trim().length > 0
      )

      if (hasTranslation) {
        // ========== 已翻译：导入为双语平行语料 ==========
        const pairs: string[] = []
        for (const ch of chapterList) {
          const sourceParas = (ch.contentOriginal || "")
            .split(/\n\s*\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0)
          const translatedParas = (ch.contentTranslated || "")
            .split(/\n\s*\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0)
          const pairCount = Math.min(sourceParas.length, translatedParas.length)
          for (let i = 0; i < pairCount; i++) {
            pairs.push(`${sourceParas[i]}\n===\n${translatedParas[i]}`)
          }
        }

        if (pairs.length === 0) {
          // 标记为已翻译但无有效对照对，回退到单语
          const fullText = chapterList
            .map(ch => ch.contentOriginal)
            .filter(Boolean)
            .join("\n\n")
          if (!fullText) throw new Error("小说内容为空")

          const [material] = await db.insert(materials).values({
            title: novel.title || `小说 #${novel.id}`,
            content: fullText,
            sourceType: "reference",
            seriesId: novel.seriesId || undefined,
            description: `从小说库导入：${novel.title}（无有效译文对照）`,
            status: "pending",
          }).returning()

          return { materialId: material.id, title: material.title, chapterCount: chapterList.length, sourceType: "reference" as const }
        }

        const bilingualContent = pairs.join("\n\n===\n\n")

        const [material] = await db.insert(materials).values({
          title: novel.title || `小说 #${novel.id}`,
          content: bilingualContent,
          sourceType: "parallel_corpus",
          seriesId: novel.seriesId || undefined,
          description: `从小说库导入的双语平行语料：${novel.title}（${pairs.length} 对段落）`,
          status: "pending",
        }).returning()

        return {
          materialId: material.id,
          title: material.title,
          chapterCount: chapterList.length,
          sourceType: "parallel_corpus" as const,
          pairCount: pairs.length,
        }
      } else {
        // ========== 未翻译：导入为参考小说 ==========
        const fullText = chapterList
          .map(ch => ch.contentOriginal)
          .filter(Boolean)
          .join("\n\n")

        if (!fullText) throw new Error("小说内容为空")

        const [material] = await db.insert(materials).values({
          title: novel.title || `小说 #${novel.id}`,
          content: fullText,
          sourceType: "reference",
          seriesId: novel.seriesId || undefined,
          description: `从小说库导入的参考小说：${novel.title}`,
          status: "pending",
        }).returning()

        return { materialId: material.id, title: material.title, chapterCount: chapterList.length, sourceType: "reference" as const }
      }
    }),

  // Tag operations
  tags: publicQuery
    .input(z.object({ novelId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      return db
        .select({
          tagId: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(novelTags)
        .innerJoin(tags, eq(tags.id, novelTags.tagId))
        .where(eq(novelTags.novelId, input.novelId))
    }),

  tagMap: publicQuery.query(async () => {
    const db = getDb()
    return db.select().from(novelTags)
  }),
})
