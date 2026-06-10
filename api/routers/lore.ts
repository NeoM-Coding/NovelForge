import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { series, characterCards, worldBibles, seriesCanon, materials, plotTropes } from "@db/schema"
import { eq, asc, inArray, sql, and } from "drizzle-orm"
import { chatCompletion } from "../services/deepseek"
import { findDuplicateGroups, recommendKeepId, findDuplicateAspectGroups, mergeDuplicateAspects } from "../lib/dedup-utils"

export const loreRouter = createRouter({
  // Series
  series: createRouter({
    list: publicQuery.query(async () => {
      const db = getDb()
      return db.select().from(series).orderBy(series.createdAt)
    }),

    create: publicQuery
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        universeName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const [s] = await db.insert(series).values(input).returning()
        return s
      }),

    update: publicQuery
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        universeName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const { id, ...data } = input
        const [s] = await db.update(series).set(data).where(eq(series.id, id)).returning()
        return s
      }),

    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb()
        await db.delete(series).where(eq(series.id, input.id))
        return { success: true }
      }),

    summary: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()

        const charRows = await db
          .select({ count: sql<number>`count(*)` })
          .from(characterCards)
          .where(eq(characterCards.seriesId, input.seriesId))

        const [wb] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, input.seriesId))
        const wbAspectCount = ((wb?.aspects || []) as Array<unknown>).length

        const canonRows = await db
          .select({ count: sql<number>`count(*)` })
          .from(seriesCanon)
          .where(eq(seriesCanon.seriesId, input.seriesId))

        const tropeRows = await db
          .select({ count: sql<number>`count(*)` })
          .from(plotTropes)
          .where(eq(plotTropes.seriesId, input.seriesId))

        const materialRows = await db
          .select({ count: sql<number>`count(*)` })
          .from(materials)
          .where(eq(materials.seriesId, input.seriesId))

        return {
          characterCount: Number(charRows[0]?.count ?? 0),
          worldBibleAspectCount: wbAspectCount,
          canonEventCount: Number(canonRows[0]?.count ?? 0),
          tropeCount: Number(tropeRows[0]?.count ?? 0),
          materialCount: Number(materialRows[0]?.count ?? 0),
        }
      }),
  }),

  // Characters
  character: createRouter({
    list: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()
        return db
          .select()
          .from(characterCards)
          .where(eq(characterCards.seriesId, input.seriesId))
      }),

    create: publicQuery
      .input(z.object({
        seriesId: z.number(),
        name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        age: z.string().optional(),
        appearanceTags: z.array(z.string()).default([]),
        personalityTraits: z.array(z.string()).default([]),
        coreMotivations: z.string().optional(),
        relationships: z.record(z.any()).default({}),
        speechPatterns: z.string().optional(),
        taboos: z.array(z.string()).default([]),
        canonicalArcSummary: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const [char] = await db.insert(characterCards).values(input).returning()
        return char
      }),

    update: publicQuery
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        age: z.string().optional(),
        appearanceTags: z.array(z.string()).optional(),
        personalityTraits: z.array(z.string()).optional(),
        coreMotivations: z.string().optional(),
        relationships: z.record(z.any()).optional(),
        speechPatterns: z.string().optional(),
        taboos: z.array(z.string()).optional(),
        canonicalArcSummary: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const { id, ...data } = input
        const [char] = await db
          .update(characterCards)
          .set(data)
          .where(eq(characterCards.id, id))
          .returning()
        return char
      }),

    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb()
        await db.delete(characterCards).where(eq(characterCards.id, input.id))
        return { success: true }
      }),

    // 风格自动提炼：从该角色的风格样本中提炼语言风格画像
    extractStyleProfile: publicQuery
      .input(z.object({
        seriesId: z.number(),
        characterName: z.string(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()

        // 1. 获取该角色的所有风格样本
        const styleSamples = await db
          .select()
          .from(materials)
          .where(
            and(
              eq(materials.seriesId, input.seriesId),
              eq(materials.sourceType, "style_sample"),
              sql`${materials.tags}::jsonb @> ${JSON.stringify([input.characterName])}::jsonb`
            )
          )

        if (styleSamples.length < 3) {
          throw new Error(`风格样本不足（当前 ${styleSamples.length} 条，需要至少 3 条）。请在 Studio 中生成内容并保存为该角色的风格样本。`)
        }

        // 2. 用 AI 提炼风格特征
        const combined = styleSamples.map(s => s.content.slice(0, 300)).join("\n---\n")
        const prompt = `分析以下 "${input.characterName}" 的风格样本，提炼其语言风格特征：

${combined}

请返回以下 JSON 格式（不要包含 markdown 代码块标记，只返回纯 JSON）：
{
  "vocabulary": ["高频用词1", "高频用词2"],
  "sentencePatterns": ["句式特点1"],
  "emotionalTone": "情感基调描述",
  "dialogueStyle": "对话风格描述",
  "narrativeHabits": "叙事习惯描述"
}`

        const result = await chatCompletion({
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          maxTokens: 2000,
        })

        // 3. 解析并更新角色卡
        let profile: Record<string, unknown>
        try {
          // 尝试提取 JSON（AI 可能包裹在 markdown 代码块中）
          const jsonMatch = result.content.match(/\{[\s\S]*\}/)
          profile = JSON.parse(jsonMatch ? jsonMatch[0] : result.content)
        } catch {
          throw new Error("AI 返回的风格分析无法解析为有效 JSON")
        }

        // 找到该角色
        const chars = await db
          .select()
          .from(characterCards)
          .where(and(eq(characterCards.seriesId, input.seriesId), eq(characterCards.name, input.characterName)))

        if (chars.length === 0) throw new Error("角色不存在")

        await db.update(characterCards)
          .set({ speechPatterns: JSON.stringify(profile) })
          .where(eq(characterCards.id, chars[0].id))

        return profile
      }),

    // 检测系列中的重复角色（精确匹配 + 子串匹配 + 编辑距离模糊匹配）
    findDuplicates: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()
        const chars = await db
          .select()
          .from(characterCards)
          .where(eq(characterCards.seriesId, input.seriesId))

        const charRefs = chars.map(c => ({
          id: c.id,
          name: c.name,
          aliases: (c.aliases as string[] || []).filter(Boolean),
        }))

        const groups = findDuplicateGroups(charRefs)

        // 为每组推荐保留的角色（字段最全者）
        const groupsWithRecommend = groups.map(g => ({
          ...g,
          recommendedKeepId: recommendKeepId(g.ids, chars),
        }))

        return {
          groups: groupsWithRecommend,
          totalCharacters: chars.length,
          duplicateCount: groups.length,
        }
      }),

    // 合并多个重复角色到保留的角色（智能字段合并）
    merge: publicQuery
      .input(z.object({
        keepId: z.number(),
        mergeIds: z.array(z.number()).min(1),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()

        const [keep] = await db.select().from(characterCards).where(eq(characterCards.id, input.keepId))
        if (!keep) throw new Error("保留的角色不存在")

        const victims = await db
          .select()
          .from(characterCards)
          .where(inArray(characterCards.id, input.mergeIds))

        if (victims.length === 0) throw new Error("没有可合并的角色")

        const mergedAliases = new Set([keep.name, ...(keep.aliases as string[] || []), ...(victims.flatMap(v => [v.name, ...(v.aliases as string[] || [])]))].filter(Boolean).map(n => String(n).trim()))
        mergedAliases.delete(keep.name)

        const mergedTraits = [...new Set([...(keep.personalityTraits as string[] || []), ...victims.flatMap(v => v.personalityTraits as string[] || [])])]
        const mergedTaboos = [...new Set([...(keep.taboos as string[] || []), ...victims.flatMap(v => v.taboos as string[] || [])])]
        const mergedAppearance = [...new Set([...(keep.appearanceTags as string[] || []), ...victims.flatMap(v => v.appearanceTags as string[] || [])])]

        const mergedRelationships: Record<string, unknown> = { ...(keep.relationships as Record<string, unknown> || {}) }
        for (const v of victims) {
          Object.assign(mergedRelationships, v.relationships as Record<string, unknown> || {})
        }

        // 智能选择字段：保留字段最全的，而非机械地用 keep 的字段
        const allChars = [keep, ...victims]
        const bestAge = allChars.find(c => c.age)?.age || null
        const bestCoreMotivations = allChars.find(c => c.coreMotivations)?.coreMotivations || null
        const bestSpeechPatterns = allChars.find(c => c.speechPatterns)?.speechPatterns || null
        const bestCanonicalArcSummary = allChars.find(c => c.canonicalArcSummary)?.canonicalArcSummary || null

        const [updated] = await db.update(characterCards)
          .set({
            aliases: [...mergedAliases] as unknown as Record<string, unknown>[],
            personalityTraits: mergedTraits as unknown as Record<string, unknown>[],
            taboos: mergedTaboos as unknown as Record<string, unknown>[],
            appearanceTags: mergedAppearance as unknown as Record<string, unknown>[],
            relationships: mergedRelationships as unknown as Record<string, unknown>,
            age: bestAge,
            coreMotivations: bestCoreMotivations,
            speechPatterns: bestSpeechPatterns,
            canonicalArcSummary: bestCanonicalArcSummary,
            updatedAt: new Date(),
          })
          .where(eq(characterCards.id, keep.id))
          .returning()

        await db.delete(characterCards).where(inArray(characterCards.id, input.mergeIds))

        return {
          keepId: keep.id,
          keepName: keep.name,
          mergedCount: victims.length,
          mergedAliases: [...mergedAliases],
          updatedCharacter: updated,
        }
      }),
  }),

  // World Bible
  worldBible: createRouter({
    get: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()
        const [wb] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, input.seriesId))
        return wb || null
      }),

    createOrUpdate: publicQuery
      .input(z.object({
        seriesId: z.number(),
        geography: z.string().optional(),
        magicSystem: z.string().optional(),
        technologyLevel: z.string().optional(),
        factions: z.array(z.any()).optional(),
        timelineEvents: z.array(z.any()).optional(),
        culturalCustoms: z.string().optional(),
        linguisticNotes: z.string().optional(),
        aspects: z.array(z.object({
          id: z.string(),
          name: z.string(),
          content: z.string(),
        })).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const { seriesId, ...data } = input

        const [existing] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, seriesId))

        if (existing) {
          const [wb] = await db
            .update(worldBibles)
            .set(data)
            .where(eq(worldBibles.id, existing.id))
            .returning()
          return wb
        } else {
          const [wb] = await db
            .insert(worldBibles)
            .values({ seriesId, ...data })
            .returning()
          return wb
        }
      }),

      reorderAspects: publicQuery
      .input(z.object({
        seriesId: z.number(),
        aspects: z.array(z.object({
          id: z.string(),
          name: z.string(),
          content: z.string(),
        })),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const [existing] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, input.seriesId))
        if (!existing) throw new Error("世界观不存在")
        const [wb] = await db
          .update(worldBibles)
          .set({ aspects: input.aspects as unknown as Record<string, unknown>[] })
          .where(eq(worldBibles.id, existing.id))
          .returning()
        return wb
      }),

    // 从素材中提取世界观
    extract: publicQuery
      .input(z.object({
        seriesId: z.number(),
        materialIds: z.array(z.number()).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()

        // 1. 获取素材内容
        let matRows: Array<typeof materials.$inferSelect> = []
        if (input.materialIds && input.materialIds.length > 0) {
          matRows = await db
            .select()
            .from(materials)
            .where(inArray(materials.id, input.materialIds))
        } else {
          matRows = await db
            .select()
            .from(materials)
            .where(eq(materials.seriesId, input.seriesId))
        }

        if (matRows.length === 0) {
          throw new Error("该系列暂无素材，请先上传素材")
        }

        // 2. 拼接素材（截断到约 15000 字符以留足 prompt 空间）
        const combined = matRows.map(m => `【${m.title}】\n${m.content}`).join("\n\n---\n\n")
        const truncated = combined.length > 15000 ? combined.slice(0, 15000) + "\n\n[素材已截断...]" : combined

        const systemPrompt = `你是一位资深的世界观分析专家。你的任务是从提供的素材中，自然地发现并提取这个世界观的设定。

【核心原则 — 严格禁止硬凑】
1. 不要套用固定模板。从素材中"自然发现"值得记录的维度——每个世界的设定重点都不同。
2. 维度名称用中文，要具体、贴切。比如"斗气体系"比"力量体系"更好。
3. **只提取素材中明确提及的内容，绝对不要脑补。**
4. **如果某个维度在素材中没有相关内容，直接不返回这个维度。**不要返回空内容或"素材未提及"来占位。
5. 每个世界值得记录的维度数量差异很大：有的世界可能只有 2-3 个核心维度，有的可能有 10 个以上。**严禁为了让列表"看起来完整"而硬凑维度。**
6. 如果某个维度在素材中只有零星提及，可以标注"素材提及较少"。

以下是一些常见的世界观维度启发（**仅供参考，不要求全部覆盖**，根据素材实际内容灵活选择，没有相关内容的维度直接跳过）：
- 地理环境：大陆板块、气候带、标志性地点
- 力量体系：修炼方式、等级划分、能量来源
- 社会结构：阶级制度、法律体系、经济系统
- 文化习俗：节日庆典、饮食习惯、婚丧嫁娶、审美标准
- 科技/文明水平：交通工具、通讯方式、医疗水平、建筑技术
- 种族/物种：人类、异族、魔兽、灵植等及其特性
- 宗教/信仰：神明体系、教派组织、祭祀仪式
- 历史沿革：王朝更迭、重大战争、灾难事件
- 语言/文字：通用语、古语、符文系统、命名规则
- 教育/传承：学院制度、师徒体系、秘籍传承
- 商业/贸易：货币系统、商会组织、特产资源
- 军事/战争：军队编制、战略战术、著名战役
- 艺术/娱乐：音乐、绘画、戏剧、赌博等
- 日常生活：服饰风格、饮食习惯、居住形态

必须返回严格的 JSON 格式，不要包含 markdown 代码块标记。`

        const userPrompt = `请从以下素材中提取世界观设定。

【再次强调】
- 只提取素材中**明确出现**的内容
- **没有相关内容的维度直接跳过，不要硬凑**
- 返回的 aspects 数量由素材内容决定，可以是 0 个也可以是 10 个

${truncated}

请返回以下 JSON 格式：
{
  "aspects": [
    { "name": "维度名称", "content": "详细描述" }
  ],
  "factions": [{"name": "势力名", "description": "描述"}],
  "timelineEvents": [{"order": 1, "description": "事件描述"}]
}`

        const result = await chatCompletion({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          maxTokens: 4000,
        })

        let jsonText = result.content.trim()
        const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1].trim()
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(jsonText)
        } catch {
          const braceMatch = jsonText.match(/\{[\s\S]*\}/)
          if (braceMatch) {
            parsed = JSON.parse(braceMatch[0])
          } else {
            throw new Error("AI 返回的内容无法解析为 JSON")
          }
        }

        const resultSchema = z.object({
          aspects: z.array(z.object({
            name: z.string(),
            content: z.string(),
          })).default([]),
          factions: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
          timelineEvents: z.array(z.object({ order: z.number(), description: z.string() })).default([]),
        })

        const validated = resultSchema.parse(parsed)
        // 为每个 aspect 生成唯一 id
        const aspectsWithId = validated.aspects.map((a, i) => ({
          id: `aspect_${Date.now()}_${i}`,
          name: a.name,
          content: a.content,
        }))

        // 对提取的 aspects 做去重合并（防止 AI 返回同名/近似维度）
        const dupGroups = findDuplicateAspectGroups(aspectsWithId)
        const dedupedAspects = dupGroups.length > 0
          ? mergeDuplicateAspects(aspectsWithId, dupGroups)
          : aspectsWithId

        return {
          aspects: dedupedAspects,
          factions: validated.factions,
          timelineEvents: validated.timelineEvents,
        }
      }),

    // 检测世界观中的重复维度
    findDuplicateAspects: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()
        const [wb] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, input.seriesId))

        if (!wb) return { groups: [], totalAspects: 0 }

        const aspects = (wb.aspects || []) as Array<{ id: string; name: string; content: string }>
        const groups = findDuplicateAspectGroups(aspects)

        return {
          groups,
          totalAspects: aspects.length,
          duplicateCount: groups.length,
        }
      }),

    // 合并世界观中的重复维度
    mergeAspects: publicQuery
      .input(z.object({
        seriesId: z.number(),
        groupIds: z.array(z.string()).min(1),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const [wb] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, input.seriesId))

        if (!wb) throw new Error("世界观不存在")

        const aspects = (wb.aspects || []) as Array<{ id: string; name: string; content: string }>
        const allGroups = findDuplicateAspectGroups(aspects)
        const targetGroups = allGroups.filter(g =>
          input.groupIds.some(targetId => g.ids.includes(targetId))
        )

        if (targetGroups.length === 0) throw new Error("未找到指定的重复维度组")

        const merged = mergeDuplicateAspects(aspects, targetGroups)

        const [updated] = await db
          .update(worldBibles)
          .set({
            aspects: merged as unknown as Record<string, unknown>[],
            updatedAt: new Date(),
          })
          .where(eq(worldBibles.id, wb.id))
          .returning()

        return {
          mergedCount: targetGroups.reduce((sum, g) => sum + g.ids.length - 1, 0),
          remainingAspects: merged.length,
          updated,
        }
      }),
  }),

  // 从角色卡总结世界观
  summarizeWorld: publicQuery
    .input(z.object({
      characterIds: z.array(z.number()).min(1),
      seriesId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const chars = await db
        .select()
        .from(characterCards)
        .where(inArray(characterCards.id, input.characterIds))

      if (chars.length === 0) throw new Error("未找到角色")

      const [seriesInfo] = await db
        .select()
        .from(series)
        .where(eq(series.id, input.seriesId))

      const characterDescriptions = chars.map(c => {
        const parts: string[] = []
        parts.push(`姓名: ${c.name}`)
        if (c.aliases && (c.aliases as string[]).length > 0) parts.push(`别名: ${(c.aliases as string[]).join(", ")}`)
        if (c.age) parts.push(`年龄: ${c.age}`)
        if (c.appearanceTags && (c.appearanceTags as string[]).length > 0) parts.push(`外貌: ${(c.appearanceTags as string[]).join(", ")}`)
        if (c.personalityTraits && (c.personalityTraits as string[]).length > 0) parts.push(`性格: ${(c.personalityTraits as string[]).join(", ")}`)
        if (c.coreMotivations) parts.push(`核心动机: ${c.coreMotivations}`)
        if (c.speechPatterns) parts.push(`语言风格: ${c.speechPatterns}`)
        if (c.taboos && (c.taboos as string[]).length > 0) parts.push(`禁忌: ${(c.taboos as string[]).join(", ")}`)
        if (c.canonicalArcSummary) parts.push(`故事线: ${c.canonicalArcSummary}`)
        if (c.relationships && Object.keys(c.relationships as Record<string, unknown>).length > 0) {
          parts.push(`人际关系: ${JSON.stringify(c.relationships)}`)
        }
        return parts.join("\n")
      }).join("\n\n---\n\n")

      const systemPrompt = `你是一位资深的世界观架构师。你的任务是根据提供的角色卡信息，反向推导并总结出完整的世界观设定。

请从以下维度进行推理：
1. 地理环境：根据角色的活动范围、出身地、旅行路线等推断世界地理
2. 力量体系：根据角色的能力、修炼方式、战斗风格等推断力量/魔法体系
3. 科技水平：根据角色使用的工具、交通方式、生活方式等推断科技/文明水平
4. 文化习俗：根据角色的礼仪、节日、饮食习惯、婚丧嫁娶等推断文化
5. 语言/命名规则：根据角色姓名、地名、术语等推断语言体系
6. 派系势力：根据角色的归属、敌对关系、阵营等推断主要势力
7. 时间线事件：根据角色的经历推断世界历史上的重大事件

必须返回严格的 JSON 格式，不要包含 markdown 代码块标记。`

      const userPrompt = `请根据以下角色卡信息总结世界观设定：

系列名称: ${seriesInfo?.name || "未知系列"}
世界观名: ${seriesInfo?.universeName || ""}

角色卡信息：
${characterDescriptions}

请返回以下 JSON 格式：
{
  "geography": "地理环境描述",
  "magicSystem": "力量体系描述",
  "technologyLevel": "科技水平描述",
  "culturalCustoms": "文化习俗描述",
  "linguisticNotes": "语言/命名规则描述",
  "factions": [{"name": "派系名", "description": "描述"}],
  "timelineEvents": [{"order": 1, "description": "事件描述"}]
`

      const result = await chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        maxTokens: 4000,
      })

      let jsonText = result.content.trim()
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim()
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        const braceMatch = jsonText.match(/\{[\s\S]*\}/)
        if (braceMatch) {
          parsed = JSON.parse(braceMatch[0])
        } else {
          throw new Error("AI 返回的内容无法解析为 JSON")
        }
      }

      const resultSchema = z.object({
        geography: z.string().optional(),
        magicSystem: z.string().optional(),
        technologyLevel: z.string().optional(),
        culturalCustoms: z.string().optional(),
        linguisticNotes: z.string().optional(),
        factions: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
        timelineEvents: z.array(z.object({ order: z.number(), description: z.string() })).default([]),
      })

      const validated = resultSchema.parse(parsed)
      return validated
    }),

  // Canon
  canon: createRouter({
    list: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()
        return db
          .select()
          .from(seriesCanon)
          .where(eq(seriesCanon.seriesId, input.seriesId))
          .orderBy(asc(seriesCanon.eventOrder))
      }),

    create: publicQuery
      .input(z.object({
        seriesId: z.number(),
        eventOrder: z.number(),
        description: z.string().min(1),
        isImmutable: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const [canon] = await db.insert(seriesCanon).values(input).returning()
        return canon
      }),

    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb()
        await db.delete(seriesCanon).where(eq(seriesCanon.id, input.id))
        return { success: true }
      }),

    reorder: publicQuery
      .input(z.object({
        seriesId: z.number(),
        orderedIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        for (let i = 0; i < input.orderedIds.length; i++) {
          await db
            .update(seriesCanon)
            .set({ eventOrder: i + 1 })
            .where(eq(seriesCanon.id, input.orderedIds[i]))
        }
        return { success: true }
      }),
  }),
})
