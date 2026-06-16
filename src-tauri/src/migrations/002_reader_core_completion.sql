ALTER TABLE documents ADD COLUMN last_error TEXT;
ALTER TABLE documents ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL,
    page INTEGER NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(document_key, page, title)
);

CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL,
    page INTEGER NOT NULL,
    type TEXT NOT NULL,
    color TEXT NOT NULL,
    text TEXT,
    quote TEXT,
    areas_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL UNIQUE,
    source_path TEXT NOT NULL,
    cache_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    modified_at TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS open_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    received_at TEXT NOT NULL,
    handled INTEGER NOT NULL DEFAULT 0
);
