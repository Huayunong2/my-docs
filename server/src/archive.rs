use crate::db::Database;
use crate::models::{ArchiveMonth, ArticleSummary};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Json;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
type HttpError = (StatusCode, String);

pub(crate) async fn get_archive_months(
    State(db): State<AppState>,
) -> Result<Json<Vec<ArchiveMonth>>, HttpError> {
    let mut db = db
        .lock()
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    db.articles()
        .archive_months()
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(crate) async fn get_articles_by_month(
    State(db): State<AppState>,
    Path((year, month)): Path<(i32, u32)>,
) -> Result<Json<Vec<ArticleSummary>>, HttpError> {
    let mut db = db
        .lock()
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    db.articles()
        .summaries_by_month(year, month)
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}
