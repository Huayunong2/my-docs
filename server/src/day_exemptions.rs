use crate::db::Database;
use crate::helpers::{parse_date, valid_exemption_reason};
use crate::models::{DateRangeQuery, DayExemption, UpsertDayExemptionPayload};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
type HttpError = (StatusCode, String);

pub(crate) async fn list_day_exemptions(
    State(db): State<AppState>,
    Query(query): Query<DateRangeQuery>,
) -> Result<Json<Vec<DayExemption>>, HttpError> {
    let from = parse_date(&query.from)?;
    let to = parse_date(&query.to)?;
    if from > to {
        return Err((
            StatusCode::BAD_REQUEST,
            "`from` must be before or equal to `to`".into(),
        ));
    }
    let mut db = db.lock().map_err(lock_error)?;
    db.exemptions()
        .list(&query.from, &query.to)
        .map(|items| Json(items.into_values().collect()))
        .map_err(storage_error)
}

pub(crate) async fn upsert_day_exemption(
    State(db): State<AppState>,
    Path(date): Path<String>,
    Json(payload): Json<UpsertDayExemptionPayload>,
) -> Result<Json<DayExemption>, HttpError> {
    parse_date(&date)?;
    let reason = payload.reason.trim();
    if !valid_exemption_reason(reason) {
        return Err((StatusCode::BAD_REQUEST, "Invalid exemption reason".into()));
    }
    let mut db = db.lock().map_err(lock_error)?;
    db.exemptions()
        .set(&date, reason, &payload.note.unwrap_or_default())
        .map_err(storage_error)?
        .map(Json)
        .ok_or_else(|| {
            (
                StatusCode::CONFLICT,
                "Cannot exempt a day that already has an article".into(),
            )
        })
}

pub(crate) async fn delete_day_exemption(
    State(db): State<AppState>,
    Path(date): Path<String>,
) -> Result<StatusCode, HttpError> {
    parse_date(&date)?;
    let mut db = db.lock().map_err(lock_error)?;
    db.exemptions().delete(&date).map_err(storage_error)?;
    Ok(StatusCode::NO_CONTENT)
}

fn lock_error(error: std::sync::PoisonError<std::sync::MutexGuard<'_, Database>>) -> HttpError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

fn storage_error(error: rusqlite::Error) -> HttpError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}
