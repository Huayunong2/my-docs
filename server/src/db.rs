use crate::models::{
    AiConfig, AiRoutingConfig, AiTask, ArchiveMonth, Article, ArticleSummary, DailyReviewCount,
    DayExemption, KnowledgeCard, KnowledgeProject, KnowledgeSummary, Review, ReviewCard,
    ReviewHistoryEntry, ReviewItem, ReviewSettings, ReviewStats, ReviewStatsResponse,
};
use chrono::{Duration, Local, NaiveDate};
use rusqlite::types::{Type, Value as SqlValue};
use rusqlite::{
    params, params_from_iter, Connection, OpenFlags, OptionalExtension, Result, Transaction,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::PathBuf;
use uuid::Uuid;

type LegacyCardReviewFields = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    f64,
    f64,
    i64,
    String,
    String,
    String,
);

pub(crate) const DEFAULT_REVIEW_NEW_DAILY_LIMIT: i64 = 20;
pub(crate) const DEFAULT_REVIEW_SESSION_LIMIT: i64 = 20;
pub(crate) const MAX_KNOWLEDGE_CARD_TITLE_CHARS: usize = 160;
pub(crate) const MAX_KNOWLEDGE_CARD_CONTENT_CHARS: usize = 20_000;
const MAX_KNOWLEDGE_RELATED_ID_CHARS: usize = 128;
const MAX_KNOWLEDGE_RELATED_IDS: usize = 64;

const REVIEW_NEW_DAILY_LIMIT_KEY: &str = "review_new_daily_limit";
const REVIEW_SESSION_LIMIT_KEY: &str = "review_session_limit";

const DEFAULT_AI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL: &str = "gpt-4o-mini";
const DEFAULT_AI_TEMPERATURE: f32 = 0.2;
const DEFAULT_AI_MAX_TOKENS: u64 = 0;
const DEFAULT_AI_TIMEOUT_SECS: u64 = 45;
const DEFAULT_AI_RETRIES: u64 = 2;
const DEFAULT_AI_MIN_INTERVAL_MS: u64 = 1200;

const AI_API_KEY_KEY: &str = "ai_api_key";
const AI_BASE_URL_KEY: &str = "ai_base_url";
const AI_MODEL_KEY: &str = "ai_model";
const AI_TEMPERATURE_KEY: &str = "ai_temperature";
const AI_MAX_TOKENS_KEY: &str = "ai_max_tokens";
const AI_TIMEOUT_SECS_KEY: &str = "ai_timeout_secs";
const AI_RETRIES_KEY: &str = "ai_retries";
const AI_MIN_INTERVAL_MS_KEY: &str = "ai_min_interval_ms";
const AI_ROUTING_KEY: &str = "ai_routing";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArticleDraft {
    pub(crate) date: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    pub(crate) tags: Vec<String>,
    pub(crate) spaces: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArticleChanges {
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    /// `None` means the caller is using the legacy update shape and did not
    /// intend to change tags.
    pub(crate) tags: Option<Vec<String>>,
    /// `None` means the caller is using the legacy update shape and did not
    /// intend to change space membership.
    pub(crate) spaces: Option<Vec<String>>,
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

#[derive(Debug, Clone, Copy)]
pub(crate) struct KnowledgePageQuery<'a> {
    pub(crate) query: &'a str,
    pub(crate) card_type: Option<&'a str>,
    pub(crate) status: Option<&'a str>,
    pub(crate) usage: Option<&'a str>,
    pub(crate) tag: Option<&'a str>,
    pub(crate) project: Option<&'a str>,
    pub(crate) quality: Option<&'a str>,
    pub(crate) sort: &'a str,
    pub(crate) page: i64,
    pub(crate) page_size: i64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ReviewPageQuery<'a> {
    pub(crate) query: &'a str,
    pub(crate) kind: Option<&'a str>,
    pub(crate) status: Option<&'a str>,
    pub(crate) current_month: &'a str,
    pub(crate) page: i64,
    pub(crate) page_size: i64,
}

pub(crate) struct ReviewPageResult {
    pub(crate) reviews: Vec<Review>,
    pub(crate) total: i64,
    pub(crate) draft_count: i64,
    pub(crate) confirmed_count: i64,
    pub(crate) current_month_weekly_drafts: i64,
    pub(crate) latest_generated_at: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct GradeUpdate<'a> {
    pub(crate) id: &'a str,
    pub(crate) grade: &'a str,
    pub(crate) stability: f64,
    pub(crate) difficulty: f64,
    pub(crate) interval_days: f64,
    pub(crate) next_review_at: &'a str,
    pub(crate) today: &'a str,
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
    pub(crate) projects: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ReviewItemDraft {
    pub(crate) item_type: String,
    pub(crate) status: String,
    pub(crate) prompt: String,
    pub(crate) answer: String,
    pub(crate) hint: String,
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
    #[serde(default)]
    review_items: Vec<PortableReviewItem>,
    #[serde(default)]
    knowledge_projects: Vec<String>,
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
    #[serde(default, deserialize_with = "deserialize_string_vec")]
    spaces: Vec<String>,
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
    #[serde(default = "default_content_version")]
    content_version: i64,
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
    first_reviewed_at: String,
    #[serde(default, deserialize_with = "deserialize_string_vec")]
    projects: Vec<String>,
    /// 空字符串表示活动卡片；非空值表示仍可从回收站恢复的软删除时间。
    #[serde(default)]
    deleted_at: String,
}

#[derive(Debug, Deserialize)]
struct PortableReviewItem {
    id: String,
    knowledge_card_id: String,
    #[serde(default = "default_review_item_type")]
    item_type: String,
    #[serde(default = "default_review_item_status")]
    status: String,
    #[serde(default)]
    prompt: String,
    #[serde(default)]
    answer: String,
    #[serde(default)]
    hint: String,
    #[serde(default = "default_content_version")]
    source_version: i64,
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
    first_reviewed_at: String,
}

pub struct Database {
    conn: Connection,
}

fn read_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key=?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

fn read_setting_i64(conn: &Connection, key: &str, default: i64) -> Result<i64> {
    Ok(read_setting(conn, key)?
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(default))
}

fn read_setting_text(
    conn: &Connection,
    setting_key: &str,
    env_key: &str,
    default: &str,
) -> Result<String> {
    let value = read_setting(conn, setting_key)?
        .or_else(|| std::env::var(env_key).ok())
        .unwrap_or_else(|| default.to_string());
    let value = value.trim();
    Ok(if value.is_empty() {
        default.to_string()
    } else {
        value.to_string()
    })
}

fn read_setting_u64(
    conn: &Connection,
    setting_key: &str,
    env_key: &str,
    default: u64,
) -> Result<u64> {
    Ok(read_setting(conn, setting_key)?
        .or_else(|| std::env::var(env_key).ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default))
}

fn read_setting_f32(
    conn: &Connection,
    setting_key: &str,
    env_key: &str,
    default: f32,
) -> Result<f32> {
    Ok(read_setting(conn, setting_key)?
        .or_else(|| std::env::var(env_key).ok())
        .and_then(|value| value.trim().parse::<f32>().ok())
        .unwrap_or(default))
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

    pub(crate) fn review_settings(&self) -> Result<ReviewSettings> {
        Ok(ReviewSettings {
            new_cards_per_day: read_setting_i64(
                &self.conn,
                REVIEW_NEW_DAILY_LIMIT_KEY,
                DEFAULT_REVIEW_NEW_DAILY_LIMIT,
            )?
            .clamp(0, 100),
            session_limit: read_setting_i64(
                &self.conn,
                REVIEW_SESSION_LIMIT_KEY,
                DEFAULT_REVIEW_SESSION_LIMIT,
            )?
            .clamp(1, 100),
        })
    }

    pub(crate) fn ai_config(&self) -> Result<AiConfig> {
        let api_key = read_setting(&self.conn, AI_API_KEY_KEY)?
            .or_else(|| std::env::var("DAILY_SUMMARY_AI_API_KEY").ok())
            .unwrap_or_default()
            .trim()
            .to_string();
        Ok(AiConfig {
            api_key,
            base_url: read_setting_text(
                &self.conn,
                AI_BASE_URL_KEY,
                "DAILY_SUMMARY_AI_BASE_URL",
                DEFAULT_AI_BASE_URL,
            )?
            .trim_end_matches('/')
            .to_string(),
            model: read_setting_text(
                &self.conn,
                AI_MODEL_KEY,
                "DAILY_SUMMARY_AI_MODEL",
                DEFAULT_AI_MODEL,
            )?,
            temperature: read_setting_f32(
                &self.conn,
                AI_TEMPERATURE_KEY,
                "DAILY_SUMMARY_AI_TEMPERATURE",
                DEFAULT_AI_TEMPERATURE,
            )?,
            max_tokens: read_setting_u64(
                &self.conn,
                AI_MAX_TOKENS_KEY,
                "DAILY_SUMMARY_AI_MAX_TOKENS",
                DEFAULT_AI_MAX_TOKENS,
            )?,
            timeout_secs: read_setting_u64(
                &self.conn,
                AI_TIMEOUT_SECS_KEY,
                "DAILY_SUMMARY_AI_TIMEOUT_SECS",
                DEFAULT_AI_TIMEOUT_SECS,
            )?,
            retries: read_setting_u64(
                &self.conn,
                AI_RETRIES_KEY,
                "DAILY_SUMMARY_AI_RETRIES",
                DEFAULT_AI_RETRIES,
            )?,
            min_interval_ms: read_setting_u64(
                &self.conn,
                AI_MIN_INTERVAL_MS_KEY,
                "DAILY_SUMMARY_AI_MIN_INTERVAL_MS",
                DEFAULT_AI_MIN_INTERVAL_MS,
            )?,
        })
    }

    pub(crate) fn ai_routing(&self) -> Result<AiRoutingConfig> {
        let global = self.ai_config()?;
        let Some(value) = read_setting(&self.conn, AI_ROUTING_KEY)? else {
            return Ok(AiRoutingConfig::from_global(&global));
        };
        serde_json::from_str(&value).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error))
        })
    }

    pub(crate) fn ai_config_for_task(&self, task: AiTask) -> Result<(AiConfig, String)> {
        let global = self.ai_config()?;
        let routing = self.ai_routing()?;
        let requested_profile = routing
            .routes
            .get(task.key())
            .map(String::as_str)
            .unwrap_or(routing.fallback_profile.as_str());
        let profile = routing
            .profiles
            .iter()
            .find(|profile| profile.id == requested_profile)
            .or_else(|| {
                routing
                    .profiles
                    .iter()
                    .find(|profile| profile.id == routing.fallback_profile)
            })
            .or_else(|| routing.profiles.first())
            .ok_or(rusqlite::Error::InvalidQuery)?;
        let mut config = global;
        config.model = profile.model.clone();
        config.temperature = profile.temperature;
        config.max_tokens = profile.max_tokens;
        config.timeout_secs = profile.timeout_secs;
        config.retries = profile.retries;
        config.min_interval_ms = profile.min_interval_ms;
        Ok((config, profile.id.clone()))
    }

    pub(crate) fn update_ai_routing(
        &mut self,
        routing: &AiRoutingConfig,
    ) -> Result<AiRoutingConfig> {
        let value = serde_json::to_string(routing)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        self.conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![AI_ROUTING_KEY, value, now],
        )?;
        self.ai_routing()
    }

    pub(crate) fn ai_api_key_source(&self) -> Result<&'static str> {
        if read_setting(&self.conn, AI_API_KEY_KEY)?.is_some() {
            return Ok("settings");
        }
        if std::env::var("DAILY_SUMMARY_AI_API_KEY")
            .ok()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        {
            return Ok("environment");
        }
        Ok("none")
    }

    pub(crate) fn update_ai_config(
        &mut self,
        config: &AiConfig,
        update_api_key: bool,
    ) -> Result<AiConfig> {
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let tx = self.conn.transaction()?;
        let values = [
            (AI_BASE_URL_KEY, config.base_url.clone()),
            (AI_MODEL_KEY, config.model.clone()),
            (AI_TEMPERATURE_KEY, config.temperature.to_string()),
            (AI_MAX_TOKENS_KEY, config.max_tokens.to_string()),
            (AI_TIMEOUT_SECS_KEY, config.timeout_secs.to_string()),
            (AI_RETRIES_KEY, config.retries.to_string()),
            (AI_MIN_INTERVAL_MS_KEY, config.min_interval_ms.to_string()),
        ];
        for (key, value) in values {
            tx.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                params![key, value, &now],
            )?;
        }
        if update_api_key {
            tx.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                params![AI_API_KEY_KEY, config.api_key, &now],
            )?;
        }
        tx.commit()?;
        self.ai_config()
    }

    pub(crate) fn update_review_settings(
        &mut self,
        settings: &ReviewSettings,
    ) -> Result<ReviewSettings> {
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let tx = self.conn.transaction()?;
        for (key, value) in [
            (
                REVIEW_NEW_DAILY_LIMIT_KEY,
                settings.new_cards_per_day.to_string(),
            ),
            (REVIEW_SESSION_LIMIT_KEY, settings.session_limit.to_string()),
        ] {
            tx.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                params![key, value, now],
            )?;
        }
        tx.commit()?;
        self.review_settings()
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
        self.conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        // ── schema version tracker ──
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);",
        )?;
        let current: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )?;

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
                card_type         TEXT NOT NULL CHECK(card_type IN ('fact', 'method', 'concept', 'decision', 'case', 'quote', 'principle', 'snippet')),
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
            // 卡片关联（双向链接，展示层合成反向边）
            let existing_columns: Vec<String> = self
                .conn
                .prepare("PRAGMA table_info(knowledge_cards)")?
                .query_map([], |row| row.get(1))?
                .collect::<Result<_>>()?;
            if !existing_columns
                .iter()
                .any(|column| column == "related_ids")
            {
                self.conn.execute_batch(
                    "ALTER TABLE knowledge_cards ADD COLUMN related_ids TEXT NOT NULL DEFAULT '[]';",
                )?;
            }
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (6)", [])?;
        }

        if current < 7 {
            // 每日新卡配额：记录首次评分日期，用于计算"今天已学新卡数"
            let existing_columns: Vec<String> = self
                .conn
                .prepare("PRAGMA table_info(knowledge_cards)")?
                .query_map([], |row| row.get(1))?
                .collect::<Result<_>>()?;
            if !existing_columns
                .iter()
                .any(|column| column == "first_reviewed_at")
            {
                self.conn.execute_batch(
                    "ALTER TABLE knowledge_cards ADD COLUMN first_reviewed_at TEXT NOT NULL DEFAULT '';",
                )?;
            }
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (7)", [])?;
        }

        if current < 8 {
            // 扩展 card_type 合法值：新增 snippet（代码/API 片段）。
            // SQLite 无法直接修改 CHECK 约束，需要重建 knowledge_cards 表。
            self.conn.execute_batch(
                "
                BEGIN;
                ALTER TABLE knowledge_cards RENAME TO knowledge_cards_old;
                CREATE TABLE knowledge_cards (
                    id                  TEXT PRIMARY KEY,
                    card_type           TEXT NOT NULL CHECK(card_type IN ('fact', 'method', 'concept', 'decision', 'case', 'quote', 'principle', 'snippet')),
                    status              TEXT NOT NULL CHECK(status IN ('draft', 'confirmed', 'outdated')),
                    title               TEXT NOT NULL,
                    content             TEXT NOT NULL,
                    tags                TEXT DEFAULT '[]',
                    source_article_id   TEXT DEFAULT '',
                    source_review_id    TEXT DEFAULT '',
                    source_date         TEXT DEFAULT '',
                    source_excerpt      TEXT DEFAULT '',
                    created_at          TEXT NOT NULL,
                    updated_at          TEXT NOT NULL,
                    review_state        TEXT NOT NULL DEFAULT 'new',
                    review_interval_days REAL NOT NULL DEFAULT 0,
                    review_ease         REAL NOT NULL DEFAULT 2.5,
                    review_count        INTEGER NOT NULL DEFAULT 0,
                    last_reviewed_at    TEXT NOT NULL DEFAULT '',
                    next_review_at      TEXT NOT NULL DEFAULT '',
                    usage_count         INTEGER NOT NULL DEFAULT 0,
                    last_used_at        TEXT NOT NULL DEFAULT '',
                    related_ids         TEXT NOT NULL DEFAULT '[]',
                    first_reviewed_at   TEXT NOT NULL DEFAULT ''
                );
                INSERT INTO knowledge_cards
                    (id, card_type, status, title, content, tags, source_article_id, source_review_id,
                     source_date, source_excerpt, created_at, updated_at, review_state,
                     review_interval_days, review_ease, review_count, last_reviewed_at, next_review_at,
                     usage_count, last_used_at, related_ids, first_reviewed_at)
                    SELECT id, card_type, status, title, content, tags, source_article_id, source_review_id,
                     source_date, source_excerpt, created_at, updated_at, review_state,
                     review_interval_days, review_ease, review_count, last_reviewed_at, next_review_at,
                     usage_count, last_used_at, related_ids, first_reviewed_at
                    FROM knowledge_cards_old;
                DROP TABLE knowledge_cards_old;
                CREATE INDEX IF NOT EXISTS idx_knowledge_cards_type_status
                    ON knowledge_cards(card_type, status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_knowledge_cards_source
                    ON knowledge_cards(source_date, source_article_id, source_review_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_cards_status_updated
                    ON knowledge_cards(status, updated_at DESC);
                COMMIT;
                ",
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (8)", [])?;
        }

        if current < 9 {
            // 项目/领域分组字段（多值，JSON 数组，与 tags 存储方式一致）。
            let existing_columns: Vec<String> = self
                .conn
                .prepare("PRAGMA table_info(knowledge_cards)")?
                .query_map([], |row| row.get(1))?
                .collect::<Result<_>>()?;
            if !existing_columns
                .iter()
                .any(|existing| existing == "projects")
            {
                self.conn.execute(
                    "ALTER TABLE knowledge_cards ADD COLUMN projects TEXT NOT NULL DEFAULT '[]'",
                    [],
                )?;
            }
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (9)", [])?;
        }

        if current < 10 {
            // 项目是独立的用户数据，不能只从卡片反推，否则没有卡片的项目会在刷新后消失。
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS knowledge_projects (
                    id         TEXT PRIMARY KEY,
                    name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_knowledge_projects_name
                    ON knowledge_projects(name COLLATE NOCASE);",
            )?;

            // 从已有卡片回填项目目录，保证升级不会丢失旧数据。
            let project_json: Vec<String> = self
                .conn
                .prepare("SELECT projects FROM knowledge_cards")?
                .query_map([], |row| row.get(0))?
                .collect::<Result<_>>()?;
            let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
            for raw in project_json {
                for project in normalize_space_names(parse_json_vec(&raw)?) {
                    self.conn.execute(
                        "INSERT OR IGNORE INTO knowledge_projects (id, name, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?3)",
                        params![Uuid::new_v4().to_string(), project, now],
                    )?;
                }
            }
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (10)", [])?;
        }

        if current < 11 {
            // 关系表是卡片与项目的唯一关系来源；保留 cards.projects 作为旧备份格式的兼容字段。
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS knowledge_card_projects (
                    card_id    TEXT NOT NULL REFERENCES knowledge_cards(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE,
                    PRIMARY KEY (card_id, project_id)
                );

                CREATE INDEX IF NOT EXISTS idx_knowledge_card_projects_project
                    ON knowledge_card_projects(project_id, card_id);",
            )?;
            let transaction = self.conn.unchecked_transaction()?;
            let card_projects: Vec<(String, String)> = transaction
                .prepare("SELECT id, projects FROM knowledge_cards")?
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<Result<_>>()?;
            let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
            for (card_id, raw) in card_projects {
                for project in normalize_space_names(parse_json_vec(&raw)?) {
                    ensure_project(&transaction, &project, &now)?;
                    let project_id: String = transaction.query_row(
                        "SELECT id FROM knowledge_projects WHERE name=?1 COLLATE NOCASE",
                        params![project],
                        |row| row.get(0),
                    )?;
                    transaction.execute(
                        "INSERT OR IGNORE INTO knowledge_card_projects (card_id, project_id)
                         VALUES (?1, ?2)",
                        params![card_id, project_id],
                    )?;
                }
            }
            transaction.execute("INSERT INTO schema_version (version) VALUES (11)", [])?;
            transaction.commit()?;
        }

        if current < 12 {
            // 软删除墓碑：保留正文、项目关系和复习进度，普通查询统一排除已删除卡片。
            let existing_columns: Vec<String> = self
                .conn
                .prepare("PRAGMA table_info(knowledge_cards)")?
                .query_map([], |row| row.get(1))?
                .collect::<Result<_>>()?;
            if !existing_columns.iter().any(|column| column == "deleted_at") {
                self.conn.execute(
                    "ALTER TABLE knowledge_cards ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_knowledge_cards_deleted_at
                 ON knowledge_cards(deleted_at, updated_at DESC)",
                [],
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (12)", [])?;
        }

        if current < 13 {
            // 知识搜索索引：使用外部内容表，正文仍只以 knowledge_cards 为权威来源。
            self.conn.execute_batch(
                "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_cards_fts USING fts5(
                    title,
                    content,
                    tags,
                    source_excerpt,
                    content='knowledge_cards',
                    content_rowid='rowid'
                );

                INSERT INTO knowledge_cards_fts(knowledge_cards_fts) VALUES ('rebuild');

                CREATE TRIGGER IF NOT EXISTS knowledge_cards_ai AFTER INSERT ON knowledge_cards BEGIN
                    INSERT INTO knowledge_cards_fts(rowid, title, content, tags, source_excerpt)
                    VALUES (new.rowid, new.title, new.content, new.tags, new.source_excerpt);
                END;

                CREATE TRIGGER IF NOT EXISTS knowledge_cards_ad AFTER DELETE ON knowledge_cards BEGIN
                    INSERT INTO knowledge_cards_fts(knowledge_cards_fts, rowid, title, content, tags, source_excerpt)
                    VALUES ('delete', old.rowid, old.title, old.content, old.tags, old.source_excerpt);
                END;

                CREATE TRIGGER IF NOT EXISTS knowledge_cards_au AFTER UPDATE ON knowledge_cards BEGIN
                    INSERT INTO knowledge_cards_fts(knowledge_cards_fts, rowid, title, content, tags, source_excerpt)
                    VALUES ('delete', old.rowid, old.title, old.content, old.tags, old.source_excerpt);
                    INSERT INTO knowledge_cards_fts(rowid, title, content, tags, source_excerpt)
                    VALUES (new.rowid, new.title, new.content, new.tags, new.source_excerpt);
                END;",
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (13)", [])?;
        }

        if current < 15 {
            // 复习计划设置由服务端持久化，避免只保存在浏览器导致多设备/刷新后不一致。
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS app_settings (
                    key        TEXT PRIMARY KEY,
                    value      TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                INSERT OR IGNORE INTO app_settings (key, value, updated_at)
                VALUES ('review_new_daily_limit', '20', datetime('now'));
                INSERT OR IGNORE INTO app_settings (key, value, updated_at)
                VALUES ('review_session_limit', '20', datetime('now'));",
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (15)", [])?;
        }

        if current < 16 {
            // 知识正文与主动回忆题解耦：一个知识条目可以有零到多道复习题。
            // 旧卡片先迁移为一条复习题；较长正文默认暂停，避免升级后直接把长文塞进复习队列。
            let existing_columns: Vec<String> = self
                .conn
                .prepare("PRAGMA table_info(knowledge_cards)")?
                .query_map([], |row| row.get(1))?
                .collect::<Result<_>>()?;
            let review_log_columns: Vec<String> = self
                .conn
                .prepare("PRAGMA table_info(review_log)")?
                .query_map([], |row| row.get(1))?
                .collect::<Result<_>>()?;

            // DDL、旧数据回填和版本号必须在同一个事务中完成。否则中途失败时，
            // 数据库会留下“列已加但版本仍是 15”的半迁移状态，下一次启动会再次
            // 执行不可重复的 ALTER TABLE。
            let transaction = self.conn.unchecked_transaction()?;
            if !existing_columns
                .iter()
                .any(|column| column == "content_version")
            {
                transaction.execute(
                    "ALTER TABLE knowledge_cards ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1",
                    [],
                )?;
            }

            transaction.execute_batch(
                "CREATE TABLE IF NOT EXISTS review_items (
                    id                    TEXT PRIMARY KEY,
                    knowledge_card_id     TEXT NOT NULL REFERENCES knowledge_cards(id) ON DELETE CASCADE,
                    item_type             TEXT NOT NULL CHECK(item_type IN ('basic', 'cloze', 'code', 'compare', 'scenario')),
                    status                TEXT NOT NULL CHECK(status IN ('active', 'suspended', 'stale', 'archived')),
                    prompt                TEXT NOT NULL,
                    answer                TEXT NOT NULL,
                    hint                  TEXT NOT NULL DEFAULT '',
                    source_version        INTEGER NOT NULL DEFAULT 1,
                    created_at            TEXT NOT NULL,
                    updated_at            TEXT NOT NULL,
                    review_state          TEXT NOT NULL DEFAULT 'new',
                    review_interval_days REAL NOT NULL DEFAULT 0,
                    review_ease           REAL NOT NULL DEFAULT 2.5,
                    review_count          INTEGER NOT NULL DEFAULT 0,
                    last_reviewed_at      TEXT NOT NULL DEFAULT '',
                    next_review_at        TEXT NOT NULL DEFAULT '',
                    first_reviewed_at     TEXT NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_review_items_card
                    ON review_items(knowledge_card_id, status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_review_items_due
                    ON review_items(status, next_review_at, created_at);

                ",
            )?;
            if !review_log_columns
                .iter()
                .any(|column| column == "review_item_id")
            {
                transaction.execute(
                    "ALTER TABLE review_log ADD COLUMN review_item_id TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            transaction.execute(
                "CREATE INDEX IF NOT EXISTS idx_review_log_item
                 ON review_log(review_item_id, reviewed_at)",
                [],
            )?;
            let legacy_cards: Vec<LegacyCardReviewFields> = transaction
                .prepare(
                    "SELECT id, status, title, content, created_at, updated_at,
                            review_state, review_interval_days, review_ease, review_count,
                            last_reviewed_at, next_review_at, first_reviewed_at
                     FROM knowledge_cards",
                )?
                .query_map([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                        row.get(11)?,
                        row.get(12)?,
                    ))
                })?
                .collect::<Result<_>>()?;
            for (
                card_id,
                card_status,
                title,
                content,
                created_at,
                updated_at,
                review_state,
                review_interval_days,
                review_ease,
                review_count,
                last_reviewed_at,
                next_review_at,
                first_reviewed_at,
            ) in legacy_cards
            {
                let item_status =
                    if card_status == "confirmed" && content.trim().chars().count() <= 480 {
                        "active"
                    } else {
                        "suspended"
                    };
                transaction.execute(
                    "INSERT INTO review_items
                        (id, knowledge_card_id, item_type, status, prompt, answer, hint,
                         source_version, created_at, updated_at, review_state,
                         review_interval_days, review_ease, review_count, last_reviewed_at,
                         next_review_at, first_reviewed_at)
                     VALUES (?1, ?2, 'basic', ?3, ?4, ?5, '', 1, ?6, ?7, ?8,
                             ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![
                        Uuid::new_v4().to_string(),
                        card_id,
                        item_status,
                        title,
                        content,
                        created_at,
                        updated_at,
                        review_state,
                        review_interval_days,
                        review_ease,
                        review_count,
                        last_reviewed_at,
                        next_review_at,
                        first_reviewed_at,
                    ],
                )?;
            }
            transaction.execute(
                "UPDATE review_log
                 SET review_item_id=COALESCE((
                     SELECT id FROM review_items
                     WHERE review_items.knowledge_card_id=review_log.card_id
                     ORDER BY review_items.created_at ASC LIMIT 1
                 ), '')
                 WHERE COALESCE(review_item_id, '')=''",
                [],
            )?;
            transaction.execute("INSERT INTO schema_version (version) VALUES (16)", [])?;
            transaction.commit()?;
        }

        if current < 17 {
            // knowledge_projects 是兼容旧 API 的表名；从这一版起它承担统一空间目录，
            // 用 kind 区分长期主题与有生命周期的项目，避免把 C++ 之类的长期领域硬叫成项目。
            let existing_columns: Vec<String> = self
                .conn
                .prepare("PRAGMA table_info(knowledge_projects)")?
                .query_map([], |row| row.get(1))?
                .collect::<Result<_>>()?;
            if !existing_columns.iter().any(|column| column == "kind") {
                self.conn.execute(
                    "ALTER TABLE knowledge_projects
                     ADD COLUMN kind TEXT NOT NULL DEFAULT 'project'
                     CHECK(kind IN ('topic', 'project'))",
                    [],
                )?;
            }
            if !existing_columns
                .iter()
                .any(|column| column == "description")
            {
                self.conn.execute(
                    "ALTER TABLE knowledge_projects
                     ADD COLUMN description TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            if !existing_columns.iter().any(|column| column == "status") {
                self.conn.execute(
                    "ALTER TABLE knowledge_projects
                     ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
                     CHECK(status IN ('active', 'archived'))",
                    [],
                )?;
            }
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_knowledge_projects_kind_status
                 ON knowledge_projects(kind, status, name COLLATE NOCASE)",
                [],
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (17)", [])?;
        }

        if current < 18 {
            // 每日记录仍以日期为主轴，但可选地归入一个或多个主题/项目空间。
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS article_spaces (
                    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
                    space_id   TEXT NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE,
                    PRIMARY KEY (article_id, space_id)
                );

                CREATE INDEX IF NOT EXISTS idx_article_spaces_space
                    ON article_spaces(space_id, article_id);",
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (18)", [])?;
        }

        if current < 19 {
            // 复习日志保留评分当时的题目/答案快照，避免复习题编辑后历史记录失去解释力。
            let existing_columns: Vec<String> = self
                .conn
                .prepare("PRAGMA table_info(review_log)")?
                .query_map([], |row| row.get(1))?
                .collect::<Result<_>>()?;
            let mut pending = Vec::new();
            for (column, statement) in [
                (
                    "review_item_source_version",
                    "ALTER TABLE review_log ADD COLUMN review_item_source_version INTEGER NOT NULL DEFAULT 1",
                ),
                (
                    "prompt_snapshot",
                    "ALTER TABLE review_log ADD COLUMN prompt_snapshot TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "answer_snapshot",
                    "ALTER TABLE review_log ADD COLUMN answer_snapshot TEXT NOT NULL DEFAULT ''",
                ),
            ] {
                if !existing_columns.iter().any(|existing| existing == column) {
                    pending.push(statement);
                }
            }
            if !pending.is_empty() {
                self.conn.execute_batch(&pending.join(";"))?;
            }
            self.conn.execute(
                "UPDATE review_log SET
                    review_item_source_version=COALESCE((
                        SELECT source_version FROM review_items
                        WHERE review_items.id=review_log.review_item_id
                    ), 1),
                    prompt_snapshot=COALESCE((
                        SELECT prompt FROM review_items
                        WHERE review_items.id=review_log.review_item_id
                    ), ''),
                    answer_snapshot=COALESCE((
                        SELECT answer FROM review_items
                        WHERE review_items.id=review_log.review_item_id
                    ), '')",
                [],
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (19)", [])?;
        }

        if current < 20 {
            // AI 配置沿用 app_settings：环境变量继续作为未保存字段的回退值，
            // 设置页保存后仅覆盖对应的服务端运行配置。
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (20)", [])?;
        }

        if current < 21 {
            // AI 模型档案和任务路由沿用 app_settings，以 JSON 保存且不包含 API Key。
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (21)", [])?;
        }

        if current < 22 {
            // 保存视图已从产品中移除；删除旧表及索引，避免继续保留筛选条件。
            self.conn.execute_batch(
                "DROP INDEX IF EXISTS idx_knowledge_saved_views_updated;
                 DROP TABLE IF EXISTS knowledge_saved_views;",
            )?;
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (22)", [])?;
        }

        Ok(())
    }
}

impl ArticlePersistence<'_> {
    pub(crate) fn save(&mut self, draft: ArticleDraft) -> Result<Article> {
        let tags = normalize_tags(draft.tags);
        let spaces = normalize_space_names(draft.spaces);
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
        sync_article_space_links(&tx, &id, &spaces, &now)?;
        tx.execute(
            "DELETE FROM day_exemptions WHERE date=?1",
            params![draft.date],
        )?;
        tx.commit()?;
        self.find_by_id(&id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub(crate) fn update(&mut self, id: &str, changes: ArticleChanges) -> Result<Option<Article>> {
        let tags = changes
            .tags
            .map(normalize_tags)
            .map(|tags| {
                serde_json::to_string(&tags)
                    .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
            })
            .transpose()?;
        let spaces = changes.spaces.map(normalize_space_names);
        let word_count = changes
            .content
            .chars()
            .filter(|c| !c.is_whitespace())
            .count() as i64;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let tx = self.conn.transaction()?;
        let updated = tx.execute(
            "UPDATE articles SET title=?1, content=?2, mood=?3, tags=COALESCE(?4, tags), word_count=?5,
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
            tx.rollback()?;
            return Ok(None);
        }
        if let Some(spaces) = spaces {
            sync_article_space_links(&tx, id, &spaces, &now)?;
        }
        tx.commit()?;
        self.find_by_id(id)
    }

    pub(crate) fn delete(&mut self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM articles WHERE id=?1", params![id])?
            > 0)
    }

    pub(crate) fn find_by_id(&mut self, id: &str) -> Result<Option<Article>> {
        let mut article = self
            .conn
            .query_row(
                "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at
                 FROM articles WHERE id=?1",
                params![id],
                row_to_article,
            )
            .optional()?;
        if let Some(article) = article.as_mut() {
            resolve_article_spaces(self.conn, article)?;
        }
        Ok(article)
    }

    pub(crate) fn find_by_date(&mut self, date: &str) -> Result<Option<Article>> {
        let mut article = self
            .conn
            .query_row(
                "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at
                 FROM articles WHERE date=?1 LIMIT 1",
                params![date],
                row_to_article,
            )
            .optional()?;
        if let Some(article) = article.as_mut() {
            resolve_article_spaces(self.conn, article)?;
        }
        Ok(article)
    }

    pub(crate) fn list(&mut self, page: i64, page_size: i64) -> Result<Vec<ArticleSummary>> {
        let page = page.max(1);
        let page_size = page_size.clamp(1, 100);
        let offset = (page - 1).saturating_mul(page_size);
        let mut statement = self.conn.prepare(
            "SELECT a.id, a.date, a.title, a.mood, a.tags, a.word_count, a.content,
                    COALESCE((
                        SELECT json_group_array(p.name)
                        FROM article_spaces AS aps
                        INNER JOIN knowledge_projects AS p ON p.id=aps.space_id
                        WHERE aps.article_id=a.id
                        ORDER BY p.name COLLATE NOCASE ASC
                    ), '[]') AS spaces
             FROM articles AS a
             ORDER BY a.date DESC, a.updated_at DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = statement
            .query_map(params![page_size, offset], row_to_article_summary)?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// 按统一空间读取每日记录。每日记录仍以日期为主轴，这个入口只提供空间上下文下的最近记录。
    pub(crate) fn list_by_space(
        &mut self,
        space: &str,
        page: i64,
        page_size: i64,
    ) -> Result<Vec<ArticleSummary>> {
        let space = space.trim();
        if space.is_empty() {
            return Ok(Vec::new());
        }
        let page = page.max(1);
        let page_size = page_size.clamp(1, 100);
        let offset = (page - 1).saturating_mul(page_size);
        let mut statement = self.conn.prepare(
            "SELECT a.id, a.date, a.title, a.mood, a.tags, a.word_count, a.content,
                    COALESCE((
                        SELECT json_group_array(p2.name)
                        FROM article_spaces AS aps2
                        INNER JOIN knowledge_projects AS p2 ON p2.id=aps2.space_id
                        WHERE aps2.article_id=a.id
                        ORDER BY p2.name COLLATE NOCASE ASC
                    ), '[]') AS spaces
             FROM articles AS a
             INNER JOIN article_spaces AS aps ON aps.article_id=a.id
             INNER JOIN knowledge_projects AS p ON p.id=aps.space_id
             WHERE p.name=?1 COLLATE NOCASE
             ORDER BY a.date DESC, a.updated_at DESC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = statement
            .query_map(params![space, page_size, offset], row_to_article_summary)?
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
            "SELECT a.id, a.date, a.title, a.mood, a.tags, a.word_count, a.content,
                    COALESCE((
                        SELECT json_group_array(p.name)
                        FROM article_spaces AS aps
                        INNER JOIN knowledge_projects AS p ON p.id=aps.space_id
                        WHERE aps.article_id=a.id
                        ORDER BY p.name COLLATE NOCASE ASC
                    ), '[]') AS spaces
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
        let mut rows = statement
            .query_map(params![from, to], row_to_article)?
            .collect::<Result<Vec<_>>>()?;
        for article in &mut rows {
            resolve_article_spaces(self.conn, article)?;
        }
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
            "SELECT a.id, a.date, a.title, a.mood, a.tags, a.word_count, a.content,
                    COALESCE((
                        SELECT json_group_array(p.name)
                        FROM article_spaces AS aps
                        INNER JOIN knowledge_projects AS p ON p.id=aps.space_id
                        WHERE aps.article_id=a.id
                        ORDER BY p.name COLLATE NOCASE ASC
                    ), '[]') AS spaces
             FROM articles AS a
             WHERE a.date LIKE ?1 ORDER BY a.date DESC",
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
                "SELECT a.id, a.date, a.title, a.content, a.mood, a.tags, a.word_count,
                        a.created_at, a.updated_at,
                        COALESCE((
                            SELECT json_group_array(p.name)
                            FROM article_spaces AS aps
                            INNER JOIN knowledge_projects AS p ON p.id=aps.space_id
                            WHERE aps.article_id=a.id
                            ORDER BY p.name COLLATE NOCASE ASC
                        ), '[]') AS spaces
                 FROM articles AS a ORDER BY a.date ASC",
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
                        "spaces": parse_json_vec(&row.get::<_, String>(9)?)?,
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
                        content_version,
                        review_state, review_interval_days, review_ease, review_count,
                        last_reviewed_at, next_review_at, usage_count, last_used_at,
                        related_ids, first_reviewed_at, projects, deleted_at
                 FROM knowledge_cards ORDER BY updated_at ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    let tags: String = row.get(5)?;
                    let related_ids: String = row.get(21)?;
                    let projects: String = row.get(23)?;
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
                        "content_version": row.get::<_, i64>(12)?,
                        "review_state": row.get::<_, String>(13)?,
                        "review_interval_days": row.get::<_, f64>(14)?,
                        "review_ease": row.get::<_, f64>(15)?,
                        "review_count": row.get::<_, i64>(16)?,
                        "last_reviewed_at": row.get::<_, String>(17)?,
                        "next_review_at": row.get::<_, String>(18)?,
                        "usage_count": row.get::<_, i64>(19)?,
                        "last_used_at": row.get::<_, String>(20)?,
                        "related_ids": parse_json_vec(&related_ids)?,
                        "first_reviewed_at": row.get::<_, String>(22)?,
                        "projects": parse_json_vec(&projects)?,
                        "deleted_at": row.get::<_, String>(24)?,
                    }))
                })?
                .collect::<Result<Vec<_>>>()?;
            rows
        };
        let review_items = {
            let mut statement = self.conn.prepare(
                "SELECT ri.id, ri.knowledge_card_id, ri.item_type, ri.status, ri.prompt,
                        ri.answer, ri.hint, ri.source_version, ri.created_at, ri.updated_at,
                        ri.review_state, ri.review_interval_days, ri.review_ease, ri.review_count,
                        ri.last_reviewed_at, ri.next_review_at, ri.first_reviewed_at
                 FROM review_items AS ri
                 INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
                 ORDER BY ri.created_at ASC, ri.id ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok(serde_json::json!({
                        "id": row.get::<_, String>(0)?,
                        "knowledge_card_id": row.get::<_, String>(1)?,
                        "item_type": row.get::<_, String>(2)?,
                        "status": row.get::<_, String>(3)?,
                        "prompt": row.get::<_, String>(4)?,
                        "answer": row.get::<_, String>(5)?,
                        "hint": row.get::<_, String>(6)?,
                        "source_version": row.get::<_, i64>(7)?,
                        "created_at": row.get::<_, String>(8)?,
                        "updated_at": row.get::<_, String>(9)?,
                        "review_state": row.get::<_, String>(10)?,
                        "review_interval_days": row.get::<_, f64>(11)?,
                        "review_ease": row.get::<_, f64>(12)?,
                        "review_count": row.get::<_, i64>(13)?,
                        "last_reviewed_at": row.get::<_, String>(14)?,
                        "next_review_at": row.get::<_, String>(15)?,
                        "first_reviewed_at": row.get::<_, String>(16)?,
                    }))
                })?
                .collect::<Result<Vec<_>>>()?;
            rows
        };
        let knowledge_projects = {
            let mut statement = self
                .conn
                .prepare("SELECT name FROM knowledge_projects ORDER BY name COLLATE NOCASE ASC")?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>>>()?;
            rows
        };
        Ok(serde_json::json!({
            "version": 3,
            "articles": articles,
            "reviews": reviews,
            "knowledge_cards": knowledge_cards,
            "review_items": review_items,
            "knowledge_projects": knowledge_projects,
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
        let legacy_archive_without_review_items = archive.version < 3;
        let tx = self.conn.transaction()?;

        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        // 同一工作区可能已经有同日期记录。保留目标记录的 ID，避免替换文章时
        // 把本地知识卡片/复盘中的来源引用变成悬空 ID；后续引用会按此表重写。
        let mut article_id_map = BTreeMap::new();
        for project in archive.knowledge_projects {
            if let Some(name) = normalize_space_name(&project) {
                ensure_project(&tx, &name, &now)?;
            }
        }

        for article in archive.articles {
            let existing_by_date: Option<String> = tx
                .query_row(
                    "SELECT id FROM articles WHERE date=?1 LIMIT 1",
                    params![article.date],
                    |row| row.get(0),
                )
                .optional()?;
            let existing_by_id: Option<String> = tx
                .query_row(
                    "SELECT date FROM articles WHERE id=?1 LIMIT 1",
                    params![article.id],
                    |row| row.get(0),
                )
                .optional()?;
            let target_id = match existing_by_date {
                Some(id) => id,
                None if existing_by_id.is_none() => article.id.clone(),
                None => Uuid::new_v4().to_string(),
            };
            article_id_map.insert(article.id.clone(), target_id.clone());
            let tags = serde_json::to_string(&normalize_tags(article.tags))?;
            let spaces = normalize_space_names(article.spaces.clone());
            for space in &spaces {
                ensure_project(&tx, space, &now)?;
            }
            let word_count = article
                .content
                .chars()
                .filter(|c| !c.is_whitespace())
                .count() as i64;
            tx.execute(
                "INSERT INTO articles
                 (id, date, title, content, mood, tags, word_count, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET date=excluded.date, title=excluded.title,
                   content=excluded.content, mood=excluded.mood, tags=excluded.tags,
                   word_count=excluded.word_count, updated_at=excluded.updated_at",
                params![
                    target_id,
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
            sync_article_space_links(&tx, &target_id, &spaces, &now)?;
            tx.execute(
                "DELETE FROM day_exemptions WHERE date=?1",
                params![article.date],
            )?;
        }

        for review in archive.reviews {
            let article_ids = serde_json::to_string(
                &review
                    .source_article_ids
                    .iter()
                    .map(|id| {
                        article_id_map
                            .get(id)
                            .cloned()
                            .unwrap_or_else(|| id.clone())
                    })
                    .collect::<Vec<_>>(),
            )?;
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
            let projects = normalize_space_names(card.projects.clone());
            let related_ids = normalize_related_ids(&card.id, card.related_ids);
            let source_article_id = article_id_map
                .get(&card.source_article_id)
                .cloned()
                .unwrap_or(card.source_article_id);
            for project in &projects {
                ensure_project(&tx, project, &now)?;
            }
            // 复习/使用进度是本地积累数据：导入已存在的卡时保留本地值，
            // 只覆盖卡片内容字段（旧档案缺省字段不会清零已积累的进度）。
            tx.execute(
                "INSERT INTO knowledge_cards
                 (id, card_type, status, title, content, tags, projects, source_article_id,
                  source_review_id, source_date, source_excerpt, created_at, updated_at,
                  content_version,
                  review_state, review_interval_days, review_ease, review_count,
                  last_reviewed_at, next_review_at, usage_count, last_used_at,
                  related_ids, first_reviewed_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                         ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
                 ON CONFLICT(id) DO UPDATE SET
                   card_type=excluded.card_type, status=excluded.status,
                   title=excluded.title, content=excluded.content, tags=excluded.tags,
                   projects=excluded.projects,
                   source_article_id=excluded.source_article_id,
                   source_review_id=excluded.source_review_id,
                   source_date=excluded.source_date,
                   source_excerpt=excluded.source_excerpt,
                   related_ids=excluded.related_ids,
                   created_at=excluded.created_at, updated_at=excluded.updated_at,
                   deleted_at=excluded.deleted_at,
                   content_version=CASE
                     WHEN knowledge_cards.content <> excluded.content
                       THEN MAX(knowledge_cards.content_version + 1, excluded.content_version)
                     ELSE MAX(knowledge_cards.content_version, excluded.content_version)
                   END",
                params![
                    card.id,
                    card.card_type,
                    card.status,
                    card.title,
                    card.content,
                    tags,
                    serde_json::to_string(&projects)?,
                    source_article_id,
                    card.source_review_id,
                    card.source_date,
                    card.source_excerpt,
                    card.created_at,
                    card.updated_at,
                    card.content_version.max(1),
                    card.review_state,
                    card.review_interval_days,
                    card.review_ease,
                    card.review_count,
                    card.last_reviewed_at,
                    card.next_review_at,
                    card.usage_count,
                    card.last_used_at,
                    serialize_string_vec(&related_ids)?,
                    // 首评日/复习进度属于本地记忆状态，导入已有卡时保留本地值
                    card.first_reviewed_at,
                    card.deleted_at
                ],
            )?;
            sync_project_links(&tx, &card.id, &projects, &now)?;
            if legacy_archive_without_review_items {
                let has_review_items: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM review_items WHERE knowledge_card_id=?1)",
                    params![card.id],
                    |row| Ok(row.get::<_, i64>(0)? != 0),
                )?;
                if !has_review_items {
                    let item_status = if card.status == "confirmed"
                        && card.content.trim().chars().count() <= 480
                    {
                        "active"
                    } else {
                        "suspended"
                    };
                    tx.execute(
                        "INSERT INTO review_items
                            (id, knowledge_card_id, item_type, status, prompt, answer, hint,
                             source_version, created_at, updated_at, review_state,
                             review_interval_days, review_ease, review_count, last_reviewed_at,
                             next_review_at, first_reviewed_at)
                         VALUES (?1, ?2, 'basic', ?3, ?4, ?5, '', ?6, ?7, ?8, ?9,
                                 ?10, ?11, ?12, ?13, ?14, ?15)",
                        params![
                            Uuid::new_v4().to_string(),
                            card.id,
                            item_status,
                            card.title,
                            card.content,
                            card.content_version.max(1),
                            card.created_at,
                            card.updated_at,
                            card.review_state,
                            card.review_interval_days,
                            card.review_ease,
                            card.review_count,
                            card.last_reviewed_at,
                            card.next_review_at,
                            card.first_reviewed_at,
                        ],
                    )?;
                }
            }
        }

        for item in archive.review_items {
            tx.execute(
                "INSERT INTO review_items
                    (id, knowledge_card_id, item_type, status, prompt, answer, hint,
                     source_version, created_at, updated_at, review_state,
                     review_interval_days, review_ease, review_count, last_reviewed_at,
                     next_review_at, first_reviewed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                         ?14, ?15, ?16, ?17)
                 ON CONFLICT(id) DO UPDATE SET
                   knowledge_card_id=excluded.knowledge_card_id,
                   item_type=excluded.item_type,
                   prompt=excluded.prompt,
                   answer=excluded.answer,
                   hint=excluded.hint,
                   source_version=excluded.source_version,
                   updated_at=excluded.updated_at,
                   status=CASE
                     WHEN excluded.status='archived' THEN 'archived'
                     WHEN review_items.prompt <> excluded.prompt
                          OR review_items.answer <> excluded.answer THEN 'stale'
                     ELSE review_items.status
                   END",
                params![
                    item.id,
                    item.knowledge_card_id,
                    item.item_type,
                    item.status,
                    item.prompt,
                    item.answer,
                    item.hint,
                    item.source_version.max(1),
                    item.created_at,
                    item.updated_at,
                    item.review_state,
                    item.review_interval_days,
                    item.review_ease,
                    item.review_count,
                    item.last_reviewed_at,
                    item.next_review_at,
                    item.first_reviewed_at,
                ],
            )?;
        }

        tx.execute(
            "UPDATE review_items
             SET status='suspended'
             WHERE status='active' AND EXISTS (
                 SELECT 1 FROM knowledge_cards AS c
                 WHERE c.id=review_items.knowledge_card_id AND c.status!='confirmed'
             )",
            [],
        )?;
        tx.execute(
            "UPDATE review_items
             SET status='stale'
             WHERE status='active' AND source_version < (
                 SELECT c.content_version FROM knowledge_cards AS c
                 WHERE c.id=review_items.knowledge_card_id
             )",
            [],
        )?;

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

    /// 复盘库的分页查询入口。旧的 list() 保留给生成、关联和兼容旧客户端等需要完整集合的内部流程。
    pub(crate) fn query_page(&mut self, request: ReviewPageQuery<'_>) -> Result<ReviewPageResult> {
        let page = request.page.max(1);
        let page_size = request.page_size.clamp(1, 100);
        let mut conditions = Vec::<String>::new();
        let mut values = Vec::<SqlValue>::new();

        if let Some(kind) = request.kind.filter(|value| !value.is_empty()) {
            conditions.push("kind=?".into());
            values.push(SqlValue::Text(kind.to_string()));
        }
        if let Some(status) = request
            .status
            .filter(|value| !value.is_empty() && *value != "all")
        {
            conditions.push("status=?".into());
            values.push(SqlValue::Text(status.to_string()));
        }
        let query = request.query.replace('\0', " ").trim().to_string();
        if !query.is_empty() {
            let like_query = format!("%{query}%");
            conditions.push(
                "(title LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE
                  OR model LIKE ? COLLATE NOCASE OR period_start LIKE ?
                  OR period_end LIKE ? OR kind LIKE ? COLLATE NOCASE)"
                    .into(),
            );
            values.extend([
                SqlValue::Text(like_query.clone()),
                SqlValue::Text(like_query.clone()),
                SqlValue::Text(like_query.clone()),
                SqlValue::Text(like_query.clone()),
                SqlValue::Text(like_query.clone()),
                SqlValue::Text(like_query),
            ]);
        }

        let where_clause = if conditions.is_empty() {
            "1=1".to_string()
        } else {
            conditions.join(" AND ")
        };
        let total = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM reviews WHERE {where_clause}"),
            params_from_iter(values.iter()),
            |row| row.get(0),
        )?;
        let draft_count = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM reviews WHERE {where_clause} AND status='draft'"),
            params_from_iter(values.iter()),
            |row| row.get(0),
        )?;
        let confirmed_count = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM reviews WHERE {where_clause} AND status='confirmed'"),
            params_from_iter(values.iter()),
            |row| row.get(0),
        )?;
        let current_month_weekly_drafts = self.conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM reviews WHERE {where_clause}
                 AND kind='weekly' AND status='draft'
                 AND strftime('%Y-%m', date(period_start, '+3 days'))=?"
            ),
            params_from_iter(values.iter().cloned().chain(std::iter::once(SqlValue::Text(
                request.current_month.to_string(),
            )))),
            |row| row.get(0),
        )?;
        let latest_generated_at = self.conn.query_row(
            &format!("SELECT MAX(generated_at) FROM reviews WHERE {where_clause}"),
            params_from_iter(values.iter()),
            |row| row.get(0),
        )?;

        let offset = (page - 1).saturating_mul(page_size);
        let mut page_values = values;
        page_values.push(SqlValue::Integer(page_size));
        page_values.push(SqlValue::Integer(offset));
        let mut statement = self.conn.prepare(&format!(
            "SELECT id, kind, period_start, period_end, version, status, title, content,
                    source_article_ids, source_review_ids, model, generated_at, updated_at
             FROM reviews WHERE {where_clause}
             ORDER BY period_start DESC, period_end DESC, kind ASC, version DESC, updated_at DESC
             LIMIT ? OFFSET ?"
        ))?;
        let rows = statement
            .query_map(params_from_iter(page_values.iter()), row_to_review)?
            .collect::<Result<Vec<_>>>()?;
        Ok(ReviewPageResult {
            reviews: rows,
            total,
            draft_count,
            confirmed_count,
            current_month_weekly_drafts,
            latest_generated_at,
        })
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
    const SELECT_COLUMNS: &'static str = "id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at, content_version, review_state, review_interval_days, review_ease, review_count, last_reviewed_at, next_review_at, usage_count, last_used_at, related_ids, first_reviewed_at, projects";
    const SELECT_COLUMNS_WITH_ALIAS: &'static str = "c.id, c.card_type, c.status, c.title, c.content, c.tags, c.source_article_id, c.source_review_id, c.source_date, c.source_excerpt, c.created_at, c.updated_at, c.content_version, c.review_state, c.review_interval_days, c.review_ease, c.review_count, c.last_reviewed_at, c.next_review_at, c.usage_count, c.last_used_at, c.related_ids, c.first_reviewed_at, c.projects";
    const REVIEW_ITEM_COLUMNS: &'static str = "id, knowledge_card_id, item_type, status, prompt, answer, hint, source_version, created_at, updated_at, review_state, review_interval_days, review_ease, review_count, last_reviewed_at, next_review_at, first_reviewed_at";
    const REVIEW_ITEM_COLUMNS_WITH_ALIAS: &'static str = "ri.id, ri.knowledge_card_id, ri.item_type, ri.status, ri.prompt, ri.answer, ri.hint, ri.source_version, ri.created_at, ri.updated_at, ri.review_state, ri.review_interval_days, ri.review_ease, ri.review_count, ri.last_reviewed_at, ri.next_review_at, ri.first_reviewed_at";
    pub(crate) fn list(&mut self) -> Result<Vec<KnowledgeCard>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT {} FROM knowledge_cards
             WHERE deleted_at=''
             ORDER BY updated_at DESC, created_at DESC",
            Self::SELECT_COLUMNS
        ))?;
        let mut cards = statement
            .query_map([], row_to_knowledge_card)?
            .collect::<Result<Vec<_>>>()?;
        self.resolve_related_ids(&mut cards)?;
        Ok(cards)
    }

    pub(crate) fn find(&mut self, id: &str) -> Result<Option<KnowledgeCard>> {
        let mut card = self
            .conn
            .query_row(
                &format!(
                    "SELECT {} FROM knowledge_cards WHERE id=?1 AND deleted_at=''",
                    Self::SELECT_COLUMNS
                ),
                params![id],
                row_to_knowledge_card,
            )
            .optional()?;
        if let Some(card) = card.as_mut() {
            self.resolve_related_ids(std::slice::from_mut(card))?;
        }
        Ok(card)
    }

    pub(crate) fn list_review_items(&mut self, card_id: &str) -> Result<Vec<ReviewItem>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT {} FROM review_items
             WHERE knowledge_card_id=?1 AND status!='archived'
             ORDER BY created_at ASC, id ASC",
            Self::REVIEW_ITEM_COLUMNS
        ))?;
        let items = statement
            .query_map(params![card_id], row_to_review_item)?
            .collect::<Result<Vec<_>>>();
        items
    }

    pub(crate) fn find_review_item(&mut self, id: &str) -> Result<Option<ReviewItem>> {
        self.conn
            .query_row(
                &format!(
                    "SELECT {} FROM review_items
                     WHERE id=?1 AND status!='archived'",
                    Self::REVIEW_ITEM_COLUMNS
                ),
                params![id],
                row_to_review_item,
            )
            .optional()
    }

    /// 兼容旧客户端：复习接口传入知识条目 ID 时，解析为该条目的第一道非归档复习题。
    pub(crate) fn find_review_item_for_review(&mut self, id: &str) -> Result<Option<ReviewItem>> {
        if let Some(item) = self.find_review_item(id)? {
            return Ok(Some(item));
        }
        self.conn
            .query_row(
                &format!(
                    "SELECT {} FROM review_items
                     WHERE knowledge_card_id=?1 AND status!='archived'
                     ORDER BY created_at ASC, id ASC LIMIT 1",
                    Self::REVIEW_ITEM_COLUMNS
                ),
                params![id],
                row_to_review_item,
            )
            .optional()
    }

    pub(crate) fn create_review_item(
        &mut self,
        card_id: &str,
        draft: ReviewItemDraft,
    ) -> Result<Option<ReviewItem>> {
        if !valid_review_item_draft(&draft) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let Some((card_status, content_version)) = self
            .conn
            .query_row(
                "SELECT status, content_version FROM knowledge_cards
                 WHERE id=?1 AND deleted_at=''",
                params![card_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?
        else {
            return Ok(None);
        };
        let status = if card_status == "confirmed" {
            draft.status
        } else {
            "suspended".to_string()
        };
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let id = Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO review_items
                (id, knowledge_card_id, item_type, status, prompt, answer, hint,
                 source_version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![
                id,
                card_id,
                draft.item_type,
                status,
                draft.prompt,
                draft.answer,
                draft.hint,
                content_version,
                now,
            ],
        )?;
        self.find_review_item(&id)
    }

    pub(crate) fn update_review_item(
        &mut self,
        id: &str,
        draft: ReviewItemDraft,
    ) -> Result<Option<ReviewItem>> {
        if !valid_review_item_draft(&draft) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let Some((
            card_id,
            existing_item_type,
            existing_status,
            existing_prompt,
            existing_answer,
            existing_hint,
            existing_source_version,
        )) = self
            .conn
            .query_row(
                "SELECT knowledge_card_id, item_type, status, prompt, answer, hint, source_version
                 FROM review_items
                 WHERE id=?1 AND status!='archived'",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                },
            )
            .optional()?
        else {
            return Ok(None);
        };
        let Some((card_status, content_version)) = self
            .conn
            .query_row(
                "SELECT status, content_version FROM knowledge_cards
                 WHERE id=?1 AND deleted_at=''",
                params![card_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?
        else {
            return Ok(None);
        };
        let semantic_changed = existing_item_type != draft.item_type
            || existing_prompt != draft.prompt
            || existing_answer != draft.answer
            || existing_hint != draft.hint;
        // 编辑正在复习的题目时，不能让旧题的间隔状态流入新题。
        // 若题目本来已过期，用户把它显式恢复为 active 也视为一次重新开始。
        let reset_schedule = semantic_changed
            || (existing_status == "stale" && draft.status == "active")
            || (existing_source_version < content_version && draft.status == "active");
        let status = if card_status == "confirmed" {
            if semantic_changed && existing_status == "active" && draft.status == "active" {
                "stale".to_string()
            } else {
                draft.status.clone()
            }
        } else {
            "suspended".to_string()
        };
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let updated = self.conn.execute(
            "UPDATE review_items SET item_type=?1, status=?2, prompt=?3, answer=?4,
             hint=?5, source_version=?6,
             review_state=CASE WHEN ?7=1 THEN 'new' ELSE review_state END,
             review_interval_days=CASE WHEN ?7=1 THEN 0 ELSE review_interval_days END,
             review_ease=CASE WHEN ?7=1 THEN 2.5 ELSE review_ease END,
             review_count=CASE WHEN ?7=1 THEN 0 ELSE review_count END,
             last_reviewed_at=CASE WHEN ?7=1 THEN '' ELSE last_reviewed_at END,
             next_review_at=CASE WHEN ?7=1 THEN '' ELSE next_review_at END,
             first_reviewed_at=CASE WHEN ?7=1 THEN '' ELSE first_reviewed_at END,
             updated_at=?8
             WHERE id=?9 AND status!='archived'",
            params![
                draft.item_type,
                status,
                draft.prompt,
                draft.answer,
                draft.hint,
                content_version,
                if reset_schedule { 1 } else { 0 },
                now,
                id,
            ],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        self.find_review_item(id)
    }

    pub(crate) fn archive_review_item(&mut self, id: &str) -> Result<bool> {
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        Ok(self.conn.execute(
            "UPDATE review_items SET status='archived', next_review_at='', updated_at=?1
             WHERE id=?2 AND status!='archived'",
            params![now, id],
        )? > 0)
    }

    fn review_card_from_item(&mut self, item: ReviewItem) -> Result<Option<ReviewCard>> {
        let Some(card) = self.find(&item.knowledge_card_id)? else {
            return Ok(None);
        };
        Ok(Some(ReviewCard {
            id: item.id,
            knowledge_card_id: card.id,
            item_type: item.item_type,
            item_status: item.status,
            prompt: item.prompt,
            answer: item.answer,
            hint: item.hint,
            title: card.title,
            card_type: card.card_type,
            card_status: card.status,
            tags: card.tags,
            source_article_id: card.source_article_id,
            source_review_id: card.source_review_id,
            source_date: card.source_date,
            source_excerpt: card.source_excerpt,
            related_ids: card.related_ids,
            projects: card.projects,
            created_at: item.created_at,
            updated_at: item.updated_at,
            review_state: item.review_state,
            review_interval_days: item.review_interval_days,
            review_ease: item.review_ease,
            review_count: item.review_count,
            last_reviewed_at: item.last_reviewed_at,
            next_review_at: item.next_review_at,
            first_reviewed_at: item.first_reviewed_at,
        }))
    }

    pub(crate) fn summary_for_project(
        &mut self,
        project: Option<&str>,
    ) -> Result<KnowledgeSummary> {
        let mut conditions = vec!["c.deleted_at=''".to_string()];
        let mut values = Vec::<SqlValue>::new();
        if let Some(project) = project.map(str::trim).filter(|value| !value.is_empty()) {
            conditions.push(
                "EXISTS (
                    SELECT 1 FROM knowledge_card_projects AS filter_cp
                    INNER JOIN knowledge_projects AS filter_p ON filter_p.id=filter_cp.project_id
                    WHERE filter_cp.card_id=c.id AND filter_p.name=? COLLATE NOCASE
                )"
                .into(),
            );
            values.push(SqlValue::Text(project.to_string()));
        }
        let where_clause = conditions.join(" AND ");
        let mut summary = self.conn.query_row(
            &format!(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN trim(c.source_excerpt)='' OR (
                                          trim(c.source_date)='' AND trim(c.source_article_id)=''
                                          AND trim(c.source_review_id)='') THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN NOT EXISTS (
                            SELECT 1 FROM knowledge_card_projects AS cp WHERE cp.card_id=c.id
                        ) THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN trim(c.tags)='' OR c.tags='[]' OR c.tags='null' THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN length(trim(c.content)) < 24 THEN 1 ELSE 0 END), 0)
                 FROM knowledge_cards AS c WHERE {where_clause}"
            ),
            params_from_iter(values.iter()),
            |row| {
                Ok(KnowledgeSummary {
                    total: row.get(0)?,
                    missing_source: row.get(1)?,
                    missing_project: row.get(2)?,
                    missing_tags: row.get(3)?,
                    short_content: row.get(4)?,
                    ..KnowledgeSummary::default()
                })
            },
        )?;
        let mut statement = self.conn.prepare(&format!(
            "SELECT c.status, COUNT(*) FROM knowledge_cards AS c
             WHERE {where_clause} GROUP BY c.status"
        ))?;
        let rows = statement.query_map(params_from_iter(values.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (status, count) = row?;
            match status.as_str() {
                "draft" => summary.draft = count,
                "confirmed" => summary.confirmed = count,
                "outdated" => summary.outdated = count,
                _ => {}
            }
        }
        Ok(summary)
    }

    pub(crate) fn list_projects(&mut self) -> Result<Vec<KnowledgeProject>> {
        self.list_spaces(false)
    }

    pub(crate) fn list_spaces(&mut self, include_archived: bool) -> Result<Vec<KnowledgeProject>> {
        let status_filter = if include_archived {
            ""
        } else {
            "WHERE p.status='active'"
        };
        let mut statement = self.conn.prepare(&format!(
            "SELECT p.name,
                    (SELECT COUNT(*)
                     FROM knowledge_card_projects AS cp
                     INNER JOIN knowledge_cards AS c ON c.id=cp.card_id
                     WHERE cp.project_id=p.id AND c.deleted_at='') AS card_count,
                    (SELECT COUNT(*)
                     FROM article_spaces AS aps
                     INNER JOIN articles AS a ON a.id=aps.article_id
                     WHERE aps.space_id=p.id) AS article_count,
                    p.kind, p.description, p.status
             FROM knowledge_projects AS p
             {status_filter}
             GROUP BY p.id, p.name, p.kind, p.description, p.status
             ORDER BY CASE WHEN p.status='active' THEN 0 ELSE 1 END,
                      (card_count + article_count) DESC, p.name COLLATE NOCASE ASC"
        ))?;
        let rows = statement
            .query_map([], |row| {
                let count: i64 = row.get(1)?;
                let article_count: i64 = row.get(2)?;
                Ok(KnowledgeProject {
                    name: row.get(0)?,
                    count,
                    article_count,
                    total_count: count + article_count,
                    kind: row.get(3)?,
                    description: row.get(4)?,
                    status: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub(crate) fn list_trash(&mut self) -> Result<Vec<KnowledgeCard>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT {} FROM knowledge_cards
             WHERE deleted_at!=''
             ORDER BY updated_at DESC, created_at DESC",
            Self::SELECT_COLUMNS
        ))?;
        let mut cards = statement
            .query_map([], row_to_knowledge_card)?
            .collect::<Result<Vec<_>>>()?;
        self.resolve_related_ids(&mut cards)?;
        Ok(cards)
    }

    /// 服务端全文查询的分页入口。旧的 list() 保留给复习/关联等需要完整集合的内部流程。
    pub(crate) fn query_page(
        &mut self,
        request: KnowledgePageQuery<'_>,
    ) -> Result<(Vec<KnowledgeCard>, i64)> {
        let KnowledgePageQuery {
            query,
            card_type,
            status,
            usage,
            tag,
            project,
            quality,
            sort,
            page,
            page_size,
        } = request;
        let page = page.max(1);
        let page_size = page_size.clamp(1, 100);
        let mut conditions = vec!["c.deleted_at=''".to_string()];
        let mut values = Vec::<SqlValue>::new();

        let query = query.replace('\0', " ").trim().to_string();
        if !query.is_empty() {
            let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
            let like_query = format!("%{query}%");
            conditions.push(
                "(c.rowid IN (SELECT rowid FROM knowledge_cards_fts WHERE knowledge_cards_fts MATCH ?)
                  OR c.title LIKE ? OR c.content LIKE ?
                  OR c.tags LIKE ? OR c.source_excerpt LIKE ?)"
                    .into(),
            );
            values.extend([
                SqlValue::Text(fts_query),
                SqlValue::Text(like_query.clone()),
                SqlValue::Text(like_query.clone()),
                SqlValue::Text(like_query.clone()),
                SqlValue::Text(like_query),
            ]);
        }
        if let Some(card_type) = card_type.filter(|value| !value.is_empty()) {
            conditions.push("c.card_type=?".into());
            values.push(SqlValue::Text(card_type.to_string()));
        }
        if let Some(status) = status.filter(|value| !value.is_empty() && *value != "all") {
            conditions.push("c.status=?".into());
            values.push(SqlValue::Text(status.to_string()));
        }
        if usage == Some("never_used") {
            conditions.push("c.usage_count=0".into());
        }
        if let Some(tag) = tag.map(str::trim).filter(|value| !value.is_empty()) {
            conditions.push("c.tags LIKE ?".into());
            values.push(SqlValue::Text(format!(
                "%\"{}\"%",
                tag.replace('"', "\\\"")
            )));
        }
        if let Some(project) = project.map(str::trim).filter(|value| !value.is_empty()) {
            conditions.push(
                "EXISTS (
                    SELECT 1 FROM knowledge_card_projects AS cp
                    INNER JOIN knowledge_projects AS p ON p.id=cp.project_id
                    WHERE cp.card_id=c.id AND p.name=? COLLATE NOCASE
                )"
                .into(),
            );
            values.push(SqlValue::Text(project.to_string()));
        }
        match quality.filter(|value| !value.is_empty()) {
            Some("missing_source") => conditions.push(
                "(trim(c.source_excerpt)='' OR (trim(c.source_date)='' AND trim(c.source_article_id)='' AND trim(c.source_review_id)=''))".into(),
            ),
            Some("missing_project") => conditions.push(
                "NOT EXISTS (
                    SELECT 1 FROM knowledge_card_projects AS cp WHERE cp.card_id=c.id
                )"
                .into(),
            ),
            Some("missing_tags") => {
                conditions.push("(trim(c.tags)='' OR c.tags='[]' OR c.tags='null')".into())
            }
            Some("short_content") => conditions.push("length(trim(c.content)) < 24".into()),
            _ => {}
        }

        let order_by = match sort {
            "created" => "c.created_at DESC, c.updated_at DESC",
            "usage" => "c.usage_count DESC, c.updated_at DESC",
            "review" => "CASE WHEN c.next_review_at='' THEN 1 ELSE 0 END ASC, c.next_review_at ASC, c.updated_at DESC",
            _ => "c.updated_at DESC, c.created_at DESC",
        };
        let where_clause = conditions.join(" AND ");
        let count_sql = format!(
            "SELECT COUNT(*) FROM knowledge_cards AS c
             WHERE {where_clause}"
        );
        let total = self
            .conn
            .query_row(&count_sql, params_from_iter(values.iter()), |row| {
                row.get(0)
            })?;

        let offset = (page - 1).saturating_mul(page_size);
        let mut page_values = values;
        page_values.push(SqlValue::Integer(page_size));
        page_values.push(SqlValue::Integer(offset));
        let page_sql = format!(
            "SELECT {} FROM knowledge_cards AS c
             WHERE {where_clause}
             ORDER BY {order_by} LIMIT ? OFFSET ?",
            Self::SELECT_COLUMNS_WITH_ALIAS
        );
        let mut statement = self.conn.prepare(&page_sql)?;
        let mut cards = statement
            .query_map(params_from_iter(page_values.iter()), row_to_knowledge_card)?
            .collect::<Result<Vec<_>>>()?;
        self.resolve_related_ids(&mut cards)?;
        Ok((cards, total))
    }

    pub(crate) fn create_space(
        &mut self,
        name: &str,
        kind: &str,
        description: &str,
    ) -> Result<Option<KnowledgeProject>> {
        let Some(name) = normalize_space_name(name) else {
            return Ok(None);
        };
        if !matches!(kind, "topic" | "project") {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        self.conn.execute(
            "INSERT INTO knowledge_projects (id, name, kind, description, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)
             ON CONFLICT(name) DO UPDATE SET
               kind=excluded.kind,
               description=CASE WHEN trim(excluded.description)='' THEN knowledge_projects.description ELSE excluded.description END,
               status='active',
               updated_at=excluded.updated_at",
            params![
                Uuid::new_v4().to_string(),
                name,
                kind,
                description.trim().chars().take(500).collect::<String>(),
                now
            ],
        )?;
        self.list_projects()?
            .into_iter()
            .find(|project| project.name.eq_ignore_ascii_case(&name))
            .map(Some)
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub(crate) fn find_space(&mut self, name: &str) -> Result<Option<KnowledgeProject>> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(None);
        }
        Ok(self
            .list_spaces(true)?
            .into_iter()
            .find(|space| space.name.eq_ignore_ascii_case(name)))
    }

    pub(crate) fn update_space(
        &mut self,
        current_name: &str,
        name: &str,
        kind: &str,
        description: &str,
    ) -> Result<Option<KnowledgeProject>> {
        let Some(current_name) = normalize_space_name(current_name) else {
            return Ok(None);
        };
        let Some(name) = normalize_space_name(name) else {
            return Err(rusqlite::Error::InvalidQuery);
        };
        if !matches!(kind, "topic" | "project") {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let description = description.trim().chars().take(500).collect::<String>();
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        // `knowledge_card_projects` is the normalized relationship source, but the
        // JSON column is still read by old exports and clients. Keep both names in
        // sync when a space is renamed so a legacy reader does not show a ghost
        // space after the edit.
        let legacy_projects: Vec<(String, String)> = self
            .conn
            .prepare("SELECT id, projects FROM knowledge_cards")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_>>()?;
        let transaction = self.conn.transaction()?;
        let updated = transaction.execute(
            "UPDATE knowledge_projects
             SET name=?1, kind=?2, description=?3, updated_at=?4
             WHERE name=?5 COLLATE NOCASE",
            params![name, kind, description, now, current_name],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        for (card_id, raw_projects) in legacy_projects {
            let mut projects = parse_json_vec(&raw_projects)?;
            let mut changed = false;
            for project in &mut projects {
                if project.eq_ignore_ascii_case(&current_name) {
                    *project = name.clone();
                    changed = true;
                }
            }
            if changed {
                transaction.execute(
                    "UPDATE knowledge_cards SET projects=?1 WHERE id=?2",
                    params![serialize_string_vec(&projects)?, card_id],
                )?;
            }
        }
        transaction.commit()?;
        self.find_space(&name)
    }

    pub(crate) fn archive_space(&mut self, name: &str) -> Result<Option<KnowledgeProject>> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(None);
        }
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let updated = self.conn.execute(
            "UPDATE knowledge_projects
             SET status='archived', updated_at=?1
             WHERE name=?2 COLLATE NOCASE AND status='active'",
            params![now, name],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        self.find_space(name)
    }

    pub(crate) fn restore_space(&mut self, name: &str) -> Result<Option<KnowledgeProject>> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(None);
        }
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let updated = self.conn.execute(
            "UPDATE knowledge_projects
             SET status='active', updated_at=?1
             WHERE name=?2 COLLATE NOCASE AND status='archived'",
            params![now, name],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        self.find_space(name)
    }

    /// 永久删除一个已归档空间，但保留卡片/每日记录本身。
    ///
    /// 空间是组织容器，不是内容容器：删除空间只清理归属关系，并同步清理旧版
    /// `knowledge_cards.projects` 快照，避免旧导出继续显示一个不存在的空间。
    pub(crate) fn delete_space_permanently(&mut self, name: &str) -> Result<bool> {
        let Some(name) = normalize_space_name(name) else {
            return Ok(false);
        };
        let Some(space_id) = self
            .conn
            .query_row(
                "SELECT id FROM knowledge_projects
                 WHERE name=?1 COLLATE NOCASE AND status='archived'",
                params![name],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        else {
            return Ok(false);
        };

        let legacy_projects: Vec<(String, String)> = self
            .conn
            .prepare("SELECT id, projects FROM knowledge_cards")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_>>()?;
        let transaction = self.conn.transaction()?;
        for (card_id, raw_projects) in legacy_projects {
            let projects = parse_json_vec(&raw_projects)?;
            let project_count = projects.len();
            let next_projects: Vec<String> = projects
                .into_iter()
                .filter(|project| !project.eq_ignore_ascii_case(&name))
                .collect();
            if next_projects.len() != project_count {
                transaction.execute(
                    "UPDATE knowledge_cards SET projects=?1 WHERE id=?2",
                    params![serialize_string_vec(&next_projects)?, card_id],
                )?;
            }
        }
        transaction.execute(
            "DELETE FROM article_spaces WHERE space_id=?1",
            params![space_id],
        )?;
        transaction.execute(
            "DELETE FROM knowledge_card_projects WHERE project_id=?1",
            params![space_id],
        )?;
        let deleted = transaction.execute(
            "DELETE FROM knowledge_projects WHERE id=?1 AND status='archived'",
            params![space_id],
        )? > 0;
        transaction.commit()?;
        Ok(deleted)
    }

    /// 把单向存储的关联展开为双向视图：A 的关联 = A 声明的边 ∪ 声明指向 A 的边。
    /// 这样 A 关联 B 后，B 的详情/复习页也会显示 A，无需写端回写。
    fn resolve_related_ids(&self, cards: &mut [KnowledgeCard]) -> Result<()> {
        let active_ids: BTreeSet<String> = {
            let mut statement = self
                .conn
                .prepare("SELECT id FROM knowledge_cards WHERE deleted_at=''")?;
            let ids = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<BTreeSet<_>>>()?;
            ids
        };
        let mut reverse: BTreeMap<String, Vec<String>> = BTreeMap::new();
        {
            let mut statement = self
                .conn
                .prepare("SELECT id, related_ids FROM knowledge_cards WHERE deleted_at=''")?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>>>()?;
            for (id, raw) in rows {
                for related in parse_json_vec(&raw)? {
                    reverse.entry(related).or_default().push(id.clone());
                }
            }
        }
        for card in cards.iter_mut() {
            // 已删除卡片的关系仍保留在存储中，恢复后可以自动回来；普通视图不展示指向回收站的悬空边。
            let mut ids = card
                .related_ids
                .iter()
                .filter(|id| active_ids.contains(*id))
                .cloned()
                .collect::<Vec<_>>();
            if let Some(incoming) = reverse.get(&card.id) {
                for other in incoming {
                    if other != &card.id && !ids.contains(other) {
                        ids.push(other.clone());
                    }
                }
            }
            card.related_ids = ids;
        }
        Ok(())
    }

    pub(crate) fn due(&mut self, limit: i64, today: &str) -> Result<Vec<ReviewCard>> {
        // 到期题优先、不受每日上限；新题（next_review_at 为空）受每日配额控制。
        // 复习队列只读取 ReviewItem 的 prompt/answer，不把知识条目全文带到客户端。
        let remaining_new = self.remaining_new_quota(today)?;
        let items = {
            let mut statement = self.conn.prepare(&format!(
                "SELECT * FROM (
                   SELECT {columns} FROM review_items AS ri
                   INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
                   WHERE ri.status='active' AND c.deleted_at='' AND c.status='confirmed'
                     AND ri.next_review_at!='' AND ri.next_review_at <= ?1
                   ORDER BY ri.next_review_at ASC LIMIT ?2
                 )
                 UNION ALL
                 SELECT * FROM (
                   SELECT {columns} FROM review_items AS ri
                   INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
                   WHERE ri.status='active' AND c.deleted_at='' AND c.status='confirmed'
                     AND ri.next_review_at=''
                   ORDER BY ri.created_at ASC LIMIT ?3
                 )
                 LIMIT ?4",
                columns = Self::REVIEW_ITEM_COLUMNS_WITH_ALIAS
            ))?;
            let items = statement
                .query_map(
                    params![today, limit, remaining_new, limit],
                    row_to_review_item,
                )?
                .collect::<Result<Vec<_>>>()?;
            items
        };
        let mut cards = Vec::with_capacity(items.len());
        for item in items {
            if let Some(card) = self.review_card_from_item(item)? {
                cards.push(card);
            }
        }
        Ok(cards)
    }

    /// 今天已学新题数（首评日为今天的非归档复习题）。
    fn learned_new_today(&self, today: &str) -> Result<i64> {
        self.conn.query_row(
            "SELECT COUNT(*) FROM review_items AS ri
             INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
             WHERE ri.status!='archived' AND c.deleted_at='' AND c.status='confirmed'
               AND ri.first_reviewed_at=?1",
            params![today],
            |row| row.get(0),
        )
    }

    /// 今日新卡剩余额度 = 每日上限 - 今天已学新卡数（不低于 0）。
    fn remaining_new_quota(&self, today: &str) -> Result<i64> {
        let daily_limit = read_setting_i64(
            self.conn,
            REVIEW_NEW_DAILY_LIMIT_KEY,
            DEFAULT_REVIEW_NEW_DAILY_LIMIT,
        )?
        .clamp(0, 100);
        Ok((daily_limit - self.learned_new_today(today)?).max(0))
    }

    /// 到期题数（不含新题）与已确认知识条目总数；供 due/stats 共用，避免语义分叉。
    fn due_and_confirmed(&self, today: &str) -> Result<(i64, i64)> {
        self.conn.query_row(
            "SELECT
                (SELECT COUNT(*) FROM review_items AS ri
                 INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
                 WHERE ri.status='active' AND c.deleted_at='' AND c.status='confirmed'
                   AND ri.next_review_at!='' AND ri.next_review_at <= ?1),
                (SELECT COUNT(*) FROM knowledge_cards WHERE deleted_at='' AND status='confirmed')",
            params![today],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    pub(crate) fn stats(&mut self, today: &str) -> Result<ReviewStats> {
        let (due_only, total_confirmed) = self.due_and_confirmed(today)?;
        let remaining_new = self.remaining_new_quota(today)?;
        let new_queue: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM review_items AS ri
             INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
             WHERE ri.status='active' AND c.deleted_at='' AND c.status='confirmed'
               AND ri.next_review_at=''",
            [],
            |row| row.get(0),
        )?;
        let new_cards = new_queue.min(remaining_new);
        let reviewed_today: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM review_items AS ri
             INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
             WHERE ri.status!='archived' AND c.deleted_at='' AND ri.last_reviewed_at=?1",
            params![today],
            |row| row.get(0),
        )?;
        Ok(ReviewStats {
            due: due_only + new_cards,
            due_reviews: due_only,
            new_cards,
            reviewed_today,
            total_confirmed,
        })
    }

    pub(crate) fn apply_grade(&mut self, update: GradeUpdate<'_>) -> Result<Option<ReviewCard>> {
        let GradeUpdate {
            id,
            grade,
            stability,
            difficulty,
            interval_days,
            next_review_at,
            today,
        } = update;
        let tx = self.conn.transaction()?;
        let Some((item_id, card_id, item_source_version, prompt_snapshot, answer_snapshot)) = tx
            .query_row(
                "SELECT id, knowledge_card_id, source_version, prompt, answer
                 FROM review_items
                 WHERE (id=?1 OR knowledge_card_id=?1) AND status!='archived'
                 ORDER BY CASE WHEN id=?1 THEN 0 ELSE 1 END, created_at ASC, id ASC
                 LIMIT 1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?
        else {
            return Ok(None);
        };
        let updated = tx.execute(
            "UPDATE review_items SET review_interval_days=?1, review_ease=?2,
             review_count=review_count+1, last_reviewed_at=?3, next_review_at=?4,
             first_reviewed_at = CASE WHEN review_count = 0 THEN ?3 ELSE first_reviewed_at END,
             review_state = CASE WHEN ?1 >= 21 THEN 'mature' ELSE 'learning' END
             WHERE id=?5 AND status='active'
               AND EXISTS (
                 SELECT 1 FROM knowledge_cards AS c
                 WHERE c.id=review_items.knowledge_card_id
                   AND c.deleted_at='' AND c.status='confirmed'
               )",
            params![stability, difficulty, today, next_review_at, item_id],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        tx.execute(
            "INSERT INTO review_log
                (card_id, review_item_id, grade, interval_days, ease, next_review_at,
                 reviewed_at, review_item_source_version, prompt_snapshot, answer_snapshot)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                card_id,
                item_id,
                grade,
                interval_days,
                difficulty,
                next_review_at,
                today,
                item_source_version,
                prompt_snapshot,
                answer_snapshot,
            ],
        )?;
        let Some(item) = tx
            .query_row(
                &format!(
                    "SELECT {} FROM review_items WHERE id=?1",
                    Self::REVIEW_ITEM_COLUMNS
                ),
                params![item_id],
                row_to_review_item,
            )
            .optional()?
        else {
            return Ok(None);
        };
        // 旧客户端仍会读取知识条目上的聚合复习字段；它们只是兼容投影，
        // 真正的调度状态已经归属于 ReviewItem。
        tx.execute(
            "UPDATE knowledge_cards SET review_state=?1, review_interval_days=?2,
             review_ease=?3, review_count=?4, last_reviewed_at=?5, next_review_at=?6,
             first_reviewed_at=?7 WHERE id=?8",
            params![
                item.review_state,
                item.review_interval_days,
                item.review_ease,
                item.review_count,
                item.last_reviewed_at,
                item.next_review_at,
                item.first_reviewed_at,
                card_id,
            ],
        )?;
        tx.commit()?;
        self.review_card_from_item(item)
    }

    pub(crate) fn review_stats(&mut self, today: &str) -> Result<ReviewStatsResponse> {
        let today_date = NaiveDate::parse_from_str(today, "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(1970, 1, 1).expect("epoch date"));
        let reviewed_dates: Vec<String> = {
            let mut statement = self.conn.prepare(
                "SELECT DISTINCT review_log.reviewed_at FROM review_log
                     INNER JOIN knowledge_cards ON knowledge_cards.id=review_log.card_id
                       AND knowledge_cards.deleted_at=''
                     ORDER BY review_log.reviewed_at DESC",
            )?;
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
                "SELECT review_log.reviewed_at, COUNT(*) FROM review_log
                 INNER JOIN knowledge_cards ON knowledge_cards.id=review_log.card_id
                   AND knowledge_cards.deleted_at=''
                 WHERE review_log.reviewed_at >= ?1 GROUP BY review_log.reviewed_at",
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
                COALESCE(SUM(ri.review_count), 0),
                COALESCE(SUM(CASE WHEN ri.review_state='learning' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN ri.review_state='mature' THEN 1 ELSE 0 END), 0)
             FROM review_items AS ri
             INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
             WHERE ri.status!='archived' AND c.deleted_at=''",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )?;
        let reviewed_today: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM review_items AS ri
             INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
             WHERE ri.status!='archived' AND c.deleted_at='' AND ri.last_reviewed_at=?1",
            params![today],
            |row| row.get(0),
        )?;
        let (due_only, total_confirmed) = self.due_and_confirmed(today)?;

        // 今天可学新卡：新卡队列受每日配额（上限 - 今日已学）控制
        let new_queue: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM review_items AS ri
             INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
             WHERE ri.status='active' AND c.deleted_at='' AND c.status='confirmed'
               AND ri.next_review_at=''",
            [],
            |row| row.get(0),
        )?;
        let new_cards = new_queue.min(self.remaining_new_quota(today)?);
        let due = due_only + new_cards;

        // 未来 7 天到期预览
        let mut upcoming = Vec::with_capacity(7);
        for offset in 1..=7 {
            let date = today_date + Duration::days(offset);
            let key = date.format("%Y-%m-%d").to_string();
            let count: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM review_items AS ri
                 INNER JOIN knowledge_cards AS c ON c.id=ri.knowledge_card_id
                 WHERE ri.status='active' AND c.deleted_at='' AND c.status='confirmed'
                   AND ri.next_review_at=?1",
                params![&key],
                |row| row.get(0),
            )?;
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

    /// 单张复习题的复习历史（间隔曲线数据源）。传入旧知识条目 ID 也保持兼容。
    pub(crate) fn review_history(
        &mut self,
        item_or_card_id: &str,
    ) -> Result<Vec<ReviewHistoryEntry>> {
        let mut statement = self.conn.prepare(
            "SELECT review_log.grade, review_log.interval_days, review_log.ease,
                    review_log.next_review_at, review_log.reviewed_at,
                    review_log.prompt_snapshot, review_log.answer_snapshot,
                    review_log.review_item_source_version
             FROM review_log
             INNER JOIN knowledge_cards ON knowledge_cards.id=review_log.card_id
               AND knowledge_cards.deleted_at=''
             WHERE review_log.review_item_id=?1 OR review_log.card_id=?1
             ORDER BY review_log.reviewed_at ASC, review_log.id ASC",
        )?;
        let rows = statement
            .query_map(params![item_or_card_id], |row| {
                Ok(ReviewHistoryEntry {
                    grade: row.get(0)?,
                    interval_days: row.get(1)?,
                    ease: row.get(2)?,
                    next_review_at: row.get(3)?,
                    reviewed_at: row.get(4)?,
                    prompt_snapshot: row.get(5)?,
                    answer_snapshot: row.get(6)?,
                    review_item_source_version: row.get(7)?,
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
                "SELECT review_log.reviewed_at, COUNT(*) FROM review_log
                 INNER JOIN knowledge_cards ON knowledge_cards.id=review_log.card_id
                   AND knowledge_cards.deleted_at=''
                 WHERE review_log.reviewed_at >= ?1 GROUP BY review_log.reviewed_at",
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
            "UPDATE knowledge_cards SET usage_count=usage_count+1, last_used_at=?1
             WHERE id=?2 AND deleted_at=''",
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
            let related_ids = normalize_related_ids(&id, draft.related_ids);
            let tags = serialize_string_vec(&normalize_tags(draft.tags))?;
            let projects = normalize_space_names(draft.projects);
            for project in &projects {
                ensure_project(&transaction, project, &now)?;
            }
            transaction.execute(
                "INSERT INTO knowledge_cards (id, card_type, status, title, content, tags, projects, source_article_id, source_review_id, source_date, source_excerpt, related_ids, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                params![id, draft.card_type, draft.status, draft.title, draft.content, tags, serialize_string_vec(&projects)?,
                    draft.source_article_id, draft.source_review_id, draft.source_date, draft.source_excerpt,
                    serialize_string_vec(&related_ids)?, now],
            )?;
            if draft.status == "confirmed" {
                insert_default_review_item(
                    &transaction,
                    &id,
                    &draft.title,
                    &draft.content,
                    1,
                    &now,
                )?;
            }
            sync_project_links(&transaction, &id, &projects, &now)?;
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
        let Some((existing_content, existing_content_version)) = self
            .conn
            .query_row(
                "SELECT content, content_version FROM knowledge_cards
                 WHERE id=?1 AND deleted_at=''",
                params![id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?
        else {
            return Ok(None);
        };
        let content_changed = existing_content != draft.content;
        let content_version = if content_changed {
            existing_content_version.saturating_add(1)
        } else {
            existing_content_version
        };
        let tags = serialize_string_vec(&normalize_tags(draft.tags))?;
        let projects = normalize_space_names(draft.projects);
        let related_ids = normalize_related_ids(id, draft.related_ids);
        let projects_json = serialize_string_vec(&projects)?;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let transaction = self.conn.transaction()?;
        for project in &projects {
            ensure_project(&transaction, project, &now)?;
        }
        if transaction.execute(
            "UPDATE knowledge_cards SET card_type=?1, status=?2, title=?3, content=?4, tags=?5,
             source_article_id=?6, source_review_id=?7, source_date=?8, source_excerpt=?9,
             related_ids=?10, projects=?11, content_version=?12,
             next_review_at = CASE WHEN ?2 <> 'confirmed' THEN '' ELSE next_review_at END,
             updated_at=?13 WHERE id=?14 AND deleted_at=''",
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
                serialize_string_vec(&related_ids)?,
                projects_json,
                content_version,
                now,
                id,
            ],
        )? == 0
        {
            transaction.rollback()?;
            return Ok(None);
        }
        if content_changed {
            transaction.execute(
                "UPDATE review_items SET status=CASE WHEN status='active' THEN 'stale' ELSE status END,
                 updated_at=?1
                 WHERE knowledge_card_id=?2 AND status!='archived' AND source_version < ?3",
                params![now, id, content_version],
            )?;
        }
        if draft.status != "confirmed" {
            // 未确认的知识条目不能拥有仍显示为 active 的复习题。
            // 保留原有记忆进度，等用户重新确认后可手动恢复；若正文同时变更，
            // 上面的 source_version 检查会优先把 active 题标记为 stale，要求重新核对。
            transaction.execute(
                "UPDATE review_items SET status='suspended', updated_at=?1
                 WHERE knowledge_card_id=?2 AND status='active'",
                params![now, id],
            )?;
        }
        let has_review_items: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM review_items WHERE knowledge_card_id=?1)",
            params![id],
            |row| Ok(row.get::<_, i64>(0)? != 0),
        )?;
        if draft.status == "confirmed" && !has_review_items {
            insert_default_review_item(
                &transaction,
                id,
                &draft.title,
                &draft.content,
                content_version,
                &now,
            )?;
        }
        sync_project_links(&transaction, id, &projects, &now)?;
        transaction.commit()?;
        self.find(id)
    }

    /// 在单个事务中完成一组卡片的批量修改，避免逐张请求导致部分成功。
    pub(crate) fn batch_update(
        &mut self,
        ids: &[String],
        action: &str,
        values: &[String],
    ) -> Result<usize> {
        let ids: Vec<String> = ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let confirms_cards = action == "confirm"
            || (action == "set_status"
                && values.first().is_some_and(|status| status == "confirmed"));
        if confirms_cards {
            for id in &ids {
                let has_source: bool = self.conn.query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM knowledge_cards
                        WHERE id=?1 AND deleted_at=''
                          AND trim(source_excerpt)!=''
                          AND (trim(source_article_id)!=''
                               OR trim(source_review_id)!=''
                               OR trim(source_date)!='')
                    )",
                    params![id],
                    |row| Ok(row.get::<_, i64>(0)? != 0),
                )?;
                if !has_source {
                    return Err(rusqlite::Error::InvalidQuery);
                }
            }
        }
        let tag_values = normalize_tags(
            values
                .iter()
                .map(|value| value.trim().trim_start_matches('#').to_string())
                .collect(),
        );
        let project_values = normalize_space_names(values.to_vec());
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let transaction = self.conn.transaction()?;

        if action == "delete" {
            let mut deleted = 0;
            for id in &ids {
                deleted += transaction.execute(
                    "UPDATE knowledge_cards SET deleted_at=?1, updated_at=?1
                     WHERE id=?2 AND deleted_at=''",
                    params![now, id],
                )?;
            }
            transaction.commit()?;
            return Ok(deleted);
        }

        if action == "restore" {
            let mut restored = 0;
            for id in &ids {
                restored += transaction.execute(
                    "UPDATE knowledge_cards SET deleted_at='', updated_at=?1
                     WHERE id=?2 AND deleted_at!=''",
                    params![now, id],
                )?;
            }
            transaction.commit()?;
            return Ok(restored);
        }

        let mut updated = 0;
        for id in &ids {
            let Some((current_status, title, content, content_version, raw_tags, raw_projects)) = transaction
                .query_row(
                    "SELECT status, title, content, content_version, tags, projects FROM knowledge_cards
                     WHERE id=?1 AND deleted_at=''",
                    params![id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    },
                )
                .optional()?
            else {
                continue;
            };
            let mut status = current_status;
            let mut tags = parse_json_vec(&raw_tags)?;
            let mut projects = parse_json_vec(&raw_projects)?;
            match action {
                "confirm" => status = "confirmed".into(),
                "set_status" => status = values.first().cloned().unwrap_or(status),
                "add_tags" => {
                    tags.extend(tag_values.iter().cloned());
                    tags = normalize_tags(tags);
                }
                "remove_tags" => {
                    tags.retain(|tag| {
                        !tag_values
                            .iter()
                            .any(|value| value.eq_ignore_ascii_case(tag))
                    });
                }
                "add_projects" => {
                    projects.extend(project_values.iter().cloned());
                    projects = normalize_space_names(projects);
                }
                "set_projects" => projects = project_values.clone(),
                "remove_projects" => {
                    projects.retain(|project| {
                        !project_values
                            .iter()
                            .any(|value| value.eq_ignore_ascii_case(project))
                    });
                }
                _ => unreachable!(),
            }
            for project in &projects {
                ensure_project(&transaction, project, &now)?;
            }
            transaction.execute(
                "UPDATE knowledge_cards SET status=?1, tags=?2, projects=?3,
                 next_review_at = CASE WHEN ?1 <> 'confirmed' THEN '' ELSE next_review_at END,
                 updated_at=?4 WHERE id=?5 AND deleted_at=''",
                params![
                    status,
                    serialize_string_vec(&tags)?,
                    serialize_string_vec(&projects)?,
                    now,
                    id
                ],
            )?;
            if status != "confirmed" {
                transaction.execute(
                    "UPDATE review_items SET status='suspended', updated_at=?1
                     WHERE knowledge_card_id=?2 AND status='active'",
                    params![now, id],
                )?;
            } else {
                let has_review_items: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM review_items WHERE knowledge_card_id=?1)",
                    params![id],
                    |row| Ok(row.get::<_, i64>(0)? != 0),
                )?;
                if !has_review_items {
                    insert_default_review_item(
                        &transaction,
                        id,
                        &title,
                        &content,
                        content_version,
                        &now,
                    )?;
                }
            }
            sync_project_links(&transaction, id, &projects, &now)?;
            updated += 1;
        }
        transaction.commit()?;
        Ok(updated)
    }

    pub(crate) fn delete(&mut self, id: &str) -> Result<bool> {
        let tx = self.conn.transaction()?;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let deleted = tx.execute(
            "UPDATE knowledge_cards SET deleted_at=?1, updated_at=?1
             WHERE id=?2 AND deleted_at=''",
            params![now, id],
        )? > 0;
        tx.commit()?;
        Ok(deleted)
    }
}

fn serialize_string_vec(values: &[String]) -> Result<String> {
    serde_json::to_string(values).map_err(json_to_sql_error)
}

fn json_to_sql_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

fn ensure_project(transaction: &Transaction<'_>, name: &str, now: &str) -> Result<()> {
    transaction.execute(
        "INSERT OR IGNORE INTO knowledge_projects (id, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)",
        params![Uuid::new_v4().to_string(), name, now],
    )?;
    Ok(())
}

fn sync_article_space_links(
    transaction: &Transaction<'_>,
    article_id: &str,
    spaces: &[String],
    now: &str,
) -> Result<()> {
    transaction.execute(
        "DELETE FROM article_spaces WHERE article_id=?1",
        params![article_id],
    )?;
    for space in spaces {
        ensure_project(transaction, space, now)?;
        let space_id: String = transaction.query_row(
            "SELECT id FROM knowledge_projects WHERE name=?1 COLLATE NOCASE",
            params![space],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO article_spaces (article_id, space_id)
             VALUES (?1, ?2)",
            params![article_id, space_id],
        )?;
    }
    Ok(())
}

fn resolve_article_spaces(conn: &Connection, article: &mut Article) -> Result<()> {
    let mut statement = conn.prepare(
        "SELECT p.name
         FROM article_spaces AS aps
         INNER JOIN knowledge_projects AS p ON p.id=aps.space_id
         WHERE aps.article_id=?1
         ORDER BY p.name COLLATE NOCASE ASC",
    )?;
    article.spaces = statement
        .query_map(params![article.id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>>>()?;
    Ok(())
}

fn sync_project_links(
    transaction: &Transaction<'_>,
    card_id: &str,
    projects: &[String],
    now: &str,
) -> Result<()> {
    transaction.execute(
        "DELETE FROM knowledge_card_projects WHERE card_id=?1",
        params![card_id],
    )?;
    for project in projects {
        ensure_project(transaction, project, now)?;
        let project_id: String = transaction.query_row(
            "SELECT id FROM knowledge_projects WHERE name=?1 COLLATE NOCASE",
            params![project],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO knowledge_card_projects (card_id, project_id)
             VALUES (?1, ?2)",
            params![card_id, project_id],
        )?;
    }
    Ok(())
}

fn valid_knowledge_draft(draft: &KnowledgeCardDraft) -> bool {
    matches!(draft.status.as_str(), "draft" | "confirmed" | "outdated")
        && matches!(
            draft.card_type.as_str(),
            "fact" | "method" | "concept" | "decision" | "case" | "quote" | "principle" | "snippet"
        )
        && !draft.title.trim().is_empty()
        && draft.title.trim().chars().count() <= MAX_KNOWLEDGE_CARD_TITLE_CHARS
        && !draft.content.trim().is_empty()
        && draft.content.trim().chars().count() <= MAX_KNOWLEDGE_CARD_CONTENT_CHARS
}

/// 为新确认知识创建一条兼容性的基础复习题。
///
/// 它只是候选题：正文超过短答案阈值时默认暂停，用户可以在知识页继续拆分成多道题。
fn insert_default_review_item(
    transaction: &Transaction<'_>,
    card_id: &str,
    title: &str,
    content: &str,
    source_version: i64,
    now: &str,
) -> Result<()> {
    let status = if content.trim().chars().count() <= 480 {
        "active"
    } else {
        "suspended"
    };
    transaction.execute(
        "INSERT INTO review_items
            (id, knowledge_card_id, item_type, status, prompt, answer, hint,
             source_version, created_at, updated_at)
         VALUES (?1, ?2, 'basic', ?3, ?4, ?5, '', ?6, ?7, ?7)",
        params![
            Uuid::new_v4().to_string(),
            card_id,
            status,
            title,
            content,
            source_version,
            now,
        ],
    )?;
    Ok(())
}

pub(crate) fn valid_review_item_draft(draft: &ReviewItemDraft) -> bool {
    matches!(
        draft.item_type.as_str(),
        "basic" | "cloze" | "code" | "compare" | "scenario"
    ) && matches!(draft.status.as_str(), "active" | "suspended" | "stale")
        && !draft.prompt.trim().is_empty()
        && !draft.answer.trim().is_empty()
        && draft.prompt.trim().chars().count() <= 500
        && draft.answer.trim().chars().count() <= 12000
        && draft.hint.trim().chars().count() <= 1000
}

fn validate_archive(archive: &PortableArchiveInput) -> std::result::Result<(), ArchiveImportError> {
    if !(1..=3).contains(&archive.version) {
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
            || card.title.trim().is_empty()
            || card.title.trim().chars().count() > MAX_KNOWLEDGE_CARD_TITLE_CHARS
            || card.content.trim().is_empty()
            || card.content.trim().chars().count() > MAX_KNOWLEDGE_CARD_CONTENT_CHARS
            || card.deleted_at.chars().count() > 64
            || !matches!(card.status.as_str(), "draft" | "confirmed" | "outdated")
            || !matches!(
                card.card_type.as_str(),
                "fact"
                    | "method"
                    | "concept"
                    | "decision"
                    | "case"
                    | "quote"
                    | "principle"
                    | "snippet"
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
    if archive.review_items.iter().any(|item| {
        item.id.trim().is_empty()
            || !card_ids.contains_key(&item.knowledge_card_id)
            || !matches!(
                item.item_type.as_str(),
                "basic" | "cloze" | "code" | "compare" | "scenario"
            )
            || !matches!(
                item.status.as_str(),
                "active" | "suspended" | "stale" | "archived"
            )
            || item.prompt.trim().is_empty()
            || item.answer.trim().is_empty()
            || item.prompt.trim().chars().count() > 500
            || item.answer.trim().chars().count() > 12000
            || item.hint.trim().chars().count() > 1000
            || item.source_version < 1
            || item.review_count < 0
            || !item.review_interval_days.is_finite()
            || item.review_interval_days < 0.0
            || !item.review_ease.is_finite()
    }) {
        return Err(ArchiveImportError::Invalid(
            "Invalid review item in portable archive".into(),
        ));
    }
    let mut review_item_ids = BTreeMap::new();
    if archive
        .review_items
        .iter()
        .any(|item| review_item_ids.insert(&item.id, ()).is_some())
    {
        return Err(ArchiveImportError::Invalid(
            "Duplicate review item id in portable archive".into(),
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

fn default_content_version() -> i64 {
    1
}

fn default_draft() -> String {
    "draft".into()
}

fn default_card_type() -> String {
    "fact".into()
}

fn default_review_item_type() -> String {
    "basic".into()
}

fn default_review_item_status() -> String {
    "suspended".into()
}

fn default_review_ease() -> f64 {
    2.5
}

fn default_review_state() -> String {
    "new".into()
}

const MAX_SPACE_NAME_CHARS: usize = 80;
const MAX_SPACE_COUNT: usize = 12;

fn normalize_space_name(value: &str) -> Option<String> {
    let name = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_SPACE_NAME_CHARS)
        .collect::<String>();
    (!name.is_empty()).then_some(name)
}

fn normalize_space_names(values: Vec<String>) -> Vec<String> {
    let mut result = Vec::new();
    for value in values {
        let Some(name) = normalize_space_name(&value) else {
            continue;
        };
        if !result
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&name))
        {
            result.push(name);
        }
        if result.len() == MAX_SPACE_COUNT {
            break;
        }
    }
    result
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

fn normalize_related_ids(card_id: &str, values: Vec<String>) -> Vec<String> {
    let mut result = Vec::new();
    for value in values {
        let related_id = value.trim().to_string();
        if related_id.is_empty()
            || related_id == card_id
            || related_id.chars().count() > MAX_KNOWLEDGE_RELATED_ID_CHARS
            || result.contains(&related_id)
        {
            continue;
        }
        result.push(related_id);
        if result.len() == MAX_KNOWLEDGE_RELATED_IDS {
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
        spaces: Vec::new(),
    })
}

fn row_to_article_summary(row: &rusqlite::Row<'_>) -> Result<ArticleSummary> {
    let tags: String = row.get(4)?;
    let content: String = row.get(6)?;
    let spaces: String = row.get(7)?;
    Ok(ArticleSummary {
        id: row.get(0)?,
        date: row.get(1)?,
        title: row.get(2)?,
        mood: row.get(3)?,
        tags: parse_json_vec(&tags)?,
        spaces: parse_json_vec(&spaces)?,
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
        content_version: row.get(12)?,
        review_state: row.get(13)?,
        review_interval_days: row.get(14)?,
        review_ease: row.get(15)?,
        review_count: row.get(16)?,
        last_reviewed_at: row.get(17)?,
        next_review_at: row.get(18)?,
        usage_count: row.get(19)?,
        last_used_at: row.get(20)?,
        related_ids: parse_json_vec(&row.get::<_, String>(21)?)?,
        declared_related_ids: parse_json_vec(&row.get::<_, String>(21)?)?,
        first_reviewed_at: row.get(22)?,
        projects: parse_json_vec(&row.get::<_, String>(23)?)?,
    })
}

fn row_to_review_item(row: &rusqlite::Row<'_>) -> Result<ReviewItem> {
    Ok(ReviewItem {
        id: row.get(0)?,
        knowledge_card_id: row.get(1)?,
        item_type: row.get(2)?,
        status: row.get(3)?,
        prompt: row.get(4)?,
        answer: row.get(5)?,
        hint: row.get(6)?,
        source_version: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        review_state: row.get(10)?,
        review_interval_days: row.get(11)?,
        review_ease: row.get(12)?,
        review_count: row.get(13)?,
        last_reviewed_at: row.get(14)?,
        next_review_at: row.get(15)?,
        first_reviewed_at: row.get(16)?,
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
    use crate::models::AiModelProfile;

    #[test]
    fn removes_legacy_saved_view_storage() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_version (version INTEGER NOT NULL);
             INSERT INTO schema_version (version) VALUES (21);
             CREATE TABLE knowledge_saved_views (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 filters TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE INDEX idx_knowledge_saved_views_updated
                 ON knowledge_saved_views(updated_at DESC);",
        )
        .unwrap();

        let db = Database { conn };
        db.initialize().unwrap();

        let table_exists: i64 = db
            .conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master
                    WHERE type = 'table' AND name = 'knowledge_saved_views'
                )",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_exists, 0);

        let version: i64 = db
            .conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 22);
    }

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

    fn v15_schema_with_orphaned_review_log() -> &'static str {
        "CREATE TABLE schema_version (version INTEGER NOT NULL);
         INSERT INTO schema_version (version) VALUES (15);
         CREATE TABLE articles (
             id TEXT PRIMARY KEY,
             date TEXT NOT NULL,
             title TEXT NOT NULL DEFAULT '',
             content TEXT NOT NULL DEFAULT '',
             mood TEXT NOT NULL DEFAULT '',
             tags TEXT NOT NULL DEFAULT '[]',
             word_count INTEGER NOT NULL DEFAULT 0,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
         CREATE TABLE knowledge_cards (
             id TEXT PRIMARY KEY,
             card_type TEXT NOT NULL,
             status TEXT NOT NULL,
             title TEXT NOT NULL,
             content TEXT NOT NULL,
             tags TEXT NOT NULL DEFAULT '[]',
             source_article_id TEXT NOT NULL DEFAULT '',
             source_review_id TEXT NOT NULL DEFAULT '',
             source_date TEXT NOT NULL DEFAULT '',
             source_excerpt TEXT NOT NULL DEFAULT '',
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             review_state TEXT NOT NULL DEFAULT 'new',
             review_interval_days REAL NOT NULL DEFAULT 0,
             review_ease REAL NOT NULL DEFAULT 2.5,
             review_count INTEGER NOT NULL DEFAULT 0,
             last_reviewed_at TEXT NOT NULL DEFAULT '',
             next_review_at TEXT NOT NULL DEFAULT '',
             usage_count INTEGER NOT NULL DEFAULT 0,
             last_used_at TEXT NOT NULL DEFAULT '',
             related_ids TEXT NOT NULL DEFAULT '[]',
             first_reviewed_at TEXT NOT NULL DEFAULT '',
             projects TEXT NOT NULL DEFAULT '[]'
         );
         CREATE TABLE knowledge_projects (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL COLLATE NOCASE UNIQUE,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
         CREATE TABLE review_log (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             card_id TEXT NOT NULL,
             grade TEXT NOT NULL,
             interval_days REAL NOT NULL,
             ease REAL NOT NULL,
             next_review_at TEXT NOT NULL,
             reviewed_at TEXT NOT NULL
         );
         INSERT INTO knowledge_cards
             (id, card_type, status, title, content, created_at, updated_at)
         VALUES
             ('existing-card', 'fact', 'confirmed', '现存卡片', '可复习内容',
              '2026-08-01T09:00:00', '2026-08-01T09:00:00');
         INSERT INTO review_log
             (card_id, grade, interval_days, ease, next_review_at, reviewed_at)
         VALUES
             ('existing-card', 'good', 3, 2.5, '2026-08-04', '2026-08-01'),
             ('deleted-card', 'good', 3, 2.5, '2026-08-04', '2026-08-01');"
    }

    #[test]
    fn v15_database_migration_keeps_review_logs_for_deleted_cards() {
        let conn = Connection::open_in_memory().expect("in-memory connection");
        conn.execute_batch(v15_schema_with_orphaned_review_log())
            .expect("create v15 schema with orphaned review log");

        let db = Database { conn };
        db.initialize()
            .expect("orphaned review history must not block migration");

        let existing_review_item_id: String = db
            .conn
            .query_row(
                "SELECT review_item_id FROM review_log WHERE card_id='existing-card'",
                [],
                |row| row.get(0),
            )
            .expect("read migrated review log");
        assert!(!existing_review_item_id.is_empty());

        let review_item_id: String = db
            .conn
            .query_row(
                "SELECT review_item_id FROM review_log WHERE card_id='deleted-card'",
                [],
                |row| row.get(0),
            )
            .expect("read migrated orphaned review log");
        assert!(
            review_item_id.is_empty(),
            "an orphaned log has no review item, but remains preserved"
        );
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM review_log", [], |row| row
                    .get::<_, i64>(0))
                .expect("count migrated review logs"),
            2
        );
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
        db.initialize().expect("migrate to latest schema");

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
        assert_eq!(version, 22);

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
                projects: vec![],
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
        assert_eq!(version, 22);

        let settings = db.review_settings().expect("default review settings");
        assert_eq!(settings.new_cards_per_day, 20);
        assert_eq!(settings.session_limit, 20);
    }

    #[test]
    fn review_settings_use_safe_defaults_and_persist_updates() {
        let mut db = Database::new_in_memory().expect("in-memory database");
        let updated = db
            .update_review_settings(&ReviewSettings {
                new_cards_per_day: 0,
                session_limit: 8,
            })
            .expect("persist review settings");
        assert_eq!(updated.new_cards_per_day, 0);
        assert_eq!(updated.session_limit, 8);
        assert_eq!(
            db.review_settings().expect("reload review settings"),
            updated
        );

        db.initialize()
            .expect("re-initialize keeps review settings");
        assert_eq!(
            db.review_settings().expect("settings after re-init"),
            updated
        );
    }

    #[test]
    fn ai_settings_persist_the_runtime_configuration() {
        let mut db = Database::new_in_memory().expect("in-memory database");
        let config = AiConfig {
            api_key: "test-api-key".into(),
            base_url: "https://example.test/v1".into(),
            model: "test-model".into(),
            temperature: 0.7,
            max_tokens: 2048,
            timeout_secs: 30,
            retries: 3,
            min_interval_ms: 250,
        };

        let saved = db
            .update_ai_config(&config, true)
            .expect("persist AI settings");
        assert_eq!(saved.api_key, "test-api-key");
        assert_eq!(saved.base_url, "https://example.test/v1");
        assert_eq!(saved.model, "test-model");
        assert_eq!(saved.temperature, 0.7);
        assert_eq!(saved.max_tokens, 2048);
        assert_eq!(saved.timeout_secs, 30);
        assert_eq!(saved.retries, 3);
        assert_eq!(saved.min_interval_ms, 250);
        assert_eq!(
            db.ai_api_key_source().expect("read AI key source"),
            "settings"
        );

        db.initialize().expect("re-initialize keeps AI settings");
        let reloaded = db.ai_config().expect("reload AI settings");
        assert_eq!(reloaded.api_key, "test-api-key");
        assert_eq!(reloaded.model, "test-model");
    }

    #[test]
    fn knowledge_summary_filters_by_space() {
        let mut db = Database::new_in_memory().expect("in-memory database");
        let draft = |title: &str, status: &str, project: &str| KnowledgeCardDraft {
            card_type: "fact".into(),
            status: status.into(),
            title: title.into(),
            content: "这是一段足够长的内容，用于验证空间摘要筛选不会混入其他空间。".into(),
            tags: vec!["测试".into()],
            source_article_id: String::new(),
            source_review_id: String::new(),
            source_date: "2026-08-28".into(),
            source_excerpt: "测试来源".into(),
            related_ids: vec![],
            projects: vec![project.into()],
        };

        db.knowledge()
            .save_many(vec![
                draft("C++ 卡片", "confirmed", "C++"),
                draft("FPGA 卡片", "draft", "FPGA-DIAG"),
            ])
            .expect("save cards in separate spaces");

        let cpp = db
            .knowledge()
            .summary_for_project(Some("C++"))
            .expect("summarize selected space");
        assert_eq!(cpp.total, 1);
        assert_eq!(cpp.confirmed, 1);
        assert_eq!(cpp.draft, 0);

        let all = db
            .knowledge()
            .summary_for_project(None)
            .expect("summarize all spaces");
        assert_eq!(all.total, 2);
        assert_eq!(all.confirmed, 1);
        assert_eq!(all.draft, 1);
    }

    #[test]
    fn ai_routing_defaults_and_persisted_profiles_resolve_by_task() {
        let mut db = Database::new_in_memory().expect("in-memory database");
        let defaults = db.ai_routing().expect("default AI routing");
        assert_eq!(defaults.profiles.len(), 2);
        assert_eq!(defaults.routes.get("daily_summary"), Some(&"fast".into()));
        assert_eq!(
            defaults.routes.get("knowledge_extract"),
            Some(&"fast".into())
        );
        assert_eq!(defaults.routes.get("weekly_review"), Some(&"pro".into()));

        let routing = AiRoutingConfig {
            profiles: vec![
                AiModelProfile {
                    id: "fast".into(),
                    name: "快速模型".into(),
                    model: "deepseek-flash".into(),
                    temperature: 0.1,
                    max_tokens: 1200,
                    timeout_secs: 20,
                    retries: 1,
                    min_interval_ms: 200,
                },
                AiModelProfile {
                    id: "pro".into(),
                    name: "高质量模型".into(),
                    model: "deepseek-pro".into(),
                    temperature: 0.4,
                    max_tokens: 5000,
                    timeout_secs: 60,
                    retries: 2,
                    min_interval_ms: 500,
                },
            ],
            routes: BTreeMap::from([
                ("daily_summary".into(), "fast".into()),
                ("knowledge_extract".into(), "fast".into()),
                ("weekly_review".into(), "pro".into()),
                ("monthly_review".into(), "pro".into()),
            ]),
            fallback_profile: "fast".into(),
        };
        db.update_ai_routing(&routing).expect("persist AI routing");

        let (config, profile_id) = db
            .ai_config_for_task(AiTask::WeeklyReview)
            .expect("resolve weekly review route");
        assert_eq!(profile_id, "pro");
        assert_eq!(config.model, "deepseek-pro");
        assert_eq!(config.max_tokens, 5000);

        let (config, profile_id) = db
            .ai_config_for_task(AiTask::KnowledgeExtract)
            .expect("resolve knowledge extraction route");
        assert_eq!(profile_id, "fast");
        assert_eq!(config.model, "deepseek-flash");
        assert_eq!(config.max_tokens, 1200);

        db.initialize().expect("re-initialize keeps AI routing");
        assert_eq!(
            db.ai_routing().expect("reload AI routing").fallback_profile,
            "fast"
        );
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
        assert_eq!(version, 22);
        db.initialize()
            .expect("re-initialize after v5 is idempotent");
    }
}
