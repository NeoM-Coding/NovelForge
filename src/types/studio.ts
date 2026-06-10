export type WritingMode = "canon_continuation" | "character_spinoff" | "original_in_universe" | "alternate_universe"

export interface GenParams {
  temperature: number
  styleFidelity: number
  characterLoyalty: number
  tone: string
  lengthTarget: "short" | "chapter" | "arc"
  canonConstraint: "strict" | "loose" | "au"
  writingMode: WritingMode
  ragLimit: number
}

export interface StudioDraft {
  version: 2
  savedAt: string
  selectedSeriesId: number | null
  selectedParentNovelId: number | null
  title: string
  brief: string
  userPrompt: string
  params: GenParams
  selectedCharacterIds: number[]
  selectedTropeIds: number[]
  selectedMaterialIds: number[]
  content: string
  generatedWorkId: number | null
  useOutlineMode: boolean
  outlineType: "overview" | "scenes" | "both"
  outlineOverview: string
  outlineScenes: Array<{ id: string; title: string; description: string }>
}

export interface ReviewScores {
  worldview: number
  character: number
  writing: number
  plot: number
}

export interface ReviewFinding {
  category: string
  severity: string
  location: string
  description: string
}

export interface ReviewResult {
  overallScore: number
  scores: ReviewScores
  findings: ReviewFinding[]
  strengths: string[]
  suggestions: string[]
}

export interface InspirationItem {
  title: string
  category: string
  description: string
  references: string[]
}

export interface SearchResultItem {
  title: string
  snippet: string
}

export interface InspireResult {
  inspirations: InspirationItem[]
  combinations: string[]
  trends: string[]
  warnings: string[]
  searchResults: SearchResultItem[]
}

export type InspireFocus = "plot" | "character" | "worldview" | "writing" | "full"

export interface RagCall {
  type: string
  content: string
  score?: number
  sourceTitle?: string
  chapterNumber?: number
  chunkIndex?: number
  totalChunks?: number
}

export interface GenProgress {
  step: number
  message: string
  detail?: string
  completed?: boolean
}

export interface GenerationError {
  type: "network" | "timeout" | "api_error" | "validation" | "cancelled" | "unknown"
  message: string
  retryable: boolean
  timestamp: number
}
