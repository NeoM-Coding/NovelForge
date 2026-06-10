import { z } from "zod"

// 小说
export const createNovelSchema = z.object({
  title: z.string().min(1).max(500),
  author: z.string().max(200).optional(),
  originalLanguage: z.string().max(50).optional(),
  status: z.string().default("unread"),
})

export const updateNovelSchema = z.object({
  id: z.number(),
  title: z.string().min(1).max(500).optional(),
  author: z.string().max(200).optional(),
  status: z.enum(["unread", "reading", "translated", "completed"]).optional(),
  metadata: z.record(z.any()).optional(),
})

// 章节
export const chapterListSchema = z.object({
  novelId: z.number(),
})

export const updateChapterSchema = z.object({
  id: z.number(),
  contentTranslated: z.string().optional(),
  title: z.string().optional(),
})

// 翻译
export const startTranslationSchema = z.object({
  novelId: z.number(),
  style: z.enum(["literal", "fluent", "literary"]).default("fluent"),
  startChapter: z.number().default(1),
  userPrompt: z.string().optional(),
})

export const exportTranslationSchema = z.object({
  novelId: z.number(),
  format: z.enum(["pure", "parallel"]).default("pure"),
})

// 设定库
export const createSeriesSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  universeName: z.string().max(200).optional(),
})

export const createCharacterSchema = z.object({
  seriesId: z.number(),
  name: z.string().min(1).max(200),
  aliases: z.array(z.string()).default([]),
  age: z.string().optional(),
  appearanceTags: z.array(z.string()).default([]),
  personalityTraits: z.array(z.string()).default([]),
  coreMotivations: z.string().optional(),
  relationships: z.record(z.any()).default({}),
  speechPatterns: z.string().optional(),
  taboos: z.array(z.string()).default([]),
  canonicalArcSummary: z.string().optional(),
})

export const updateCharacterSchema = createCharacterSchema.partial().extend({
  id: z.number(),
})

export const createWorldBibleSchema = z.object({
  seriesId: z.number(),
  geography: z.string().optional(),
  magicSystem: z.string().optional(),
  technologyLevel: z.string().optional(),
  factions: z.array(z.any()).default([]),
  timelineEvents: z.array(z.any()).default([]),
  culturalCustoms: z.string().optional(),
  linguisticNotes: z.string().optional(),
})

// 标签
export const createTagSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.number().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
})

export const assignTagSchema = z.object({
  novelId: z.number(),
  tagId: z.number(),
})

// 素材
export const createMaterialSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  sourceType: z.enum(["parallel_corpus", "reference_novel", "knowledge_doc"]),
  seriesId: z.number().optional(),
  tags: z.array(z.string()).default([]),
  description: z.string().optional(),
})

export const createMaterialFromDualFilesSchema = z.object({
  title: z.string().min(1),
  sourceText: z.string().min(1),
  translatedText: z.string().min(1),
  seriesId: z.number().optional(),
  tags: z.array(z.string()).default([]),
  description: z.string().optional(),
})

export const indexMaterialSchema = z.object({
  id: z.number(),
})

export const updateMaterialScopeSchema = z.object({
  id: z.number(),
  seriesId: z.number().optional(),
  tags: z.array(z.string()).optional(),
})

// AI 提取设定
export const extractedLoreSchema = z.object({
  characters: z.array(z.object({
    name: z.string(),
    aliases: z.array(z.string()).default([]),
    age: z.string().optional(),
    appearanceTags: z.array(z.string()).default([]),
    personalityTraits: z.array(z.string()).default([]),
    coreMotivations: z.string().optional(),
    relationships: z.record(z.any()).default({}),
    speechPatterns: z.string().optional(),
    taboos: z.array(z.string()).default([]),
    canonicalArcSummary: z.string().optional(),
  })),
  worldBible: z.object({
    geography: z.string().optional(),
    magicSystem: z.string().optional(),
    technologyLevel: z.string().optional(),
    factions: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
    timelineEvents: z.array(z.object({ order: z.number(), description: z.string() })).default([]),
    culturalCustoms: z.string().optional(),
    linguisticNotes: z.string().optional(),
  }),
})

export type ExtractedLore = z.infer<typeof extractedLoreSchema>

// 大纲
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

// 批量生成
export const batchChapterConfigSchema = z.object({
  chapterNumber: z.number().min(1),
  title: z.string().min(1),
  brief: z.string().min(1),
})

export const generationParamsPartialSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  styleFidelity: z.number().min(1).max(10).optional(),
  characterLoyalty: z.number().min(1).max(10).optional(),
  tone: z.string().optional(),
  lengthTarget: z.enum(["short", "chapter", "arc"]).optional(),
  canonConstraint: z.enum(["strict", "loose", "au"]).optional(),
  writingMode: z.enum(["canon_continuation", "character_spinoff", "original_in_universe", "alternate_universe"]).optional(),
  ragLimit: z.number().min(1).max(10).optional(),
})

export const batchGenerationSchema = z.object({
  workId: z.number(),
  chapterConfigs: z.array(batchChapterConfigSchema).min(1).max(50),
  params: generationParamsPartialSchema.optional(),
  concurrency: z.number().min(1).max(5).optional().default(1),
})

export type BatchChapterConfig = z.infer<typeof batchChapterConfigSchema>
export type BatchGenerationInput = z.infer<typeof batchGenerationSchema>

// 导出
export const exportWorkSchema = z.object({
  workId: z.number(),
  format: z.enum(["txt", "markdown"]).default("txt"),
})

export type ExportWorkInput = z.infer<typeof exportWorkSchema>
