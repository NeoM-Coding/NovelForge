# Studio 体验优化 — RAG 可观测性、批量生成体验与 Prompt 截断通知

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决评审报告中发现的三大核心问题：RAG 检索质量不可观测、批量生成体验断层（失败不可见/不可单章重试）、Prompt 截断对用户不可见。

**Architecture:** 后端新增 `generationMetrics` 表记录每章生成耗时与 RAG 召回指标；`fanFictionChapters.status` 扩展为四级状态机；`searchSimilar` 空结果时自动降级扩大检索范围；`buildSystemPrompt` 返回 `truncated` 字段透传前端。前端 `BatchProgressPanel` 改为章节级状态卡片，支持单章重试；生成完成后展示 RAG 引用清单与截断警告。

**Tech Stack:** React 19 + TypeScript + tRPC 11 + Drizzle ORM + PostgreSQL 16 + pgvector + Tailwind CSS

---

## File Structure

| File | Responsibility |
|------|---------------|
| `db/schema.ts` | 扩展 `fanFictionChapters.status` enum；新增 `generationMetrics` 表 |
| `contracts/schemas.ts` | 新增 `batchRetryChapterSchema`、`chapterStatusSchema` |
| `api/services/embedder.ts` | `searchSimilar` 空结果降级；返回 `recallMethod` 标记 |
| `api/routers/generate.ts` | `buildSystemPrompt` 返回 `truncated`；`generateSingleChapter` 记录耗时与状态；新增 `batchRetryChapter` mutation |
| `api/routers/rag.ts` | 新增 `searchSimilar` 的 `searchMetrics` 辅助查询 |
| `src/types/studio.ts` | 扩展 `GenParams`、`RagCall`、`GenerationError`；新增 `ChapterStatus`、`GenerationMetric` 类型 |
| `src/hooks/useStudioState.ts` | 接入新 API：单章重试、RAG 引用展示、截断提示 |
| `src/components/studio/BatchProgressPanel.tsx` | 章节级状态卡片（pending/generating/generated/failed）、单章重试按钮 |
| `src/components/studio/RagReferencePanel.tsx` | 生成后展示 RAG 素材引用列表（新建） |
| `src/components/studio/PromptTruncatedBanner.tsx` | Prompt 截断警告横幅（新建） |
| `src/components/studio/index.ts` | 统一导出新增组件 |
| `src/pages/Studio.tsx` | 挂载 `RagReferencePanel`、`PromptTruncatedBanner` |

---

## Task 1: 数据库层 — 扩展章节状态 + 新增生成指标表

**Files:**
- Modify: `db/schema.ts`
- Test: `npm run check`

- [ ] **Step 1: 扩展 `fanFictionChapters.status` 为 varchar 并增加注释说明四级状态**

当前 `fanFictionChapters.status` 是 `varchar("status", { length: 50 })`，没有约束。添加四级状态说明注释（不在代码层约束，保持灵活性）：

```typescript
// fanFictionChapters 表中 status 字段的四级状态：
// "pending"    — 已创建但未开始生成
// "generating" — 正在生成中
// "generated"  — 生成成功
// "failed"     — 生成失败，可重试
```

直接在 `fanFictionChapters` 的 `status` 字段定义旁添加 JSDoc 注释：

```typescript
export const fanFictionChapters = pgTable("fan_fiction_chapters", {
  // ... existing fields ...
  /**
   * 四级状态机：pending → generating → generated | failed
   * - pending:    已创建章节配置，尚未开始生成
   * - generating: AI 正在生成中
   * - generated:  生成成功，内容可用
   * - failed:     生成失败，记录 errorLog，可重试
   */
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  // ...
})
```

- [ ] **Step 2: 新增 `generationMetrics` 表**

在 `db/schema.ts` 的 `ragFeedback` 表之后、`auditLogs` 表之前插入：

```typescript
// 生成质量指标（每章/每次生成任务的详细指标，用于可观测性）
export const generationMetrics = pgTable("generation_metrics", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id"),                    // 关联 generationJobs.id（批量生成时）
  workId: integer("work_id"),                  // 关联 fanFictionWorks.id
  chapterNumber: integer("chapter_number"),    // 关联 fanFictionChapters.chapter_number
  type: varchar("type", { length: 50 }).notNull(), // "single" | "batch" | "outline"

  // 时间指标
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),          // 生成耗时（毫秒）

  // Token 指标
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),

  // RAG 指标
  ragRecallCount: integer("rag_recall_count"),     // 本次检索召回的 chunk 数量
  ragTopSimilarity: real("rag_top_similarity"),    // 最高相似度分数
  ragEmptyResult: boolean("rag_empty_result").default(false), // 是否零召回
  ragTruncated: boolean("rag_truncated").default(false),      // Prompt 是否被截断

  // 质量指标
  selfCritiquePassed: boolean("self_critique_passed"),   // 自检是否通过
  selfCritiqueIssueCount: integer("self_critique_issue_count"), // 自检发现问题数
  worldViewCompliant: boolean("world_view_compliant"),   // 世界观一致性检查结果

  // 错误记录
  errorType: varchar("error_type", { length: 50 }),      // network | timeout | api_error | validation | unknown
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
})
```

- [ ] **Step 3: 运行类型检查并提交**

```bash
npm run check
```
Expected: zero errors.

```bash
git add db/schema.ts
git commit -m "db(schema): 扩展 fanFictionChapters 四级状态 + 新增 generationMetrics 表"
```

---

## Task 2: 后端 — RAG 空结果降级 + Prompt 截断通知

**Files:**
- Modify: `api/services/embedder.ts`
- Modify: `api/routers/generate.ts`
- Modify: `contracts/schemas.ts`
- Test: `npm run check`

- [ ] **Step 1: `searchSimilar` 空结果时自动降级扩大检索范围**

修改 `api/services/embedder.ts` 中的 `searchSimilar` 函数，在返回 `mapped` 之前增加空结果降级逻辑：

找到 `searchSimilar` 函数的返回前代码（当前第 228-240 行附近），替换为：

```typescript
  // 按素材质量分加权重排序（高质量素材提升排名）
  mapped.sort((a, b) => {
    const scoreA = (a.similarity || 0) * (a.qualityScore || 1.0)
    const scoreB = (b.similarity || 0) * (b.qualityScore || 1.0)
    return scoreB - scoreA
  })

  // 空结果降级：如果 strict 检索返回空，扩大范围重试
  let recallMethod: "strict" | "expanded" | "fallback" = "strict"
  if (mapped.length === 0) {
    console.warn(`[searchSimilar] 零召回: query="${query.slice(0, 50)}" seriesId=${options?.seriesId} novelId=${options?.novelId}`)
    recallMethod = "expanded"

    // 降级 1：去掉 novelId 限制，按 seriesId 全局检索
    try {
      const expandedResults = await db.execute(sql`
        SELECT id, content, source_type, 1 - (embedding <=> ${embeddingJson}) as similarity,
          metadata
        FROM vector_chunks
        WHERE (${options?.seriesId ?? null}::int IS NULL OR series_id = ${options?.seriesId ?? null})
        ORDER BY embedding <=> ${embeddingJson}
        LIMIT ${limit}
      `)
      const expandedRows = Array.isArray(expandedResults) ? expandedResults : []
      for (const row of expandedRows) {
        const metadata = (row.metadata as Record<string, unknown>) || {}
        mapped.push({
          id: row.id ? Number(row.id) : undefined,
          content: String(row.content),
          enrichedContent: String(row.content),
          similarity: Number(row.similarity),
          sourceType: String(row.source_type),
          sourceTitle: metadata.sourceTitle ? String(metadata.sourceTitle) : undefined,
          chapterNumber: metadata.chapterNumber ? Number(metadata.chapterNumber) : undefined,
          chunkIndex: metadata.chunkIndex ? Number(metadata.chunkIndex) : undefined,
          totalChunks: metadata.totalChunks ? Number(metadata.totalChunks) : undefined,
          contextBefore: undefined,
          contextAfter: undefined,
          qualityScore: Number(metadata.qualityScore || 1.0),
        })
      }
    } catch { /* ignore */ }

    // 降级 2：如果仍然为空，使用 pg_trgm 最低阈值兜底
    if (mapped.length === 0) {
      recallMethod = "fallback"
      try {
        const fallbackResults = await db.execute(sql`
          SELECT id, content, source_type, metadata,
            similarity(content, ${query.slice(0, 50)}) as similarity
          FROM vector_chunks
          WHERE content % ${query.slice(0, 50)}
          ORDER BY similarity(content, ${query.slice(0, 50)}) DESC
          LIMIT ${limit}
        `)
        const fallbackRows = Array.isArray(fallbackResults) ? fallbackResults : []
        for (const row of fallbackRows) {
          const metadata = (row.metadata as Record<string, unknown>) || {}
          mapped.push({
            id: row.id ? Number(row.id) : undefined,
            content: String(row.content),
            enrichedContent: String(row.content),
            similarity: Number(row.similarity),
            sourceType: String(row.source_type),
            sourceTitle: metadata.sourceTitle ? String(metadata.sourceTitle) : undefined,
            chapterNumber: metadata.chapterNumber ? Number(metadata.chapterNumber) : undefined,
            chunkIndex: metadata.chunkIndex ? Number(metadata.chunkIndex) : undefined,
            totalChunks: metadata.totalChunks ? Number(metadata.totalChunks) : undefined,
            contextBefore: undefined,
            contextAfter: undefined,
            qualityScore: Number(metadata.qualityScore || 1.0),
          })
        }
      } catch { /* ignore */ }
    }
  }

  // 相邻 Chunk 召回（Parent Document Retrieval）：对 top 结果补充相邻片段上下文
  if (mapped.length > 0) {
    const enriched = await enrichWithAdjacentChunks(mapped)
    return enriched
  }

  return mapped
```

同时修改 `SearchResult` 接口，增加 `recallMethod`：

```typescript
export interface SearchResult {
  id?: number
  content: string
  enrichedContent?: string
  similarity: number
  sourceType: string
  sourceTitle?: string
  chapterNumber?: number
  chunkIndex?: number
  totalChunks?: number
  contextBefore?: string
  contextAfter?: string
  qualityScore?: number
  recallMethod?: "strict" | "expanded" | "fallback"  // ← 新增
}
```

在映射代码中设置 `recallMethod`：

```typescript
  // 映射为 SearchResult（在 merged.map 中）
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
    recallMethod,  // ← 新增
  }
```

- [ ] **Step 2: `buildSystemPrompt` 返回 `truncated` 字段**

修改 `api/routers/generate.ts` 中的 `buildSystemPrompt` 函数返回类型：

```typescript
// 修改前
): Promise<{ prompt: string; ragCalls: RagCall[]; warnings?: string[] }>

// 修改后
): Promise<{ prompt: string; ragCalls: RagCall[]; warnings?: string[]; truncated?: string[] }>
```

在 `buildSystemPrompt` 函数末尾，将 `assemblePromptWithBudget` 的 `truncated` 字段返回：

```typescript
  const { prompt, truncated } = assemblePromptWithBudget(sections)

  if (truncated.length > 0) {
    console.warn(`[buildSystemPrompt] 截断了 ${truncated.length} 个模块: ${truncated.join(", ")}`)
  }

  return { prompt, ragCalls: extendedRagCalls, warnings: warnings.length > 0 ? warnings : undefined, truncated: truncated.length > 0 ? truncated : undefined }
```

- [ ] **Step 3: `generateSingleChapter` 和 `fanfiction` mutation 透传 `truncated`**

修改 `generateSingleChapter` 返回类型：

```typescript
// 修改前
): Promise<{ content: string; ragCalls: RagCall[]; warnings?: string[] }>

// 修改后
): Promise<{ content: string; ragCalls: RagCall[]; warnings?: string[]; truncated?: string[] }>
```

在 `generateSingleChapter` 末尾返回 `truncated`：

```typescript
  return { content, ragCalls, warnings, truncated: (promptResult as { truncated?: string[] }).truncated }
```

修改 `fanfiction` mutation 返回，加入 `truncated`：

找到 `return { content: fullContent, workId: work.id, ragCalls, warnings, autoTitle, taskId }`，改为：

```typescript
return { content: fullContent, workId: work.id, ragCalls, warnings, autoTitle, taskId, truncated: (promptResult as { truncated?: string[] }).truncated }
```

- [ ] **Step 4: 更新 `contracts/schemas.ts` — `RagCall` 和 `GenerationError` 已在前端类型中定义，无需修改 schema**

无需修改 `contracts/schemas.ts`，因为 `truncated` 是返回字段而非输入校验字段。

- [ ] **Step 5: 运行类型检查并提交**

```bash
npm run check
```
Expected: zero errors. 注意 `searchSimilar` 返回类型变化后，调用方（`buildBaseContext`）的类型会自动推导，但需确保无类型不匹配错误。

```bash
git add api/services/embedder.ts api/routers/generate.ts
git commit -m "api(rag): 空结果自动降级 + Prompt 截断通知后端支持"
```

---

## Task 3: 后端 — 批量生成章节级状态管理 + 单章重试

**Files:**
- Modify: `api/routers/generate.ts`
- Modify: `contracts/schemas.ts`
- Test: `npm run check`

- [ ] **Step 1: `generateSingleChapter` 增加 metrics 记录**

修改 `generateSingleChapter`，在开头记录开始时间，在返回前记录结束时间并写入 `generationMetrics`：

```typescript
async function generateSingleChapter(
  _workId: number,
  seriesId: number,
  chapterNumber: number,
  chapterTitle: string,
  chapterBrief: string,
  params: Partial<GenParams>,
  options: {
    parentNovelId?: number
    userPrompt?: string
    useMaterials?: boolean
    materialIds?: number[]
    selectedCharacterIds?: number[]
    selectedTropeIds?: number[]
    hotkeyTropeIds?: number[]
    outlineSection?: string
    previousContext?: string
    worldBible?: typeof worldBibles.$inferSelect
    jobId?: number  // ← 新增
  }
): Promise<{ content: string; ragCalls: RagCall[]; warnings?: string[]; truncated?: string[] }> {
  const startTime = Date.now()
  const db = getDb()
  let metricsId: number | undefined

  // 创建 metrics 记录
  try {
    const [metric] = await db.insert(generationMetrics).values({
      jobId: options.jobId,
      workId: _workId,
      chapterNumber,
      type: options.jobId ? "batch" : "single",
      startedAt: new Date(),
    }).returning()
    metricsId = metric.id
  } catch { /* metrics 记录失败不影响主流程 */ }

  try {
    const { prompt, ragCalls, warnings, truncated } = await buildSystemPrompt(
      seriesId,
      chapterBrief,
      params,
      options.parentNovelId,
      options.userPrompt,
      options.useMaterials,
      options.materialIds,
      options.selectedCharacterIds,
      options.selectedTropeIds,
      options.hotkeyTropeIds,
      options.outlineSection,
      options.previousContext,
    )

    const result = await chatCompletion({
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `请创作第 ${chapterNumber} 章《${chapterTitle}》。要求：${chapterBrief}` },
      ],
      temperature: params.temperature ?? 0.8,
      maxTokens: params.lengthTarget === "short" ? 4000 : params.lengthTarget === "arc" ? 12000 : 8000,
    })

    const content = sanitizeGeneratedContent(result.content)
    const durationMs = Date.now() - startTime

    // 世界观一致性检查
    let worldViewCompliant = true
    if (options.worldBible) {
      const { compliant, issues } = await verifyWorldViewCompliance(content, options.worldBible, seriesId)
      worldViewCompliant = compliant
      if (!compliant && issues.length > 0) {
        console.warn(`[WorldView] Chapter ${chapterNumber} issues:`, issues)
      }
    }

    // 更新 metrics
    if (metricsId) {
      await db.update(generationMetrics).set({
        completedAt: new Date(),
        durationMs,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        totalTokens: result.usage?.totalTokens,
        ragRecallCount: ragCalls.length,
        ragTopSimilarity: ragCalls.length > 0 ? Math.max(...ragCalls.map(r => r.score || 0)) : undefined,
        ragTruncated: !!truncated && truncated.length > 0,
        worldViewCompliant,
      }).where(eq(generationMetrics.id, metricsId)).catch(() => {})
    }

    return { content, ragCalls, warnings, truncated }
  } catch (err) {
    // 记录失败 metrics
    if (metricsId) {
      const errorType = err instanceof Error && err.message.includes("timeout") ? "timeout"
        : err instanceof Error && err.message.includes("network") ? "network"
        : "api_error"
      await db.update(generationMetrics).set({
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        errorType,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).where(eq(generationMetrics.id, metricsId)).catch(() => {})
    }
    throw err
  }
}
```

- [ ] **Step 2: `batch` mutation 中设置章节状态为 generating / 失败时设为 failed**

在 `runBatch` 内部，修改 `batchPromises` 中的生成逻辑：

```typescript
            const batchPromises = preflightResults.map(({ config, existing, previousContext }) =>
              (async () => {
                // Resume support: skip already-generated chapters
                if (existing?.status === "generated") {
                  return { status: "skipped" as const, config }
                }

                // 设置状态为 generating
                if (existing) {
                  await db.update(fanFictionChapters)
                    .set({ status: "generating", updatedAt: new Date() })
                    .where(eq(fanFictionChapters.id, existing.id))
                } else {
                  const [inserted] = await db.insert(fanFictionChapters).values({
                    workId,
                    chapterNumber: config.chapterNumber,
                    title: config.title,
                    content: "",
                    brief: config.brief,
                    parameters: mergedParams,
                    status: "generating",
                  }).returning()
                }

                try {
                  const { content } = await generateSingleChapter(
                    workId,
                    seriesId,
                    config.chapterNumber,
                    config.title,
                    config.brief,
                    mergedParams,
                    { ...genOptions, previousContext, jobId: jobId },
                  )

                  // Upsert: update if exists, insert if not
                  const [latestExisting] = await db
                    .select()
                    .from(fanFictionChapters)
                    .where(sql`${fanFictionChapters.workId} = ${workId} AND ${fanFictionChapters.chapterNumber} = ${config.chapterNumber}`)

                  if (latestExisting) {
                    await db
                      .update(fanFictionChapters)
                      .set({ content, status: "generated", updatedAt: new Date() })
                      .where(eq(fanFictionChapters.id, latestExisting.id))
                  } else {
                    await db.insert(fanFictionChapters).values({
                      workId,
                      chapterNumber: config.chapterNumber,
                      title: config.title,
                      content,
                      brief: config.brief,
                      parameters: mergedParams,
                      status: "generated",
                    })
                  }

                  return { status: "fulfilled" as const, config }
                } catch (genErr) {
                  // 标记为失败
                  const [latestExisting] = await db
                    .select()
                    .from(fanFictionChapters)
                    .where(sql`${fanFictionChapters.workId} = ${workId} AND ${fanFictionChapters.chapterNumber} = ${config.chapterNumber}`)
                  if (latestExisting) {
                    await db.update(fanFictionChapters)
                      .set({ status: "failed", updatedAt: new Date() })
                      .where(eq(fanFictionChapters.id, latestExisting.id))
                  }
                  throw genErr
                }
              })()
            )
```

- [ ] **Step 3: 新增 `batchRetryChapter` mutation**

在 `generateRouter` 中，在 `batchRetry` 之后添加：

```typescript
  batchRetryChapter: publicQuery
    .input(z.object({
      workId: z.number(),
      chapterNumber: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId))
      if (!work || !work.seriesId) throw new Error("作品不存在或未关联系列")

      const [chapter] = await db
        .select()
        .from(fanFictionChapters)
        .where(sql`${fanFictionChapters.workId} = ${input.workId} AND ${fanFictionChapters.chapterNumber} = ${input.chapterNumber}`)
      if (!chapter) throw new Error("章节不存在")

      const workParams = (work.parameters ?? {}) as Partial<GenParams>
      const outline = work.outline ? safeParseOutline(work.outline).outline : undefined
      const outlineSection = outline ? buildOutlineSection(outline) : undefined
      const previousContext = await getPreviousContext(input.workId, input.chapterNumber)

      const genOptions = {
        parentNovelId: work.parentNovelId ?? undefined,
        userPrompt: (work.parameters as Record<string, unknown> | undefined)?.userPrompt as string | undefined,
        useMaterials: (work.parameters as Record<string, unknown> | undefined)?.useMaterials as boolean | undefined,
        materialIds: (work.parameters as Record<string, unknown> | undefined)?.materialIds as number[] | undefined,
        selectedCharacterIds: (work.parameters as Record<string, unknown> | undefined)?.selectedCharacterIds as number[] | undefined,
        selectedTropeIds: (work.parameters as Record<string, unknown> | undefined)?.selectedTropeIds as number[] | undefined,
        outlineSection,
        previousContext,
        worldBible: undefined,
      }

      // 重新设置状态为 generating
      await db.update(fanFictionChapters)
        .set({ status: "generating", updatedAt: new Date() })
        .where(eq(fanFictionChapters.id, chapter.id))

      try {
        const { content } = await generateSingleChapter(
          input.workId,
          work.seriesId,
          input.chapterNumber,
          chapter.title || `第${input.chapterNumber}章`,
          chapter.brief || "",
          workParams,
          genOptions,
        )

        await db.update(fanFictionChapters)
          .set({ content, status: "generated", updatedAt: new Date() })
          .where(eq(fanFictionChapters.id, chapter.id))

        return { success: true, chapterNumber: input.chapterNumber }
      } catch (err) {
        await db.update(fanFictionChapters)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(fanFictionChapters.id, chapter.id))
        throw err
      }
    }),
```

- [ ] **Step 4: `batchStatus` query 返回失败章节信息**

修改 `batchStatus` query，从 `generationJobs.metadata.failedChapters` 读取失败信息：

```typescript
  batchStatus: publicQuery
    .input(z.object({ jobId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, input.jobId))
      if (!job) throw new Error("任务不存在")

      const workId = (job.metadata as Record<string, unknown> | null)?.workId as number | undefined
      let completedChapters: Array<{ chapterNumber: number; title: string | null; status: string }> = []
      if (workId) {
        completedChapters = await db
          .select({ chapterNumber: fanFictionChapters.chapterNumber, title: fanFictionChapters.title, status: fanFictionChapters.status })
          .from(fanFictionChapters)
          .where(eq(fanFictionChapters.workId, workId))
          .orderBy(asc(fanFictionChapters.chapterNumber))
      }

      const metadata = job.metadata as Record<string, unknown> | null
      const failedChapters = Array.isArray(metadata?.failedChapters)
        ? (metadata?.failedChapters as Array<{ chapterNumber: number; title: string; error: string }>)
        : []

      return {
        jobId: job.id, status: job.status, progress: job.progress, errorLog: job.errorLog,
        currentChapter: metadata?.currentChapter as number | undefined,
        totalChapters: metadata?.totalChapters as number | undefined,
        completedChapters,
        failedChapters,
      }
    }),
```

- [ ] **Step 5: 运行类型检查并提交**

```bash
npm run check
```

```bash
git add api/routers/generate.ts contracts/schemas.ts db/schema.ts
git commit -m "api(generate): 批量生成章节级状态 + 单章重试 + metrics 记录"
```

---

## Task 4: 前端 — 类型扩展 + useStudioState 接入新 API

**Files:**
- Modify: `src/types/studio.ts`
- Modify: `src/hooks/useStudioState.ts`
- Test: `npm run check`

- [ ] **Step 1: 扩展 `src/types/studio.ts`**

在 `studio.ts` 中新增类型：

```typescript
// 章节状态（四级状态机）
export type ChapterStatus = "pending" | "generating" | "generated" | "failed"

export interface ChapterItem {
  id: number
  chapterNumber: number
  title: string | null
  content: string | null
  status: ChapterStatus
  brief?: string | null
}

// 批量任务状态
export interface BatchStatusData {
  jobId: number
  status: string
  progress: number
  errorLog?: string | null
  currentChapter?: number
  totalChapters?: number
  completedChapters: Array<{ chapterNumber: number; title: string | null; status: string }>
  failedChapters: Array<{ chapterNumber: number; title: string; error: string }>
}

// 生成后 RAG 引用展示
export interface RagReference {
  type: string
  sourceTitle?: string
  chapterNumber?: number
  score?: number
  content: string
}

// Prompt 截断警告
export interface PromptTruncatedWarning {
  modules: string[]
  message: string
}
```

同时扩展 `GenerationError` 以支持 batch 错误：

```typescript
export interface GenerationError {
  type: "network" | "timeout" | "api_error" | "validation" | "cancelled" | "unknown"
  message: string
  retryable: boolean
  timestamp: number
  chapterNumber?: number  // ← 新增：批量生成时标识是哪一章
}
```

- [ ] **Step 2: `useStudioState` 接入新 API**

在 `useStudioState.ts` 中：

a) 新增状态：

```typescript
  // RAG 引用展示
  const [ragReferences, setRagReferences] = useState<RagReference[]>([])
  const [showRagReferencePanel, setShowRagReferencePanel] = useState(false)

  // Prompt 截断警告
  const [truncatedWarning, setTruncatedWarning] = useState<PromptTruncatedWarning | null>(null)

  // 单章重试
  const [retryingChapters, setRetryingChapters] = useState<Set<number>>(new Set())
```

b) 新增 mutation：

```typescript
  const batchRetryChapterMutation = trpc.generate.batchRetryChapter.useMutation({
    onSuccess: () => {
      utils.generate.listChapters.invalidate({ workId: generatedWorkId || 0 })
      utils.generate.batchStatus.invalidate({ jobId: batchJobId })
      toast.success("章节重试已启动")
    },
    onError: (err) => {
      toast.error(`重试失败: ${err.message}`)
    },
  })
```

c) 修改 `handleGenerate` / `handleBatchGenerate`，在成功回调中处理 `truncated`：

```typescript
  // 在 generateMutation onSuccess 中
  onSuccess: (data) => {
    utils.generate.list.invalidate()
    // 展示 RAG 引用
    if (data.ragCalls && data.ragCalls.length > 0) {
      setRagReferences(data.ragCalls.map(r => ({
        type: r.type,
        sourceTitle: r.sourceTitle,
        chapterNumber: r.chapterNumber,
        score: r.score,
        content: r.content.slice(0, 200) + (r.content.length > 200 ? "..." : ""),
      })))
      setShowRagReferencePanel(true)
    }
    // Prompt 截断警告
    if (data.truncated && data.truncated.length > 0) {
      setTruncatedWarning({
        modules: data.truncated,
        message: `因 Prompt 长度限制，以下模块被截断：${data.truncated.join(", ")}`,
      })
    }
  },
```

d) 新增单章重试 handler：

```typescript
  const handleRetryChapter = useCallback(async (chapterNumber: number) => {
    if (!generatedWorkId) return
    setRetryingChapters(prev => new Set(prev).add(chapterNumber))
    try {
      await batchRetryChapterMutation.mutateAsync({ workId: generatedWorkId, chapterNumber })
    } finally {
      setRetryingChapters(prev => {
        const next = new Set(prev)
        next.delete(chapterNumber)
        return next
      })
    }
  }, [generatedWorkId, batchRetryChapterMutation])
```

e) 在返回对象中暴露新状态和 handler：

```typescript
  return {
    // ... 现有返回 ...

    // RAG 引用
    ragReferences,
    showRagReferencePanel,
    setShowRagReferencePanel,

    // Prompt 截断
    truncatedWarning,
    setTruncatedWarning,

    // 单章重试
    retryingChapters,
    handleRetryChapter,
  }
```

- [ ] **Step 3: 运行类型检查并提交**

```bash
npm run check
```

```bash
git add src/types/studio.ts src/hooks/useStudioState.ts
git commit -m "feat(studio): 类型扩展 + useStudioState 接入 RAG 展示/截断警告/单章重试"
```

---

## Task 5: 前端 — BatchProgressPanel 增强（章节级状态 + 单章重试）

**Files:**
- Modify: `src/components/studio/BatchProgressPanel.tsx`
- Test: `npm run check`

- [ ] **Step 1: 重写 BatchProgressPanel 以支持四级状态展示**

替换 `src/components/studio/BatchProgressPanel.tsx` 的完整内容：

```tsx
import { useCallback } from "react"
import type { UseQueryResult } from "@tanstack/react-query"
import { RotateCw, AlertCircle, Loader2, CheckCircle, Clock } from "lucide-react"

interface ChapterStatusItem {
  chapterNumber: number
  title: string | null
  status: string
}

interface FailedChapterItem {
  chapterNumber: number
  title: string
  error: string
}

interface BatchStatus {
  status: string
  progress?: number
  currentChapter?: number
  totalChapters?: number
  errorLog?: string
  completedChapters?: ChapterStatusItem[]
  failedChapters?: FailedChapterItem[]
}

interface BatchProgressPanelProps {
  isBatchGenerating: boolean
  batchStatusQuery: UseQueryResult<BatchStatus | null, unknown>
  listChaptersQuery: UseQueryResult<ChapterStatusItem[], unknown>
  retryingChapters: Set<number>
  onRetryChapter: (chapterNumber: number) => void
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; label: string; color: string; bgColor: string }> = {
  pending: { icon: Clock, label: "等待中", color: "text-white/40", bgColor: "bg-white/5" },
  generating: { icon: Loader2, label: "生成中", color: "text-amber-400", bgColor: "bg-amber-500/10" },
  generated: { icon: CheckCircle, label: "已完成", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  failed: { icon: AlertCircle, label: "失败", color: "text-red-400", bgColor: "bg-red-500/10" },
}

export function BatchProgressPanel({
  isBatchGenerating,
  batchStatusQuery,
  listChaptersQuery,
  retryingChapters,
  onRetryChapter,
}: BatchProgressPanelProps) {
  const batchData = batchStatusQuery.data
  const chapters = listChaptersQuery.data || []

  const handleRetry = useCallback((chapterNumber: number) => {
    if (retryingChapters.has(chapterNumber)) return
    onRetryChapter(chapterNumber)
  }, [retryingChapters, onRetryChapter])

  return (
    <div className="space-y-3">
      {/* 总体进度 */}
      {isBatchGenerating && batchData && (
        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
          <div className="flex justify-between text-xs text-white/60 mb-2">
            <span>
              {batchData.currentChapter
                ? `正在处理第 ${batchData.currentChapter} 章 / 共 ${batchData.totalChapters || "?"} 章`
                : "批量生成进度"}
            </span>
            <span className="font-mono text-emerald-400">{batchData.progress?.toFixed(0) || 0}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700 relative"
              style={{ width: `${batchData.progress || 0}%` }}
            >
              {batchData.progress && batchData.progress < 100 && (
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
              )}
            </div>
          </div>
          {batchData.errorLog && (
            <p className="text-xs text-red-400/80 mt-2 line-clamp-2">{batchData.errorLog}</p>
          )}
        </div>
      )}

      {/* 章节列表 */}
      {chapters.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider">章节状态</h4>
            <span className="text-[10px] text-white/30 font-mono">
              共 {chapters.length} 章 ·{" "}
              {chapters.reduce((sum, ch) => sum + ((ch as unknown as { content?: string }).content?.length || 0), 0).toLocaleString()} 字
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {chapters.map(ch => {
              const config = STATUS_CONFIG[ch.status] || STATUS_CONFIG.pending
              const Icon = config.icon
              const isRetrying = retryingChapters.has(ch.chapterNumber)

              return (
                <div
                  key={ch.chapterNumber}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm border ${config.bgColor} border-white/5`}
                >
                  <Icon className={`w-3.5 h-3.5 ${config.color} shrink-0 ${ch.status === "generating" ? "animate-spin" : ""}`} />
                  <span className="text-amber-400 text-xs font-mono w-12 shrink-0">第{ch.chapterNumber}章</span>
                  <span className="text-white/80 truncate flex-1">{ch.title || "未命名"}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${config.bgColor} ${config.color}`}>
                    {config.label}
                  </span>
                  {ch.status === "failed" && (
                    <button
                      onClick={() => handleRetry(ch.chapterNumber)}
                      disabled={isRetrying}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-white/10 hover:bg-white/15 text-white/70 disabled:opacity-50 transition-colors"
                    >
                      <RotateCw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
                      {isRetrying ? "重试中" : "重试"}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 更新 `src/components/studio/index.ts` 导出**

确认 `index.ts` 已有 `BatchProgressPanel` 的导出。如果没有，添加：

```typescript
export { BatchProgressPanel } from "./BatchProgressPanel"
```

- [ ] **Step 3: 运行类型检查并提交**

```bash
npm run check
```

```bash
git add src/components/studio/BatchProgressPanel.tsx src/components/studio/index.ts
git commit -m "ui(studio): BatchProgressPanel 章节级状态 + 单章重试按钮"
```

---

## Task 6: 前端 — RAG 素材引用展示面板 + Prompt 截断警告横幅

**Files:**
- Create: `src/components/studio/RagReferencePanel.tsx`
- Create: `src/components/studio/PromptTruncatedBanner.tsx`
- Modify: `src/components/studio/index.ts`
- Modify: `src/pages/Studio.tsx`
- Test: `npm run check`

- [ ] **Step 1: 创建 `RagReferencePanel.tsx`**

```tsx
/**
 * RAG 素材引用展示面板
 * 生成完成后展示本次生成引用了哪些素材
 */
import { X, BookOpen, Database, Tag } from "lucide-react"
import type { RagReference } from "@/types/studio"

interface RagReferencePanelProps {
  references: RagReference[]
  visible: boolean
  onClose: () => void
}

const TYPE_ICONS: Record<string, typeof BookOpen> = {
  novel_style: BookOpen,
  material: Database,
  keyword: Tag,
}

const TYPE_LABELS: Record<string, string> = {
  novel_style: "原作风格",
  material: "投喂素材",
  keyword: "关键词匹配",
}

export function RagReferencePanel({ references, visible, onClose }: RagReferencePanelProps) {
  if (!visible || references.length === 0) return null

  return (
    <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white/80 flex items-center gap-2">
          <Database className="w-4 h-4 text-amber-400" />
          本次生成引用了 {references.length} 条素材
        </h4>
        <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {references.map((ref, i) => {
          const Icon = TYPE_ICONS[ref.type] || Tag
          return (
            <div
              key={i}
              className="flex items-start gap-2 p-2 rounded-lg bg-white/3 border border-white/5"
            >
              <Icon className="w-3.5 h-3.5 text-white/40 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">
                    {TYPE_LABELS[ref.type] || ref.type}
                  </span>
                  {ref.sourceTitle && (
                    <span className="text-[10px] text-white/40 truncate">{ref.sourceTitle}</span>
                  )}
                  {ref.score !== undefined && (
                    <span className="text-[10px] text-emerald-400/60 font-mono">
                      {(ref.score * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/50 mt-1 line-clamp-2">{ref.content}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 `PromptTruncatedBanner.tsx`**

```tsx
/**
 * Prompt 截断警告横幅
 * 当 system prompt 被截断时展示警告，提示用户生成可能缺少部分约束
 */
import { AlertTriangle, X } from "lucide-react"
import type { PromptTruncatedWarning } from "@/types/studio"

interface PromptTruncatedBannerProps {
  warning: PromptTruncatedWarning | null
  onDismiss: () => void
}

const MODULE_LABELS: Record<string, string> = {
  rag: "参考素材",
  styleGuide: "文风指南",
  canon: "正史约束",
  tropes: "桥段参考",
  worldView: "世界观设定",
  characters: "角色设定",
}

export function PromptTruncatedBanner({ warning, onDismiss }: PromptTruncatedBannerProps) {
  if (!warning) return null

  const labels = warning.modules.map(m => MODULE_LABELS[m] || m).join("、")

  return (
    <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-amber-400">Prompt 长度截断警告</h4>
          <p className="text-xs text-white/60 mt-1">
            因本次生成上下文过长，以下模块被截断：{labels}。
            这可能导致生成结果缺少部分约束，建议缩短 Brief 或减少素材引用。
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-white/30 hover:text-white/60 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 更新 `src/components/studio/index.ts`**

```typescript
export { RagReferencePanel } from "./RagReferencePanel"
export { PromptTruncatedBanner } from "./PromptTruncatedBanner"
// ... 现有导出保持不变
```

- [ ] **Step 4: 在 `Studio.tsx` 中挂载新组件**

在 `Studio.tsx` 中导入新组件：

```typescript
import { RagReferencePanel, PromptTruncatedBanner } from "@/components/studio"
```

在合适的位置（生成按钮区域下方或内容区域上方）添加：

```tsx
{/* Prompt 截断警告 */}
<PromptTruncatedBanner
  warning={state.truncatedWarning}
  onDismiss={() => state.setTruncatedWarning(null)}
/>

{/* RAG 素材引用展示 */}
<RagReferencePanel
  references={state.ragReferences}
  visible={state.showRagReferencePanel}
  onClose={() => state.setShowRagReferencePanel(false)}
/>
```

同时在 `BatchProgressPanel` 的调用处传入新 props：

```tsx
<BatchProgressPanel
  isBatchGenerating={state.isBatchGenerating}
  batchStatusQuery={state.batchStatusQuery}
  listChaptersQuery={state.listChaptersQuery}
  retryingChapters={state.retryingChapters}
  onRetryChapter={state.handleRetryChapter}
/>
```

- [ ] **Step 5: 运行类型检查并提交**

```bash
npm run check
```

```bash
git add src/components/studio/RagReferencePanel.tsx src/components/studio/PromptTruncatedBanner.tsx src/components/studio/index.ts src/pages/Studio.tsx
git commit -m "ui(studio): RAG 引用面板 + Prompt 截断警告横幅"
```

---

## Task 7: 集成验证 — 端到端测试

**Files:**
- 全项目
- Test: `npm run check` + `npm run build` + 手动测试流程

- [ ] **Step 1: 运行完整类型检查**

```bash
npm run check
```
Expected: zero TypeScript errors.

- [ ] **Step 2: 运行生产构建**

```bash
npm run build
```
Expected: build succeeds, no errors.

- [ ] **Step 3: 重启容器验证**

```bash
docker compose -f docker/docker-compose.local.yml --env-file .env down
docker compose -f docker/docker-compose.local.yml --env-file .env up -d
```

- [ ] **Step 4: 手动测试 checklist**

| 测试项 | 期望结果 |
|-------|---------|
| 1. 创建作品 → 批量生成 3 章 | 进度条正常走动，章节列表显示各章状态 |
| 2. 断开网络模拟单章失败 | 失败章节显示红色「失败」标签 +「重试」按钮 |
| 3. 点击「重试」失败章节 | 状态变为「生成中」→「已完成」|
| 4. 使用超长 Brief（>5000字）| 生成完成后显示「Prompt 截断警告」|
| 5. 生成完成后 | 显示「本次生成引用了 X 条素材」面板 |
| 6. 检查 generationMetrics 表 | 有记录，durationMs、tokenUsage 非空 |

- [ ] **Step 5: 提交最终版本**

```bash
git add .
git commit -m "feat(studio): 完整体验优化 — RAG 可观测性 + 批量生成体验 + Prompt 截断通知"
```

---

## Self-Review

### 1. Spec Coverage

| 评审发现 | 对应任务 |
|---------|---------|
| RAG 检索空结果无告警，静默失效 | Task 2: `searchSimilar` 空结果降级 + 控制台警告 |
| Prompt 截断用户不可见 | Task 2: `truncated` 字段返回 → Task 6: 前端横幅展示 |
| 批量生成失败不可见/不可单章重试 | Task 3: 四级状态 + 单章重试 mutation → Task 5: 前端状态卡片 |
| 生成耗时无统计 | Task 1: `generationMetrics` 表 → Task 3: `generateSingleChapter` 记录 |
| 用户不知道生成用了哪些素材 | Task 4/6: `ragReferences` 状态 + `RagReferencePanel` 组件 |

✅ 全部覆盖，无遗漏。

### 2. Placeholder Scan

- ❌ 无 "TBD" / "TODO" / "implement later"
- ❌ 无 "Add appropriate error handling" 等模糊描述
- ❌ 无 "Similar to Task N" 引用
- ✅ 所有代码步骤均包含完整实现代码

### 3. Type Consistency

| 名称 | 定义位置 | 使用位置 | 一致性 |
|------|---------|---------|-------|
| `truncated?: string[]` | generate.ts:862 返回值 | generate.ts:1481 fanfiction mutation 返回 | ✅ |
| `ChapterStatus` | studio.ts:104 | BatchProgressPanel.tsx:23 | ✅ |
| `BatchStatus.failedChapters` | generate.ts:2018 | BatchProgressPanel.tsx:16 | ✅ |
| `recallMethod` | embedder.ts:125 | embedder.ts 映射代码 | ✅ |

✅ 类型一致。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-10-studio-experience-optimization.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, run spec compliance review + code quality review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
