import { createRouter, publicQuery } from "./middleware"
import { novelRouter } from "./routers/novel"
import { chapterRouter } from "./routers/chapter"
import { translateRouter } from "./routers/translate"
import { loreRouter } from "./routers/lore"
import { tagRouter } from "./routers/tag"
import { materialRouter } from "./routers/material"
import { generateRouter } from "./routers/generate"
import { ragRouter } from "./routers/rag"
import { annotationRouter } from "./routers/annotation"
import { tropeRouter } from "./routers/trope"
import { agentRouter } from "./routers/agent"
import { auditRouter } from "./routers/audit"
import { readingProgressRouter } from "./routers/reading-progress"

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  novel: novelRouter,
  chapter: chapterRouter,
  translate: translateRouter,
  lore: loreRouter,
  tag: tagRouter,
  material: materialRouter,
  generate: generateRouter,
  rag: ragRouter,
  annotation: annotationRouter,
  trope: tropeRouter,
  agent: agentRouter,
  audit: auditRouter,
  readingProgress: readingProgressRouter,
})

export type AppRouter = typeof appRouter
