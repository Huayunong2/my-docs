use crate::db::{ArticleChanges, ArticleDraft, Database};
use crate::models::{
    Article, ArticleListResponse, ArticleSummary, CreateArticlePayload, ListQuery, SearchQuery,
    TodayQuery, UpdateArticlePayload,
};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
type HttpError = (StatusCode, String);

pub(crate) async fn create_article(
    State(db): State<AppState>,
    Json(payload): Json<CreateArticlePayload>,
) -> Result<Json<Article>, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    db.articles()
        .save(ArticleDraft {
            date: payload.date,
            title: payload.title,
            content: payload.content,
            mood: payload.mood,
            tags: payload.tags.unwrap_or_default(),
            spaces: payload.spaces.unwrap_or_default(),
        })
        .map(Json)
        .map_err(storage_error)
}

pub(crate) async fn update_article(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateArticlePayload>,
) -> Result<Json<Article>, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    db.articles()
        .update(
            &id,
            ArticleChanges {
                title: payload.title,
                content: payload.content,
                mood: payload.mood,
                tags: payload.tags,
                spaces: payload.spaces,
            },
        )
        .map_err(storage_error)?
        .map(Json)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Not found".into()))
}

pub(crate) async fn delete_article(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    if db.articles().delete(&id).map_err(storage_error)? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "Not found".into()))
    }
}

pub(crate) async fn restore_article(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    if db.articles().restore(&id).map_err(storage_error)? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "Not found".into()))
    }
}

pub(crate) async fn get_article(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Article>, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    db.articles()
        .find_by_id(&id)
        .map_err(storage_error)?
        .map(Json)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Not found".into()))
}

pub(crate) async fn get_today_article(
    State(db): State<AppState>,
    Query(query): Query<TodayQuery>,
) -> Result<Json<Option<Article>>, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    db.articles()
        .find_by_date(&query.date)
        .map(Json)
        .map_err(storage_error)
}

pub(crate) async fn list_articles(
    State(db): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Response, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    let response = db
        .articles()
        .list_page(query.page.unwrap_or(1), query.page_size.unwrap_or(20))
        .map_err(storage_error)?;
    if query.include_meta {
        Ok(Json(response).into_response())
    } else {
        Ok(Json(response.items).into_response())
    }
}

pub(crate) async fn list_deleted_articles(
    State(db): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<ArticleListResponse>, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    db.articles()
        .list_trash(query.page.unwrap_or(1), query.page_size.unwrap_or(20))
        .map(Json)
        .map_err(storage_error)
}

pub(crate) async fn list_space_articles(
    State(db): State<AppState>,
    Path(space): Path<String>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<ArticleSummary>>, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    db.articles()
        .list_by_space(
            &space,
            query.page.unwrap_or(1),
            query.page_size.unwrap_or(12),
        )
        .map(Json)
        .map_err(storage_error)
}

pub(crate) async fn search_articles(
    State(db): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<ArticleSummary>>, HttpError> {
    let mut db = db.lock().map_err(lock_error)?;
    db.articles()
        .search(&query.q)
        .map(Json)
        .map_err(storage_error)
}

fn lock_error(error: std::sync::PoisonError<std::sync::MutexGuard<'_, Database>>) -> HttpError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

fn storage_error(error: rusqlite::Error) -> HttpError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}
