# AI 异步操作进度条覆盖计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有调用 AI 的异步操作添加可视化进度条，让用户明确感知操作状态，替代当前仅有 spinner 或文字提示的反馈方式。

**Architecture:** 前端创建一个可复用的 `AiProgressBar` 组件，支持 `indeterminate`（不确定动画）和 `determinate`（确定百分比）两种模式。对于已有精确后端进度（generate.fanfiction、generate.outline、generate.batch、trope.extract、material.batchAutoExtract）的操作，保持现有进度系统不变，仅在其 stepper 下方追加传统百分比进度条；对于仅有单步阻塞 AI 调用（continue、regenerate、review、inspire、翻译、设定提取、素材提取）的操作，在 pending 期间显示 `indeterminate` 进度条覆盖层。

**Tech Stack:** React 19, TypeScript, Tailwind CSS, tRPC 11, shadcn/ui 风格

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/components/AiProgressBar.tsx` | 新建：可复用进度条组件，indeterminate + determinate 双模式 |
| `src/index.css` | 修改：添加 `ai-progress-indeterminate` CSS keyframes 动画 |
| `src/components/studio/ParameterPanel.tsx` | 修改：`GenerationStepper` 下方追加百分比进度条 |
| `src/pages/Studio.tsx` | 修改：为 continue、regenerate、review、inspire 添加 indeterminate 进度条 |
| `src/pages/Reader.tsx` | 修改：为单章翻译添加 indeterminate 进度条 |
| `src/pages/LoreLibrary.tsx` | 修改：为 extractStyleProfile、summarizeWorld、extractWorld 添加进度条 |
| `src/pages/MaterialPool.tsx` | 修改：为 extractLore、autoExtractLore、indexAsync 添加/增强进度条 |

---

## 当前问题分析

### 已有精确进度（保持不变）
- `generate.fanfiction` → `genProgress` + `GenerationStepper` ✅
- `generate.outline` → `genProgress` + `GenerationStepper` ✅
- `generate.batch` → `batchStatus` + `BatchProgressPanel` ✅
- `trope.extract` → `extractStatus` + 进度条 ✅
- `material.batchAutoExtract` → `batchAutoExtractStatus` + 进度条 ✅
- Reader 逐章翻译 → `translateProgress` state + 章节计数 ✅
- NovelManager 批量操作 → `batchProgress` state ✅

### 仅有 spinner / pending 文字，缺失进度条的 AI 操作
| 页面 | 操作 | 当前反馈 | 改进方式 |
|------|------|---------|---------|
| Studio | `generate.continue` | `isGenerating` + 按钮禁用 | indeterminate 进度条 |
| Studio | `generate.regenerate` | `regenerateMutation.isPending` + spinner | indeterminate 进度条 |
| Studio | `generate.review` | `reviewMutation.isPending` + "审阅中..." | indeterminate 进度条 |
| Studio | `generate.inspire` | `inspireMutation.isPending` + "搜索灵感中..." | indeterminate 进度条 |
| Reader | `translate.chapter` | `translateChapterMutation.isPending` + "翻译中..." | indeterminate 进度条 |
| LoreLibrary | `extractStyleProfile` | `extractStyleProfile.isPending` + spinner | indeterminate 进度条 |
| LoreLibrary | `summarizeWorld` | `summarizeWorldMutation.isPending` + spinner | indeterminate 进度条 |
| LoreLibrary | `extractWorld` | `extractWorldMutation.isPending` + spinner | indeterminate 进度条 |
| MaterialPool | `extractLore` | `extractLoreMutation.isPending` + "AI 正在分析..." | indeterminate 进度条 |
| MaterialPool | `autoExtractLore` | `autoExtractLoreMutation.isPending` + spinner | indeterminate 进度条 |
| MaterialPool | `indexAsync` | 按钮禁用，toast 通知完成 | determinate 进度条（`indexJobStatus` 已有数据） |

---

### Task 1: 创建 AiProgressBar 组件

**Files:**
- Create: `src/components/AiProgressBar.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: 创建 AiProgressBar 组件**

```tsx
// src/components/AiProgressBar.tsx
import React from "react"

export interface AiProgressBarProps {
  /** 进度条模式：indeterminate = 循环动画（无精确进度），determinate = 精确百分比 */
  variant?: "indeterminate" | "determinate"
  /** 0-100 的进度百分比，仅 determinate 模式有效 */
  progress?: number
  /** 进度条标题（如"AI 审阅中"） */
  title: string
  /** 可选的描述文字（如"正在分析作品质量..."） */
  description?: string
  className?: string
}

/**
 * AI 异步操作进度条组件
 * - indeterminate 模式：用于单步阻塞 AI 调用（chatCompletion），后端无法提供中间进度
 * - determinate 模式：用于多步骤操作，需传入精确的 0-100 进度值
 */
export function AiProgressBar({
  variant = "indeterminate",
  progress = 0,
  title,
  description,
  className = "",
}: AiProgressBarProps) {
  const clampedProgress = Math.max(0, Math.min(100, progress))

  return (
    <div
      className={`rounded-xl bg-white/5 border border-white/10 p-4 ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={variant === "determinate" ? clampedProgress : undefined}
      aria-label={title}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-sm font-medium text-white/80">{title}</span>
        </div>
        {variant === "determinate" && (
          <span className="text-xs font-mono text-amber-400">
            {Math.round(clampedProgress)}%
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs text-white/50 mb-3">{description}</p>
      )}
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        {variant === "indeterminate" ? (
          <div
            className="h-full bg-amber-500 rounded-full animate-[ai-progress-indeterminate_1.5s_ease-in-out_infinite]"
            style={{ width: "50%" }}
          />
        ) : (
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${clampedProgress}%` }}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 添加 CSS 动画到 index.css**

在 `src/index.css` 的 `@layer base` 或文件末尾（但需在 `@tailwind` 指令之后）添加：

```css
@keyframes ai-progress-indeterminate {
  0% {
    transform: translateX(-200%);
  }
  100% {
    transform: translateX(200%);
  }
}
```

**放置位置建议：** 放在文件末尾，在已有的 `@layer base` 之后，作为独立代码块。

如果 `src/index.css` 文件末尾已有内容，请确保新动画追加在现有内容之后，不要破坏已有样式。

- [ ] **Step 3: 类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 4: 提交**

```bash
git add src/components/AiProgressBar.tsx src/index.css
git commit -m "ui(progress): 创建 AiProgressBar 可复用进度条组件

- 支持 indeterminate 循环动画模式（单步阻塞 AI 调用）
- 支持 determinate 精确百分比模式（多步骤操作）
- 暗色主题适配，aria 无障碍属性

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 增强 GenerationStepper 添加百分比进度条

**Files:**
- Modify: `src/components/studio/ParameterPanel.tsx`

**Context:**
- `GenerationStepper`（line ~197）当前只显示步骤圆点，没有传统进度条
- `GenProgress` 类型已有 `step: number` 字段
- `DEFAULT_STEPS` 有 6 个步骤（step 0~5），`OUTLINE_STEPS` 也有 6 个步骤
- 百分比映射公式：`Math.min(100, (currentStep / maxStep) * 100)`，其中 `maxStep = steps[steps.length - 1].step`

- [ ] **Step 1: 在 GenerationStepper 中添加百分比进度条**

找到 `GenerationStepper` 函数（line ~197），在返回的 JSX 中，在步骤圆点之后（`</div>` 闭合标签之前，line ~241 附近）添加进度条：

```tsx
function GenerationStepper({ progress, steps = DEFAULT_STEPS }: { progress: GenProgress; steps?: Array<{ step: number; label: string }> }) {
  const currentStep = progress.step
  const maxStep = steps[steps.length - 1]?.step ?? 5
  const percent = progress.completed ? 100 : Math.min(100, (currentStep / maxStep) * 100)

  return (
    <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/10">
      <p className="text-xs font-mono text-white/50 mb-2 text-center">{progress.message}</p>
      {progress.detail && (
        <p className="text-xs text-emerald-400/80 mb-2 text-center animate-pulse">{progress.detail}</p>
      )}
      {/* 步骤圆点（已有代码，保持不变） */}
      <div className="flex items-center justify-between">
        {/* ... 已有步骤圆点代码 ... */}
      </div>
      {/* 新增：百分比进度条 */}
      <div className="mt-3 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-[10px] font-mono text-white/30 text-center mt-1">
        {Math.round(percent)}%
      </p>
    </div>
  )
}
```

**注意：** 不要删除或修改已有的步骤圆点代码，只在原有 `</div>`（步骤圆点容器）之后、`</div>`（最外层容器）之前插入进度条 div。

- [ ] **Step 2: 类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
git add src/components/studio/ParameterPanel.tsx
git commit -m "ui(studio): GenerationStepper 添加百分比进度条

在 6 步步骤指示器下方追加传统进度条，将 step 映射为百分比

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Studio 页面 — 为缺失进度条的 AI 操作添加进度条

**Files:**
- Modify: `src/pages/Studio.tsx`

**Context:**
- Studio.tsx 中需要添加进度条的 AI 操作：
  1. `continue` → `isGenerating` 为 true 但 `genProgress` 为 null（因为 continue 不通过 `generate.progress` 轮询）
  2. `regenerate` → `regenerateMutation.isPending`
  3. `review` → `reviewMutation.isPending`
  4. `inspire` → `inspireMutation.isPending`
- 当前 `isGenerating` 被 `handleGenerate`、`handleGenerateOutline`、`handleContinue` 共用
- `genProgress` 只被 `handleGenerate` 和 `handleGenerateOutline` 设置
- 因此：当 `isGenerating && !genProgress` 时，可以判定为 `continue` 操作进行中

- [ ] **Step 1: 导入 AiProgressBar**

在 `src/pages/Studio.tsx` 的 import 区域添加：

```tsx
import { AiProgressBar } from "@/components/AiProgressBar"
```

- [ ] **Step 2: 为 continue 操作添加进度条**

在内容编辑区底部（`isTyping` 指示器附近，line ~586）添加进度条：

找到这段代码：
```tsx
{isTyping && (
  <div className="flex items-center gap-2 text-amber-500 animate-pulse">
    <Sparkles className="w-4 h-4" />
    <span className="text-sm">输出中...</span>
  </div>
)}
```

**在其下方**添加：

```tsx
{isGenerating && !genProgress && (
  <AiProgressBar
    variant="indeterminate"
    title="AI 续写中"
    description="正在分析前文语境并生成后续内容..."
    className="mt-3"
  />
)}
```

- [ ] **Step 3: 为 regenerate 操作添加进度条**

在段落重写弹窗/区域（line ~567 附近，regenerate 按钮区域）添加进度条：

找到 `handleRegenerate` 相关按钮区域，在按钮下方添加：

```tsx
{regenerateMutation.isPending && (
  <AiProgressBar
    variant="indeterminate"
    title="AI 重写中"
    description="正在根据要求重新生成段落..."
    className="mt-3"
  />
)}
```

**注意：** `regenerateMutation` 需要从 `useStudioState` 的返回值中解构出来。检查当前 `Studio.tsx` 是否已经解构了 `regenerateMutation`。如果没有，需要添加。

从 `useStudioState()` 的返回值中确认已有：`regenerateMutation`。

- [ ] **Step 4: 为 review 操作添加进度条**

在 AI 审阅按钮附近（line ~347 附近）添加进度条：

在审阅按钮的 `</button>` 闭合标签之后添加：

```tsx
{reviewMutation.isPending && (
  <AiProgressBar
    variant="indeterminate"
    title="AI 审阅中"
    description="正在从世界观、角色、文笔、剧情等维度分析作品..."
    className="mt-3"
  />
)}
```

- [ ] **Step 5: 为 inspire 操作添加进度条**

在灵感面板中（line ~1047 附近，`handleInspire` 按钮区域）添加进度条：

在灵感按钮的下方添加：

```tsx
{inspireMutation.isPending && (
  <AiProgressBar
    variant="indeterminate"
    title="灵感搜索中"
    description="正在检索设定库素材并生成创作灵感..."
    className="mt-3"
  />
)}
```

- [ ] **Step 6: 类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 7: 提交**

```bash
git add src/pages/Studio.tsx
git commit -m "ui(studio): 为 continue、regenerate、review、inspire 添加进度条

- continue: isGenerating && !genProgress 时显示 indeterminate 进度条
- regenerate: regenerateMutation.isPending 时显示进度条
- review: reviewMutation.isPending 时显示进度条
- inspire: inspireMutation.isPending 时显示进度条

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Reader 页面 — 为翻译添加进度条

**Files:**
- Modify: `src/pages/Reader.tsx`

**Context:**
- Reader 中 `translateChapterMutation` 用于单章翻译
- 逐章翻译（`handleTranslate` 循环）已有 `translateProgress` state，显示章节计数，不需要改
- 但单章翻译时，按钮只显示 "翻译中..." + spinner，需要增强为进度条

- [ ] **Step 1: 导入 AiProgressBar**

在 `src/pages/Reader.tsx` 的 import 区域添加：

```tsx
import { AiProgressBar } from "@/components/AiProgressBar"
```

- [ ] **Step 2: 为单章翻译添加进度条**

在翻译 banner 区域（line ~780-824），当 `translateChapterMutation.isPending` 时显示进度条：

找到这段代码：
```tsx
{translateProgress?.isTranslating ? (
  <div className="space-y-3">
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/70 font-mono">
        {translateProgress.current > 0
          ? `已完成 ${translateProgress.current}/${translateProgress.total} 章`
          : "准备翻译..."}
      </span>
      <span className="text-amber-400 font-mono">
        {translateProgress.chapterTitle}
      </span>
    </div>
    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full bg-amber-500 rounded-full transition-all"
        style={{
          width: `${translateProgress.total > 0 ? (translateProgress.current / translateProgress.total) * 100 : 0}%`,
        }}
      />
    </div>
  </div>
) : (
```

**逐章翻译的进度条已经存在**，不需要改。但单章翻译时（用户点击"开始翻译"但只翻译一章，或通过 NovelManager 进入），`translateProgress` 可能为 null，而 `translateChapterMutation.isPending` 为 true。

在翻译按钮的 `</button>` 闭合标签之后，添加：

```tsx
{translateChapterMutation.isPending && !translateProgress?.isTranslating && (
  <AiProgressBar
    variant="indeterminate"
    title="AI 翻译中"
    description="正在检索参考素材并翻译当前章节..."
    className="mt-3"
  />
)}
```

**解释：** `!translateProgress?.isTranslating` 确保只在非逐章翻译模式时显示（避免与已有的逐章进度条重复）。

- [ ] **Step 3: 类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 4: 提交**

```bash
git add src/pages/Reader.tsx
git commit -m "ui(reader): 为单章翻译添加 indeterminate 进度条

避免与逐章翻译的 determinate 进度条重复显示

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: LoreLibrary 页面 — 为 AI 提取添加进度条

**Files:**
- Modify: `src/pages/LoreLibrary.tsx`

**Context:**
- `extractStyleProfile`（角色风格提取）button 在 line ~880
- `summarizeWorld`（世界观总结）button 在 line ~723
- `extractWorld`（世界观提取）button 在 line ~1557
- 这些操作都只有 spinner，没有进度条

- [ ] **Step 1: 导入 AiProgressBar**

在 `src/pages/LoreLibrary.tsx` 的 import 区域添加：

```tsx
import { AiProgressBar } from "@/components/AiProgressBar"
```

- [ ] **Step 2: 为 extractStyleProfile 添加进度条**

找到 `extractStyleProfile` 按钮区域（line ~880 附近），在按钮的 `</button>` 闭合标签之后添加：

```tsx
{extractStyleProfile.isPending && (
  <AiProgressBar
    variant="indeterminate"
    title="AI 分析角色风格中"
    description="正在阅读角色样本并提炼语言风格特征..."
    className="mt-3"
  />
)}
```

- [ ] **Step 3: 为 summarizeWorld 添加进度条**

找到 `summarizeWorld` 按钮区域（line ~723 附近），在按钮的 `</button>` 闭合标签之后添加：

```tsx
{summarizeWorldMutation.isPending && (
  <AiProgressBar
    variant="indeterminate"
    title="AI 总结世界观中"
    description="正在整合设定库中的世界观维度..."
    className="mt-3"
  />
)}
```

- [ ] **Step 4: 为 extractWorld 添加进度条**

找到 `extractWorld` 按钮区域（line ~1557 附近），在按钮的 `</button>` 闭合标签之后添加：

```tsx
{extractWorldMutation.isPending && (
  <AiProgressBar
    variant="indeterminate"
    title="AI 提取世界观中"
    description="正在从素材中提取世界观设定..."
    className="mt-3"
  />
)}
```

- [ ] **Step 5: 类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 6: 提交**

```bash
git add src/pages/LoreLibrary.tsx
git commit -m "ui(lore): 为角色风格提取、世界观总结、世界观提取添加进度条

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: MaterialPool 页面 — 为提取和索引添加进度条

**Files:**
- Modify: `src/pages/MaterialPool.tsx`

**Context:**
- `extractLore` 弹窗中已有 loading 状态（line ~898），显示 spinner + "AI 正在分析素材内容并提取设定..."
- `autoExtractLore` 按钮在 line ~805
- `indexAsync` 有 `indexJobStatus` 轮询，但只在按钮上显示禁用状态，没有独立进度展示

- [ ] **Step 1: 导入 AiProgressBar**

在 `src/pages/MaterialPool.tsx` 的 import 区域添加：

```tsx
import { AiProgressBar } from "@/components/AiProgressBar"
```

- [ ] **Step 2: 替换 extractLore 弹窗中的 spinner 为进度条**

找到 `extractLore` 弹窗中的 loading 状态代码（line ~898）：

```tsx
{extractLoreMutation.isPending ? (
  <div className="flex flex-col items-center justify-center py-20">
    <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-4" />
    <p className="text-white/60 text-sm">AI 正在分析素材内容并提取设定...</p>
  </div>
) : extractLoreMutation.isError ? (
```

**替换为：**

```tsx
{extractLoreMutation.isPending ? (
  <div className="flex flex-col items-center justify-center py-20 px-8">
    <AiProgressBar
      variant="indeterminate"
      title="AI 提取设定中"
      description="正在分析素材内容并提取角色、世界观等设定..."
      className="w-full max-w-md"
    />
  </div>
) : extractLoreMutation.isError ? (
```

- [ ] **Step 3: 为 autoExtractLore 添加进度条**

在 `autoExtractLore` 操作进行时，可以在页面适当位置显示进度条。由于 `autoExtractLore` 是按钮触发的，可以在按钮下方添加：

找到 `autoExtractLoreMutation` 相关的按钮区域，在其容器内部、按钮之后添加：

```tsx
{autoExtractLoreMutation.isPending && (
  <AiProgressBar
    variant="indeterminate"
    title="AI 自动提取设定中"
    description="正在分析素材并自动保存到设定库..."
    className="mt-3"
  />
)}
```

**注意：** 由于 `autoExtractLoreMutation` 可能在不同位置触发（素材卡片上的闪电按钮和弹窗中的确认按钮），选择最显眼的触发位置添加进度条即可。建议在素材列表区域（当有 autoExtract 进行中时）显示一个全局提示。

更简单的方式：在包含 `autoExtractLoreMutation.isPending` 条件的最外层容器内添加进度条。由于 `autoExtractLore` 通常快速完成，如果添加位置困难，可以跳过此步骤。

- [ ] **Step 4: 为 indexAsync 添加 determinate 进度条**

`indexAsync` 有 `indexJobStatus` 数据，可以显示精确进度。但 `indexJobStatus` 的结构是：
- `status`: "pending" | "running" | "completed" | "failed"
- `indexedChunks`: number
- `totalCandidates`?: number

当 `indexJobStatus?.status === "running"` 时，可以显示进度条：

在素材卡片区域或页面顶部添加：

```tsx
{indexJobStatus?.status === "running" && (
  <AiProgressBar
    variant="determinate"
    progress={indexJobStatus.totalCandidates && indexJobStatus.totalCandidates > 0
      ? Math.min(100, (indexJobStatus.indexedChunks / indexJobStatus.totalCandidates) * 100)
      : 0}
    title="素材索引中"
    description={`已处理 ${indexJobStatus.indexedChunks}${indexJobStatus.totalCandidates ? ` / ${indexJobStatus.totalCandidates}` : ""} 个片段`}
    className="mt-3"
  />
)}
```

**放置位置建议：** 在素材列表上方或每个正在索引的素材卡片内。最简方式是在页面顶部（NavBar 下方）添加一个固定区域显示当前索引进度。

如果页面顶部已经有通知/提示区域，可以在那里添加。否则，在素材列表的容器开始处添加即可。

- [ ] **Step 5: 类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 6: 提交**

```bash
git add src/pages/MaterialPool.tsx
git commit -m "ui(material): 为设定提取和素材索引添加进度条

- extractLore: 弹窗 loading 状态替换为 AiProgressBar
- indexAsync: 使用 determinate 模式显示索引进度百分比

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 集成验证

- [ ] **Step 1: 完整类型检查**

Run: `npm run check`
Expected: 零 TypeScript 错误

- [ ] **Step 2: 生产构建**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 3: 最终提交**

```bash
git commit -m "ui(progress): 为所有 AI 异步操作添加进度条

- 新建 AiProgressBar 组件（indeterminate + determinate 双模式）
- GenerationStepper 添加百分比进度条
- Studio: continue、regenerate、review、inspire 添加进度条
- Reader: 单章翻译添加进度条
- LoreLibrary: 角色风格提取、世界观总结、世界观提取添加进度条
- MaterialPool: 设定提取和素材索引添加进度条

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

### Spec Coverage

| 需求 | 实现任务 |
|------|---------|
| 可复用进度条组件 | Task 1 |
| GenerationStepper 百分比增强 | Task 2 |
| Studio continue 进度条 | Task 3 Step 2 |
| Studio regenerate 进度条 | Task 3 Step 3 |
| Studio review 进度条 | Task 3 Step 4 |
| Studio inspire 进度条 | Task 3 Step 5 |
| Reader 翻译进度条 | Task 4 |
| LoreLibrary extractStyleProfile 进度条 | Task 5 Step 2 |
| LoreLibrary summarizeWorld 进度条 | Task 5 Step 3 |
| LoreLibrary extractWorld 进度条 | Task 5 Step 4 |
| MaterialPool extractLore 进度条 | Task 6 Step 2 |
| MaterialPool indexAsync 进度条 | Task 6 Step 4 |

### Placeholder Scan

- 无 "TBD", "TODO"
- 所有步骤包含完整代码
- 类型名称一致：`AiProgressBarProps`, `AiProgressBar`

### 已知限制

- `autoExtractLore` 的进度条可能需要根据实际 UI 布局微调位置
- `indexAsync` 的 `totalCandidates` 字段可能为 undefined，代码已处理（回退到 0%）
- 单步阻塞 AI 调用（所有 `chatCompletion`）只能显示 indeterminate 动画，无法提供精确百分比
