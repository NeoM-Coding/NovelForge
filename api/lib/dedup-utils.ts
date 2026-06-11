/**
 * 角色去重工具库
 * 提供三级检测：精确匹配 > 子串匹配 > 编辑距离模糊匹配
 */

export interface CharacterRef {
  id: number
  name: string
  aliases: string[]
}

export interface DuplicateGroup {
  ids: number[]
  names: string[]
  reason: string
  matchType: "exact" | "substring" | "fuzzy"
  confidence: number // 0-1
  details: Array<{
    charA: string
    charB: string
    matchedNames: string[]
    matchType: "exact" | "substring" | "fuzzy"
  }>
}

export interface PotentialDuplicate {
  newCharacterName: string
  matchedCharacterId: number
  matchedCharacterName: string
  matchType: "exact" | "substring" | "fuzzy"
  confidence: number
  reason: string
}

// ========== 编辑距离（Levenshtein） ==========

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  // 使用滚动数组优化空间
  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,      // 删除
        curr[j - 1] + 1,  // 插入
        prev[j - 1] + cost // 替换
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

// ========== 匹配检测 ==========

type MatchResult = {
  matched: boolean
  type: "exact" | "substring" | "fuzzy"
  matchedNames: string[]
  confidence: number
}

/**
 * 检测两个名字列表是否代表同一角色
 */
function checkNameOverlap(namesA: string[], namesB: string[]): MatchResult {
  const setA = new Set(namesA.map(n => n.trim()).filter(n => n.length > 0))
  const setB = new Set(namesB.map(n => n.trim()).filter(n => n.length > 0))

  if (setA.size === 0 || setB.size === 0) {
    return { matched: false, type: "exact", matchedNames: [], confidence: 0 }
  }

  // 1. 精确匹配
  for (const nameA of setA) {
    for (const nameB of setB) {
      if (nameA === nameB) {
        return { matched: true, type: "exact", matchedNames: [nameA], confidence: 1 }
      }
    }
  }

  // 2. 子串匹配（一个名字包含另一个完整的名字，且被包含的名字 >= 2 个字）
  for (const nameA of setA) {
    for (const nameB of setB) {
      const shorter = nameA.length <= nameB.length ? nameA : nameB
      const longer = nameA.length <= nameB.length ? nameB : nameA
      if (shorter.length >= 2 && longer.includes(shorter)) {
        return {
          matched: true,
          type: "substring",
          matchedNames: [shorter, longer],
          confidence: 0.7 + (shorter.length / longer.length) * 0.2,
        }
      }
    }
  }

  // 3. 编辑距离模糊匹配（距离 <= 2 且名字长度 >= 3，或归一化距离 <= 0.3）
  let bestConfidence = 0
  let bestPair: string[] = []
  for (const nameA of setA) {
    for (const nameB of setB) {
      if (nameA.length < 2 || nameB.length < 2) continue
      const dist = levenshteinDistance(nameA, nameB)
      const maxLen = Math.max(nameA.length, nameB.length)
      const normalized = dist / maxLen

      // 规则：短名字(2-3字)最多允许1个差异；长名字允许2个或归一化<=0.3
      let match = false
      if (maxLen <= 3 && dist <= 1) match = true
      else if (maxLen > 3 && (dist <= 2 || normalized <= 0.3)) match = true

      if (match) {
        const confidence = 1 - normalized * 0.8 // 0.4 ~ 0.92
        if (confidence > bestConfidence) {
          bestConfidence = confidence
          bestPair = [nameA, nameB]
        }
      }
    }
  }

  if (bestConfidence > 0) {
    return {
      matched: true,
      type: "fuzzy",
      matchedNames: bestPair,
      confidence: Math.min(bestConfidence, 0.85),
    }
  }

  return { matched: false, type: "exact", matchedNames: [], confidence: 0 }
}

// ========== 公开 API ==========

/**
 * 在已有角色列表中查找重复角色组
 */
export function findDuplicateGroups(characters: CharacterRef[]): DuplicateGroup[] {
  const n = characters.length
  if (n < 2) return []

  // 构建邻接表：每个角色和它匹配的其他角色
  const adjacency = new Map<number, Set<number>>()
  const matchRecords = new Map<string, MatchResult>()

  function getKey(id1: number, id2: number): string {
    return id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = characters[i]
      const b = characters[j]
      const namesA = [a.name, ...(a.aliases || [])]
      const namesB = [b.name, ...(b.aliases || [])]

      const result = checkNameOverlap(namesA, namesB)
      if (result.matched) {
        const key = getKey(a.id, b.id)
        matchRecords.set(key, result)

        if (!adjacency.has(a.id)) adjacency.set(a.id, new Set())
        if (!adjacency.has(b.id)) adjacency.set(b.id, new Set())
        adjacency.get(a.id)!.add(b.id)
        adjacency.get(b.id)!.add(a.id)
      }
    }
  }

  // 用 BFS 找连通分量（每个连通分量是一组重复角色）
  const visited = new Set<number>()
  const groups: DuplicateGroup[] = []

  for (const startId of adjacency.keys()) {
    if (visited.has(startId)) continue

    const groupIds: number[] = []
    const queue = [startId]
    visited.add(startId)

    while (queue.length > 0) {
      const id = queue.shift()!
      groupIds.push(id)
      for (const neighbor of adjacency.get(id) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    if (groupIds.length > 1) {
      // 收集组内所有匹配详情
      const details: DuplicateGroup["details"] = []
      let totalConfidence = 0
      let matchCount = 0
      let dominantType: DuplicateGroup["matchType"] = "exact"

      for (let i = 0; i < groupIds.length; i++) {
        for (let j = i + 1; j < groupIds.length; j++) {
          const key = getKey(groupIds[i], groupIds[j])
          const record = matchRecords.get(key)
          if (record) {
            const charA = characters.find(c => c.id === groupIds[i])!
            const charB = characters.find(c => c.id === groupIds[j])!
            details.push({
              charA: charA.name,
              charB: charB.name,
              matchedNames: record.matchedNames,
              matchType: record.type,
            })
            totalConfidence += record.confidence
            matchCount++
            if (record.type === "exact") dominantType = "exact"
            else if (record.type === "substring" && dominantType !== "exact") dominantType = "substring"
            else if (record.type === "fuzzy" && dominantType !== "exact" && dominantType !== "substring") dominantType = "fuzzy"
          }
        }
      }

      const avgConfidence = matchCount > 0 ? totalConfidence / matchCount : 0

      // 生成 reason
      const exactPairs = details.filter(d => d.matchType === "exact")
      const substringPairs = details.filter(d => d.matchType === "substring")
      const fuzzyPairs = details.filter(d => d.matchType === "fuzzy")

      let reason = ""
      if (exactPairs.length > 0) {
        reason = `同名「${exactPairs[0].matchedNames[0]}」`
      } else if (substringPairs.length > 0) {
        reason = `昵称关联「${substringPairs[0].matchedNames[0]}↔${substringPairs[0].matchedNames[1]}」`
      } else if (fuzzyPairs.length > 0) {
        reason = `疑似同字「${fuzzyPairs[0].matchedNames[0]}↔${fuzzyPairs[0].matchedNames[1]}」`
      }

      groups.push({
        ids: groupIds,
        names: groupIds.map(id => characters.find(c => c.id === id)!.name),
        reason,
        matchType: dominantType,
        confidence: Math.round(avgConfidence * 100) / 100,
        details,
      })
    }
  }

  // 按置信度降序排列
  return groups.sort((a, b) => b.confidence - a.confidence)
}

/**
 * 检测新提取的角色与已有角色的潜在重复
 */
export function findPotentialDuplicates(
  newCharacters: Array<{ name: string; aliases: string[] }>,
  existingCharacters: CharacterRef[]
): PotentialDuplicate[] {
  const results: PotentialDuplicate[] = []

  for (const newChar of newCharacters) {
    const newNames = [newChar.name, ...(newChar.aliases || [])].filter(Boolean)

    for (const existing of existingCharacters) {
      const existingNames = [existing.name, ...(existing.aliases || [])].filter(Boolean)
      const match = checkNameOverlap(newNames, existingNames)

      if (match.matched) {
        results.push({
          newCharacterName: newChar.name,
          matchedCharacterId: existing.id,
          matchedCharacterName: existing.name,
          matchType: match.type,
          confidence: Math.round(match.confidence * 100) / 100,
          reason: match.type === "exact"
            ? `与「${existing.name}」同名/同别名`
            : match.type === "substring"
              ? `「${newChar.name}」与「${existing.name}」存在昵称关联`
              : `「${newChar.name}」与「${existing.name}」名字高度相似`,
        })
        break // 一个新角色只匹配最可能的已有角色
      }
    }
  }

  return results
}

// ========== 世界观维度去重 ==========

export interface AspectRef {
  id: string
  name: string
  content: string
}

/**
 * 计算两个字符串的 Jaccard 相似度（基于字符二元组）
 */
function jaccardSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "")
  const na = normalize(a)
  const nb = normalize(b)
  if (na.length < 10 || nb.length < 10) return 0

  const getBigrams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2))
    }
    return set
  }

  const bigramsA = getBigrams(na)
  const bigramsB = getBigrams(nb)
  const intersection = new Set([...bigramsA].filter(x => bigramsB.has(x)))
  const union = new Set([...bigramsA, ...bigramsB])

  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * 检测两个世界观维度的内容是否高度重叠
 */
function checkContentOverlap(a: AspectRef, b: AspectRef): { overlap: boolean; similarity: number } {
  // 名称已经由 checkNameOverlap 处理，这里补充内容检测
  const contentSim = jaccardSimilarity(a.content, b.content)
  // 内容相似度 > 0.5 认为是重复
  return { overlap: contentSim > 0.5, similarity: contentSim }
}

export interface DuplicateAspectGroup {
  ids: string[]
  names: string[]
  reason: string
  matchType: "exact" | "substring" | "fuzzy"
  confidence: number
}

/**
 * 在世界观维度中查找重复组（同名或名称近似的维度）
 */
export function findDuplicateAspectGroups(aspects: AspectRef[]): DuplicateAspectGroup[] {
  const n = aspects.length
  if (n < 2) return []

  const adjacency = new Map<string, Set<string>>()
  const matchRecords = new Map<string, MatchResult>()

  function getKey(id1: string, id2: string): string {
    return id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = aspects[i]
      const b = aspects[j]
      const result = checkNameOverlap([a.name], [b.name])
      const contentCheck = checkContentOverlap(a, b)
      if (result.matched || contentCheck.overlap) {
        const key = getKey(a.id, b.id)
        if (result.matched) {
          matchRecords.set(key, result)
        } else {
          matchRecords.set(key, {
            matched: true,
            type: "fuzzy" as const,
            confidence: Math.min(contentCheck.similarity, 0.95),
            matchedNames: [a.name, b.name],
          })
        }
        if (!adjacency.has(a.id)) adjacency.set(a.id, new Set())
        if (!adjacency.has(b.id)) adjacency.set(b.id, new Set())
        adjacency.get(a.id)!.add(b.id)
        adjacency.get(b.id)!.add(a.id)
      }
    }
  }

  const visited = new Set<string>()
  const groups: DuplicateAspectGroup[] = []

  for (const startId of adjacency.keys()) {
    if (visited.has(startId)) continue

    const groupIds: string[] = []
    const queue = [startId]
    visited.add(startId)

    while (queue.length > 0) {
      const id = queue.shift()!
      groupIds.push(id)
      for (const neighbor of adjacency.get(id) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    if (groupIds.length > 1) {
      let totalConfidence = 0
      let matchCount = 0
      let dominantType: DuplicateAspectGroup["matchType"] = "exact"
      let reason = ""

      for (let i = 0; i < groupIds.length; i++) {
        for (let j = i + 1; j < groupIds.length; j++) {
          const key = getKey(groupIds[i], groupIds[j])
          const record = matchRecords.get(key)
          if (record) {
            totalConfidence += record.confidence
            matchCount++
            if (record.type === "exact") dominantType = "exact"
            else if (record.type === "substring" && dominantType !== "exact") dominantType = "substring"
            else if (record.type === "fuzzy" && dominantType !== "exact" && dominantType !== "substring") dominantType = "fuzzy"
            if (!reason) {
              reason = record.type === "exact"
                ? `同名「${record.matchedNames[0]}」`
                : record.type === "substring"
                  ? `名称包含「${record.matchedNames[0]}」`
                  : `名称近似「${record.matchedNames[0]}↔${record.matchedNames[1]}」`
            }
          }
        }
      }

      groups.push({
        ids: groupIds,
        names: groupIds.map(id => aspects.find(a => a.id === id)!.name),
        reason: reason || "维度名称重叠",
        matchType: dominantType,
        confidence: matchCount > 0 ? Math.round((totalConfidence / matchCount) * 100) / 100 : 0,
      })
    }
  }

  return groups.sort((a, b) => b.confidence - a.confidence)
}

/**
 * 合并重复维度：保留内容最全的作为主维度，其他内容追加
 */
export function mergeDuplicateAspects(
  aspects: AspectRef[],
  groups: DuplicateAspectGroup[]
): AspectRef[] {
  const mergedIds = new Set<string>()
  const result: AspectRef[] = []

  for (const group of groups) {
    const groupAspects = group.ids
      .map(id => aspects.find(a => a.id === id))
      .filter((a): a is AspectRef => !!a)

    if (groupAspects.length < 2) continue

    // 保留内容最长的作为主维度
    const keep = groupAspects.reduce((best, curr) =>
      (curr.content || "").length > (best.content || "").length ? curr : best
    )

    // 收集其他维度的补充内容（去重）
    const keepParagraphs = new Set((keep.content || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean))
    const uniqueAdditions: string[] = []

    for (const a of groupAspects) {
      if (a.id === keep.id || !a.content) continue
      const paragraphs = a.content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
      for (const para of paragraphs) {
        // 检查是否与主维度的段落高度相似
        let isDuplicate = false
        for (const keepPara of keepParagraphs) {
          if (jaccardSimilarity(para, keepPara) > 0.7) {
            isDuplicate = true
            break
          }
        }
        if (!isDuplicate) {
          uniqueAdditions.push(para)
          keepParagraphs.add(para) // 防止后续维度重复添加
        }
      }
    }

    const mergedContent = uniqueAdditions.length > 0
      ? `${keep.content}\n\n--- 补充内容 ---\n${uniqueAdditions.join("\n\n")}`
      : keep.content

    result.push({
      id: keep.id,
      name: keep.name,
      content: mergedContent,
    })

    group.ids.forEach(id => mergedIds.add(id))
  }

  // 保留未合并的维度
  for (const aspect of aspects) {
    if (!mergedIds.has(aspect.id)) {
      result.push(aspect)
    }
  }

  return result
}

/**
 * 智能推荐保留角色：返回字段数量最多的角色 id
 */
export function recommendKeepId(
  charIds: number[],
  characters: Array<{
    id: number
    name: string
    aliases?: unknown
    age?: string | null
    appearanceTags?: unknown
    personalityTraits?: unknown
    coreMotivations?: string | null
    relationships?: unknown
    speechPatterns?: string | null
    taboos?: unknown
    canonicalArcSummary?: string | null
  }>
): number {
  function scoreChar(char: (typeof characters)[0]): number {
    let score = 0
    // 字段存在性得分
    if ((char.aliases as string[] | undefined)?.length) score += 1
    if (char.age) score += 1
    if ((char.appearanceTags as string[] | undefined)?.length) score += 1
    if ((char.personalityTraits as string[] | undefined)?.length) score += 1
    if (char.coreMotivations) score += 2
    if (char.relationships && Object.keys(char.relationships as Record<string, unknown>).length > 0) score += 2
    if (char.speechPatterns) score += 2
    if ((char.taboos as string[] | undefined)?.length) score += 1
    if (char.canonicalArcSummary) score += 2

    // 内容长度加权（字段多但内容短的卡不应该击败字段少但内容详实的卡）
    const contentLength = [
      char.coreMotivations,
      char.speechPatterns,
      char.canonicalArcSummary,
      char.age,
    ].filter(Boolean).join("").length
    score += Math.min(contentLength / 100, 5) // 最多加 5 分

    return score
  }

  let bestId = charIds[0]
  let bestScore = -1

  for (const id of charIds) {
    const char = characters.find(c => c.id === id)
    if (!char) continue
    const score = scoreChar(char)
    if (score > bestScore) {
      bestScore = score
      bestId = id
    }
  }

  return bestId
}
