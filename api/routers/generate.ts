import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { characterCards, worldBibles, seriesCanon, fanFictionWorks, fanFictionChapters, plotTropes, novels, chapters, ragFeedback, generationJobs } from "@db/schema"
import { eq, asc, desc, sql } from "drizzle-orm"
import { streamChat, chatCompletion } from "../services/deepseek"
import { searchSimilar, getEmbeddingWithCache } from "../services/embedder"
import { outlineSchema, type Outline, batchGenerationSchema, exportWorkSchema } from "@contracts/schemas"

const WRITING_MODES = [
  "canon_continuation",
  "character_spinoff",
  "original_in_universe",
  "alternate_universe",
] as const

// 生成任务进度（内存存储，单用户场景无需 Redis）
// key: taskId, value: { step, message, completed, result }
interface GenerationProgress {
  step: number
  message: string
  completed: boolean
  result?: { workId: number; title: string }
  error?: string
}
const generationProgress = new Map<string, GenerationProgress>()

function setProgress(taskId: string, step: number, message: string) {
  generationProgress.set(taskId, { step, message, completed: false })
}
function completeProgress(taskId: string, result: { workId: number; title: string }, finalStep = 4) {
  generationProgress.set(taskId, { step: finalStep, message: "创作完成", completed: true, result })
}
function failProgress(taskId: string, error: string) {
  generationProgress.set(taskId, { step: -1, message: error, completed: true, error })
}

// 获取指定作品上一章的最后 N 字作为前文衔接上下文
async function getPreviousContext(workId: number, currentChapterNumber: number, tailLength = 800): Promise<string | undefined> {
  if (currentChapterNumber <= 1) return undefined
  const db = getDb()
  const [prevChapter] = await db
    .select({ content: fanFictionChapters.content })
    .from(fanFictionChapters)
    .where(sql`${fanFictionChapters.workId} = ${workId} AND ${fanFictionChapters.chapterNumber} = ${currentChapterNumber - 1}`)
  return prevChapter?.content ? prevChapter.content.slice(-tailLength) : undefined
}

// 从 outline 对象构建注入 prompt 的字符串
function buildOutlineSection(outline: Outline): string {
  const parts: string[] = []
  parts.push("【故事大纲】")
  if (outline.overview) {
    parts.push("故事概述：" + outline.overview)
  }
  if (outline.scenes && outline.scenes.length > 0) {
    parts.push("章节规划：")
    for (const scene of outline.scenes) {
      parts.push(`- ${scene.title}：${scene.description}`)
    }
  }
  return parts.join("\n")
}

// 生成单章内容（被 batch 复用）
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
  }
): Promise<{ content: string; ragCalls: RagCall[]; warnings?: string[] }> {
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

  const response = await chatCompletion({
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `请创作第 ${chapterNumber} 章《${chapterTitle}》。要求：${chapterBrief}` },
    ],
    temperature: params.temperature ?? 0.8,
    maxTokens: params.lengthTarget === "short" ? 2000 : params.lengthTarget === "arc" ? 6000 : 4000,
  })

  return { content: sanitizeGeneratedContent(response), ragCalls, warnings }
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

// 生成参数 Schema
const generationParamsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.8),
  styleFidelity: z.number().min(1).max(10).default(7),
  characterLoyalty: z.number().min(1).max(10).default(8),
  tone: z.string().default("dramatic"),
  lengthTarget: z.enum(["short", "chapter", "arc"]).default("chapter"),
  canonConstraint: z.enum(["strict", "loose", "au"]).default("strict"),
  writingMode: z.enum(WRITING_MODES).default("canon_continuation"),
  ragLimit: z.number().min(1).max(10).default(5),
})

type GenParams = z.infer<typeof generationParamsSchema>

type RagCall = {
  type: "novel_style" | "material" | "keyword"
  content: string
  score?: number
  sourceTitle?: string       // ← 新增：来源标题
  chapterNumber?: number     // ← 新增：章节号
  chunkIndex?: number        // ← 新增：片段序号
  totalChunks?: number       // ← 新增：总片段数
  chunkId?: number           // ← 新增：vector_chunks.id，用于反馈闭环
}

type BaseContext = {
  selectedChars: typeof characterCards.$inferSelect[]
  unselectedChars: typeof characterCards.$inferSelect[]
  worldBible: typeof worldBibles.$inferSelect | undefined
  canonEvents: Array<typeof seriesCanon.$inferSelect>
  ragCalls: RagCall[]
  ragContent: string
  warnings: string[]
}

// ========== 创作模式配置 ==========

const MODE_CONFIG: Record<
  (typeof WRITING_MODES)[number],
  {
    name: string
    characterInstruction: string
    worldViewConstraint: string
    canonTreatment: string
  }
> = {
  canon_continuation: {
    name: "正史续写",
    characterInstruction:
      "【角色使用规则】仅使用以下明确列出的角色。未列出的角色不得在故事中出现。每个角色的性格、动机、语言风格必须严格遵守角色设定卡。禁止为了凑戏份而强行安排角色出场。",
    worldViewConstraint:
      "【世界观约束】世界观设定为绝对铁律，不可违背。力量体系的核心规则、地理政治的基本架构必须与设定完全一致。",
    canonTreatment:
      "【正史约束】严格遵循正史时间线。不可变事件绝对不可更改或违背。故事必须在正史框架内发展，不得产生时间线矛盾。",
  },
  character_spinoff: {
    name: "角色外传",
    characterInstruction:
      "【角色使用规则】以用户指定的角色为主角展开独立故事。其他已有角色仅在情节自然需要时出现，禁止为了出场而出场。你可以创作全新的配角来推动剧情。",
    worldViewConstraint:
      "【世界观约束】世界观设定严格遵守。力量体系、地理政治架构不可违背。角色的能力边界必须符合设定。",
    canonTreatment:
      "【正史约束】以正史为基础，但故事时间点可以在正史的空白期。不与不可变事件冲突即可，允许合理的延伸和补充。",
  },
  original_in_universe: {
    name: "同世界观原创",
    characterInstruction:
      "【角色使用规则】本次创作的核心要求是：创作全新的原创角色和故事。除非创作要求（Brief）中明确点名某个已有角色，否则绝对禁止在任何场景中使用已有角色——包括对话、回忆、旁白提及、背景故事、路人甲、传说典故。主角必须是完全原创的人物：全新的姓名、身份、背景、动机和人际关系。已有角色仅作为'世界观背景设定中的抽象历史概念'存在，不可具名出现。禁止将已有角色的名字、特征、关系套用到新角色身上。",
    worldViewConstraint:
      "【世界观约束】世界观和力量体系为绝对铁律，不可违背。这是在同世界观下创作新故事的核心约束——你可以写全新的故事，但必须遵守世界的基本规则。",
    canonTreatment:
      "【正史约束】正史事件作为世界背景参考，你的故事可以在正史的空白期或边缘地带展开，不必严格绑定正史主线。不需要复述正史。",
  },
  alternate_universe: {
    name: "AU/平行宇宙",
    characterInstruction:
      "【角色使用规则】保留角色的核心性格和人际关系内核，但他们的身份、职业、能力、所处环境可以大幅改变。你可以自由重组角色关系，创作全新的互动模式。",
    worldViewConstraint:
      "【世界观约束】世界观可以大幅改编。你可以重构力量体系、科技水平、社会结构。仅保留你需要的元素，其余可自由发挥。",
    canonTreatment:
      "【正史约束】正史仅作为角色背景参考。你可以自由改写历史事件，创造全新的时间线。不必遵循原作历史。",
  },
}

// 各创作模式的 RAG 检索策略（动态权重调优）
const MODE_RAG_CONFIG: Record<
  (typeof WRITING_MODES)[number],
  { novelStyleLimit: number; materialLimit: number; keywordLimit: number }
> = {
  canon_continuation:   { novelStyleLimit: 3, materialLimit: 3, keywordLimit: 2 },
  character_spinoff:    { novelStyleLimit: 2, materialLimit: 4, keywordLimit: 2 },
  original_in_universe: { novelStyleLimit: 1, materialLimit: 5, keywordLimit: 2 },
  alternate_universe:   { novelStyleLimit: 2, materialLimit: 4, keywordLimit: 2 },
}

async function buildBaseContext(
  seriesId: number,
  brief: string,
  rawParams: Partial<GenParams>,
  parentNovelId?: number,
  useMaterials?: boolean,
  materialIds?: number[],
  selectedCharacterIds?: number[],
  _selectedTropeIds?: number[],
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

  let ragContent = ""
  const ragParts: string[] = []
  const ragCalls: RagCall[] = []
  const seenChunkIds = new Set<number>()

  const buildRagPrefix = (content: string): string => {
    const containsUnselected = unselectedChars.some(c => {
      const names = [c.name, ...(c.aliases as string[] || [])]
      return names.some(n => content.includes(n))
    })
    return containsUnselected
      ? "【⚠️ 以下素材含未授权角色，仅参考情节结构，切勿引入其中角色】\n"
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

function buildStyleGuide(fidelity: number): string {
  const parts = [
    "【文风指导】",
    `风格忠实度 ${fidelity}/10：`,
  ]

  if (fidelity >= 9) {
    parts.push("- 10分标准：严格模仿原作的字词选择、句式结构、修辞习惯和叙事节奏")
    parts.push("- 注意原作作者的标志性表达方式和过渡手法")
  } else if (fidelity >= 6) {
    parts.push("- 7-9分标准：显著模仿原作风格，同时保持自然流畅")
    parts.push("- 借鉴原作的叙事节奏和描写方式，但不生硬照搬")
  } else if (fidelity >= 3) {
    parts.push("- 3-6分标准：适度参考原作风格，允许个人发挥")
    parts.push("- 保持中文小说的一般规范即可，不必刻意模仿")
  } else {
    parts.push("- 1-2分标准：仅借用世界观和角色，文风完全自由")
    parts.push("- 你可以使用自己的独特写作风格")
  }

  parts.push("")
  parts.push("执行要求（必须遵守）：")
  parts.push("1. 句式长短交替，禁止连续使用相同句式结构")
  parts.push("2. 对话必须符合角色设定的语气和词汇习惯")
  parts.push("3. 环境描写与氛围设定一致，禁止堆砌辞藻")
  parts.push("4. 禁止使用生造词汇、不通顺的比喻、欧化中文句式")
  parts.push("5. 段落之间要有自然的过渡，禁止突兀的跳切")
  parts.push("6. 叙事视角保持一致，不要随意切换")

  return parts.join("\n")
}

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

  const modeConfig = MODE_RAG_CONFIG[mode]
  const { selectedChars, unselectedChars, worldBible, canonEvents, ragCalls, ragContent, warnings } = await buildBaseContext(
    seriesId, brief, rawParams, parentNovelId, useMaterials, materialIds, selectedCharacterIds, selectedTropeIds,
    { novelStyleLimit: 1, materialLimit: Math.max(5, modeConfig.materialLimit), keywordLimit: modeConfig.keywordLimit }
  )

  // 构建 System Prompt
  const parts: string[] = [
    `你是一位精通中文小说创作的故事架构师。当前创作模式：${MODE_CONFIG[mode].name}。请根据以下设定，为指定创作方向生成一份结构化大纲。`,
    "",
    "========== 核心任务（最高优先级）==========",
    brief.trim(),
    "",
    "========== 角色规则 ==========",
    MODE_CONFIG[mode].characterInstruction,
  ]

  if (selectedChars.length > 0) {
    parts.push("")
    parts.push("【授权角色 — 仅允许使用以下角色】")
    for (const char of selectedChars) {
      const traits = (char.personalityTraits as string[] || []).join("。") || "无性格标签"
      const taboos = (char.taboos as string[] || []).join("。")
      parts.push(`- ${char.name}: ${traits}${taboos ? ` | 禁忌: ${taboos}` : ""}${char.speechPatterns ? ` | 语言风格: ${char.speechPatterns}` : ""}`)
    }
  }

  if (unselectedChars.length > 0) {
    parts.push("")
    parts.push(`【严禁出场的角色】以下角色绝对禁止在本故事大纲中出现：\n${unselectedChars.map(c => `- ${c.name}`).join("\n")}`)
  }

  // 桥段注入
  if (selectedTropeIds && selectedTropeIds.length > 0) {
    const tropes = await db
      .select()
      .from(plotTropes)
      .where(eq(plotTropes.seriesId, seriesId))
    const selectedTropes = tropes.filter(t => selectedTropeIds.includes(t.id))
    if (selectedTropes.length > 0) {
      parts.push("")
      parts.push("【参考桥段 — 可借鉴的情节模式】")
      for (const trope of selectedTropes) {
        parts.push(`\n「${trope.name}」`)
        if (trope.description) parts.push(`  描述: ${trope.description}`)
        if (trope.pattern) parts.push(`  流程: ${trope.pattern}`)
      }
    }
  }

  // 世界观铁律
  parts.push(buildWorldViewSection(worldBible))
  parts.push("")
  parts.push(MODE_CONFIG[mode].worldViewConstraint)

  // 正史
  if (canonEvents.length > 0) {
    parts.push(buildCanonSection(canonEvents, mode))
  }

  // RAG 素材（不检索翻译记忆，大纲不需要文风模仿）
  if (ragContent) {
    parts.push("")
    parts.push("【参考素材使用规则】以下检索到的素材仅供情节结构、角色关系和世界观参考：")
    parts.push("1. 禁止直接复制素材中的情节或对话")
    parts.push("2. 仅借鉴其情节结构、角色关系和世界观设定")
    parts.push("3. 你的大纲必须与【核心任务】高度相关，不要偏离主题")
    parts.push("")
    parts.push("===== 参考素材开始 =====")
    parts.push(ragContent)
    parts.push("===== 参考素材结束 =====")
  }

  // 用户自定义
  if (userPrompt && userPrompt.trim()) {
    parts.push("")
    parts.push("【用户自定义要求】（以下内容优先级最高）")
    parts.push(userPrompt.trim())
  }

  parts.push("")
  parts.push("========== 大纲生成要求 ==========")
  parts.push("请生成一份结构化大纲，要求如下：")
  parts.push("1. 每个场景必须包含：场景标题、场景目标、关键冲突、预期结果")
  parts.push("2. 场景之间必须有逻辑递进关系，禁止突兀转折")
  parts.push("3. 大纲必须与【核心任务】高度相关，不要偏离主题")
  parts.push("4. 使用标准中文，禁止使用 Markdown 标记")
  parts.push("5. 输出格式必须是结构化文本，便于后续解析")

  return { prompt: parts.join("\n"), ragCalls, warnings: warnings.length > 0 ? warnings : undefined }
}

async function parseOutline(
  rawText: string,
  outlineType: "overview" | "scenes" | "both"
): Promise<{ overview?: string; scenes?: Array<{ id: string; title: string; description: string }> }> {
  // 尝试直接解析 JSON（先清洗可能的 markdown 包裹）
  try {
    const cleaned = rawText.replace(/^```[a-z]*\s*|\s*```$/gim, "").trim()
    const json = JSON.parse(cleaned)
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
    // 不是 JSON，尝试用 AI 二次解析
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
      const cleaned = parsed.trim().replace(/^```json\s*|\s*```$/g, "")
      const json = JSON.parse(cleaned)
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
      // 解析失败时降级为纯文本
      return {
        overview: outlineType !== "scenes" ? rawText.trim() : undefined,
        scenes: outlineType !== "overview"
          ? [{
              id: crypto.randomUUID(),
              title: "整体大纲",
              description: rawText.trim(),
            }]
          : undefined,
      }
    }
  }
}

function safeParseOutline(raw: unknown): { valid: boolean; outline: Outline } {
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
  return { valid: false, outline: fallback }
}

// RAG 检索结果 AI 摘要：将碎片化的 chunks 提炼成连贯上下文
async function summarizeRagChunks(chunks: RagCall[]): Promise<string | null> {
  if (chunks.length === 0) return null
  const summaryPrompt = `请根据以下从素材库检索到的参考片段，提炼一段连贯、去重、按主题组织的参考上下文。
要求：
1. 去除重复或高度相似的内容
2. 如果不同片段对同一设定有矛盾描述，优先保留最详细/最权威的那条
3. 按「世界观设定」「角色特征」「情节参考」「语言风格」分组组织
4. 总长度控制在 500-800 字
5. 保持原文的关键细节和用词风格

参考片段：
${chunks.map((c, i) => `【片段 ${i + 1}】${c.content}`).join("\n\n")}`

  try {
    const summary = await chatCompletion({
      messages: [{ role: "user", content: summaryPrompt }],
      temperature: 0.3,
      maxTokens: 1200,
    })
    const trimmed = summary.trim()
    // 如果摘要结果过短，视为失败，回退到原始 chunks 拼接
    if (trimmed.length < 50) return null
    return trimmed
  } catch {
    return null
  }
}

function buildWorldViewSection(worldBible: typeof worldBibles.$inferSelect | undefined): string {
  if (!worldBible) return ""

  const parts: string[] = []

  // 优先使用动态 aspects（新数据）
  const aspects = (worldBible.aspects || []) as Array<{ name: string; content: string }>
  if (aspects.length > 0) {
    parts.push("")
    parts.push("【世界观设定】")
    for (const aspect of aspects) {
      parts.push(`「${aspect.name}」${aspect.content}`)
    }
  }

  // 兼容旧数据：固定字段
  const ironRules: string[] = []
  const background: string[] = []

  if (worldBible.magicSystem) ironRules.push(`力量体系: ${worldBible.magicSystem}`)
  if (worldBible.technologyLevel) ironRules.push(`技术水平: ${worldBible.technologyLevel}`)
  if (worldBible.geography) ironRules.push(`地理政治: ${worldBible.geography}`)
  if (worldBible.factions && (worldBible.factions as Array<unknown>).length > 0) {
    ironRules.push(`势力架构: ${JSON.stringify(worldBible.factions)}`)
  }

  if (worldBible.culturalCustoms) background.push(`文化习俗: ${worldBible.culturalCustoms}`)
  if (worldBible.linguisticNotes) background.push(`语言命名: ${worldBible.linguisticNotes}`)
  if (worldBible.timelineEvents && (worldBible.timelineEvents as Array<unknown>).length > 0) {
    background.push(`历史脉络: ${JSON.stringify(worldBible.timelineEvents)}`)
  }

  if (ironRules.length > 0) {
    parts.push("")
    parts.push("【世界观 · 铁律】以下设定绝对不可违背：")
    for (const r of ironRules) parts.push(r)
  }

  if (background.length > 0) {
    parts.push("")
    parts.push("【世界观 · 背景】以下设定可作细节点缀，非强制遵守：")
    for (const b of background) parts.push(b)
  }

  return parts.join("\n")
}

function buildCanonSection(
  canonEvents: Array<typeof seriesCanon.$inferSelect>,
  mode: (typeof WRITING_MODES)[number]
): string {
  const immutableEvents = canonEvents.filter(e => e.isImmutable)
  const mutableEvents = canonEvents.filter(e => !e.isImmutable)

  const parts: string[] = []

  if (immutableEvents.length > 0) {
    parts.push("")
    parts.push("【不可变正史事件】以下事件绝对不可更改或违背：")
    for (const event of immutableEvents) {
      parts.push(`- ${event.description}`)
    }
  }

  if (mode !== "alternate_universe" && mutableEvents.length > 0) {
    parts.push("")
    parts.push("【可变正史事件】以下事件作为背景参考：")
    for (const event of mutableEvents.slice(0, 5)) {
      parts.push(`- ${event.description}`)
    }
  }

  parts.push("")
  parts.push(MODE_CONFIG[mode].canonTreatment)

  return parts.join("\n")
}

// 组装 System Prompt
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
  previousContext?: string,
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
  const db = getDb()

  const { selectedChars, unselectedChars, worldBible, canonEvents, ragCalls, ragContent, warnings } = await buildBaseContext(
    seriesId, brief, rawParams, parentNovelId, useMaterials, materialIds, selectedCharacterIds, selectedTropeIds
  )

  // 翻译记忆风格检索（当风格忠实度 >= 7 且有关联小说时）—— 仅 buildSystemPrompt 需要
  let extendedRagContent = ragContent
  let extendedRagCalls = ragCalls
  if (params.styleFidelity >= 7 && parentNovelId) {
    try {
      let briefEmbedding: number[] | undefined
      try {
        briefEmbedding = await getEmbeddingWithCache(brief)
      } catch {
        // embedding 失败不影响主流程
      }
      if (briefEmbedding) {
        const embeddingJson = JSON.stringify(briefEmbedding)
        const tmResults = await db.execute(sql`
          SELECT source_text, translated_text,
            1 - (embedding <=> ${embeddingJson}) as similarity
          FROM translation_memory
          WHERE novel_id = ${parentNovelId}
          ORDER BY embedding <=> ${embeddingJson}
          LIMIT 3
        `)
        const tmRows = Array.isArray(tmResults) ? tmResults : []
        if (tmRows.length > 0) {
          const tmContent = tmRows.map((r: Record<string, unknown>) =>
            `原文: ${String(r.source_text).slice(0, 100)}\n译文: ${String(r.translated_text).slice(0, 150)}`
          ).join("\n---\n")

          extendedRagContent = extendedRagContent
            ? extendedRagContent + "\n\n【文风对照样本】以下是原作原文与译文的对应片段，请严格模仿其译文的句式节奏、用词风格和叙事口吻：\n" + tmContent
            : "\n【文风对照样本】以下是原作原文与译文的对应片段，请严格模仿其译文的句式节奏、用词风格和叙事口吻：\n" + tmContent

          for (const r of tmRows) {
            extendedRagCalls.push({
              type: "material",
              content: `原文: ${String(r.source_text).slice(0, 100)}\n译文: ${String(r.translated_text).slice(0, 150)}`,
              score: Number(r.similarity),
              sourceTitle: "翻译记忆",
            })
          }
        }
      }
    } catch { /* 翻译记忆检索可选，失败不影响主流程 */ }
  }

  // 辅助数据
  const lengthDesc: Record<string, string> = {
    short: "一个短场景，约 500-1000 字",
    chapter: "完整一章，约 2000-4000 字",
    arc: "多章故事线大纲，包含 3-5 章的概要",
  }

  const toneMap: Record<string, string> = {
    dark: "黑暗压抑",
    romantic: "浪漫温情",
    action: "紧张激烈",
    slice_of_life: "日常轻松",
    mysterious: "悬疑诡秘",
    epic: "史诗壮阔",
  }

  // 7. 构建禁止角色列表
  let forbiddenList = ""
  if (unselectedChars.length > 0) {
    forbiddenList = `\n【严禁出场的角色】以下角色绝对禁止在本故事中出现，无论以对话、回忆、旁白还是任何其他形式：\n${unselectedChars.map(c => `- ${c.name}`).join("\n")}\n违反此规则将被视为严重错误，必须避免。`
  }

  // ========== 组装 System Prompt（按注意力权重排序：核心任务 → 角色规则 → 世界观 → 其他）==========
  const parts: string[] = [
    `你是一位精通中文创作的小说家。当前创作模式：${MODE_CONFIG[mode].name}。请严格根据以下设定进行创作，输出必须是中文小说正文。`,
    "",
    "========== 核心任务（最高优先级）==========",
    brief.trim(),
    ...(outlineSection ? [
      "",
      "【创作大纲 — 必须严格遵循以下结构】",
      outlineSection,
      "你的创作必须严格按照上述大纲的场景结构展开，每个场景的内容必须与大纲描述一致。",
    ] : []),
    `\n长度要求：${lengthDesc[params.lengthTarget]}`,
    `氛围要求：${toneMap[params.tone] || params.tone}`,
    "",
    "========== 角色规则 ==========",
    MODE_CONFIG[mode].characterInstruction,
  ]

  // 选中角色设定卡
  if (selectedChars.length > 0) {
    parts.push("")
    parts.push("【授权角色 — 仅允许使用以下角色】")
    for (const char of selectedChars) {
      const traits = (char.personalityTraits as string[] || []).join("、") || "无性格标签"
      const taboos = (char.taboos as string[] || []).join("、")
      parts.push(`- ${char.name}: ${traits}${taboos ? ` | 禁忌: ${taboos}` : ""}${char.speechPatterns ? ` | 语言风格: ${char.speechPatterns}` : ""}`)
    }
  }

  // 禁止角色列表
  if (forbiddenList) {
    parts.push(forbiddenList)
  }

  // 7. 桥段（Trope）注入 — 用户选择 + 热key推荐
  const allTropeIds = new Set([
    ...(selectedTropeIds || []),
    ...(hotkeyTropeIds || []),
  ])
  if (allTropeIds.size > 0) {
    const tropes = await db
      .select()
      .from(plotTropes)
      .where(eq(plotTropes.seriesId, seriesId))
    const selectedTropes = tropes.filter(t => selectedTropeIds?.includes(t.id))
    const hotkeyTropes = tropes.filter(t =>
      hotkeyTropeIds?.includes(t.id) && !selectedTropeIds?.includes(t.id)
    )

    if (selectedTropes.length > 0 || hotkeyTropes.length > 0) {
      parts.push("")
      parts.push("【参考桥段 — 可借鉴的情节模式】")

      if (selectedTropes.length > 0) {
        parts.push("以下是你本次明确选择的桥段，供你参考其结构、节奏和情感转折方式：")
        for (const trope of selectedTropes) {
          parts.push(`\n「${trope.name}」`)
          if (trope.description) parts.push(`  描述: ${trope.description}`)
          if (trope.pattern) parts.push(`  流程: ${trope.pattern}`)
          const exs = (trope.examples as string[] || [])
          if (exs.length > 0) {
            parts.push(`  素材佐证:`)
            for (const ex of exs.slice(0, 2)) {
              parts.push(`    - ${ex.slice(0, 120)}${ex.length > 120 ? "..." : ""}`)
            }
          }
        }
      }

      if (hotkeyTropes.length > 0) {
        parts.push("\n以下是你历史创作中高频使用的桥段（热键推荐），建议自然融入创作：")
        for (const trope of hotkeyTropes) {
          parts.push(`\n🔥「${trope.name}」（常用桥段）`)
          if (trope.description) parts.push(`  描述: ${trope.description}`)
          if (trope.pattern) parts.push(`  流程: ${trope.pattern}`)
          const exs = (trope.examples as string[] || [])
          if (exs.length > 0) {
            parts.push(`  素材佐证:`)
            for (const ex of exs.slice(0, 2)) {
              parts.push(`    - ${ex.slice(0, 120)}${ex.length > 120 ? "..." : ""}`)
            }
          }
        }
      }

      parts.push("\n【桥段使用规则】")
      parts.push("1. 借鉴桥段的情节结构和情感节奏，不要照搬具体情节")
      parts.push("2. 桥段中的角色名、地点、对话必须替换为你自己的创作")
      parts.push("3. 多个桥段可以融合使用，创造出新的变体")
      parts.push("4. 热键推荐桥段是你过往创作的习惯模式，可适当融入以增强个人风格")
    }
  }

  // 纯原创强化声明（同世界观原创 + 未选择任何已有角色时）
  if (mode === "original_in_universe" && selectedChars.length === 0) {
    parts.push("")
    parts.push("【纯原创强化声明 — 最高优先级】")
    parts.push("用户明确要求：在同世界观下创作一个完全全新的故事，不使用任何已有角色。")
    parts.push("请严格遵守以下规则（违反任何一条均为严重错误）：")
    parts.push("1. 故事中的所有角色（主角、配角、龙套、NPC）必须是原创的，拥有全新的姓名")
    parts.push("2. 禁止在任何场景中以任何形式提及已有角色的真实姓名——包括对话、回忆、旁白、书信、传说、历史记载")
    parts.push("3. 禁止将已有角色的性格、外貌、能力、口头禅、标志性物品移植到新角色身上")
    parts.push("4. 禁止以'上古大能'、'历史传说'、'前辈高人'等名义间接引用已有角色")
    parts.push("5. 世界观设定（力量体系、地理、文化）可以沿用，但角色和剧情必须是全新的")
    parts.push("6. 如果 Brief 中没有明确点名某个已有角色，则默认该角色不存在于本故事中")
  }

  // 世界观铁律
  parts.push(buildWorldViewSection(worldBible))
  parts.push("")
  parts.push(MODE_CONFIG[mode].worldViewConstraint)

  // 正史
  if (canonEvents.length > 0) {
    parts.push(buildCanonSection(canonEvents, mode))
  }

  // 文风指导
  parts.push("")
  parts.push(buildStyleGuide(params.styleFidelity))

  // RAG 素材
  if (extendedRagContent) {
    parts.push("")
    const useSummary = extendedRagContent.includes("【参考素材摘要】")
    parts.push(useSummary
      ? "【参考素材使用规则】以下是从检索素材中提炼的参考上下文，已去除重复、按主题组织。仅供风格、语气和叙事节奏参考，严禁直接使用其情节或角色："
      : "【参考素材使用规则】以下检索到的素材仅供风格、语气和叙事节奏参考，严禁直接使用其情节或角色："
    )
    parts.push("1. 禁止直接复制素材中的情节、对话或场景")
    parts.push("2. 禁止强行将素材内容插入到你的创作中")
    parts.push("3. 仅借鉴其语言风格、描写方式和节奏感")
    parts.push("4. 你的创作必须与【核心任务】高度相关，不要偏离主题")
    parts.push("")
    parts.push("===== 参考素材开始 =====")
    parts.push(extendedRagContent)
    parts.push("===== 参考素材结束 =====")
  }

  // 用户自定义
  if (userPrompt && userPrompt.trim()) {
    parts.push("")
    parts.push("【用户自定义要求】（以下内容优先级最高，请优先遵守）")
    parts.push(userPrompt.trim())
  }

  // 前文衔接（多章节连续生成时使用）
  if (previousContext) {
    parts.push(
      "【前文衔接】\n" +
      "以下是上一章的结尾部分，请确保本章内容在人物称谓、情节逻辑和语气上与此自然衔接。不要简单重复前文，而是以此为起点推进剧情：\n" +
      previousContext.slice(-800)
    )
  }

  parts.push("")
  parts.push("========== 输出格式要求 ==========")
  parts.push("- 使用标准中文小说排版（段落分明、对话用引号）")
  parts.push("- 不要使用 Markdown 标记")
  parts.push("- 直接输出正文，不要添加额外说明")
  parts.push("- 禁止输出'第X章'等章节标题，直接输出正文内容")
  if (forbiddenList) {
    parts.push("- 绝对禁止【严禁出场的角色】中列出的任何角色以任何形式出现")
  }

  return { prompt: parts.join("\n"), ragCalls, warnings: warnings.length > 0 ? warnings : undefined }
}

// 辅助：查询用户历史高频使用的桥段（热键）
async function getHotkeyTropeIds(seriesId: number, limit = 3): Promise<number[]> {
  const db = getDb()
  const works = await db
    .select()
    .from(fanFictionWorks)
    .where(eq(fanFictionWorks.seriesId, seriesId))
  const tropeCount = new Map<number, number>()
  for (const work of works) {
    const ids = (work.parameters as Record<string, unknown>)?.selectedTropeIds as number[] | undefined
    if (ids) {
      for (const id of ids) {
        tropeCount.set(id, (tropeCount.get(id) || 0) + 1)
      }
    }
  }
  return Array.from(tropeCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

/**
 * 生成后自检 — 检查 OOC、正史矛盾、未授权角色出场
 * 返回违规列表，为空表示通过
 */
async function selfCritique(
  content: string,
  seriesId: number,
  selectedCharacterIds: number[] | undefined
): Promise<{ passed: boolean; issues: string[] }> {
  const db = getDb()

  // 查询角色
  const allChars = await db
    .select()
    .from(characterCards)
    .where(eq(characterCards.seriesId, seriesId))

  const selectedChars = selectedCharacterIds && selectedCharacterIds.length > 0
    ? allChars.filter(c => selectedCharacterIds.includes(c.id))
    : allChars
  const unselectedChars = allChars.filter(c =>
    !selectedCharacterIds || !selectedCharacterIds.includes(c.id)
  )

  // 查询正史
  const canonEvents = await db
    .select()
    .from(seriesCanon)
    .where(eq(seriesCanon.seriesId, seriesId))
    .orderBy(asc(seriesCanon.eventOrder))

  const immutableEvents = canonEvents.filter(e => e.isImmutable)

  // 构建自检 prompt（精简，控制 token）
  const parts: string[] = []

  if (selectedChars.length > 0) {
    parts.push("【授权角色 — 仅允许以下角色出场】")
    for (const char of selectedChars) {
      const traits = (char.personalityTraits as string[] || []).join("、")
      parts.push(`- ${char.name}: ${traits}${char.speechPatterns ? ` | 语言风格: ${char.speechPatterns}` : ""}`)
    }
  }

  if (unselectedChars.length > 0) {
    parts.push("【严禁出场的角色】")
    for (const char of unselectedChars) {
      parts.push(`- ${char.name}`)
    }
  }

  if (immutableEvents.length > 0) {
    parts.push("【不可违背的正史事件】")
    for (const event of immutableEvents) {
      parts.push(`- ${event.description}`)
    }
  }

  parts.push("【待审查内容】")
  parts.push(content.slice(0, 2500)) // 取前 2500 字进行审查
  if (content.length > 2500) parts.push("...（内容截断）")

  const critiquePrompt = `请审查以下创作内容，检查是否有违反设定之处。

${parts.join("\n")}

请检查：
1. 是否有【严禁出场的角色】以任何形式出现（对话、回忆、旁白、背景故事）？
2. 情节是否与【不可违背的正史事件】矛盾？
3. 【授权角色】的语言风格是否与其设定一致？

只输出发现的违规，每条一行。没有违规则只输出一个字：通过。`

  try {
    const response = await chatCompletion({
      messages: [{ role: "user", content: critiquePrompt }],
      temperature: 0.2,
      maxTokens: 600,
    })

    const trimmed = response.trim()
    if (trimmed === "通过" || trimmed.length < 5) {
      return { passed: true, issues: [] }
    }

    const issues = trimmed
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("通过"))

    return { passed: issues.length === 0, issues }
  } catch {
    // 自检失败不影响主流程
    return { passed: true, issues: ["自检服务暂不可用"] }
  }
}

// 辅助：流式生成并收集完整内容
async function generateContent(
  messages: Array<{ role: "system" | "user"; content: string }>,
  temperature: number,
  maxTokens: number
): Promise<string> {
  const stream = streamChat({ messages, temperature, maxTokens })
  let fullContent = ""
  for await (const chunk of stream) {
    fullContent += chunk
  }
  return fullContent
}

export const generateRouter = createRouter({
  fanfiction: publicQuery
    .input(z.object({
      seriesId: z.number(),
      brief: z.string().min(1),
      parameters: generationParamsSchema,
      parentNovelId: z.number().optional(),
      title: z.string().optional(),
      userPrompt: z.string().optional(),
      useMaterials: z.boolean().optional(),
      materialIds: z.array(z.number()).optional(),
      selectedCharacterIds: z.array(z.number()).optional(),
      selectedTropeIds: z.array(z.number()).optional(),
      taskId: z.string().optional(),
      useOutline: z.boolean().optional().default(false),
      workId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const taskId = input.taskId || crypto.randomUUID()
      setProgress(taskId, 1, "正在检索参考素材...")

      try {
        const db = getDb()
        const hotkeyTropeIds = await getHotkeyTropeIds(input.seriesId)

        // 如果用户选择使用大纲，查询并拼接
        let outlineSection = ""
        if (input.useOutline && input.workId) {
          const [workRecord] = await db
            .select()
            .from(fanFictionWorks)
            .where(eq(fanFictionWorks.id, input.workId))
          if (workRecord && workRecord.seriesId !== input.seriesId) {
            throw new Error("作品不属于当前系列")
          }
          if (workRecord?.outline) {
            const parsed = safeParseOutline(workRecord.outline)
            const outline = parsed.outline
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

        const { prompt: systemPrompt, ragCalls, warnings } = await buildSystemPrompt(
          input.seriesId,
          input.brief,
          input.parameters,
          input.parentNovelId,
          input.userPrompt,
          input.useMaterials,
          input.materialIds,
          input.selectedCharacterIds,
          input.selectedTropeIds,
          hotkeyTropeIds,
          outlineSection,  // ← 新增
        )

        setProgress(taskId, 2, "正在组装创作指令...")

        const messages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: input.brief },
        ]

        const maxTokens = input.parameters.lengthTarget === "short"
          ? 1500
          : input.parameters.lengthTarget === "chapter"
          ? 4000
          : 2000

        setProgress(taskId, 3, "AI 正在创作中...")
        const fullContent = await generateContent(
          messages,
          input.parameters.temperature,
          maxTokens
        )

        setProgress(taskId, 4, "正在保存作品...")

        // 若用户未提供标题，自动根据 brief 与生成内容提炼标题

      // 若用户未提供标题，自动根据 brief 与生成内容提炼标题
      let autoTitle: string | undefined
      if (!input.title || input.title.trim() === "") {
        try {
          const titlePrompt = `请根据以下创作 brief 和生成内容的摘要，提炼一个简洁、吸引人的小说标题。

要求：
1. 标题长度不超过 15 个字
2. 只返回标题文本本身，不要有任何解释、前缀、后缀或标点符号包裹
3. 不要返回引号、书名号等任何包裹符号
4. 不要返回"标题：""小说标题："等前缀

创作方向：${input.brief.slice(0, 200)}

内容摘要：${fullContent.slice(0, 500)}`
          autoTitle = await chatCompletion({
            messages: [
              { role: "system", content: "你是一个专业的小说标题生成助手。你的唯一任务是返回一个纯文本标题，不添加任何解释、前缀或包裹符号。" },
              { role: "user", content: titlePrompt },
            ],
            temperature: 0.5,
            maxTokens: 60,
          })
          // 清理：去掉各种引号、书名号和常见前缀后缀
          autoTitle = autoTitle
            .trim()
            .replace(/^(标题[:：]?\s*|小说标题[:：]?\s*|书名[:：]?\s*)/i, "")
            .replace(/[""''""《》「」『』]/g, "")
            .slice(0, 30)
          // 如果清理后为空，则放弃
          if (!autoTitle || autoTitle.trim().length === 0) {
            autoTitle = undefined
          }
        } catch {
          // 标题生成失败不影响主流程
        }
      }

      const finalTitle = input.title?.trim() || autoTitle || `二创_${new Date().toLocaleDateString()}`

      // 保存到数据库（将 selectedCharacterIds 存入 parameters）
      // db 已在 try 块顶部声明

      // 生成后自检（不阻塞保存，失败时记录原因）
      let selfCritiqueResult: { passed: boolean; issues: string[] } = { passed: true, issues: [] }
      try {
        selfCritiqueResult = await selfCritique(
          fullContent,
          input.seriesId,
          input.selectedCharacterIds
        )
      } catch {
        /* 自检失败不影响主流程 */
      }

      const storedParams = {
        ...input.parameters,
        selectedCharacterIds: input.selectedCharacterIds,
        selectedTropeIds: input.selectedTropeIds,
        ragCalls,
        selfCritique: selfCritiqueResult,
      }
      const [work] = await db
        .insert(fanFictionWorks)
        .values({
          seriesId: input.seriesId,
          parentNovelId: input.parentNovelId || null,
          title: finalTitle,
          brief: input.brief,
          parameters: storedParams as unknown as Record<string, unknown>,
          generatedContent: fullContent,
          status: "draft",
        })
        .returning()

      // 异步记录 RAG 调用日志（反馈闭环用），不阻塞返回
      try {
        const feedbackRecords = ragCalls
          .filter(r => r.chunkId != null)
          .map(r => ({
            generationId: work.id,
            chunkId: r.chunkId,
            content: r.content.slice(0, 500),
            similarityScore: r.score ?? null,
          }))
        if (feedbackRecords.length > 0) {
          await db.insert(ragFeedback).values(feedbackRecords)
        }
      } catch {
        // 记录失败不影响主流程
      }

      completeProgress(taskId, { workId: work.id, title: finalTitle })

      return { content: fullContent, workId: work.id, ragCalls, warnings, autoTitle, taskId }
    } catch (err) {
      failProgress(taskId, String(err))
      throw err
    }
    }),

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

        const messages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: input.brief },
        ]

        setProgress(taskId, 3, "AI 正在生成大纲...")
        const rawOutline = await generateContent(messages, input.parameters.temperature, 2000)

        setProgress(taskId, 4, "正在解析大纲...")
        const parsedOutline = await parseOutline(rawOutline, input.outlineType)

        setProgress(taskId, 5, "正在保存...")

        const db = getDb()
        const [work] = await db
          .insert(fanFictionWorks)
          .values({
            seriesId: input.seriesId,
            parentNovelId: input.parentNovelId || null,
            title: `大纲_${new Date().toISOString().slice(0, 10)}`,
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

        completeProgress(taskId, { workId: work.id, title: work.title || "" }, 5)

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

  progress: publicQuery
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => {
      const p = generationProgress.get(input.taskId)
      if (!p) return { step: 0, message: "等待开始...", completed: false } as const
      return { step: p.step, message: p.message, completed: p.completed, result: p.result, error: p.error } as const
    }),

  continue: publicQuery
    .input(z.object({
      workId: z.number(),
      brief: z.string().optional(),
      userPrompt: z.string().optional(),
      useMaterials: z.boolean().optional(),
      materialIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId))

      if (!work) {
        throw new Error("作品不存在")
      }

      const storedParams = (work.parameters || {}) as Record<string, unknown>
      const hotkeyTropeIds = await getHotkeyTropeIds(work.seriesId!)

      // 多轮上下文感知：用已生成内容的最后 500 字叠加 brief 做检索 query
      const generatedContent = work.generatedContent || ""
      const contextSuffix = generatedContent.length > 500
        ? `\n\n前文摘要：${generatedContent.slice(-500)}`
        : generatedContent.length > 0
        ? `\n\n前文摘要：${generatedContent}`
        : ""
      const contextQuery = (input.brief || "请继续以下内容") + contextSuffix

      // 续写时保留大纲约束
      let outlineSection = ""
      if (work.outline) {
        const parsed = safeParseOutline(work.outline)
        const outline = parsed.outline
        const parts: string[] = []
        if (outline.overview) parts.push("【故事概述】" + outline.overview)
        if (outline.scenes?.length) {
          parts.push("【场景规划】")
          for (const scene of outline.scenes) parts.push(`- ${scene.title}: ${scene.description}`)
        }
        outlineSection = parts.join("\n")
      }

      const { prompt: systemPrompt, ragCalls, warnings } = await buildSystemPrompt(
        work.seriesId!,
        contextQuery,
        (storedParams as Partial<GenParams>) || {},
        work.parentNovelId || undefined,
        input.userPrompt,
        input.useMaterials,
        undefined,
        storedParams.selectedCharacterIds as number[] | undefined,
        storedParams.selectedTropeIds as number[] | undefined,
        hotkeyTropeIds,
        outlineSection
      )

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `请续写以下内容，保持上下文连贯：\n\n${work.generatedContent}\n\n${input.brief || "继续："}` },
      ]

      const newContent = await generateContent(
        messages,
        ((work.parameters as Record<string, unknown>)?.temperature as number || 0.8) * 0.9,
        4000
      )

      const fullContent = (work.generatedContent || "") + "\n\n" + newContent
      await db
        .update(fanFictionWorks)
        .set({ generatedContent: fullContent })
        .where(eq(fanFictionWorks.id, input.workId))

      return { content: newContent, fullContent, workId: work.id, ragCalls, warnings }
    }),

  regenerate: publicQuery
    .input(z.object({
      workId: z.number(),
      originalText: z.string(),
      modifiedBrief: z.string(),
      userPrompt: z.string().optional(),
      useMaterials: z.boolean().optional(),
      materialIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId))

      if (!work) {
        throw new Error("作品不存在")
      }

      const regenParams = (work.parameters || {}) as Record<string, unknown>
      const hotkeyTropeIds = await getHotkeyTropeIds(work.seriesId!)

      // 重写时保留大纲约束
      let outlineSection = ""
      if (work.outline) {
        const parsed = safeParseOutline(work.outline)
        const outline = parsed.outline
        const parts: string[] = []
        if (outline.overview) parts.push("【故事概述】" + outline.overview)
        if (outline.scenes?.length) {
          parts.push("【场景规划】")
          for (const scene of outline.scenes) parts.push(`- ${scene.title}: ${scene.description}`)
        }
        outlineSection = parts.join("\n")
      }

      const { prompt: systemPrompt, ragCalls, warnings } = await buildSystemPrompt(
        work.seriesId!,
        input.modifiedBrief,
        (regenParams as Partial<GenParams>) || {},
        work.parentNovelId || undefined,
        input.userPrompt,
        input.useMaterials,
        undefined,
        regenParams.selectedCharacterIds as number[] | undefined,
        regenParams.selectedTropeIds as number[] | undefined,
        hotkeyTropeIds,
        outlineSection
      )

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `请重写以下段落，要求：${input.modifiedBrief}\n\n原文：\n${input.originalText}\n\n重写：` },
      ]

      const regenerated = await generateContent(
        messages,
        ((work.parameters as Record<string, unknown>)?.temperature as number || 0.8) * 1.1,
        2000
      )

      const newContent = (work.generatedContent || "").replace(input.originalText, regenerated)
      await db
        .update(fanFictionWorks)
        .set({ generatedContent: newContent })
        .where(eq(fanFictionWorks.id, input.workId))

      return { regenerated, fullContent: newContent, workId: work.id, ragCalls, warnings }
    }),

  getWork: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.id))
      return work || null
    }),

  batch: publicQuery
    .input(batchGenerationSchema)
    .mutation(async ({ input }) => {
      const db = getDb()

      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId))
      if (!work) throw new Error("作品不存在")
      if (!work.seriesId) throw new Error("作品未关联系列")

      // Check for existing running batch
      const existingJobs = await db
        .select()
        .from(generationJobs)
        .where(sql`${generationJobs.metadata}->>'workId' = ${String(input.workId)} AND ${generationJobs.status} = ${"running"}`)
      if (existingJobs.length > 0) {
        throw new Error(`已有进行中的批量生成任务（jobId: ${existingJobs[0].id}）`)
      }

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

      const runBatch = async () => {
        try {
          const workParams = (work.parameters ?? {}) as Partial<GenParams>
          const mergedParams = { ...workParams, ...input.params }
          const outline = work.outline ? safeParseOutline(work.outline).outline : undefined
          const outlineSection = outline ? buildOutlineSection(outline) : undefined

          for (let i = 0; i < input.chapterConfigs.length; i++) {
            const config = input.chapterConfigs[i]
            const previousContext = await getPreviousContext(input.workId, config.chapterNumber)

            // Skip already-generated chapters (resume support)
            const [existing] = await db
              .select()
              .from(fanFictionChapters)
              .where(sql`${fanFictionChapters.workId} = ${input.workId} AND ${fanFictionChapters.chapterNumber} = ${config.chapterNumber}`)

            if (existing?.status === "generated") continue

            const { content } = await generateSingleChapter(
              input.workId, work.seriesId!, config.chapterNumber,
              config.title, config.brief, mergedParams,
              { parentNovelId: work.parentNovelId ?? undefined, outlineSection, previousContext }
            )

            if (existing) {
              await db.update(fanFictionChapters)
                .set({ content, status: "generated", updatedAt: new Date() })
                .where(eq(fanFictionChapters.id, existing.id))
            } else {
              await db.insert(fanFictionChapters).values({
                workId: input.workId, chapterNumber: config.chapterNumber,
                title: config.title, content, brief: config.brief,
                parameters: mergedParams, status: "generated",
              })
            }

            await db.update(generationJobs)
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

          await db.update(generationJobs)
            .set({ status: "completed", progress: 100 })
            .where(eq(generationJobs.id, job.id))

          await db.update(fanFictionWorks)
            .set({ status: "completed" })
            .where(eq(fanFictionWorks.id, input.workId))
        } catch (err) {
          await db.update(generationJobs)
            .set({ status: "failed", errorLog: String(err) })
            .where(eq(generationJobs.id, job.id))
        }
      }

      setImmediate(() => { runBatch().catch(console.error) })

      return { jobId: job.id }
    }),

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

      return {
        jobId: job.id, status: job.status, progress: job.progress, errorLog: job.errorLog,
        currentChapter: (job.metadata as Record<string, unknown>)?.currentChapter as number | undefined,
        totalChapters: (job.metadata as Record<string, unknown>)?.totalChapters as number | undefined,
        completedChapters,
      }
    }),

  batchRetry: publicQuery
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, input.jobId))
      if (!job) throw new Error("任务不存在")
      await db.delete(generationJobs).where(eq(generationJobs.id, input.jobId))
      return { message: "已重置，请重新调用 batch" }
    }),

  export: publicQuery
    .input(exportWorkSchema)
    .mutation(async ({ input }) => {
      const db = getDb()
      const [work] = await db.select().from(fanFictionWorks).where(eq(fanFictionWorks.id, input.workId))
      if (!work) throw new Error("作品不存在")

      const chapterRows = await db
        .select()
        .from(fanFictionChapters)
        .where(eq(fanFictionChapters.workId, input.workId))
        .orderBy(asc(fanFictionChapters.chapterNumber))

      if (chapterRows.length === 0 && work.generatedContent) {
        return { content: work.generatedContent, filename: `${work.title || "export"}.${input.format}`, chapterCount: 1 }
      }
      if (chapterRows.length === 0) throw new Error("作品内容为空，无内容可导出")

      let content = ""
      if (input.format === "txt") {
        content = `《${work.title || "未命名作品"}》\n\n简介：${work.brief || "无"}\n\n===\n\n`
        for (const ch of chapterRows) {
          content += `第${ch.chapterNumber}章 ${ch.title || ""}\n\n${ch.content}\n\n`
        }
      } else {
        content = `# ${work.title || "未命名作品"}\n\n> ${work.brief || ""}\n\n---\n\n`
        for (const ch of chapterRows) {
          content += `## 第${ch.chapterNumber}章 ${ch.title || ""}\n\n${ch.content}\n\n`
        }
      }

      return { content, filename: `${work.title || "export"}.${input.format}`, chapterCount: chapterRows.length }
    }),

  listChapters: publicQuery
    .input(z.object({ workId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      return db.select().from(fanFictionChapters).where(eq(fanFictionChapters.workId, input.workId)).orderBy(asc(fanFictionChapters.chapterNumber))
    }),

  updateWork: publicQuery
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      generatedContent: z.string().optional(),
      status: z.string().optional(),
      outline: z.object({
        overview: z.string().optional(),
        scenes: z.array(z.object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
        })).optional(),
        generatedAt: z.string().optional(),
        outlineType: z.enum(["overview", "scenes", "both"]).optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const { id, ...data } = input
      const [work] = await db
        .update(fanFictionWorks)
        .set(data)
        .where(eq(fanFictionWorks.id, id))
        .returning()
      return work
    }),

  deleteWork: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()

      // 记录删除前的快照
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.id))

      if (work) {
        const { logAudit } = await import("../routers/audit")
        await logAudit({
          action: "fanfiction_delete",
          entityType: "fanfiction",
          entityId: input.id,
          snapshot: work as unknown as Record<string, unknown>,
          description: `删除二创作品《${work.title}》`,
        })
      }

      await db
        .delete(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.id))
      return { success: true }
    }),

  list: publicQuery
    .input(z.object({
      seriesId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb()
      if (input?.seriesId) {
        return db
          .select()
          .from(fanFictionWorks)
          .where(eq(fanFictionWorks.seriesId, input.seriesId))
          .orderBy(fanFictionWorks.createdAt)
      }
      return db.select().from(fanFictionWorks).orderBy(fanFictionWorks.createdAt)
    }),

  search: publicQuery
    .input(z.object({
      query: z.string().optional(),
      seriesId: z.number().optional(),
      days: z.number().optional(),
      sortBy: z.enum(["createdAt", "updatedAt", "title"]).default("createdAt"),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const db = getDb()

      let whereClause: ReturnType<typeof sql> | undefined = undefined

      if (input.query?.trim()) {
        const q = `%${input.query.trim()}%`
        whereClause = sql`${fanFictionWorks.title} LIKE ${q} OR ${fanFictionWorks.brief} LIKE ${q}`
      }
      if (input.seriesId) {
        const c = sql`${fanFictionWorks.seriesId} = ${input.seriesId}`
        whereClause = whereClause ? sql`${whereClause} AND ${c}` : c
      }
      if (input.days) {
        const cutoff = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)
        const c = sql`${fanFictionWorks.createdAt} >= ${cutoff}`
        whereClause = whereClause ? sql`${whereClause} AND ${c}` : c
      }

      const orderBy =
        input.sortBy === "title"
          ? asc(fanFictionWorks.title)
          : input.sortBy === "updatedAt"
          ? desc(fanFictionWorks.updatedAt)
          : desc(fanFictionWorks.createdAt)

      return db
        .select()
        .from(fanFictionWorks)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(input.limit)
    }),

  // 将二创作品保存为小说
  saveAsNovel: publicQuery
    .input(z.object({ workId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId))

      if (!work) throw new Error("作品不存在")
      if (!work.generatedContent) throw new Error("作品内容为空")

      // 创建小说记录
      const [novel] = await db
        .insert(novels)
        .values({
          title: work.title || `二创_${new Date().toLocaleDateString()}`,
          author: "AI 生成",
          status: "completed",
          metadata: {
            source: "fan_fiction",
            workId: work.id,
            brief: work.brief,
            seriesId: work.seriesId,
          },
        })
        .returning()

      // 创建章节（单章，内容为全部生成内容）
      await db.insert(chapters).values({
        novelId: novel.id,
        chapterNumber: 1,
        title: work.title || "第1章",
        contentOriginal: work.generatedContent,
      })

      // 更新二创作品状态
      await db
        .update(fanFictionWorks)
        .set({ status: "saved" })
        .where(eq(fanFictionWorks.id, input.workId))

      return { novelId: novel.id }
    }),
})
