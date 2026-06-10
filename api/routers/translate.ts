/**
 * Translation Router
 * Phase 1: Basic translation with fuzzy TM and hybrid RAG
 * Note: Streaming via mutation is not supported in tRPC v11 HTTP.
 * We return progress in a single response after completion.
 */

import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { chapters, novels, characterCards, worldBibles, series } from "@db/schema"
import { eq, asc, sql } from "drizzle-orm"
import { streamChat, getEmbedding } from "../services/deepseek"
import { buildStyleFingerprintInstruction, type StyleFingerprint } from "../services/style-analyzer"
import { chatCompletion } from "../services/deepseek"

// HyDE 缓存：segment 内容 hash → 假设文档 embedding
const hydeCache = new Map<string, number[]>()

function sha256(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return String(hash)
}

/**
 * HyDE（Hypothetical Document Embedding）：
 * 生成假设参考文档片段，用于提升跨语言 RAG 召回率
 */
async function generateHydeEmbedding(
  segment: string,
  style: string
): Promise<number[] | undefined> {
  const preview = segment.slice(0, 300)
  const cacheKey = sha256(preview + "|" + style)

  // 1. 查缓存
  const cached = hydeCache.get(cacheKey)
  if (cached) return cached

  try {
    // 2. 用 LLM 生成假设文档
    const hypotheticalDoc = await chatCompletion({
      messages: [{
        role: "user",
        content: `以下是一段小说原文，请用中文写一段"可能出现在参考素材中的相关内容"。
不要翻译原文，而是想象：如果有一个素材库收录了与这段内容相关的背景资料、场景描写或风格参考，它会怎么写？

原文片段：
${preview}

要求：${style === "literary" ? "文学性描写" : "简洁的参考描述"}，80-150字。只输出假设参考内容，不要解释。`,
      }],
      temperature: 0.5,
      maxTokens: 200,
    })

    // 3. 生成 embedding
    const embedding = await getEmbedding(hypotheticalDoc.content.trim())

    // 4. 写入缓存
    hydeCache.set(cacheKey, embedding)
    return embedding
  } catch {
    return undefined
  }
}

// 角色出场检测：根据 segment 内容匹配角色名
function detectCharactersInSegment(
  segment: string,
  characters: Array<{ name: string; originalName?: string | null }>
): Array<{ name: string; originalName?: string | null }> {
  return characters.filter(char =>
    segment.includes(char.name) ||
    (char.originalName && segment.includes(char.originalName))
  )
}

/**
 * 从章节文本和角色列表中提取实体关键词（角色名 + 别名）
 * 用于 pg_trgm 模糊搜索，补充向量检索的盲区
 */
function extractEntityKeywordsFromText(
  text: string,
  characters: typeof characterCards.$inferSelect[]
): string[] {
  const keywords: string[] = []
  for (const char of characters) {
    if (text.includes(char.name)) {
      keywords.push(char.name)
      const aliases = (char.aliases as string[] || []).filter(Boolean)
      for (const alias of aliases) {
        if (text.includes(alias)) keywords.push(alias)
      }
    }
  }
  // 去重并限制数量
  return [...new Set(keywords)].slice(0, 8)
}

// 动态 Lore 组装：只注入与当前 segment 相关的角色和世界观维度
async function buildDynamicLoreSection(
  seriesId: number,
  allChars: typeof characterCards.$inferSelect[],
  worldBible: typeof worldBibles.$inferSelect | undefined,
  relevantChars: Array<{ name: string; originalName?: string | null }>,
  segment: string
): Promise<string> {
  const db = getDb()
  const parts: string[] = []

  // 1. 世界观 — 维度匹配（只注入相关维度）
  if (worldBible) {
    const aspects = (worldBible.aspects || []) as Array<{ name: string; content: string }>
    const relevantAspects = aspects
      .filter((a: { name: string; content: string }) => segment.includes(a.name) || segment.includes(a.content.slice(0, 30)))
    if (relevantAspects.length > 0) {
      parts.push("【相关世界观设定】")
      for (const aspect of relevantAspects) {
        parts.push(`「${aspect.name}」${aspect.content}`)
      }
    }
    // 维度关键词匹配
    if (worldBible.magicSystem && /[魔斗气灵力法术技能修炼]/u.test(segment)) {
      parts.push(`力量体系: ${worldBible.magicSystem}`)
    }
    if (worldBible.geography && /[城国山河流地图方位]/u.test(segment)) {
      parts.push(`地理政治: ${worldBible.geography}`)
    }
    if (worldBible.technologyLevel && /[科技机械枪炮飞船]/u.test(segment)) {
      parts.push(`技术水平: ${worldBible.technologyLevel}`)
    }
  }

  // 2. 角色设定 — 只注入出场角色
  if (relevantChars.length > 0) {
    const charDetails = allChars.filter(c => relevantChars.some(rc => rc.name === c.name))
    if (charDetails.length > 0) {
      if (parts.length > 0) parts.push("")
      parts.push("【出场角色设定】")
      for (const char of charDetails.slice(0, 5)) {
        const traits = (char.personalityTraits as string[] || []).join("、") || "无性格标签"
        parts.push(`- ${char.name}: ${traits}${char.speechPatterns ? ` | 语言风格: ${char.speechPatterns}` : ""}`)
      }
    }
  }

  // 3. 术语表（保持现有逻辑，全局注入）
  try {
    const tmTerms = await db.execute(sql`
      SELECT source_text, translated_text, frequency
      FROM translation_memory
      WHERE series_id = ${seriesId}
      ORDER BY frequency DESC
      LIMIT 10
    `)
    const terms = Array.isArray(tmTerms) ? tmTerms : []
    if (terms.length > 0) {
      if (parts.length > 0) parts.push("")
      parts.push("【术语表】以下术语必须按此表翻译，严禁自创译名：")
      for (const t of terms) {
        parts.push(`- ${String(t.source_text)} → ${String(t.translated_text)}`)
      }
    }
  } catch { /* 术语表可选 */ }

  return parts.join("\n")
}

// 翻译用 chunk 分割：1500 字符/块，优先段落边界，无重叠
// 注意：上下文通过 buildContextBridge 注入 prompt，segment 内容本身不重叠，
// 避免同一文本被翻译两次导致重复段落。
function splitTranslationSegments(text: string): string[] {
  const maxLen = 1500

  const paragraphs = text.split("\n").filter(p => p.trim().length > 0)
  const segments: string[] = []
  let current = ""

  for (const para of paragraphs) {
    // 单段超长：直接作为独立 segment，不做中段切割（由 LLM 自行处理）
    if (current.length + para.length > maxLen && current.length > 0) {
      segments.push(current)
      current = para
    } else {
      current += (current ? "\n" : "") + para
    }
  }
  if (current) segments.push(current)
  return segments
}

/** 整章预取 RAG 上下文（只做一次查询，所有 segment 共用） */
async function getChapterRagContext(
  novelId: number,
  seriesId: number | null,
  chapterEmbedding: number[] | undefined,
  chapterContent: string,
  allChars: typeof characterCards.$inferSelect[],
  style: string = "fluent",
  topK: number = 3,
  limit: number = 2,
  hydeEmbedding?: number[]
): Promise<{
  fuzzyMatches: Array<{ sourceText: string; translatedText: string; similarity: number }>
  ragRef: Array<{ content: string; sourceType: string; score: number }>
}> {
  const db = getDb()

  // 0. 提取本章出现的实体关键词，用于 pg_trgm 补充召回
  const entityKeywords = allChars.length > 0
    ? extractEntityKeywordsFromText(chapterContent, allChars)
    : []

  // 1. Translation Memory（用预计算 embedding）
  let fuzzyMatches: Array<{ sourceText: string; translatedText: string; similarity: number }> = []
  try {
    if (chapterEmbedding) {
      const embeddingJson = JSON.stringify(chapterEmbedding)
      const results = await db.execute(sql`
        SELECT source_text, translated_text, 1 - (embedding <=> ${embeddingJson}) as similarity, frequency
        FROM translation_memory
        WHERE embedding IS NOT NULL
          AND (
            (${seriesId}::int IS NOT NULL AND series_id = ${seriesId})
            OR novel_id = ${novelId}
          )
          AND (style_tag = ${style} OR style_tag IS NULL)
        ORDER BY embedding <=> ${embeddingJson}
        LIMIT ${topK}
      `)
      const rows = Array.isArray(results) ? results : []
      const deduped = new Map<string, { sourceText: string; translatedText: string; similarity: number; frequency: number }>()
      for (const row of rows) {
        const key = String(row.source_text)
        const freq = Number((row as Record<string, unknown>).frequency || 0)
        const existing = deduped.get(key)
        if (!existing || freq > existing.frequency) {
          deduped.set(key, {
            sourceText: key,
            translatedText: String(row.translated_text),
            similarity: Number(row.similarity),
            frequency: freq,
          })
        }
      }
      fuzzyMatches = Array.from(deduped.values()).map(({ sourceText, translatedText, similarity }) => ({
        sourceText,
        translatedText,
        similarity,
      }))
    }
  } catch { /* ignore */ }

  // 2. Vector Search（用预计算 embedding + 可选 HyDE embedding）
  let ragRef: Array<{ content: string; sourceType: string; score: number }> = []
  try {
    const embeddingsToSearch: number[][] = []
    if (chapterEmbedding) embeddingsToSearch.push(chapterEmbedding)
    if (hydeEmbedding) embeddingsToSearch.push(hydeEmbedding)

    for (const embedding of embeddingsToSearch) {
      const embeddingJson = JSON.stringify(embedding)
      const vec = await db.execute(sql`
        SELECT content, source_type, metadata, 1 - (embedding <=> ${embeddingJson}) as score
        FROM vector_chunks
        WHERE (
          (${seriesId}::int IS NOT NULL AND series_id = ${seriesId})
          OR novel_id = ${novelId}
        )
        ORDER BY embedding <=> ${embeddingJson}
        LIMIT ${limit * 2}
      `)
      const rows = Array.isArray(vec) ? vec : []
      for (const row of rows) {
        const metadata = (row.metadata as Record<string, unknown>) || {}
        const content = String(row.content)
        const contextBefore = metadata.contextBefore ? String(metadata.contextBefore) : undefined
        const contextAfter = metadata.contextAfter ? String(metadata.contextAfter) : undefined

        // 拼接上下文形成富化内容
        const enrichedParts: string[] = []
        if (contextBefore) enrichedParts.push(`【上文】${contextBefore}`)
        enrichedParts.push(content)
        if (contextAfter) enrichedParts.push(`【下文】${contextAfter}`)

        // 去重：检查是否已存在相同内容前 80 字符
        const enrichedContent = enrichedParts.join("\n")
        const isDuplicate = ragRef.some(r => r.content.slice(0, 80) === enrichedContent.slice(0, 80))
        if (!isDuplicate) {
          ragRef.push({
            content: enrichedContent,
            sourceType: String(row.source_type),
            score: Number(row.score),
          })
        }
      }
    }
  } catch { /* ignore */ }

  // 3. 实体感知 pg_trgm 模糊搜索补充召回
  // 利用角色别名等实体关键词，召回向量检索可能遗漏的内容
  try {
    if (entityKeywords.length > 0) {
      const entityQuery = entityKeywords.join(" ")
      const trgmResults = await db.execute(sql`
        SELECT content, source_type, similarity(content, ${entityQuery}) as score
        FROM vector_chunks
        WHERE (
          (${seriesId}::int IS NOT NULL AND series_id = ${seriesId})
          OR novel_id = ${novelId}
        )
          AND content % ${entityQuery}
        ORDER BY score DESC
        LIMIT ${Math.min(limit, 3)}
      `)
      const trgmRows = Array.isArray(trgmResults) ? trgmResults : []
      for (const row of trgmRows) {
        const content = String(row.content)
        // 去重：如果该 content 的前 80 字符已在 ragRef 中，则跳过
        const isDuplicate = ragRef.some(r => r.content.slice(0, 80) === content.slice(0, 80))
        if (!isDuplicate) {
          ragRef.push({
            content,
            sourceType: String(row.source_type),
            score: Number(row.score),
          })
        }
      }
    }
  } catch { /* trgm 可选，失败不影响 */ }

  return { fuzzyMatches, ragRef }
}

// 翻译提示词模板
function buildTranslationPrompt(
  sourceText: string,
  style: string,
  fuzzyMatches: Array<{ sourceText: string; translatedText: string; similarity: number }>,
  ragReference: Array<{ content: string; score: number }>,
  loreSection: string,
  userPrompt?: string,
  styleFingerprint?: StyleFingerprint | null,
  dialogueStyleSection?: string
): string {
  const fewShotStr = fuzzyMatches.length > 0
    ? "\n【翻译参考（风格/术语一致性参考）】\n" +
      fuzzyMatches.slice(0, 3).map(m =>
        `原文：${m.sourceText}\n译文：${m.translatedText}`
      ).join("\n---\n")
    : ""

  const ragStr = ragReference.length > 0
    ? "\n【上下文参考】\n" + ragReference.map(r => r.content).join("\n---\n").slice(0, 1200)
    : ""

  const loreStr = loreSection ? "\n【世界观与角色设定】\n" + loreSection + "\n" : ""

  const styleInstruction: Record<string, string> = {
    literal: "直译为主，保留原文结构和语序",
    fluent: "意译为主，让译文自然流畅，符合中文表达习惯",
    literary: "文学性翻译，注重文采和意境，适合小说",
  }

  const fpStr = styleFingerprint
    ? "\n" + buildStyleFingerprintInstruction(styleFingerprint) + "\n"
    : ""

  const dialogueStr = dialogueStyleSection
    ? "\n" + dialogueStyleSection + "\n"
    : ""

  const userStr = userPrompt
    ? `\n【用户自定义要求】(请优先遵守以下要求)\n${userPrompt}\n`
    : ""

  const banStr = `
【绝对禁止】
1. 不要输出任何解释、前言、后记、总结
2. 不要输出"以下是翻译""译文如下""这是您需要的中文翻译"等元话语
3. 不要输出"译文：""翻译结果："等标题
4. 每一段直接输出纯中文译文，不要分段标题或编号
5. 如果某段内容很少（如过渡句），也请直接翻译，不要跳过
`

  return `请将以下外文小说段落翻译成中文。

要求：${styleInstruction[style] || styleInstruction.fluent}${fpStr}${loreStr}${dialogueStr}${fewShotStr}${ragStr}${userStr}${banStr}
原文：
${sourceText}

译文：`
}

// 上下文桥梁：让 AI 知道当前 segment 在全文中的位置，减少元话语和前后不一致
function buildContextBridge(
  segmentIndex: number,
  totalSegments: number,
  prevSegmentTail: string,
  nextSegmentHead: string
): string {
  if (totalSegments <= 1) return ""
  const parts: string[] = []
  parts.push(`【片段上下文】这是全文的第 ${segmentIndex + 1}/${totalSegments} 个翻译片段。`)
  if (segmentIndex > 0 && prevSegmentTail) {
    parts.push(`前一个片段的结尾：「${prevSegmentTail.slice(-100)}」`)
  }
  if (segmentIndex < totalSegments - 1 && nextSegmentHead) {
    parts.push(`后一个片段的开头：「${nextSegmentHead.slice(0, 100)}」`)
  }
  parts.push("请确保译文在人物称谓、情节逻辑和语气上与前后片段自然衔接。")
  return parts.join("\n")
}

// 后处理清洗：去除 AI 常见的元话语污染
const META_PATTERNS = [
  /^(这是[您你]?需要?的?中文翻译[：:]?\s*)/i,
  /^(以下[是为]?[您你]?的?翻译[：:]?\s*)/i,
  /^(译文[：:]?\s*)/i,
  /^(翻译[结果]*[：:]?\s*)/i,
  /^(中文翻译[：:]?\s*)/i,
  /(\s*总结[：:]?\s*)$/i,
  /(\s*以上[是为]?翻译[：:]?\s*)$/i,
]

function sanitizeTranslation(text: string): string {
  let result = text.trim()
  for (const pattern of META_PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result.trim()
}

/**
 * LLM-based RAG 重排序：对候选 chunks 按与翻译任务的相关性打分
 * 限制候选数 ≤ 8，控制 API 成本
 */
async function rerankRagResults(
  segment: string,
  candidates: Array<{ content: string; sourceType: string; score: number }>,
  topN: number = 5
): Promise<Array<{ content: string; sourceType: string; score: number }>> {
  if (candidates.length <= topN) return candidates

  const limited = candidates.slice(0, 8)

  const prompt = `以下是一段小说原文片段，以及 ${limited.length} 条参考素材。
请评估每条素材对翻译这段原文的帮助程度（1-10分），只考虑术语一致性、风格参考、背景知识补充价值。

原文：${segment.slice(0, 300)}

素材：
${limited.map((c, i) => `[${i}] ${c.content.slice(0, 200)}`).join("\n\n")}

请返回 JSON 数组：[[0, 8], [1, 3], ...] 表示 [素材编号, 分数]。只输出 JSON，不要解释。`

  try {
    const result = await chatCompletion({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      maxTokens: 200,
    })

    let scores: number[] = []
    try {
      const parsed = JSON.parse(result.content.trim()) as number[][]
      scores = limited.map((_, i) => {
        const entry = parsed.find((p: number[]) => p[0] === i)
        return entry ? entry[1] : 5
      })
    } catch {
      scores = limited.map(() => 5)
    }

    return limited
      .map((c, i) => ({ ...c, llmScore: scores[i] || 5 }))
      .sort((a, b) => (b.llmScore || 0) - (a.llmScore || 0))
      .slice(0, topN)
      .map(({ content, sourceType, score }) => ({ content, sourceType, score }))
  } catch {
    return candidates.slice(0, topN)
  }
}

/**
 * 检测 segment 中的对话及说话者
 * 匹配格式：XXX说：「...」、 「...」XXX道、 XXX："..." 等
 */
function detectSpeakersInSegment(
  segment: string,
  allChars: typeof characterCards.$inferSelect[]
): Array<{ name: string; speechPatterns?: string | null }> {
  const speakers = new Map<string, { name: string; speechPatterns?: string | null }>()

  // Pattern 1: 叙述者 + 说/道/喊/问/答/叫/嚷/吼 + 标点 + 引号内容
  // 如：萧炎沉声道：「...」、 他大声喊道："..."
  const pattern1 = /([^\n""「」'']{1,20})(?:沉声|低声|大声|冷冷|淡淡|轻声|怒声)?(?:说|道|喊|问|答|叫|嚷|吼|叱|喝|骂)[：:，,]\s*[""「『]([^""」』"]+)[""」』"]/g
  let match: RegExpExecArray | null
  while ((match = pattern1.exec(segment)) !== null) {
    const speakerHint = match[1].trim()
    const char = allChars.find(c =>
      speakerHint.includes(c.name) ||
      (c.aliases as string[] || []).some(a => speakerHint.includes(a))
    )
    if (char && !speakers.has(char.name)) {
      speakers.set(char.name, { name: char.name, speechPatterns: char.speechPatterns })
    }
  }

  // Pattern 2: 引号内容 + 叙述者 + 说/道（后置）
  // 如：「...」萧炎点了点头，道。
  const pattern2 = /[""「『]([^""」』"]+)[""」』"]\s*([^\n""「」'']{1,20})(?:沉声|低声|大声|冷冷|淡淡|轻声|怒声)?(?:说|道|喊|问|答|叫|嚷|吼|叱|喝|骂)/g
  while ((match = pattern2.exec(segment)) !== null) {
    const speakerHint = match[2].trim()
    const char = allChars.find(c =>
      speakerHint.includes(c.name) ||
      (c.aliases as string[] || []).some(a => speakerHint.includes(a))
    )
    if (char && !speakers.has(char.name)) {
      speakers.set(char.name, { name: char.name, speechPatterns: char.speechPatterns })
    }
  }

  // Pattern 3: 直接以角色名开头，后接引号（省略了"说/道"）
  // 如：萧炎「...」
  const pattern3 = /^([一-龥]{2,8})\s*[""「『]([^""」』"]+)[""」』"]/gm
  while ((match = pattern3.exec(segment)) !== null) {
    const speakerHint = match[1].trim()
    const char = allChars.find(c => c.name === speakerHint)
    if (char && !speakers.has(char.name)) {
      speakers.set(char.name, { name: char.name, speechPatterns: char.speechPatterns })
    }
  }

  return Array.from(speakers.values())
}

/**
 * 构建角色对话风格指令
 */
function buildDialogueStyleSection(
  speakers: Array<{ name: string; speechPatterns?: string | null }>
): string {
  if (speakers.length === 0) return ""
  const parts: string[] = ["【角色对话风格要求】"]
  for (const s of speakers) {
    if (s.speechPatterns) {
      parts.push(`- ${s.name}：${s.speechPatterns}`)
    } else {
      parts.push(`- ${s.name}：保持语气与性格一致`)
    }
  }
  return parts.join("\n")
}

// 将文本分割为段落数组
function splitTextIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

// 调用翻译流（内部辅助）
async function callTranslationStream(prompt: string, temperature: number): Promise<string> {
  const stream = streamChat({
    messages: [{ role: "user", content: prompt }],
    temperature,
    maxTokens: 4000,
  })
  let text = ""
  for await (const chunk of stream) {
    text += chunk
  }
  return text
}

// 段级翻译 + 自动重试（失败1次，等待1秒+升温）
async function translateSegmentWithRetry(
  prompt: string
): Promise<{ text: string; error?: string }> {
  try {
    const text = await callTranslationStream(prompt, 0.3)
    return { text }
  } catch {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const text = await callTranslationStream(prompt, 0.5)
      return { text }
    } catch (retryErr) {
      return { text: "", error: String(retryErr) }
    }
  }
}

export const translateRouter = createRouter({
  start: publicQuery
    .input(z.object({
      novelId: z.number(),
      style: z.enum(["literal", "fluent", "literary"]).default("fluent"),
      userPrompt: z.string().optional(),
      ragTopK: z.number().min(1).max(10).optional(),
      ragLimit: z.number().min(1).max(10).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      // 获取小说信息（用于 seriesId）
      const [novel] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.novelId))

      const seriesId = novel?.seriesId || null

      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))
        .orderBy(asc(chapters.chapterNumber))

      let completed = 0
      const total = chapterList.length
      const results: Array<{
        chapterId: number
        chapterNumber: number
        status: string
        failedSegments?: Array<{ segmentIndex: number; error: string }>
      }> = []

      // 收集 RAG 调用信息（去重展示）
      const ragCalls: Array<{
        type: "translation_memory" | "vector_search" | "full_text"
        content: string
        score?: number
        sourceType?: string
      }> = []
      const ragKeys = new Set<string>()

      function addRagCall(item: typeof ragCalls[number]) {
        const key = item.type + "|" + item.content.slice(0, 80)
        if (!ragKeys.has(key)) {
          ragKeys.add(key)
          ragCalls.push(item)
        }
      }

      // 预加载设定库数据（整本小说翻译只查一次）
      let allChars: typeof characterCards.$inferSelect[] = []
      let worldBible: typeof worldBibles.$inferSelect | undefined
      let styleFingerprint: StyleFingerprint | null = null
      if (seriesId) {
        allChars = await db.select().from(characterCards).where(eq(characterCards.seriesId, seriesId))
        const [wb] = await db.select().from(worldBibles).where(eq(worldBibles.seriesId, seriesId))
        worldBible = wb
        const [s] = await db.select({ styleFingerprint: series.styleFingerprint }).from(series).where(eq(series.id, seriesId))
        styleFingerprint = (s?.styleFingerprint as StyleFingerprint) || null
      }

      for (const chapter of chapterList) {
        if (!chapter.contentOriginal) {
          completed++
          results.push({ chapterId: chapter.id, chapterNumber: chapter.chapterNumber, status: "skipped" })
          continue
        }

        // 使用 1500 字符 chunk + 400 字符重叠
        const segments = splitTranslationSegments(chapter.contentOriginal)

        // 预计算本章 embedding（每章 1 次，避免 N+1）
        let chapterEmbedding: number[] | undefined
        try {
          chapterEmbedding = await getEmbedding(chapter.contentOriginal.slice(0, 500))
        } catch {
          // embedding 失败不影响主流程
        }

        // 整章只做一次 RAG 查询
        const { fuzzyMatches, ragRef } = await getChapterRagContext(
          input.novelId, seriesId, chapterEmbedding, chapter.contentOriginal || "", allChars, input.style, input.ragTopK ?? 3, input.ragLimit ?? 2
        )

        for (const m of fuzzyMatches) {
          addRagCall({ type: "translation_memory", content: m.sourceText, score: m.similarity })
        }
        for (const r of ragRef) {
          addRagCall({ type: r.sourceType === "parallel_corpus" ? "full_text" : "vector_search", content: r.content, score: r.score, sourceType: r.sourceType })
        }

        // segments 并行翻译
        const segmentResults = await Promise.all(
          segments.map(async (segment, segIdx) => {
            // 动态构建 lore：只注入出场角色和相关世界观维度
            const relevantChars = seriesId ? detectCharactersInSegment(segment, allChars) : []
            const loreSection = seriesId
              ? await buildDynamicLoreSection(seriesId, allChars, worldBible, relevantChars, segment)
              : ""
            // 检测对话说话者，注入角色语言风格
            const speakers = seriesId ? detectSpeakersInSegment(segment, allChars) : []
            const dialogueStyleSection = speakers.length > 0 ? buildDialogueStyleSection(speakers) : ""
            const basePrompt = buildTranslationPrompt(
              segment, input.style, fuzzyMatches, ragRef, loreSection, input.userPrompt, styleFingerprint, dialogueStyleSection
            )
            const bridge = buildContextBridge(segIdx, segments.length, segments[segIdx - 1] || "", segments[segIdx + 1] || "")
            const prompt = bridge ? basePrompt + "\n\n" + bridge : basePrompt
            const { text, error } = await translateSegmentWithRetry(prompt)
            const cleanText = error ? text : sanitizeTranslation(text)
            return { segIdx, text: cleanText, error, segment }
          })
        )

        segmentResults.sort((a, b) => a.segIdx - b.segIdx)
        const failedSegments: Array<{ segmentIndex: number; error: string }> = []
        let translatedContent = ""

        for (const result of segmentResults) {
          if (result.error) {
            failedSegments.push({ segmentIndex: result.segIdx, error: result.error })
            translatedContent += `【翻译失败，原文保留】\n\n${result.segment}\n\n`
          } else {
            translatedContent += result.text + "\n\n"
          }
        }

        await db
          .update(chapters)
          .set({ contentTranslated: translatedContent.trim() })
          .where(eq(chapters.id, chapter.id))

        completed++
        results.push({
          chapterId: chapter.id,
          chapterNumber: chapter.chapterNumber,
          status: failedSegments.length > 0 ? "partial" : "done",
          failedSegments: failedSegments.length > 0 ? failedSegments : undefined,
        })
      }

      // 保存翻译风格设置到小说元数据
      const updatedMetadata = {
        ...(novel?.metadata as Record<string, unknown> || {}),
        lastTranslateStyle: input.style,
        lastTranslatePrompt: input.userPrompt || "",
      }

      await db
        .update(novels)
        .set({ status: "translated", metadata: updatedMetadata })
        .where(eq(novels.id, input.novelId))

      // 异步更新系列风格指纹（不阻塞返回）
      if (seriesId) {
        import("../services/style-analyzer").then(({ updateSeriesStyleFingerprint }) => {
          updateSeriesStyleFingerprint(seriesId).catch(() => { /* 忽略失败 */ })
        })
      }

      return { progress: 100, completed: true, total, results, ragCalls }
    }),

  // 单章翻译（用于前端逐章翻译 + 进度展示）
  chapter: publicQuery
    .input(z.object({
      novelId: z.number(),
      chapterId: z.number(),
      style: z.enum(["literal", "fluent", "literary"]).default("fluent"),
      userPrompt: z.string().optional(),
      ragTopK: z.number().min(1).max(10).optional(),
      ragLimit: z.number().min(1).max(10).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const [novel] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.novelId))

      const seriesId = novel?.seriesId || null

      const [chapter] = await db
        .select()
        .from(chapters)
        .where(eq(chapters.id, input.chapterId))

      if (!chapter || !chapter.contentOriginal) {
        throw new Error("章节不存在或内容为空")
      }

      // 预加载设定库数据（只查一次，所有 segment 共用）
      let allChars: typeof characterCards.$inferSelect[] = []
      let worldBible: typeof worldBibles.$inferSelect | undefined
      let styleFingerprint: StyleFingerprint | null = null
      if (seriesId) {
        allChars = await db.select().from(characterCards).where(eq(characterCards.seriesId, seriesId))
        const [wb] = await db.select().from(worldBibles).where(eq(worldBibles.seriesId, seriesId))
        worldBible = wb
        const [s] = await db.select({ styleFingerprint: series.styleFingerprint }).from(series).where(eq(series.id, seriesId))
        styleFingerprint = (s?.styleFingerprint as StyleFingerprint) || null
      }

      // 使用 1500 字符 chunk + 400 字符重叠
      const segments = splitTranslationSegments(chapter.contentOriginal)

      // 预计算本章 embedding
      let chapterEmbedding: number[] | undefined
      try {
        chapterEmbedding = await getEmbedding(chapter.contentOriginal.slice(0, 500))
      } catch { /* ignore */ }

      // HyDE：生成假设参考文档的 embedding，提升跨语言召回率
      let hydeEmbedding: number[] | undefined
      try {
        hydeEmbedding = await generateHydeEmbedding(chapter.contentOriginal.slice(0, 500), input.style)
      } catch { /* ignore */ }

      // 整章只做一次 RAG 查询，所有 segments 共用
      let { fuzzyMatches, ragRef } = await getChapterRagContext(
        input.novelId, seriesId, chapterEmbedding, chapter.contentOriginal || "", allChars, input.style, input.ragTopK ?? 3, input.ragLimit ?? 2, hydeEmbedding
      )

      // LLM 重排序：提升 RAG 结果与当前翻译任务的相关性
      try {
        ragRef = await rerankRagResults(chapter.contentOriginal.slice(0, 300), ragRef, input.ragLimit ?? 2)
      } catch { /* 重排序失败不影响主流程 */ }

      const ragCalls: Array<{
        type: "translation_memory" | "vector_search" | "full_text"
        content: string
        score?: number
        sourceType?: string
      }> = []
      const ragKeys = new Set<string>()

      function addRagCall(item: typeof ragCalls[number]) {
        const key = item.type + "|" + item.content.slice(0, 80)
        if (!ragKeys.has(key)) {
          ragKeys.add(key)
          ragCalls.push(item)
        }
      }

      for (const m of fuzzyMatches) {
        addRagCall({ type: "translation_memory", content: m.sourceText, score: m.similarity })
      }
      for (const r of ragRef) {
        addRagCall({ type: r.sourceType === "parallel_corpus" ? "full_text" : "vector_search", content: r.content, score: r.score, sourceType: r.sourceType })
      }

      // segments 并行翻译（时间从求和变为取最大）
      const segmentResults = await Promise.all(
        segments.map(async (segment, segIdx) => {
          // 动态构建 lore：只注入出场角色和相关世界观维度
          const relevantChars = seriesId ? detectCharactersInSegment(segment, allChars) : []
          const loreSection = seriesId
            ? await buildDynamicLoreSection(seriesId, allChars, worldBible, relevantChars, segment)
            : ""
          // 检测对话说话者，注入角色语言风格
          const speakers = seriesId ? detectSpeakersInSegment(segment, allChars) : []
          const dialogueStyleSection = speakers.length > 0 ? buildDialogueStyleSection(speakers) : ""
          const basePrompt = buildTranslationPrompt(
            segment, input.style, fuzzyMatches, ragRef, loreSection, input.userPrompt, styleFingerprint, dialogueStyleSection
          )
          const bridge = buildContextBridge(segIdx, segments.length, segments[segIdx - 1] || "", segments[segIdx + 1] || "")
          const prompt = bridge ? basePrompt + "\n\n" + bridge : basePrompt
          const { text, error } = await translateSegmentWithRetry(prompt)
          const cleanText = error ? text : sanitizeTranslation(text)
          return { segIdx, text: cleanText, error, segment }
        })
      )

      // 按原始顺序拼接结果
      segmentResults.sort((a, b) => a.segIdx - b.segIdx)
      const failedSegments: Array<{ segmentIndex: number; error: string }> = []
      let translatedContent = ""

      for (const result of segmentResults) {
        if (result.error) {
          failedSegments.push({ segmentIndex: result.segIdx, error: result.error })
          translatedContent += `【翻译失败，原文保留】\n\n${result.segment}\n\n`
        } else {
          translatedContent += result.text + "\n\n"
        }
      }

      await db
        .update(chapters)
        .set({ contentTranslated: translatedContent.trim() })
        .where(eq(chapters.id, input.chapterId))

      return {
        chapterId: chapter.id,
        content: translatedContent.trim(),
        ragCalls,
        failedSegments: failedSegments.length > 0 ? failedSegments : undefined,
      }
    }),

  extractStyleFingerprint: publicQuery
    .input(z.object({
      novelId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { extractStyleFingerprint } = await import("../services/style-analyzer")
      const fingerprint = await extractStyleFingerprint(input.novelId)
      return { fingerprint }
    }),

  export: publicQuery
    .input(z.object({
      novelId: z.number(),
      format: z.enum(["pure", "parallel"]).default("pure"),
    }))
    .query(async ({ input }) => {
      const db = getDb()

      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))
        .orderBy(asc(chapters.chapterNumber))

      if (input.format === "pure") {
        return {
          format: "pure" as const,
          content: chapterList
            .map(ch => ch.contentTranslated || "")
            .filter(Boolean)
            .join("\n\n"),
        }
      }

      const pairs: string[] = []
      for (const ch of chapterList) {
        const sourceParas = splitTextIntoParagraphs(ch.contentOriginal || "")
        const translatedParas = splitTextIntoParagraphs(ch.contentTranslated || "")
        const pairCount = Math.min(sourceParas.length, translatedParas.length)
        for (let i = 0; i < pairCount; i++) {
          pairs.push(`${sourceParas[i].trim()}\n===\n${translatedParas[i].trim()}`)
        }
      }

      return {
        format: "parallel" as const,
        content: pairs.join("\n===\n"),
      }
    }),
})
