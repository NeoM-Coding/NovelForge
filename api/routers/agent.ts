/**
 * Agent Proxy Router — 外部 AI Agent 操控 NovelForge 的接口层
 *
 * 设计原则：
 * 1. 信息聚合：一次查询返回系列完整上下文（角色+世界观+素材+桥段）
 * 2. 自然语言友好：返回结果带 description/suggestion，方便 LLM 理解
 * 3. 不复制复杂逻辑：生成等核心创作流程仍走现有 router，agent 层负责"发现"和"协调"
 */

import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import {
  series,
  characterCards,
  worldBibles,
  seriesCanon,
  materials,
  fanFictionWorks,
  novels,
  plotTropes,
  vectorChunks,
  ragFeedback,
} from "@db/schema"
import { eq, asc, sql, desc } from "drizzle-orm"
import { searchSimilar } from "../services/embedder"

export const agentRouter = createRouter({
  // ========== 能力发现 ==========

  capabilities: publicQuery.query(() => ({
    version: "1.0.0",
    name: "NovelForge Agent Proxy",
    description:
      "外部 AI Agent 操控 NovelForge 创作平台的接口层。" +
      "NovelForge 是一个 AI 驱动的小说翻译与二创平台，包含系列管理、角色卡、世界观圣经、素材池、二创生成等功能。",
    queryTools: [
      {
        name: "status",
        desc: "系统状态概览（系列数、角色数、素材数、作品数、向量块数）",
      },
      {
        name: "describeSeries",
        desc: "系列完整详情（角色卡、世界观、正史、素材、桥段、最近作品）—— 推荐作为了解某个系列的首选入口",
      },
      {
        name: "searchRag",
        desc: "RAG 语义搜索，查找与查询语义相似的素材片段（向量+全文+trgm 混合检索）",
      },
      {
        name: "listWorks",
        desc: "列出二创作品，可按系列筛选",
      },
      {
        name: "getWork",
        desc: "获取指定二创作品的完整内容",
      },
      {
        name: "listMaterials",
        desc: "列出素材，可按系列和类型筛选",
      },
    ],
    mutationTools: [
      {
        name: "saveStyleSample",
        desc: "将文字保存为风格样本，自动索引到 RAG 库（需指定系列和角色标签）",
      },
      {
        name: "submitFeedback",
        desc: "为某次生成提交 RAG 反馈（👍/👎），用于优化检索质量",
      },
      {
        name: "extractStyle",
        desc: "为角色提炼语言风格画像（需该角色已有 ≥3 条风格样本）",
      },
    ],
    note: "创作生成（generate.fanfiction）等核心功能请直接调用现有 tRPC API，agent 层提供信息协调。",
  })),

  // ========== 系统状态 ==========

  status: publicQuery.query(async () => {
    const db = getDb()
    const [seriesCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(series)
    const [charCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(characterCards)
    const [materialCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(materials)
    const [workCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(fanFictionWorks)
    const [novelCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(novels)
    const [chunkCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(vectorChunks)

    return {
      stats: {
        series: seriesCount.count,
        characters: charCount.count,
        materials: materialCount.count,
        fanFictionWorks: workCount.count,
        novels: novelCount.count,
        vectorChunks: chunkCount.count,
      },
      description:
        `NovelForge 当前有 ${seriesCount.count} 个系列、` +
        `${charCount.count} 个角色、${materialCount.count} 条素材、` +
        `${workCount.count} 件二创作品、${novelCount.count} 部小说、` +
        `${chunkCount.count} 个向量检索块。`,
      suggestion:
        "如果你想开始创作，先用 describeSeries 了解某个系列的设定，然后用 searchRag 检索相关素材，最后调用 generate.fanfiction 生成内容。",
    }
  }),

  // ========== 系列详情（聚合查询）==========

  describeSeries: publicQuery
    .input(z.object({ seriesId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()

      const [s] = await db
        .select()
        .from(series)
        .where(eq(series.id, input.seriesId))
      if (!s) throw new Error(`系列 ID ${input.seriesId} 不存在`)

      const [charRows] = await db
        .select({ count: sql<number>`count(*)` })
        .from(characterCards)
        .where(eq(characterCards.seriesId, input.seriesId))

      const [matRows] = await db
        .select({ count: sql<number>`count(*)` })
        .from(materials)
        .where(eq(materials.seriesId, input.seriesId))

      const [workRows] = await db
        .select({ count: sql<number>`count(*)` })
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.seriesId, input.seriesId))

      const chars = await db
        .select()
        .from(characterCards)
        .where(eq(characterCards.seriesId, input.seriesId))

      const [wb] = await db
        .select()
        .from(worldBibles)
        .where(eq(worldBibles.seriesId, input.seriesId))

      const canon = await db
        .select()
        .from(seriesCanon)
        .where(eq(seriesCanon.seriesId, input.seriesId))
        .orderBy(asc(seriesCanon.eventOrder))

      const mats = await db
        .select()
        .from(materials)
        .where(eq(materials.seriesId, input.seriesId))
        .orderBy(desc(materials.createdAt))

      const tropes = await db
        .select()
        .from(plotTropes)
        .where(eq(plotTropes.seriesId, input.seriesId))

      const works = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.seriesId, input.seriesId))
        .orderBy(desc(fanFictionWorks.createdAt))
        .limit(5)

      return {
        series: {
          id: s.id,
          name: s.name,
          description: s.description,
          universeName: s.universeName,
        },
        summary: {
          characterCount: charRows.count,
          materialCount: matRows.count,
          workCount: workRows.count,
          worldBibleExists: !!wb,
          canonEventCount: canon.length,
          tropeCount: tropes.length,
        },
        characters: chars.map((c) => ({
          id: c.id,
          name: c.name,
          aliases: c.aliases as string[],
          age: c.age,
          personalityTraits: c.personalityTraits as string[],
          speechPatterns: c.speechPatterns,
          coreMotivations: c.coreMotivations,
          taboos: c.taboos as string[],
        })),
        worldBible: wb
          ? {
              aspects: (wb.aspects || []) as Array<{
                id: string
                name: string
                content: string
              }>,
              geography: wb.geography,
              magicSystem: wb.magicSystem,
              technologyLevel: wb.technologyLevel,
              culturalCustoms: wb.culturalCustoms,
              factions: wb.factions,
              timelineEvents: wb.timelineEvents,
            }
          : null,
        canonEvents: canon.map((e) => ({
          order: e.eventOrder,
          description: e.description,
          immutable: e.isImmutable,
        })),
        materials: mats.map((m) => ({
          id: m.id,
          title: m.title,
          sourceType: m.sourceType,
          status: m.status,
          tags: m.tags as string[],
        })),
        tropes: tropes.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          pattern: t.pattern,
        })),
        recentWorks: works.map((w) => ({
          id: w.id,
          title: w.title,
          brief: w.brief,
          status: w.status,
          createdAt: w.createdAt,
        })),
        suggestion:
          chars.length > 0
            ? `该系列已有 ${chars.length} 个角色。你可以调用 generate.fanfiction（seriesId=${s.id}）生成二创，建议在 brief 中指定使用哪些角色。`
            : "该系列暂无角色卡，建议先在 LoreLibrary 中创建角色或使用 autoExtractLore 从素材自动提取。",
      }
    }),

  // ========== RAG 搜索 ==========

  searchRag: publicQuery
    .input(
      z.object({
        query: z.string().min(1),
        seriesId: z.number().optional(),
        novelId: z.number().optional(),
        limit: z.number().min(1).max(10).default(5),
      }),
    )
    .query(async ({ input }) => {
      const results = await searchSimilar(input.query, {
        seriesId: input.seriesId,
        novelId: input.novelId,
        limit: input.limit,
      })
      return {
        query: input.query,
        resultCount: results.length,
        results: results.map((r) => ({
          content:
            r.content.slice(0, 300) +
            (r.content.length > 300 ? "..." : ""),
          similarity: Math.round(r.similarity * 100),
          sourceTitle: r.sourceTitle,
          sourceType: r.sourceType,
          chunkIndex: r.chunkIndex,
          totalChunks: r.totalChunks,
        })),
        suggestion:
          results.length > 0
            ? "检索到了相关素材。你可以在生成时将这些内容作为参考。"
            : "未检索到相关内容，建议补充素材或调整查询关键词。",
      }
    }),

  // ========== 作品列表 ==========

  listWorks: publicQuery
    .input(
      z
        .object({
          seriesId: z.number().optional(),
          limit: z.number().default(20),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb()
      const works = input?.seriesId
        ? await db
            .select()
            .from(fanFictionWorks)
            .where(eq(fanFictionWorks.seriesId, input.seriesId))
            .orderBy(desc(fanFictionWorks.createdAt))
            .limit(input.limit)
        : await db
            .select()
            .from(fanFictionWorks)
            .orderBy(desc(fanFictionWorks.createdAt))
            .limit(input?.limit || 20)
      return {
        count: works.length,
        works: works.map((w) => ({
          id: w.id,
          title: w.title,
          brief: w.brief,
          status: w.status,
          createdAt: w.createdAt,
        })),
      }
    }),

  // ========== 作品详情 ==========

  getWork: publicQuery
    .input(z.object({ workId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId))
      if (!work) throw new Error("作品不存在")
      return {
        id: work.id,
        title: work.title,
        brief: work.brief,
        content: work.generatedContent,
        status: work.status,
        parameters: work.parameters,
        createdAt: work.createdAt,
      }
    }),

  // ========== 素材列表 ==========

  listMaterials: publicQuery
    .input(
      z
        .object({
          seriesId: z.number().optional(),
          sourceType: z.string().optional(),
          limit: z.number().default(50),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb()
      let query = db.select().from(materials)
      if (input?.seriesId) {
        query = query.where(eq(materials.seriesId, input.seriesId)) as typeof query
      }
      const mats = await query
        .orderBy(desc(materials.createdAt))
        .limit(input?.limit || 50)
      return {
        count: mats.length,
        materials: mats.map((m) => ({
          id: m.id,
          title: m.title,
          sourceType: m.sourceType,
          status: m.status,
          tags: m.tags as string[],
        })),
      }
    }),

  // ========== 保存风格样本 ==========

  saveStyleSample: publicQuery
    .input(
      z.object({
        content: z.string().min(10),
        seriesId: z.number(),
        characterTag: z.string().optional(),
        sceneTag: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const [material] = await db
        .insert(materials)
        .values({
          title: `风格样本 · ${input.characterTag || "通用"} · ${input.sceneTag || "通用"}`,
          content: input.content,
          sourceType: "style_sample",
          seriesId: input.seriesId,
          tags: [input.characterTag, input.sceneTag].filter(Boolean),
          status: "indexed",
        })
        .returning()

      // 自动索引（复用 embedder 逻辑）
      const { indexNovel } = await import("../services/embedder")
      await indexNovel(material.id, input.content, {
        seriesId: input.seriesId,
        sourceType: "style_sample",
        sourceTitle: material.title,
      })

      return {
        success: true,
        materialId: material.id,
        title: material.title,
        suggestion: `已保存为风格样本并索引到 RAG。下次生成时，该素材会被检索到。如果你积累了 ≥3 条同角色的风格样本，可以在 LoreLibrary 中点击"分析风格样本"提炼角色语言风格画像。`,
      }
    }),

  // ========== RAG 反馈 ==========

  submitFeedback: publicQuery
    .input(
      z.object({
        generationId: z.number(),
        wasHelpful: z.boolean(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      await db
        .update(ragFeedback)
        .set({ wasHelpful: input.wasHelpful })
        .where(eq(ragFeedback.generationId, input.generationId))
      return {
        success: true,
        message: input.wasHelpful
          ? "感谢反馈，已标记为满意。"
          : `已记录不满意反馈${input.reason ? "（原因：" + input.reason + "）" : ""}。`,
      }
    }),

  // ========== 风格提炼（简化入口）==========

  extractStyle: publicQuery
    .input(
      z.object({
        seriesId: z.number(),
        characterName: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb()

      const styleSamples = await db
        .select()
        .from(materials)
        .where(
          sql`${materials.seriesId} = ${input.seriesId}
            AND ${materials.sourceType} = 'style_sample'
            AND ${materials.tags}::jsonb @> ${JSON.stringify([input.characterName])}::jsonb`,
        )

      if (styleSamples.length < 3) {
        return {
          success: false,
          error: `风格样本不足（当前 ${styleSamples.length} 条，需要至少 3 条）。请先在 Studio 中生成内容并保存为「${input.characterName}」的风格样本。`,
        }
      }

      // 委托给 lore.character.extractStyleProfile
      const { chatCompletion } = await import("../services/deepseek")
      const combined = styleSamples
        .map((s) => s.content.slice(0, 300))
        .join("\n---\n")
      const prompt =
        `分析以下 "${input.characterName}" 的风格样本，提炼其语言风格特征：\n\n` +
        `${combined}\n\n` +
        `请返回以下 JSON 格式（不要包含 markdown 代码块标记，只返回纯 JSON）：\n` +
        `{"vocabulary":["高频用词1"],"sentencePatterns":["句式特点1"],` +
        `"emotionalTone":"情感基调","dialogueStyle":"对话风格","narrativeHabits":"叙事习惯"}`

      const result = await chatCompletion({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 2000,
      })

      let profile: Record<string, unknown>
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/)
        profile = JSON.parse(jsonMatch ? jsonMatch[0] : result.content)
      } catch {
        return { success: false, error: "AI 返回的风格分析无法解析为有效 JSON" }
      }

      const chars = await db
        .select()
        .from(characterCards)
        .where(
          sql`${characterCards.seriesId} = ${input.seriesId}
            AND ${characterCards.name} = ${input.characterName}`,
        )
      if (chars.length === 0) {
        return { success: false, error: "角色不存在" }
      }

      await db
        .update(characterCards)
        .set({ speechPatterns: JSON.stringify(profile) })
        .where(eq(characterCards.id, chars[0].id))

      return {
        success: true,
        profile,
        suggestion: `风格画像已更新到角色「${input.characterName}」的 speechPatterns。下一次生成时，System Prompt 会自动注入该角色的语言风格特征。`,
      }
    }),
})
