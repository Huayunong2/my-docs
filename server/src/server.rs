use crate::ai;
use crate::ai_client::ai_health;
use crate::archive;
use crate::articles;
use crate::backups;
use crate::day_exemptions;
use crate::db::{ArchiveImportError, ArticleDraft, Database};
use crate::exports;
use crate::helpers::{app_data_dir, backups_dir};
use crate::knowledge;
use crate::middleware::{add_security_headers, configured_cors, require_api_token};
use crate::models::*;
use crate::stats;

use axum::{extract::State, http::StatusCode, middleware, response::Json, Router};
use std::sync::{Arc, Mutex, OnceLock};
use tower_http::services::ServeDir;

type AppState = Arc<Mutex<Database>>;

const BUILD_TIME: &str = env!("BUILD_TIMESTAMP");
static DATABASE_HEALTH_CACHE: OnceLock<Mutex<(u64, String)>> = OnceLock::new();

fn maintenance_timestamp(name: &str) -> Option<u64> {
    std::fs::read_to_string(app_data_dir().join("status").join(name))
        .ok()
        .and_then(|value| value.trim().parse().ok())
}

fn cached_database_integrity(db: &AppState) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let cache = DATABASE_HEALTH_CACHE.get_or_init(|| Mutex::new((0, "unavailable".into())));
    let mut cached = match cache.lock() {
        Ok(cached) => cached,
        Err(_) => return "unavailable".into(),
    };
    if now.saturating_sub(cached.0) < 300 {
        return cached.1.clone();
    }
    let result = db
        .lock()
        .ok()
        .and_then(|database| database.quick_check().ok())
        .unwrap_or_else(|| "unavailable".into());
    *cached = (now, result.clone());
    result
}

async fn health_check(State(db): State<AppState>) -> Json<serde_json::Value> {
    let ai = std::env::var("DAILY_SUMMARY_AI_API_KEY")
        .map(|k| !k.is_empty())
        .unwrap_or(false);
    let ai_model =
        std::env::var("DAILY_SUMMARY_AI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
    let ai_base_url = std::env::var("DAILY_SUMMARY_AI_BASE_URL")
        .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
    let ai_temperature =
        std::env::var("DAILY_SUMMARY_AI_TEMPERATURE").unwrap_or_else(|_| "0.2".to_string());
    let ai_max_tokens =
        std::env::var("DAILY_SUMMARY_AI_MAX_TOKENS").unwrap_or_else(|_| "unlimited".to_string());
    let ai_timeout_secs =
        std::env::var("DAILY_SUMMARY_AI_TIMEOUT_SECS").unwrap_or_else(|_| "45".to_string());
    let ai_retries = std::env::var("DAILY_SUMMARY_AI_RETRIES").unwrap_or_else(|_| "2".to_string());
    let ai_min_interval_ms =
        std::env::var("DAILY_SUMMARY_AI_MIN_INTERVAL_MS").unwrap_or_else(|_| "1200".to_string());
    let db_path = Database::db_path();
    let db_exists = db_path.exists();
    let db_size = db_exists
        .then(|| std::fs::metadata(&db_path).ok().map(|m| m.len()))
        .flatten()
        .unwrap_or(0);
    let last_backup = backups_dir().join("daily-summary-latest.db");
    let last_backup_metadata = std::fs::metadata(&last_backup).ok();
    let last_backup_time = last_backup_metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .map(|time| {
            let dt: chrono::DateTime<chrono::Utc> = time.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        });
    let last_backup_unix = last_backup_metadata
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());
    let database_integrity = cached_database_integrity(&db);
    let ai_health = ai_health();
    let offsite_last_success_unix = maintenance_timestamp("offsite-last-success");
    let offsite_verify_last_success_unix =
        maintenance_timestamp("offsite-verify-last-success");
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
        "last_backup": last_backup_time,
        "monitoring": {
            "database_integrity": database_integrity,
            "last_backup_unix": last_backup_unix,
            "offsite_last_success_unix": offsite_last_success_unix,
            "offsite_verify_last_success_unix": offsite_verify_last_success_unix,
            "ai_consecutive_failures": ai_health.consecutive_failures,
            "ai_last_failure_unix": ai_health.last_failure_unix,
            "ai_last_success_unix": ai_health.last_success_unix
        }
    }))
}

async fn export_full(
    State(db): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    db.portable_archive()
        .export_json()
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

async fn import_full(
    State(db): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let report = db
        .portable_archive()
        .import_json(payload)
        .map_err(|error| match error {
            ArchiveImportError::Invalid(_) | ArchiveImportError::Json(_) => {
                (StatusCode::BAD_REQUEST, error.to_string())
            }
            ArchiveImportError::Storage(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            }
        })?;
    Ok(Json(serde_json::json!({
        "imported_articles": report.imported_articles,
        "imported_reviews": report.imported_reviews,
        "imported_knowledge_cards": report.imported_knowledge_cards,
    })))
}

async fn import_articles(
    State(db): State<AppState>,
    Json(payload): Json<Vec<CreateArticlePayload>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut imported = 0u32;
    let mut skipped = 0u32;
    for item in payload {
        if item.content.trim().is_empty() {
            skipped += 1;
            continue;
        }
        db.articles()
            .save(ArticleDraft {
                date: item.date,
                title: item.title,
                content: item.content,
                mood: item.mood,
                tags: item.tags.unwrap_or_default(),
            })
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        imported += 1;
    }
    Ok(Json(
        serde_json::json!({ "imported": imported, "skipped": skipped }),
    ))
}

fn build_router(db: Database) -> Router {
    let state: AppState = Arc::new(Mutex::new(db));

    let api_router = Router::new()
        .route(
            "/articles",
            axum::routing::get(articles::list_articles).post(articles::create_article),
        )
        .route(
            "/articles/today",
            axum::routing::get(articles::get_today_article),
        )
        .route(
            "/articles/search",
            axum::routing::get(articles::search_articles),
        )
        .route(
            "/articles/:id",
            axum::routing::get(articles::get_article)
                .put(articles::update_article)
                .delete(articles::delete_article),
        )
        .route(
            "/archive/months",
            axum::routing::get(archive::get_archive_months),
        )
        .route(
            "/archive/:year/:month",
            axum::routing::get(archive::get_articles_by_month),
        )
        .route(
            "/stats/overview",
            axum::routing::get(stats::get_stats_overview),
        )
        .route("/stats/month", axum::routing::get(stats::get_month_stats))
        .route("/stats/week", axum::routing::get(stats::get_week_review))
        .route(
            "/day-exemptions",
            axum::routing::get(day_exemptions::list_day_exemptions),
        )
        .route(
            "/day-exemptions/:date",
            axum::routing::put(day_exemptions::upsert_day_exemption)
                .delete(day_exemptions::delete_day_exemption),
        )
        .route("/export/md", axum::routing::post(exports::export_markdown))
        .route("/export/json", axum::routing::post(exports::export_json))
        .route("/export/zip", axum::routing::post(exports::export_zip))
        .route("/export/pdf", axum::routing::post(exports::export_pdf))
        .route(
            "/backups",
            axum::routing::get(backups::list_backups).post(backups::create_backup),
        )
        .route(
            "/backups/:name",
            axum::routing::delete(backups::delete_backup),
        )
        .route(
            "/backups/:name/download",
            axum::routing::get(backups::download_backup),
        )
        .route("/reviews", axum::routing::get(ai::list_reviews))
        .route(
            "/reviews/generate",
            axum::routing::post(ai::generate_review),
        )
        .route(
            "/reviews/:id",
            axum::routing::get(ai::get_review)
                .put(ai::update_review)
                .delete(ai::delete_review),
        )
        .route(
            "/knowledge-cards",
            axum::routing::get(knowledge::list_cards).post(knowledge::create_card),
        )
        .route(
            "/knowledge-cards/extract",
            axum::routing::post(knowledge::extract_cards),
        )
        .route(
            "/knowledge-cards/:id",
            axum::routing::get(knowledge::get_card)
                .put(knowledge::update_card)
                .delete(knowledge::delete_card),
        )
        .route("/ai/summary", axum::routing::post(ai::ai_summary))
        .route("/articles/import", axum::routing::post(import_articles))
        .route("/articles/import-full", axum::routing::post(import_full))
        .route("/export/full", axum::routing::post(export_full))
        .route_layer(middleware::from_fn(require_api_token));

    Router::new()
        .route("/health", axum::routing::get(health_check))
        .nest("/api", api_router)
        .layer(configured_cors())
        .layer(middleware::from_fn(add_security_headers))
        .fallback_service(ServeDir::new("../dist"))
        .with_state(state)
}

fn bind_address(configured: Option<String>) -> String {
    configured
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "0.0.0.0:8080".into())
}

pub async fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let router = build_router(db);
    let bind = bind_address(std::env::var("DAILY_SUMMARY_BIND").ok());
    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|error| panic!("Failed to bind {bind}: {error}"));
    println!("📓 每日总结服务端已启动 → http://{bind}");
    axum::serve(listener, router).await.expect("Server error");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_bind_address_preserves_legacy_default_and_accepts_loopback() {
        assert_eq!(bind_address(None), "0.0.0.0:8080");
        assert_eq!(
            bind_address(Some("127.0.0.1:8080".into())),
            "127.0.0.1:8080"
        );
    }
}
