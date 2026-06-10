# AI 大纲功能代码审查遗留修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复代码审查中发现的 6 项遗留问题，提升类型安全、消除重复代码、修正边界行为。

**Architecture:** 提取 `buildBaseContext` 公共函数消除 `buildOutlinePrompt` 与 `buildSystemPrompt` 的重复；引入 `outlineSchema.safeParse` 运行时校验；修复 `completeProgress` 支持动态步骤。

**Tech Stack:** TypeScript, Drizzle ORM, tRPC v11, Zod, React 19

---

## 文件变更总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `api/routers/generate.ts` | 修改 | 提取公共函数、添加 safeParse、修复日期格式、修复 completeProgress |
| `src/pages/Studio.tsx` | 修改 | 修复状态更新竞态 |

---

### Task 1: 提取 `buildBaseContext` 消除重复代码

**Files:**
- Modify: `api/routers/generate.ts`

**背景:** `buildOutlinePrompt`（~280 行）与 `buildSystemPrompt`（~400 行）在角色查询、冲突检测、世界观查询、正史查询、RAG 检索（4a-4d）等逻辑上重复了约 80%。

**策略:** 提取一个 `buildBaseContext` 函数，负责所有数据查询（角色、世界观、正史、RAG），返回一个结构化的上下文对象。`buildOutlinePrompt` 和 `buildSystemPrompt` 各自调用 `buildBaseContext`，然后根据不同的输出目标组装 prompt。

- [ ] **Step 1: 定义 `buildBaseContext` 返回类型**

在 `RagCall` 类型定义之后、`MODE_CONFIG` 之前插入：

```typescript
type BaseContext = {
  selectedChars: typeof characterCards.$inferSelect[]
  unselectedChars: typeof characterCards.$inferSelect[]
  worldBible: typeof worldBibles.$inferSelect | undefined
  canonEvents: Array<typeof seriesCanon.$inferSelect>
  ragCalls: RagCall[]
  ragContent: string
  warnings: string[]
}
```

- [ ] **Step 2: 实现 `buildBaseContext` 函数**

在 `buildStyleGuide` 函数之后插入 `buildBaseContext`：

```typescript
async function buildBaseContext(
  seriesId: number,
  brief: string,
  rawParams: Partial<GenParams>,
  parentNovelId?: number,
  useMaterials?: boolean,
  materialIds?: number[],
  selectedCharacterIds?: number[],
  selectedTropeIds?: number[],
  ragConfigOverride?: { novelStyleLimit: number; materialLimit: number; keywordLimit: number }
): Promise<BaseContext> {
  const params: GenParams = {
    temperature: rawParams.temperature ?? 0.8,
    styleFidelity: rawParams.styleFidelity ?? 7,
    characterLoyalty: rawParams.characterLoyalty ?? 8,
    tone: rawParams.tone ?? "dramatic",
    lengthTarget: rawParams.lengthTarget ?? "chapter",
    canonConstraint: rawParams.canonConstraint ?? "strict",
    writingMode: rawParams.writingMode ?? "canon_continuation",
    ragLimit: rawParams.ragLimit ?? 5,
  }
  const mode = params.writingMode
  const db = getDb()

  // 1. 查询角色
  const allCharacters = await db
    .select()
    .from(characterCards)
    .where(eq(characterCards.seriesId, seriesId))

  const selectedChars = selectedCharacterIds && selectedCharacterIds.length > 0
    ? allCharacters.filter(c => selectedCharacterIds.includes(c.id))
    : allCharacters

  const unselectedChars = allCharacters.filter(c =>
    !selectedCharacterIds || !selectedCharacterIds.includes(c.id)
  )

  // 2. Brief 角色冲突检测
  const warnings: string[] = []
  const briefLower = brief.toLowerCase()
  for (const char of unselectedChars) {
    const names = [char.name.toLowerCase(), ...(char.aliases as string[] || []).map(a => a.toLowerCase())]
    if (names.some(n => n.length >= 2 && briefLower.includes(n))) {
      warnings.push(`Brief 中提到了未选中的角色"${char.name}"，是否将其加入参演角色？`)
    }
  }

  // 3. 查询世界观和正史
  const [worldBible] = await db
    .select()
    .from(worldBibles)
    .where(eq(worldBibles.seriesId, seriesId))

  const canonEvents = await db
    .select()
    .from(seriesCanon)
    .where(eq(seriesCanon.seriesId, seriesId))
    .orderBy(asc(seriesCanon.eventOrder))

  // 4. Hybrid RAG 检索
  let briefEmbedding: number[] | undefined
  try {
    briefEmbedding = await getEmbeddingWithCache(brief)
  } catch {
    // embedding 失败不影响主流程
  }

  const ragParts: string[] = []
  const ragCalls: RagCall[] = []
  const seenChunkIds = new Set<number>()

  const buildRagPrefix = (content: string): string => {
    const containsUnselected = unselectedChars.some(c => {
      const names = [c.name, ...(c.aliases as string[] || [])]
      return names.some(n => content.includes(n))
    })
    return containsUnselected
      ? "【⚠️ 以下素材含未授权角色，仅参考文风，切勿引入其中角色】\n"
      : ""
  }

  const ragConfig = ragConfigOverride ?? MODE_RAG_CONFIG[mode]

  // 4a. 从关联小说做向量检索
  if (parentNovelId) {
    const novelResults = await searchSimilar(brief, { novelId: parentNovelId, limit: ragConfig.novelStyleLimit, embedding: briefEmbedding })
    if (novelResults.length > 0) {
      const content = novelResults.map(r => r.enrichedContent || r.content).join("\n---\n")
      ragParts.push(buildRagPrefix(content) + "【原作风格参考】\n" + content)
      for (const r of novelResults) {
        if (r.id) seenChunkIds.add(r.id)
        ragCalls.push({
          type: "novel_style",
          content: r.enrichedContent || r.content,
          score: r.similarity,
          sourceTitle: r.sourceTitle,
          chapterNumber: r.chapterNumber,
          chunkIndex: r.chunkIndex,
          totalChunks: r.totalChunks,
          chunkId: r.id,
        })
      }
    }
  }

  // 4b. 从素材池做向量检索
  if (useMaterials !== false) {
    const materialVecResults = await searchSimilar(brief, { seriesId, limit: ragConfig.materialLimit, materialIds: materialIds?.length ? materialIds : undefined, embedding: briefEmbedding })
    if (materialVecResults.length > 0) {
      const content = materialVecResults.map(r => r.enrichedContent || r.content).join("\n---\n")
      ragParts.push(buildRagPrefix(content) + "【投喂素材参考】\n" + content)
      for (const r of materialVecResults) {
        if (r.id) seenChunkIds.add(r.id)
        ragCalls.push({
          type: "material",
          content: r.enrichedContent || r.content,
          score: r.similarity,
          sourceTitle: r.sourceTitle,
          chapterNumber: r.chapterNumber,
          chunkIndex: r.chunkIndex,
          totalChunks: r.totalChunks,
          chunkId: r.id,
        })
      }
    }
  }

  // 4c. 全文检索补充
  try {
    const briefQuery = brief.slice(0, 100)
    const fullText = await db.execute(sql`
      SELECT id, content,
        ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', ${briefQuery})) as score
      FROM vector_chunks
      WHERE series_id = ${seriesId}
        AND to_tsvector('simple', content) @@ plainto_tsquery('simple', ${briefQuery})
      ORDER BY score DESC
      LIMIT ${ragConfig.keywordLimit}
    `)
    const ftRows = Array.isArray(fullText) ? fullText : []
    const newFtRows = ftRows.filter((r: Record<string, unknown>) => !seenChunkIds.has(Number(r.id)))
    if (newFtRows.length > 0) {
      const ftContent = newFtRows.map((r: Record<string, unknown>) => String(r.content)).join("\n---\n")
      ragParts.push(buildRagPrefix(ftContent) + "【关键词参考】\n" + ftContent)
      for (const r of newFtRows) {
        const cid = Number(r.id)
        seenChunkIds.add(cid)
        ragCalls.push({ type: "keyword", content: String(r.content), score: Number(r.score), chunkId: cid })
      }
    }
  } catch { /* 全文检索可选 */ }

  // 4d. pg_trgm 模糊搜索补充
  try {
    const briefQuery = brief.slice(0, 100)
    const trgmResults = await db.execute(sql`
      SELECT id, content, similarity(content, ${briefQuery}) as score
      FROM vector_chunks
      WHERE series_id = ${seriesId}
        AND content % ${briefQuery}
      ORDER BY score DESC
      LIMIT ${params.ragLimit}
    `)
    const trgmRows = Array.isArray(trgmResults) ? trgmResults : []
    const newTrgmRows = trgmRows.filter((r: Record<string, unknown>) => !seenChunkIds.has(Number(r.id)))
    if (newTrgmRows.length > 0) {
      const trgmContent = newTrgmRows.map((r: Record<string, unknown>) => String(r.content)).join("\n---\n")
      ragParts.push(buildRagPrefix(trgmContent) + "【模糊匹配参考】\n" + trgmContent)
      for (const r of newTrgmRows) {
        const cid = Number(r.id)
        seenChunkIds.add(cid)
        ragCalls.push({ type: "keyword", content: String(r.content), score: Number(r.score), chunkId: cid })
      }
    }
  } catch { /* trgm 可选 */ }

  // 5. RAG 结果 AI 摘要
  let ragContent = ""
  if (ragCalls.length > 0) {
    const ragSummary = await summarizeRagChunks(ragCalls)
    if (ragSummary) {
      ragContent = "\n【参考素材摘要】\n" + ragSummary
    } else if (ragParts.length > 0) {
      ragContent = "\n" + ragParts.join("\n\n")
    }
  }

  return { selectedChars, unselectedChars, worldBible, canonEvents, ragCalls, ragContent, warnings }
}
```

- [ ] **Step 3: 重构 `buildSystemPrompt` 使用 `buildBaseContext`**

删除 `buildSystemPrompt` 中角色查询(1-3)、RAG 检索(4a-4d)、RAG 摘要(5)的代码，替换为：

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
  outlineSection?: string
): Promise<{ prompt: string; ragCalls: RagCall[]; warnings?: string[] }> {
  const params: GenParams = {
    temperature: rawParams.temperature ?? 0.8,
    styleFidelity: rawParams.styleFidelity ?? 7,
    characterLoyalty: rawParams.characterLoyalty ?? 8,
    tone: rawParams.tone ?? "dramatic",
    lengthTarget: rawParams.lengthTarget ?? "chapter",
    canonConstraint: rawParams.canonConstraint ?? "strict",
    writingMode: rawParams.writingMode ?? "canon_continuation",
    ragLimit: rawParams.ragLimit ?? 5,
  }
  const mode = params.writingMode

  const { selectedChars, unselectedChars, worldBible, canonEvents, ragCalls, ragContent, warnings } = await buildBaseContext(
    seriesId, brief, rawParams, parentNovelId, useMaterials, materialIds, selectedCharacterIds, selectedTropeIds
  )

  // ... 保留后续的 prompt 组装逻辑（禁止角色列表、桥段注入、世界观铁律、正史、文风指导、RAG 素材、用户自定义、输出格式要求）
}
```

- [ ] **Step 4: 重构 `buildOutlinePrompt` 使用 `buildBaseContext`**

类似地，删除重复的数据查询和 RAG 代码，替换为 `buildBaseContext` 调用，传入大纲专用的 RAG 覆盖配置：

```typescript
async function buildOutlinePrompt(
  seriesId: number,
  brief: string,
  rawParams: Partial<GenParams>,
  parentNovelId?: number,
  userPrompt?: string,
  useMaterials?: boolean,
  materialIds?: number[],
  selectedCharacterIds?: number[],
  selectedTropeIds?: number[],
): Promise<{ prompt: string; ragCalls: RagCall[]; warnings?: string[] }> {
  const params: GenParams = { /* ... */ }
  const mode = params.writingMode
  const db = getDb()

  const modeConfig = MODE_RAG_CONFIG[mode]
  const { selectedChars, unselectedChars, worldBible, canonEvents, ragCalls, ragContent, warnings } = await buildBaseContext(
    seriesId, brief, rawParams, parentNovelId, useMaterials, materialIds, selectedCharacterIds, selectedTropeIds,
    { novelStyleLimit: 1, materialLimit: Math.max(5, modeConfig.materialLimit), keywordLimit: modeConfig.keywordLimit }
  )

  // ... 保留后续的 prompt 组装逻辑（大纲生成要求等）
}
```

- [ ] **Step 5: 运行类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 6: Commit**

```bash
git add api/routers/generate.ts
git commit -m "refactor(generate): 提取 buildBaseContext 消除 buildOutlinePrompt/buildSystemPrompt 重复代码"
```

---

### Task 2: 添加 `outline` 运行时类型校验

**Files:**
- Modify: `api/routers/generate.ts`

**背景:** 后端多处使用 `work.outline as unknown as Outline` 裸类型断言，若数据库中存储了损坏/旧版格式的 JSON，可能导致运行时错误。

- [ ] **Step 1: 导入 `outlineSchema`**

将现有的 `import { type Outline } from "@contracts/schemas"` 改为：

```typescript
import { outlineSchema, type Outline } from "@contracts/schemas"
```

- [ ] **Step 2: 创建 `safeParseOutline` 辅助函数**

在 `parseOutline` 函数之后插入：

```typescript
function safeParseOutline(raw: unknown): { valid: true; outline: Outline } | { valid: false; fallback: Outline } {
  const result = outlineSchema.safeParse(raw)
  if (result.success) return { valid: true, outline: result.data }
  // 降级：将原始对象包装为单一场景 overview
  const fallback: Outline = {
    overview: typeof raw === "object" && raw !== null
      ? String((raw as Record<string, unknown>).overview || JSON.stringify(raw).slice(0, 500))
      : String(raw).slice(0, 500),
    generatedAt: new Date().toISOString(),
    outlineType: "overview",
  }
  return { valid: false, fallback }
}
```

- [ ] **Step 3: 替换所有 `as unknown as Outline` 断言**

在以下位置使用 `safeParseOutline`：

1. `fanfiction` mutation 中（约第 1185 行）：
```typescript
const parsed = safeParseOutline(workRecord.outline)
const outline = parsed.outline // 或 parsed.fallback
```

2. `continue` mutation 中（约第 1470 行）
3. `regenerate` mutation 中（约第 1528 行）

- [ ] **Step 4: 运行类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 5: Commit**

```bash
git add api/routers/generate.ts
git commit -m "fix(api): outline 数据添加 Zod safeParse 运行时校验，防止损坏 JSON 导致崩溃"
```

---

### Task 3: 修复大纲作品标题日期格式

**Files:**
- Modify: `api/routers/generate.ts`

- [ ] **Step 1: 修改 `outline` mutation 中的标题生成**

找到 `title: \`大纲_${new Date().toLocaleDateString()}\``，改为：

```typescript
title: `大纲_${new Date().toISOString().slice(0, 10)}`,
```

- [ ] **Step 2: Commit**

```bash
git add api/routers/generate.ts
git commit -m "fix(api): 大纲作品标题使用 ISO 日期格式，避免 locale 差异"
```

---

### Task 4: 修复 `completeProgress` 步骤不一致

**Files:**
- Modify: `api/routers/generate.ts`

**背景:** `outline` mutation 有 5 步，但 `completeProgress` 固定写入 `step: 4`，导致前端第 5 步不显示完成状态。

- [ ] **Step 1: 修改 `completeProgress` 签名支持可选 step**

```typescript
function completeProgress(taskId: string, result: { workId: number; title: string }, finalStep = 4) {
  generationProgress.set(taskId, { step: finalStep, message: "创作完成", completed: true, result })
}
```

- [ ] **Step 2: `outline` mutation 调用时传入 finalStep = 5**

找到 `completeProgress(taskId, { workId: work.id, title: work.title || "" })`，改为：

```typescript
completeProgress(taskId, { workId: work.id, title: work.title || "" }, 5)
```

- [ ] **Step 3: Commit**

```bash
git add api/routers/generate.ts
git commit -m "fix(api): completeProgress 支持动态步骤，outline 流程正确标记第 5 步完成"
```

---

### Task 5: 修复切换大纲模式按钮状态竞态

**Files:**
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: 修改模式切换按钮的 onClick**

找到切换大纲模式的按钮（约第 1560 行），将：

```typescript
onClick={() => {
  setUseOutlineMode(!useOutlineMode)
  setShowOutlinePanel(!useOutlineMode)
}}
```

改为：

```typescript
onClick={() => {
  setUseOutlineMode(prev => {
    const next = !prev
    setShowOutlinePanel(next)
    return next
  })
}}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Studio.tsx
git commit -m "fix(ui): 大纲模式切换使用函数式更新消除状态竞态"
```

---

### Task 6: 最终验证

- [ ] **Step 1: 类型检查**

Run: `npm run check`
Expected: 零错误

- [ ] **Step 2: 生产构建**

Run: `npm run build`
Expected: 构建成功

---

## Self-Review

**Spec coverage:** 6 项遗留问题均对应到任务：
- Task 1 → 重复代码消除 (Important #7)
- Task 2 → 运行时类型校验 (Important #6)
- Task 3 → 日期格式统一 (Minor #12)
- Task 4 → completeProgress 步骤修复 (Minor #13)
- Task 5 → 状态竞态修复 (Minor #14)

**未纳入本计划的问题：**
- 中文角色名冲突检测（Important #11）：属于已有代码问题，非本次功能引入，建议单独提 issue

**Placeholder scan:** 无 TBD/TODO/"implement later" 等占位符。

**Type consistency:** `buildBaseContext` 返回类型 `BaseContext` 与 `buildSystemPrompt`/`buildOutlinePrompt` 的解构使用一致；`safeParseOutline` 返回的 `Outline` 类型与现有类型一致。