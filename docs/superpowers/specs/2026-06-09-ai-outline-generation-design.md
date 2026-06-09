# AI 生成大纲功能设计文档

## 1. 概述

在二创工作台（Studio）页面新增 **AI 生成大纲** 功能。用户可选择"直接生成正文"（现有行为）或"先大纲后正文"（新功能）。AI 根据 Brief、角色、世界观、RAG 检索素材生成结构化大纲，用户在 UI 中可查看、编辑、确认后，再将大纲作为系统提示词的一部分注入到正文生成流程中。

### 核心需求

| 需求 | 实现方式 |
|------|---------|
| 可切换模式 | Studio 页面提供"直接生成正文 / 先大纲后正文"开关 |
| 混合格式 | 支持生成"概述文本"、"结构化场景列表"或"两者" |
| 可编辑 | 前端提供文本框和列表编辑界面，支持增删改 |
| RAG 增强 | 大纲生成使用独立的 `buildOutlinePrompt`，复用 RAG 基础设施但调整检索权重 |
| 持久化 | `fanFictionWorks` 表新增 `outline` JSONB 字段 |

## 2. 数据模型

### 2.1 数据库变更

在 `db/schema.ts` 的 `fanFictionWorks` 表中新增 `outline` 字段：

```typescript
export const fanFictionWorks = pgTable("fan_fiction_works", {
  // ... 现有字段
  outline: jsonb("outline").$type<{
    overview?: string           // 整体情节概述
    scenes?: Array<{
      id: string                // 前端生成的 UUID，用于 React key
      title: string             // 场景/章节标题
      description: string       // 场景内容描述
    }>
    generatedAt?: string        // ISO 时间戳
    outlineType?: "overview" | "scenes" | "both"  // 生成时选择的类型
  }>(),
})
```

**说明：**
- `outline` 为可选字段，现有作品无大纲时为空
- 不新建表，最小化 schema 变更
- `generatedAt` 记录大纲生成时间，便于后续排查
- `outlineType` 记录用户当初选择的生成类型

### 2.2 TypeScript 类型定义

在 `contracts/schemas.ts` 中新增大纲相关 Zod schema（供前后端共享）：

```typescript
export const outlineSceneSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
})

export const outlineSchema = z.object({
  overview: z.string().optional(),
  scenes: z.array(outlineSceneSchema).optional(),
  generatedAt: z.string().optional(),
  outlineType: z.enum(["overview", "scenes", "both"]).optional(),
})

export type Outline = z.infer<typeof outlineSchema>
export type OutlineScene = z.infer<typeof outlineSceneSchema>
```

## 3. 后端 API 设计

### 3.1 新增 tRPC Mutation

在 `api/routers/generate.ts` 的 `generateRouter` 中新增：

```typescript
outline: publicQuery
  .input(z.object({
    seriesId: z.number(),
    brief: z.string().min(1),
    parameters: generationParamsSchema,
    parentNovelId: z.number().optional(),
    userPrompt: z.string().optional(),
    useMaterials: z.boolean().optional(),
    materialIds: z.array(z.number()).optional(),
    selectedCharacterIds: z.array(z.number()).optional(),
    selectedTropeIds: z.array(z.number()).optional(),
    outlineType: z.enum(["overview", "scenes", "both"]).default("both"),
    taskId: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    const taskId = input.taskId || crypto.randomUUID()
    setProgress(taskId, 1, "正在检索参考素材...")

    try {
      // 1. 构建大纲专用的 System Prompt（复用 buildSystemPrompt 基础设施）
      const { prompt: systemPrompt, ragCalls, warnings } = await buildOutlinePrompt(
        input.seriesId,
        input.brief,
        input.parameters,
        input.parentNovelId,
        input.userPrompt,
        input.useMaterials,
        input.materialIds,
        input.selectedCharacterIds,
        input.selectedTropeIds,
      )

      setProgress(taskId, 2, "正在组装大纲指令...")

      // 2. 调用 AI 生成大纲
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: input.brief },
      ]

      setProgress(taskId, 3, "AI 正在生成大纲...")
      const rawOutline = await generateContent(messages, input.parameters.temperature, 2000)

      // 3. 解析 AI 返回的大纲为结构化数据
      setProgress(taskId, 4, "正在解析大纲...")
      const parsedOutline = await parseOutline(rawOutline, input.outlineType)

      setProgress(taskId, 5, "正在保存...")

      // 4. 保存到数据库（创建或更新 fanFictionWorks 记录）
      const db = getDb()
      const [work] = await db
        .insert(fanFictionWorks)
        .values({
          seriesId: input.seriesId,
          parentNovelId: input.parentNovelId || null,
          title: `大纲_${new Date().toLocaleDateString()}`,
          brief: input.brief,
          parameters: {
            ...input.parameters,
            selectedCharacterIds: input.selectedCharacterIds,
            selectedTropeIds: input.selectedTropeIds,
            ragCalls,
          } as unknown as Record<string, unknown>,
          generatedContent: "",
          outline: {
            overview: parsedOutline.overview,
            scenes: parsedOutline.scenes,
            generatedAt: new Date().toISOString(),
            outlineType: input.outlineType,
          },
          status: "draft",
        })
        .returning()

      completeProgress(taskId, { workId: work.id, title: work.title })

      return {
        workId: work.id,
        outline: parsedOutline,
        ragCalls,
        warnings,
        taskId,
      }
    } catch (err) {
      failProgress(taskId, String(err))
      throw err
    }
  }),
```

### 3.2 新增辅助函数

#### `buildOutlinePrompt`

复用 `buildSystemPrompt` 的 RAG 基础设施，但调整以下策略：

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
  // 复用 buildSystemPrompt 的角色、世界观、正史查询逻辑
  // 但 RAG 检索策略调整：
  // 1. novelStyleLimit 降为 1（大纲阶段不需要太多文风样本）
  // 2. materialLimit 升为 5（更多情节素材）
  // 3. keywordLimit 保持 2
  // 4. 不检索 translation_memory（大纲不需要文风模仿）
  // 5. 检索 plotTropes 时额外注入桥段结构描述

  const ragConfig = {
    novelStyleLimit: 1,
    materialLimit: 5,
    keywordLimit: 2,
  }

  // ... RAG 检索逻辑（复用 searchSimilar，但调整 limit）

  const parts: string[] = [
    `你是一位精通中文小说创作的故事架构师。当前创作模式：${MODE_CONFIG[mode].name}。请根据以下设定，为指定创作方向生成一份结构化大纲。`,
    "",
    "========== 核心任务（最高优先级）==========",
    brief.trim(),
    "",
    "========== 角色规则 ==========",
    MODE_CONFIG[mode].characterInstruction,
    // ... 角色列表、禁止角色列表
    // ... 世界观、正史
    // ... RAG 素材（减少文风样本，增加情节素材）
  ]

  parts.push("")
  parts.push("========== 大纲生成要求 ==========")
  parts.push("请生成一份结构化大纲，要求如下：")
  parts.push("1. 每个场景必须包含：场景标题、场景目标、关键冲突、预期结果")
  parts.push("2. 场景之间必须有逻辑递进关系，禁止突兀转折")
  parts.push("3. 大纲必须与【核心任务】高度相关，不要偏离主题")
  parts.push("4. 使用标准中文，禁止使用 Markdown 标记")
  parts.push("5. 输出格式必须是结构化文本，便于后续解析")

  if (userPrompt && userPrompt.trim()) {
    parts.push("")
    parts.push("【用户自定义要求】（以下内容优先级最高）")
    parts.push(userPrompt.trim())
  }

  return { prompt: parts.join("\n"), ragCalls, warnings }
}
```

#### `parseOutline`

解析 AI 返回的原始文本为结构化数据：

```typescript
async function parseOutline(
  rawText: string,
  outlineType: "overview" | "scenes" | "both"
): Promise<{ overview?: string; scenes?: OutlineScene[] }> {
  // 如果 AI 返回的是 JSON，尝试直接解析
  try {
    const json = JSON.parse(rawText)
    return {
      overview: outlineType !== "scenes" ? json.overview || json.summary || "" : undefined,
      scenes: outlineType !== "overview"
        ? (json.scenes || json.chapters || []).map((s: Record<string, unknown>, i: number) => ({
            id: crypto.randomUUID(),
            title: String(s.title || s.name || `场景${i + 1}`),
            description: String(s.description || s.content || s.summary || ""),
          }))
        : undefined,
    }
  } catch {
    // 如果不是 JSON，使用 AI 再次解析为结构化格式
    const parsePrompt = `请将以下大纲文本解析为结构化 JSON 格式。只返回 JSON，不要任何解释。

要求格式：
{
  "overview": "整体概述文本（如果有）",
  "scenes": [
    { "title": "场景标题", "description": "场景描述" }
  ]
}

待解析文本：
${rawText.slice(0, 3000)}`

    try {
      const parsed = await chatCompletion({
        messages: [{ role: "user", content: parsePrompt }],
        temperature: 0.1,
        maxTokens: 2000,
      })
      const json = JSON.parse(parsed.trim().replace(/^```json\s*|\s*```$/g, ""))
      return {
        overview: outlineType !== "scenes" ? json.overview || "" : undefined,
        scenes: outlineType !== "overview"
          ? (json.scenes || []).map((s: Record<string, unknown>, i: number) => ({
              id: crypto.randomUUID(),
              title: String(s.title || `场景${i + 1}`),
              description: String(s.description || ""),
            }))
          : undefined,
      }
    } catch {
      // 解析失败时，将整个文本作为 overview 返回
      return {
        overview: outlineType !== "scenes" ? rawText.trim() : undefined,
        scenes: outlineType !== "overview" ? [{
          id: crypto.randomUUID(),
          title: "整体大纲",
          description: rawText.trim(),
        }] : undefined,
      }
    }
  }
}
```

### 3.3 修改 `generate.fanfiction`

在 `generate.fanfiction` mutation 中，新增 `useOutline` 参数，并在 `buildSystemPrompt` 中拼接大纲内容：

```typescript
fanfiction: publicQuery
  .input(z.object({
    // ... 现有字段
    useOutline: z.boolean().optional().default(false),
  }))
  .mutation(async ({ input }) => {
    // ... 现有逻辑

    // 如果用户选择使用大纲，查询并拼接
    let outlineSection = ""
    if (input.useOutline && input.workId) {
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId))
      if (work?.outline) {
        const outline = work.outline as unknown as Outline
        const parts: string[] = []
        if (outline.overview) {
          parts.push("【故事概述】" + outline.overview)
        }
        if (outline.scenes && outline.scenes.length > 0) {
          parts.push("【场景规划】")
          for (const scene of outline.scenes) {
            parts.push(`- ${scene.title}: ${scene.description}`)
          }
        }
        outlineSection = parts.join("\n")
      }
    }

    // ... 在 buildSystemPrompt 中将 outlineSection 拼接进去
  }),
```

### 3.4 修改 `buildSystemPrompt`

在 `buildSystemPrompt` 函数的参数列表中新增 `outlineSection?: string`，并在拼接 prompt 时将其插入到"核心任务"之后：

```typescript
// 在 "核心任务" 部分之后插入大纲
parts.push("========== 核心任务（最高优先级）==========")
parts.push(brief.trim())

if (outlineSection) {
  parts.push("")
  parts.push("【创作大纲 — 必须严格遵循以下结构】")
  parts.push(outlineSection)
  parts.push("你的创作必须严格按照上述大纲的场景结构展开，每个场景的内容必须与大纲描述一致。")
}
```

## 4. 前端 UI 设计

### 4.1 Studio 页面改造

在 `src/pages/Studio.tsx` 中，Brief 输入区域下方新增**大纲面板**：

```
┌─────────────────────────────────────────┐
│  Brief 输入框                            │
├─────────────────────────────────────────┤
│  [📋 大纲 ▼]  生成模式: ●直接生成正文     │
│              ○先大纲后正文                │
├─────────────────────────────────────────┤
│  大纲面板（展开时）                        │
│  ┌─────────────────────────────────────┐│
│  │ 生成类型: ●概述  ●结构化  ●两者      ││
│  │ [🪄 AI生成大纲]                     ││
│  ├─────────────────────────────────────┤│
│  │ 整体概述:                            ││
│  │ [textarea]                           ││
│  ├─────────────────────────────────────┤│
│  │ 场景列表:                            ││
│  │ 1. [标题] [描述] [🗑️]               ││
│  │ 2. [标题] [描述] [🗑️]               ││
│  │ [+ 添加场景]                         ││
│  ├─────────────────────────────────────┤│
│  │ [✅ 确认并生成正文]                  ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

### 4.2 新增状态

```typescript
const [useOutlineMode, setUseOutlineMode] = useState(false)
const [outlineType, setOutlineType] = useState<"overview" | "scenes" | "both">("both")
const [outlineOverview, setOutlineOverview] = useState("")
const [outlineScenes, setOutlineScenes] = useState<Array<{ id: string; title: string; description: string }>>([])
const [showOutlinePanel, setShowOutlinePanel] = useState(false)
```

### 4.3 交互流程

**场景 A：用户选择"先大纲后正文"**
1. 用户填写 Brief、选择角色、调整参数
2. 用户选择生成类型（概述/结构化/两者）
3. 点击"AI生成大纲"
4. 后端生成大纲，返回结构化数据
5. 前端渲染到编辑区域
6. 用户可编辑概述文本和场景列表
7. 用户点击"确认并生成正文"
8. 前端调用 `generate.fanfiction`，传入 `useOutline: true` 和 `workId`
9. 后端将大纲拼接进 system prompt，生成正文

**场景 B：用户选择"直接生成正文"**
1. 现有流程不变
2. 大纲面板可折叠隐藏

**场景 C：加载历史作品**
1. 如果历史作品包含 outline，自动展开大纲面板并填充数据
2. 用户可修改大纲后重新生成正文

## 5. 数据流

```
用户填写 Brief ──► 选择"先大纲后正文" ──► 选择生成类型
                                      │
                                      ▼
                              点击"AI生成大纲"
                                      │
                                      ▼
                    ┌─────────────────────────────────┐
                    │  generate.outline mutation      │
                    │  1. buildOutlinePrompt          │
                    │     - 复用角色/世界观查询        │
                    │     - 独立 RAG 检索（重情节）    │
                    │  2. 调用 DeepSeek               │
                    │  3. parseOutline 解析           │
                    │  4. 保存到 fanFictionWorks      │
                    └─────────────────────────────────┘
                                      │
                                      ▼
                    返回 { workId, outline, ragCalls }
                                      │
                                      ▼
                    前端渲染大纲编辑界面（可编辑）
                                      │
                                      ▼
                    用户点击"确认并生成正文"
                                      │
                                      ▼
                    ┌─────────────────────────────────┐
                    │  generate.fanfiction mutation   │
                    │  1. 查询作品 outline            │
                    │  2. buildSystemPrompt           │
                    │     - 拼接 outlineSection        │
                    │  3. 调用 DeepSeek               │
                    │  4. 保存正文                    │
                    └─────────────────────────────────┘
```

## 6. 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| AI 大纲生成失败 | 返回错误，前端显示"大纲生成失败，请重试" |
| parseOutline 解析失败 | 降级为纯文本 overview，不阻塞用户 |
| RAG 检索失败 | 忽略，大纲生成继续（同现有正文生成逻辑） |
| 用户编辑后 outline 格式损坏 | 前端校验（Zod），阻止提交并提示 |
| 使用大纲生成正文时 outline 不存在 | 后端忽略，回退到无大纲模式 |

## 7. 测试策略

| 测试项 | 方式 |
|--------|------|
| `buildOutlinePrompt` 正确组装 prompt | 单元测试：mock db 查询，验证输出字符串包含关键章节 |
| `parseOutline` 解析各种 AI 输出格式 | 单元测试：提供多种输入（JSON/文本/混合），验证输出结构 |
| `generate.outline` 端到端 | 集成测试：mock DeepSeek API，验证数据库写入 |
| 前端大纲编辑交互 | 手动测试：增删改场景、切换生成类型 |
| 大纲注入正文生成 | 手动测试：确认 system prompt 包含大纲内容 |

## 8. 优化空间

1. **大纲模板**：支持保存常用大纲结构为模板，快速复用
2. **大纲版本历史**：记录每次修改，支持回滚到历史版本
3. **智能场景拆分**：AI 根据 `lengthTarget` 自动决定场景数量（short=3-5个，chapter=5-8个，arc=8-15个）
4. **大纲自检**：生成大纲后进行角色冲突、正史矛盾检测（复用现有 `selfCritique`）
5. **拖拽排序**：前端场景列表支持拖拽调整顺序

---

**文档状态：** 待审查  
**作者：** Claude Code  
**日期：** 2026-06-09
