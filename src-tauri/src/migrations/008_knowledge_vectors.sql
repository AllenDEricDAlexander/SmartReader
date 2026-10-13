CREATE TABLE knowledge_vector_cache (
    paper_id TEXT NOT NULL,
    model_key TEXT NOT NULL,
    content_key TEXT NOT NULL,
    dimension INTEGER NOT NULL CHECK (dimension BETWEEN 1 AND 4096),
    chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 20000),
    vectors BLOB NOT NULL,
    PRIMARY KEY (paper_id, model_key, content_key)
);
