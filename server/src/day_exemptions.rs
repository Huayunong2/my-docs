use crate::db::Database;
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use rusqlite::params;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
use rusqlite::OptionalExtension;


// ── Helpers ─────────────────────────────────────────

pub(crate) async fn list_day_exemptions(
    State(db): State<AppState>,
    Query(q): Query<DateRangeQuery>,
) -> Result<Json<Vec<DayExemption>>, (StatusCode, String)> {
    let from = parse_date(&q.from)?;
    let to = parse_date(&q.to)?;
    if from > to {
        return Err((
            StatusCode::BAD_REQUEST,
            "`from` must be before or equal to `to`".into(),
        ));
    }
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(
        load_exemptions(&db, &q.from, &q.to)?
            .into_values()
            .collect(),
    ))
}
pub(crate) async fn upsert_day_exemption(
    State(db): State<AppState>,
    Path(date): Path<String>,
    Json(payload): Json<UpsertDayExemptionPayload>,
) -> Result<Json<DayExemption>, (StatusCode, String)> {
    parse_date(&date)?;
    let reason = payload.reason.trim();
    if !valid_exemption_reason(reason) {
        return Err((StatusCode::BAD_REQUEST, "Invalid exemption reason".into()));
    }
    let note = payload.note.unwrap_or_default();
    let now_str = now();
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let article_exists: Option<String> = db
        .conn()
        .query_row(
            "SELECT id FROM articles WHERE date=?1 LIMIT 1",
            params![date],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if article_exists.is_some() {
        return Err((
            StatusCode::CONFLICT,
            "Cannot exempt a day that already has an article".into(),
        ));
    }
    db.conn()
        .execute(
            "INSERT INTO day_exemptions (date, reason, note, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(date) DO UPDATE SET reason=excluded.reason, note=excluded.note, updated_at=excluded.updated_at",
            params![date, reason, note, now_str, now_str],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    db.conn()
        .query_row(
            "SELECT date, reason, note, created_at, updated_at FROM day_exemptions WHERE date=?1",
            params![date],
            |row| {
                Ok(DayExemption {
                    date: row.get(0)?,
                    reason: row.get(1)?,
                    note: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        .map(Json)
}
pub(crate) async fn delete_day_exemption(
    State(db): State<AppState>,
    Path(date): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    parse_date(&date)?;
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.conn()
        .execute("DELETE FROM day_exemptions WHERE date=?1", params![date])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
