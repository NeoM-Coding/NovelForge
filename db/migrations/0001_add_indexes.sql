-- db/migrations/0001_add_indexes.sql
-- 注意：生产环境大型表上建索引时，建议手动执行 CONCURRENTLY 版本：
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xxx ON ...
-- 本迁移文件使用普通 CREATE INDEX 以确保与 Drizzle 事务迁移兼容

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

-- pgvector HNSW 索引（translation_memory 向量相似性搜索）
CREATE INDEX IF NOT EXISTS idx_translation_memory_embedding_hnsw
  ON translation_memory USING hnsw (embedding vector_cosine_ops);

-- pg_trgm GIN 索引（加速中文模糊搜索）
CREATE INDEX IF NOT EXISTS idx_vector_chunks_trgm ON vector_chunks USING gin (content gin_trgm_ops);
