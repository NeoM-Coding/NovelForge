# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**NovelForge** (also referred to as NovelCraft AI) is an AI-powered novel translation and fan-fiction creation platform. It is strictly single-user, private, desktop-web-first, and deployed on Alibaba Cloud ECS via Docker Compose.

All four implementation phases (0–3) are complete. The codebase contains a working React frontend, Hono + tRPC backend, PostgreSQL database with pgvector, and Docker deployment configuration. Design documents (frozen) live in `docs/prompt/` and `docs/ProjectGoal.md`.

**Active roadmap**: `docs/ROADMAP.md` contains the current iteration plan — RAG flywheel optimization (semantic chunking, source traceability, generated-content feedback loop, style auto-extraction). Agents should read it before starting new features.

## Design Documents (Frozen)

| File | Purpose |
|------|---------|
| `docs/ProjectGoal.md` | **Highest authority.** Product overview, functional modules, data architecture, success criteria, and out-of-scope boundaries. |
| `docs/prompt/prompt .md` | Orchestration document. Tech stack freeze list, data flows, API contracts, phase roadmap. |
| `docs/prompt/prompt-phase0-foundation.md` | Initialization steps: scaffolding, PostgreSQL schema, Tailwind theme, routing. |
| `docs/prompt/prompt-phase1-core.md` | Core features: upload/parse, translation pipeline, reader, lore library. |
| `docs/prompt/prompt-phase2-cocreate.md` | Co-creation studio: AI generation, RAG retrieval, parameter controls. |
| `docs/prompt/prompt-phase3-polish.md` | Visual polish: animations, Three.js shader, Docker Compose, ECS deployment. |

**Rule**: If implementation conflicts arise, `docs/ProjectGoal.md` takes precedence over all other documents.

## Tech Stack

### Frontend
- React 19 + TypeScript + Vite
- Tailwind CSS 3.4 + shadcn/ui primitives
- react-router v7 (BrowserRouter)
- tRPC client (@trpc/client + @trpc/react-query 11.x)
- Three.js + @react-three/fiber (homepage background only)
- Framer Motion + Lenis
- react-markdown + remark-gfm
- Fonts: Geist Mono (labels/code), Noto Serif SC (body), Playfair Display (English titles)

### Backend
- API Framework: Hono + tRPC 11 (`@trpc/server` fetch adapter)
- Dev server: `@hono/vite-dev-server` (entry: `api/boot.ts`)
- Production server: `@hono/node-server` (via `dist/boot.js`)
- ORM: Drizzle ORM (PostgreSQL dialect)
- Database: PostgreSQL 16 + pgvector extension
- DB Driver: `postgres-js` (not mysql2)
- AI: DeepSeek V4 API (`POST https://api.deepseek.com/v1/chat/completions`)
- Document Parsing: `pdf-parse` + `mammoth`
- Serialization: `superjson`

### DevOps
- Docker + Docker Compose
- Nginx reverse proxy + Let's Encrypt SSL
- Deployment: Alibaba Cloud ECS (single instance)

### Explicitly Excluded
Do **not** introduce: Redis/BullMQ, Socket.io, LangChain.js, Zustand/Redux/MobX, any auth/authorization libraries, any cloud storage (S3/OSS/COS), or local LLM deployment.

## Directory Structure

```
├── api/                    # Hono + tRPC backend
│   ├── boot.ts             # Hono app entry, mounts tRPC at /api/trpc
│   ├── router.ts           # Root router registering all sub-routers
│   ├── context.ts          # tRPC context builder (injects db)
│   ├── middleware.ts       # tRPC init + procedure helpers
│   ├── lib/env.ts          # Zod-validated env vars
│   ├── queries/connection.ts  # Drizzle + postgres-js singleton
│   ├── routers/            # novel, chapter, translate, generate, lore, rag, tag, material, annotation, upload
│   └── services/           # deepseek.ts, parser.ts, embedder.ts
├── contracts/              # Shared Zod schemas (imported from `@contracts`)
│   └── schemas.ts          # Request/input validation schemas
├── db/
│   ├── schema.ts           # PostgreSQL table definitions (pg-core)
│   ├── relations.ts        # Drizzle relations
│   └── migrations/         # Drizzle migration files
├── src/                    # React frontend
│   ├── main.tsx            # No StrictMode, BrowserRouter + TRPCProvider + Lenis
│   ├── App.tsx             # Route definitions
│   ├── index.css           # Dark theme CSS variables + custom animations
│   ├── pages/              # Home, Studio, Reader, LoreLibrary, NovelManager, MaterialPool
│   ├── sections/           # HeroBackground (Three.js shader)
│   ├── components/         # LiquidGlassCard, ShimmerText, Book3D, NavBar, Modal, Select
│   ├── providers/trpc.tsx  # tRPC + React Query setup
│   └── types/              # Manual type declarations (lucide-react, pdf-parse, three-jsx)
├── docker-compose.yml
├── Dockerfile
├── nginx.conf
├── vite.config.ts
├── drizzle.config.ts
├── tsconfig.json           # Frontend + shared (noEmit, includes src/api/contracts/db)
└── tsconfig.server.json    # Backend compilation only (outDir: ./dist)
```

## Common Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Vite dev server with Hono API hot-reload (port 3000) |
| `npm run check` | TypeScript type check (`tsc --noEmit`, must pass zero errors) |
| `npm run build` | Production build: type-check + Vite bundle frontend to `dist/public/` |
| `npm run db:push` | Push Drizzle schema to PostgreSQL (requires `db` container running) |
| `npm run db:generate` | Generate migration files |
| `npm run db:migrate` | Run migrations (production) |
| `npm run db:studio` | Launch Drizzle Studio (DB GUI) |
| `docker compose down && docker compose up -d --build` | Rebuild and restart all containers |

### Backend Compilation for Production

`npm run build` only produces the frontend bundle in `dist/public/`. The backend TypeScript (`api/`, `db/`, `contracts/`) must be compiled separately:

```bash
npx tsc -b tsconfig.server.json
```

This emits `dist/boot.js` and other compiled server files. The `Dockerfile` runs both `npm run build` (frontend) and the backend compilation.

## Environment Variables

Defined in `api/lib/env.ts` (Zod-validated at boot):

| Variable | Required | Default |
|----------|----------|---------|
| `DATABASE_URL` | Yes | — |
| `DEEPSEEK_API_KEY` | Yes | — |
| `DEEPSEEK_BASE_URL` | No | `https://api.deepseek.com` |
| `EMBEDDING_BASE_URL` | No | `https://api.openai.com/v1` |
| `EMBEDDING_API_KEY` | No | — |
| `EMBEDDING_MODEL` | No | `text-embedding-3-small` |
| `EMBEDDING_DIMENSION` | No | `1536` |

`DB_PASSWORD` is used by `docker-compose.yml` for the Postgres container but is not read by the app directly.

## API Routing Structure

`api/boot.ts` mounts routes as follows:

| Path | Handler | Notes |
|------|---------|-------|
| `/api/trpc/*` | tRPC fetch adapter | All tRPC mutations/queries |
| `/api/upload` | Hono upload router | File upload (multipart), separate from tRPC |
| `/api/health` | Health check | Returns `{ status: "ok" }` |
| `/*` | Static files | `dist/public/` in production |
| `/*` (fallback) | SPA index.html | React Router handles client-side routing |

`tRPC` routers registered in `api/router.ts`: `novel`, `chapter`, `translate`, `lore`, `tag`, `material`, `generate`, `rag`, `annotation`, `trope`.

**Note on upload**: `/api/upload` is a standalone Hono router (`api/routers/upload.ts`), mounted directly in `api/boot.ts` — it is **not** part of the tRPC router.

## Frontend Routes

Defined in `src/App.tsx`:

| Path | Page | Description |
|------|------|-------------|
| `/` | Home | Landing page with Three.js shader background |
| `/studio/:workId?` | Studio | Co-creation / fan-fiction generation |
| `/reader/:novelId` | Reader | Bilingual novel reader |
| `/lore` | LoreLibrary | Series, character cards, world bible, canon |
| `/library` | NovelManager | Novel upload, translation, management |
| `/materials` | MaterialPool | RAG material upload and indexing |

## Architecture Decisions

### Single-User, No Authentication
All APIs are public. No login, no JWT, no permission checks. The `users` table holds exactly one record.

### Desktop Web = Superset, Mobile = Subset
Desktop has all features (translation, AI generation, lore, material feeding, reader). Flutter mobile (not in this repo) has reader + translation + simplified material feeding only. Both share the same tRPC API and PostgreSQL database.

### Dark Theme Only
- Background: `#111827` (page), `#000000` (homepage)
- Text: `#FDFBF5` (cream)
- Accent: `#F59E0B` (amber)
- No theme toggle. No light mode.

### Database Schema Highlights
Key tables (defined in `db/schema.ts`):
- `novels` / `chapters`: source and translated content
- `character_cards` / `world_bibles` / `series_canon`: structured lore ("Iron Rules")
- `world_bibles.aspects`: **dynamic dimensions** `[{ id, name, content }]` — replaces rigid fixed fields
- `vector_chunks` / `translation_memory`: pgvector-backed RAG storage (1536-dim embeddings)
- `fan_fiction_works`: generated content with parameters
- `materials`: user-fed RAG corpus with indexing status

### Recently Added APIs

**`material` router:**
- `autoExtractLore({ materialId, seriesId? })` — one-click extract characters + worldBible from a material, auto-save to lore library with upsert/merge logic (no manual confirmation)
- `batchAutoExtract({ materialIds, seriesId })` — serially call `autoExtractLore` for multiple materials

**`lore` router:**
- `series.summary({ seriesId })` — returns aggregate counts: characterCount, worldBibleAspectCount, canonEventCount, tropeCount, materialCount

**`novel` router:**
- `importMaterials({ materialIds })` — batch import selected materials into novel manager as novels+chapters

**`generate` router:**
- `saveAsNovel({ workId })` — persist a `fanFictionWorks` record into `novels` + `chapters`
- `deleteWork({ id })` — remove a fan-fiction work from history

### RAG Pipeline (Hybrid Search)
Every retrieval query must execute both:
1. **Vector search** (`pgvector <=> query_embedding`) for semantic similarity
2. **Full-text search** (`tsvector @@ plainto_tsquery`) for exact keyword/proper noun matching
Results are merged and reranked before returning top-5.

### Translation Memory
- `translation_memory.embedding` is **pre-computed at ingest time** on `sourceText`.
- During translation: embed the current paragraph once, then query against pre-computed embeddings via pgvector index.

### AI Calling
- Direct `fetch` to DeepSeek API. No LangChain.
- Endpoint: `POST https://api.deepseek.com/v1/chat/completions`
- Model: `deepseek-chat` (V4)
- System prompts assembled server-side: lore injection + RAG results + user brief + `userPrompt` override (highest priority)

### Embedding Service
- Provider: DashScope (阿里云百炼) — `text-embedding-v4`
- Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- Dimension: 1536
- Used for: RAG chunk embedding, translation memory, novel style retrieval

## Critical Implementation Constraints

These constraints were discovered during implementation and must be respected:

### tRPC v11 Does Not Support Streaming Mutations
`tRPC v11` HTTP transport does **not** support `async function*` (async generators) in mutations. All streaming endpoints (`translate.start`, `generate.fanfiction`, etc.) were converted to regular async functions. The server still uses SSE to stream from DeepSeek, collects the full response, then returns it as a single JSON payload. The frontend simulates a typing effect with `setInterval`.

### Drizzle ORM + postgres-js Raw SQL
- `db.execute()` accepts **exactly one argument**: a `sql` tagged template from `drizzle-orm`.
- **Wrong**: `db.execute("SELECT ...", [params])`
- **Correct**: `db.execute(sql\`SELECT ... WHERE id = ${id}\`)`
- Result is directly iterable (no `.rows` property).

### Three.js JSX Types with react-jsx
`@react-three/fiber` declares `mesh`, `planeGeometry`, `shaderMaterial` via global JSX namespace extension, but this is **not picked up** when `tsconfig.json` uses `"jsx": "react-jsx"` (the default since React 18). The workaround lives in `src/types/three-jsx.d.ts` — it imports `"react"` and augments `React.JSX.IntrinsicElements` directly.

### `noUnusedLocals` / `noUnusedParameters`
`tsconfig.json` has both enabled. All imports must be used, and all callback parameters must be typed (no implicit `any`).

## Key Constraints

1. **docs/ProjectGoal.md is the highest authority.** Any conflict → follow docs/ProjectGoal.md.
2. **No new dependencies.** The tech stack is frozen.
3. **No StrictMode** in `main.tsx`.
4. **Port 3000** for dev server.
5. **Path aliases**: `@/` → `src/`, `@contracts/` → `contracts/`, `@db/` → `db/`, `db` → `db/`
6. **All tRPC calls** from frontend use `import { trpc } from '@/providers/trpc'`.
7. **All Zod schemas** defined in `contracts/` and imported from `@contracts`.
8. **No handwritten SQL.** All DB operations through Drizzle ORM.
9. **File storage:** local filesystem (volume-mounted). No cloud object storage.
10. **No real-time streaming infra.** Streamed AI responses handled via client polling or simulated typing.

## Known Code Traps

These are current bugs / limitations in the codebase that will bite you if you are not aware of them:

### `vectorChunks.metadata` lacks source traceability
`vector_chunks.metadata` currently only stores `{ indexedAt: string }`. There is **no** `sourceId`, `sourceTitle`, `chapterNumber`, or `chunkIndex`. The `searchSimilar` function does not return these fields either, so the RAG injection in `generate.ts` cannot tell the user *which* novel/chapter a chunk came from.

**Fix direction**: enrich `metadata` during `indexNovel` (see `docs/ROADMAP.md` P0-1).

### Full-text search uses `'simple'` config (Chinese-incompatible)
`generate.ts` line ~300 uses `to_tsvector('simple', content)`. The `simple` configuration splits text on whitespace only, which means **Chinese full-text search is effectively broken** — it cannot match individual Chinese words.

**Fix direction**: supplement with `pg_trgm` fuzzy matching (see `docs/ROADMAP.md` P0-3).

### `searchSimilar.materialFilter` is silently dead code
`embedder.ts` line ~80:
```typescript
materialFilter = sql`metadata->>'materialId' IN (${ids})`
```
This will **never match** because:
1. `metadata->>'materialId'` returns a JSON string value, not a Postgres integer
2. The `IN` clause is comparing strings against a comma-separated string literal, not a list
3. `indexNovel` stores chunks under `novelId`, not `materialId` anyway

**Workaround**: filter by `seriesId` and `novelId` instead.

### RAG chunking is too aggressive
`embedder.ts` uses a fixed 500-character sliding window with 100-character overlap. This cuts through dialogue, scenes, and character relationships. Retrieved chunks often lack enough context for the LLM to understand who is speaking or what is happening.

**Fix direction**: semantic chunking (scene/paragraph boundary aware) — see `docs/ROADMAP.md` P0-1.

## Adding a New tRPC Router

1. Create `api/routers/<name>.ts` using the boilerplate:
   ```ts
   import { z } from "zod"
   import { createRouter, publicQuery } from "../middleware"
   import { getDb } from "../queries/connection"

   export const nameRouter = createRouter({
     list: publicQuery.query(async () => { /* ... */ }),
     create: publicQuery.input(z.object({ /* ... */ })).mutation(async ({ input }) => { /* ... */ }),
   })
   ```
2. Register in `api/router.ts`.
3. Frontend access: `trpc.name.list.useQuery()`.

## Adding a New Database Table

1. Add table definition to `db/schema.ts` using `pgTable()`.
2. Add relations to `db/relations.ts` if needed.
3. Run `npm run db:push` (requires DB container running; uses `drizzle.config.ts` for connection).
4. No migration files needed for schema push in development. Use `db:generate` + `db:migrate` for production.

## Git Workflow & Commit Convention

### Branch Strategy
- `master` is main and must always be runnable.
- Phase branches: `phase/0-foundation`, `phase/1-core`, `phase/2-cocreate`, `phase/3-polish`.
- Feature branches: `feat/translation-pipeline`, `fix/drizzle-connection`, etc.

### Pre-Commit Checks
1. `npm run check` — zero TypeScript errors.
2. `npm run build` — production build succeeds.
3. No leftover `console.log` in production-facing code.

### Commit Message Format
```
<type>(<scope>): <subject>
```

| Type | Usage |
|------|-------|
| `init` | Project scaffolding, tooling setup |
| `feat` | New feature (translation, reader, lore, studio, etc.) |
| `fix` | Bug fix |
| `db` | Schema change, migration, relation update |
| `ui` | Styling, theme, component-only changes |
| `api` | Backend router, endpoint, or service change |
| `rag` | Vector search, embedding, or retrieval logic change |
| `docs` | Documentation or design doc update |
| `deploy` | Docker, Nginx, or ECS deployment config |

Examples:
- `feat(reader): add bilingual side-by-side reading mode`
- `db(schema): add vector index on translation_memory.embedding`
- `api(translate): implement DeepSeek streaming translation endpoint`
- `fix(ui): correct dark theme background on Reader page`

### Frozen Document Change Policy
`docs/ProjectGoal.md` and all `docs/prompt/*.md` files are **frozen**. If a change is absolutely necessary:
- Use commit type `docs`.
- Include "frozen-doc" in the subject and explain the reason.
- Do **not** mix frozen-doc updates with code changes in the same commit.

### Sensitive Files
- Never commit `.env`, API keys, database URLs, or credentials.
- `.gitignore` excludes: `node_modules/`, `dist/`, `.env`, `.env.*`, `*.local`.
