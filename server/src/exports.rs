use crate::db::Database;
use crate::helpers::{article_to_markdown, exports_dir, sanitize_filename};
use crate::models::{Article, ExportPayload};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use chrono::Local;
use std::fs;
use std::io::{Cursor, Write};
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
type HttpError = (StatusCode, String);

pub(crate) async fn export_markdown(
    State(db): State<AppState>,
    Json(payload): Json<ExportPayload>,
) -> Result<Json<String>, HttpError> {
    let articles = load_articles(&db, &payload.ids)?;
    let directory = exports_dir();
    fs::create_dir_all(&directory).map_err(internal_error)?;
    let mut saved = Vec::new();
    for article in articles {
        let filename = format!(
            "{}-{}.md",
            article.date,
            sanitize_filename(&article.title, "untitled", 40)
        );
        let path = directory.join(filename);
        fs::write(&path, article_to_markdown(&article)).map_err(internal_error)?;
        saved.push(path.to_string_lossy().to_string());
    }
    Ok(Json(saved.join("\n")))
}

pub(crate) async fn export_json(
    State(db): State<AppState>,
    Json(payload): Json<ExportPayload>,
) -> Result<Json<String>, HttpError> {
    let articles = load_articles(&db, &payload.ids)?;
    let directory = exports_dir();
    fs::create_dir_all(&directory).map_err(internal_error)?;
    let json = serde_json::to_string_pretty(&articles).map_err(internal_error)?;
    let path = directory.join(format!(
        "export-{}.json",
        Local::now().format("%Y%m%d-%H%M%S")
    ));
    fs::write(&path, json).map_err(internal_error)?;
    Ok(Json(path.to_string_lossy().to_string()))
}

pub(crate) async fn export_zip(
    State(db): State<AppState>,
    Json(payload): Json<ExportPayload>,
) -> Result<Response, HttpError> {
    if payload.ids.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "No article ids provided".into()));
    }
    let articles = load_articles(&db, &payload.ids)?;
    let mut buffer = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut buffer);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for article in articles {
        let filename = format!(
            "{}-{}.md",
            article.date,
            sanitize_filename(&article.title, "untitled", 40)
        );
        zip.start_file(filename, options).map_err(internal_error)?;
        zip.write_all(article_to_markdown(&article).as_bytes())
            .map_err(internal_error)?;
    }
    zip.finish().map_err(internal_error)?;
    let filename = format!("daily-summary-{}.zip", Local::now().format("%Y%m%d-%H%M%S"));
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .map_err(internal_error)?,
    );
    Ok((headers, buffer.into_inner()).into_response())
}

pub(crate) async fn export_pdf() -> Result<Json<String>, HttpError> {
    Err((StatusCode::NOT_IMPLEMENTED, "PDF 导出功能开发中".into()))
}

fn load_articles(db: &AppState, ids: &[String]) -> Result<Vec<Article>, HttpError> {
    let mut db = db
        .lock()
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    db.articles().by_ids(ids).map_err(internal_error)
}

fn internal_error(error: impl ToString) -> HttpError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}
