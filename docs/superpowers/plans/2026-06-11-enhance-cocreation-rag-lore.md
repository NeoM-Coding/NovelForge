# 增强二创效果 — RAG、素材库、设定库优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 RAG 语义摘要优化、Translation Memory 激活、素材热度追踪、设定库精准注入四大方向，系统性提升二创生成的内容质量、Token 效率和可观测性。

**Architecture:** 在现有 Hybrid RAG  pipeline（向量+pg_trgm+全文）基础上，增加"要点提取式"AI 摘要替代简单拼接，激活闲置的 translation_memory 为二创提供风格句对，建立素材命中追踪闭环，并按 Brief 语义动态筛选最相关的角色和世界观维度注入 prompt。

**Tech Stack:** PostgreSQL 16 + pgvector/pg_trgm, Drizzle ORM, DeepSeek API, React 19 + tRPC 11

---

## 文件结构映射

| 文件 | 职责 |
|------|------|
| `api/routers/generate.ts` | 核心：修改 `summarizeRagChunks`、新增 `findTranslationMemoryPairs`、修改 `buildBaseContext` 和 `buildSystemPrompt` |
| `api/routers/material.ts` | 新增素材热度查询 API |
| `api/routers/rag.ts` | 新增 RAG 命中记录写入 |
| `db/schema.ts` | 新增 `materialAnalytics` 表 |
| `db/relations.ts` | 新增 `materialAnalytics` 关系 |
| `src/pages/MaterialPool.tsx` | 前端：展示素材热度徽章 |
| `contracts/schemas.ts` | 新增 `materialAnalytics` 相关 Zod schema |

---

## Phase 1: RAG 真语义摘要（本周）

### Task 1: 重写 `summarizeRagChunks` 为要点提取式摘要

**Files:**
- Modify: `api/routers/generate.ts:774-801`

**背景：** 当前 `summarizeRagChunks` 只是让 AI 把 chunks 拼接成一段连贯文本，本质上仍然是全文搬运，占用 500-1500 Token。优化后改为"要点提取式"，只保留与 Brief 最相关的创作要点。

- [ ] **Step 1: 修改 `summarizeRagChunks` 函数签名，增加 `brief` 参数**

```typescript
// 旧签名
async function summarizeRagChunks(chunks: RagCall[]): Promise<string | null>

// 新签名
async function summarizeRagChunks(chunks: RagCall[], brief: string): Promise<string | null>
```

- [ ] **Step 2: 重写摘要逻辑**

将 `generate.ts` 中 `summarizeRagChunks` 函数（line 775-801）替换为：

```typescript
// RAG 检索结果 AI 摘要：提炼与 Brief 相关的创作要点
async function summarizeRagChunks(chunks: RagCall[], brief: string): Promise<string | null> {
  if (chunks.length === 0) return null

  const summaryPrompt = `你是一位创作素材筛选专家。用户要写的内容是：「${brief.slice(0, 200)}」

请从以下检索到的素材片段中，提取对本次创作最有价值的要点。

【提取规则】
1. 只保留与用户创作方向直接相关的要点，无关内容直接丢弃
2. 去除重复或高度相似的信息
3. 不同片段对同一设定有矛盾时，优先保留最详细的那条
4. 每个要点用一句话概括，保留原文的关键细节和用词风格
5. 最多提取 8 条要点，总字数控制在 300 字以内
6. 如果某片段与用户创作方向完全无关，直接忽略

参考片段：
${chunks.map((c, i) => `【片段 ${i + 1}】${c.content.slice(0, 400)}`).join("\n\n")}`

  try {
    const result = await chatCompletion({
      messages: [{ role: "user", content: summaryPrompt }],
      temperature: 0.3,
      maxTokens: 1200,
    })
    const trimmed = result.content.trim()
    // 如果摘要结果过短，视为失败，回退到原始 chunks 拼接
    if (trimmed.length < 30) return null
    return trimmed
  } catch {
    return null
  }
}
```

- [ ] **Step 3: 修改调用方，传入 `brief`**

在 `generate.ts` line 536 处，将调用改为：

```typescript
const ragSummary = await summarizeRagChunks(ragCalls, brief)
```

- [ ] **Step 4: 类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 5: 提交**

```bash
git add api/routers/generate.ts
git commit -m "rag(generate): 重写 summarizeRagChunks 为要点提取式摘要，减少 Token 占用"
```

---

### Task 2: Translation Memory 在二创生成中激活

**Files:**
- Modify: `api/routers/generate.ts`
- Create: `api/services/translation-memory.ts`（可选，如果逻辑简单可直接放在 generate.ts）

**背景：** `translation_memory` 表中存储了大量平行语料（sourceText + translatedText + embedding），但目前只在 `translate.ts` 翻译流程中使用。二创生成时，这些语料可以提供"风格句对"，帮助 AI 模仿参考小说的语言风格。

- [ ] **Step 1: 在 `buildBaseContext` 中新增 Translation Memory 查询**

在 `generate.ts` 中，在 `buildBaseContext` 函数的 Hybrid RAG 检索部分（line 439 之后，line 441 之前）插入以下代码：

```typescript
  // 4x. 从 Translation Memory 检索风格句对（仅当有关联小说时）
  let tmPairs: Array<{ source: string; translated: string; styleTag: string | null }> = []
  if (parentNovelId && briefEmbedding) {
    try {
      const tmResults = await db.execute(sql`
        SELECT source_text, translated_text, style_tag,
          1 - (embedding <=> ${JSON.stringify(briefEmbedding)}) as similarity
        FROM translation_memory
        WHERE novel_id = ${parentNovelId}
           OR (series_id = ${seriesId} AND novel_id IS NULL)
        ORDER BY embedding <=> ${JSON.stringify(briefEmbedding)}
        LIMIT 3
      `)
      const tmRows = Array.isArray(tmResults) ? tmResults : []
      tmPairs = tmRows.map((r: Record<string, unknown>) => ({
        source: String(r.source_text),
        translated: String(r.translated_text),
        styleTag: r.style_tag ? String(r.style_tag) : null,
      }))
    } catch {
      // Translation Memory 查询失败不影响主流程
    }
  }
```

- [ ] **Step 2: 修改 `buildBaseContext` 返回类型，增加 `tmPairs`**

修改 `BaseContext` 类型定义（在 `generate.ts` 顶部附近）：

```typescript
interface BaseContext {
  selectedChars: typeof characterCards.$inferSelect[]
  unselectedChars: typeof characterCards.$inferSelect[]
  worldBible: typeof worldBibles.$inferSelect | undefined
  canonEvents: typeof seriesCanon.$inferSelect[]
  ragCalls: RagCall[]
  ragContent: string
  warnings: string[]
  tmPairs?: Array<{ source: string; translated: string; styleTag: string | null }>
}
```

并将 `buildBaseContext` 的 return 语句改为：

```typescript
return { selectedChars, unselectedChars, worldBible, canonEvents, ragCalls, ragContent, warnings, tmPairs }
```

- [ ] **Step 3: 在 `buildSystemPrompt` 中注入 Translation Memory 风格句对**

在 `buildSystemPrompt` 中，找到组装 system prompt 的部分，在文风指导之前插入 Translation Memory 句对：

```typescript
  // 注入 Translation Memory 风格句对
  if (tmPairs && tmPairs.length > 0) {
    parts.push("")
    parts.push("【语言风格参考句对】")
    parts.push("以下句对展示了参考小说的语言风格，请模仿其用词、句式和语气：")
    for (const pair of tmPairs) {
      parts.push(`原文：${pair.source}`)
      parts.push(`译文：${pair.translated}`)
      if (pair.styleTag) parts.push(`（风格标签：${pair.styleTag}）`)
      parts.push("")
    }
  }
```

- [ ] **Step 4: 类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 5: 提交**

```bash
git add api/routers/generate.ts
git commit -m "feat(generate): Translation Memory 在二创生成中激活，提供风格句对参考"
```

---

## Phase 2: 素材热度追踪系统（下周）

### Task 3: 新增 `materialAnalytics` 表

**Files:**
- Modify: `db/schema.ts`
- Modify: `db/relations.ts`
- Modify: `contracts/schemas.ts`

**背景：** 当前无法知道哪些素材被频繁检索、哪些从未被使用。建立素材热度追踪，帮助用户优化素材池。

- [ ] **Step 1: 在 `db/schema.ts` 中添加表定义**

在 `translationMemory` 表定义之后插入：

```typescript
// 素材使用分析（热度追踪）
export const materialAnalytics = pgTable("material_analytics", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id").notNull(),
  seriesId: integer("series_id"),
  // 检索统计
  retrievalCount: integer("retrieval_count").notNull().default(0),
  lastRetrievedAt: timestamp("last_retrieved_at"),
  // 生成使用统计
  generationUsageCount: integer("generation_usage_count").notNull().default(0),
  lastUsedInGenerationAt: timestamp("last_used_in_generation_at"),
  // 用户反馈
  positiveFeedbackCount: integer("positive_feedback_count").notNull().default(0),
  negativeFeedbackCount: integer("negative_feedback_count").notNull().default(0),
  // 元数据
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_material_analytics_material_id").on(table.materialId),
  index("idx_material_analytics_series_id").on(table.seriesId),
])
```

- [ ] **Step 2: 在 `db/relations.ts` 中添加关系**

```typescript
export const materialAnalyticsRelations = relations(materialAnalytics, ({ one }) => ({
  material: one(materials, {
    fields: [materialAnalytics.materialId],
    references: [materials.id],
  }),
}))
```

- [ ] **Step 3: 在 `contracts/schemas.ts` 中添加 Zod schema**

```typescript
export const materialAnalyticsSchema = z.object({
  materialId: z.number(),
  retrievalCount: z.number().default(0),
  generationUsageCount: z.number().default(0),
  positiveFeedbackCount: z.number().default(0),
  negativeFeedbackCount: z.number().default(0),
})
```

- [ ] **Step 4: 推送数据库变更**

Run: `npm run db:push`
Expected: Schema pushed successfully

- [ ] **Step 5: 提交**

```bash
git add db/schema.ts db/relations.ts contracts/schemas.ts
git commit -m "db(schema): 新增 material_analytics 素材热度追踪表"
```

---

### Task 4: 在 RAG 检索和生成流程中记录素材命中

**Files:**
- Modify: `api/routers/generate.ts`
- Modify: `api/routers/rag.ts`

**背景：** 需要在每次 RAG 检索成功时，记录哪些素材被命中。

- [ ] **Step 1: 在 `buildBaseContext` 中记录 RAG 命中**

在 `generate.ts` 的 `buildBaseContext` 函数中，找到 RAG 检索完成后的位置（line ~532，pg_trgm 搜索之后），在 return 之前插入：

```typescript
  // 记录素材命中到 analytics（异步，不阻塞）
  if (ragCalls.length > 0) {
    Promise.resolve().then(async () => {
      try {
        const db = getDb()
        // 按 materialId 聚合命中次数
        const materialIdCounts = new Map<number, number>()
        for (const call of ragCalls) {
          const mid = call.chunkId ? await findMaterialIdByChunkId(call.chunkId) : null
          if (mid) {
            materialIdCounts.set(mid, (materialIdCounts.get(mid) || 0) + 1)
          }
        }
        for (const [materialId, count] of materialIdCounts) {
          await db.execute(sql`
            INSERT INTO material_analytics (material_id, series_id, retrieval_count, last_retrieved_at, updated_at)
            VALUES (${materialId}, ${seriesId}, ${count}, NOW(), NOW())
            ON CONFLICT (material_id) DO UPDATE SET
              retrieval_count = material_analytics.retrieval_count + ${count},
              last_retrieved_at = NOW(),
              updated_at = NOW()
          `)
        }
      } catch {
        //  analytics 记录失败不影响主流程
      }
    })
  }
```

- [ ] **Step 2: 新增 `findMaterialIdByChunkId` 辅助函数**

在 `generate.ts` 中新增：

```typescript
async function findMaterialIdByChunkId(chunkId: number): Promise<number | null> {
  const db = getDb()
  try {
    const [row] = await db.execute(sql`
      SELECT (metadata->>'materialId')::int as material_id
      FROM vector_chunks
      WHERE id = ${chunkId}
    `)
    return row && (row as Record<string, unknown>).material_id
      ? Number((row as Record<string, unknown>).material_id)
      : null
  } catch {
    return null
  }
}
```

- [ ] **Step 3: 在 `rag.ts` 的 `feedback` mutation 中记录素材反馈**

修改 `rag.ts` 的 `feedback` mutation，在更新 `vector_chunks.qualityScore` 的同时，反向更新 `material_analytics` 的反馈计数：

```typescript
  // 同步更新素材反馈统计
  for (const fb of feedbacks) {
    if (!fb.chunkId) continue
    const materialId = await findMaterialIdByChunkId(fb.chunkId)
    if (!materialId) continue
    const deltaColumn = input.wasHelpful ? "positive_feedback_count" : "negative_feedback_count"
    await db.execute(sql`
      INSERT INTO material_analytics (material_id, ${sql.raw(deltaColumn)}, updated_at)
      VALUES (${materialId}, 1, NOW())
      ON CONFLICT (material_id) DO UPDATE SET
        ${sql.raw(deltaColumn)} = material_analytics.${sql.raw(deltaColumn)} + 1,
        updated_at = NOW()
    `)
  }
```

注意：`findMaterialIdByChunkId` 需要在 `rag.ts` 中也定义或从公共模块导入。

- [ ] **Step 4: 类型检查 + 提交**

Run: `npm run check`
Expected: 零错误

```bash
git add api/routers/generate.ts api/routers/rag.ts
git commit -m "feat(rag): RAG 检索和反馈闭环中记录素材命中与反馈"
```

---

### Task 5: 前端素材池展示热度徽章

**Files:**
- Modify: `api/routers/material.ts`
- Modify: `src/pages/MaterialPool.tsx`

- [ ] **Step 1: 在 `material.ts` 中新增 `analytics` query**

在 `materialRouter` 中新增：

```typescript
  analytics: publicQuery
    .input(z.object({ materialId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [row] = await db
        .select()
        .from(materialAnalytics)
        .where(eq(materialAnalytics.materialId, input.materialId))
      return row || {
        materialId: input.materialId,
        retrievalCount: 0,
        generationUsageCount: 0,
        positiveFeedbackCount: 0,
        negativeFeedbackCount: 0,
      }
    }),
```

- [ ] **Step 2: 在 `material.ts` 的 `list` query 中 join analytics**

修改 `list` query 返回结构，包含热度统计：

```typescript
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
```

- [ ] **Step 3: 在 `MaterialPool.tsx` 中展示热度徽章**

在每个素材卡片上添加热度指示：

```tsx
// 在素材卡片中
{material.analytics && (
  <div className="flex items-center gap-2 mt-2">
    {material.analytics.retrievalCount > 10 && (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
        🔥 高频使用
      </span>
    )}
    {material.analytics.retrievalCount === 0 && (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">
        ⚪ 未命中
      </span>
    )}
    <span className="text-[10px] text-white/30 font-mono">
      命中 {material.analytics.retrievalCount} 次
    </span>
  </div>
)}
```

- [ ] **Step 4: 类型检查 + 提交**

Run: `npm run check`
Expected: 零错误

```bash
git add api/routers/material.ts src/pages/MaterialPool.tsx
git commit -m "ui(material): 素材池展示热度徽章和命中统计"
```

---

## Phase 3: 设定库精准注入（月内）

### Task 6: 世界观维度动态优先级

**Files:**
- Modify: `api/routers/generate.ts`

**背景：** 当前世界观所有维度平等注入，不区分与 Brief 的相关度。优化后按 Brief 语义计算每个维度的相关性，只注入 top 维度。

- [ ] **Step 1: 在 `buildBaseContext` 中新增世界观维度相关性排序**

在世界观查询之后（line 405-414 之后），插入：

```typescript
  // 3b. 计算世界观维度与 Brief 的相关性（如有 embedding）
  let prioritizedAspects: Array<{ name: string; content: string; relevance: number }> = []
  if (worldBible?.aspects && briefEmbedding) {
    const aspects = worldBible.aspects as Array<{ name: string; content: string }>
    // 为每个维度计算与 brief 的语义相似度
    const aspectEmbeddings = await getEmbeddingsBatch(aspects.map(a => a.name + ":" + a.content.slice(0, 100)))
    prioritizedAspects = aspects.map((a, i) => {
      const emb = aspectEmbeddings[i]
      const relevance = emb && emb.length > 0
        ? cosineSimilarity(briefEmbedding, emb)
        : 0.5
      return { ...a, relevance }
    }).sort((a, b) => b.relevance - a.relevance)
  }
```

- [ ] **Step 2: 新增 `cosineSimilarity` 辅助函数**

在 `generate.ts` 中新增：

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
```

- [ ] **Step 3: 修改 `buildWorldViewSection` 支持动态优先级**

修改 `buildWorldViewSection` 函数，增加 `prioritizedAspects` 参数：

```typescript
function buildWorldViewSection(
  worldBible: typeof worldBibles.$inferSelect | undefined,
  prioritizedAspects?: Array<{ name: string; content: string; relevance: number }>
): string {
  if (!worldBible) return ""

  const parts: string[] = []

  // 优先使用按相关性排序的 aspects
  if (prioritizedAspects && prioritizedAspects.length > 0) {
    parts.push("")
    parts.push("【世界观设定】")
    // 只注入相关性 > 0.6 或 top 5 的维度
    const topAspects = prioritizedAspects.filter(a => a.relevance > 0.6).slice(0, 5)
    for (const aspect of topAspects) {
      parts.push(`${aspect.name}：${aspect.content}`)
    }
    if (topAspects.length < prioritizedAspects.length) {
      parts.push(`（另有 ${prioritizedAspects.length - topAspects.length} 个世界观维度因与当前创作方向关联较低而省略）`)
    }
  } else if (worldBible.aspects && (worldBible.aspects as Array<unknown>).length > 0) {
    // 回退：全量注入（无 embedding 时）
    const aspects = worldBible.aspects as Array<{ name: string; content: string }>
    parts.push("")
    parts.push("【世界观设定】")
    for (const aspect of aspects) {
      parts.push(`${aspect.name}：${aspect.content}`)
    }
  }

  // 其余字段保持不变...
  if (worldBible.geography) parts.push(`地理环境：${worldBible.geography}`)
  if (worldBible.magicSystem) parts.push(`力量体系：${worldBible.magicSystem}`)
  if (worldBible.technologyLevel) parts.push(`科技水平：${worldBible.technologyLevel}`)
  if (worldBible.culturalCustoms) parts.push(`文化习俗：${worldBible.culturalCustoms}`)
  if (worldBible.linguisticNotes) parts.push(`语言命名：${worldBible.linguisticNotes}`)

  const factions = worldBible.factions as Array<{ name: string; description: string }> | undefined
  if (factions && factions.length > 0) {
    parts.push("")
    parts.push("【主要势力】")
    for (const f of factions) {
      parts.push(`- ${f.name}：${f.description}`)
    }
  }

  const timeline = worldBible.timelineEvents as Array<{ order: number; description: string }> | undefined
  if (timeline && timeline.length > 0) {
    parts.push("")
    parts.push("【历史时间线】")
    for (const e of timeline.sort((a, b) => a.order - b.order)) {
      parts.push(`${e.order}. ${e.description}`)
    }
  }

  return parts.join("\n")
}
```

- [ ] **Step 4: 修改 `buildSystemPrompt` 调用，传入 prioritizedAspects**

在 `buildSystemPrompt` 中，将 `buildWorldViewSection(worldBible)` 改为 `buildWorldViewSection(worldBible, prioritizedAspects)`。

- [ ] **Step 5: 类型检查 + 提交**

Run: `npm run check`
Expected: 零错误

```bash
git add api/routers/generate.ts
git commit -m "feat(generate): 世界观维度按 Brief 语义动态排序，只注入高相关维度"
```

---

### Task 7: RAG ↔ 设定库交叉验证

**Files:**
- Modify: `api/routers/generate.ts`

**背景：** 检索到的素材可能包含与设定库矛盾的信息（比如素材中某角色已死，但正史中未提及）。生成前进行交叉验证，提前警告。

- [ ] **Step 1: 新增 `validateRagAgainstLore` 函数**

在 `generate.ts` 中新增：

```typescript
function validateRagAgainstLore(
  ragCalls: RagCall[],
  characters: typeof characterCards.$inferSelect[],
  selectedCharacterIds: number[],
  canonEvents: typeof seriesCanon.$inferSelect[],
): string[] {
  const conflicts: string[] = []
  const selectedNames = new Set(
    characters
      .filter(c => selectedCharacterIds.includes(c.id))
      .flatMap(c => [c.name, ...(c.aliases as string[] || [])])
      .filter(Boolean)
  )

  for (const call of ragCalls) {
    const content = call.content

    // 检查素材中是否包含未选中角色的关键行为描述
    for (const char of characters) {
      if (selectedCharacterIds.includes(char.id)) continue
      const names = [char.name, ...(char.aliases as string[] || [])].filter(Boolean)
      for (const name of names) {
        if (content.includes(name)) {
          // 简单启发式：如果素材中对该角色使用了强动作动词，可能是关键情节
          const actionPatterns = ["死亡", "牺牲", "背叛", "复活", "失踪", "结婚", "离开"]
          if (actionPatterns.some(a => content.includes(name + a) || content.includes(a + name))) {
            conflicts.push(`素材「${call.sourceTitle || "未知来源"}」涉及未选中角色"${name}"的关键情节，可能影响故事一致性`)
          }
        }
      }
    }

    // 检查素材中的时间线事件是否与正史冲突（简化版：检测年份/章节号矛盾）
    for (const event of canonEvents) {
      if (event.isImmutable && content.includes(event.description.slice(0, 20))) {
        // 如果素材引用了不可变正史事件，但描述不同
        if (!content.includes(event.description)) {
          conflicts.push(`素材「${call.sourceTitle || "未知来源"}」对正史事件"${event.description.slice(0, 30)}..."的描述可能与正史不一致`)
        }
      }
    }
  }

  return [...new Set(conflicts)] // 去重
}
```

- [ ] **Step 2: 在 `buildBaseContext` 中调用验证**

在 `buildBaseContext` 的 return 之前（line ~544），将 `warnings` 与交叉验证结果合并：

```typescript
  // 6. RAG ↔ 设定库交叉验证
  const ragConflicts = validateRagAgainstLore(ragCalls, allCharacters, selectedCharacterIds || [], canonEvents)
  warnings.push(...ragConflicts)
```

- [ ] **Step 3: 类型检查 + 提交**

Run: `npm run check`
Expected: 零错误

```bash
git add api/routers/generate.ts
git commit -m "feat(generate): RAG 与设定库交叉验证，提前发现设定矛盾"
```

---

## Phase 4: 集成验证

### Task 8: 类型检查 + 构建 + 回归测试

- [ ] **Step 1: 类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 2: 运行测试**

Run: `npm run test`
Expected: 78/78 通过

- [ ] **Step 3: 生产构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: 数据库 schema push**

Run: `npm run db:push`
Expected: Schema 同步成功

- [ ] **Step 5: 提交**

```bash
git commit -m "chore: RAG/素材库/设定库优化集成验证通过"
```

---

## Self-Review

### 1. Spec Coverage

| 诊断问题 | 对应 Task |
|---------|----------|
| RAG 摘要是伪摘要 | Task 1 |
| Translation Memory 闲置 | Task 2 |
| 素材无热度追踪 | Task 3, 4, 5 |
| 世界观维度无优先级 | Task 6 |
| 缺乏 RAG ↔ 设定库交叉验证 | Task 7 |
| 角色卡全量注入 | Phase 3 预留（Task 6 部分缓解） |
| 中文 tsvector 无效 | 不在本计划（需数据库扩展，属 P2） |
| 风格样本被动回流 | 不在本计划（已有 saveAsStyleSample） |

### 2. Placeholder Scan

- 无 "TBD/TODO/实现 later"
- 所有代码片段完整且可直接复制
- 所有 Task 包含明确的文件路径和行号范围
- 无 "类似 Task X" 引用

### 3. Type Consistency

- `RagCall` 类型在 Task 1, 2, 7 中一致使用
- `BaseContext` 接口在 Task 2 中扩展了 `tmPairs`
- `materialAnalytics` 表结构和 Zod schema 一致
- `cosineSimilarity` 函数签名在 Task 6 中定义并直接使用

---

## 执行交付

Plan complete and saved to `docs/superpowers/plans/2026-06-11-enhance-cocreation-rag-lore.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
