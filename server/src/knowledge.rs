use crate::ai::call_ai;
use crate::db::{Database, KnowledgeCardDraft};
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;

fn valid_card_type(value: &str) -> bool {
    matches!(
        value,
        "fact" | "method" | "concept" | "decision" | "case" | "quote" | "principle" | "snippet"
    )
}

fn valid_card_status(value: &str) -> bool {
    matches!(value, "draft" | "confirmed" | "outdated")
}

fn valid_card_status_filter(value: &str) -> bool {
    value == "all" || valid_card_status(value)
}

fn valid_card_sort(value: &str) -> bool {
    matches!(value, "updated" | "created" | "usage" | "review")
}

fn valid_card_quality(value: &str) -> bool {
    matches!(
        value,
        "missing_source" | "missing_project" | "missing_tags" | "short_content"
    )
}

fn normalize_saved_view_filters(value: &Value) -> Value {
    let source = value.as_object();
    let mut filters = Map::new();
    for (key, max_len) in [("q", 200usize), ("project", 120), ("tag", 120)] {
        if let Some(raw) = source
            .and_then(|object| object.get(key))
            .and_then(Value::as_str)
        {
            let normalized = raw.trim().chars().take(max_len).collect::<String>();
            if !normalized.is_empty() {
                filters.insert(key.to_string(), Value::String(normalized));
            }
        }
    }
    for (key, valid) in [
        ("status", valid_card_status_filter as fn(&str) -> bool),
        ("type", valid_card_type as fn(&str) -> bool),
        ("sort", valid_card_sort as fn(&str) -> bool),
        ("quality", valid_card_quality as fn(&str) -> bool),
    ] {
        if let Some(raw) = source
            .and_then(|object| object.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
        {
            if valid(raw) {
                filters.insert(key.to_string(), Value::String(raw.to_string()));
            }
        }
    }
    if source
        .and_then(|object| object.get("usage"))
        .and_then(Value::as_str)
        .is_some_and(|usage| usage == "never_used")
    {
        filters.insert("usage".into(), Value::String("never_used".into()));
    }
    Value::Object(filters)
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
        if !status.is_empty() && !valid_card_status_filter(status) {
            return Err((StatusCode::BAD_REQUEST, "Invalid card status".into()));
        }
    }
    if let Some(usage) = q.usage.as_deref() {
        if !usage.is_empty() && usage != "never_used" {
            return Err((StatusCode::BAD_REQUEST, "Invalid usage filter".into()));
        }
    }
    if let Some(quality) = q.quality.as_deref() {
        if !quality.is_empty() && !valid_card_quality(quality) {
            return Err((StatusCode::BAD_REQUEST, "Invalid quality filter".into()));
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
    let usage_filter = q.usage.unwrap_or_default();
    let tag_filter = q.tag.unwrap_or_default();
    let project_filter = q.project.unwrap_or_default();
    let quality_filter = q.quality.unwrap_or_default();
    let mut cards = Vec::new();
    for card in rows {
        if !card_type_filter.is_empty() && card.card_type != card_type_filter {
            continue;
        }
        if !status_filter.is_empty() && status_filter != "all" && card.status != status_filter {
            continue;
        }
        if usage_filter == "never_used" && card.usage_count != 0 {
            continue;
        }
        if !tag_filter.is_empty() && !card.tags.iter().any(|t| t == &tag_filter) {
            continue;
        }
        if !project_filter.is_empty()
            && !card
                .projects
                .iter()
                .any(|project| project.eq_ignore_ascii_case(&project_filter))
        {
            continue;
        }
        if !quality_filter.is_empty() {
            let matches = match quality_filter.as_str() {
                "missing_source" => {
                    card.source_date.trim().is_empty()
                        && card.source_article_id.trim().is_empty()
                        && card.source_review_id.trim().is_empty()
                        && card.source_excerpt.trim().is_empty()
                }
                "missing_project" => card.projects.is_empty(),
                "missing_tags" => card.tags.is_empty(),
                "short_content" => card.content.trim().chars().count() < 24,
                _ => false,
            };
            if !matches {
                continue;
            }
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

/// 回收站只返回软删除卡片；正文和关系仍保留在数据库中，供恢复操作使用。
pub(crate) async fn list_trash(
    State(db): State<AppState>,
) -> Result<Json<Vec<KnowledgeCard>>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .list_trash()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn summary(
    State(db): State<AppState>,
) -> Result<Json<KnowledgeSummary>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .summary()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// 服务端全文查询和分页入口；保留 list_cards 以兼容旧客户端的数组返回格式。
pub(crate) async fn query_cards(
    State(db): State<AppState>,
    Query(q): Query<KnowledgeListQuery>,
) -> Result<Json<KnowledgeCardsPage>, (StatusCode, String)> {
    if let Some(card_type) = q.card_type.as_deref() {
        if !card_type.is_empty() && !valid_card_type(card_type) {
            return Err((StatusCode::BAD_REQUEST, "Invalid card type".into()));
        }
    }
    if let Some(status) = q.status.as_deref() {
        if !status.is_empty() && !valid_card_status_filter(status) {
            return Err((StatusCode::BAD_REQUEST, "Invalid card status".into()));
        }
    }
    if let Some(usage) = q.usage.as_deref() {
        if !usage.is_empty() && usage != "never_used" {
            return Err((StatusCode::BAD_REQUEST, "Invalid usage filter".into()));
        }
    }
    if let Some(quality) = q.quality.as_deref() {
        if !quality.is_empty() && !valid_card_quality(quality) {
            return Err((StatusCode::BAD_REQUEST, "Invalid quality filter".into()));
        }
    }
    let sort = q.sort.as_deref().unwrap_or("updated");
    if !valid_card_sort(sort) {
        return Err((StatusCode::BAD_REQUEST, "Invalid card sort".into()));
    }
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(24).clamp(1, 100);

    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let (cards, total) = db
        .knowledge()
        .query_page(
            q.q.as_deref().unwrap_or_default(),
            q.card_type.as_deref(),
            q.status.as_deref(),
            q.usage.as_deref(),
            q.tag.as_deref(),
            q.project.as_deref(),
            q.quality.as_deref(),
            sort,
            page,
            page_size,
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(KnowledgeCardsPage {
        cards,
        total,
        page,
        page_size,
        has_more: page.saturating_mul(page_size) < total,
    }))
}

/// 返回所有已用标签及其计数，按使用频次降序、同频次按名称排序。
pub(crate) async fn list_tags(
    State(db): State<AppState>,
) -> Result<Json<Vec<KnowledgeTagCount>>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows = db
        .knowledge()
        .list()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for card in rows {
        for tag in card.tags {
            *counts.entry(tag).or_default() += 1;
        }
    }
    let mut tags: Vec<KnowledgeTagCount> = counts
        .into_iter()
        .map(|(tag, count)| KnowledgeTagCount { tag, count })
        .collect();
    tags.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
    Ok(Json(tags))
}

/// 返回项目目录及其卡片计数；项目本身独立持久化，因此零卡项目也会返回。
pub(crate) async fn list_projects(
    State(db): State<AppState>,
) -> Result<Json<Vec<KnowledgeProject>>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .list_projects()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn list_saved_views(
    State(db): State<AppState>,
) -> Result<Json<Vec<KnowledgeSavedView>>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .list_saved_views()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn create_saved_view(
    State(db): State<AppState>,
    Json(payload): Json<SaveKnowledgeViewPayload>,
) -> Result<Json<KnowledgeSavedView>, (StatusCode, String)> {
    let name = payload.name.trim().chars().take(80).collect::<String>();
    if name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "View name is required".into()));
    }
    let filters = normalize_saved_view_filters(&payload.filters);
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .create_saved_view(&name, &filters)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn update_saved_view(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateKnowledgeViewPayload>,
) -> Result<Json<KnowledgeSavedView>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let existing = db
        .knowledge()
        .get_saved_view(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Saved view not found".into()))?;
    let name = payload
        .name
        .unwrap_or(existing.name)
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    if name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "View name is required".into()));
    }
    let filters = normalize_saved_view_filters(&payload.filters.unwrap_or(existing.filters));
    db.knowledge()
        .update_saved_view(&id, &name, &filters)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Saved view not found".into()))
}

pub(crate) async fn delete_saved_view(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let deleted = db
        .knowledge()
        .delete_saved_view(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !deleted {
        return Err((StatusCode::NOT_FOUND, "Saved view not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn create_project(
    State(db): State<AppState>,
    Json(payload): Json<CreateKnowledgeProjectPayload>,
) -> Result<Json<KnowledgeProject>, (StatusCode, String)> {
    if payload.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Project name is required".into()));
    }
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .create_project(&payload.name)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or((StatusCode::BAD_REQUEST, "Project name is required".into()))
}

pub(crate) async fn extract_cards(
    State(db): State<AppState>,
    Json(payload): Json<ExtractKnowledgeCardsPayload>,
) -> Result<Json<ExtractCardsResponse>, (StatusCode, String)> {
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
- 卡片是"知识"，不是"代码摘录"：主题必须是可迁移的规律、结论、原理、事实，而不是具体的模块名、字段名、接口名、文件名。
  - 如果原文围绕某个具体对象（如某模块的某字段、某次修复的某文件），先提炼它背后的通用规则再写卡片；
  - 不要在 title 里出现只有原项目语境才懂的专有名词；宁可写成"释放后使用（UAF）的根因排查"，也不要写"某模块析构顺序问题"。
- title 不超过 30 个中文字符，写成能独立成立的一句话知识（"是什么"优先于"哪个对象"），脱离原项目后仍可理解。
- content 使用 2-5 句中文，必须覆盖"是什么 / 为什么重要 / 怎么用 / 适用边界"中的至少两项；如果这条规则源于某个具体场景，用不超过一句交代场景（例如"在固件升级里发现"），让多年后回看时能想起上下文。
- source_excerpt 必须是原文中能支撑该卡片的原文短片段；如果没有明确片段，不要生成该卡片。
- card_type 只能是：fact, method, concept, decision, case, quote, principle。
- 优先抽取：关键概念、可复用方法、设计原则、调试经验背后的规律、项目事实、决策依据、可引用表述。
- 不要抽取：普通情绪、泛泛计划、无依据评价、只对当天有意义的流水账、纯实现细节（如"把 A 接口改成 B 接口"而没有规律）。
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
            related_ids: vec![],
            projects: vec![],
        });
    }
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // 去重：今日提取与复盘提取可能命中同一知识点（来源不同），
    // 与库内已有卡及本次草稿间比较，高度相似的跳过，避免重复入库。
    let existing = db
        .knowledge()
        .list()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut kept: Vec<KnowledgeCardDraft> = Vec::new();
    let mut skipped = 0usize;
    for draft in drafts {
        let duplicate = existing
            .iter()
            .any(|card| cards_similar(&card.title, &card.content, &draft.title, &draft.content))
            || kept.iter().any(|other| {
                cards_similar(&other.title, &other.content, &draft.title, &draft.content)
            });
        if duplicate {
            skipped += 1;
        } else {
            kept.push(draft);
        }
    }
    let cards = db
        .knowledge()
        .save_many(kept)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ExtractCardsResponse { cards, skipped }))
}

/// 去掉空白、标点与小写后的紧凑文本，用于标题/内容比较。
fn compact(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// 字符 bigram Dice 系数（0.0 ~ 1.0），比 Jaccard 对同义改写的长度差异更宽容。
fn text_similarity(a: &str, b: &str) -> f64 {
    fn bigrams(value: &str) -> std::collections::HashSet<(char, char)> {
        let chars: Vec<char> = value.chars().filter(|c| c.is_alphanumeric()).collect();
        chars.windows(2).map(|w| (w[0], w[1])).collect()
    }
    let ca = compact(a);
    let cb = compact(b);
    if ca.is_empty() || cb.is_empty() {
        return 0.0;
    }
    let ba = bigrams(&ca);
    let bb = bigrams(&cb);
    let shared = ba.intersection(&bb).count();
    let total = ba.len() + bb.len();
    if total == 0 {
        return 0.0;
    }
    2.0 * shared as f64 / total as f64
}

/// 两张卡是否视为同一知识点：标题/内容相同、互相包含，或内容高度相似。
fn cards_similar(title_a: &str, content_a: &str, title_b: &str, content_b: &str) -> bool {
    let ta = compact(title_a);
    let tb = compact(title_b);
    let ca = compact(content_a);
    let cb = compact(content_b);
    if !ta.is_empty() && ta == tb {
        return true;
    }
    if !ca.is_empty() && ca == cb {
        return true;
    }
    if ta.chars().count() >= 6 && tb.chars().count() >= 6 && (ta.contains(&tb) || tb.contains(&ta))
    {
        return true;
    }
    text_similarity(&ca, &cb) >= 0.62
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
            related_ids: payload.related_ids.unwrap_or_default(),
            projects: payload.projects.unwrap_or_default(),
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
    let related_ids = payload.related_ids.unwrap_or(existing.related_ids);
    let projects = payload.projects.unwrap_or(existing.projects);
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
                related_ids,
                projects,
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

/// 批量操作在服务端单事务完成，支持状态、添加/移除标签、加入/移动项目、软删除和恢复。
pub(crate) async fn batch_cards(
    State(db): State<AppState>,
    Json(payload): Json<BatchKnowledgeCardsPayload>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if payload.ids.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "ids is required".into()));
    }
    let action = payload.action.as_str();
    if !matches!(
        action,
        "confirm"
            | "set_status"
            | "add_tags"
            | "remove_tags"
            | "add_projects"
            | "set_projects"
            | "remove_projects"
            | "delete"
            | "restore"
    ) {
        return Err((StatusCode::BAD_REQUEST, "Invalid action".into()));
    }
    if action == "set_status"
        && (payload.values.len() != 1 || !valid_card_status(&payload.values[0]))
    {
        return Err((StatusCode::BAD_REQUEST, "A valid status is required".into()));
    }
    if matches!(
        action,
        "add_tags" | "remove_tags" | "add_projects" | "set_projects" | "remove_projects"
    ) && payload.values.iter().all(|value| value.trim().is_empty())
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "At least one value is required".into(),
        ));
    }
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let updated = db
        .knowledge()
        .batch_update(&payload.ids, action, &payload.values)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "updated": updated })))
}

#[cfg(test)]
mod similarity_tests {
    use super::{cards_similar, text_similarity};

    #[test]
    fn identical_titles_or_contents_count_as_duplicate() {
        assert!(cards_similar(
            "写文件先写 .part 再 rename",
            "内容甲",
            "写文件先写 .part 再 rename",
            "内容乙"
        ));
        assert!(cards_similar(
            "标题甲",
            "临时文件写完再原子改名",
            "标题乙",
            "临时文件写完再原子改名"
        ));
    }

    #[test]
    fn contained_long_titles_count_as_duplicate() {
        assert!(cards_similar(
            "设备写保护分层校验与失败终止",
            "内容甲",
            "设备写保护分层校验",
            "内容乙"
        ));
    }

    #[test]
    fn paraphrased_contents_with_high_similarity_count_as_duplicate() {
        let a = "输出文件采用写 .part 临时文件、数据完整后原子 rename 的模式，支持断点续传。";
        let b = "输出文件先写 .part 临时文件，数据完整后原子重命名，支持断点续传恢复。";
        assert!(text_similarity(a, b) > 0.62);
        assert!(cards_similar("标题甲", a, "标题乙", b));
    }

    #[test]
    fn different_knowledge_points_are_not_duplicates() {
        let a = "输出文件采用写 .part 临时文件、数据完整后原子 rename 的模式。";
        let b = "硬件采集场景下，必须在数据完整处理并落盘后再向 FPGA 发送 ACK。";
        assert!(text_similarity(a, b) < 0.62);
        assert!(!cards_similar("临时文件原子改名", a, "ACK 时机", b));
    }

    #[test]
    fn short_titles_do_not_trigger_substring_false_positives() {
        // 标题太短时不做包含判定，避免 "错误处理" 和 "错误处理顺序" 误伤
        assert!(!cards_similar(
            "错误处理",
            "内容甲",
            "错误处理顺序",
            "内容乙"
        ));
    }
}
