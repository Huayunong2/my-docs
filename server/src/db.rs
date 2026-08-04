use crate::models::{
    ArchiveMonth, Article, ArticleSummary, DailyReviewCount, DayExemption, KnowledgeCard, Review,
    ReviewHistoryEntry, ReviewStats, ReviewStatsResponse,
};
use chrono::{Duration, Local, NaiveDate};
use rusqlite::types::Type;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Result};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArticleDraft {
    pub(crate) date: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    pub(crate) tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArticleChanges {
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    pub(crate) tags: Vec<String>,
}

pub(crate) struct ArticlePersistence<'a> {
    conn: &'a mut Connection,
}

pub(crate) struct ExemptionPersistence<'a> {
    conn: &'a mut Connection,
}

pub(crate) struct PortableArchivePersistence<'a> {
    conn: &'a mut Connection,
}

pub(crate) struct ReviewPersistence<'a> {
    conn: &'a mut Connection,
}

pub(crate) struct KnowledgePersistence<'a> {
    conn: &'a mut Connection,
}

#[derive(Debug, Clone)]
pub(crate) struct ReviewDraft {
    pub(crate) kind: String,
    pub(crate) period_start: String,
    pub(crate) period_end: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) source_article_ids: Vec<String>,
    pub(crate) source_review_ids: Vec<String>,
    pub(crate) model: String,
}

#[derive(Debug, Clone)]
pub(crate) struct KnowledgeCardDraft {
    pub(crate) card_type: String,
    pub(crate) status: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) tags: Vec<String>,
    pub(crate) source_article_id: String,
    pub(crate) source_review_id: String,
    pub(crate) source_date: String,
    pub(crate) source_excerpt: String,
    pub(crate) related_ids: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ArchiveImportReport {
    pub(crate) imported_articles: usize,
    pub(crate) imported_reviews: usize,
    pub(crate) imported_knowledge_cards: usize,
}

#[derive(Debug)]
pub(crate) enum ArchiveImportError {
    Invalid(String),
    Json(serde_json::Error),
    Storage(rusqlite::Error),
}

impl fmt::Display for ArchiveImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
            Self::Json(error) => write!(formatter, "{error}"),
            Self::Storage(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for ArchiveImportError {}

impl From<serde_json::Error> for ArchiveImportError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<rusqlite::Error> for ArchiveImportError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error)
    }
}

#[derive(Debug, Deserialize)]
struct PortableArchiveInput {
    version: u32,
    #[serde(default)]
    articles: Vec<PortableArticle>,
    #[serde(default)]
    reviews: Vec<PortableReview>,
    #[serde(default)]
    knowledge_cards: Vec<PortableKnowledgeCard>,
}

#[derive(Debug, Deserialize)]
struct PortableArticle {
    id: String,
    date: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    mood: String,
    #[serde(default, deserialize_with = "deserialize_string_vec")]
    tags: Vec<String>,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct PortableReview {
    id: String,
    kind: String,
    period_start: String,
    period_end: String,
    #[serde(default = "default_version")]
    version: i64,
    #[serde(default = "default_draft")]
    status: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    content: String,
    #[serde(default, deserialize_with = "deserialize_string_vec")]
    source_article_ids: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_string_vec")]
    source_review_ids: Vec<String>,
    #[serde(default)]
    model: String,
    #[serde(default)]
    generated_at: String,
    #[serde(default)]
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct PortableKnowledgeCard {
    id: String,
    #[serde(default = "default_card_type")]
    card_type: String,
    #[serde(default = "default_draft")]
    status: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    content: String,
    #[serde(default, deserialize_with = "deserialize_string_vec")]
    tags: Vec<String>,
    #[serde(default)]
    source_article_id: String,
    #[serde(default)]
    source_review_id: String,
    #[serde(default)]
    source_date: String,
    #[serde(default)]
    source_excerpt: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default = "default_review_state")]
    review_state: String,
    #[serde(default)]
    review_interval_days: f64,
    #[serde(default = "default_review_ease")]
    review_ease: f64,
    #[serde(default)]
    review_count: i64,
    #[serde(default)]
    last_reviewed_at: String,
    #[serde(default)]
    next_review_at: String,
    #[serde(default)]
    usage_count: i64,
    #[serde(default)]
    last_used_at: String,
    #[serde(default, deserialize_with = "deserialize_string_vec")]
    related_ids: Vec<String>,
    #[serde(default)]
    stability: f64,
    #[serde(default)]
    difficulty: f64,
}

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

    #[cfg(test)]
    pub(crate) fn new_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Database { conn };
        db.initialize()?;
        Ok(db)
    }

    pub(crate) fn articles(&mut self) -> ArticlePersistence<'_> {
        ArticlePersistence {
            conn: &mut self.conn,
        }
    }

    pub(crate) fn exemptions(&mut self) -> ExemptionPersistence<'_> {
        ExemptionPersistence {
            conn: &mut self.conn,
        }
    }

    pub(crate) fn portable_archive(&mut self) -> PortableArchivePersistence<'_> {
        PortableArchivePersistence {
            conn: &mut self.conn,
        }
    }

    pub(crate) fn reviews(&mut self) -> ReviewPersistence<'_> {
        ReviewPersistence {
            conn: &mut self.conn,
        }
    }

    pub(crate) fn knowledge(&mut self) -> KnowledgePersistence<'_> {
        KnowledgePersistence {
            conn: &mut self.conn,
        }
    }

    pub(crate) fn snapshot_to(&mut self, path: &str) -> Result<()> {
        self.conn.execute("VACUUM INTO ?1", params![path])?;
        Ok(())
    }

    pub(crate) fn verify_file(path: &std::path::Path) -> std::result::Result<(), String> {
        // FTS5 participates in integrity_check through an internal write-style
        // validation command, so SQLite requires a read-write handle even though
        // this operation does not change application rows.
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|error| error.to_string())?;
        let integrity: String = conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if integrity != "ok" {
            return Err(format!("SQLite integrity check failed: {integrity}"));
        }
        let has_articles: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='articles')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !has_articles {
            return Err("Not a daily-summary database: articles table is missing".into());
        }
        Ok(())
    }

    pub fn db_path() -> PathBuf {
        let base = dirs_next().unwrap_or_else(|| PathBuf::from("."));
        base.join(".daily-summary").join("data.db")
    }

    fn initialize(&self) -> Result<()> {
        // ── schema version tracker ──
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);",
        )?;
        let current: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |r| r.get(0),
            )
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
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (1)", [])?;
        }

        if current < 2 {
            self.conn.execute_batch(
                "
            CREATE TABLE IF NOT EXISTS knowledge_cards (
                id                TEXT PRIMARY KEY,
                card_type         TEXT NOT NULL CHECK(card_type IN ('fact', 'method', 'concept', 'decision', 'case', 'quote', 'principle')),
                status            TEXT NOT NULL CHECK(status IN ('draft', 'confirmed', 'outdated')),
                title             TEXT NOT NULL,
                content           TEXT NOT NULL,
                tags              TEXT DEFAULT '[]',
                source_article_id TEXT DEFAULT '',
                source_review_id  TEXT DEFAULT '',
                source_date       TEXT DEFAULT '',
                created_at        TEXT NOT NULL,
                updated_at        TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_knowledge_cards_type_status
                ON knowledge_cards(card_type, status, updated_at DESC);

            CREATE INDEX IF NOT EXISTS idx_knowledge_cards_source
                ON knowledge_cards(source_date, source_article_id, source_review_id);
            ",
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (2)", [])?;
        }

        if current < 3 {
            self.conn.execute_batch(
                "
            ALTER TABLE knowledge_cards ADD COLUMN source_excerpt TEXT DEFAULT '';

            CREATE INDEX IF NOT EXISTS idx_knowledge_cards_status_updated
                ON knowledge_cards(status, updated_at DESC);
            ",
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (3)", [])?;
        }

        if current < 4 {
            // 复习调度 + 复用追踪字段。逐列检查以避免部分迁移后重复执行报错。
            let existing_columns: Vec<String> = self
                .conn
                .prepare("PRAGMA table_info(knowledge_cards)")?
                .query_map([], |row| row.get(1))?
                .collect::<Result<_>>()?;
            let mut pending = Vec::new();
            for (column, statement) in [
                (
                    "review_state",
                    "ALTER TABLE knowledge_cards ADD COLUMN review_state TEXT NOT NULL DEFAULT 'new'",
                ),
                (
                    "review_interval_days",
                    "ALTER TABLE knowledge_cards ADD COLUMN review_interval_days REAL NOT NULL DEFAULT 0",
                ),
                (
                    "review_ease",
                    "ALTER TABLE knowledge_cards ADD COLUMN review_ease REAL NOT NULL DEFAULT 2.5",
                ),
                (
                    "review_count",
                    "ALTER TABLE knowledge_cards ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0",
                ),
                (
                    "last_reviewed_at",
                    "ALTER TABLE knowledge_cards ADD COLUMN last_reviewed_at TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "next_review_at",
                    "ALTER TABLE knowledge_cards ADD COLUMN next_review_at TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "usage_count",
                    "ALTER TABLE knowledge_cards ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0",
                ),
                (
                    "last_used_at",
                    "ALTER TABLE knowledge_cards ADD COLUMN last_used_at TEXT NOT NULL DEFAULT ''",
                ),
            ] {
                if !existing_columns.iter().any(|existing| existing == column) {
                    pending.push(statement);
                }
            }
            if !pending.is_empty() {
                self.conn.execute_batch(&pending.join(";"))?;
            }
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (4)", [])?;
        }

        if current < 5 {
            // 复习历史日志（统计/趋势/间隔曲线的数据源）+ review_state 状态机回填
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS review_log (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    card_id        TEXT NOT NULL,
                    grade          TEXT NOT NULL,
                    interval_days  REAL NOT NULL,
                    ease           REAL NOT NULL,
                    next_review_at TEXT NOT NULL,
                    reviewed_at    TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_review_log_card
                    ON review_log(card_id, reviewed_at);
                CREATE INDEX IF NOT EXISTS idx_review_log_date
                    ON review_log(reviewed_at);

                -- 为已积累复习记录的卡回填状态机语义
                UPDATE knowledge_cards SET review_state = CASE
                    WHEN review_count > 0 AND review_interval_days >= 21 AND review_ease >= 2.5 THEN 'mature'
                    WHEN review_count > 0 THEN 'learning'
                    ELSE 'new'
                END;",
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (5)", [])?;
        }

        if current < 6 {
            // 卡片关联（双向链接）+ FSRS-5 记忆状态（stability/difficulty）
            self.conn.execute_batch(
                "ALTER TABLE knowledge_cards ADD COLUMN related_ids TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE knowledge_cards ADD COLUMN stability REAL NOT NULL DEFAULT 0;
                 ALTER TABLE knowledge_cards ADD COLUMN difficulty REAL NOT NULL DEFAULT 0;",
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (6)", [])?;
        }

        Ok(())
    }
}

impl ArticlePersistence<'_> {
    pub(crate) fn save(&mut self, draft: ArticleDraft) -> Result<Article> {
        let tags = normalize_tags(draft.tags);
        let tags_json = serde_json::to_string(&tags)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let word_count = draft.content.chars().filter(|c| !c.is_whitespace()).count() as i64;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let tx = self.conn.transaction()?;
        let existing_id = tx
            .query_row(
                "SELECT id FROM articles WHERE date=?1 LIMIT 1",
                params![draft.date],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        tx.execute(
            "INSERT INTO articles (id, date, title, content, mood, tags, word_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(date) DO UPDATE SET title=excluded.title, content=excluded.content,
               mood=excluded.mood, tags=excluded.tags, word_count=excluded.word_count,
               updated_at=excluded.updated_at",
            params![id, draft.date, draft.title, draft.content, draft.mood, tags_json, word_count, now],
        )?;
        tx.execute(
            "DELETE FROM day_exemptions WHERE date=?1",
            params![draft.date],
        )?;
        let saved = tx.query_row(
            "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at
             FROM articles WHERE date=?1",
            params![draft.date],
            row_to_article,
        )?;
        tx.commit()?;
        Ok(saved)
    }

    pub(crate) fn update(&mut self, id: &str, changes: ArticleChanges) -> Result<Option<Article>> {
        let tags = serde_json::to_string(&normalize_tags(changes.tags))
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let word_count = changes
            .content
            .chars()
            .filter(|c| !c.is_whitespace())
            .count() as i64;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let updated = self.conn.execute(
            "UPDATE articles SET title=?1, content=?2, mood=?3, tags=?4, word_count=?5,
             updated_at=?6 WHERE id=?7",
            params![
                changes.title,
                changes.content,
                changes.mood,
                tags,
                word_count,
                now,
                id
            ],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        self.find_by_id(id)
    }

    pub(crate) fn delete(&mut self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM articles WHERE id=?1", params![id])?
            > 0)
    }

    pub(crate) fn find_by_id(&mut self, id: &str) -> Result<Option<Article>> {
        self.conn
            .query_row(
                "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at
                 FROM articles WHERE id=?1",
                params![id],
                row_to_article,
            )
            .optional()
    }

    pub(crate) fn find_by_date(&mut self, date: &str) -> Result<Option<Article>> {
        self.conn
            .query_row(
                "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at
                 FROM articles WHERE date=?1 LIMIT 1",
                params![date],
                row_to_article,
            )
            .optional()
    }

    pub(crate) fn list(&mut self, page: i64, page_size: i64) -> Result<Vec<ArticleSummary>> {
        let offset = (page.max(1) - 1) * page_size;
        let mut statement = self.conn.prepare(
            "SELECT id, date, title, mood, tags, word_count, content FROM articles
             ORDER BY date DESC, updated_at DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = statement
            .query_map(params![page_size, offset], row_to_article_summary)?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub(crate) fn search(&mut self, query: &str) -> Result<Vec<ArticleSummary>> {
        let sanitized = query
            .chars()
            .filter(|character| {
                character.is_alphanumeric()
                    || character.is_whitespace()
                    || matches!(character, '_' | '-')
            })
            .collect::<String>()
            .trim()
            .to_string();
        if sanitized.is_empty() {
            return Ok(Vec::new());
        }
        let mut statement = self.conn.prepare(
            "SELECT a.id, a.date, a.title, a.mood, a.tags, a.word_count, a.content
             FROM articles a INNER JOIN articles_fts fts ON a.rowid = fts.rowid
             WHERE articles_fts MATCH ?1 ORDER BY a.date DESC LIMIT 50",
        )?;
        let rows = statement
            .query_map(params![sanitized], row_to_article_summary)?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub(crate) fn full_between(&mut self, from: &str, to: &str) -> Result<Vec<Article>> {
        let mut statement = self.conn.prepare(
            "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at
             FROM articles WHERE date BETWEEN ?1 AND ?2 ORDER BY date ASC",
        )?;
        let rows = statement
            .query_map(params![from, to], row_to_article)?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub(crate) fn by_ids(&mut self, ids: &[String]) -> Result<Vec<Article>> {
        let mut articles = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(article) = self.find_by_id(id)? {
                articles.push(article);
            }
        }
        Ok(articles)
    }

    pub(crate) fn archive_months(&mut self) -> Result<Vec<ArchiveMonth>> {
        let mut statement = self.conn.prepare(
            "SELECT DISTINCT substr(date, 1, 4), substr(date, 6, 2)
             FROM articles ORDER BY date DESC",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok(ArchiveMonth {
                    year: row.get::<_, String>(0)?.parse().unwrap_or_default(),
                    month: row.get::<_, String>(1)?.parse().unwrap_or_default(),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub(crate) fn summaries_by_month(
        &mut self,
        year: i32,
        month: u32,
    ) -> Result<Vec<ArticleSummary>> {
        let pattern = format!("{year:04}-{month:02}%");
        let mut statement = self.conn.prepare(
            "SELECT id, date, title, mood, tags, word_count, content FROM articles
             WHERE date LIKE ?1 ORDER BY date DESC",
        )?;
        let rows = statement
            .query_map(params![pattern], row_to_article_summary)?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }
}

impl ExemptionPersistence<'_> {
    pub(crate) fn upsert(&mut self, date: &str, reason: &str, note: &str) -> Result<()> {
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        self.conn.execute(
            "INSERT INTO day_exemptions (date, reason, note, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(date) DO UPDATE SET reason=excluded.reason, note=excluded.note,
               updated_at=excluded.updated_at",
            params![date, reason, note, now],
        )?;
        Ok(())
    }

    pub(crate) fn get(&mut self, date: &str) -> Result<Option<DayExemption>> {
        self.conn
            .query_row(
                "SELECT date, reason, note, created_at, updated_at FROM day_exemptions WHERE date=?1",
                params![date],
                row_to_exemption,
            )
            .optional()
    }

    pub(crate) fn list(&mut self, from: &str, to: &str) -> Result<BTreeMap<String, DayExemption>> {
        let mut statement = self.conn.prepare(
            "SELECT date, reason, note, created_at, updated_at FROM day_exemptions
             WHERE date BETWEEN ?1 AND ?2 ORDER BY date ASC",
        )?;
        let rows = statement.query_map(params![from, to], row_to_exemption)?;
        let mut exemptions = BTreeMap::new();
        for row in rows {
            let exemption = row?;
            exemptions.insert(exemption.date.clone(), exemption);
        }
        Ok(exemptions)
    }

    pub(crate) fn set(
        &mut self,
        date: &str,
        reason: &str,
        note: &str,
    ) -> Result<Option<DayExemption>> {
        let article_exists = self
            .conn
            .query_row(
                "SELECT 1 FROM articles WHERE date=?1 LIMIT 1",
                params![date],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if article_exists {
            return Ok(None);
        }
        self.upsert(date, reason, note)?;
        self.get(date)
    }

    pub(crate) fn delete(&mut self, date: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM day_exemptions WHERE date=?1", params![date])?
            > 0)
    }
}

impl PortableArchivePersistence<'_> {
    pub(crate) fn export_json(&mut self) -> std::result::Result<Value, ArchiveImportError> {
        let articles = {
            let mut statement = self.conn.prepare(
                "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at
                 FROM articles ORDER BY date ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    let tags: String = row.get(5)?;
                    Ok(serde_json::json!({
                        "id": row.get::<_, String>(0)?,
                        "date": row.get::<_, String>(1)?,
                        "title": row.get::<_, String>(2)?,
                        "content": row.get::<_, String>(3)?,
                        "mood": row.get::<_, String>(4)?,
                        "tags": parse_json_vec(&tags)?,
                        "word_count": row.get::<_, i64>(6)?,
                        "created_at": row.get::<_, String>(7)?,
                        "updated_at": row.get::<_, String>(8)?,
                    }))
                })?
                .collect::<Result<Vec<_>>>()?;
            rows
        };
        let reviews = {
            let mut statement = self.conn.prepare(
                "SELECT id, kind, period_start, period_end, version, status, title, content,
                        source_article_ids, source_review_ids, model, generated_at, updated_at
                 FROM reviews ORDER BY period_start ASC, version ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    let article_ids: String = row.get(8)?;
                    let review_ids: String = row.get(9)?;
                    Ok(serde_json::json!({
                        "id": row.get::<_, String>(0)?,
                        "kind": row.get::<_, String>(1)?,
                        "period_start": row.get::<_, String>(2)?,
                        "period_end": row.get::<_, String>(3)?,
                        "version": row.get::<_, i64>(4)?,
                        "status": row.get::<_, String>(5)?,
                        "title": row.get::<_, String>(6)?,
                        "content": row.get::<_, String>(7)?,
                        "source_article_ids": parse_json_vec(&article_ids)?,
                        "source_review_ids": parse_json_vec(&review_ids)?,
                        "model": row.get::<_, String>(10)?,
                        "generated_at": row.get::<_, String>(11)?,
                        "updated_at": row.get::<_, String>(12)?,
                    }))
                })?
                .collect::<Result<Vec<_>>>()?;
            rows
        };
        let knowledge_cards = {
            let mut statement = self.conn.prepare(
                "SELECT id, card_type, status, title, content, tags, source_article_id,
                        source_review_id, source_date, source_excerpt, created_at, updated_at,
                        review_state, review_interval_days, review_ease, review_count,
                        last_reviewed_at, next_review_at, usage_count, last_used_at,
                        related_ids, stability, difficulty
                 FROM knowledge_cards ORDER BY updated_at ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    let tags: String = row.get(5)?;
                    let related_ids: String = row.get(20)?;
                    Ok(serde_json::json!({
                        "id": row.get::<_, String>(0)?,
                        "card_type": row.get::<_, String>(1)?,
                        "status": row.get::<_, String>(2)?,
                        "title": row.get::<_, String>(3)?,
                        "content": row.get::<_, String>(4)?,
                        "tags": parse_json_vec(&tags)?,
                        "source_article_id": row.get::<_, String>(6)?,
                        "source_review_id": row.get::<_, String>(7)?,
                        "source_date": row.get::<_, String>(8)?,
                        "source_excerpt": row.get::<_, String>(9)?,
                        "created_at": row.get::<_, String>(10)?,
                        "updated_at": row.get::<_, String>(11)?,
                        "review_state": row.get::<_, String>(12)?,
                        "review_interval_days": row.get::<_, f64>(13)?,
                        "review_ease": row.get::<_, f64>(14)?,
                        "review_count": row.get::<_, i64>(15)?,
                        "last_reviewed_at": row.get::<_, String>(16)?,
                        "next_review_at": row.get::<_, String>(17)?,
                        "usage_count": row.get::<_, i64>(18)?,
                        "last_used_at": row.get::<_, String>(19)?,
                        "related_ids": parse_json_vec(&related_ids)?,
                        "stability": row.get::<_, f64>(21)?,
                        "difficulty": row.get::<_, f64>(22)?,
                    }))
                })?
                .collect::<Result<Vec<_>>>()?;
            rows
        };
        Ok(serde_json::json!({
            "version": 2,
            "articles": articles,
            "reviews": reviews,
            "knowledge_cards": knowledge_cards,
        }))
    }

    pub(crate) fn import_json(
        &mut self,
        value: Value,
    ) -> std::result::Result<ArchiveImportReport, ArchiveImportError> {
        let archive: PortableArchiveInput = serde_json::from_value(value)?;
        validate_archive(&archive)?;
        let report = ArchiveImportReport {
            imported_articles: archive.articles.len(),
            imported_reviews: archive.reviews.len(),
            imported_knowledge_cards: archive.knowledge_cards.len(),
        };
        let tx = self.conn.transaction()?;

        for article in archive.articles {
            let tags = serde_json::to_string(&normalize_tags(article.tags))?;
            let word_count = article
                .content
                .chars()
                .filter(|c| !c.is_whitespace())
                .count() as i64;
            tx.execute(
                "INSERT OR REPLACE INTO articles
                 (id, date, title, content, mood, tags, word_count, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    article.id,
                    article.date,
                    article.title,
                    article.content,
                    article.mood,
                    tags,
                    word_count,
                    article.created_at,
                    article.updated_at
                ],
            )?;
            tx.execute(
                "DELETE FROM day_exemptions WHERE date=?1",
                params![article.date],
            )?;
        }

        for review in archive.reviews {
            let article_ids = serde_json::to_string(&review.source_article_ids)?;
            let review_ids = serde_json::to_string(&review.source_review_ids)?;
            tx.execute(
                "INSERT OR REPLACE INTO reviews
                 (id, kind, period_start, period_end, version, status, title, content,
                  source_article_ids, source_review_ids, model, generated_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    review.id,
                    review.kind,
                    review.period_start,
                    review.period_end,
                    review.version,
                    review.status,
                    review.title,
                    review.content,
                    article_ids,
                    review_ids,
                    review.model,
                    review.generated_at,
                    review.updated_at
                ],
            )?;
        }

        for card in archive.knowledge_cards {
            let tags = serde_json::to_string(&normalize_tags(card.tags))?;
            // 复习/使用进度是本地积累数据：导入已存在的卡时保留本地值，
            // 只覆盖卡片内容字段（旧档案缺省字段不会清零已积累的进度）。
            tx.execute(
                "INSERT INTO knowledge_cards
                 (id, card_type, status, title, content, tags, source_article_id,
                  source_review_id, source_date, source_excerpt, created_at, updated_at,
                  review_state, review_interval_days, review_ease, review_count,
                  last_reviewed_at, next_review_at, usage_count, last_used_at,
                  related_ids, stability, difficulty)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                         ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
                 ON CONFLICT(id) DO UPDATE SET
                   card_type=excluded.card_type, status=excluded.status,
                   title=excluded.title, content=excluded.content, tags=excluded.tags,
                   source_article_id=excluded.source_article_id,
                   source_review_id=excluded.source_review_id,
                   source_date=excluded.source_date,
                   source_excerpt=excluded.source_excerpt,
                   related_ids=excluded.related_ids,
                   created_at=excluded.created_at, updated_at=excluded.updated_at",
                params![
                    card.id,
                    card.card_type,
                    card.status,
                    card.title,
                    card.content,
                    tags,
                    card.source_article_id,
                    card.source_review_id,
                    card.source_date,
                    card.source_excerpt,
                    card.created_at,
                    card.updated_at,
                    card.review_state,
                    card.review_interval_days,
                    card.review_ease,
                    card.review_count,
                    card.last_reviewed_at,
                    card.next_review_at,
                    card.usage_count,
                    card.last_used_at,
                    serialize_string_vec(&card.related_ids)?,
                    // stability/difficulty 属于本地记忆状态，导入已有卡时保留本地值
                    card.stability,
                    card.difficulty
                ],
            )?;
        }

        tx.commit()?;
        Ok(report)
    }
}

impl ReviewPersistence<'_> {
    pub(crate) fn list(
        &mut self,
        kind: Option<&str>,
        period: Option<(&str, &str)>,
    ) -> Result<Vec<Review>> {
        let select = "SELECT id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at FROM reviews";
        let rows = match (kind, period) {
            (Some(kind), Some((from, to))) => {
                let mut statement = self.conn.prepare(&format!(
                    "{select} WHERE kind=?1 AND period_start=?2 AND period_end=?3 ORDER BY version DESC, updated_at DESC"
                ))?;
                let rows = statement
                    .query_map(params![kind, from, to], row_to_review)?
                    .collect::<Result<Vec<_>>>()?;
                rows
            }
            (Some(kind), None) => {
                let mut statement = self.conn.prepare(&format!(
                    "{select} WHERE kind=?1 ORDER BY period_start DESC, period_end DESC, version DESC"
                ))?;
                let rows = statement
                    .query_map(params![kind], row_to_review)?
                    .collect::<Result<Vec<_>>>()?;
                rows
            }
            (None, None) => {
                let mut statement = self.conn.prepare(&format!(
                    "{select} ORDER BY period_start DESC, period_end DESC, kind ASC, version DESC"
                ))?;
                let rows = statement
                    .query_map([], row_to_review)?
                    .collect::<Result<Vec<_>>>()?;
                rows
            }
            (None, Some(_)) => Vec::new(),
        };
        Ok(rows)
    }

    pub(crate) fn confirmed_weekly_overlapping(
        &mut self,
        from: &str,
        to: &str,
    ) -> Result<Vec<Review>> {
        let mut statement = self.conn.prepare(
            "SELECT id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at
             FROM reviews WHERE kind='weekly' AND status='confirmed' AND period_start <= ?2
             AND period_end >= ?1 ORDER BY period_start ASC, version DESC",
        )?;
        let rows = statement
            .query_map(params![from, to], row_to_review)?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub(crate) fn find(&mut self, id: &str) -> Result<Option<Review>> {
        self.conn
            .query_row(
                "SELECT id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at FROM reviews WHERE id=?1",
                params![id],
                row_to_review,
            )
            .optional()
    }

    pub(crate) fn save(&mut self, draft: ReviewDraft) -> Result<Review> {
        let id = Uuid::new_v4().to_string();
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let article_ids = serialize_string_vec(&draft.source_article_ids)?;
        let review_ids = serialize_string_vec(&draft.source_review_ids)?;
        let transaction = self.conn.transaction()?;
        let version = transaction.query_row(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM reviews WHERE kind=?1 AND period_start=?2 AND period_end=?3",
            params![draft.kind, draft.period_start, draft.period_end],
            |row| row.get::<_, i64>(0),
        )?;
        transaction.execute(
            "INSERT INTO reviews (id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![id, draft.kind, draft.period_start, draft.period_end, version, draft.title,
                draft.content, article_ids, review_ids, draft.model, now],
        )?;
        transaction.commit()?;
        self.find(&id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub(crate) fn update(
        &mut self,
        id: &str,
        title: &str,
        content: &str,
        status: &str,
    ) -> Result<Option<Review>> {
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        if self.conn.execute(
            "UPDATE reviews SET title=?1, content=?2, status=?3, updated_at=?4 WHERE id=?5",
            params![title, content, status, now, id],
        )? == 0
        {
            return Ok(None);
        }
        self.find(id)
    }

    pub(crate) fn delete(&mut self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM reviews WHERE id=?1", params![id])?
            > 0)
    }
}

impl KnowledgePersistence<'_> {
    const SELECT_COLUMNS: &'static str = "id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at, review_state, review_interval_days, review_ease, review_count, last_reviewed_at, next_review_at, usage_count, last_used_at, related_ids, stability, difficulty";
    /// 每日新卡上限：未评过分的确认卡每天最多进入复习队列这么多张（Anki 借鉴）。
    const NEW_DAILY_LIMIT: i64 = 20;

    pub(crate) fn list(&mut self) -> Result<Vec<KnowledgeCard>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT {} FROM knowledge_cards ORDER BY updated_at DESC, created_at DESC",
            Self::SELECT_COLUMNS
        ))?;
        let rows = statement
            .query_map([], row_to_knowledge_card)?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub(crate) fn find(&mut self, id: &str) -> Result<Option<KnowledgeCard>> {
        self.conn
            .query_row(
                &format!(
                    "SELECT {} FROM knowledge_cards WHERE id=?1",
                    Self::SELECT_COLUMNS
                ),
                params![id],
                row_to_knowledge_card,
            )
            .optional()
    }

    pub(crate) fn due(&mut self, limit: i64, today: &str) -> Result<Vec<KnowledgeCard>> {
        // 新卡（next_review_at 为空）受每日上限控制，避免一次确认大量卡片堆积复习队列；
        // 到期卡不受限。新卡在前、按创建顺序；到期卡按到期日。
        let mut statement = self.conn.prepare(&format!(
            "SELECT * FROM (
               SELECT {} FROM knowledge_cards
               WHERE status='confirmed' AND next_review_at=''
               ORDER BY created_at ASC LIMIT ?1
             )
             UNION ALL
             SELECT * FROM (
               SELECT {} FROM knowledge_cards
               WHERE status='confirmed' AND next_review_at!='' AND next_review_at <= ?2
               ORDER BY next_review_at ASC LIMIT ?3
             )
             LIMIT ?4",
            Self::SELECT_COLUMNS,
            Self::SELECT_COLUMNS
        ))?;
        let rows = statement
            .query_map(
                params![Self::NEW_DAILY_LIMIT, today, limit, limit],
                row_to_knowledge_card,
            )?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub(crate) fn stats(&mut self, today: &str) -> Result<ReviewStats> {
        Ok(self
            .conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM knowledge_cards
                     WHERE status='confirmed' AND (next_review_at='' OR next_review_at <= ?1)),
                    (SELECT COUNT(*) FROM knowledge_cards WHERE last_reviewed_at=?1),
                    (SELECT COUNT(*) FROM knowledge_cards WHERE status='confirmed')",
                params![today],
                |row| {
                    Ok(ReviewStats {
                        due: row.get(0)?,
                        reviewed_today: row.get(1)?,
                        total_confirmed: row.get(2)?,
                    })
                },
            )
            .optional()?
            .unwrap_or(ReviewStats {
                due: 0,
                reviewed_today: 0,
                total_confirmed: 0,
            }))
    }

    pub(crate) fn apply_grade(
        &mut self,
        id: &str,
        grade: &str,
        interval_days: f64,
        ease: f64,
        next_review_at: &str,
        today: &str,
    ) -> Result<Option<KnowledgeCard>> {
        let tx = self.conn.transaction()?;
        let updated = tx.execute(
            "UPDATE knowledge_cards SET review_interval_days=?1, review_ease=?2,
             review_count=review_count+1, last_reviewed_at=?3, next_review_at=?4,
             review_state = CASE
                WHEN ?1 >= 21 AND ?2 >= 2.5 THEN 'mature'
                ELSE 'learning'
             END
             WHERE id=?5 AND status='confirmed'",
            params![interval_days, ease, today, next_review_at, id],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        tx.execute(
            "INSERT INTO review_log (card_id, grade, interval_days, ease, next_review_at, reviewed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, grade, interval_days, ease, next_review_at, today],
        )?;
        tx.commit()?;
        self.find(id)
    }

    pub(crate) fn review_stats(&mut self, today: &str) -> Result<ReviewStatsResponse> {
        let today_date = NaiveDate::parse_from_str(today, "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(1970, 1, 1).expect("epoch date"));
        let reviewed_dates: Vec<String> = {
            let mut statement = self
                .conn
                .prepare("SELECT DISTINCT reviewed_at FROM review_log ORDER BY reviewed_at DESC")?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>>>()?;
            rows
        };
        let mut streak_days = 0i64;
        let mut cursor = today_date;
        if !reviewed_dates.iter().any(|date| date == today) {
            cursor -= Duration::days(1);
        }
        while reviewed_dates
            .iter()
            .any(|date| date == &cursor.format("%Y-%m-%d").to_string())
        {
            streak_days += 1;
            cursor -= Duration::days(1);
        }

        let start_date = today_date - Duration::days(29);
        let start_key = start_date.format("%Y-%m-%d").to_string();
        let mut counts: BTreeMap<String, i64> = {
            let mut statement = self.conn.prepare(
                "SELECT reviewed_at, COUNT(*) FROM review_log
                 WHERE reviewed_at >= ?1 GROUP BY reviewed_at",
            )?;
            let rows = statement
                .query_map(params![start_key], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })?
                .collect::<Result<BTreeMap<_, _>>>()?;
            rows
        };
        let mut daily = Vec::with_capacity(30);
        let mut cursor = start_date;
        while cursor <= today_date {
            let key = cursor.format("%Y-%m-%d").to_string();
            daily.push(DailyReviewCount {
                date: key.clone(),
                count: counts.remove(&key).unwrap_or(0),
            });
            cursor += Duration::days(1);
        }

        let (total_reviews, learning, mature) = self.conn.query_row(
            "SELECT
                COALESCE(SUM(review_count), 0),
                COALESCE(SUM(CASE WHEN review_state='learning' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN review_state='mature' THEN 1 ELSE 0 END), 0)
             FROM knowledge_cards",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )?;
        let reviewed_today: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_cards WHERE last_reviewed_at=?1",
                params![today],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let (due, total_confirmed) = self
            .conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM knowledge_cards
                     WHERE status='confirmed' AND (next_review_at='' OR next_review_at <= ?1)),
                    (SELECT COUNT(*) FROM knowledge_cards WHERE status='confirmed')",
                params![today],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .unwrap_or((0, 0));

        // 今天可学新卡：新卡队列受每日上限控制
        let new_queue: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_cards
                 WHERE status='confirmed' AND next_review_at=''",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let new_cards = new_queue.min(Self::NEW_DAILY_LIMIT);

        // 未来 7 天到期预览
        let mut upcoming = Vec::with_capacity(7);
        for offset in 1..=7 {
            let date = today_date + Duration::days(offset);
            let key = date.format("%Y-%m-%d").to_string();
            let count: i64 = self
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM knowledge_cards
                     WHERE status='confirmed' AND next_review_at=?1",
                    params![&key],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            upcoming.push(DailyReviewCount { date: key, count });
        }

        Ok(ReviewStatsResponse {
            total_reviews,
            streak_days,
            reviewed_today,
            due,
            total_confirmed,
            learning,
            mature,
            new_cards,
            upcoming,
            daily,
        })
    }

    /// 单张卡的复习历史（间隔曲线数据源）。
    pub(crate) fn review_history(&mut self, card_id: &str) -> Result<Vec<ReviewHistoryEntry>> {
        let mut statement = self.conn.prepare(
            "SELECT grade, interval_days, ease, next_review_at, reviewed_at
             FROM review_log WHERE card_id=?1 ORDER BY reviewed_at ASC, id ASC",
        )?;
        let rows = statement
            .query_map(params![card_id], |row| {
                Ok(ReviewHistoryEntry {
                    grade: row.get(0)?,
                    interval_days: row.get(1)?,
                    ease: row.get(2)?,
                    next_review_at: row.get(3)?,
                    reviewed_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// 近 days 天每日复习数（热力图数据源），缺日补零。
    pub(crate) fn review_heatmap(
        &mut self,
        days: i64,
        today: &str,
    ) -> Result<Vec<DailyReviewCount>> {
        let today_date = NaiveDate::parse_from_str(today, "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(1970, 1, 1).expect("epoch date"));
        let start_date = today_date - Duration::days(days - 1);
        let start_key = start_date.format("%Y-%m-%d").to_string();
        let mut counts: BTreeMap<String, i64> = {
            let mut statement = self.conn.prepare(
                "SELECT reviewed_at, COUNT(*) FROM review_log
                 WHERE reviewed_at >= ?1 GROUP BY reviewed_at",
            )?;
            let rows = statement
                .query_map(params![start_key], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })?
                .collect::<Result<BTreeMap<_, _>>>()?;
            rows
        };
        let mut result = Vec::with_capacity(days as usize);
        let mut cursor = start_date;
        let end = today_date;
        while cursor <= end {
            let key = cursor.format("%Y-%m-%d").to_string();
            result.push(DailyReviewCount {
                date: key.clone(),
                count: counts.remove(&key).unwrap_or(0),
            });
            cursor += Duration::days(1);
        }
        Ok(result)
    }

    pub(crate) fn touch(&mut self, id: &str, today: &str) -> Result<Option<KnowledgeCard>> {
        let updated = self.conn.execute(
            "UPDATE knowledge_cards SET usage_count=usage_count+1, last_used_at=?1 WHERE id=?2",
            params![today, id],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        self.find(id)
    }

    pub(crate) fn save(&mut self, draft: KnowledgeCardDraft) -> Result<KnowledgeCard> {
        self.save_many(vec![draft])?
            .into_iter()
            .next()
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub(crate) fn save_many(
        &mut self,
        drafts: Vec<KnowledgeCardDraft>,
    ) -> Result<Vec<KnowledgeCard>> {
        if drafts.iter().any(|draft| !valid_knowledge_draft(draft)) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let transaction = self.conn.transaction()?;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let mut ids = Vec::with_capacity(drafts.len());
        for draft in drafts {
            let id = Uuid::new_v4().to_string();
            let tags = serialize_string_vec(&normalize_tags(draft.tags))?;
            transaction.execute(
                "INSERT INTO knowledge_cards (id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                params![id, draft.card_type, draft.status, draft.title, draft.content, tags,
                    draft.source_article_id, draft.source_review_id, draft.source_date, draft.source_excerpt, now],
            )?;
            ids.push(id);
        }
        transaction.commit()?;
        ids.into_iter()
            .map(|id| self.find(&id)?.ok_or(rusqlite::Error::QueryReturnedNoRows))
            .collect()
    }

    pub(crate) fn update(
        &mut self,
        id: &str,
        draft: KnowledgeCardDraft,
    ) -> Result<Option<KnowledgeCard>> {
        let tags = serialize_string_vec(&normalize_tags(draft.tags))?;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        if self.conn.execute(
            "UPDATE knowledge_cards SET card_type=?1, status=?2, title=?3, content=?4, tags=?5,
             source_article_id=?6, source_review_id=?7, source_date=?8, source_excerpt=?9,
             related_ids=?10,
             next_review_at = CASE WHEN ?2 <> 'confirmed' THEN '' ELSE next_review_at END,
             updated_at=?11 WHERE id=?12",
            params![
                draft.card_type,
                draft.status,
                draft.title,
                draft.content,
                tags,
                draft.source_article_id,
                draft.source_review_id,
                draft.source_date,
                draft.source_excerpt,
                serialize_string_vec(&draft.related_ids)?,
                now,
                id
            ],
        )? == 0
        {
            return Ok(None);
        }
        self.find(id)
    }

    pub(crate) fn delete(&mut self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM knowledge_cards WHERE id=?1", params![id])?
            > 0)
    }
}

fn serialize_string_vec(values: &[String]) -> Result<String> {
    serde_json::to_string(values)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

fn valid_knowledge_draft(draft: &KnowledgeCardDraft) -> bool {
    matches!(draft.status.as_str(), "draft" | "confirmed" | "outdated")
        && matches!(
            draft.card_type.as_str(),
            "fact" | "method" | "concept" | "decision" | "case" | "quote" | "principle"
        )
        && !draft.title.trim().is_empty()
        && !draft.content.trim().is_empty()
}

fn validate_archive(archive: &PortableArchiveInput) -> std::result::Result<(), ArchiveImportError> {
    if !(1..=2).contains(&archive.version) {
        return Err(ArchiveImportError::Invalid(format!(
            "Unsupported portable archive version: {}",
            archive.version
        )));
    }
    let valid_date = |value: &str| NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok();
    if archive
        .articles
        .iter()
        .any(|article| article.id.trim().is_empty() || !valid_date(&article.date))
    {
        return Err(ArchiveImportError::Invalid(
            "Every article requires id and date".into(),
        ));
    }
    if archive.reviews.iter().any(|review| {
        review.id.trim().is_empty()
            || !matches!(review.kind.as_str(), "weekly" | "monthly")
            || !matches!(review.status.as_str(), "draft" | "confirmed")
            || review.version < 1
            || !valid_date(&review.period_start)
            || !valid_date(&review.period_end)
            || review.period_start > review.period_end
    }) {
        return Err(ArchiveImportError::Invalid(
            "Invalid review in portable archive".into(),
        ));
    }
    if archive.knowledge_cards.iter().any(|card| {
        card.id.trim().is_empty()
            || !matches!(card.status.as_str(), "draft" | "confirmed" | "outdated")
            || !matches!(
                card.card_type.as_str(),
                "fact" | "method" | "concept" | "decision" | "case" | "quote" | "principle"
            )
    }) {
        return Err(ArchiveImportError::Invalid(
            "Invalid knowledge card in portable archive".into(),
        ));
    }
    let mut article_ids = BTreeMap::new();
    let mut article_dates = BTreeMap::new();
    for article in &archive.articles {
        if article_ids.insert(&article.id, ()).is_some()
            || article_dates.insert(&article.date, ()).is_some()
        {
            return Err(ArchiveImportError::Invalid(
                "Duplicate article id or date in portable archive".into(),
            ));
        }
    }
    let mut review_ids = BTreeMap::new();
    if archive
        .reviews
        .iter()
        .any(|review| review_ids.insert(&review.id, ()).is_some())
    {
        return Err(ArchiveImportError::Invalid(
            "Duplicate review id in portable archive".into(),
        ));
    }
    let mut card_ids = BTreeMap::new();
    if archive
        .knowledge_cards
        .iter()
        .any(|card| card_ids.insert(&card.id, ()).is_some())
    {
        return Err(ArchiveImportError::Invalid(
            "Duplicate knowledge card id in portable archive".into(),
        ));
    }
    Ok(())
}

fn deserialize_string_vec<'de, D>(deserializer: D) -> std::result::Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringVec {
        Items(Vec<String>),
        Json(String),
    }
    match Option::<StringVec>::deserialize(deserializer)? {
        None => Ok(Vec::new()),
        Some(StringVec::Items(items)) => Ok(items),
        Some(StringVec::Json(raw)) => serde_json::from_str(&raw).map_err(serde::de::Error::custom),
    }
}

fn default_version() -> i64 {
    1
}

fn default_draft() -> String {
    "draft".into()
}

fn default_card_type() -> String {
    "fact".into()
}

fn default_review_ease() -> f64 {
    2.5
}

fn default_review_state() -> String {
    "new".into()
}

fn normalize_tags(values: Vec<String>) -> Vec<String> {
    let mut result = Vec::new();
    for value in values {
        let tag = value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(24)
            .collect::<String>();
        if !tag.is_empty() && !result.contains(&tag) {
            result.push(tag);
        }
        if result.len() == 12 {
            break;
        }
    }
    result
}

fn parse_json_vec(raw: &str) -> Result<Vec<String>> {
    serde_json::from_str(raw)
        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error)))
}

fn row_to_article(row: &rusqlite::Row<'_>) -> Result<Article> {
    let tags_json: String = row.get(5)?;
    let tags = parse_json_vec(&tags_json)?;
    Ok(Article {
        id: row.get(0)?,
        date: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        mood: row.get(4)?,
        tags,
        word_count: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn row_to_article_summary(row: &rusqlite::Row<'_>) -> Result<ArticleSummary> {
    let tags: String = row.get(4)?;
    let content: String = row.get(6)?;
    Ok(ArticleSummary {
        id: row.get(0)?,
        date: row.get(1)?,
        title: row.get(2)?,
        mood: row.get(3)?,
        tags: parse_json_vec(&tags)?,
        word_count: row.get(5)?,
        preview: article_preview(&content, 120),
    })
}

fn row_to_exemption(row: &rusqlite::Row<'_>) -> Result<DayExemption> {
    Ok(DayExemption {
        date: row.get(0)?,
        reason: row.get(1)?,
        note: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn row_to_review(row: &rusqlite::Row<'_>) -> Result<Review> {
    Ok(Review {
        id: row.get(0)?,
        kind: row.get(1)?,
        period_start: row.get(2)?,
        period_end: row.get(3)?,
        version: row.get(4)?,
        status: row.get(5)?,
        title: row.get(6)?,
        content: row.get(7)?,
        source_article_ids: parse_json_vec(&row.get::<_, String>(8)?)?,
        source_review_ids: parse_json_vec(&row.get::<_, String>(9)?)?,
        model: row.get(10)?,
        generated_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn row_to_knowledge_card(row: &rusqlite::Row<'_>) -> Result<KnowledgeCard> {
    Ok(KnowledgeCard {
        id: row.get(0)?,
        card_type: row.get(1)?,
        status: row.get(2)?,
        title: row.get(3)?,
        content: row.get(4)?,
        tags: parse_json_vec(&row.get::<_, String>(5)?)?,
        source_article_id: row.get(6)?,
        source_review_id: row.get(7)?,
        source_date: row.get(8)?,
        source_excerpt: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        review_state: row.get(12)?,
        review_interval_days: row.get(13)?,
        review_ease: row.get(14)?,
        review_count: row.get(15)?,
        last_reviewed_at: row.get(16)?,
        next_review_at: row.get(17)?,
        usage_count: row.get(18)?,
        last_used_at: row.get(19)?,
        related_ids: parse_json_vec(&row.get::<_, String>(20)?)?,
        stability: row.get(21)?,
        difficulty: row.get(22)?,
    })
}

fn article_preview(content: &str, max_len: usize) -> String {
    let plain = content
        .chars()
        .filter(|character| !matches!(character, '\n' | '\r'))
        .collect::<String>();
    if plain.chars().count() > max_len {
        format!("{}...", plain.chars().take(max_len).collect::<String>())
    } else if plain.is_empty() {
        "(空内容)".into()
    } else {
        plain
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

#[cfg(test)]
mod migration_tests {
    use super::*;

    fn v3_knowledge_cards_table() -> &'static str {
        "CREATE TABLE knowledge_cards (
            id                TEXT PRIMARY KEY,
            card_type         TEXT NOT NULL,
            status            TEXT NOT NULL,
            title             TEXT NOT NULL,
            content           TEXT NOT NULL,
            tags              TEXT DEFAULT '[]',
            source_article_id TEXT DEFAULT '',
            source_review_id  TEXT DEFAULT '',
            source_date       TEXT DEFAULT '',
            source_excerpt    TEXT DEFAULT '',
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL
        );"
    }

    #[test]
    fn v3_database_migrates_to_latest_preserving_existing_cards_with_defaults() {
        let conn = Connection::open_in_memory().expect("in-memory connection");
        conn.execute_batch(&format!(
            "CREATE TABLE schema_version (version INTEGER NOT NULL);
             {} 
             INSERT INTO schema_version (version) VALUES (3);",
            v3_knowledge_cards_table()
        ))
        .expect("create v3 schema");
        conn.execute(
            "INSERT INTO knowledge_cards (id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at)
             VALUES ('legacy-1', 'fact', 'confirmed', '旧卡', '内容', '[]', '', '', '2026-07-01', '片段', '2026-07-01T09:00:00', '2026-07-01T09:00:00')",
            [],
        )
        .expect("seed legacy card");

        let mut db = Database { conn };
        db.initialize().expect("migrate to v4");

        let card = db
            .knowledge()
            .find("legacy-1")
            .expect("find card")
            .expect("legacy card survives migration");
        assert_eq!(card.review_state, "new");
        assert_eq!(card.review_interval_days, 0.0);
        assert_eq!(card.review_ease, 2.5);
        assert_eq!(card.review_count, 0);
        assert_eq!(card.last_reviewed_at, "");
        assert_eq!(card.next_review_at, "");
        assert_eq!(card.usage_count, 0);
        assert_eq!(card.last_used_at, "");

        let version: i64 = db
            .conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .expect("read schema version");
        assert_eq!(version, 6);

        // 已迁移的库再次 initialize 必须幂等，不报重复列错误
        db.initialize().expect("re-initialize is idempotent");
    }

    #[test]
    fn fresh_database_reaches_latest_schema_with_review_columns() {
        let mut db = Database::new_in_memory().expect("in-memory database");
        let card = db
            .knowledge()
            .save(KnowledgeCardDraft {
                card_type: "fact".into(),
                status: "confirmed".into(),
                title: "新库".into(),
                content: "直接建到最新 schema".into(),
                tags: vec![],
                source_article_id: String::new(),
                source_review_id: String::new(),
                source_date: "2026-07-16".into(),
                source_excerpt: "evidence".into(),
                related_ids: vec![],
            })
            .expect("save card on fresh schema");
        assert_eq!(card.review_ease, 2.5);
        assert_eq!(card.review_state, "new");

        let version: i64 = db
            .conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .expect("read schema version");
        assert_eq!(version, 6);
    }
}

#[cfg(test)]
mod migration_v5_tests {
    use super::*;

    fn v4_knowledge_cards_table() -> &'static str {
        "CREATE TABLE knowledge_cards (
            id                    TEXT PRIMARY KEY,
            card_type             TEXT NOT NULL,
            status                TEXT NOT NULL,
            title                 TEXT NOT NULL,
            content               TEXT NOT NULL,
            tags                  TEXT DEFAULT '[]',
            source_article_id     TEXT DEFAULT '',
            source_review_id      TEXT DEFAULT '',
            source_date           TEXT DEFAULT '',
            source_excerpt        TEXT DEFAULT '',
            created_at            TEXT NOT NULL,
            updated_at            TEXT NOT NULL,
            review_state          TEXT NOT NULL DEFAULT 'new',
            review_interval_days  REAL NOT NULL DEFAULT 0,
            review_ease           REAL NOT NULL DEFAULT 2.5,
            review_count          INTEGER NOT NULL DEFAULT 0,
            last_reviewed_at      TEXT NOT NULL DEFAULT '',
            next_review_at        TEXT NOT NULL DEFAULT '',
            usage_count           INTEGER NOT NULL DEFAULT 0,
            last_used_at          TEXT NOT NULL DEFAULT ''
        );"
    }

    #[test]
    fn v4_database_migrates_to_v5_with_review_log_and_state_backfill() {
        let conn = Connection::open_in_memory().expect("in-memory connection");
        conn.execute_batch(&format!(
            "CREATE TABLE schema_version (version INTEGER NOT NULL);
             {} 
             INSERT INTO schema_version (version) VALUES (4);
             INSERT INTO knowledge_cards
               (id, card_type, status, title, content, tags, source_article_id, source_review_id,
                source_date, source_excerpt, created_at, updated_at, review_state,
                review_interval_days, review_ease, review_count, last_reviewed_at, next_review_at,
                usage_count, last_used_at)
             VALUES
               ('mature-1', 'method', 'confirmed', '已掌握', '内容', '[]', '', '', '2026-07-01', '',
                '2026-07-01T09:00:00', '2026-07-01T09:00:00', 'new', 30, 2.7, 5,
                '2026-08-01', '2026-08-31', 0, ''),
               ('learning-1', 'fact', 'confirmed', '学习中', '内容', '[]', '', '', '2026-07-02', '',
                '2026-07-02T09:00:00', '2026-07-02T09:00:00', 'new', 3, 2.5, 2,
                '2026-08-02', '2026-08-05', 0, ''),
               ('fresh-1', 'fact', 'draft', '新卡', '内容', '[]', '', '', '2026-07-03', '',
                '2026-07-03T09:00:00', '2026-07-03T09:00:00', 'new', 0, 2.5, 0,
                '', '', 0, '');",
            v4_knowledge_cards_table()
        ))
        .expect("create v4 schema");

        let mut db = Database { conn };
        db.initialize().expect("migrate to v5");

        // review_state 回填
        let states: Vec<(String, String)> = db
            .knowledge()
            .list()
            .expect("list cards")
            .into_iter()
            .map(|card| (card.id, card.review_state))
            .collect();
        let by_id = |id: &str| {
            states
                .iter()
                .find(|(key, _)| key == id)
                .map(|(_, s)| s.as_str())
                .unwrap_or("")
        };
        assert_eq!(by_id("mature-1"), "mature", "长间隔+高 ease 回填为 mature");
        assert_eq!(
            by_id("learning-1"),
            "learning",
            "已复习但间隔短回填为 learning"
        );
        assert_eq!(by_id("fresh-1"), "new", "未复习保持 new");

        // review_log 表可用
        let total: i64 = db
            .knowledge()
            .review_stats("2026-08-03")
            .expect("review stats")
            .total_reviews;
        assert_eq!(
            total, 7,
            "review_log 空表不干扰累计（累计来自 review_count）"
        );

        let version: i64 = db
            .conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .expect("read schema version");
        assert_eq!(version, 6);
        db.initialize()
            .expect("re-initialize after v5 is idempotent");
    }
}
