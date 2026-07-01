use crate::ai::call_ai;
use crate::db::Database;
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use rusqlite::params;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

type AppState = Arc<Mutex<Database>>;

fn valid_card_type(value: &str) -> bool {
    matches!(value, "fact" | "method" | "concept" | "decision" | "case" | "quote" | "principle")
}

fn valid_card_status(value: &str) -> bool {
    matches!(value, "draft" | "confirmed" | "outdated")
}

fn row_to_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeCard> {
    Ok(KnowledgeCard {
        id: row.get(0)?,
        card_type: row.get(1)?,
        status: row.get(2)?,
        title: row.get(3)?,
        content: row.get(4)?,
        tags: row.get(5)?,
        source_article_id: row.get(6)?,
        source_review_id: row.get(7)?,
        source_date: row.get(8)?,
        source_excerpt: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn load_card(db: &Database, id: &str) -> Result<KnowledgeCard, (StatusCode, String)> {
    db.conn()
        .query_row(
            "SELECT id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at
             FROM knowledge_cards WHERE id=?1",
            params![id],
            row_to_card,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => (StatusCode::NOT_FOUND, "Knowledge card not found".into()),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        })
}

fn parse_ai_cards(raw: &str) -> Result<Vec<Value>, (StatusCode, String)> {
    let trimmed = raw.trim();
    let without_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|s| s.strip_suffix("```"))
        .unwrap_or(trimmed)
        .trim();
    let value: Value = serde_json::from_str(without_fence)
        .map_err(|_| (StatusCode::BAD_GATEWAY, "AI returned invalid knowledge JSON".to_string()))?;
    if let Some(cards) = value.as_array() {
        return Ok(cards.clone());
    }
    if let Some(cards) = value.get("cards").and_then(Value::as_array) {
        return Ok(cards.clone());
    }
    Err((StatusCode::BAD_GATEWAY, "AI returned invalid knowledge JSON".to_string()))
}

fn value_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn value_tags_json(value: &Value) -> Result<String, (StatusCode, String)> {
    let tags = value
        .get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|tag| tag.trim().to_string())
                .filter(|tag| !tag.is_empty())
                .take(8)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let raw = serde_json::to_string(&tags).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    normalize_tags_json(Some(raw))
}

pub(crate) async fn list_cards(
    State(db): State<AppState>,
    Query(q): Query<KnowledgeListQuery>,
) -> Result<Json<Vec<KnowledgeCard>>, (StatusCode, String)> {
    if let Some(card_type) = q.card_type.as_deref() {
        if !card_type.is_empty() && !valid_card_type(card_type) {
            return Err((StatusCode::BAD_REQUEST, "Invalid card type".into()));
        }
    }
    if let Some(status) = q.status.as_deref() {
        if !status.is_empty() && !valid_card_status(status) {
            return Err((StatusCode::BAD_REQUEST, "Invalid card status".into()));
        }
    }

    let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut stmt = db
        .conn()
        .prepare(
            "SELECT id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at
             FROM knowledge_cards
             ORDER BY updated_at DESC, created_at DESC",
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows = stmt
        .query_map([], row_to_card)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let query = q.q.unwrap_or_default().trim().to_lowercase();
    let card_type_filter = q.card_type.unwrap_or_default();
    let status_filter = q.status.unwrap_or_default();
    let mut cards = Vec::new();
    for row in rows {
        let card = row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if !card_type_filter.is_empty() && card.card_type != card_type_filter {
            continue;
        }
        if !status_filter.is_empty() && card.status != status_filter {
            continue;
        }
        if !query.is_empty() {
            let haystack = format!("{} {} {}", card.title, card.content, card.tags).to_lowercase();
            if !haystack.contains(&query) {
                continue;
            }
        }
        cards.push(card);
    }
    Ok(Json(cards))
}

pub(crate) async fn extract_cards(
    State(db): State<AppState>,
    Json(payload): Json<ExtractKnowledgeCardsPayload>,
) -> Result<Json<Vec<KnowledgeCard>>, (StatusCode, String)> {
    let source = payload.content.trim();
    if source.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Content is required".into()));
    }
    let max_cards = payload.max_cards.unwrap_or(6).clamp(1, 12);
    let prompt = format!(
        r#"请只从下面的真实文档中抽取可长期复用的知识卡片草稿。

硬性规则：
- 只允许使用原文明确出现或可直接归纳的内容，不要补充背景、建议、计划、未来问题或心理推测。
- 如果原文只是流水账、情绪表达或证据不足，返回空数组。
- 每张卡片必须能回到原文找到依据。
- 内容要像个人知识库条目：稳定、可复用、少废话。
- title 不超过 30 个中文字符，content 使用 1-3 句中文。
- source_excerpt 必须是原文中能支撑该卡片的短片段；如果没有明确片段，不要生成该卡片。
- card_type 只能是：fact, method, concept, decision, case, quote, principle。
- tags 只给 0-4 个短标签。
- 只输出 JSON，不要输出 Markdown 或解释。

JSON 格式：
{{"cards":[{{"card_type":"fact","title":"...","content":"...","source_excerpt":"...","tags":["..."]}}]}}

最多抽取 {} 张。

真实文档：
{}"#,
        max_cards,
        truncate_chars(source, 18000)
    );
    let (raw, _) = call_ai(
        prompt,
        "你是严谨的中文个人知识库抽取器。你的任务是从用户提供的真实文档抽取知识卡片草稿，禁止编造。",
    )
    .await?;
    let cards = parse_ai_cards(&raw)?;

    let source_article_id = payload.source_article_id.unwrap_or_default();
    let source_review_id = payload.source_review_id.unwrap_or_default();
    let source_date = payload.source_date.unwrap_or_default();
    let now_str = now();
    let mut created_ids = Vec::new();

    {
        let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        for item in cards.into_iter().take(max_cards) {
            let raw_type = value_text(&item, "card_type");
            let card_type = if valid_card_type(&raw_type) { raw_type } else { "fact".to_string() };
            let title = value_text(&item, "title").chars().take(160).collect::<String>();
            let content = value_text(&item, "content");
            let source_excerpt = value_text(&item, "source_excerpt")
                .chars()
                .take(500)
                .collect::<String>();
            if title.is_empty() || content.is_empty() || source_excerpt.is_empty() {
                continue;
            }
            let tags = value_tags_json(&item)?;
            let id = Uuid::new_v4().to_string();
            db.conn()
                .execute(
                    "INSERT INTO knowledge_cards (id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at)
                     VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                    params![id, card_type, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, now_str],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            created_ids.push(id);
        }
    }

    let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut created = Vec::new();
    for id in created_ids {
        created.push(load_card(&db, &id)?);
    }
    Ok(Json(created))
}

pub(crate) async fn get_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<KnowledgeCard>, (StatusCode, String)> {
    let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    load_card(&db, &id).map(Json)
}

pub(crate) async fn create_card(
    State(db): State<AppState>,
    Json(payload): Json<CreateKnowledgeCardPayload>,
) -> Result<Json<KnowledgeCard>, (StatusCode, String)> {
    let card_type = payload.card_type.trim();
    if !valid_card_type(card_type) {
        return Err((StatusCode::BAD_REQUEST, "Invalid card type".into()));
    }
    let status = payload.status.unwrap_or_else(|| "draft".to_string());
    if !valid_card_status(&status) {
        return Err((StatusCode::BAD_REQUEST, "Invalid card status".into()));
    }
    let title = payload.title.trim().chars().take(160).collect::<String>();
    if title.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Knowledge card title is required".into()));
    }
    let content = payload.content.trim().to_string();
    if content.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Knowledge card content is required".into()));
    }

    let tags = normalize_tags_json(payload.tags)?;
    let id = Uuid::new_v4().to_string();
    let now_str = now();
    let source_article_id = payload.source_article_id.unwrap_or_default();
    let source_review_id = payload.source_review_id.unwrap_or_default();
    let source_date = payload.source_date.unwrap_or_default();
    let source_excerpt = payload.source_excerpt.unwrap_or_default();

    let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.conn()
        .execute(
            "INSERT INTO knowledge_cards (id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![id, card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, now_str],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    load_card(&db, &id).map(Json)
}

pub(crate) async fn update_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateKnowledgeCardPayload>,
) -> Result<Json<KnowledgeCard>, (StatusCode, String)> {
    let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let existing = load_card(&db, &id)?;

    let card_type = payload.card_type.unwrap_or(existing.card_type);
    if !valid_card_type(&card_type) {
        return Err((StatusCode::BAD_REQUEST, "Invalid card type".into()));
    }
    let status = payload.status.unwrap_or(existing.status);
    if !valid_card_status(&status) {
        return Err((StatusCode::BAD_REQUEST, "Invalid card status".into()));
    }
    let title = payload
        .title
        .unwrap_or(existing.title)
        .trim()
        .chars()
        .take(160)
        .collect::<String>();
    if title.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Knowledge card title is required".into()));
    }
    let content = payload.content.unwrap_or(existing.content).trim().to_string();
    if content.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Knowledge card content is required".into()));
    }
    let tags = if payload.tags.is_some() {
        normalize_tags_json(payload.tags)?
    } else {
        existing.tags
    };
    let source_article_id = payload.source_article_id.unwrap_or(existing.source_article_id);
    let source_review_id = payload.source_review_id.unwrap_or(existing.source_review_id);
    let source_date = payload.source_date.unwrap_or(existing.source_date);
    let source_excerpt = payload.source_excerpt.unwrap_or(existing.source_excerpt);
    let now_str = now();

    db.conn()
        .execute(
            "UPDATE knowledge_cards
             SET card_type=?1, status=?2, title=?3, content=?4, tags=?5, source_article_id=?6, source_review_id=?7, source_date=?8, source_excerpt=?9, updated_at=?10
             WHERE id=?11",
            params![card_type, status, title, content, tags, source_article_id, source_review_id, source_date, source_excerpt, now_str, id],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    load_card(&db, &id).map(Json)
}

pub(crate) async fn delete_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let db = db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let deleted = db
        .conn()
        .execute("DELETE FROM knowledge_cards WHERE id=?1", params![id])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if deleted == 0 {
        return Err((StatusCode::NOT_FOUND, "Knowledge card not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
