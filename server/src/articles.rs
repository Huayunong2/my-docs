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
use uuid::Uuid;


// ── Helpers ─────────────────────────────────────────

pub(crate) async fn create_article(
    State(db): State<AppState>,
    Json(payload): Json<CreateArticlePayload>,
) -> Result<Json<Article>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let now_str = now();
    let tags = normalize_tags_json(payload.tags)?;
    let word_count = payload
        .content
        .chars()
        .filter(|c| !c.is_whitespace())
        .count() as i64;

    let existing_id: Option<String> = db
        .conn()
        .query_row(
            "SELECT id FROM articles WHERE date=?1 LIMIT 1",
            params![payload.date],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(id) = existing_id {
        db.conn()
            .execute(
                "UPDATE articles SET title=?1, content=?2, mood=?3, tags=?4, word_count=?5, updated_at=?6 WHERE id=?7",
                params![payload.title, payload.content, payload.mood, tags, word_count, now_str, id],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        db.conn()
            .execute(
                "DELETE FROM day_exemptions WHERE date=?1",
                params![payload.date],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        return db
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
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
            .map(Json);
    }

    let id = Uuid::new_v4().to_string();
    db.conn()
        .execute(
            "INSERT INTO articles (id, date, title, content, mood, tags, word_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, payload.date, payload.title, payload.content, payload.mood, tags, word_count, now_str, now_str],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.conn()
        .execute(
            "DELETE FROM day_exemptions WHERE date=?1",
            params![payload.date],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(Article {
        id,
        date: payload.date,
        title: payload.title,
        content: payload.content,
        mood: payload.mood,
        tags,
        word_count,
        created_at: now_str.clone(),
        updated_at: now_str,
    }))
}
pub(crate) async fn update_article(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateArticlePayload>,
) -> Result<Json<Article>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let now_str = now();
    let tags = normalize_tags_json(payload.tags)?;
    let word_count = payload
        .content
        .chars()
        .filter(|c| !c.is_whitespace())
        .count() as i64;

    let updated_rows = db.conn()
        .execute(
            "UPDATE articles SET title=?1, content=?2, mood=?3, tags=?4, word_count=?5, updated_at=?6 WHERE id=?7",
            params![payload.title, payload.content, payload.mood, tags, word_count, now_str, id],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if updated_rows == 0 {
        return Err((StatusCode::NOT_FOUND, "Not found".into()));
    }

    db.conn()
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
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        .map(Json)
}
pub(crate) async fn delete_article(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.conn()
        .execute("DELETE FROM articles WHERE id=?1", params![id])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn get_article(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Article>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.conn()
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
        .map_err(|e: rusqlite::Error| match e {
            rusqlite::Error::QueryReturnedNoRows => (StatusCode::NOT_FOUND, "Not found".into()),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        })
        .map(Json)
}
pub(crate) async fn get_today_article(
    State(db): State<AppState>,
    Query(q): Query<TodayQuery>,
) -> Result<Json<Option<Article>>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let result = db.conn().query_row(
        "SELECT id, date, title, content, mood, tags, word_count, created_at, updated_at FROM articles WHERE date=?1 LIMIT 1",
        params![q.date],
        |row| {
            Ok(Article {
                id: row.get(0)?, date: row.get(1)?, title: row.get(2)?,
                content: row.get(3)?, mood: row.get(4)?, tags: row.get(5)?,
                word_count: row.get(6)?, created_at: row.get(7)?, updated_at: row.get(8)?,
            })
        },
    );
    match result {
        Ok(a) => Ok(Json(Some(a))),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Json(None)),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}
pub(crate) async fn list_articles(
    State(db): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<ArticleSummary>>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let page = q.page.unwrap_or(1);
    let page_size = q.page_size.unwrap_or(20);
    let offset = (page - 1) * page_size;

    let mut stmt = db
        .conn()
        .prepare("SELECT id, date, title, mood, tags, word_count, content FROM articles ORDER BY date DESC, updated_at DESC LIMIT ?1 OFFSET ?2")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let rows = stmt
        .query_map(params![page_size, offset], |row| {
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
pub(crate) async fn search_articles(
    State(db): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<ArticleSummary>>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Sanitize FTS query: strip special characters to prevent syntax errors
    let sanitized =
        q.q.chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '_' || *c == '-')
            .collect::<String>()
            .trim()
            .to_string();
    if sanitized.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let mut stmt = db
        .conn()
        .prepare(
            "SELECT a.id, a.date, a.title, a.mood, a.tags, a.word_count, a.content
             FROM articles a
             INNER JOIN articles_fts fts ON a.rowid = fts.rowid
             WHERE articles_fts MATCH ?1
             ORDER BY a.date DESC
             LIMIT 50",
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let rows = stmt
        .query_map(params![sanitized], |row| {
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
