use crate::db::Database;
use crate::helpers::*;
use crate::models::*;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Json;
use rusqlite::params;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
use chrono::Local;
use std::fs;
use std::io::{Cursor, Write};
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use serde_json;


// ── Helpers ─────────────────────────────────────────

pub(crate) async fn export_markdown(
    State(db): State<AppState>,
    Json(payload): Json<ExportPayload>,
) -> Result<Json<String>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let dir = exports_dir();
    fs::create_dir_all(&dir).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut saved = Vec::new();
    for id in &payload.ids {
        let article: Article = db
            .conn()
            .query_row(
                "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at FROM articles WHERE id=?1",
                params![id],
                |row| {
                    Ok(Article {
                        id: row.get(0)?, date: row.get(1)?, title: row.get(2)?,
                        content: row.get(3)?, mood: row.get(4)?, tags: row.get(5)?,
                        word_count: row.get(6)?, created_at: row.get(7)?, updated_at: row.get(8)?,
                    })
                },
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let md = article_to_markdown(&article);
        let safe_title = sanitize_filename(&article.title, "untitled", 40);
        let filename = format!("{}-{}.md", article.date, safe_title);
        let path = dir.join(&filename);
        fs::write(&path, md).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        saved.push(path.to_string_lossy().to_string());
    }
    Ok(Json(saved.join("\n")))
}
pub(crate) async fn export_json(
    State(db): State<AppState>,
    Json(payload): Json<ExportPayload>,
) -> Result<Json<String>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let dir = exports_dir();
    fs::create_dir_all(&dir).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut articles = Vec::new();
    for id in &payload.ids {
        let article: Article = db
            .conn()
            .query_row(
                "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at FROM articles WHERE id=?1",
                params![id],
                |row| {
                    Ok(Article {
                        id: row.get(0)?, date: row.get(1)?, title: row.get(2)?,
                        content: row.get(3)?, mood: row.get(4)?, tags: row.get(5)?,
                        word_count: row.get(6)?, created_at: row.get(7)?, updated_at: row.get(8)?,
                    })
                },
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        articles.push(article);
    }

    let json = serde_json::to_string_pretty(&articles)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let filename = format!("export-{}.json", Local::now().format("%Y%m%d-%H%M%S"));
    let path = dir.join(&filename);
    fs::write(&path, &json).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(path.to_string_lossy().to_string()))
}
pub(crate) async fn export_zip(
    State(db): State<AppState>,
    Json(payload): Json<ExportPayload>,
) -> Result<Response, (StatusCode, String)> {
    if payload.ids.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "No article ids provided".into()));
    }

    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut buffer = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut buffer);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for id in &payload.ids {
        let article: Article = db
            .conn()
            .query_row(
                "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at FROM articles WHERE id=?1",
                params![id],
                |row| {
                    Ok(Article {
                        id: row.get(0)?, date: row.get(1)?, title: row.get(2)?,
                        content: row.get(3)?, mood: row.get(4)?, tags: row.get(5)?,
                        word_count: row.get(6)?, created_at: row.get(7)?, updated_at: row.get(8)?,
                    })
                },
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let safe_title = sanitize_filename(&article.title, "untitled", 40);
        let filename = format!("{}-{}.md", article.date, safe_title);
        zip.start_file(filename, options)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        zip.write_all(article_to_markdown(&article).as_bytes())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    zip.finish()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    drop(db);

    let filename = format!("daily-summary-{}.zip", Local::now().format("%Y%m%d-%H%M%S"));
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{}\"", filename))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
    );
    Ok((headers, buffer.into_inner()).into_response())
}
pub(crate) async fn export_pdf() -> Result<Json<String>, (StatusCode, String)> {
    Err((StatusCode::NOT_IMPLEMENTED, "PDF 导出功能开发中".into()))
}
