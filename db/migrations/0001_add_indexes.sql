-- db/migrations/0001_add_indexes.sql
-- pgvector HNSW 索引（向量相似性搜索）
CREATE INDEX IF NOT EXISTS idx_vector_chunks_embedding_hnsw
  ON vector_chunks USING hnsw (embedding vector_cosine_ops);

-- 设置 HNSW 搜索精度（连接级别，建议放在应用启动时执行）
-- 这里仅做记录，实际在应用连接后执行：SET hnsw.ef_search = 64;

-- btree 索引：高频过滤字段
CREATE INDEX IF NOT EXISTS idx_vector_chunks_series_id ON vector_chunks (series_id);
CREATE INDEX IF NOT EXISTS idx_vector_chunks_novel_id ON vector_chunks (novel_id);
CREATE INDEX IF NOT EXISTS idx_vector_chunks_source_type ON vector_chunks (source_type);

CREATE INDEX IF NOT EXISTS idx_fan_fiction_chapters_work_id ON fan_fiction_chapters (work_id);
CREATE INDEX IF NOT EXISTS idx_fan_fiction_chapters_status ON fan_fiction_chapters (status);

CREATE INDEX IF NOT EXISTS idx_fan_fiction_works_series_id ON fan_fiction_works (series_id);
CREATE INDEX IF NOT EXISTS idx_fan_fiction_works_status ON fan_fiction_works (status);

CREATE INDEX IF NOT EXISTS idx_rag_feedback_generation_id ON rag_feedback (generation_id);

CREATE INDEX IF NOT EXISTS idx_materials_series_id ON materials (series_id);
CREATE INDEX IF NOT EXISTS idx_materials_source_type ON materials (source_type);

CREATE INDEX IF NOT EXISTS idx_translation_memory_series_id ON translation_memory (series_id);
CREATE INDEX IF NOT EXISTS idx_translation_memory_novel_id ON translation_memory (novel_id);
