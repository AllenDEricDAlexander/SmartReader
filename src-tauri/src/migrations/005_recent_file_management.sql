ALTER TABLE documents ADD COLUMN recent_hidden_at TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_recent_hidden_at
ON documents(recent_hidden_at);

CREATE INDEX IF NOT EXISTS idx_documents_last_opened_at
ON documents(last_opened_at);
