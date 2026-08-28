use crate::ai;
use crate::ai_client::ai_health;
use crate::archive;
use crate::articles;
use crate::backup_policy;
use crate::backups;
use crate::day_exemptions;
use crate::db::{ArchiveImportError, ArticleDraft, Database};
use crate::exports;
use crate::helpers::{app_data_dir, backups_dir};
use crate::knowledge;
use crate::middleware::{add_security_headers, configured_cors, require_api_token};
use crate::models::*;
use crate::review;
use crate::stats;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    middleware,
    response::Json,
    Router,
};
use std::sync::{Arc, Mutex};
use tower_http::services::{ServeDir, ServeFile};

type AppState = Arc<Mutex<Database>>;

const BUILD_TIME: &str = env!("BUILD_TIMESTAMP");
fn maintenance_timestamp(name: &str) -> Option<u64> {
    std::fs::read_to_string(app_data_dir().join("status").join(name))
        .ok()
        .and_then(|value| value.trim().parse().ok())
}

fn database_integrity_status() -> (String, Option<u64>) {
    let value = std::fs::read_to_string(app_data_dir().join("status/database-integrity"));
    let Ok(value) = value else {
        return ("pending".into(), None);
    };
    let mut parts = value.split_whitespace();
    let checked_at = parts.next().and_then(|part| part.parse().ok());
    let status = parts.next().unwrap_or("unavailable").to_string();
    (status, checked_at)
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "build": BUILD_TIME,
    }))
}

async fn detailed_health_check(
    State(db): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let (ai_config, ai_api_key_source) = {
        let db = db
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let config = db
            .ai_config()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let source = db
            .ai_api_key_source()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .to_string();
        (config, source)
    };
    let ai = !ai_config.api_key.trim().is_empty();
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
    let (database_integrity, database_integrity_last_check_unix) = database_integrity_status();
    let disk_usage_percent = backup_policy::disk_usage_percent(&app_data_dir()).ok();
    let disk_usage_warning = disk_usage_percent
        .map(backup_policy::disk_usage_requires_warning)
        .unwrap_or(false);
    let ai_health = ai_health();
    let offsite_last_success_unix = maintenance_timestamp("offsite-last-success");
    let offsite_verify_last_success_unix = maintenance_timestamp("offsite-verify-last-success");
    Ok(Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "build": BUILD_TIME,
        "features": { "ai": ai, "reviews": true, "knowledge": true, "exports": true, "backups": true },
        "ai_config": {
            "configured": ai,
            "api_key_configured": ai,
            "api_key_source": ai_api_key_source,
            "model": ai_config.model,
            "base_url": ai_config.base_url,
            "temperature": ai_config.temperature.to_string(),
            "max_tokens": if ai_config.max_tokens == 0 { "unlimited".to_string() } else { ai_config.max_tokens.to_string() },
            "timeout_secs": ai_config.timeout_secs.to_string(),
            "retries": ai_config.retries.to_string(),
            "min_interval_ms": ai_config.min_interval_ms.to_string()
        },
        "db_path": db_path.to_string_lossy(),
        "db_size": db_size,
        "last_backup": last_backup_time,
        "monitoring": {
            "database_integrity": database_integrity,
            "database_integrity_last_check_unix": database_integrity_last_check_unix,
            "disk_usage_percent": disk_usage_percent,
            "disk_usage_warning": disk_usage_warning,
            "last_backup_unix": last_backup_unix,
            "offsite_last_success_unix": offsite_last_success_unix,
            "offsite_verify_last_success_unix": offsite_verify_last_success_unix,
            "ai_consecutive_failures": ai_health.consecutive_failures,
            "ai_last_failure_unix": ai_health.last_failure_unix,
            "ai_last_success_unix": ai_health.last_success_unix
        }
    })))
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
                spaces: item.spaces.unwrap_or_default(),
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
            "/spaces/:space/articles",
            axum::routing::get(articles::list_space_articles),
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
            "/knowledge-cards/tags",
            axum::routing::get(knowledge::list_tags),
        )
        .route(
            "/knowledge-cards/summary",
            axum::routing::get(knowledge::summary),
        )
        .route(
            "/knowledge-cards/trash",
            axum::routing::get(knowledge::list_trash),
        )
        .route(
            "/knowledge-cards/query",
            axum::routing::get(knowledge::query_cards),
        )
        .route(
            "/knowledge-cards/projects",
            axum::routing::get(knowledge::list_projects).post(knowledge::create_project),
        )
        .route(
            "/knowledge-cards/views",
            axum::routing::get(knowledge::list_saved_views).post(knowledge::create_saved_view),
        )
        .route(
            "/knowledge-cards/views/:id",
            axum::routing::put(knowledge::update_saved_view).delete(knowledge::delete_saved_view),
        )
        .route(
            "/spaces",
            axum::routing::get(knowledge::list_spaces).post(knowledge::create_project),
        )
        .route(
            "/spaces/:space/archive",
            axum::routing::post(knowledge::archive_space),
        )
        .route(
            "/spaces/:space/restore",
            axum::routing::post(knowledge::restore_space),
        )
        .route(
            "/spaces/:space",
            axum::routing::patch(knowledge::update_space)
                .delete(knowledge::delete_space_permanently),
        )
        .route(
            "/knowledge-cards/batch",
            axum::routing::post(knowledge::batch_cards),
        )
        .route(
            "/knowledge-cards/extract",
            axum::routing::post(knowledge::extract_cards),
        )
        .route(
            "/knowledge-cards/analyze",
            axum::routing::post(knowledge::analyze_cards),
        )
        .route(
            "/knowledge-cards/analyze-jobs",
            axum::routing::post(knowledge::create_analyze_job),
        )
        .route(
            "/knowledge-cards/analyze-jobs/:id",
            axum::routing::get(knowledge::get_analyze_job).delete(knowledge::cancel_analyze_job),
        )
        .route(
            "/knowledge-cards/analyze-jobs/:id/retry",
            axum::routing::post(knowledge::retry_analyze_job),
        )
        .route(
            "/knowledge-cards/import",
            axum::routing::post(knowledge::import_cards),
        )
        .route(
            "/knowledge-cards/:id",
            axum::routing::get(knowledge::get_card)
                .put(knowledge::update_card)
                .delete(knowledge::delete_card),
        )
        .route(
            "/knowledge-cards/:id/review-items",
            axum::routing::get(knowledge::list_review_items).post(knowledge::create_review_item),
        )
        .route(
            "/review-items/:id",
            axum::routing::put(knowledge::update_review_item).delete(knowledge::delete_review_item),
        )
        .route(
            "/knowledge-cards/:id/touch",
            axum::routing::post(review::touch_card),
        )
        .route(
            "/review/settings",
            axum::routing::get(review::review_settings).put(review::update_review_settings),
        )
        .route("/review/due", axum::routing::get(review::due_cards))
        .route(
            "/review/:id/preview",
            axum::routing::get(review::preview_card),
        )
        .route("/review/stats", axum::routing::get(review::review_stats))
        .route(
            "/review/heatmap",
            axum::routing::get(review::review_heatmap),
        )
        .route(
            "/review/history/:id",
            axum::routing::get(review::review_history),
        )
        .route("/review/:id/grade", axum::routing::post(review::grade_card))
        .route("/ai/summary", axum::routing::post(ai::ai_summary))
        .route(
            "/ai/config",
            axum::routing::get(ai::get_ai_config).put(ai::update_ai_config),
        )
        .route(
            "/ai/routing",
            axum::routing::get(ai::get_ai_routing).put(ai::update_ai_routing),
        )
        .route("/health", axum::routing::get(detailed_health_check))
        .route("/articles/import", axum::routing::post(import_articles))
        .route("/articles/import-full", axum::routing::post(import_full))
        .route("/export/full", axum::routing::post(export_full))
        .fallback(|| async { StatusCode::NOT_FOUND })
        .route_layer(middleware::from_fn(require_api_token))
        // AI 文档导入按 UTF-8 字节传输，1,000,000 个中文字符可能超过 axum
        // 默认的 2 MiB JSON 限制；同时保留明确的总请求上限，避免无限制读入。
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024));

    Router::new()
        .route("/health", axum::routing::get(health_check))
        .nest("/api", api_router)
        .layer(configured_cors())
        .layer(middleware::from_fn(add_security_headers))
        // Browser history routes (e.g. /knowledge/<cardId>) must resolve to the
        // SPA entry point on a direct refresh. API routes are already matched
        // above, so this fallback only applies to static app navigation.
        .fallback_service(ServeDir::new("../dist").fallback(ServeFile::new("../dist/index.html")))
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

pub(crate) async fn check_startup() -> Result<(), String> {
    let db = Database::new().map_err(|error| error.to_string())?;
    let _router = build_router(db);
    let bind = bind_address(std::env::var("DAILY_SUMMARY_BIND").ok());
    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .map_err(|error| format!("Failed to bind {bind}: {error}"))?;
    drop(listener);
    Ok(())
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

    #[tokio::test]
    async fn public_health_does_not_expose_private_operational_metadata() {
        let Json(health) = health_check().await;
        assert_eq!(health["status"], "ok");
        assert!(health.get("db_path").is_none());
        assert!(health.get("db_size").is_none());
        assert!(health.get("ai_config").is_none());
        assert!(health.get("monitoring").is_none());
    }
}
