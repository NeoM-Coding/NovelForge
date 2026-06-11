import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { plotTropes, tropeCharacterLinks, tropeCanonLinks, characterCards, seriesCanon, fanFictionWorks } from "@db/schema"
import { eq, asc, inArray } from "drizzle-orm"
import { chatCompletion } from "../services/deepseek"

/* ========== 内存任务存储（后台异步提取） ========== */
interface ExtractionTask {
  status: "pending" | "processing" | "completed" | "failed" | "cancelled"
  progress: number
  totalBatches: number
  completedBatches: number
  message: string
  createdAt: number
  sourceTitles?: string[]
  result?: { tropes: (typeof plotTropes.$inferSelect)[]; count: number }
  error?: string
}

const extractionTasks = new Map<number, ExtractionTask>()
let nextTaskId = 1

// 清理过期任务（已完成/失败超过10分钟的）
setInterval(() => {
  const now = Date.now()
  for (const [id, task] of extractionTasks) {
    if (
      (task.status === "completed" || task.status === "failed") &&
      now - task.createdAt > 10 * 60 * 1000
    ) {
      extractionTasks.delete(id)
    }
  }
}, 60 * 1000)

/* ========== Router ========== */

export const tropeRouter = createRouter({
  // 列出系列下的桥段（含关联角色）
  list: publicQuery
    .input(z.object({ seriesId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const tropes = await db
        .select()
        .from(plotTropes)
        .where(eq(plotTropes.seriesId, input.seriesId))
        .orderBy(asc(plotTropes.name))

      const links = await db
        .select({
          tropeId: tropeCharacterLinks.tropeId,
          characterId: tropeCharacterLinks.characterId,
          role: tropeCharacterLinks.role,
          characterName: characterCards.name,
        })
        .from(tropeCharacterLinks)
        .innerJoin(characterCards, eq(tropeCharacterLinks.characterId, characterCards.id))
        .where(eq(characterCards.seriesId, input.seriesId))

      return tropes.map(t => ({
        ...t,
        linkedCharacters: links.filter(l => l.tropeId === t.id).map(l => ({
          id: l.characterId,
          name: l.characterName,
          role: l.role,
        })),
      }))
    }),

  // 手动创建桥段
  create: publicQuery
    .input(
      z.object({
        seriesId: z.number(),
        name: z.string().min(1),
        description: z.string().optional(),
        pattern: z.string().optional(),
        examples: z.array(z.string()).default([]),
        tags: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const [trope] = await db
        .insert(plotTropes)
        .values({
          seriesId: input.seriesId,
          name: input.name,
          description: input.description || null,
          pattern: input.pattern || null,
          examples: input.examples as unknown as Record<string, unknown>[],
          tags: input.tags as unknown as Record<string, unknown>[],
        })
        .returning()
      return trope
    }),

  // 更新桥段
  update: publicQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        pattern: z.string().optional(),
        examples: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const { id, ...data } = input
      const [trope] = await db
        .update(plotTropes)
        .set({
          ...data,
          examples: data.examples
            ? (data.examples as unknown as Record<string, unknown>[])
            : undefined,
          tags: data.tags
            ? (data.tags as unknown as Record<string, unknown>[])
            : undefined,
          updatedAt: new Date(),
        })
        .where(eq(plotTropes.id, id))
        .returning()
      return trope
    }),

  // 删除桥段
  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      await db.delete(tropeCharacterLinks).where(eq(tropeCharacterLinks.tropeId, input.id))
      await db.delete(tropeCanonLinks).where(eq(tropeCanonLinks.tropeId, input.id))
      await db.delete(plotTropes).where(eq(plotTropes.id, input.id))
      return { success: true }
    }),

  // 关联角色
  linkCharacters: publicQuery
    .input(z.object({
      tropeId: z.number(),
      characterIds: z.array(z.object({ id: z.number(), role: z.string().optional() })),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      await db.delete(tropeCharacterLinks).where(eq(tropeCharacterLinks.tropeId, input.tropeId))
      if (input.characterIds.length > 0) {
        await db.insert(tropeCharacterLinks).values(
          input.characterIds.map(c => ({
            tropeId: input.tropeId,
            characterId: c.id,
            role: c.role || null,
          }))
        )
      }
      return { success: true }
    }),

  // 关联正史事件
  linkCanonEvents: publicQuery
    .input(z.object({
      tropeId: z.number(),
      canonEventIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      await db.delete(tropeCanonLinks).where(eq(tropeCanonLinks.tropeId, input.tropeId))
      if (input.canonEventIds.length > 0) {
        await db.insert(tropeCanonLinks).values(
          input.canonEventIds.map(id => ({
            tropeId: input.tropeId,
            canonEventId: id,
          }))
        )
      }
      return { success: true }
    }),

  // 获取桥段详情（含关联角色和正史）
  getWithLinks: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [trope] = await db.select().from(plotTropes).where(eq(plotTropes.id, input.id))
      if (!trope) return null

      const charLinks = await db
        .select({
          characterId: tropeCharacterLinks.characterId,
          role: tropeCharacterLinks.role,
          name: characterCards.name,
        })
        .from(tropeCharacterLinks)
        .innerJoin(characterCards, eq(tropeCharacterLinks.characterId, characterCards.id))
        .where(eq(tropeCharacterLinks.tropeId, input.id))

      const canonLinks = await db
        .select({
          canonEventId: tropeCanonLinks.canonEventId,
          eventOrder: seriesCanon.eventOrder,
          description: seriesCanon.description,
        })
        .from(tropeCanonLinks)
        .innerJoin(seriesCanon, eq(tropeCanonLinks.canonEventId, seriesCanon.id))
        .where(eq(tropeCanonLinks.tropeId, input.id))

      return { trope, characters: charLinks, canonEvents: canonLinks }
    }),

  // 启动提取任务（后台异步）
  extract: publicQuery
    .input(
      z.object({
        seriesId: z.number(),
        materialIds: z.array(z.number()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()

      // 1. 获取全部素材内容
      let contents: string[] = []
      let sourceTitles: string[] = []
      let materialRows: Array<{ id: number; title: string; content: string; sourceType: string }> = []
      if (input.materialIds && input.materialIds.length > 0) {
        const { materials } = await import("@db/schema")
        const rows = await db
          .select({ id: materials.id, title: materials.title, content: materials.content, sourceType: materials.sourceType })
          .from(materials)
          .where(eq(materials.seriesId, input.seriesId))
        const filtered = rows.filter((r) => input.materialIds!.includes(r.id))
        materialRows = filtered
        contents = filtered.map((r) => `【${r.title}】\n${r.content}`)
        sourceTitles = filtered.map((r) => r.title)
      } else {
        const { vectorChunks } = await import("@db/schema")
        const rows = await db
          .select({ content: vectorChunks.content })
          .from(vectorChunks)
          .where(eq(vectorChunks.seriesId, input.seriesId))
        contents = rows
          .map((r) => r.content)
          .filter((c) => c && c.trim().length > 0)
        sourceTitles = ["RAG索引片段"]
      }

      if (contents.length === 0) {
        throw new Error("该系列暂无素材，请先上传并索引素材")
      }

      // 2. 分块（按素材边界分割，不切割单个素材）
      const CHUNK_TARGET = 8000
      const MAX_BATCHES = 5
      const chunks: string[][] = []
      let currentChunk: string[] = []
      let currentLen = 0

      for (const content of contents) {
        // 单条素材超过目标长度时，尽量找自然断点分割
        if (content.length > CHUNK_TARGET * 1.5) {
          // 先提交当前批次
          if (currentChunk.length > 0) {
            chunks.push(currentChunk)
            currentChunk = []
            currentLen = 0
          }
          // 按段落分割长素材
          const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
          let subChunk: string[] = []
          let subLen = 0
          for (const para of paragraphs) {
            if (subLen + para.length > CHUNK_TARGET && subChunk.length > 0) {
              chunks.push([subChunk.join("\n\n")])
              subChunk = []
              subLen = 0
            }
            subChunk.push(para)
            subLen += para.length
          }
          if (subChunk.length > 0) {
            chunks.push([subChunk.join("\n\n")])
          }
          continue
        }

        if (currentLen + content.length > CHUNK_TARGET && currentChunk.length > 0) {
          chunks.push(currentChunk)
          currentChunk = []
          currentLen = 0
        }
        currentChunk.push(content)
        currentLen += content.length
      }
      if (currentChunk.length > 0) {
        chunks.push(currentChunk)
      }

      // 限制最多 MAX_BATCHES 批，优先保留 reference_novel 和 knowledge_doc 素材
      let finalChunks = chunks
      if (chunks.length > MAX_BATCHES && materialRows.length > 0) {
        // 按素材类型排序：reference_novel > knowledge_doc > 其他
        const materialTypes = new Map(materialRows.map((r) => [r.id, r.sourceType]))

        const scored = chunks.map((chunk, idx) => {
          const typeScore = chunk.reduce((max, c) => {
            const match = c.match(/【(.+?)】/)
            if (!match) return max
            const title = match[1]
            for (const [id, type] of materialTypes) {
              if (title.includes(String(id))) {
                const score = type === "reference_novel" ? 3 : type === "knowledge_doc" ? 2 : 1
                return Math.max(max, score)
              }
            }
            return max
          }, 1)
          return { idx, score: typeScore, chunk }
        })
        scored.sort((a, b) => b.score - a.score)
        finalChunks = scored.slice(0, MAX_BATCHES).sort((a, b) => a.idx - b.idx).map(s => s.chunk)
      } else if (chunks.length > MAX_BATCHES) {
        finalChunks = chunks.slice(0, MAX_BATCHES)
      }

      // 3. 创建任务并启动后台提取
      const taskId = nextTaskId++
      extractionTasks.set(taskId, {
        status: "pending",
        progress: 0,
        totalBatches: finalChunks.length,
        completedBatches: 0,
        message: "任务已创建，准备开始...",
        createdAt: Date.now(),
        sourceTitles,
      })

      // 后台执行（不 await，mutation 立即返回）
      void runExtractionTask(taskId, input.seriesId, finalChunks, sourceTitles)

      return { taskId, totalBatches: finalChunks.length }
    }),

  // 查询提取任务状态
  extractStatus: publicQuery
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      const task = extractionTasks.get(input.taskId)
      if (!task) {
        return {
          status: "not_found" as const,
          progress: 0,
          message: "任务不存在或已过期",
          result: null,
          error: null,
        }
      }
      return {
        status: task.status,
        progress: task.progress,
        message: task.message,
        result: task.result
          ? { count: task.result.count }
          : null,
        error: task.error || null,
      }
    }),

  // 取消桥段提取任务
  extractCancel: publicQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input }) => {
      const task = extractionTasks.get(input.taskId)
      if (!task) {
        return { success: false, reason: "任务不存在或已过期" }
      }
      if (task.status === "completed" || task.status === "failed") {
        return { success: false, reason: "任务已结束，无法取消" }
      }
      task.status = "cancelled"
      return { success: true }
    }),

  // 热key桥段统计：根据用户历史生成记录统计高频使用的桥段
  hotkeys: publicQuery
    .input(z.object({
      seriesId: z.number(),
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => {
      const db = getDb()

      // 查询该系列下所有生成作品
      const works = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.seriesId, input.seriesId))

      // 统计每个桥段的使用次数
      const countMap = new Map<number, number>()
      for (const work of works) {
        const ids = (work.parameters as Record<string, unknown>)?.selectedTropeIds as number[] | undefined
        if (ids) {
          for (const id of ids) {
            countMap.set(id, (countMap.get(id) || 0) + 1)
          }
        }
      }

      if (countMap.size === 0) {
        return { hotkeys: [] }
      }

      // 按使用次数排序，取 Top N
      const sorted = Array.from(countMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, input.limit)

      const tropeIds = sorted.map(([id]) => id)
      const tropes = await db
        .select()
        .from(plotTropes)
        .where(inArray(plotTropes.id, tropeIds))

      const tropeMap = new Map(tropes.map(t => [t.id, t]))

      return {
        hotkeys: sorted.map(([id, count]) => ({
          ...(tropeMap.get(id)!),
          usageCount: count,
        })),
      }
    }),
})

/* ========== 后台提取逻辑 ========== */

async function runExtractionTask(
  taskId: number,
  seriesId: number,
  chunks: string[][],
  sourceTitles: string[]
) {
  const task = extractionTasks.get(taskId)
  if (!task) return

  const db = getDb()

  try {
    task.status = "processing"
    task.message = `开始分析，共 ${task.totalBatches} 批素材...`

    const allBatchTropes: Array<{
      name: string
      description: string
      pattern?: string
      examples: string[]
      tags: string[]
    }> = []

    // 第一轮：串行处理每批
    for (let i = 0; i < chunks.length; i++) {
      // 检查是否被取消
      if (extractionTasks.get(taskId)?.status === "cancelled") {
        console.log(`[TropeExtract] task ${taskId} cancelled at batch ${i + 1}`)
        break
      }
      task.message = `正在分析第 ${i + 1}/${task.totalBatches} 批素材...`
      task.completedBatches = i

      const { system, user } = buildBatchPrompt(chunks[i], i, chunks.length)

      let batchResult: ReturnType<typeof parseTropeJson> = []
      let attempts = 0
      const maxAttempts = 2

      while (attempts < maxAttempts && batchResult.length === 0) {
        try {
          const result = await chatCompletion({
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: attempts === 0 ? 0.4 : 0.5,
            maxTokens: 4000,
          })
          console.log(`[TropeExtract] Batch ${i + 1} attempt ${attempts + 1} raw response length:`, result.content.length)
          batchResult = parseTropeJson(result.content)
          console.log(`[TropeExtract] Batch ${i + 1} attempt ${attempts + 1} parsed tropes:`, batchResult.length)
        } catch (err) {
          console.error(`[TropeExtract] Batch ${i + 1} attempt ${attempts + 1} failed:`, err)
        }
        attempts++
      }

      allBatchTropes.push(...batchResult)

      task.progress = Math.round(
        ((i + 1) / chunks.length) * (chunks.length > 1 ? 50 : 80)
      )
    }

    // 检查是否被取消（第一批处理完后）
    if (extractionTasks.get(taskId)?.status === "cancelled") {
      task.progress = 100
      task.message = "任务已取消"
      return
    }

    if (allBatchTropes.length === 0) {
      task.status = "completed"
      task.progress = 100
      task.message = "提取完成，未在素材中发现桥段"
      task.result = { tropes: [], count: 0 }
      return
    }

    // 检查是否被取消（多批合并前）
    if (extractionTasks.get(taskId)?.status === "cancelled") {
      task.progress = 100
      task.message = "任务已取消"
      return
    }

    // 第二轮：汇总合并（只在多批时执行）
    let finalTropes = allBatchTropes
    if (chunks.length > 1) {
      task.message = "正在汇总合并跨文本相似桥段..."
      task.progress = 60

      const tropesJson = JSON.stringify({ rawTropes: allBatchTropes }, null, 2)
      const truncatedTropesJson =
        tropesJson.length > 12000
          ? tropesJson.slice(0, 12000) + "\n\n[后续桥段已截断...]"
          : tropesJson

      const { system: mergeSystem, user: mergeUser } =
        buildMergePrompt(truncatedTropesJson)

      try {
        const mergeResult = await chatCompletion({
          messages: [
            { role: "system", content: mergeSystem },
            { role: "user", content: mergeUser },
          ],
          temperature: 0.3,
          maxTokens: 4000,
        })
        console.log(`[TropeExtract] Merge raw response length:`, mergeResult.content.length)
        finalTropes = parseTropeJson(mergeResult.content)
        console.log(`[TropeExtract] Merge parsed tropes:`, finalTropes.length)
      } catch (err) {
        console.error("[TropeExtract] Merge failed, using batch results:", err)
      }

      task.progress = 80
    }

    // 质量过滤：要求至少 2 个不同素材佐证，或单素材中出现 ≥2 次
    task.message = "正在过滤低质量桥段..."
    task.progress = 85

    const evidenceCount = new Map<string, number>()
    for (const t of finalTropes) {
      for (const _ of t.examples || []) {
        const key = t.name
        evidenceCount.set(key, (evidenceCount.get(key) || 0) + 1)
      }
    }

    const filteredTropes = finalTropes.filter(t => {
      const count = evidenceCount.get(t.name) || 0
      // 至少 2 个 examples，或 description 长度 > 50 字
      return count >= 2 || (t.description || "").length > 50
    })

    console.log(`[TropeExtract] Quality filter: ${finalTropes.length} -> ${filteredTropes.length} tropes`)

    // 保存到数据库
    task.message = "正在保存结果..."
    task.progress = 90

    const created: (typeof plotTropes.$inferSelect)[] = []
    for (const t of filteredTropes) {
      try {
        const [trope] = await db
          .insert(plotTropes)
          .values({
            seriesId,
            name: t.name,
            description: t.description,
            pattern: t.pattern || null,
            examples: t.examples as unknown as Record<string, unknown>[],
            tags: t.tags as unknown as Record<string, unknown>[],
            sourceChunks: sourceTitles.map(title => ({ title, type: "material" })) as unknown as Record<string, unknown>[],
          })
          .returning()
        created.push(trope)
      } catch (err) {
        console.error("[TropeExtract] Failed to save trope:", t.name, err)
      }
    }

    task.status = "completed"
    task.progress = 100
    task.message = `提取完成，共发现 ${created.length} 个桥段`
    task.result = { tropes: created, count: created.length }
  } catch (err) {
    task.status = "failed"
    task.error = String(err)
    task.message = "提取失败: " + String(err)
    console.error("[TropeExtract] Extraction task failed:", err)
  }
}

/* ========== Prompt 构建 ========== */

function buildBatchPrompt(
  batchTexts: string[],
  batchIndex: number,
  totalBatches: number
) {
  const combined = batchTexts.join("\n\n---\n\n")
  const system = `你是一位资深的故事结构分析师和桥段（trope）研究专家。
这是第 ${batchIndex + 1} / ${totalBatches} 批素材。你的任务是从这批素材中提取典型的相似桥段。

分析原则：
1. 识别反复出现的情节模式、场景套路、情感转折点、角色互动模式
2. 每个桥段应该具有可复用性——即作者可以在新的故事中借鉴这个桥段
3. 桥段名称要简洁有力（4-8字），描述要包含触发条件、发展、高潮、结果
4. 同一批素材中相似的桥段变体请合并为一个
5. 只提取这批素材中确实存在的桥段，不要编造
6. 每个桥段附带 1-3 个这批素材中的具体原文片段作为佐证
7. 注意：这只是全部素材的一部分，你可能会看到不完整的桥段，请如实提取你看到的部分

返回严格的 JSON 格式：`

  const user = `请从以下第 ${batchIndex + 1} / ${totalBatches} 批素材中提取桥段：

${combined}

请返回 JSON：
{\n  "tropes": [\n    {\n      "name": "桥段名称",\n      "description": "详细描述模式、触发条件、典型结果",\n      "pattern": "触发条件 → 发展 → 高潮 → 结果",\n      "examples": ["素材中的原文片段1", "片段2"],\n      "tags": ["标签1", "标签2"]\n    }\n  ]\n}\n\n注意：若这批素材中无足够桥段可提取，返回 {"tropes": []}`

  return { system, user }
}

function buildMergePrompt(tropesJson: string) {
  const system = `你是一位跨文本桥段分析专家。你收到了多批素材中提取的桥段列表（这些桥段来自同一世界观下的不同小说/章节）。

你的核心任务是：
1. 跨文本相似性识别：找出在不同素材中被反复提取的相似桥段，判断它们是否是同一个桥段模式
2. 合并去重：将多个批次中描述的同一桥段合并为一个统一的、精炼的桥段定义
3. 变体标注：如果同一桥段在不同素材中有不同的表现形式，请在描述中标注这些变体
4. 丰富佐证：合并所有批次的 examples，保留最有代表性的 2-4 个来自不同素材的原文片段
5. 统一命名：为每个桥段起一个最贴切的中文名称（4-8字）
6. 精简数量：如果某桥段只在某一批出现、且无法确认其普遍性，可以丢弃

输出要求：
- 最终只保留最具代表性、跨文本反复出现的桥段
- 每个桥段的 description 要足够详细，让作者能直接参考这个桥段来创作新故事
- pattern 字段用箭头表示流程
- tags 标注该桥段的类型（如：战斗、情感、转折、成长、揭秘等）

返回严格 JSON 格式：`

  const user = `以下是多批素材中提取的桥段列表，请进行跨文本汇总合并：

${tropesJson}

请返回 JSON：
{\n  "tropes": [\n    {\n      "name": "桥段名称",\n      "description": "精炼的描述（跨文本验证后的统一定义）",\n      "pattern": "触发条件 → 发展 → 高潮 → 结果",\n      "examples": ["来自素材A的片段", "来自素材B的片段"],\n      "tags": ["标签1", "标签2"]\n    }\n  ]\n}\n\n注意：合并后若总数过多（超过15个），请只保留最具代表性的桥段；若太少则如实返回。`

  return { system, user }
}

/* ========== JSON 解析辅助 ========== */

function parseTropeJson(
  response: string
): Array<{
  name: string
  description: string
  pattern?: string
  examples: string[]
  tags: string[]
}> {
  let jsonText = response.trim()

  // 优先提取 code block
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim()
  }

  // 去掉 markdown 列表前缀等干扰字符
  jsonText = jsonText.replace(/^[\s]*[-*]\s+/gm, "")

  // 修复常见 JSON 格式问题：多余的逗号
  jsonText = jsonText.replace(/,(\s*[}\]])/g, "$1")

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    // 尝试匹配最外层的大括号
    const braceMatch = jsonText.match(/\{[\s\S]*\}/)
    if (braceMatch) {
      try {
        parsed = JSON.parse(braceMatch[0])
      } catch {
        console.error("[TropeExtract] Failed to parse JSON, raw:", jsonText.slice(0, 500))
        return []
      }
    } else {
      console.error("[TropeExtract] No JSON object found in response:", jsonText.slice(0, 500))
      return []
    }
  }

  // 宽松的 Zod schema：AI 可能返回不规范的 JSON
  const resultSchema = z.object({
    tropes: z
      .array(
        z.object({
          name: z.string().min(1).catch("未命名桥段"),
          description: z.union([z.string(), z.null()]).optional().catch(""),
          pattern: z.union([z.string(), z.null()]).optional().catch(undefined),
          examples: z
            .union([
              z.array(z.union([z.string(), z.null()])).transform((arr) =>
                arr.filter((s): s is string => s !== null)
              ),
              z.string().transform((s) => [s]),
            ])
            .default([]),
          tags: z
            .union([
              z.array(z.union([z.string(), z.null()])).transform((arr) =>
                arr.filter((s): s is string => s !== null)
              ),
              z.string().transform((s) => [s]),
            ])
            .default([]),
        })
      )
      .default([]),
  })

  try {
    const validated = resultSchema.parse(parsed)
    return validated.tropes.map((t) => ({
      name: t.name,
      description: t.description || "",
      pattern: t.pattern || undefined,
      examples: t.examples,
      tags: t.tags,
    }))
  } catch (err) {
    console.error("[TropeExtract] Zod validation failed:", err)
    // 最后一招：尝试直接遍历 parsed 对象
    if (parsed && typeof parsed === "object" && "tropes" in parsed) {
      const rawTropes = (parsed as Record<string, unknown>).tropes
      if (Array.isArray(rawTropes)) {
        return rawTropes
          .filter(
            (t): t is Record<string, unknown> =>
              t && typeof t === "object" && "name" in t && typeof t.name === "string"
          )
          .map((t) => ({
            name: String(t.name),
            description: String(t.description || ""),
            pattern: t.pattern ? String(t.pattern) : undefined,
            examples: Array.isArray(t.examples)
              ? t.examples.filter((e): e is string => typeof e === "string")
              : typeof t.examples === "string"
                ? [t.examples]
                : [],
            tags: Array.isArray(t.tags)
              ? t.tags.filter((e): e is string => typeof e === "string")
              : typeof t.tags === "string"
                ? [t.tags]
                : [],
          }))
      }
    }
    return []
  }
}
