use crate::models::{ArchiveMonth, Article, ArticleSummary, DayExemption, KnowledgeCard, Review};
use chrono::{Local, NaiveDate};
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

    pub(crate) fn quick_check(&self) -> Result<String> {
        self.conn
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
    }

    pub(crate) fn verify_file(path: &std::path::Path) -> std::result::Result<(), String> {
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
                        source_review_id, source_date, source_excerpt, created_at, updated_at
                 FROM knowledge_cards ORDER BY updated_at ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    let tags: String = row.get(5)?;
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
            tx.execute(
                "INSERT OR REPLACE INTO knowledge_cards
                 (id, card_type, status, title, content, tags, source_article_id,
                  source_review_id, source_date, source_excerpt, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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
                    card.updated_at
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
    pub(crate) fn list(&mut self) -> Result<Vec<KnowledgeCard>> {
        let mut statement = self.conn.prepare(
            "SELECT id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at
             FROM knowledge_cards ORDER BY updated_at DESC, created_at DESC",
        )?;
        let rows = statement
            .query_map([], row_to_knowledge_card)?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub(crate) fn find(&mut self, id: &str) -> Result<Option<KnowledgeCard>> {
        self.conn
            .query_row(
                "SELECT id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at FROM knowledge_cards WHERE id=?1",
                params![id],
                row_to_knowledge_card,
            )
            .optional()
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
             source_article_id=?6, source_review_id=?7, source_date=?8, source_excerpt=?9, updated_at=?10 WHERE id=?11",
            params![draft.card_type, draft.status, draft.title, draft.content, tags,
                draft.source_article_id, draft.source_review_id, draft.source_date, draft.source_excerpt, now, id],
        )? == 0 {
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
