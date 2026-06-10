import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  real,
  vector,
  unique,
} from "drizzle-orm/pg-core"

// 小说主表
export const novels = pgTable("novels", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  author: varchar("author", { length: 200 }),
  originalLanguage: varchar("original_language", { length: 50 }),
  seriesId: integer("series_id"),
  status: varchar("status", { length: 50 }).notNull().default("unread"),
  filePath: varchar("file_path", { length: 1000 }),
  contentOriginal: text("content_original"),
  contentTranslated: text("content_translated"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// 章节表
export const chapters = pgTable("chapters", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id").notNull(),
  chapterNumber: integer("chapter_number").notNull(),
  title: varchar("title", { length: 500 }),
  contentOriginal: text("content_original"),
  contentTranslated: text("content_translated"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 标签表（用户自定义层级）
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  parentId: integer("parent_id"),
  color: varchar("color", { length: 50 }),
  icon: varchar("icon", { length: 50 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 小说-标签关联
export const novelTags = pgTable("novel_tags", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id").notNull(),
  tagId: integer("tag_id").notNull(),
})

// 系列/世界观组
export const series = pgTable("series", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  universeName: varchar("universe_name", { length: 200 }),
  styleFingerprint: jsonb("style_fingerprint"), // 从已有译文提取的风格特征
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 角色卡
export const characterCards = pgTable("character_cards", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  aliases: jsonb("aliases").default([]),
  age: varchar("age", { length: 50 }),
  appearanceTags: jsonb("appearance_tags").default([]),
  personalityTraits: jsonb("personality_traits").default([]),
  coreMotivations: text("core_motivations"),
  relationships: jsonb("relationships").default({}),
  speechPatterns: text("speech_patterns"),
  taboos: jsonb("taboos").default([]),
  canonicalArcSummary: text("canonical_arc_summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// 世界观圣经
export const worldBibles = pgTable("world_bibles", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull(),
  geography: text("geography"),
  magicSystem: text("magic_system"),
  technologyLevel: text("technology_level"),
  factions: jsonb("factions").default([]),
  timelineEvents: jsonb("timeline_events").default([]),
  culturalCustoms: text("cultural_customs"),
  linguisticNotes: text("linguistic_notes"),
  aspects: jsonb("aspects").default([]), // [{ id: string, name: string, content: string }]
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// 正史记事
export const seriesCanon = pgTable("series_canon", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull(),
  eventOrder: integer("event_order").notNull(),
  description: text("description").notNull(),
  isImmutable: boolean("is_immutable").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 向量存储（RAG）
export const vectorChunks = pgTable("vector_chunks", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  sourceType: varchar("source_type", { length: 50 }).notNull(),
  novelId: integer("novel_id"),
  seriesId: integer("series_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 翻译记忆
export const translationMemory = pgTable("translation_memory", {
  id: serial("id").primaryKey(),
  sourceText: text("source_text").notNull(),
  translatedText: text("translated_text").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  novelId: integer("novel_id"),
  seriesId: integer("series_id"),
  frequency: integer("frequency").notNull().default(1),
  styleTag: varchar("style_tag", { length: 20 }), // "literal" | "fluent" | "literary"
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// Embedding 缓存（语义缓存层）
export const embeddingCache = pgTable("embedding_cache", {
  id: serial("id").primaryKey(),
  textHash: varchar("text_hash", { length: 64 }).notNull().unique(),
  textPreview: varchar("text_preview", { length: 200 }).notNull(),
  embedding: jsonb("embedding").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 二创作品
export const fanFictionWorks = pgTable("fan_fiction_works", {
  id: serial("id").primaryKey(),
  parentNovelId: integer("parent_novel_id"),
  seriesId: integer("series_id"),
  title: varchar("title", { length: 500 }),
  brief: text("brief"),
  parameters: jsonb("parameters"),
  generatedContent: text("generated_content"),
  outline: jsonb("outline").$type<{
    overview?: string
    scenes?: Array<{
      id: string
      title: string
      description: string
    }>
    generatedAt?: string
    outlineType?: "overview" | "scenes" | "both"
  }>(),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// 二创作品章节表（支持多章节长篇小说）
export const fanFictionChapters = pgTable("fan_fiction_chapters", {
  id: serial("id").primaryKey(),
  workId: integer("work_id").notNull(),
  chapterNumber: integer("chapter_number").notNull(),
  title: varchar("title", { length: 500 }),
  content: text("content").notNull().default(""),
  brief: text("brief"),
  parameters: jsonb("parameters"),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique().on(table.workId, table.chapterNumber),
])

// 生成任务记录
export const generationJobs = pgTable("generation_jobs", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 50 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  progress: real("progress").notNull().default(0),
  result: jsonb("result"),
  errorLog: text("error_log"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 书签
export const bookmarks = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id").notNull(),
  chapterId: integer("chapter_id").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 阅读批注/高亮
export const annotations = pgTable("annotations", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id").notNull(),
  chapterId: integer("chapter_id").notNull(),
  paragraphIndex: integer("paragraph_index").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  selectedText: text("selected_text").notNull(),
  note: text("note"),
  color: varchar("color", { length: 50 }).notNull().default("yellow"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 阅读进度
export const readingProgress = pgTable("reading_progress", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id").notNull(),
  chapterId: integer("chapter_id").notNull(),
  chapterNumber: integer("chapter_number").notNull().default(1),
  chapterTitle: varchar("chapter_title", { length: 500 }),
  totalChapters: integer("total_chapters").notNull().default(1),
  scrollPosition: integer("scroll_position").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// ============================================================
// RAG Material Pool (用户主动投喂素材)
// ============================================================

export const materials = pgTable("materials", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 300 }).notNull(),
  content: text("content").notNull(),
  sourceType: varchar("source_type", { length: 50 }).notNull(),
  seriesId: integer("series_id"),
  tags: jsonb("tags").default([]),
  description: text("description"),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  indexedChunks: integer("indexed_chunks").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 桥段库（从素材中提取的典型相似桥段）
export const plotTropes = pgTable("plot_tropes", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  pattern: text("pattern"),
  examples: jsonb("examples").default([]),
  sourceChunks: jsonb("source_chunks").default([]),
  tags: jsonb("tags").default([]),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// 桥段-角色关联（桥段的典型参与角色）
export const tropeCharacterLinks = pgTable("trope_character_links", {
  id: serial("id").primaryKey(),
  tropeId: integer("trope_id").notNull(),
  characterId: integer("character_id").notNull(),
  role: varchar("role", { length: 50 }), // protagonist, antagonist, trigger, victim 等
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 桥段-正史关联（桥段发生的正史背景）
export const tropeCanonLinks = pgTable("trope_canon_links", {
  id: serial("id").primaryKey(),
  tropeId: integer("trope_id").notNull(),
  canonEventId: integer("canon_event_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// RAG 效果反馈闭环
export const ragFeedback = pgTable("rag_feedback", {
  id: serial("id").primaryKey(),
  generationId: integer("generation_id").notNull(),
  chunkId: integer("chunk_id"),
  content: text("content"),
  wasHelpful: boolean("was_helpful"),
  similarityScore: real("similarity_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// 操作审计日志（支持撤销）
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 50 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: integer("entity_id").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
