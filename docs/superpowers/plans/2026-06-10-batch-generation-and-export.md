# 批量生成与导出 — 长篇小说创作工作流

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不影响任何现有 API 和 UI 的前提下，新增"确认大纲 → 一键批量生成多章 → 导出成书"的完整工作流，实现章节级存储、前文连贯性注入、持久化进度和导出功能。

**Architecture:** 新增 `fan_fiction_chapters` 表实现章节级存储；复用已有 `generation_jobs` 表持久化批量生成进度；通过 `previousContext` 参数向 `buildSystemPrompt` 注入前文，确保章节连贯；新增 `generate.batch`/`batchStatus`/`export` 端点，前端 Studio 大纲面板增加"批量生成"和"导出"按钮。

**Tech Stack:** TypeScript, Drizzle ORM, tRPC v11, Zod, React 19, PostgreSQL/pgvector

---

## 文件变更总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `db/schema.ts` | 修改 | 新增 `fanFictionChapters` 表 |
| `db/relations.ts` | 修改 | 添加 `fanFictionChapters` 关系 |
| `contracts/schemas.ts` | 修改 | 新增 `batchGenerationSchema`、`exportWorkSchema` |
| `api/routers/generate.ts` | 修改 | 新增 `batch`、`batchStatus`、`export` mutation；扩展 `buildSystemPrompt` 注入 `previousContext`；新增 `generateChapterContent` 辅助函数 |
| `src/pages/Studio.tsx` | 修改 | 大纲面板新增"批量生成"按钮和进度展示；新增"导出"按钮 |

---

## 设计决策与约束

### 向后兼容原则
- **不删除、不修改** 现有 `fanfiction` / `outline` / `continue` / `regenerate` / `updateWork` / `deleteWork` / `saveAsNovel` 的输入输出签名
- `fanFictionWorks.generatedContent` 继续保留，单章作品仍使用该字段
- 多章作品的单章内容写入 `fanFictionChapters`，`generatedContent` 可保持为空或存放第一章内容

### 批量生成执行模型
- 单用户 ECS 场景，无外部队列（Redis/BullMQ 被明确排除）
- `batch` mutation 立即返回 `jobId`，内部用 `setImmediate` 启动逐章生成循环
- 进度通过 `batchStatus` query 轮询（`generationJobs` 表）
- 服务器重启会丢失进行中的 batch，提供 `batch.retry` 从断点继续

### 前文连贯性注入规则
- 第 1 章无前文
- 第 N 章（N > 1）注入第 N-1 章最后 **800 字**作为 `previousContext`
- `previousContext` 作为可选参数传入 `buildSystemPrompt`，不影响现有调用

---

### Task 1: 数据库层 — 新增 fanFictionChapters 表

**Files:**
- Modify: `db/schema.ts`
- Modify: `db/relations.ts`

- [ ] **Step 1: 在 schema.ts 的 fanFictionWorks 表之后插入 fanFictionChapters 表定义**

在 `db/schema.ts` 第 169 行（`fanFictionWorks` 表结束）之后插入：

```typescript
// 二创作品章节表（支持多章节长篇小说）
export const fanFictionChapters = pgTable("fan_fiction_chapters", {
  id: serial("id").primaryKey(),
  workId: integer("work_id").notNull(),
  chapterNumber: integer("chapter_number").notNull(),
  title: varchar("title", { length: 500 }),
  content: text("content").notNull().default(""),
  brief: text("brief"), // 本章的独立 brief
  parameters: jsonb("parameters"),
  status: varchar("status", { length: 50 }).notNull().default("draft"), // draft / generated / edited
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})
```

- [ ] **Step 2: 在 schema.ts 的 generationJobs 表中扩展 metadata 字段**

找到已有的 `generationJobs` 表定义（约第 171-180 行），将 `result` 字段改为 `jsonb` 以支持结构化数据：

```typescript
// 将原来的：
//   result: text("result"),
// 改为：
  result: jsonb("result"),
  metadata: jsonb("metadata"), // ← 新增：存储 workId、totalChapters、currentChapter 等
```

完整 `generationJobs` 表应如下：

```typescript
export const generationJobs = pgTable("generation_jobs", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 50 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  progress: real("progress").notNull().default(0),
  result: jsonb("result"),
  errorLog: text("error_log"),
  metadata: jsonb("metadata"), // ← 新增
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
```

- [ ] **Step 3: 在 relations.ts 中添加 fanFictionChapters 关系**

在 `db/relations.ts` 中：
1. 导入 `fanFictionChapters`（添加到 import 列表）
2. 在 `fanFictionWorksRelations` 中添加 `chapters: many(fanFictionChapters)`
3. 新增 `fanFictionChaptersRelations`

修改 import 行（第 3-19 行）：

```typescript
import {
  novels,
  chapters,
  tags,
  novelTags,
  series,
  characterCards,
  worldBibles,
  seriesCanon,
  vectorChunks,
  translationMemory,
  fanFictionWorks,
  fanFictionChapters, // ← 新增
  materials,
  plotTropes,
  bookmarks,
  annotations,
  readingProgress,
} from "./schema"
```

修改 `fanFictionWorksRelations`（第 93-102 行）：

```typescript
export const fanFictionWorksRelations = relations(fanFictionWorks, ({ one, many }) => ({
  series: one(series, {
    fields: [fanFictionWorks.seriesId],
    references: [series.id],
  }),
  parentNovel: one(novels, {
    fields: [fanFictionWorks.parentNovelId],
    references: [novels.id],
  }),
  chapters: many(fanFictionChapters), // ← 新增
}))
```

在文件末尾添加：

```typescript
export const fanFictionChaptersRelations = relations(fanFictionChapters, ({ one }) => ({
  work: one(fanFictionWorks, {
    fields: [fanFictionChapters.workId],
    references: [fanFictionWorks.id],
  }),
}))
```

- [ ] **Step 4: 推送数据库变更**

Run: `npm run db:push`
Expected: `pgvector/pgvector:pg16` 容器连接成功，schema push 完成，无报错

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/relations.ts
git commit -m "db(schema): 新增 fan_fiction_chapters 表，扩展 generation_jobs metadata 字段"
```

---

### Task 2: 后端 — 新增批量生成与导出 Schema

**Files:**
- Modify: `contracts/schemas.ts`

- [ ] **Step 1: 在 contracts/schemas.ts 末尾追加 batch 和 export schema**

在文件末尾（`OutlineScene` 类型导出之后）追加：

```typescript
// 批量生成
export const batchChapterConfigSchema = z.object({
  chapterNumber: z.number().min(1),
  title: z.string().min(1),
  brief: z.string().min(1), // 本章创作指令
})

export const batchGenerationSchema = z.object({
  workId: z.number(),
  chapterConfigs: z.array(batchChapterConfigSchema).min(1).max(50), // 一次最多50章
  params: z.object({
    temperature: z.number().min(0).max(2).optional(),
    styleFidelity: z.number().min(1).max(10).optional(),
    characterLoyalty: z.number().min(1).max(10).optional(),
    tone: z.string().optional(),
    lengthTarget: z.enum(["short", "chapter", "arc"]).optional(),
    canonConstraint: z.enum(["strict", "loose", "au"]).optional(),
    writingMode: z.enum(["canon_continuation", "character_spinoff", "original_in_universe", "alternate_universe"]).optional(),
    ragLimit: z.number().min(1).max(10).optional(),
  }).optional(),
})

export type BatchChapterConfig = z.infer<typeof batchChapterConfigSchema>
export type BatchGenerationInput = z.infer<typeof batchGenerationSchema>

// 导出
export const exportWorkSchema = z.object({
  workId: z.number(),
  format: z.enum(["txt", "markdown"]).default("txt"),
})

export type ExportWorkInput = z.infer<typeof exportWorkSchema>
```

- [ ] **Step 2: 运行类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 3: Commit**

```bash
git add contracts/schemas.ts
git commit -m "contracts(schema): 新增 batchGenerationSchema 和 exportWorkSchema"
```

---

### Task 3: 后端 — 扩展 buildSystemPrompt 支持前文注入

**Files:**
- Modify: `api/routers/generate.ts`

- [ ] **Step 1: 修改 buildSystemPrompt 函数签名，新增 previousContext 参数**

找到 `buildSystemPrompt` 函数定义（约第 470 行附近），修改签名为：

```typescript
async function buildSystemPrompt(
  seriesId: number,
  brief: string,
  rawParams: Partial<GenParams>,
  parentNovelId?: number,
  userPrompt?: string,
  useMaterials?: boolean,
  materialIds?: number[],
  selectedCharacterIds?: number[],
  selectedTropeIds?: number[],
  hotkeyTropeIds?: number[],
  outlineSection?: string,
  previousContext?: string, // ← 新增：前文衔接上下文
): Promise<{ prompt: string; ragCalls: RagCall[]; warnings?: string[] }> {
```

- [ ] **Step 2: 在 buildSystemPrompt 的 prompt 组装阶段注入 previousContext**

在函数内部的 prompt 组装逻辑中（在 "核心任务" 部分之后、输出格式要求之前），找到 `parts` 数组组装的位置，添加：

```typescript
  // ← 新增：前文衔接（多章节连续生成时使用）
  if (previousContext) {
    parts.push(
      "【前文衔接】\n" +
      "以下是上一章的结尾部分，请确保本章内容在人物称谓、情节逻辑和语气上与此自然衔接。不要简单重复前文，而是以此为起点推进剧情：\n" +
      previousContext.slice(-800) // 只取最后 800 字，控制 prompt 长度
    )
  }
```

这段代码应插入在 `outlineSection` 注入之后、输出格式要求之前。找到 `if (outlineSection)` 块，在其后面添加 `if (previousContext)` 块。

- [ ] **Step 3: 运行类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 4: Commit**

```bash
git add api/routers/generate.ts
git commit -m "api(generate): buildSystemPrompt 支持 previousContext 前文衔接参数"
```

---

### Task 4: 后端 — 新增生成辅助函数与批量生成 API

**Files:**
- Modify: `api/routers/generate.ts`

- [ ] **Step 1: 在 generate.ts 中导入新增的 schema 和表**

在文件顶部 import 区域（第 1-8 行），修改 import 语句：

```typescript
import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { characterCards, worldBibles, seriesCanon, fanFictionWorks, fanFictionChapters, plotTropes, novels, chapters, ragFeedback, generationJobs } from "@db/schema" // ← 新增 fanFictionChapters 和 generationJobs
import { eq, asc, desc, sql } from "drizzle-orm"
import { streamChat, chatCompletion } from "../services/deepseek"
import { searchSimilar, getEmbeddingWithCache } from "../services/embedder"
import { outlineSchema, type Outline, batchGenerationSchema, type BatchGenerationInput, exportWorkSchema, type ExportWorkInput } from "@contracts/schemas" // ← 新增导入
```

- [ ] **Step 2: 在 generate.ts 中新增 getPreviousContext 辅助函数**

在 `completeProgress` / `failProgress` 函数之后（约第 36 行之后），插入：

```typescript
// 获取指定作品上一章的最后 N 字作为前文衔接上下文
async function getPreviousContext(workId: number, currentChapterNumber: number, tailLength = 800): Promise<string | undefined> {
  if (currentChapterNumber <= 1) return undefined
  const db = getDb()
  const [prevChapter] = await db
    .select({ content: fanFictionChapters.content })
    .from(fanFictionChapters)
    .where(eq(fanFictionChapters.workId, workId))
    .where(eq(fanFictionChapters.chapterNumber, currentChapterNumber - 1))
  return prevChapter?.content ? prevChapter.content.slice(-tailLength) : undefined
}
```

- [ ] **Step 3: 在 generate.ts 中新增 generateSingleChapter 辅助函数**

在 `getPreviousContext` 之后，插入一个封装单章生成的辅助函数：

```typescript
// 生成单章内容（被 batch 和前端逐章生成复用）
async function generateSingleChapter(
  workId: number,
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
  }
): Promise<{ content: string; ragCalls: RagCall[]; warnings?: string[] }> {
  // 构建 system prompt（复用现有逻辑）
  const { prompt, ragCalls, warnings } = await buildSystemPrompt(
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

  // 调用 AI 生成
  const response = await chatCompletion({
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `请创作第 ${chapterNumber} 章《${chapterTitle}》。要求：${chapterBrief}` },
    ],
    temperature: params.temperature ?? 0.8,
    maxTokens: params.lengthTarget === "short" ? 2000 : params.lengthTarget === "arc" ? 6000 : 4000,
  })

  // 清洗元话语
  const content = sanitizeGeneratedContent(response)

  return { content, ragCalls, warnings }
}

// 清洗 AI 生成内容中的元话语
function sanitizeGeneratedContent(text: string): string {
  const patterns = [
    /^(以下是[第\d]*章[：:]?\s*)/i,
    /^(第[一二三四五六七八九十百千\d]+章[：:]?\s*)/i,
    /^(本章[内容]*[：:]?\s*)/i,
    /^(正文[：:]?\s*)/i,
  ]
  let result = text.trim()
  for (const p of patterns) {
    result = result.replace(p, "")
  }
  return result.trim()
}
```

- [ ] **Step 4: 在 generate.ts 的 router 对象中新增 batch mutation**

在 `regenerate` mutation 之后（约第 1490 行）、`updateWork` 之前，插入：

```typescript
  batch: publicQuery
    .input(batchGenerationSchema)
    .mutation(async ({ input }) => {
      const db = getDb()

      // 1. 验证作品存在
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId))
      if (!work) throw new Error("作品不存在")
      if (!work.seriesId) throw new Error("作品未关联系列")

      // 2. 检查是否已有进行中的 batch
      const existingJobs = await db
        .select()
        .from(generationJobs)
        .where(sql`${generationJobs.metadata}->>'workId' = ${String(input.workId)}`)
        .where(eq(generationJobs.status, "running"))
      if (existingJobs.length > 0) {
        throw new Error(`已有进行中的批量生成任务（jobId: ${existingJobs[0].id}）`)
      }

      // 3. 创建 generationJobs 记录
      const [job] = await db
        .insert(generationJobs)
        .values({
          type: "batch",
          status: "running",
          progress: 0,
          metadata: {
            workId: input.workId,
            totalChapters: input.chapterConfigs.length,
            currentChapter: 0,
            chapterConfigs: input.chapterConfigs,
            params: input.params,
          },
        })
        .returning()

      // 4. 异步启动逐章生成（不阻塞 HTTP 响应）
      const runBatch = async () => {
        try {
          const workParams = (work.parameters ?? {}) as Partial<GenParams>
          const mergedParams = { ...workParams, ...input.params }

          for (let i = 0; i < input.chapterConfigs.length; i++) {
            const config = input.chapterConfigs[i]

            // 获取前文
            const previousContext = await getPreviousContext(input.workId, config.chapterNumber)

            // 检查是否已生成（支持断点续作）
            const [existing] = await db
              .select()
              .from(fanFictionChapters)
              .where(eq(fanFictionChapters.workId, input.workId))
              .where(eq(fanFictionChapters.chapterNumber, config.chapterNumber))

            if (existing && existing.status === "generated") {
              // 已生成，跳过
              continue
            }

            // 生成内容
            const { content } = await generateSingleChapter(
              input.workId,
              work.seriesId,
              config.chapterNumber,
              config.title,
              config.brief,
              mergedParams,
              {
                parentNovelId: work.parentNovelId ?? undefined,
                outlineSection: work.outline ? buildOutlineSection(work.outline as Outline) : undefined,
                previousContext,
              }
            )

            // 保存或更新章节
            if (existing) {
              await db
                .update(fanFictionChapters)
                .set({ content, status: "generated", updatedAt: new Date() })
                .where(eq(fanFictionChapters.id, existing.id))
            } else {
              await db.insert(fanFictionChapters).values({
                workId: input.workId,
                chapterNumber: config.chapterNumber,
                title: config.title,
                content,
                brief: config.brief,
                parameters: mergedParams,
                status: "generated",
              })
            }

            // 更新进度
            await db
              .update(generationJobs)
              .set({
                progress: ((i + 1) / input.chapterConfigs.length) * 100,
                metadata: {
                  workId: input.workId,
                  totalChapters: input.chapterConfigs.length,
                  currentChapter: config.chapterNumber,
                  chapterConfigs: input.chapterConfigs,
                  params: input.params,
                },
              })
              .where(eq(generationJobs.id, job.id))
          }

          // 完成
          await db
            .update(generationJobs)
            .set({ status: "completed", progress: 100 })
            .where(eq(generationJobs.id, job.id))

          // 更新作品状态
          await db
            .update(fanFictionWorks)
            .set({ status: "completed" })
            .where(eq(fanFictionWorks.id, input.workId))
        } catch (err) {
          await db
            .update(generationJobs)
            .set({ status: "failed", errorLog: String(err) })
            .where(eq(generationJobs.id, job.id))
        }
      }

      // 启动异步执行
      setImmediate(() => { runBatch().catch(console.error) })

      return { jobId: job.id }
    }),
```

- [ ] **Step 5: 在 generate.ts 中新增 batchStatus query**

在 `batch` mutation 之后，插入：

```typescript
  batchStatus: publicQuery
    .input(z.object({ jobId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [job] = await db
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.id, input.jobId))
      if (!job) throw new Error("任务不存在")

      // 查询已生成的章节列表
      const workId = job.metadata?.workId as number | undefined
      let completedChapters: Array<{ chapterNumber: number; title: string | null; status: string }> = []
      if (workId) {
        completedChapters = await db
          .select({
            chapterNumber: fanFictionChapters.chapterNumber,
            title: fanFictionChapters.title,
            status: fanFictionChapters.status,
          })
          .from(fanFictionChapters)
          .where(eq(fanFictionChapters.workId, workId))
          .orderBy(asc(fanFictionChapters.chapterNumber))
      }

      return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        errorLog: job.errorLog,
        currentChapter: (job.metadata as Record<string, unknown>)?.currentChapter as number | undefined,
        totalChapters: (job.metadata as Record<string, unknown>)?.totalChapters as number | undefined,
        completedChapters,
      }
    }),
```

- [ ] **Step 6: 在 generate.ts 中新增 batchRetry mutation**

在 `batchStatus` 之后，插入：

```typescript
  batchRetry: publicQuery
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [job] = await db
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.id, input.jobId))
      if (!job) throw new Error("任务不存在")
      if (job.status === "running") throw new Error("任务正在进行中，无需重试")

      const metadata = (job.metadata ?? {}) as Record<string, unknown>
      const workId = metadata.workId as number
      const chapterConfigs = metadata.chapterConfigs as BatchChapterConfig[]
      const params = metadata.params as Partial<GenParams> | undefined

      if (!workId || !chapterConfigs) throw new Error("任务元数据不完整，无法重试")

      // 重置为 running 状态
      await db
        .update(generationJobs)
        .set({ status: "running", errorLog: null, progress: 0 })
        .where(eq(generationJobs.id, job.id))

      // 重新触发 batch（复用相同逻辑，但简化调用）
      // 这里我们直接构造输入并复用 batch 的内部逻辑
      // 为了简化，直接返回新 jobId，让前端重新调用 batch
      return { message: "请使用相同的参数重新调用 batch" }
    }),
```

**注意**：`batchRetry` 实际上只是重置状态并提示前端重新调用 `batch`。更简洁的做法是前端直接重新调用 `batch` mutation（它本身支持断点跳过已生成章节）。所以 `batchRetry` 可以简化为：

```typescript
  batchRetry: publicQuery
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [job] = await db
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.id, input.jobId))
      if (!job) throw new Error("任务不存在")

      // 删除失败的 job 记录，让前端重新调用 batch
      await db.delete(generationJobs).where(eq(generationJobs.id, input.jobId))

      return { message: "已重置，请重新调用 batch" }
    }),
```

- [ ] **Step 7: 在 generate.ts 中新增 export mutation**

在 `batchRetry` 之后、`updateWork` 之前，插入：

```typescript
  export: publicQuery
    .input(exportWorkSchema)
    .mutation(async ({ input }) => {
      const db = getDb()

      // 查询作品
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId))
      if (!work) throw new Error("作品不存在")

      // 查询章节列表
      const chapterRows = await db
        .select()
        .from(fanFictionChapters)
        .where(eq(fanFictionChapters.workId, input.workId))
        .orderBy(asc(fanFictionChapters.chapterNumber))

      // 如果没有章节记录，回退到 generatedContent（单章作品兼容）
      if (chapterRows.length === 0 && work.generatedContent) {
        return {
          content: work.generatedContent,
          filename: `${work.title || "export"}.${input.format}`,
          chapterCount: 1,
        }
      }

      if (chapterRows.length === 0) {
        throw new Error("作品内容为空，无内容可导出")
      }

      // 组装导出内容
      let content = ""
      if (input.format === "txt") {
        content = `《${work.title || "未命名作品"}》\n\n`
        content += `简介：${work.brief || "无"}\n\n`
        content += `===\n\n`
        for (const ch of chapterRows) {
          content += `第${ch.chapterNumber}章 ${ch.title || ""}\n\n`
          content += ch.content + "\n\n"
        }
      } else {
        content = `# ${work.title || "未命名作品"}\n\n`
        content += `> ${work.brief || ""}\n\n`
        content += `---\n\n`
        for (const ch of chapterRows) {
          content += `## 第${ch.chapterNumber}章 ${ch.title || ""}\n\n`
          content += ch.content + "\n\n"
        }
      }

      return {
        content,
        filename: `${work.title || "export"}.${input.format}`,
        chapterCount: chapterRows.length,
      }
    }),
```

- [ ] **Step 8: 在 generate.ts 中新增 listChapters query**

在 `export` 之后，插入一个查询作品章节的 API：

```typescript
  listChapters: publicQuery
    .input(z.object({ workId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const rows = await db
        .select()
        .from(fanFictionChapters)
        .where(eq(fanFictionChapters.workId, input.workId))
        .orderBy(asc(fanFictionChapters.chapterNumber))
      return rows
    }),
```

- [ ] **Step 9: 运行类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 10: Commit**

```bash
git add api/routers/generate.ts contracts/schemas.ts
git commit -m "api(generate): 新增 batch/batchStatus/batchRetry/export/listChapters 端点，支持多章节批量生成与导出"
```

---

### Task 5: 前端 — Studio 批量生成 UI

**Files:**
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: 新增批量生成相关的 tRPC hooks**

在 Studio.tsx 的 tRPC hooks 区域（现有 hooks 附近），新增：

```typescript
const batchMutation = trpc.generate.batch.useMutation()
const batchStatusQuery = trpc.generate.batchStatus.useQuery(
  { jobId: batchJobId },
  { enabled: batchJobId > 0, refetchInterval: 2000 }
)
const listChaptersQuery = trpc.generate.listChapters.useQuery(
  { workId: generatedWorkId || 0 },
  { enabled: !!generatedWorkId }
)
```

同时新增 state：

```typescript
const [batchJobId, setBatchJobId] = useState<number>(0)
const [isBatchGenerating, setIsBatchGenerating] = useState(false)
```

- [ ] **Step 2: 新增 handleBatchGenerate 函数**

在 `handleGenerate` 函数之后，插入：

```typescript
const handleBatchGenerate = async () => {
  if (!generatedWorkId) {
    toast.error("请先保存作品")
    return
  }
  if (!outlineScenes || outlineScenes.length === 0) {
    toast.error("请先生成或创建大纲场景")
    return
  }

  // 构建 chapterConfigs（从 outlineScenes 转换）
  const chapterConfigs = outlineScenes.map((scene, index) => ({
    chapterNumber: index + 1,
    title: scene.title,
    brief: scene.description,
  }))

  try {
    setIsBatchGenerating(true)
    const result = await batchMutation.mutateAsync({
      workId: generatedWorkId,
      chapterConfigs,
      params: {
        temperature: params.temperature,
        styleFidelity: params.styleFidelity,
        characterLoyalty: params.characterLoyalty,
        tone: params.tone,
        lengthTarget: params.lengthTarget,
        canonConstraint: params.canonConstraint,
        writingMode: params.writingMode,
        ragLimit: params.ragLimit,
      },
    })
    setBatchJobId(result.jobId)
    toast.success(`批量生成已启动（jobId: ${result.jobId}）`)
  } catch (err) {
    toast.error(String(err))
    setIsBatchGenerating(false)
  }
}
```

- [ ] **Step 3: 在批量生成完成后重置状态**

添加 `useEffect` 监听 batch 进度：

```typescript
useEffect(() => {
  if (batchStatusQuery.data?.status === "completed") {
    setIsBatchGenerating(false)
    toast.success("批量生成完成！")
    listChaptersQuery.refetch()
  } else if (batchStatusQuery.data?.status === "failed") {
    setIsBatchGenerating(false)
    toast.error(`批量生成失败：${batchStatusQuery.data.errorLog}`)
  }
}, [batchStatusQuery.data])
```

- [ ] **Step 4: 在大纲面板中新增"批量生成"按钮**

在大纲面板的"确认并生成正文"按钮旁边（或下方），新增批量生成按钮：

```tsx
{outlineScenes && outlineScenes.length > 0 && (
  <div className="flex gap-2 mt-3">
    <button
      onClick={handleGenerate}
      disabled={isGenerating || !generatedWorkId}
      className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-lg text-sm font-medium text-black transition-colors"
    >
      {isGenerating ? "生成中..." : "确认并生成正文"}
    </button>
    <button
      onClick={handleBatchGenerate}
      disabled={isBatchGenerating || !generatedWorkId}
      className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg text-sm font-medium text-black transition-colors"
    >
      {isBatchGenerating
        ? `批量生成中 (${batchStatusQuery.data?.progress?.toFixed(0) || 0}%)`
        : `一键生成 ${outlineScenes.length} 章`}
    </button>
  </div>
)}
```

- [ ] **Step 5: 新增批量生成进度展示**

在大纲面板下方添加进度条：

```tsx
{isBatchGenerating && batchStatusQuery.data && (
  <div className="mt-3 space-y-2">
    <div className="flex justify-between text-xs text-white/60">
      <span>批量生成进度</span>
      <span>{batchStatusQuery.data.progress?.toFixed(0) || 0}%</span>
    </div>
    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full bg-emerald-500 transition-all duration-500"
        style={{ width: `${batchStatusQuery.data.progress || 0}%` }}
      />
    </div>
    {batchStatusQuery.data.completedChapters && batchStatusQuery.data.completedChapters.length > 0 && (
      <div className="text-xs text-white/40">
        已完成：{batchStatusQuery.data.completedChapters.map(c => `第${c.chapterNumber}章`).join("、")}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 6: 新增章节列表展示（生成完成后）**

在内容编辑区域上方或大纲面板下方，新增章节列表：

```tsx
{listChaptersQuery.data && listChaptersQuery.data.length > 0 && (
  <div className="mt-4 space-y-1">
    <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider">已生成章节</h4>
    <div className="max-h-40 overflow-y-auto space-y-1">
      {listChaptersQuery.data.map(ch => (
        <div
          key={ch.id}
          className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5 text-sm"
        >
          <span className="text-amber-400 text-xs">第{ch.chapterNumber}章</span>
          <span className="text-white/80 truncate">{ch.title || "未命名"}</span>
          <span className="ml-auto text-xs text-white/30">
            {ch.status === "generated" ? "✓" : ch.status}
          </span>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 7: 运行类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 8: Commit**

```bash
git add src/pages/Studio.tsx
git commit -m "feat(studio): 大纲面板新增批量生成 UI 和进度展示"
```

---

### Task 6: 前端 — Studio 导出功能

**Files:**
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: 新增导出 mutation hook**

在现有的 hooks 区域添加：

```typescript
const exportMutation = trpc.generate.export.useMutation()
```

- [ ] **Step 2: 新增 handleExport 函数**

```typescript
const handleExport = async (format: "txt" | "markdown" = "txt") => {
  if (!generatedWorkId) {
    toast.error("没有可导出的作品")
    return
  }

  try {
    const result = await exportMutation.mutateAsync({
      workId: generatedWorkId,
      format,
    })

    // 创建下载
    const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = result.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success(`已导出 ${result.chapterCount} 章`)
  } catch (err) {
    toast.error(String(err))
  }
}
```

- [ ] **Step 3: 在 Studio 操作栏新增导出按钮**

在保存按钮附近（或内容编辑区域顶部工具栏），新增导出按钮组：

```tsx
<div className="flex items-center gap-2">
  <button
    onClick={() => handleExport("txt")}
    disabled={exportMutation.isPending || (!content && !listChaptersQuery.data?.length)}
    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-lg text-xs text-white/70 transition-colors flex items-center gap-1.5"
  >
    <Download className="w-3.5 h-3.5" />
    导出 TXT
  </button>
  <button
    onClick={() => handleExport("markdown")}
    disabled={exportMutation.isPending || (!content && !listChaptersQuery.data?.length)}
    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-lg text-xs text-white/70 transition-colors flex items-center gap-1.5"
  >
    <FileText className="w-3.5 h-3.5" />
    导出 MD
  </button>
</div>
```

注意：需要确保 `Download` 和 `FileText` 从 `lucide-react` 导入。检查 Studio.tsx 的现有 import，如果没有则添加。

- [ ] **Step 4: 运行类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 5: Commit**

```bash
git add src/pages/Studio.tsx
git commit -m "feat(studio): 新增导出 TXT/Markdown 功能"
```

---

### Task 7: 集成验证与回归测试

- [ ] **Step 1: 类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 2: 生产构建**

Run: `npm run build`
Expected: 构建成功，无报错

- [ ] **Step 3: 验证现有 API 未被破坏**

确认以下现有 API 的输入输出签名**完全没有改变**：
- `generate.fanfiction`
- `generate.outline`
- `generate.continue`
- `generate.regenerate`
- `generate.updateWork`
- `generate.deleteWork`
- `generate.saveAsNovel`

快速验证方法：检查 `generate.ts` 中这些 mutation 的 `input` schema 和返回值类型是否与修改前一致。

- [ ] **Step 4: 验证数据库 schema**

Run: `npx drizzle-kit push --config drizzle.config.ts`
Expected: `fan_fiction_chapters` 表成功创建，`generation_jobs` 表新增 `metadata` 和修改 `result` 字段

- [ ] **Step 5: Commit 最终版本**

```bash
git add -A
git commit -m "feat(generate): 完成批量生成与导出迭代 — 章节级存储、前文连贯性、持久化进度"
```

---

## Self-Review

**1. Spec coverage:**

| 需求 | 覆盖任务 |
|------|---------|
| 章节级存储 | Task 1: fanFictionChapters 表 |
| 批量生成 API | Task 4: batch mutation |
| 持久化进度 | Task 4: batchStatus + generationJobs 表 |
| 前文连贯性 | Task 3: previousContext 参数 |
| 导出功能 | Task 4 + 6: export mutation + 前端下载 |
| 断点续作 | Task 4: batch 自动跳过已生成章节 |
| 向后兼容 | 全程: 不修改现有 API 签名 |

**2. Placeholder scan:**
- 无 TBD/TODO/"implement later"
- 无 "add appropriate error handling" 等模糊表述
- 所有代码片段完整可直接使用

**3. Type consistency:**
- `BatchChapterConfig` / `BatchGenerationInput` / `ExportWorkInput` 类型在 contracts 中定义，后端和前端共用
- `fanFictionChapters` 表名和字段名在 schema、relations、generate router 中一致
- `previousContext` 参数类型为 `string | undefined`，与调用处一致

**未纳入本迭代的建议功能（后续迭代）：**
- `batch.retry` 的完整断点续作逻辑（当前仅重置 job）
- 章节级编辑 UI（当前仅展示列表，编辑仍走单章模式）
- 多版本对比（A/B 测试）
- 全局搜索
- 一致性检查 Linter
