use crate::db::Database;
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Json;
use rusqlite::params;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;


// ── Helpers ─────────────────────────────────────────

pub(crate) async fn get_archive_months(
    State(db): State<AppState>,
) -> Result<Json<Vec<ArchiveMonth>>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut stmt = db
        .conn()
        .prepare("SELECT DISTINCT substr(date, 1, 4) as year, substr(date, 6, 2) as month FROM articles ORDER BY year DESC, month DESC")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ArchiveMonth {
                year: row.get::<_, String>(0)?.parse().unwrap_or(0),
                month: row.get::<_, String>(1)?.parse().unwrap_or(0),
            })
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?);
    }
    Ok(Json(results))
}
pub(crate) async fn get_articles_by_month(
    State(db): State<AppState>,
    Path((year, month)): Path<(i32, u32)>,
) -> Result<Json<Vec<ArticleSummary>>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let pattern = format!("{:04}-{:02}%", year, month);

    let mut stmt = db
        .conn()
        .prepare("SELECT id, date, title, mood, tags, word_count, content FROM articles WHERE date LIKE ?1 ORDER BY date DESC")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let rows = stmt
        .query_map(params![pattern], |row| {
            let content: String = row.get(6)?;
            Ok(ArticleSummary {
                id: row.get(0)?,
                date: row.get(1)?,
                title: row.get(2)?,
                mood: row.get(3)?,
                tags: row.get(4)?,
                word_count: row.get(5)?,
                preview: preview(&content, 120),
            })
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?);
    }
    Ok(Json(results))
}
