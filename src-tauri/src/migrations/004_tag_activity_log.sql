CREATE TABLE IF NOT EXISTS tag_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id INTEGER,
    tag_name TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    target_label TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tag_activity_log_tag_id ON tag_activity_log(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_activity_log_created_at ON tag_activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_tag_activity_log_action ON tag_activity_log(action);
