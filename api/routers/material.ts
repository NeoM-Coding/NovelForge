import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { materials, translationMemory, vectorChunks, characterCards, worldBibles, materialAnalytics } from "@db/schema"
import { eq, desc, sql, and, inArray } from "drizzle-orm"
import { tryFixTruncatedJson } from "../lib/json-utils"
import { findPotentialDuplicates, type PotentialDuplicate, findDuplicateAspectGroups, mergeDuplicateAspects } from "../lib/dedup-utils"
import { autoClassifyTranslationStyle } from "../services/style-analyzer"

// ========== 批量提取异步任务状态（内存队列，单用户场景）==========

type BatchTaskStatus = "running" | "completed" | "failed"

interface BatchTask {
  id: string
  status: BatchTaskStatus
  total: number
  processed: number
  currentMaterialId: number | null
  currentMaterialTitle: string
  charactersAdded: number
  charactersMerged: number
  potentialDuplicates: PotentialDuplicate[]
  errors: string[]
  startedAt: Date
  completedAt: Date | null
}

const batchTasks = new Map<string, BatchTask>()

function generateTaskId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function cleanupOldTasks(maxAgeMs = 1000 * 60 * 60 * 2): void {
  const cutoff = Date.now() - maxAgeMs
  for (const [id, task] of batchTasks) {
    if (task.startedAt.getTime() < cutoff) {
      batchTasks.delete(id)
    }
  }
}

// ========== 素材索引异步任务状态 ==========

type IndexTaskStatus = "running" | "completed" | "failed"

interface MaterialIndexTask {
  id: string
  status: IndexTaskStatus
  materialId: number
  materialTitle: string
  indexedChunks: number
  totalCandidates: number
  error?: string
  startedAt: Date
  completedAt: Date | null
}

const materialIndexTasks = new Map<string, MaterialIndexTask>()

function cleanupOldIndexTasks(maxAgeMs = 1000 * 60 * 60 * 2): void {
  const cutoff = Date.now() - maxAgeMs
  for (const [id, task] of materialIndexTasks) {
    if (task.startedAt.getTime() < cutoff) {
      materialIndexTasks.delete(id)
    }
  }
}

// ========== 内部辅助：一键提取核心逻辑 ==========

async function runAutoExtractLore(
  materialId: number,
  targetSeriesId: number
): Promise<{
  charactersAdded: number
  charactersMerged: number
  worldBibleCreated: boolean
  worldBibleMerged: boolean
  materialTitle: string
  potentialDuplicates: PotentialDuplicate[]
}> {
  const db = getDb()

  const [material] = await db
    .select()
    .from(materials)
    .where(eq(materials.id, materialId))

  if (!material) throw new Error("素材不存在")
  if (!material.content) throw new Error("素材内容为空")

  // AI 提取
  const content = material.content.slice(0, 8000)
  const systemPrompt = `你是一个专业的小说设定提取助手。你的任务是从小说或设定素材中提取结构化的角色信息和世界观设定。

提取要求：
1. 只提取素材中**明确提到**的信息，不要编造
2. 如果某类信息在素材中没有出现，返回空值或空数组
3. 人际关系用 {"角色名": "关系描述"} 的格式
4. 派系用 {"name": "名称", "description": "描述"} 的格式
5. 时间线事件按发生顺序排列，order 从 1 开始

必须返回严格的 JSON 格式，不要包含 markdown 代码块标记。`

  const userPrompt = `请从以下素材中提取角色卡和世界观设定，返回 JSON：

{
  "characters": [
    {
      "name": "角色名",
      "aliases": ["别名1", "别名2"],
      "age": "年龄描述",
      "appearanceTags": ["外貌标签1", "外貌标签2"],
      "personalityTraits": ["性格1", "性格2"],
      "coreMotivations": "核心动机/目标",
      "relationships": {"其他角色名": "关系描述"},
      "speechPatterns": "说话方式/口头禅",
      "taboos": ["禁忌1", "禁忌2"],
      "canonicalArcSummary": "角色故事线概要"
    }
  ],
  "worldBible": {
    "geography": "地理环境",
    "magicSystem": "魔法/超自然系统",
    "technologyLevel": "科技水平",
    "factions": [{"name": "派系名", "description": "描述"}],
    "timelineEvents": [{"order": 1, "description": "事件描述"}],
    "culturalCustoms": "文化习俗",
    "linguisticNotes": "语言/命名规则"
  }
}

素材内容：
${content}`

  const result = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    maxTokens: 8000,
  })

  let parsed: unknown
  const fixedJson = tryFixTruncatedJson(result.content)
  if (fixedJson) {
    parsed = JSON.parse(fixedJson)
  } else {
    console.error("[autoExtractLore] JSON 修复失败，原始响应前2000字符:", result.content.slice(0, 2000))
    throw new Error("AI 返回的内容无法解析为有效 JSON")
  }

  const validated = extractedLoreSchema.parse(parsed)

  // 导入角色（同名或别名重叠自动合并）
  let charactersAdded = 0
  let charactersMerged = 0
  const addedCharacters: Array<{ name: string; aliases: string[] }> = []

  // 预加载系列下所有角色，用于别名匹配
  const seriesCharacters = await db
    .select()
    .from(characterCards)
    .where(eq(characterCards.seriesId, targetSeriesId))

  for (const char of validated.characters) {
    const extractedNames = new Set([char.name, ...(char.aliases || [])].filter(Boolean).map(n => n.trim()))

    // 查找同名或别名重叠的现有角色
    const matched = seriesCharacters.find(old => {
      const oldNames = new Set([old.name, ...(old.aliases as string[] || [])].filter(Boolean).map(n => n.trim()))
      for (const name of extractedNames) {
        if (oldNames.has(name)) return true
      }
      return false
    })

    if (matched) {
      const old = matched
      const mergedAliases = [...new Set([...(old.aliases as string[] || []), ...(char.aliases || [])])]
      const mergedTraits = [...new Set([...(old.personalityTraits as string[] || []), ...(char.personalityTraits || [])])]
      const mergedTaboos = [...new Set([...(old.taboos as string[] || []), ...(char.taboos || [])])]
      const mergedRelationships = { ...(old.relationships as Record<string, unknown> || {}), ...(char.relationships || {}) }

      await db
        .update(characterCards)
        .set({
          aliases: mergedAliases as unknown as Record<string, unknown>[],
          personalityTraits: mergedTraits as unknown as Record<string, unknown>[],
          taboos: mergedTaboos as unknown as Record<string, unknown>[],
          relationships: mergedRelationships as unknown as Record<string, unknown>,
          age: old.age || char.age || null,
          coreMotivations: old.coreMotivations || char.coreMotivations || null,
          speechPatterns: old.speechPatterns || char.speechPatterns || null,
          canonicalArcSummary: old.canonicalArcSummary || char.canonicalArcSummary || null,
          appearanceTags: [...new Set([...(old.appearanceTags as string[] || []), ...(char.appearanceTags || [])])] as unknown as Record<string, unknown>[],
          updatedAt: new Date(),
        })
        .where(eq(characterCards.id, old.id))

      // 更新内存缓存，避免后续重复匹配
      const idx = seriesCharacters.findIndex(c => c.id === old.id)
      if (idx !== -1) {
        seriesCharacters[idx] = {
          ...old,
          aliases: mergedAliases as unknown as Record<string, unknown>[],
          personalityTraits: mergedTraits as unknown as Record<string, unknown>[],
          taboos: mergedTaboos as unknown as Record<string, unknown>[],
          relationships: mergedRelationships as unknown as Record<string, unknown>,
          age: old.age || char.age || null,
          coreMotivations: old.coreMotivations || char.coreMotivations || null,
          speechPatterns: old.speechPatterns || char.speechPatterns || null,
          canonicalArcSummary: old.canonicalArcSummary || char.canonicalArcSummary || null,
          appearanceTags: [...new Set([...(old.appearanceTags as string[] || []), ...(char.appearanceTags || [])])] as unknown as Record<string, unknown>[],
          updatedAt: new Date(),
        }
      }
      charactersMerged++
    } else {
      const [inserted] = await db.insert(characterCards).values({
        seriesId: targetSeriesId,
        name: char.name,
        aliases: char.aliases as unknown as Record<string, unknown>[],
        age: char.age || null,
        appearanceTags: char.appearanceTags as unknown as Record<string, unknown>[],
        personalityTraits: char.personalityTraits as unknown as Record<string, unknown>[],
        coreMotivations: char.coreMotivations || null,
        relationships: (char.relationships || {}) as unknown as Record<string, unknown>,
        speechPatterns: char.speechPatterns || null,
        taboos: char.taboos as unknown as Record<string, unknown>[],
        canonicalArcSummary: char.canonicalArcSummary || null,
      }).returning()
      if (inserted) {
        seriesCharacters.push(inserted)
        addedCharacters.push({ name: char.name, aliases: char.aliases || [] })
      }
      charactersAdded++
    }
  }

  // 检测新增角色与已有角色的潜在重复（模糊匹配）
  const existingForDedup = seriesCharacters
    .filter(c => !addedCharacters.some(a => a.name === c.name))
    .map(c => ({
      id: c.id,
      name: c.name,
      aliases: (c.aliases as string[] || []).filter(Boolean),
    }))
  const potentialDuplicates = findPotentialDuplicates(addedCharacters, existingForDedup)

  // 导入世界观（自动合并）
  let worldBibleCreated = false
  let worldBibleMerged = false
  const wb = validated.worldBible
  if (wb && (wb.geography || wb.magicSystem || wb.technologyLevel || wb.factions?.length || wb.timelineEvents?.length || wb.culturalCustoms || wb.linguisticNotes)) {
    const [existingWb] = await db
      .select()
      .from(worldBibles)
      .where(eq(worldBibles.seriesId, targetSeriesId))

    if (existingWb) {
      const existingAspects = (existingWb.aspects || []) as Array<{ id: string; name: string; content: string }>
      const newAspects: Array<{ id: string; name: string; content: string }> = []
      if (wb.geography && !existingWb.geography) newAspects.push({ id: `asp_geo_${Date.now()}`, name: "地理环境", content: wb.geography })
      if (wb.magicSystem && !existingWb.magicSystem) newAspects.push({ id: `asp_mag_${Date.now()}`, name: "力量体系", content: wb.magicSystem })
      if (wb.technologyLevel && !existingWb.technologyLevel) newAspects.push({ id: `asp_tech_${Date.now()}`, name: "科技水平", content: wb.technologyLevel })
      if (wb.culturalCustoms && !existingWb.culturalCustoms) newAspects.push({ id: `asp_cul_${Date.now()}`, name: "文化习俗", content: wb.culturalCustoms })
      if (wb.linguisticNotes && !existingWb.linguisticNotes) newAspects.push({ id: `asp_ling_${Date.now()}`, name: "语言命名", content: wb.linguisticNotes })

      // 对 aspects 做去重合并（同名或近似维度合并内容）
      const allAspects = [...existingAspects, ...newAspects]
      const dupGroups = findDuplicateAspectGroups(allAspects)
      const dedupedAspects = dupGroups.length > 0
        ? mergeDuplicateAspects(allAspects, dupGroups)
        : allAspects

      const mergedFactions = [...((existingWb.factions as Array<{ name: string; description: string }>) || []), ...(wb.factions || [])]
      const mergedTimeline = [...((existingWb.timelineEvents as Array<{ order: number; description: string }>) || []), ...(wb.timelineEvents || [])]

      await db
        .update(worldBibles)
        .set({
          geography: existingWb.geography || wb.geography || null,
          magicSystem: existingWb.magicSystem || wb.magicSystem || null,
          technologyLevel: existingWb.technologyLevel || wb.technologyLevel || null,
          culturalCustoms: existingWb.culturalCustoms || wb.culturalCustoms || null,
          linguisticNotes: existingWb.linguisticNotes || wb.linguisticNotes || null,
          factions: mergedFactions as unknown as Record<string, unknown>[],
          timelineEvents: mergedTimeline as unknown as Record<string, unknown>[],
          aspects: dedupedAspects as unknown as Record<string, unknown>[],
          updatedAt: new Date(),
        })
        .where(eq(worldBibles.id, existingWb.id))
      worldBibleMerged = true
    } else {
      const aspects: Array<{ id: string; name: string; content: string }> = []
      if (wb.geography) aspects.push({ id: `asp_geo_${Date.now()}`, name: "地理环境", content: wb.geography })
      if (wb.magicSystem) aspects.push({ id: `asp_mag_${Date.now()}`, name: "力量体系", content: wb.magicSystem })
      if (wb.technologyLevel) aspects.push({ id: `asp_tech_${Date.now()}`, name: "科技水平", content: wb.technologyLevel })
      if (wb.culturalCustoms) aspects.push({ id: `asp_cul_${Date.now()}`, name: "文化习俗", content: wb.culturalCustoms })
      if (wb.linguisticNotes) aspects.push({ id: `asp_ling_${Date.now()}`, name: "语言命名", content: wb.linguisticNotes })

      // 新建时也做去重（防止同一批提取中出现重复维度）
      const dupGroups = findDuplicateAspectGroups(aspects)
      const dedupedAspects = dupGroups.length > 0
        ? mergeDuplicateAspects(aspects, dupGroups)
        : aspects

      await db.insert(worldBibles).values({
        seriesId: targetSeriesId,
        geography: wb.geography || null,
        magicSystem: wb.magicSystem || null,
        technologyLevel: wb.technologyLevel || null,
        culturalCustoms: wb.culturalCustoms || null,
        linguisticNotes: wb.linguisticNotes || null,
        factions: (wb.factions || []) as unknown as Record<string, unknown>[],
        timelineEvents: (wb.timelineEvents || []) as unknown as Record<string, unknown>[],
        aspects: dedupedAspects as unknown as Record<string, unknown>[],
      })
      worldBibleCreated = true
    }
  }

  return {
    charactersAdded,
    charactersMerged,
    worldBibleCreated,
    worldBibleMerged,
    materialTitle: material.title,
    potentialDuplicates,
  }
}
import { getEmbeddingsBatch, chatCompletion } from "../services/deepseek"
import { parseParallelCorpus } from "../services/parser"
import { extractedLoreSchema } from "@contracts/schemas"
import { indexNovel } from "../services/embedder"
import { splitIntoSemanticChunks, type Chunk } from "../lib/chunk-utils"

// 将文本分割为段落数组
function splitTextIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

/**
 * 执行素材索引核心逻辑
 * 被同步 index 和异步 indexAsync 共用
 */
async function runIndexMaterial(
  materialId: number,
  task?: MaterialIndexTask
): Promise<{ indexedCount: number; totalCandidates: number }> {
  const db = getDb()

  const [material] = await db
    .select()
    .from(materials)
    .where(eq(materials.id, materialId))

  if (!material) throw new Error("Material not found")
  if (!material.content) throw new Error("Material has no content")

  await db
    .update(materials)
    .set({ status: "indexing" })
    .where(eq(materials.id, materialId))

  if (task) {
    task.status = "running"
    task.materialTitle = material.title
  }

  // 清理该素材的历史索引，防止重复数据
  await db.execute(sql`DELETE FROM vector_chunks WHERE metadata->>'materialId' = ${String(materialId)}`)
  await db.execute(sql`DELETE FROM translation_memory WHERE metadata->>'materialId' = ${String(materialId)}`)

  try {
    let indexedCount = 0
    let firstError = ""
    let totalCandidates = 0

    if (material.sourceType === "parallel_corpus") {
      const pairs = parseParallelCorpus(material.content)
      const validPairs = pairs.filter(
        ({ source, translated }) => source.trim().length >= 10 && translated.trim().length >= 5
      )
      totalCandidates = validPairs.length

      if (task) task.totalCandidates = totalCandidates

      if (validPairs.length > 0) {
        let embeddings: number[][] = []
        try {
          embeddings = await getEmbeddingsBatch(validPairs.map(p => p.source.trim()))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          firstError = msg
          console.error("Batch embedding failed for parallel corpus:", err)
        }

        const seenSource = new Set<string>()
        const tmValues = []
        const vcValues = []
        for (let i = 0; i < validPairs.length; i++) {
          const { source, translated } = validPairs[i]
          const key = source.trim()
          if (seenSource.has(key)) continue
          seenSource.add(key)

          const embedding = embeddings[i]
          if (!embedding || embedding.length === 0) continue

          const styleTag = autoClassifyTranslationStyle(key, translated.trim())
          tmValues.push({
            sourceText: key,
            translatedText: translated.trim(),
            embedding: embedding as unknown as number[],
            seriesId: material.seriesId || null,
            novelId: null,
            frequency: 1,
            styleTag,
            metadata: { materialId: material.id },
          })

          vcValues.push({
            content: key,
            embedding: embedding as unknown as number[],
            sourceType: "parallel_corpus",
            seriesId: material.seriesId,
            metadata: {
              materialId: material.id,
              materialTitle: material.title,
              translatedText: translated.trim().slice(0, 200),
              indexedAt: new Date().toISOString(),
            },
          })

          indexedCount++
          if (task) task.indexedChunks = indexedCount
        }

        if (tmValues.length > 0) {
          await db.insert(translationMemory).values(tmValues)
          await db.insert(vectorChunks).values(vcValues)
        }
      }
    } else {
      const chunks = splitIntoSemanticChunks(material.content, {
        sourceId: material.id,
        sourceTitle: material.title,
      })
      const validChunks = chunks.filter((c: Chunk) => c.content.trim().length >= 50)
      totalCandidates = validChunks.length

      if (task) task.totalCandidates = totalCandidates

      if (validChunks.length > 0) {
        let embeddings: number[][] = []
        try {
          embeddings = await getEmbeddingsBatch(validChunks.map(c => c.content.trim()))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          firstError = msg
          console.error("Batch embedding failed for chunks:", err)
        }

        const vcValues = []
        for (let i = 0; i < validChunks.length; i++) {
          const chunk = validChunks[i]
          const embedding = embeddings[i]
          if (!embedding || embedding.length === 0) continue

          vcValues.push({
            content: chunk.content,
            embedding: embedding as unknown as number[],
            sourceType: material.sourceType,
            novelId: null,
            seriesId: material.seriesId,
            metadata: {
              materialId: material.id,
              materialTitle: material.title,
              indexedAt: new Date().toISOString(),
              sourceId: chunk.sourceId,
              sourceTitle: chunk.sourceTitle,
              chunkIndex: chunk.chunkIndex,
              totalChunks: chunk.totalChunks,
              contextBefore: chunk.contextBefore,
              contextAfter: chunk.contextAfter,
            },
          })

          indexedCount++
          if (task) task.indexedChunks = indexedCount
        }

        if (vcValues.length > 0) {
          await db.insert(vectorChunks).values(vcValues)
        }
      }
    }

    if (indexedCount === 0 && totalCandidates > 0 && firstError) {
      await db
        .update(materials)
        .set({ status: "failed", indexedChunks: 0 })
        .where(eq(materials.id, materialId))
      if (task) {
        task.status = "failed"
        task.error = `索引失败: ${firstError}`
        task.completedAt = new Date()
      }
      throw new Error(`索引失败: ${firstError}`)
    }

    await db
      .update(materials)
      .set({ status: "indexed", indexedChunks: indexedCount })
      .where(eq(materials.id, materialId))

    if (task) {
      task.status = "completed"
      task.indexedChunks = indexedCount
      task.completedAt = new Date()
    }

    return { indexedCount, totalCandidates }
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith("索引失败:")) {
      await db
        .update(materials)
        .set({ status: "failed" })
        .where(eq(materials.id, materialId))
    }
    if (task) {
      task.status = "failed"
      task.error = error instanceof Error ? error.message : String(error)
      task.completedAt = new Date()
    }
    throw error
  }
}

export const materialRouter = createRouter({
  list: publicQuery
    .input(z.object({
      seriesId: z.number().optional(),
      sourceType: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb()
      const conditions = []
      if (input?.seriesId) {
        conditions.push(eq(materials.seriesId, input.seriesId))
      }
      if (input?.sourceType) {
        conditions.push(eq(materials.sourceType, input.sourceType))
      }
      const matRows = conditions.length > 0
        ? await db.select().from(materials).where(and(...conditions)).orderBy(desc(materials.createdAt))
        : await db.select().from(materials).orderBy(desc(materials.createdAt))

      // 批量查询 analytics
      const analyticsRows = await db
        .select()
        .from(materialAnalytics)
        .where(inArray(materialAnalytics.materialId, matRows.map(m => m.id)))

      const analyticsMap = new Map(analyticsRows.map(a => [a.materialId, a]))

      return matRows.map(m => ({
        ...m,
        analytics: analyticsMap.get(m.id) || {
          retrievalCount: 0,
          generationUsageCount: 0,
          positiveFeedbackCount: 0,
          negativeFeedbackCount: 0,
        },
      }))
    }),

  create: publicQuery
    .input(z.object({
      title: z.string().min(1),
      content: z.string().min(1),
      sourceType: z.enum(["parallel_corpus", "reference_novel", "knowledge_doc"]),
      seriesId: z.number().optional(),
      tags: z.array(z.string()).default([]),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [material] = await db.insert(materials).values({
        title: input.title,
        content: input.content,
        sourceType: input.sourceType,
        seriesId: input.seriesId || null,
        tags: input.tags,
        description: input.description,
        status: "pending",
      }).returning()
      return material
    }),

  createFromAlignedPairs: publicQuery
    .input(z.object({
      title: z.string().min(1),
      alignedPairs: z.array(z.object({
        source: z.string(),
        translated: z.string(),
      })),
      seriesId: z.number().optional(),
      tags: z.array(z.string()).default([]),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const serialized = input.alignedPairs
        .map(p => `${p.source}\n===\n${p.translated}`)
        .join("\n===\n")

      const [material] = await db.insert(materials).values({
        title: input.title,
        content: serialized,
        sourceType: "parallel_corpus",
        seriesId: input.seriesId || null,
        tags: input.tags,
        description: input.description || `手动对齐: ${input.alignedPairs.length} 对段落`,
        status: "pending",
      }).returning()

      return material
    }),

  createFromDualFiles: publicQuery
    .input(z.object({
      title: z.string().min(1),
      sourceText: z.string().min(1),
      translatedText: z.string().min(1),
      seriesId: z.number().optional(),
      tags: z.array(z.string()).default([]),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const sourceParagraphs = splitTextIntoParagraphs(input.sourceText)
      const translatedParagraphs = splitTextIntoParagraphs(input.translatedText)

      const pairCount = Math.min(sourceParagraphs.length, translatedParagraphs.length)
      const alignedPairs: Array<{ source: string; translated: string }> = []
      for (let i = 0; i < pairCount; i++) {
        if (sourceParagraphs[i].trim().length > 5 && translatedParagraphs[i].trim().length > 2) {
          alignedPairs.push({
            source: sourceParagraphs[i].trim(),
            translated: translatedParagraphs[i].trim(),
          })
        }
      }

      const serialized = alignedPairs
        .map(p => `${p.source}\n===\n${p.translated}`)
        .join("\n===\n")

      const [material] = await db.insert(materials).values({
        title: input.title,
        content: serialized,
        sourceType: "parallel_corpus",
        seriesId: input.seriesId || null,
        tags: input.tags,
        description: input.description || `自动对齐: ${alignedPairs.length} 对段落 (原文${sourceParagraphs.length}段 / 译文${translatedParagraphs.length}段)`,
        status: "pending",
      }).returning()

      return {
        ...material,
        _meta: {
          sourceParagraphCount: sourceParagraphs.length,
          translatedParagraphCount: translatedParagraphs.length,
          alignedPairCount: alignedPairs.length,
          alignedPairs,
        },
      }
    }),

  // 同步索引（适用于小素材，大素材请用 indexAsync）
  index: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { indexedCount } = await runIndexMaterial(input.id)
      return { success: true, indexedChunks: indexedCount }
    }),

  // 异步索引（后台执行，立即返回 jobId，适合大素材）
  indexAsync: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      cleanupOldIndexTasks()

      const db = getDb()
      const [material] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, input.id))

      if (!material) throw new Error("素材不存在")
      if (!material.content) throw new Error("素材内容为空")

      const taskId = generateTaskId()
      const task: MaterialIndexTask = {
        id: taskId,
        status: "running",
        materialId: input.id,
        materialTitle: material.title,
        indexedChunks: 0,
        totalCandidates: 0,
        startedAt: new Date(),
        completedAt: null,
      }
      materialIndexTasks.set(taskId, task)

      // 后台执行，不 await
      Promise.resolve().then(async () => {
        try {
          await runIndexMaterial(input.id, task)
        } catch (err) {
          console.error("[indexAsync] background indexing failed:", err)
        }
      })

      return { jobId: taskId }
    }),

  // 查询异步索引任务状态
  indexAsyncStatus: publicQuery
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const task = materialIndexTasks.get(input.jobId)
      if (!task) {
        return {
          found: false as const,
          status: "failed" as const,
          message: "任务不存在或已过期（任务保留2小时）",
        }
      }

      return {
        found: true as const,
        status: task.status,
        materialTitle: task.materialTitle,
        indexedChunks: task.indexedChunks,
        totalCandidates: task.totalCandidates,
        error: task.error,
        completedAt: task.completedAt,
      }
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()

      // 记录删除前的快照
      const [material] = await db.select().from(materials).where(eq(materials.id, input.id))
      if (material) {
        const { logAudit } = await import("../routers/audit")
        await logAudit({
          action: "material_delete",
          entityType: "material",
          entityId: input.id,
          snapshot: material as unknown as Record<string, unknown>,
          description: `删除素材《${material.title}》`,
        })
      }

      await db.execute(sql`DELETE FROM vector_chunks WHERE metadata->>'materialId' = ${String(input.id)}`)
      await db.execute(sql`DELETE FROM translation_memory WHERE metadata->>'materialId' = ${String(input.id)}`)

      await db.delete(materials).where(eq(materials.id, input.id))

      return { success: true }
    }),

  parseFile: publicQuery
    .input(z.object({
      fileName: z.string(),
      fileData: z.string(), // base64 encoded
    }))
    .mutation(async ({ input }) => {
      const ext = input.fileName.split(".").pop()?.toLowerCase()
      const buffer = Buffer.from(input.fileData, "base64")

      if (ext === "txt") {
        const text = buffer.toString("utf-8")
        return { text, fileType: "txt" }
      }

      if (ext === "docx") {
        const mammoth = await import("mammoth")
        const result = await mammoth.extractRawText({ buffer })
        return { text: result.value, fileType: "docx" }
      }

      throw new Error(`不支持的文件格式: .${ext}。目前仅支持 .txt 和 .docx`)
    }),

  getChunks: publicQuery
    .input(z.object({ materialId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const rows = await db
        .select({
          id: vectorChunks.id,
          content: vectorChunks.content,
          sourceType: vectorChunks.sourceType,
          metadata: vectorChunks.metadata,
          createdAt: vectorChunks.createdAt,
        })
        .from(vectorChunks)
        .where(sql`${vectorChunks.metadata}->>'materialId' = ${String(input.materialId)}`)
        .orderBy(vectorChunks.createdAt)
      return rows
    }),

  updateScope: publicQuery
    .input(z.object({
      id: z.number(),
      seriesId: z.number().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const { id, ...data } = input
      const [material] = await db
        .update(materials)
        .set(data)
        .where(eq(materials.id, id))
        .returning()
      return material
    }),

  extractLore: publicQuery
    .input(z.object({ materialId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [material] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, input.materialId))

      if (!material) throw new Error("Material not found")
      if (!material.content) throw new Error("Material has no content")

      const content = material.content.slice(0, 8000)

      const systemPrompt = `你是一个专业的小说设定提取助手。你的任务是从小说或设定素材中提取结构化的角色信息和世界观设定。

提取要求：
1. 只提取素材中**明确提到**的信息，不要编造
2. 如果某类信息在素材中没有出现，返回空值或空数组
3. 人际关系用 {"角色名": "关系描述"} 的格式
4. 派系用 {"name": "名称", "description": "描述"} 的格式
5. 时间线事件按发生顺序排列，order 从 1 开始

必须返回严格的 JSON 格式，不要包含 markdown 代码块标记。`

      const userPrompt = `请从以下素材中提取角色卡和世界观设定，返回 JSON：

{
  "characters": [
    {
      "name": "角色名",
      "aliases": ["别名1", "别名2"],
      "age": "年龄描述",
      "appearanceTags": ["外貌标签1", "外貌标签2"],
      "personalityTraits": ["性格1", "性格2"],
      "coreMotivations": "核心动机/目标",
      "relationships": {"其他角色名": "关系描述"},
      "speechPatterns": "说话方式/口头禅",
      "taboos": ["禁忌1", "禁忌2"],
      "canonicalArcSummary": "角色故事线概要"
    }
  ],
  "worldBible": {
    "geography": "地理环境",
    "magicSystem": "魔法/超自然系统",
    "technologyLevel": "科技水平",
    "factions": [{"name": "派系名", "description": "描述"}],
    "timelineEvents": [{"order": 1, "description": "事件描述"}],
    "culturalCustoms": "文化习俗",
    "linguisticNotes": "语言/命名规则"
  }
}

素材内容：
${content}`

      const result = await chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens: 8000,
      })

      let parsed: unknown
      const fixedJson = tryFixTruncatedJson(result.content)
      if (fixedJson) {
        parsed = JSON.parse(fixedJson)
      } else {
        console.error("[extractLore] JSON 修复失败，原始响应前2000字符:", result.content.slice(0, 2000))
        throw new Error("AI 返回的内容无法解析为有效 JSON")
      }

      const validated = extractedLoreSchema.parse(parsed)
      return validated
    }),

  // 一键自动提取并保存到设定库（无需手动确认）
  autoExtractLore: publicQuery
    .input(z.object({
      materialId: z.number(),
      seriesId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [material] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, input.materialId))

      if (!material) throw new Error("素材不存在")
      if (!material.content) throw new Error("素材内容为空")

      const targetSeriesId = input.seriesId ?? material.seriesId ?? null
      if (!targetSeriesId) throw new Error("素材未绑定系列，请指定 seriesId")

      return runAutoExtractLore(input.materialId, targetSeriesId)
    }),

  // 批量自动提取（异步后台处理，避免504超时）
  batchAutoExtract: publicQuery
    .input(z.object({
      materialIds: z.array(z.number()).max(200, "一次最多处理200条素材"),
      seriesId: z.number(),
    }))
    .mutation(async ({ input }) => {
      cleanupOldTasks()

      const taskId = generateTaskId()
      const task: BatchTask = {
        id: taskId,
        status: "running",
        total: input.materialIds.length,
        processed: 0,
        currentMaterialId: null,
        currentMaterialTitle: "",
        charactersAdded: 0,
        charactersMerged: 0,
        potentialDuplicates: [],
        errors: [],
        startedAt: new Date(),
        completedAt: null,
      }
      batchTasks.set(taskId, task)

      // 启动后台处理（不 await，立即返回 taskId）
      Promise.resolve().then(async () => {
        for (const materialId of input.materialIds) {
          if (task.status === "failed") break

          const db = getDb()
          const [material] = await db
            .select()
            .from(materials)
            .where(eq(materials.id, materialId))

          task.currentMaterialId = materialId
          task.currentMaterialTitle = material?.title || `素材#${materialId}`

          try {
            const result = await runAutoExtractLore(materialId, input.seriesId)
            task.charactersAdded += result.charactersAdded
            task.charactersMerged += result.charactersMerged
            task.potentialDuplicates.push(...result.potentialDuplicates)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[BatchExtract] material ${materialId} failed:`, msg)
            task.errors.push(`素材#${materialId}: ${msg}`)
          }

          task.processed++
        }

        task.status = task.errors.length > 0 && task.processed === 0 ? "failed" : "completed"
        task.completedAt = new Date()
        task.currentMaterialId = null
        task.currentMaterialTitle = ""
      })

      return { taskId, total: input.materialIds.length }
    }),

  // 查询批量提取任务进度
  batchAutoExtractStatus: publicQuery
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input }) => {
      const task = batchTasks.get(input.taskId)
      if (!task) {
        return {
          found: false,
          status: "failed" as const,
          message: "任务不存在或已过期（任务保留2小时）",
        }
      }

      return {
        found: true,
        status: task.status,
        total: task.total,
        processed: task.processed,
        currentMaterialTitle: task.currentMaterialTitle,
        charactersAdded: task.charactersAdded,
        charactersMerged: task.charactersMerged,
        potentialDuplicates: task.potentialDuplicates,
        errors: task.errors,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      }
    }),

  // 保存为风格样本（生成内容回流）
  saveAsStyleSample: publicQuery
    .input(z.object({
      content: z.string().min(10),
      seriesId: z.number(),
      characterTag: z.string().optional(),
      sceneTag: z.string().optional(),
      sourceWorkId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      // 1. 存入 materials
      const [material] = await db.insert(materials).values({
        title: `风格样本 · ${input.characterTag || "通用"} · ${input.sceneTag || "通用"}`,
        content: input.content,
        sourceType: "style_sample",
        seriesId: input.seriesId,
        tags: [input.characterTag, input.sceneTag].filter((t): t is string => !!t),
        description: input.sourceWorkId ? `来源二创作品 #${input.sourceWorkId}` : undefined,
        status: "indexed",
      }).returning()

      // 2. 自动索引到 vector_chunks
      await indexNovel(material.id, input.content, {
        seriesId: input.seriesId,
        sourceType: "style_sample",
        sourceTitle: material.title,
      })

      return material
    }),
})
