use rusqlite::{Connection, Result};
use std::path::PathBuf;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_path = Self::db_path();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&db_path)?;
        let db = Database { conn };
        db.initialize()?;
        Ok(db)
    }

    pub fn db_path() -> PathBuf {
        let base = dirs_next().unwrap_or_else(|| PathBuf::from("."));
        base.join(".daily-summary").join("data.db")
    }

    fn initialize(&self) -> Result<()> {
        // ── schema version tracker ──
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);"
        )?;
        let current: i64 = self.conn
            .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| r.get(0))
            .unwrap_or(0);

        // ── v1: base tables ──
        if current < 1 {
            self.conn.execute_batch(
                "
            CREATE TABLE IF NOT EXISTS articles (
                id          TEXT PRIMARY KEY,
                date        TEXT NOT NULL,
                title       TEXT DEFAULT '',
                content     TEXT DEFAULT '',
                mood        TEXT DEFAULT '',
                tags        TEXT DEFAULT '[]',
                word_count  INTEGER DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS article_duplicate_backups (
                id          TEXT PRIMARY KEY,
                date        TEXT NOT NULL,
                title       TEXT DEFAULT '',
                content     TEXT DEFAULT '',
                mood        TEXT DEFAULT '',
                tags        TEXT DEFAULT '[]',
                word_count  INTEGER DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                backed_up_at TEXT NOT NULL
            );

            INSERT OR IGNORE INTO article_duplicate_backups
                (id, date, title, content, mood, tags, word_count, created_at, updated_at, backed_up_at)
            SELECT
                a.id, a.date, a.title, a.content, a.mood, a.tags, a.word_count, a.created_at, a.updated_at, datetime('now')
            FROM articles a
            WHERE EXISTS (
                SELECT 1 FROM articles newer
                WHERE newer.date = a.date
                  AND (
                    newer.updated_at > a.updated_at
                    OR (newer.updated_at = a.updated_at AND newer.created_at > a.created_at)
                    OR (newer.updated_at = a.updated_at AND newer.created_at = a.created_at AND newer.id > a.id)
                  )
            );

            DELETE FROM articles
            WHERE EXISTS (
                SELECT 1 FROM articles newer
                WHERE newer.date = articles.date
                  AND (
                    newer.updated_at > articles.updated_at
                    OR (newer.updated_at = articles.updated_at AND newer.created_at > articles.created_at)
                    OR (newer.updated_at = articles.updated_at AND newer.created_at = articles.created_at AND newer.id > articles.id)
                  )
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_date_unique ON articles(date);

            CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
                title,
                content,
                content='articles',
                content_rowid='rowid'
            );

            -- Triggers to keep FTS in sync
            CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
                INSERT INTO articles_fts(rowid, title, content)
                VALUES (new.rowid, new.title, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
                INSERT INTO articles_fts(articles_fts, rowid, title, content)
                VALUES ('delete', old.rowid, old.title, old.content);
            END;

            CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
                INSERT INTO articles_fts(articles_fts, rowid, title, content)
                VALUES ('delete', old.rowid, old.title, old.content);
                INSERT INTO articles_fts(rowid, title, content)
                VALUES (new.rowid, new.title, new.content);
            END;

            CREATE TABLE IF NOT EXISTS prompts (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                template    TEXT NOT NULL,
                is_default  INTEGER DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS day_exemptions (
                date        TEXT PRIMARY KEY,
                reason      TEXT NOT NULL,
                note        TEXT DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reviews (
                id                 TEXT PRIMARY KEY,
                kind               TEXT NOT NULL CHECK(kind IN ('weekly', 'monthly')),
                period_start       TEXT NOT NULL,
                period_end         TEXT NOT NULL,
                version            INTEGER NOT NULL,
                status             TEXT NOT NULL CHECK(status IN ('draft', 'confirmed')),
                title              TEXT NOT NULL,
                content            TEXT NOT NULL,
                source_article_ids TEXT DEFAULT '[]',
                source_review_ids  TEXT DEFAULT '[]',
                model              TEXT DEFAULT '',
                generated_at       TEXT NOT NULL,
                updated_at         TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_reviews_period
                ON reviews(kind, period_start, period_end, version DESC);
            ",
            )?;
            self.conn.execute("INSERT INTO schema_version (version) VALUES (1)", [])?;
        }

        // ── v2: future migrations go here ──
        // if current < 2 {
        //     self.conn.execute_batch("ALTER TABLE articles ADD COLUMN ...")?;
        //     self.conn.execute("INSERT INTO schema_version (version) VALUES (2)", [])?;
        // }

        Ok(())
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }
}

/// Get the platform-specific data directory
fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| PathBuf::from(h).join(".local").join("share"))
            })
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA").ok().map(PathBuf::from)
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        dirs::data_dir()
    }
}
