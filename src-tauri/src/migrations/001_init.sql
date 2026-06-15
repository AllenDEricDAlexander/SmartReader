CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL UNIQUE,
    path TEXT,
    display_name TEXT NOT NULL,
    file_size INTEGER,
    modified_at TEXT,
    page_count INTEGER,
    last_opened_at TEXT NOT NULL,
    last_page INTEGER NOT NULL DEFAULT 1,
    progress REAL NOT NULL DEFAULT 0,
    missing INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    active_document_id INTEGER,
    sidebar_open INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(active_document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS session_tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    document_id INTEGER NOT NULL,
    tab_order INTEGER NOT NULL,
    page INTEGER NOT NULL DEFAULT 1,
    zoom REAL NOT NULL DEFAULT 1,
    history_json TEXT NOT NULL DEFAULT '{"currentPage":1,"backStack":[],"forwardStack":[]}',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
