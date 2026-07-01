use crate::ai;
use crate::archive;
use crate::articles;
use crate::backups;
use crate::day_exemptions;
use crate::db::Database;
use crate::exports;
use crate::helpers::{backups_dir, now};
use crate::knowledge;
use crate::middleware::{add_security_headers, configured_cors, require_api_token};
use crate::models::*;
use crate::stats;

use axum::{extract::State, http::StatusCode, middleware, response::Json, Router};
use rusqlite::params;
use std::sync::{Arc, Mutex};
use tower_http::services::ServeDir;
use uuid::Uuid;

type AppState = Arc<Mutex<Database>>;

const BUILD_TIME: &str = env!("BUILD_TIMESTAMP");

async fn health_check() -> Json<serde_json::Value> {
    let ai = std::env::var("DAILY_SUMMARY_AI_API_KEY").map(|k| !k.is_empty()).unwrap_or(false);
    let ai_model = std::env::var("DAILY_SUMMARY_AI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
    let ai_base_url = std::env::var("DAILY_SUMMARY_AI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
    let ai_temperature = std::env::var("DAILY_SUMMARY_AI_TEMPERATURE").unwrap_or_else(|_| "0.2".to_string());
    let ai_max_tokens = std::env::var("DAILY_SUMMARY_AI_MAX_TOKENS").unwrap_or_else(|_| "unlimited".to_string());
    let ai_timeout_secs = std::env::var("DAILY_SUMMARY_AI_TIMEOUT_SECS").unwrap_or_else(|_| "45".to_string());
    let ai_retries = std::env::var("DAILY_SUMMARY_AI_RETRIES").unwrap_or_else(|_| "2".to_string());
    let ai_min_interval_ms = std::env::var("DAILY_SUMMARY_AI_MIN_INTERVAL_MS").unwrap_or_else(|_| "1200".to_string());
    let db_path = Database::db_path();
    let db_exists = db_path.exists();
    let db_size = db_exists.then(|| std::fs::metadata(&db_path).ok().map(|m| m.len())).flatten().unwrap_or(0);
    let last_backup = backups_dir().join("daily-summary-latest.db");
    let last_backup_time = last_backup.exists().then(|| {
        std::fs::metadata(&last_backup).ok().and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Utc> = t.into();
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            })
    }).flatten();
    Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "build": BUILD_TIME,
        "features": { "ai": ai, "reviews": true, "knowledge": true, "exports": true, "backups": true },
        "ai_config": {
            "configured": ai,
            "model": ai_model,
            "base_url": ai_base_url,
            "temperature": ai_temperature,
            "max_tokens": ai_max_tokens,
            "timeout_secs": ai_timeout_secs,
            "retries": ai_retries,
            "min_interval_ms": ai_min_interval_ms
        },
        "db_path": db_path.to_string_lossy(),
        "db_size": db_size,
        "last_backup": last_backup_time
    }))
}

async fn export_full(
    State(db): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut articles_json = Vec::new();
    {
        let mut stmt = db.conn().prepare("SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at FROM articles ORDER BY date ASC")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?, "date": row.get::<_, String>(1)?, "title": row.get::<_, String>(2)?,
                "content": row.get::<_, String>(3)?, "mood": row.get::<_, String>(4)?, "tags": row.get::<_, String>(5)?,
                "word_count": row.get::<_, i64>(6)?, "created_at": row.get::<_, String>(7)?, "updated_at": row.get::<_, String>(8)?,
            }))
        }).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        for row in rows { articles_json.push(row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?); }
    }
    let mut reviews_json = Vec::new();
    {
        let mut stmt = db.conn().prepare("SELECT id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at FROM reviews ORDER BY period_start ASC")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?, "kind": row.get::<_, String>(1)?, "period_start": row.get::<_, String>(2)?,
                "period_end": row.get::<_, String>(3)?, "version": row.get::<_, i64>(4)?, "status": row.get::<_, String>(5)?,
                "title": row.get::<_, String>(6)?, "content": row.get::<_, String>(7)?,
                "source_article_ids": row.get::<_, String>(8)?, "source_review_ids": row.get::<_, String>(9)?,
                "model": row.get::<_, String>(10)?, "generated_at": row.get::<_, String>(11)?, "updated_at": row.get::<_, String>(12)?,
            }))
        }).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        for row in rows { reviews_json.push(row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?); }
    }
    let mut knowledge_cards_json = Vec::new();
    {
        let mut stmt = db.conn().prepare("SELECT id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at FROM knowledge_cards ORDER BY updated_at ASC")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?, "card_type": row.get::<_, String>(1)?, "status": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?, "content": row.get::<_, String>(4)?, "tags": row.get::<_, String>(5)?,
                "source_article_id": row.get::<_, String>(6)?, "source_review_id": row.get::<_, String>(7)?,
                "source_date": row.get::<_, String>(8)?, "source_excerpt": row.get::<_, String>(9)?,
                "created_at": row.get::<_, String>(10)?, "updated_at": row.get::<_, String>(11)?,
            }))
        }).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        for row in rows { knowledge_cards_json.push(row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?); }
    }
    Ok(Json(serde_json::json!({ "version": 2, "articles": articles_json, "reviews": reviews_json, "knowledge_cards": knowledge_cards_json })))
}

async fn import_full(
    State(db): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut imported_articles = 0u32;
    let mut imported_reviews = 0u32;

    if let Some(articles) = payload.get("articles").and_then(|a| a.as_array()) {
        for item in articles {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if id.is_empty() { continue; }
            let date = item.get("date").and_then(|v| v.as_str()).unwrap_or("");
            let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let content = item.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let mood = item.get("mood").and_then(|v| v.as_str()).unwrap_or("");
            let tags = item.get("tags").and_then(|v| v.as_str()).unwrap_or("[]");
            let wc = item.get("word_count").and_then(|v| v.as_i64()).unwrap_or(0);
            let ca = item.get("created_at").and_then(|v| v.as_str()).unwrap_or("");
            let ua = item.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            db.conn().execute(
                "INSERT OR REPLACE INTO articles (id, date, title, content, mood, tags, word_count, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![id, date, title, content, mood, tags, wc, ca, ua],
            ).ok();
            imported_articles += 1;
        }
    }

    if let Some(reviews) = payload.get("reviews").and_then(|r| r.as_array()) {
        for item in reviews {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if id.is_empty() { continue; }
            let kind = item.get("kind").and_then(|v| v.as_str()).unwrap_or("weekly");
            let ps = item.get("period_start").and_then(|v| v.as_str()).unwrap_or("");
            let pe = item.get("period_end").and_then(|v| v.as_str()).unwrap_or("");
            let ver = item.get("version").and_then(|v| v.as_i64()).unwrap_or(1);
            let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("draft");
            let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let content = item.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let sai = item.get("source_article_ids").and_then(|v| v.as_str()).unwrap_or("[]");
            let sri = item.get("source_review_ids").and_then(|v| v.as_str()).unwrap_or("[]");
            let model = item.get("model").and_then(|v| v.as_str()).unwrap_or("");
            let ga = item.get("generated_at").and_then(|v| v.as_str()).unwrap_or("");
            let ua = item.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            db.conn().execute(
                "INSERT OR REPLACE INTO reviews (id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![id, kind, ps, pe, ver, status, title, content, sai, sri, model, ga, ua],
            ).ok();
            imported_reviews += 1;
        }
    }

    let mut imported_knowledge_cards = 0u32;
    if let Some(cards) = payload.get("knowledge_cards").and_then(|r| r.as_array()) {
        for item in cards {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if id.is_empty() { continue; }
            let card_type = item.get("card_type").and_then(|v| v.as_str()).unwrap_or("fact");
            let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("draft");
            let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let content = item.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let tags = item.get("tags").and_then(|v| v.as_str()).unwrap_or("[]");
            let source_article_id = item.get("source_article_id").and_then(|v| v.as_str()).unwrap_or("");
            let source_review_id = item.get("source_review_id").and_then(|v| v.as_str()).unwrap_or("");
            let source_date = item.get("source_date").and_then(|v| v.as_str()).unwrap_or("");
            let source_excerpt = item.get("source_excerpt").and_then(|v| v.as_str()).unwrap_or("");
            let created_at = item.get("created_at").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = item.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            db.conn().execute(
                "INSERT OR REPLACE INTO knowledge_cards (id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at],
            ).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            imported_knowledge_cards += 1;
        }
    }

    Ok(Json(serde_json::json!({ "imported_articles": imported_articles, "imported_reviews": imported_reviews, "imported_knowledge_cards": imported_knowledge_cards })))
}

async fn import_articles(
    State(db): State<AppState>,
    Json(payload): Json<Vec<CreateArticlePayload>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut imported = 0u32;
    let mut skipped = 0u32;
    for item in payload {
        if item.content.trim().is_empty() { skipped += 1; continue; }
        let id = Uuid::new_v4().to_string();
        let n = now();
        let tags = item.tags.unwrap_or_else(|| "[]".into());
        let wc = item.content.chars().filter(|c| !c.is_whitespace()).count() as i64;
        db.conn().execute(
            "INSERT INTO articles (id,date,title,content,mood,tags,word_count,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![id, item.date, item.title, item.content, item.mood, tags, wc, n, n],
        ).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        imported += 1;
    }
    Ok(Json(serde_json::json!({ "imported": imported, "skipped": skipped })))
}

fn build_router(db: Database) -> Router {
    let state: AppState = Arc::new(Mutex::new(db));

    let api_router = Router::new()
        .route("/articles", axum::routing::get(articles::list_articles).post(articles::create_article))
        .route("/articles/today", axum::routing::get(articles::get_today_article))
        .route("/articles/search", axum::routing::get(articles::search_articles))
        .route("/articles/:id", axum::routing::get(articles::get_article).put(articles::update_article).delete(articles::delete_article))
        .route("/archive/months", axum::routing::get(archive::get_archive_months))
        .route("/archive/:year/:month", axum::routing::get(archive::get_articles_by_month))
        .route("/stats/overview", axum::routing::get(stats::get_stats_overview))
        .route("/stats/month", axum::routing::get(stats::get_month_stats))
        .route("/stats/week", axum::routing::get(stats::get_week_review))
        .route("/day-exemptions", axum::routing::get(day_exemptions::list_day_exemptions))
        .route("/day-exemptions/:date", axum::routing::put(day_exemptions::upsert_day_exemption).delete(day_exemptions::delete_day_exemption))
        .route("/export/md", axum::routing::post(exports::export_markdown))
        .route("/export/json", axum::routing::post(exports::export_json))
        .route("/export/zip", axum::routing::post(exports::export_zip))
        .route("/export/pdf", axum::routing::post(exports::export_pdf))
        .route("/backups", axum::routing::get(backups::list_backups).post(backups::create_backup))
        .route("/backups/:name", axum::routing::delete(backups::delete_backup))
        .route("/backups/:name/download", axum::routing::get(backups::download_backup))
        .route("/reviews", axum::routing::get(ai::list_reviews))
        .route("/reviews/generate", axum::routing::post(ai::generate_review))
        .route("/reviews/:id", axum::routing::get(ai::get_review).put(ai::update_review).delete(ai::delete_review))
        .route("/knowledge-cards", axum::routing::get(knowledge::list_cards).post(knowledge::create_card))
        .route("/knowledge-cards/extract", axum::routing::post(knowledge::extract_cards))
        .route("/knowledge-cards/:id", axum::routing::get(knowledge::get_card).put(knowledge::update_card).delete(knowledge::delete_card))
        .route("/ai/summary", axum::routing::post(ai::ai_summary))
        .route("/articles/import", axum::routing::post(import_articles))
        .route("/articles/import-full", axum::routing::post(import_full))
        .route("/export/full", axum::routing::post(export_full))
        .with_state(state)
        .route_layer(middleware::from_fn(require_api_token));

    Router::new()
        .route("/health", axum::routing::get(health_check))
        .nest("/api", api_router)
        .layer(configured_cors())
        .layer(middleware::from_fn(add_security_headers))
        .fallback_service(ServeDir::new("../dist"))
}

pub async fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let router = build_router(db);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.expect("Failed to bind port 8080");
    println!("📓 每日总结服务端已启动 → http://0.0.0.0:8080");
    axum::serve(listener, router).await.expect("Server error");
}
