use crate::ai::call_ai;
use crate::db::{Database, KnowledgeCardDraft};
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use serde_json::Value;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;

fn valid_card_type(value: &str) -> bool {
    matches!(
        value,
        "fact" | "method" | "concept" | "decision" | "case" | "quote" | "principle"
    )
}

fn valid_card_status(value: &str) -> bool {
    matches!(value, "draft" | "confirmed" | "outdated")
}

fn parse_ai_cards(raw: &str) -> Result<Vec<Value>, (StatusCode, String)> {
    let trimmed = raw.trim();
    let without_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|s| s.strip_suffix("```"))
        .unwrap_or(trimmed)
        .trim();
    let value: Value = serde_json::from_str(without_fence).map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            "AI returned invalid knowledge JSON".to_string(),
        )
    })?;
    if let Some(cards) = value.as_array() {
        return Ok(cards.clone());
    }
    if let Some(cards) = value.get("cards").and_then(Value::as_array) {
        return Ok(cards.clone());
    }
    Err((
        StatusCode::BAD_GATEWAY,
        "AI returned invalid knowledge JSON".to_string(),
    ))
}

fn value_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn value_tags(value: &Value) -> Vec<String> {
    value
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
        .unwrap_or_default()
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

    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows = db
        .knowledge()
        .list()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let query = q.q.unwrap_or_default().trim().to_lowercase();
    let card_type_filter = q.card_type.unwrap_or_default();
    let status_filter = q.status.unwrap_or_default();
    let mut cards = Vec::new();
    for card in rows {
        if !card_type_filter.is_empty() && card.card_type != card_type_filter {
            continue;
        }
        if !status_filter.is_empty() && card.status != status_filter {
            continue;
        }
        if !query.is_empty() {
            let haystack =
                format!("{} {} {}", card.title, card.content, card.tags.join(" ")).to_lowercase();
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
    let max_cards = payload.max_cards.unwrap_or(8).clamp(1, 16);
    let prompt = format!(
        r#"请只从下面的真实文档中抽取适合复习的个人知识卡片草稿。

硬性规则：
- 只允许使用原文明确出现或可直接归纳的内容，不要补充背景、建议、计划、未来问题或心理推测。
- 如果原文只是流水账、情绪表达或证据不足，返回空数组。
- 每张卡片必须能回到原文找到依据，并且读者只看卡片也能复习。
- 内容要像个人知识库条目：稳定、具体、可复用、可回看，不要空泛。
- title 不超过 30 个中文字符，content 使用 2-5 句中文，说明“是什么 / 为什么重要 / 怎么用 / 适用边界”中的至少两项。
- source_excerpt 必须是原文中能支撑该卡片的原文短片段；如果没有明确片段，不要生成该卡片。
- card_type 只能是：fact, method, concept, decision, case, quote, principle。
- 优先抽取：关键概念、方法步骤、设计原则、调试经验、项目事实、决策依据、可引用表述。
- 不要抽取：普通情绪、泛泛计划、无依据评价、只对当天有意义的流水账。
- tags 只给 1-4 个短标签。
- 只输出 JSON，不要输出 Markdown 或解释。

JSON 格式：
{{"cards":[{{"card_type":"fact","title":"...","content":"...","source_excerpt":"...","tags":["..."]}}]}}

最多抽取 {} 张。

真实文档：
{}"#,
        max_cards,
        truncate_chars(source, 40000)
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
    let mut drafts = Vec::new();
    for item in cards.into_iter().take(max_cards) {
        let raw_type = value_text(&item, "card_type");
        let card_type = if valid_card_type(&raw_type) {
            raw_type
        } else {
            "fact".to_string()
        };
        let title = value_text(&item, "title")
            .chars()
            .take(160)
            .collect::<String>();
        let content = value_text(&item, "content");
        let source_excerpt = value_text(&item, "source_excerpt")
            .chars()
            .take(500)
            .collect::<String>();
        if title.is_empty() || content.is_empty() || source_excerpt.is_empty() {
            continue;
        }
        drafts.push(KnowledgeCardDraft {
            card_type,
            status: "draft".into(),
            title,
            content,
            tags: value_tags(&item),
            source_article_id: source_article_id.clone(),
            source_review_id: source_review_id.clone(),
            source_date: source_date.clone(),
            source_excerpt,
        });
    }
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .save_many(drafts)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn get_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<KnowledgeCard>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .find(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Knowledge card not found".into()))
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
        return Err((
            StatusCode::BAD_REQUEST,
            "Knowledge card title is required".into(),
        ));
    }
    let content = payload.content.trim().to_string();
    if content.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Knowledge card content is required".into(),
        ));
    }

    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .save(KnowledgeCardDraft {
            card_type: card_type.into(),
            status,
            title,
            content,
            tags: payload.tags.unwrap_or_default(),
            source_article_id: payload.source_article_id.unwrap_or_default(),
            source_review_id: payload.source_review_id.unwrap_or_default(),
            source_date: payload.source_date.unwrap_or_default(),
            source_excerpt: payload.source_excerpt.unwrap_or_default(),
        })
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn update_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateKnowledgeCardPayload>,
) -> Result<Json<KnowledgeCard>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let existing = db
        .knowledge()
        .find(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Knowledge card not found".into()))?;

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
        return Err((
            StatusCode::BAD_REQUEST,
            "Knowledge card title is required".into(),
        ));
    }
    let content = payload
        .content
        .unwrap_or(existing.content)
        .trim()
        .to_string();
    if content.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Knowledge card content is required".into(),
        ));
    }
    let tags = payload.tags.unwrap_or(existing.tags);
    let source_article_id = payload
        .source_article_id
        .unwrap_or(existing.source_article_id);
    let source_review_id = payload
        .source_review_id
        .unwrap_or(existing.source_review_id);
    let source_date = payload.source_date.unwrap_or(existing.source_date);
    let source_excerpt = payload.source_excerpt.unwrap_or(existing.source_excerpt);
    db.knowledge()
        .update(
            &id,
            KnowledgeCardDraft {
                card_type,
                status,
                title,
                content,
                tags,
                source_article_id,
                source_review_id,
                source_date,
                source_excerpt,
            },
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Knowledge card not found".into()))
}

pub(crate) async fn delete_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let deleted = db
        .knowledge()
        .delete(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !deleted {
        return Err((StatusCode::NOT_FOUND, "Knowledge card not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
