# 修复 AI 生成内容截断（finish_reason="length"）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 检测 DeepSeek API 返回的 `finish_reason === "length"`（生成被 max_tokens 截断），将截断标志贯穿生成管线，并在 Studio 前端显示警告，同时提升默认 maxTokens 上限以降低截断概率。

**Architecture:** 在 `deepseek.ts` 的 `chatCompletion` 和 `streamChat` 中解析 `finish_reason`，通过返回类型传递到 `generate.ts` 的 `generateContent`/`generateSingleChapter`，再透传到 tRPC mutation 返回值。前端在 `useStudioState` 中消费 `isTruncated` 标志，通过新横幅组件展示警告。同步提升默认 maxTokens（short 4k→6k, chapter 8k→12k, arc 12k→16k）。

**Tech Stack:** TypeScript, Hono, tRPC 11, DeepSeek API (SSE streaming), React 19, Tailwind CSS

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `api/services/deepseek.ts` | 解析并返回 `finish_reason`；`streamChat` 通过 generator return value 传递 |
| `api/routers/generate.ts` | `generateContent`/`generateSingleChapter` 返回截断标志；所有 mutation 透传；提升 maxTokens |
| `src/types/studio.ts` | 新增 `ContentTruncatedWarning` 类型 |
| `src/hooks/useStudioState.ts` | 新增截断警告状态，处理各 mutation 的 `isTruncated` |
| `src/components/studio/ContentTruncatedBanner.tsx` | AI 生成截断警告横幅 UI |
| `src/components/studio/index.ts` | 导出新组件 |
| `src/pages/Studio.tsx` | 渲染截断警告横幅 |

---

## 术语区分

- **Prompt 截断**（已有）：`buildSystemPrompt` 中 `assemblePromptWithBudget` 省略的模块，通过 `truncated` 字段 + `PromptTruncatedBanner` 展示。
- **AI 生成截断**（本计划修复）：`finish_reason === "length"`，AI 输出因触及 `max_tokens` 而中断，通过 `isTruncated` 字段 + `ContentTruncatedBanner` 展示。

---

### Task 1: 修改 `api/services/deepseek.ts` 检测 finish_reason

**Files:**
- Modify: `api/services/deepseek.ts:30-33`, `api/services/deepseek.ts:134-187`, `api/services/deepseek.ts:189-224`

**Context:**
- `ChatResult` 当前只有 `{ content: string; usage?: TokenUsage }`
- `chatCompletion()` 解析 `data.choices[0].message.content`，完全忽略 `finish_reason`
- `streamChat()` 解析 SSE，每行 `data: {...}`，其中 `data.choices[0].delta.content` 是内容；最后一条（非 `[DONE]`）消息会包含 `data.choices[0].finish_reason`

- [ ] **Step 1: 扩展 `ChatResult` 接口**

```typescript
export interface ChatResult {
  content: string
  usage?: TokenUsage
  finishReason?: string
}
```

- [ ] **Step 2: `chatCompletion()` 解析并返回 `finish_reason`**

在 `api/services/deepseek.ts:189-224` 的 `chatCompletion` 中，将数据解析类型扩展：

```typescript
const data = await response.json() as {
  choices?: Array<{
    message?: { content?: string }
    finish_reason?: string
  }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

const content = data.choices?.[0]?.message?.content || ""
const finishReason = data.choices?.[0]?.finish_reason
const usage: TokenUsage | undefined = data.usage
  ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    }
  : undefined

return { content, usage, finishReason }
```

- [ ] **Step 3: `streamChat()` 通过 generator return value 传递 `finish_reason`**

修改 `streamChat` 返回类型为 `AsyncGenerator<string, { finishReason?: string }>`。

在 SSE 解析循环中，检测 `finish_reason`：

```typescript
export async function* streamChat(options: ChatOptions): AsyncGenerator<string, { finishReason?: string }> {
  // ... 原有 fetchWithRetry 和 response 处理不变 ...

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let finishReason: string | undefined

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.trim() === "" || line.trim() === "data: [DONE]") continue
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6))
            const content = data.choices?.[0]?.delta?.content
            if (content) yield content
            const reason = data.choices?.[0]?.finish_reason
            if (reason) finishReason = reason
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { finishReason }
}
```

**注意：** `AsyncGenerator<string, { finishReason?: string }>` 的 return type 不影响 `for await...of` 循环（循环自动忽略 return value），因此 `translate.ts` 等现有调用方**无需修改**。

- [ ] **Step 4: 提交**

```bash
git add api/services/deepseek.ts
git commit -m "api(deepseek): 解析并返回 finish_reason，支持截断检测"
```

---

### Task 2: 修改 `api/routers/generate.ts` — 生成函数适配截断检测 + 提升 maxTokens

**Files:**
- Modify: `api/routers/generate.ts:90-110`, `api/routers/generate.ts:1488-1515`, `api/routers/generate.ts:149-150`

**Context:**
- `generateSingleChapter()` 使用 `chatCompletion`（非流式），返回 `{ content, ragCalls, warnings, truncated }`
- `generateContent()` 使用 `streamChat`（流式），当前返回 `Promise<string>`
- 默认 maxTokens：`short=4000, chapter=8000, arc=12000`

- [ ] **Step 1: `generateContent()` 改为返回 `{ content: string; isTruncated: boolean }`**

替换 `api/routers/generate.ts:1488-1515`：

```typescript
async function generateContent(
  messages: Array<{ role: "system" | "user"; content: string }>,
  temperature: number,
  maxTokens: number,
  taskId?: string
): Promise<{ content: string; isTruncated: boolean }> {
  const stream = streamChat({ messages, temperature, maxTokens })
  let fullContent = ""
  let chunkCount = 0
  const startTime = Date.now()
  let isTruncated = false

  // 手动迭代以获取 generator return value（包含 finishReason）
  try {
    while (true) {
      const { done, value } = await stream.next()
      if (done) {
        if (value?.finishReason === "length") {
          isTruncated = true
        }
        break
      }
      fullContent += value
      chunkCount++

      if (taskId && chunkCount % 15 === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        updateDetail(taskId, `AI 正在创作中…（已生成约 ${fullContent.length} 字，用时 ${elapsed} 秒）`)
      }
    }
  } catch (err) {
    // 流异常时，将已收集的内容返回，并标记可能截断
    if (fullContent.length > 0) {
      console.warn("[generateContent] Stream error, returning partial content:", err)
      return { content: fullContent, isTruncated: true }
    }
    throw err
  }

  if (taskId) {
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    updateDetail(taskId, `AI 创作完成（共 ${fullContent.length} 字，用时 ${elapsed} 秒）`)
  }

  return { content: fullContent, isTruncated }
}
```

- [ ] **Step 2: `generateSingleChapter()` 返回 `isTruncated`**

修改 `api/routers/generate.ts:90-110` 的签名：

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
    jobId?: number
  }
): Promise<{ content: string; ragCalls: RagCall[]; warnings?: string[]; truncated?: string[]; isTruncated: boolean }> {
```

在函数内部，将 `chatCompletion` 调用结果中的 `finishReason` 转换为 `isTruncated`：

```typescript
const result = await chatCompletion({
  messages: [
    { role: "system", content: prompt },
    { role: "user", content: `请创作第 ${chapterNumber} 章《${chapterTitle}》。要求：${chapterBrief}` },
  ],
  temperature: params.temperature ?? 0.8,
  maxTokens: params.lengthTarget === "short" ? 6000 : params.lengthTarget === "arc" ? 16000 : 12000,
})

const content = sanitizeGeneratedContent(result.content)
const isTruncated = result.finishReason === "length"
```

并在 `return` 语句和 `generationMetrics` 更新中添加 `isTruncated`：

```typescript
// 成功时更新 metrics
if (metricsId) {
  try {
    await db.update(generationMetrics).set({
      // ... 现有字段 ...
      ragTruncated: !!truncated && truncated.length > 0,
      contentTruncated: isTruncated,  // ← 新增
      worldViewCompliant,
    }).where(eq(generationMetrics.id, metricsId))
  } catch { /* ignore */ }
}

return { content, ragCalls, warnings, truncated, isTruncated }
```

**注意：** `generationMetrics` 表当前可能没有 `contentTruncated` 字段。如果该字段不存在，跳过 metrics 更新中的 `contentTruncated` 行，仅保留 return 语句中的 `isTruncated`。在 Step 5 中通过 db:push 添加字段。

- [ ] **Step 3: 提升 `generateSingleChapter` 默认 maxTokens**

在 `generateSingleChapter` 内部（`api/routers/generate.ts:149`）：

```typescript
maxTokens: params.lengthTarget === "short" ? 6000 : params.lengthTarget === "arc" ? 16000 : 12000,
```

- [ ] **Step 4: 提升 `fanfiction` mutation 的 maxTokens**

在 `api/routers/generate.ts:1590-1594`：

```typescript
const maxTokens = input.parameters.lengthTarget === "short"
  ? 6000
  : input.parameters.lengthTarget === "chapter"
  ? 12000
  : 16000
```

- [ ] **Step 5: 提交**

```bash
git add api/routers/generate.ts
git commit -m "api(generate): 生成函数返回 isTruncated，提升默认 maxTokens 上限"
```

---

### Task 3: 修改 `api/routers/generate.ts` — mutation 返回值扩展

**Files:**
- Modify: `api/routers/generate.ts:1569-1709`, `api/routers/generate.ts:1750`, `api/routers/generate.ts:1869-1881`, `api/routers/generate.ts:1939-1952`, `api/routers/generate.ts:2074`

**Context:**
- `fanfiction` mutation 返回 `{ content, workId, ragCalls, warnings, autoTitle, taskId, truncated }`
- `outline` mutation 返回 `{ workId, outline, ragCalls, warnings }`
- `continue` mutation 返回 `{ content, fullContent, workId, ragCalls, warnings }`
- `regenerate` mutation 返回 `{ regenerated, fullContent, workId, ragCalls, warnings }`
- batch 中调用 `generateSingleChapter` 后保存结果

- [ ] **Step 1: `fanfiction` mutation 返回 `isTruncated`**

在 `api/routers/generate.ts:1598-1603`：

```typescript
const { content: fullContent, isTruncated } = await generateContent(
  messages,
  input.parameters.temperature,
  maxTokens,
  taskId
)
```

在返回语句（约 `api/routers/generate.ts:1704`）：

```typescript
return { content: fullContent, workId: work.id, ragCalls, warnings, autoTitle, taskId, truncated, isTruncated }
```

- [ ] **Step 2: `outline` mutation 返回 `isTruncated`**

在 `api/routers/generate.ts:1750`：

```typescript
const { content: rawOutline, isTruncated } = await generateContent(messages, input.parameters.temperature, 6000)
```

在返回语句（约 `api/routers/generate.ts:1780`）：

```typescript
return { workId: work.id, outline: parsedOutline, ragCalls, warnings, isTruncated }
```

- [ ] **Step 3: `continue` mutation 返回 `isTruncated`**

在 `api/routers/generate.ts:1869-1873`：

```typescript
const { content: newContent, isTruncated } = await generateContent(
  messages,
  ((work.parameters as Record<string, unknown>)?.temperature as number || 0.8) * 0.9,
  12000
)
```

在返回语句（`api/routers/generate.ts:1881`）：

```typescript
return { content: newContent, fullContent, workId: work.id, ragCalls, warnings, isTruncated }
```

- [ ] **Step 4: `regenerate` mutation 返回 `isTruncated`**

在 `api/routers/generate.ts:1940-1944`：

```typescript
const { content: regenerated, isTruncated } = await generateContent(
  messages,
  ((work.parameters as Record<string, unknown>)?.temperature as number || 0.8) * 1.1,
  6000
)
```

在返回语句（`api/routers/generate.ts:1952`）：

```typescript
return { regenerated, fullContent: newContent, workId: work.id, ragCalls, warnings, isTruncated }
```

- [ ] **Step 5: batch mutation 中保存 `isTruncated` 到章节参数**

在 `api/routers/generate.ts:2074`，`generateSingleChapter` 调用后：

```typescript
const { content, isTruncated: chapterIsTruncated } = await generateSingleChapter(
  workId,
  seriesId,
  config.chapterNumber,
  config.title,
  config.brief,
  mergedParams,
  { ...genOptions, previousContext, jobId },
)
```

在保存章节内容时，将 `isTruncated` 存入 `parameters` JSONB：

```typescript
const chapterParams = { ...mergedParams, isTruncated: chapterIsTruncated }

// Upsert: update if exists, insert if not
if (latest) {
  await db
    .update(fanFictionChapters)
    .set({ content, status: "generated", parameters: chapterParams as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(fanFictionChapters.id, latest.id))
} else {
  await db.insert(fanFictionChapters).values({
    workId,
    chapterNumber: config.chapterNumber,
    title: config.title,
    content,
    brief: config.brief,
    parameters: chapterParams as unknown as Record<string, unknown>,
    status: "generated",
  })
}
```

- [ ] **Step 6: 提交**

```bash
git add api/routers/generate.ts
git commit -m "api(generate): mutation 返回值扩展 isTruncated，batch 章节记录截断状态"
```

---

### Task 4: 前端类型与状态管理

**Files:**
- Modify: `src/types/studio.ts`, `src/hooks/useStudioState.ts`

- [ ] **Step 1: `src/types/studio.ts` 添加 `ContentTruncatedWarning` 类型**

在文件末尾（`PromptTruncatedWarning` 之后）添加：

```typescript
// AI 生成内容截断警告（与 Prompt 截断区分）
export interface ContentTruncatedWarning {
  message: string
  suggestion: string
}
```

- [ ] **Step 2: `useStudioState.ts` 添加截断警告状态**

在状态声明区（`truncatedWarning` 附近，`src/hooks/useStudioState.ts:151` 附近）添加：

```typescript
const [contentTruncatedWarning, setContentTruncatedWarning] = useState<ContentTruncatedWarning | null>(null)
```

- [ ] **Step 3: `handleGenerate` 消费 `isTruncated`**

在 `handleGenerate` 的 `onSuccess`/`try` 块中（`src/hooks/useStudioState.ts:613-627` 附近），在设置 `warnings` 之后添加：

```typescript
if (result.isTruncated) {
  setContentTruncatedWarning({
    message: "AI 生成的内容因长度限制被截断，结果可能不完整。",
    suggestion: "建议减少 Brief 长度、减少引用素材数量，或选择更短的长度目标后重试。",
  })
} else {
  setContentTruncatedWarning(null)
}
```

- [ ] **Step 4: `handleGenerateOutline` 消费 `isTruncated`**

在 `handleGenerateOutline` 的 `try` 块中（`src/hooks/useStudioState.ts:693-703` 附近），添加同样的处理：

```typescript
if (result.isTruncated) {
  setContentTruncatedWarning({
    message: "AI 生成的大纲因长度限制被截断，结果可能不完整。",
    suggestion: "建议缩短 Brief 或减少素材引用后重试。",
  })
} else {
  setContentTruncatedWarning(null)
}
```

- [ ] **Step 5: `handleContinue` 消费 `isTruncated`**

在 `handleContinue` 的 `try` 块中（`src/hooks/useStudioState.ts:898-912` 附近），添加：

```typescript
if (result.isTruncated) {
  setContentTruncatedWarning({
    message: "续写内容因长度限制被截断。",
    suggestion: "建议缩短续写提示，或尝试减少前文引用长度。",
  })
} else {
  setContentTruncatedWarning(null)
}
```

- [ ] **Step 6: `handleRegenerate` 消费 `isTruncated`**

在 `handleRegenerate` 的 `try` 块中（`src/hooks/useStudioState.ts:940-959` 附近），添加：

```typescript
if (result.isTruncated) {
  setContentTruncatedWarning({
    message: "重写内容因长度限制被截断。",
    suggestion: "建议缩小重写范围（选择更少的段落），或减少修改要求的长度。",
  })
} else {
  setContentTruncatedWarning(null)
}
```

- [ ] **Step 7: 在 hook 返回对象中暴露 `contentTruncatedWarning` 和 `setContentTruncatedWarning`**

在 `useStudioState.ts` 的返回对象（约 `1007-1200` 行）中找到 `truncatedWarning` 附近，添加：

```typescript
// AI 生成截断警告
contentTruncatedWarning,
setContentTruncatedWarning,
```

- [ ] **Step 8: 提交**

```bash
git add src/types/studio.ts src/hooks/useStudioState.ts
git commit -m "feat(studio): 前端状态管理接入 AI 生成截断检测"
```

---

### Task 5: 前端截断警告 UI

**Files:**
- Create: `src/components/studio/ContentTruncatedBanner.tsx`
- Modify: `src/components/studio/index.ts`, `src/pages/Studio.tsx`

- [ ] **Step 1: 创建 `ContentTruncatedBanner` 组件**

创建 `src/components/studio/ContentTruncatedBanner.tsx`：

```tsx
/**
 * AI 生成内容截断警告横幅
 * 与 PromptTruncatedBanner 区分：这是 AI 输出被 max_tokens 截断，不是 Prompt 被截断
 */
import { Scissors, X } from "lucide-react"
import type { ContentTruncatedWarning } from "@/types/studio"

interface ContentTruncatedBannerProps {
  warning: ContentTruncatedWarning | null
  onDismiss: () => void
}

export function ContentTruncatedBanner({ warning, onDismiss }: ContentTruncatedBannerProps) {
  if (!warning) return null

  return (
    <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start gap-3">
        <Scissors className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-red-400">生成内容被截断</h4>
          <p className="text-xs text-white/60 mt-1">{warning.message}</p>
          <p className="text-xs text-white/40 mt-1">{warning.suggestion}</p>
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

- [ ] **Step 2: 在 `src/components/studio/index.ts` 中导出**

```typescript
export { ContentTruncatedBanner } from "./ContentTruncatedBanner"
```

- [ ] **Step 3: `src/pages/Studio.tsx` 导入并渲染**

在现有导入中（`src/pages/Studio.tsx:11`），将 `PromptTruncatedBanner` 替换为同时导入 `ContentTruncatedBanner`：

```typescript
import { ErrorDisplay, RagReferencePanel, PromptTruncatedBanner, ContentTruncatedBanner, BatchProgressPanel } from "@/components/studio"
```

从 `useStudioState` 解构中（`src/pages/Studio.tsx:221-226` 附近）添加：

```typescript
// AI 生成截断警告
contentTruncatedWarning,
setContentTruncatedWarning,
```

在渲染区域找到 `PromptTruncatedBanner` 的位置（约 `src/pages/Studio.tsx:497`），在其后添加：

```tsx
{contentTruncatedWarning && (
  <ContentTruncatedBanner
    warning={contentTruncatedWarning}
    onDismiss={() => setContentTruncatedWarning(null)}
  />
)}
```

- [ ] **Step 4: 提交**

```bash
git add src/components/studio/ContentTruncatedBanner.tsx src/components/studio/index.ts src/pages/Studio.tsx
git commit -m "feat(ui): AI 生成截断警告横幅组件及 Studio 页面集成"
```

---

### Task 6: 集成验证

- [ ] **Step 1: 类型检查**

```bash
npm run check
```

**预期：** 零 TypeScript 错误。如果 `streamChat` 的 `AsyncGenerator<string, { finishReason?: string }>` 类型导致某些调用方出错，检查那些调用方是否依赖 `typeof streamChat` 或复杂的类型推断。`for await...of` 循环不会受影响。

- [ ] **Step 2: 运行测试**

```bash
npm run test
```

**预期：** 所有现有测试通过。

- [ ] **Step 3: 生产构建**

```bash
npm run build
```

**预期：** 构建成功，无错误。

- [ ] **Step 4: 提交**

```bash
git commit -m "fix(generate): 检测 AI 输出截断并前端警告，提升 maxTokens 上限

- deepseek.ts: 解析 finish_reason，streamChat 通过 return value 传递
- generate.ts: generateContent/generateSingleChapter 返回 isTruncated
- generate.ts: 提升默认 maxTokens (short 4k→6k, chapter 8k→12k, arc 12k→16k)
- 前端: ContentTruncatedBanner 展示截断警告
- batch: 章节 parameters 中记录 isTruncated"
```

---

## Self-Review Checklist

### Spec Coverage

| 需求 | 实现任务 |
|------|---------|
| 检测 `finish_reason === "length"` | Task 1 Step 2-3 |
| 流式生成截断检测 | Task 1 Step 3, Task 2 Step 1 |
| 非流式生成截断检测 | Task 1 Step 2, Task 2 Step 2 |
| 截断标志贯穿生成管线 | Task 2, Task 3 |
| 前端显示截断警告 | Task 4, Task 5 |
| 提升默认 maxTokens | Task 2 Step 3-4 |

### Placeholder Scan

- 无 "TBD", "TODO", "implement later"
- 所有步骤包含完整代码
- 类型名称一致：`isTruncated`（boolean），`finishReason`（string），`ContentTruncatedWarning`

### Type Consistency

| 名称 | 定义位置 | 用途 |
|------|---------|------|
| `isTruncated` | `generateContent` 返回值, `generateSingleChapter` 返回值, 各 mutation 返回值 | boolean |
| `finishReason` | `ChatResult.finishReason`, `streamChat` return value | `string \| undefined` |
| `ContentTruncatedWarning` | `src/types/studio.ts` | `{ message: string; suggestion: string }` |

### 已知限制

- `translate.ts` 的 `callTranslationStream` 使用 `for await...of` 消费 `streamChat`，不处理截断。这是设计意图——翻译流程的截断检测不在本计划范围内。
- batch 生成的截断状态保存在 `fanFictionChapters.parameters` JSONB 中，前端通过 `listChapters` 可读取，但 `BatchProgressPanel` 当前不展示截断信息。如需展示，可在后续迭代中增强。
