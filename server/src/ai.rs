use crate::db::Database;
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use rusqlite::params;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
use std::collections::BTreeSet;
use uuid::Uuid;
use serde_json;


// ── Helpers ─────────────────────────────────────────

pub(crate) async fn call_ai(prompt: String, system: &str) -> Result<(String, String), (StatusCode, String)> {
    let api_key = std::env::var("DAILY_SUMMARY_AI_API_KEY").map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "AI API key is not configured".to_string(),
        )
    })?;
    let base_url = std::env::var("DAILY_SUMMARY_AI_BASE_URL")
        .unwrap_or_else(|_| "https://api.openai.com/v1".to_string())
        .trim_end_matches('/')
        .to_string();
    let model =
        std::env::var("DAILY_SUMMARY_AI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/chat/completions", base_url))
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": prompt }
            ],
            "stream": false
        }))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("AI upstream {}: {}", status, text),
        ));
    }

    let data = response
        .json::<ChatCompletionResponse>()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let summary = data
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| (StatusCode::BAD_GATEWAY, "AI response is empty".to_string()))?;

    Ok((summary, model))
}
pub(crate) async fn list_reviews(
    State(db): State<AppState>,
    Query(q): Query<ReviewListQuery>,
) -> Result<Json<Vec<Review>>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows = if let (Some(kind), Some(period_start), Some(period_end)) = (
        q.kind.as_deref(),
        q.period_start.as_deref(),
        q.period_end.as_deref(),
    ) {
        if !valid_review_kind(kind) {
            return Err((StatusCode::BAD_REQUEST, "Invalid review kind".into()));
        }
        let from = parse_date(period_start)?;
        let to = parse_date(period_end)?;
        if from > to {
            return Err((
                StatusCode::BAD_REQUEST,
                "`period_start` must be before or equal to `period_end`".into(),
            ));
        }
        let mut stmt = db
            .conn()
            .prepare(
                "SELECT id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at
                 FROM reviews
                 WHERE kind=?1 AND period_start=?2 AND period_end=?3
                 ORDER BY version DESC, updated_at DESC",
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let collected = stmt
            .query_map(params![kind, period_start, period_end], row_to_review)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        collected
    } else if q.period_start.is_none() && q.period_end.is_none() {
        if let Some(kind) = q.kind.as_deref() {
            if !valid_review_kind(kind) {
                return Err((StatusCode::BAD_REQUEST, "Invalid review kind".into()));
            }
            let mut stmt = db
                .conn()
                .prepare(
                    "SELECT id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at
                     FROM reviews
                     WHERE kind=?1
                     ORDER BY period_start DESC, period_end DESC, version DESC",
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let collected = stmt
                .query_map(params![kind], row_to_review)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            collected
        } else {
            let mut stmt = db
                .conn()
                .prepare(
                    "SELECT id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at
                     FROM reviews
                     ORDER BY period_start DESC, period_end DESC, kind ASC, version DESC",
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let collected = stmt
                .query_map([], row_to_review)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            collected
        }
    } else {
        return Err((
            StatusCode::BAD_REQUEST,
            "period_start and period_end must be provided together".into(),
        ));
    };
    let mut reviews = Vec::new();
    reviews.extend(rows);
    Ok(Json(reviews))
}
pub(crate) async fn get_review(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Review>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    load_review(&db, &id).map(Json)
}
pub(crate) fn load_weekly_review_source(
    db: &Database,
    from: &str,
    to: &str,
) -> Result<(String, Vec<String>), (StatusCode, String)> {
    let mut stmt = db
        .conn()
        .prepare(
            "SELECT id, date, title, mood, tags, word_count, content, created_at, updated_at
             FROM articles
             WHERE date BETWEEN ?1 AND ?2
             ORDER BY date ASC",
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows = stmt
        .query_map(params![from, to], |row| {
            Ok(Article {
                id: row.get(0)?,
                date: row.get(1)?,
                title: row.get(2)?,
                mood: row.get(3)?,
                tags: row.get(4)?,
                word_count: row.get(5)?,
                content: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut ids = Vec::new();
    let mut parts = Vec::new();
    for row in rows {
        let article = row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        ids.push(article.id.clone());
        parts.push(format!(
            "## {}\n日期：{}\n标题：{}\n心情：{}\n字数：{}\n正文：\n{}",
            article.date,
            article.date,
            if article.title.trim().is_empty() {
                "(无标题)"
            } else {
                &article.title
            },
            if article.mood.trim().is_empty() {
                "(未填写)"
            } else {
                &article.mood
            },
            article.word_count,
            truncate_chars(&article.content, 3500),
        ));
    }

    if ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "This week has no articles to review".into(),
        ));
    }

    Ok((truncate_chars(&parts.join("\n\n---\n\n"), 26000), ids))
}
pub(crate) fn load_monthly_review_source(
    db: &Database,
    from: &str,
    to: &str,
) -> Result<(String, Vec<String>), (StatusCode, String)> {
    let mut stmt = db
        .conn()
        .prepare(
            "SELECT id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at
             FROM reviews
             WHERE kind='weekly'
               AND status='confirmed'
               AND period_start <= ?2
               AND period_end >= ?1
             ORDER BY period_start ASC, version DESC",
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows = stmt
        .query_map(params![from, to], row_to_review)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut ids = Vec::new();
    let mut parts = Vec::new();
    let mut seen_periods = BTreeSet::new();
    for row in rows {
        let review = row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let period_key = format!("{}:{}", review.period_start, review.period_end);
        if !seen_periods.insert(period_key) {
            continue;
        }
        ids.push(review.id.clone());
        parts.push(format!(
            "## {} 至 {} · v{}\n标题：{}\n内容：\n{}",
            review.period_start,
            review.period_end,
            review.version,
            review.title,
            truncate_chars(&review.content, 6000),
        ));
    }

    if ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "This month has no confirmed weekly reviews".into(),
        ));
    }

    Ok((truncate_chars(&parts.join("\n\n---\n\n"), 26000), ids))
}
pub(crate) async fn generate_review(
    State(db): State<AppState>,
    Json(payload): Json<GenerateReviewPayload>,
) -> Result<Json<Review>, (StatusCode, String)> {
    let kind = payload.kind.trim();
    if !valid_review_kind(kind) {
        return Err((StatusCode::BAD_REQUEST, "Invalid review kind".into()));
    }
    let anchor = parse_date(&payload.date)?;
    let (period_start, period_end) = review_period(kind, anchor)?;
    let from = format_date(period_start);
    let to = format_date(period_end);

    let (source, source_article_ids, source_review_ids, version) = {
        let db = db
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let version: i64 = db
            .conn()
            .query_row(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM reviews WHERE kind=?1 AND period_start=?2 AND period_end=?3",
                params![kind, from, to],
                |row| row.get(0),
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if kind == "weekly" {
            let (source, ids) = load_weekly_review_source(&db, &from, &to)?;
            (source, ids, Vec::new(), version)
        } else {
            let (source, ids) = load_monthly_review_source(&db, &from, &to)?;
            (source, Vec::new(), ids, version)
        }
    };

    let title = if kind == "weekly" {
        format!("{} 至 {} 周复盘", from, to)
    } else {
        format!("{} 月复盘", &from[..7])
    };
    let prompt = if kind == "weekly" {
        format!(
            r#"下面是这一周的每日记录。请像一位了解我的搭档一样，帮我做一个深度周复盘。不要编造，只说原文里真实存在的东西。专注回顾和沉淀，不要提未来计划。

排版要求：每个段落不超过3行，段落之间空一行。列表项之间也空行。标题前后各空一行。整体清爽透气。

## {}
### 这周实际发生了什么
不用概括每件事。挑出 3-5 件真正重要的事，每件用一两句话说清楚。如果是连续多天推进的事，标注跨了几天。

### 出现了什么模式
回顾这周的内容，有没有某个问题反复出现、某种情绪在固定场景下出现、某个习惯在坚持或中断。只写原文里有的，没有就写"本周没有发现明显模式"。

### 有什么变化
和之前相比有没有不一样的地方。没有明显变化就写"本周较为平稳"。

### 沉淀下来的经验
从这周的具体经历里能学到什么。不要写大道理，要写成自己以后能用上的话。每条后面括号标注来自哪天。

### 还没搞清楚的事
有什么事情这周没完全明白的。记下来，以后遇到类似情况时可以对照。

本周原文：
{}"#,
            title, source
        )
    } else {
        format!(
            r#"下面是过去一个月的周复盘。请像一位了解我的搭档一样，帮我做一个月度回顾。不要编造，只说原文里真实存在的东西。专注回顾和沉淀。

排版要求：每个段落不超过3行，段落之间空一行。标题前后各空一行。

## {}
### 这个月的主线
一句话说清楚这个月到底在忙什么。不要列事项，要抓住核心。

### 真正重要的进展
挑 3-5 件确实值得记下来的事。每件注明来自哪周，方便回头查。

### 反复出现的麻烦
哪些问题在多周复盘里都提到了。如果同一个问题出现了 3 次以上，重点标注。

### 试过有用的方法
这个月有什么做法确实管用了。哪天开始的，效果如何。

### 还没看清的事
有些事可能重要但还看不清。记下来，以后回过头看。

已确认周复盘：
{}"#,
            title, source
        )
    };
    let (content, model) = call_ai(
        prompt,
        "你是一个善于发现规律、说人话的中文复盘搭档。只基于给定材料，区分事实和猜测，不编造。语气像朋友聊天，不要学术腔。",
    )
    .await?;

    let id = Uuid::new_v4().to_string();
    let now_str = now();
    let source_article_ids_json = serde_json::to_string(&source_article_ids)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let source_review_ids_json = serde_json::to_string(&source_review_ids)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.conn()
        .execute(
            "INSERT INTO reviews (id, kind, period_start, period_end, version, status, title, content, source_article_ids, source_review_ids, model, generated_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                id,
                kind,
                from,
                to,
                version,
                title,
                content,
                source_article_ids_json,
                source_review_ids_json,
                model,
                now_str,
                now_str,
            ],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    load_review(&db, &id).map(Json)
}
pub(crate) async fn update_review(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateReviewPayload>,
) -> Result<Json<Review>, (StatusCode, String)> {
    if payload.title.is_none() && payload.content.is_none() && payload.status.is_none() {
        return Err((StatusCode::BAD_REQUEST, "No review fields provided".into()));
    }
    if let Some(status) = payload.status.as_deref() {
        if !valid_review_status(status) {
            return Err((StatusCode::BAD_REQUEST, "Invalid review status".into()));
        }
    }

    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let existing = load_review(&db, &id)?;
    let title = payload
        .title
        .unwrap_or(existing.title)
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    if title.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Review title is required".into()));
    }
    let content = payload.content.unwrap_or(existing.content);
    if content.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Review content is required".into()));
    }
    let status = payload.status.unwrap_or(existing.status);
    let now_str = now();

    db.conn()
        .execute(
            "UPDATE reviews SET title=?1, content=?2, status=?3, updated_at=?4 WHERE id=?5",
            params![title, content, status, now_str, id],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    load_review(&db, &id).map(Json)
}
pub(crate) async fn delete_review(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let deleted = db
        .conn()
        .execute("DELETE FROM reviews WHERE id=?1", params![id])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if deleted == 0 {
        return Err((StatusCode::NOT_FOUND, "Review not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn ai_summary(
    Json(payload): Json<AiSummaryPayload>,
) -> Result<Json<AiSummaryResponse>, (StatusCode, String)> {
    if payload.content.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Content is required".into()));
    }

    let prompt = r#"基于以下记录生成简洁日总结，只提炼原文已有信息，不做推断。

要求：
1. 纯文本输出，不用 Markdown。
2. 3-5 句话，简洁克制。
3. 只提炼原文明确提到的事实，不补充不推测。
4. 如果某方面原文未涉及，直接跳过不写。

结构：
· 今天实际做了什么
· 有什么进展或结果
· 遇到的问题或阻碍

原文：
{content}"#
        .replace("{content}", &payload.content);

    let (summary, _) = call_ai(
        prompt,
        "你是一个严谨、克制的中文日总结助手。只输出简洁纯文本，不使用 Markdown。",
    )
    .await?;

    Ok(Json(AiSummaryResponse { summary }))
}
