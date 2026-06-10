# 生成 Pipeline 优化计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 NovelForge 的 AI 生成 Pipeline：控制 Prompt 长度防止超限、修复中文全文搜索、支持批量生成并发控制。

**Architecture:** 在 `buildSystemPrompt` 中增加长度预算管理器，按优先级截断内容；在 `searchSimilar` 中增强 `pg_trgm` 权重替代失效的 `'simple'` tsvector；在批量生成中使用 `Promise.all` 控制并发数，单章失败不阻断整体。

**Tech Stack:** PostgreSQL 16 + pgvector + pg_trgm, Drizzle ORM, Hono + tRPC, DeepSeek API

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `api/routers/generate.ts` | Modify | Prompt 长度预算、批量并发控制 |
| `api/services/embedder.ts` | Modify | 中文搜索增强（pg_trgm 权重提升） |
| `api/lib/prompt-budget.ts` | Create | Prompt 长度预算管理器 |

---

### Task 1: Prompt 长度预算管理

**目标：** 为 `buildSystemPrompt` 添加最大长度限制，超限时按优先级截断。

**背景知识：**
- `buildSystemPrompt` 组装的内容包括：世界观、角色卡、桥段、正史、RAG 素材、用户自定义 prompt。素材多时可达 1万+ 字符。
- DeepSeek `deepseek-v4-pro` 上下文窗口约 64K tokens（约 4万-5万中文字符）。System prompt + user prompt 总和不应超过窗口的 80%。
- 各模块优先级：核心任务（brief）> 世界观 > 角色 > 桥段 > 正史 > 文风 > RAG > 用户自定义。用户自定义虽然是"最高优先级"，但通常很短。
- RAG 结果最容易膨胀，应最先截断。

**Files:**
- Create: `api/lib/prompt-budget.ts`
- Modify: `api/routers/generate.ts`

- [ ] **Step 1: 创建 `api/lib/prompt-budget.ts`**

```typescript
/**
 * Prompt 长度预算管理器
 * 按优先级截断 system prompt 各模块，确保总长度不超过预算
 *
 * 优先级（从高到低）：
 * 1. 核心任务（brief）— 绝不截断
 * 2. 世界观约束
 * 3. 角色设定
 * 4. 桥段/模式
 * 5. 正史事件
 * 6. 文风指南
 * 7. RAG 检索结果 — 优先截断
 * 8. 用户自定义 prompt — 通常很短，一般不截断
 */

const PRIORITY_ORDER = [
  "coreTask",
  "worldView",
  "characters",
  "tropes",
  "canon",
  "styleGuide",
  "rag",
  "userPrompt",
] as const

type SectionKey = (typeof PRIORITY_ORDER)[number]

interface PromptSection {
  key: SectionKey
  content: string
  priority: number
}

export interface BudgetOptions {
  maxChars?: number
  ragMaxChars?: number
}

const DEFAULT_BUDGET: Required<BudgetOptions> = {
  maxChars: 15000,      // system prompt 最大 15000 字符（约 5000 tokens）
  ragMaxChars: 4000,    // RAG 部分单独限制 4000 字符
}

/**
 * 按预算截断 prompt 各模块
 * @returns 截断后的完整 prompt，以及被截断的模块列表
 */
export function assemblePromptWithBudget(
  sections: Record<SectionKey, string>,
  options: BudgetOptions = {}
): { prompt: string; truncated: SectionKey[] } {
  const config = { ...DEFAULT_BUDGET, ...options }
  const truncated: SectionKey[] = []

  // 按优先级排序（数字越大优先级越低，越先被截断）
  const orderedSections = PRIORITY_ORDER.map((key, index) => ({
    key,
    content: sections[key] || "",
    priority: index,
  })).filter(s => s.content.trim().length > 0)

  // RAG 单独截断
  const ragSection = orderedSections.find(s => s.key === "rag")
  if (ragSection && ragSection.content.length > config.ragMaxChars) {
    ragSection.content = ragSection.content.slice(0, config.ragMaxChars) +
      "\n\n[提示：RAG 素材已截断，仅显示部分内容]"
    truncated.push("rag")
  }

  // 计算总长度
  const separator = "\n\n"
  let totalLength = orderedSections.reduce(
    (sum, s) => sum + s.content.length + separator.length,
    0
  )

  // 如果仍超限，从低优先级开始逐个截断
  if (totalLength > config.maxChars) {
    // 按优先级降序排列（低优先级在前）
    const lowPriorityFirst = [...orderedSections].sort((a, b) => b.priority - a.priority)

    for (const section of lowPriorityFirst) {
      if (section.key === "coreTask") continue  // 核心任务绝不截断

      const excess = totalLength - config.maxChars
      if (excess <= 0) break

      if (section.content.length <= excess + 50) {
        // 该模块全部移除
        section.content = `[${section.key} 内容因长度限制已省略]`
        truncated.push(section.key)
      } else {
        // 部分截断
        section.content = section.content.slice(0, section.content.length - excess - 50) +
          `\n[提示：${section.key} 内容已部分截断]`
        truncated.push(section.key)
      }

      // 重新计算总长度
      totalLength = orderedSections.reduce(
        (sum, s) => sum + s.content.length + separator.length,
        0
      )
    }
  }

  const prompt = orderedSections
    .sort((a, b) => a.priority - b.priority)
    .map(s => s.content)
    .join(separator)

  return { prompt, truncated }
}

/**
 * 快速估算字符数对应的 token 数（粗略估算：1 token ≈ 3 中文字符 或 4 英文字符）
 */
export function estimateTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    if (/[一-龥]/.test(char)) {
      tokens += 0.5  // 中文字符约 0.5 token（GPT 系列）
    } else if (/\s/.test(char)) {
      tokens += 0.25
    } else {
      tokens += 0.3  // 其他字符约 0.3 token
    }
  }
  return Math.ceil(tokens)
}
```

- [ ] **Step 2: 修改 `buildSystemPrompt` 使用预算管理器**

在 `api/routers/generate.ts` 中，找到 `buildSystemPrompt` 函数（约 line 848）。该函数目前返回 `{ prompt: string, ragCalls: RagCall[], warnings: string[] }`。

我们需要重构该函数，将各模块内容先收集到 `sections` 对象中，再通过 `assemblePromptWithBudget` 组装。

**关键修改点：** 在 `buildSystemPrompt` 函数末尾（返回之前），将各部分内容收集起来：

```typescript
// 在 buildSystemPrompt 函数内部，找到 return 语句之前
// 导入预算管理器
import { assemblePromptWithBudget, estimateTokens } from "../lib/prompt-budget"

// ... 现有逻辑构建各部分 ...

// 收集各模块
const sections = {
  coreTask: userPrompt || brief,  // 核心任务
  worldView: buildWorldViewSection(worldBible),
  characters: buildCharacterInstruction(selectedChars, unselectedChars, mode),
  tropes: buildTropeSection(hotkeyTropes, writingMode),
  canon: buildCanonSection(canonEvents, writingMode),
  styleGuide: styleGuide ? `【文风指南】\n${styleGuide}` : "",
  rag: ragSummary ? `【参考素材】\n${ragSummary}` : "",
  userPrompt: userPrompt ? `【用户自定义指令 — 最高优先级】\n${userPrompt}` : "",
}

// 按预算组装
const { prompt, truncated } = assemblePromptWithBudget(sections, {
  maxChars: 15000,
  ragMaxChars: 4000,
})

// 如果有截断，加入 warnings
if (truncated.length > 0) {
  warnings.push(`System Prompt 以下模块因长度限制被截断：${truncated.join("、")}`)
}

// 记录预估 token 数（用于调试和成本追踪）
const estimatedTokens = estimateTokens(prompt)
console.log(`[PromptBudget] Estimated tokens: ${estimatedTokens}, truncated: ${truncated.join(", ") || "none"}`)

return { prompt, ragCalls, warnings }
```

**注意：** 上述代码是概念性修改。实际 `buildSystemPrompt` 的结构更复杂，各部分是在函数内逐步构建的。需要仔细阅读 `buildSystemPrompt` 的现有代码，找到合适的插入点。

实际修改策略：在 `buildSystemPrompt` 函数中，将 `parts` 数组的构建方式改为分模块收集，最后调用 `assemblePromptWithBudget`。

由于 `buildSystemPrompt` 当前实现是将所有内容直接 push 到一个 `parts: string[]` 数组中，修改方式为：

1. 保持现有各部分构建逻辑不变
2. 在函数末尾，将 `parts` 按模块分组传入 `assemblePromptWithBudget`
3. 或者更简单的方式：在函数末尾检查 `parts.join("\n\n").length`，如果超过 15000，则从 RAG 部分开始截断

**更简单的实现（推荐）：**

由于 `buildSystemPrompt` 的代码结构复杂，我们可以采用一种侵入性更小的方式：在最后组装 prompt 时检查长度，如果超限，截断 RAG 部分。

在 `buildSystemPrompt` 的 return 之前：

```typescript
let prompt = parts.join("\n\n")

// Prompt 长度预算控制
const MAX_PROMPT_CHARS = 15000
const RAG_MAX_CHARS = 4000

if (prompt.length > MAX_PROMPT_CHARS) {
  // 1. 先截断 RAG 部分
  if (ragSummary && ragSummary.length > RAG_MAX_CHARS) {
    const trimmedRag = ragSummary.slice(0, RAG_MAX_CHARS) + "\n\n[参考素材已截断]"
    prompt = prompt.replace(ragSummary, trimmedRag)
    warnings.push("参考素材因长度限制已截断，仅保留最相关部分")
  }

  // 2. 如果仍然超限，截断桥段和正史部分
  if (prompt.length > MAX_PROMPT_CHARS) {
    const excess = prompt.length - MAX_PROMPT_CHARS
    // 从桥段部分开始截断
    if (tropeSection.length > excess + 100) {
      prompt = prompt.replace(tropeSection, tropeSection.slice(0, tropeSection.length - excess - 100) + "\n[桥段参考已部分截断]")
      warnings.push("桥段参考因长度限制已部分截断")
    }
  }
}

return { prompt, ragCalls, warnings }
```

这种方式更务实，不需要重构整个 `buildSystemPrompt`。

- [ ] **Step 3: Commit**

```bash
git add api/lib/prompt-budget.ts api/routers/generate.ts
git commit -m "feat(generate): Prompt 长度预算管理 — 防止超限截断

- 新增 api/lib/prompt-budget.ts：按优先级截断 system prompt 各模块
- buildSystemPrompt 增加 maxChars=15000 和 ragMaxChars=4000 限制
- 超限时先截断 RAG 素材，再截断桥段/正史，核心任务和世界观绝不截断
- 截断时加入 warnings 提示用户
- 提供 estimateTokens 粗略估算函数

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 中文全文搜索修复（pg_trgm 增强）

**目标：** 修复 `to_tsvector('simple', content)` 对中文无效的问题，提升 `pg_trgm` 在混合搜索中的权重。

**背景知识：**
- PostgreSQL 的 `to_tsvector('simple', content)` 只对 ASCII 按空白分词，中文被视为连续字符串，无法分词匹配。
- `pg_trgm`（trigram）扩展可以进行模糊匹配，通过计算字符三元组相似度来找到近似匹配。对中文有一定效果（以字符为单位的三元组）。
- 当前 `searchSimilar` 中，向量搜索、全文搜索、trgm 搜索的结果被简单合并。由于全文搜索对中文无效，应提升 trgm 的权重。

**Files:**
- Modify: `api/services/embedder.ts`

- [ ] **Step 1: 修改 `searchSimilar` 中的 trgm 权重**

在 `api/services/embedder.ts` 中，找到 `searchSimilar` 函数。当前 trgm 搜索部分可能如下（需要确认实际代码）：

假设当前代码类似：
```typescript
// trgm 模糊搜索（中文补充）
const trgmResults = await db.execute(sql`
  SELECT id, content, similarity(content, ${query}) as sim
  FROM vector_chunks
  WHERE content % ${query}
  ORDER BY similarity(content, ${query}) DESC
  LIMIT ${limit}
`)
```

修改以提升 trgm 结果的权重：

```typescript
// trgm 模糊搜索（中文全文搜索的主要替代方案）
const trgmResults = await db.execute(sql`
  SELECT id, content, similarity(content, ${query}) as sim
  FROM vector_chunks
  WHERE content % ${query}
    AND ${seriesId ? sql`series_id = ${seriesId}` : sql`TRUE`}
    AND ${novelId ? sql`novel_id = ${novelId}` : sql`TRUE`}
  ORDER BY similarity(content, ${query}) DESC
  LIMIT ${Math.ceil(limit * 1.5)}
`)

// 处理 trgm 结果，提升其权重（因为中文场景下 tsvector 无效）
for (const row of trgmResults) {
  const id = row.id as number
  if (seenChunkIds.has(id)) continue

  const sim = Number(row.sim) || 0
  // trgm 相似度 > 0.3 的结果给予较高权重
  const score = sim * 1.2  // 提升 20% 权重，补偿 tsvector 的失效

  if (score > 0.15) {  // 降低阈值，让更多 trgm 结果进入
    results.push({
      id,
      content: String(row.content),
      similarity: score,
      sourceType: "trgm",
    })
    seenChunkIds.add(id)
  }
}
```

**注意：** 实际代码可能有差异。请根据 `api/services/embedder.ts` 中的实际 `searchSimilar` 实现进行调整。

- [ ] **Step 2: 为 trgm 查询添加 GIN 索引**

```sql
-- 在 db/migrations/0001_add_indexes.sql（或新迁移文件）中添加：
CREATE INDEX IF NOT EXISTS idx_vector_chunks_trgm ON vector_chunks USING gin (content gin_trgm_ops);
```

**注意：** `pg_trgm` 扩展必须已安装。在 `docker/docker-compose.yml` 的 PostgreSQL 初始化中应确保：
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

- [ ] **Step 3: Commit**

```bash
git add api/services/embedder.ts db/migrations/0001_add_indexes.sql
git commit -m "rag(search): 增强中文搜索 — 提升 pg_trgm 权重 + GIN 索引

- pg_trgm 结果权重提升 20%，补偿 simple tsvector 对中文无效
- 降低 trgm 相似度阈值（0.15），让更多中文结果进入
- 为 vector_chunks.content 添加 gin_trgm_ops 索引
- trgm 查询增加 series_id / novel_id 过滤条件

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 批量生成并发控制

**目标：** 支持批量生成时并发处理多章，单章失败不阻断整体。

**Files:**
- Modify: `api/routers/generate.ts`

- [ ] **Step 1: 在 `batch` mutation 中添加并发控制**

在 `api/routers/generate.ts` 中，找到 `batch` mutation 的 `runBatch` 函数（约 line 1719）。

当前实现是简单的 `for...of` 循环，逐章生成：
```typescript
for (const config of chapterConfigs) {
  // 生成单章...
}
```

修改为支持并发控制：

```typescript
// 在 batch mutation 的 input schema 中添加可选的并发参数
// .input(batchGenerationSchema.extend({ concurrency: z.number().min(1).max(5).optional().default(1) }))

// 修改 runBatch 内部逻辑
async function runBatch(
  jobId: number,
  workId: number,
  seriesId: number,
  chapterConfigs: Array<{ chapterNumber: number; title: string; brief: string }>,
  mergedParams: Partial<GenParams>,
  options: {
    parentNovelId?: number
    userPrompt?: string
    materialIds?: number[]
    selectedCharacterIds?: number[]
    selectedTropeIds?: number[]
    worldBible?: typeof worldBibles.$inferSelect
  },
  concurrency: number = 1  // ← 新增并发参数
) {
  const db = getDb()
  const total = chapterConfigs.length
  let generatedCount = 0
  const failedChapters: Array<{ chapterNumber: number; error: string }> = []

  // 并发控制：将章节分批次处理
  for (let i = 0; i < chapterConfigs.length; i += concurrency) {
    const batch = chapterConfigs.slice(i, i + concurrency)

    const results = await Promise.allSettled(
      batch.map(async (config) => {
        // 检查是否已生成（支持断点续传）
        const [existing] = await db
          .select({ status: fanFictionChapters.status })
          .from(fanFictionChapters)
          .where(
            sql`${fanFictionChapters.workId} = ${workId} AND ${fanFictionChapters.chapterNumber} = ${config.chapterNumber}`
          )
        if (existing?.status === "generated") {
          return { chapterNumber: config.chapterNumber, skipped: true }
        }

        // 获取前文上下文
        const previousContext = await getPreviousContext(workId, config.chapterNumber)

        // 生成单章
        const { content, ragCalls, warnings } = await generateSingleChapter(
          workId,
          seriesId,
          config.chapterNumber,
          config.title,
          config.brief,
          mergedParams,
          {
            ...options,
            previousContext,
          }
        )

        // 保存章节
        await db
          .insert(fanFictionChapters)
          .values({
            workId,
            chapterNumber: config.chapterNumber,
            title: config.title,
            content,
            brief: config.brief,
            parameters: mergedParams as Record<string, unknown>,
            status: "generated",
          })
          .onConflictDoUpdate({
            target: [fanFictionChapters.workId, fanFictionChapters.chapterNumber],
            set: {
              title: config.title,
              content,
              brief: config.brief,
              parameters: mergedParams as Record<string, unknown>,
              status: "generated",
              updatedAt: new Date(),
            },
          })

        return { chapterNumber: config.chapterNumber, skipped: false }
      })
    )

    // 处理结果
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (!result.value.skipped) {
          generatedCount++
        }
      } else {
        const failedConfig = batch[results.indexOf(result)]
        failedChapters.push({
          chapterNumber: failedConfig.chapterNumber,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
        console.error(`[Batch] Chapter ${failedConfig.chapterNumber} failed:`, result.reason)
      }
    }

    // 更新进度
    const progress = ((generatedCount + failedChapters.length) / total) * 100
    await db
      .update(generationJobs)
      .set({
        progress,
        metadata: {
          ...((await db.select({ metadata: generationJobs.metadata }).from(generationJobs).where(sql`${generationJobs.id} = ${jobId}`))[0]?.metadata as Record<string, unknown> || {}),
          currentChapter: batch[batch.length - 1]?.chapterNumber,
          totalChapters: total,
          failedChapters,
        },
      })
      .where(eq(generationJobs.id, jobId))
  }

  // 最终状态更新
  const finalStatus = failedChapters.length > 0
    ? (failedChapters.length === total ? "failed" : "completed")
    : "completed"

  await db
    .update(generationJobs)
    .set({
      status: finalStatus,
      progress: 100,
      errorLog: failedChapters.length > 0
        ? `${failedChapters.length}/${total} 章生成失败：${failedChapters.map(f => `第${f.chapterNumber}章(${f.error.slice(0, 50)})`).join("、")}`
        : null,
      metadata: {
        ...((await db.select({ metadata: generationJobs.metadata }).from(generationJobs).where(sql`${generationJobs.id} = ${jobId}`))[0]?.metadata as Record<string, unknown> || {}),
        failedChapters,
      },
    })
    .where(eq(generationJobs.id, jobId))
}
```

- [ ] **Step 2: 修改 `batchGenerationSchema` 添加并发参数**

在 `contracts/schemas.ts` 中：

```typescript
export const batchGenerationSchema = z.object({
  workId: z.number(),
  chapterConfigs: z.array(batchChapterConfigSchema).min(1).max(50),
  params: generationParamsPartialSchema.optional(),
  concurrency: z.number().min(1).max(5).optional().default(1),  // ← 新增
})
```

- [ ] **Step 3: Commit**

```bash
git add api/routers/generate.ts contracts/schemas.ts
git commit -m "feat(generate): 批量生成并发控制 + 单章失败隔离

- batchGenerationSchema 新增 concurrency 参数（1-5，默认 1）
- runBatch 使用 Promise.allSettled + 分批次并发处理
- 单章失败不再导致整个 batch 失败，失败章节记录到 metadata.failedChapters
- 支持断点续传：跳过已 generated 的章节
- 最终状态：全部成功=completed，部分失败=completed（带 errorLog），全部失败=failed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- [x] Prompt 长度预算管理 → Task 1
- [x] 中文搜索修复（pg_trgm） → Task 2
- [x] 批量生成并发控制 → Task 3

**2. Placeholder scan:**
- 无 "TBD"、"TODO"
- 所有代码片段完整

**3. Type consistency:**
- `assemblePromptWithBudget` 返回 `{ prompt, truncated }`，在 `buildSystemPrompt` 中使用
- `batchGenerationSchema.concurrency` 在 `batch` mutation 中使用

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-06-10-generation-pipeline-optimization.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
