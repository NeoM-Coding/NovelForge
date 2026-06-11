import { relations } from "drizzle-orm"
import {
  novels,
  chapters,
  tags,
  novelTags,
  series,
  characterCards,
  worldBibles,
  seriesCanon,
  vectorChunks,
  translationMemory,
  fanFictionWorks,
  fanFictionChapters,
  materials,
  materialAnalytics,
  plotTropes,
  bookmarks,
  annotations,
  readingProgress,
  generationMetrics,
} from "./schema"

export const novelsRelations = relations(novels, ({ many }) => ({
  chapters: many(chapters),
  novelTags: many(novelTags),
  bookmarks: many(bookmarks),
  annotations: many(annotations),
  readingProgress: many(readingProgress),
  fanFictionWorks: many(fanFictionWorks),
  vectorChunks: many(vectorChunks),
  translationMemory: many(translationMemory),
}))

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  novel: one(novels, {
    fields: [chapters.novelId],
    references: [novels.id],
  }),
  bookmarks: many(bookmarks),
  annotations: many(annotations),
}))

export const tagsRelations = relations(tags, ({ one, many }) => ({
  parent: one(tags, {
    fields: [tags.parentId],
    references: [tags.id],
  }),
  children: many(tags),
  novelTags: many(novelTags),
}))

export const novelTagsRelations = relations(novelTags, ({ one }) => ({
  novel: one(novels, {
    fields: [novelTags.novelId],
    references: [novels.id],
  }),
  tag: one(tags, {
    fields: [novelTags.tagId],
    references: [tags.id],
  }),
}))

export const seriesRelations = relations(series, ({ many }) => ({
  characterCards: many(characterCards),
  worldBibles: many(worldBibles),
  canonEvents: many(seriesCanon),
  fanFictionWorks: many(fanFictionWorks),
  vectorChunks: many(vectorChunks),
  translationMemory: many(translationMemory),
  materials: many(materials),
  plotTropes: many(plotTropes),
}))

export const characterCardsRelations = relations(characterCards, ({ one }) => ({
  series: one(series, {
    fields: [characterCards.seriesId],
    references: [series.id],
  }),
}))

export const worldBiblesRelations = relations(worldBibles, ({ one }) => ({
  series: one(series, {
    fields: [worldBibles.seriesId],
    references: [series.id],
  }),
}))

export const seriesCanonRelations = relations(seriesCanon, ({ one }) => ({
  series: one(series, {
    fields: [seriesCanon.seriesId],
    references: [series.id],
  }),
}))

export const fanFictionWorksRelations = relations(fanFictionWorks, ({ one, many }) => ({
  series: one(series, {
    fields: [fanFictionWorks.seriesId],
    references: [series.id],
  }),
  parentNovel: one(novels, {
    fields: [fanFictionWorks.parentNovelId],
    references: [novels.id],
  }),
  chapters: many(fanFictionChapters),
}))

export const vectorChunksRelations = relations(vectorChunks, ({ one }) => ({
  novel: one(novels, {
    fields: [vectorChunks.novelId],
    references: [novels.id],
  }),
  series: one(series, {
    fields: [vectorChunks.seriesId],
    references: [series.id],
  }),
}))

export const translationMemoryRelations = relations(translationMemory, ({ one }) => ({
  novel: one(novels, {
    fields: [translationMemory.novelId],
    references: [novels.id],
  }),
  series: one(series, {
    fields: [translationMemory.seriesId],
    references: [series.id],
  }),
}))

export const materialsRelations = relations(materials, ({ one }) => ({
  series: one(series, {
    fields: [materials.seriesId],
    references: [series.id],
  }),
}))

export const materialAnalyticsRelations = relations(materialAnalytics, ({ one }) => ({
  material: one(materials, {
    fields: [materialAnalytics.materialId],
    references: [materials.id],
  }),
}))

export const plotTropesRelations = relations(plotTropes, ({ one }) => ({
  series: one(series, {
    fields: [plotTropes.seriesId],
    references: [series.id],
  }),
}))

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  novel: one(novels, {
    fields: [bookmarks.novelId],
    references: [novels.id],
  }),
  chapter: one(chapters, {
    fields: [bookmarks.chapterId],
    references: [chapters.id],
  }),
}))

export const annotationsRelations = relations(annotations, ({ one }) => ({
  novel: one(novels, {
    fields: [annotations.novelId],
    references: [novels.id],
  }),
  chapter: one(chapters, {
    fields: [annotations.chapterId],
    references: [chapters.id],
  }),
}))

export const readingProgressRelations = relations(readingProgress, ({ one }) => ({
  novel: one(novels, {
    fields: [readingProgress.novelId],
    references: [novels.id],
  }),
}))

export const fanFictionChaptersRelations = relations(fanFictionChapters, ({ one }) => ({
  work: one(fanFictionWorks, {
    fields: [fanFictionChapters.workId],
    references: [fanFictionWorks.id],
  }),
}))

export const generationMetricsRelations = relations(generationMetrics, ({ one }) => ({
  work: one(fanFictionWorks, {
    fields: [generationMetrics.workId],
    references: [fanFictionWorks.id],
  }),
  chapter: one(fanFictionChapters, {
    fields: [generationMetrics.chapterId],
    references: [fanFictionChapters.id],
  }),
}))

