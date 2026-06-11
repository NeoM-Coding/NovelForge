# 收紧 Inspire 灵感发散度 + 新增设定遵循度参数

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `generate.inspire` 返回的灵感与系列设定库（角色、世界观、正史、桥段）紧密绑定，不再天马行空。新增 `canonFidelity` 参数让用户控制发散程度。

**Architecture:** 在 `inspire` mutation 中复用 `buildBaseContext` 的设定库注入逻辑（角色卡、世界观、正史、桥段），大幅降低 temperature，收紧 web 搜索查询词，并在 prompt 中增加"铁律"约束。前端 `ParameterPanel` 新增 `canonFidelity` 三档控件。

**Tech Stack:** TypeScript, Hono, tRPC 11, DeepSeek API, React 19, Tailwind CSS

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `api/routers/generate.ts` | `inspire` mutation：注入设定库、收紧 prompt、降低 temperature、添加 canonFidelity 分支 |
| `src/types/studio.ts` | 新增 `InspireCanonFidelity` 类型 |
| `src/hooks/useStudioState.ts` | 新增 `inspireCanonFidelity` 状态，handleInspire 透传 |
| `src/components/studio/ParameterPanel.tsx` | 新增 canonFidelity 三档选择器 |

---

## 当前问题分析

1. **完全不注入设定库** — `inspire` prompt 只有系列名称 + 素材 + 网络搜索结果，无角色卡/世界观/正史/桥段
2. **temperature 过高** — `0.9` 让模型非常发散
3. **Web 搜索过泛** — 搜索词包含"热门梗"，引入大量无关外部信息
4. **Prompt 缺少铁律约束** — 没有告诉 AI"灵感必须与设定库一致"
5. **无 brief 时鼓励发散** — prompt 直接说"自由发散，提供多样化的创作切入点"

---

### Task 1: 后端 — 收紧 inspire prompt 并注入设定库

**Files:**
- Modify: `api/routers/generate.ts:2758-2871`

**Context:**
- `inspire` mutation 当前完全独立构建 prompt，没有调用 `buildBaseContext` 或 `buildSystemPrompt`
- `buildBaseContext`（约 line ~370）可以查询角色卡、世界观、正史、桥段、RAG、TM 等
- `buildBaseContext` 返回 `{ characters, worldView, canon, tropes, ragSummary, tmPairs, ... }`
- `buildBaseContext` 接受 `seriesId, brief, parameters, parentNovelId, useMaterials, materialIds, selectedCharacterIds, selectedTropeIds` 等参数

- [ ] **Step 1: 在 `inspire` mutation 中调用 `buildBaseContext` 获取设定库**

在 `api/routers/generate.ts:2766`（`const db = getDb()` 之后）添加：

```typescript
// 获取设定库上下文（与 buildSystemPrompt 同源）
const { characters, worldView, canon, tropes } = await buildBaseContext(
  input.seriesId,
  input.brief || "",
  { temperature: 0.7, styleFidelity: 5, characterLoyalty: 5, tone: "mysterious", lengthTarget: "short", canonConstraint: "strict", writingMode: "canon_continuation", ragLimit: 3 } as Partial<GenParams>,
  undefined, // parentNovelId
  input.materialIds && input.materialIds.length > 0,
  input.materialIds,
  undefined, // selectedCharacterIds
  undefined, // selectedTropeIds
)
```

**注意：** `buildBaseContext` 需要 `parameters` 参数，类型是 `Partial<GenParams>`。传入一个最小化的对象即可，因为 `inspire` 不依赖 `styleFidelity` 等参数来过滤设定库内容。

- [ ] **Step 2: 构建设定库注入文本**

在 `prompt` 构建之前，添加设定库文本拼接：

```typescript
const loreSections: string[] = []

if (characters && characters.length > 0) {
  loreSections.push(`【角色设定】\n${characters.map(c => `- ${c.name}：${c.personality?.slice(0, 200) || ""}`).join("\n")}`)
}

if (worldView && worldView.trim().length > 0) {
  loreSections.push(`【世界观设定】\n${worldView.slice(0, 1500)}`)
}

if (canon && canon.trim().length > 0) {
  loreSections.push(`【正史约束（铁律）】\n${canon.slice(0, 1000)}`)
}

if (tropes && tropes.trim().length > 0) {
  loreSections.push(`【桥段参考】\n${tropes.slice(0, 800)}`)
}

const loreSection = loreSections.length > 0 ? loreSections.join("\n\n") : ""
```

- [ ] **Step 3: 重写 inspire prompt，增加铁律约束**

替换原有的 prompt 构建（约 line ~2795-2818）：

```typescript
const prompt = `你是一位熟悉本系列设定的创意写作顾问。请严格基于以下设定库信息，为用户提供**与设定一致**的创作灵感建议。

【系列名称】${seriesRow?.name || "未知"}
${input.brief?.trim() ? `【创作方向】${input.brief}` : "【创作方向】用户尚未指定具体方向，请基于已有设定库，提供严谨的剧情延伸方向。"}
【灵感焦点】${focusMap[input.focus] || focusMap.full}

${loreSection ? `${loreSection}\n\n` : ""}${materialTexts.length > 0 ? `【参考素材】\n${materialTexts.join("\n\n---\n\n")}\n\n` : ""}${searchResults.length > 0 ? `【网络检索参考】\n${searchResults.map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}`).join("\n\n")}\n\n` : ""}**铁律约束（必须严格遵守）：**
1. 所有灵感建议必须与上述设定库一致，不得引入未在设定库中出现的角色、世界观规则或正史事件。
2. 不得违背正史约束（如已死亡的角色不能复活、已确定的关系不能随意改变）。
3. 网络检索结果仅作为背景参考，不能作为设定依据——设定库才是唯一权威。
4. 灵感描述必须具体到"谁（角色）在什么情境下做了什么"，不能泛泛而谈。

请严格按以下 JSON 格式返回（不要包含 markdown 代码块标记）：
{
  "inspirations": [
    {
      "title": "灵感标题（10字以内）",
      "category": "情节/角色/世界观/文笔",
      "description": "具体灵感描述，包含可操作的创作方向",
      "references": ["参考的设定库元素或素材序号"]
    }
  ],
  "combinations": ["将多个设定元素组合的新颖建议"],
  "trends": ["当前流行的相关创作趋势（仅作参考）"],
  "warnings": ["需要注意的雷点或常见陷阱"]
}`
```

- [ ] **Step 4: 降低 temperature 到 0.6**

```typescript
const inspireResult = await chatCompletion({
  messages: [{ role: "user", content: prompt }],
  temperature: 0.6,
  maxTokens: 4000,
})
```

- [ ] **Step 5: 收紧 web 搜索查询**

将搜索查询（约 line ~2782-2784）从：
```typescript
const searchQuery = input.brief?.trim()
  ? `${seriesRow?.name || ""} ${input.brief.slice(0, 50)} 小说 剧情 灵感`
  : `${seriesRow?.name || ""} 同人小说 创作灵感 热门梗 剧情方向`
```

改为：
```typescript
const searchQuery = input.brief?.trim()
  ? `${seriesRow?.name || ""} ${input.brief.slice(0, 50)} 剧情分析 角色关系`
  : `${seriesRow?.name || ""} 世界观 角色设定 剧情分析`
```

去掉"热门梗"和"创作灵感"等宽泛词汇，改为更具体的"剧情分析"、"角色关系"、"世界观"。

- [ ] **Step 6: 提交**

```bash
git add api/routers/generate.ts
git commit -m "api(generate): inspire 注入设定库约束，收紧 prompt，降低 temperature"
```

---

### Task 2: 后端 — 新增 canonFidelity 参数

**Files:**
- Modify: `api/routers/generate.ts:2758-2764`, `api/routers/generate.ts:2795-2818`

- [ ] **Step 1: `inspire` input schema 添加 `canonFidelity`**

将 `inspire` 的 input schema 从：
```typescript
.inspire: publicQuery
  .input(z.object({
    seriesId: z.number(),
    brief: z.string().optional(),
    materialIds: z.array(z.number()).optional(),
    focus: z.enum(["plot", "character", "worldview", "writing", "full"]).default("full"),
  }))
```

改为：
```typescript
.inspire: publicQuery
  .input(z.object({
    seriesId: z.number(),
    brief: z.string().optional(),
    materialIds: z.array(z.number()).optional(),
    focus: z.enum(["plot", "character", "worldview", "writing", "full"]).default("full"),
    canonFidelity: z.enum(["strict", "moderate", "inspired"]).default("moderate"),
  }))
```

- [ ] **Step 2: 根据 canonFidelity 调整 prompt 约束强度**

在 prompt 构建处，根据 `input.canonFidelity` 选择不同的约束模板：

```typescript
const fidelityConstraint = input.canonFidelity === "strict"
  ? `**铁律约束（严格模式）：**
1. 所有灵感建议必须与设定库完全一致，不得引入任何未在设定库中出现的角色、世界观规则或正史事件。
2. 不得改变已有角色的核心性格、关系和命运。
3. 网络检索结果仅作为时代背景参考，不能作为设定依据。
4. 每个灵感必须明确标注"基于XX角色/XX设定"，说清楚灵感与设定库的绑定关系。`
  : input.canonFidelity === "moderate"
  ? `**铁律约束（适度模式）：**
1. 所有灵感建议必须与设定库一致，不得引入未在设定库中出现的核心角色或世界观规则。
2. 次要角色或背景细节可以在不违背正史的前提下适度扩展。
3. 网络检索结果仅作为参考，设定库才是唯一权威。
4. 灵感描述必须具体到"谁（角色）在什么情境下做了什么"。`
  : `**铁律约束（启发模式）：**
1. 灵感建议必须基于设定库中的角色和世界观，但可以对这些元素进行大胆重新组合。
2. 允许在不违背正史大框架的前提下，探索角色的"如果...会怎样"情境。
3. 网络检索结果可以作为风格或时代背景的参考。
4. 每个灵感必须说明它基于哪些设定元素。`
```

将 fidelityConstraint 插入到 prompt 中"铁律约束"的位置。

- [ ] **Step 3: 提交**

```bash
git add api/routers/generate.ts
git commit -m "api(generate): inspire 新增 canonFidelity 三档参数"
```

---

### Task 3: 前端类型与状态管理

**Files:**
- Modify: `src/types/studio.ts`
- Modify: `src/hooks/useStudioState.ts`

- [ ] **Step 1: `src/types/studio.ts` 添加 `InspireCanonFidelity` 类型**

在文件末尾添加：
```typescript
export type InspireCanonFidelity = "strict" | "moderate" | "inspired"
```

- [ ] **Step 2: `useStudioState.ts` 添加 `inspireCanonFidelity` 状态**

在 `inspireFocus` 状态附近（约 line ~92）添加：
```typescript
const [inspireCanonFidelity, setInspireCanonFidelity] = useState<InspireCanonFidelity>("moderate")
```

导入 `InspireCanonFidelity` from `@/types/studio`。

- [ ] **Step 3: `handleInspire` 透传 `canonFidelity`**

在 `handleInspire` 的 `mutateAsync` 调用处（约 line ~888）添加：
```typescript
const result = await inspireMutation.mutateAsync({
  seriesId: selectedSeriesId,
  brief: brief.trim() || undefined,
  materialIds: selectedMaterialIds.length > 0 ? selectedMaterialIds : undefined,
  focus: inspireFocus,
  canonFidelity: inspireCanonFidelity,
})
```

- [ ] **Step 4: hook 返回对象暴露新状态**

在返回对象中添加：
```typescript
inspireCanonFidelity,
setInspireCanonFidelity,
```

- [ ] **Step 5: 提交**

```bash
git add src/types/studio.ts src/hooks/useStudioState.ts
git commit -m "feat(studio): 前端状态管理接入 canonFidelity 参数"
```

---

### Task 4: 前端 ParameterPanel 添加 canonFidelity 控件

**Files:**
- Modify: `src/components/studio/ParameterPanel.tsx`

- [ ] **Step 1: 在 `ParameterPanel` props 中添加 `inspireCanonFidelity` 和 `setInspireCanonFidelity`**

找到 `InspireFocus` 相关 props（约 line ~66），添加：
```typescript
inspireCanonFidelity: InspireCanonFidelity
setInspireCanonFidelity: (v: InspireCanonFidelity) => void
```

导入 `InspireCanonFidelity` from `@/types/studio`。

- [ ] **Step 2: 解构新 props**

在组件函数体中解构：
```typescript
inspireCanonFidelity,
setInspireCanonFidelity,
```

- [ ] **Step 3: 在 Inspire 按钮附近添加 canonFidelity 三档选择器**

在 `inspireFocus` 选择器之后（约 line ~654-655），添加：

```tsx
<div className="mt-2">
  <p className="text-[10px] text-white/40 mb-1">设定遵循度</p>
  <div className="flex bg-white/5 rounded-lg p-0.5">
    {[
      { value: "strict" as const, label: "严格", desc: "完全绑定设定库" },
      { value: "moderate" as const, label: "适度", desc: "允许次要扩展" },
      { value: "inspired" as const, label: "启发", desc: "大胆重新组合" },
    ].map(opt => (
      <button
        key={opt.value}
        onClick={() => setInspireCanonFidelity(opt.value)}
        title={opt.desc}
        className={`flex-1 px-2 py-1 rounded-md text-[10px] transition-colors ${
          inspireCanonFidelity === opt.value
            ? "bg-amber-500/20 text-amber-400"
            : "text-white/50 hover:text-white/70"
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 4: 提交**

```bash
git add src/components/studio/ParameterPanel.tsx
git commit -m "feat(ui): ParameterPanel 添加 canonFidelity 三档选择器"
```

---

### Task 5: 集成验证

- [ ] **Step 1: 类型检查**

```bash
npm run check
```

预期：零 TypeScript 错误。

- [ ] **Step 2: 运行测试**

```bash
npm run test
```

预期：所有测试通过。

- [ ] **Step 3: 生产构建**

```bash
npm run build
```

预期：构建成功。

- [ ] **Step 4: 最终提交**

```bash
git commit -m "fix(inspire): 收紧灵感发散度，新增 canonFidelity 设定遵循度参数

- inspire 注入设定库（角色、世界观、正史、桥段）
- temperature 从 0.9 降至 0.6
- 收紧 web 搜索查询词，去掉'热门梗'
- prompt 增加铁律约束，区分三档 fidelity
- 前端 ParameterPanel 新增 canonFidelity 选择器

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

### Spec Coverage

| 需求 | 实现任务 |
|------|---------|
| 注入设定库（角色、世界观、正史、桥段） | Task 1 Step 1-2 |
| 收紧 prompt 铁律约束 | Task 1 Step 3, Task 2 Step 2 |
| 降低 temperature | Task 1 Step 4 |
| 收紧 web 搜索 | Task 1 Step 5 |
| 新增 canonFidelity 三档参数 | Task 2 Step 1-2 |
| 前端状态管理 | Task 3 |
| 前端 UI 控件 | Task 4 |

### Placeholder Scan

- 无 "TBD", "TODO"
- 所有步骤包含完整代码
- 类型名称一致：`InspireCanonFidelity`, `canonFidelity`, `inspireCanonFidelity`

### 已知限制

- `buildBaseContext` 的参数列表较长，调用时传入了一个 mock `GenParams` 对象。如果未来 `buildBaseContext` 对参数有更多依赖，可能需要调整。
- `loreSections` 的字符截断（`.slice(0, N)`）是硬编码的，但足以提供上下文而不超 token 预算。
