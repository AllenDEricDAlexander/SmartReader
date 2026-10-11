CREATE TABLE research_library_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    data_json TEXT
);

INSERT INTO research_library_state (id, revision, data_json) VALUES (1, 0, NULL);

CREATE TABLE research_library_files (
    id TEXT PRIMARY KEY,
    bytes BLOB NOT NULL
);
