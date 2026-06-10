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

  // 计算当前总长度
  let totalLength = orderedSections.reduce((sum, s) => sum + s.content.length, 0)

  // 如果总长度未超限，直接返回
  if (totalLength <= config.maxChars) {
    const prompt = orderedSections.map(s => s.content).join("\n\n")
    return { prompt, truncated }
  }

  // 需要截断：从最低优先级开始
  const workingSections = orderedSections.map(s => ({ ...s }))
  const TRUNCATION_MARKER_LENGTH = 30 // 预留截断标记长度

  for (let i = workingSections.length - 1; i >= 0; i--) {
    const section = workingSections[i]

    // 核心任务和用户自定义不截断
    if (section.key === "coreTask" || section.key === "userPrompt") continue

    // RAG 部分有单独的更严格限制
    if (section.key === "rag" && section.content.length > config.ragMaxChars) {
      section.content = section.content.slice(0, config.ragMaxChars) +
        "\n\n[更多素材因长度限制被截断]"
      if (!truncated.includes("rag")) truncated.push("rag")
      totalLength = workingSections.reduce((sum, s) => sum + s.content.length, 0)
      if (totalLength <= config.maxChars) break
    }

    // 通用截断（跳过已处理的 RAG，避免双重截断）
    if (section.content.length > 200 + TRUNCATION_MARKER_LENGTH) {
      const excess = totalLength - config.maxChars
      const targetLength = Math.max(
        200,
        section.content.length - excess - TRUNCATION_MARKER_LENGTH
      )
      section.content = section.content.slice(0, targetLength) +
        `\n\n[${section.key} 因长度限制被截断]`
      if (!truncated.includes(section.key)) truncated.push(section.key)
      totalLength = workingSections.reduce((sum, s) => sum + s.content.length, 0)
      if (totalLength <= config.maxChars) break
    }
  }

  // 最终校验：如果仍超限且是 coreTask 导致，发出警告
  const finalLength = workingSections.reduce((sum, s) => sum + s.content.length, 0)
  const coreTaskSection = workingSections.find(s => s.key === "coreTask")
  if (finalLength > config.maxChars && coreTaskSection && coreTaskSection.content.length > config.maxChars) {
    console.warn(`[assemblePromptWithBudget] WARNING: coreTask 本身超过预算 (${coreTaskSection.content.length} > ${config.maxChars})，无法通过截断其他模块满足预算。`)
  }

  const prompt = workingSections.map(s => s.content).join("\n\n")
  return { prompt, truncated }
}
