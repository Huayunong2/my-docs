use crate::db::Database;
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use rusqlite::params;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration as StdDuration, SystemTime, UNIX_EPOCH};

type AppState = Arc<Mutex<Database>>;
use serde_json;
use std::collections::BTreeSet;
use uuid::Uuid;

static LAST_AI_REQUEST_MS: AtomicU64 = AtomicU64::new(0);

// ── Helpers ─────────────────────────────────────────

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(default)
}

fn env_f32(key: &str, default: f32) -> f32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<f32>().ok())
        .unwrap_or(default)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn throttle_ai_requests() {
    let min_interval_ms = env_u64("DAILY_SUMMARY_AI_MIN_INTERVAL_MS", 1200);
    if min_interval_ms == 0 {
        return;
    }

    loop {
        let now = now_millis();
        let previous = LAST_AI_REQUEST_MS.load(Ordering::SeqCst);
        let next_allowed = previous.saturating_add(min_interval_ms);
        if now >= next_allowed {
            if LAST_AI_REQUEST_MS
                .compare_exchange(previous, now, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                return;
            }
        } else {
            tokio::time::sleep(StdDuration::from_millis(next_allowed - now)).await;
        }
    }
}

pub(crate) async fn call_ai(
    prompt: String,
    system: &str,
) -> Result<(String, String), (StatusCode, String)> {
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
    let temperature = env_f32("DAILY_SUMMARY_AI_TEMPERATURE", 0.2);
    let max_tokens = env_u64("DAILY_SUMMARY_AI_MAX_TOKENS", 0);
    let timeout_secs = env_u64("DAILY_SUMMARY_AI_TIMEOUT_SECS", 45);
    let retries = env_u64("DAILY_SUMMARY_AI_RETRIES", 2);

    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(timeout_secs))
        .build()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let endpoint = format!("{}/chat/completions", base_url);
    let mut body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt }
        ],
        "temperature": temperature,
        "stream": false
    });
    if max_tokens > 0 {
        body["max_tokens"] = serde_json::json!(max_tokens);
    }

    let mut last_error = "AI request failed".to_string();
    for attempt in 0..=retries {
        throttle_ai_requests().await;
        let response = client
            .post(&endpoint)
            .bearer_auth(&api_key)
            .json(&body)
            .send()
            .await;

        let response = match response {
            Ok(response) => response,
            Err(e) => {
                eprintln!(
                    "AI request transport error on attempt {}: {}",
                    attempt + 1,
                    e
                );
                last_error = "AI 服务暂时不可用，请稍后重试。".to_string();
                if attempt < retries {
                    tokio::time::sleep(StdDuration::from_millis(600 * (attempt + 1))).await;
                    continue;
                }
                return Err((StatusCode::BAD_GATEWAY, last_error));
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let status_code = status.as_u16();
            let text = response.text().await.unwrap_or_default();
            eprintln!(
                "AI upstream error on attempt {}: {} {}",
                attempt + 1,
                status,
                text
            );
            last_error = if status_code == 401 || status_code == 403 {
                "AI 配置无效或没有权限，请检查服务端 API Key。".to_string()
            } else if status_code == 429 {
                "AI 请求过于频繁或额度受限，请稍后重试。".to_string()
            } else {
                "AI 服务暂时不可用，请稍后重试。".to_string()
            };
            if attempt < retries && (status_code == 429 || status_code >= 500) {
                tokio::time::sleep(StdDuration::from_millis(800 * (attempt + 1))).await;
                continue;
            }
            return Err((StatusCode::BAD_GATEWAY, last_error));
        }

        let data = response
            .json::<ChatCompletionResponse>()
            .await
            .map_err(|e| {
                eprintln!("AI response parse error: {}", e);
                (StatusCode::BAD_GATEWAY, "AI 返回格式无法解析。".to_string())
            })?;
        let summary = data
            .choices
            .into_iter()
            .next()
            .map(|choice| choice.message.content)
            .unwrap_or_default();
        if summary.trim().is_empty() {
            eprintln!("AI response empty on attempt {}", attempt + 1);
            last_error = "AI 返回了空内容，请重试；如果反复出现，请检查模型是否支持当前接口。".to_string();
            if attempt < retries {
                tokio::time::sleep(StdDuration::from_millis(800 * (attempt + 1))).await;
                continue;
            }
            return Err((StatusCode::BAD_GATEWAY, last_error));
        }

        return Ok((summary, model));
    }

    Err((StatusCode::BAD_GATEWAY, last_error))
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
            truncate_chars(&article.content, 8000),
        ));
    }

    if ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "This week has no articles to review".into(),
        ));
    }

    Ok((truncate_chars(&parts.join("\n\n---\n\n"), 80000), ids))
}
pub(crate) fn load_monthly_review_source(
    db: &Database,
    from: &str,
    to: &str,
) -> Result<(String, Vec<String>, Vec<String>), (StatusCode, String)> {
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
    let mut covered_dates = BTreeSet::new();
    for row in rows {
        let review = row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let period_key = format!("{}:{}", review.period_start, review.period_end);
        if !seen_periods.insert(period_key) {
            continue;
        }
        let start = parse_date(&review.period_start)?;
        let end = parse_date(&review.period_end)?;
        let month_start = parse_date(from)?;
        let month_end = parse_date(to)?;

        // Count days in this month vs total week days
        let mut days_in_month = 0i64;
        let mut days_total = 0i64;
        let mut d = start;
        while d <= end {
            days_total += 1;
            if d >= month_start && d <= month_end { days_in_month += 1; }
            d = d + chrono::Duration::days(1);
        }
        let is_cross_month = days_in_month < days_total;

        let mut date = start.max(month_start);
        while date <= end.min(month_end) {
            covered_dates.insert(format_date(date));
            date = date + chrono::Duration::days(1);
        }
        ids.push(review.id.clone());
        let clip_start = format_date_short(start.max(month_start));
        let clip_end = format_date_short(end.min(month_end));
        let note = if is_cross_month {
            let is_primary = days_in_month > days_total / 2;
            let weight = if is_primary { "高" } else { "低" };
            let role = if is_primary {
                let position = if start < month_start {
                    "第一周"
                } else {
                    "最后一周"
                };
                format!("主体归属本月，作为本月{position}主体复盘")
            } else {
                format!(
                    "主体归属相邻月份，仅用于补足本月 {} 天（{}–{}），非本月主体复盘",
                    days_in_month, clip_start, clip_end
                )
            };
            format!(
                "（跨月周复盘：本周共 {total} 天，本月覆盖 {in_month} 天（{clip_start}–{clip_end}）。归属：{role}。参考权重：{weight}。统计规则：只提取本月日期内容，不使用非本月内容。）",
                total = days_total,
                in_month = days_in_month,
                clip_start = clip_start,
                clip_end = clip_end,
                role = role,
                weight = weight,
            )
        } else {
            String::new()
        };
        parts.push(format!(
            "## {}–{} · v{}{}\n标题：{}\n内容：\n{}",
            format_date_short(start),
            format_date_short(end),
            review.version,
            note,
            review.title,
            truncate_chars(&review.content, 12000),
        ));
    }

    let mut article_ids = Vec::new();
    let mut stmt = db
        .conn()
        .prepare(
            "SELECT id, date, title, mood, tags, word_count, content, created_at, updated_at
             FROM articles
             WHERE date BETWEEN ?1 AND ?2
             ORDER BY date ASC",
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let article_rows = stmt
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

    let mut uncovered_articles = Vec::new();
    for row in article_rows {
        let article = row.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if covered_dates.contains(&article.date) {
            continue;
        }
        article_ids.push(article.id.clone());
        uncovered_articles.push(format!(
            "## {}\n标题：{}\n心情：{}\n标签：{}\n字数：{}\n摘要原文：\n{}",
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
            if article.tags.trim().is_empty() {
                "[]"
            } else {
                &article.tags
            },
            article.word_count,
            truncate_chars(&article.content, 2500),
        ));
    }

    if !uncovered_articles.is_empty() {
        parts.push(format!(
            "# 未被已确认周复盘覆盖的每日记录\n{}",
            uncovered_articles.join("\n\n---\n\n")
        ));
    }

    if ids.is_empty() && article_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "This month has no confirmed weekly reviews or articles".into(),
        ));
    }

    Ok((
        truncate_chars(&parts.join("\n\n---\n\n"), 90000),
        article_ids,
        ids,
    ))
}

fn json_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn json_string_vec(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    if let Some(s) = item.as_str() {
                        Some(s.trim().to_string())
                    } else if item.is_object() {
                        item.get("text")
                            .and_then(|v| v.as_str())
                            .or_else(|| item.get("content").and_then(|v| v.as_str()))
                            .map(|text| {
                                let dates = item
                                    .get("source_dates")
                                    .and_then(|v| v.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|d| d.as_str())
                                            .collect::<Vec<_>>()
                                            .join("、")
                                    })
                                    .unwrap_or_default();
                                if dates.is_empty() {
                                    text.trim().to_string()
                                } else {
                                    format!("{}（{}）", text.trim(), dates)
                                }
                            })
                    } else {
                        None
                    }
                })
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn markdown_list(items: Vec<String>, empty: &str) -> String {
    if items.is_empty() {
        empty.to_string()
    } else {
        items
            .into_iter()
            .map(|item| format!("- {}", item))
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

fn render_review_response(kind: &str, title: &str, raw: &str) -> String {
    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let Ok(value) = serde_json::from_str::<Value>(cleaned) else {
        return raw.trim().to_string();
    };

    if kind == "weekly" {
        format!(
            "## {}\n\n### 本周材料概览\n\n{}\n\n### 时间线与关键事实\n\n{}\n\n### 概念、方法与工具\n\n{}\n\n### 主题与模式\n\n{}\n\n### 可复用沉淀\n\n{}\n\n### 复习要点\n\n{}",
            title,
            json_text(&value, "overview").if_empty("本周材料不足，无法形成稳定概览。"),
            markdown_list(json_string_vec(&value, "facts"), "本周没有足够明确的事实材料。"),
            markdown_list(json_string_vec(&value, "study_notes"), "本周没有明确的概念、方法或工具沉淀。"),
            markdown_list(json_string_vec(&value, "themes"), "本周没有形成明确主题或模式。"),
            markdown_list(json_string_vec(&value, "distillations"), "本周没有可沉淀为文档的稳定结论。"),
            markdown_list(json_string_vec(&value, "review_points"), "本周没有形成可复习的稳定要点。"),
        )
    } else {
        format!(
            "## {}\n\n### 本月材料概览\n\n{}\n\n### 时间线与关键事实\n\n{}\n\n### 概念、方法与工具\n\n{}\n\n### 反复出现的主题\n\n{}\n\n### 可复用沉淀\n\n{}\n\n### 复习要点\n\n{}",
            title,
            json_text(&value, "overview").if_empty("本月材料不足，无法形成稳定概览。"),
            markdown_list(json_string_vec(&value, "facts"), "本月没有足够明确的事实材料。"),
            markdown_list(json_string_vec(&value, "study_notes"), "本月没有明确的概念、方法或工具沉淀。"),
            markdown_list(json_string_vec(&value, "themes"), "本月没有形成明确的反复主题。"),
            markdown_list(json_string_vec(&value, "distillations"), "本月没有可沉淀为文档的稳定结论。"),
            markdown_list(json_string_vec(&value, "review_points"), "本月没有形成可复习的稳定要点。"),
        )
    }
}

trait EmptyDefault {
    fn if_empty(self, default: &str) -> String;
}

impl EmptyDefault for String {
    fn if_empty(self, default: &str) -> String {
        if self.trim().is_empty() {
            default.to_string()
        } else {
            self
        }
    }
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
            let (source, article_ids, review_ids) = load_monthly_review_source(&db, &from, &to)?;
            (source, article_ids, review_ids, version)
        }
    };

    let title = if kind == "weekly" {
        format!("{} 至 {} 周复盘", from, to)
    } else {
        format!("{} 月复盘", &from[..7])
    };
    let prompt = if kind == "weekly" {
        format!(
            r#"下面是这一周的每日记录。请直接输出一份适合复习的 Markdown 周度沉淀文档。不要编造，只说原文里真实存在的东西。目标是以后回看时能迅速恢复上下文、复习技术点/方法/判断依据，而不是生成空泛总结。

必须使用下面的 Markdown 结构，不要输出 JSON，不要包裹代码块：
## {title}
### 本周材料概览
用 4-8 句话概括本周真实材料，保留具体项目、模块、问题和学习对象。
### 时间线与关键事实
按日期列出原文明确发生过、做过、完成过、观察到的事实，保留关键名词。
### 概念、方法与工具
整理本周值得复习的概念、工具、代码结构、设计方法、调试方法或业务规则。必须让人看得懂，不要只写标题。
### 主题与模式
只写至少 2 条以上材料共同支持的主题或模式。只出现一次的内容，不得放入主题；只能放在“时间线与关键事实”或“概念、方法与工具”里。
### 可复用沉淀
允许基于原文进行归纳、压缩和结构化，但不得引入原文没有依据的新结论。每项必须具体到方法、规则、判断依据、适用场景或边界，不能只是把当天事实换个说法。尽量整理成第一人称也能直接复习的白话结论，表达要精炼、可理解。
### 复习要点
写成复习时可直接看的要点，不要写成提问，不要写未来计划。

写作视角使用第一人称整理事实、方法和判断，不要用“作者”。不写心理推断、情绪拔高或自我评价，除非原文明确出现。
禁止输出“今后问题”“还没解决的问题”“建议”“下一步计划”、心理推断或鸡汤，除非原文明确把这些内容写成文档材料。
不得为了满足条目数量而拆分、重复或泛化原文信息。内容不要过短；在材料足够且不重复的前提下，每个列表尽量输出 4-10 项；材料不足时写“材料不足，暂不沉淀”。

本周原文：
{source}"#,
            title = title,
            source = source
        )
    } else {
        format!(
            r#"下面是过去一个月的周复盘，以及可能未被周复盘覆盖的每日记录摘要。请直接输出一份适合复习的 Markdown 月度沉淀文档。不要编造，只说材料里真实存在的东西。目标是以后回看时能恢复本月学习/项目/决策脉络，而不是生成空泛总结。

处理材料时，周复盘用于提供主题脉络，每日记录用于补充具体事实和技术细节。注意：材料中周复盘标题旁的括号标注（如"跨月周复盘：本周共…"）是处理指令，不要复制到输出正文中。

权重规则（必须遵守）：部分周复盘标注了"参考权重：高"或"参考权重：低"。标有"参考权重：低"的周复盘只覆盖本月少数几天（≤3 天），仅用于补足时间线细节，不要让它的结构和结论主导本月主题、可复用沉淀或反复出现的主题。标有"参考权重：高"的周复盘覆盖本月大部分天数，可以作为本月主体结构参考。

去重规则（硬约束）：同一日期、同一主题、同一任务只总结一次。若周复盘已归纳过某事项，月复盘沿用周复盘的归纳表达，不再从每日记录中单独提取同一事项。每日记录仅用于补充周复盘未覆盖的日期，或补充周复盘中未涉及的细节。不得因为周复盘已有总结而忽略每日记录中的具体技术点；周复盘没有覆盖到的每日记录内容，需要主动整理进时间线、概念工具或可复用沉淀中。

必须使用下面的 Markdown 结构，不要输出 JSON，不要包裹代码块：
## {title}
### 本月材料概览
用 5-10 句话概括本月真实材料，保留具体项目、模块、学习对象、阶段变化和反复出现的问题。
### 时间线与关键事实
列出材料明确支持的重要事实，尽量按时间或主题组织。
### 概念、方法与工具
整理本月值得复习的概念、工具、代码结构、设计方法、调试方法或业务规则。必须让人看得懂，不要只写标题。
### 反复出现的主题
只写至少 2 条以上材料共同支持的跨周或多天主题。只出现一次的内容，不得放入主题；只能放在“时间线与关键事实”或“概念、方法与工具”里。证据不足就写“材料不足，暂不沉淀”。
### 可复用沉淀
允许基于原文进行归纳、压缩和结构化，但不得引入原文没有依据的新结论。每项必须具体到方法、规则、判断依据、适用场景或边界，不能只是把某天事实换个说法。尽量整理成第一人称也能直接复习的白话结论，表达要精炼、可理解。
### 复习要点
写成复习时可直接看的要点，不要写成提问，不要写未来计划。

写作视角使用第一人称整理事实、方法和判断，不要用“作者”。不写心理推断、情绪拔高或自我评价，除非材料明确出现。
禁止输出“今后问题”“还没解决的问题”“建议”“下一步计划”、心理推断或鸡汤，除非材料明确把这些内容写成文档材料。
不得为了满足条目数量而拆分、重复或泛化原文信息。内容不要过短；在材料足够且不重复的前提下，每个列表尽量输出 5-12 项；材料不足时写“材料不足，暂不沉淀”。

材料：
{source}"#,
            title = title,
            source = source
        )
    };
    let (raw_content, model) = call_ai(
        prompt,
        "你是一个严谨的中文复盘文档整理助手。只基于给定材料，区分事实和猜测，不编造。必须输出 Markdown，不要输出 JSON。",
    )
    .await?;
    let content = render_review_response(kind, &title, &raw_content);

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

    let prompt = r#"基于以下记录整理一份简洁的当日沉淀，只提炼原文已有信息，不做推断。

要求：
1. 使用 Markdown。
2. 简洁克制，避免空泛总结。
3. 只提炼原文明确提到的事实、方法、判断依据或可复用表述，不补充不推测。
4. 如果某方面原文未涉及，直接跳过不写，不要编造“问题”“计划”“建议”。

结构：
## 当日沉淀
### 事实记录
### 可复用沉淀
### 可引用表述

原文：
{content}"#
        .replace("{content}", &payload.content);

    let (summary, _) = call_ai(
        prompt,
        "你是一个严谨、克制的中文文档整理助手。只基于原文整理，不编造，不输出未来计划或建议，除非原文明确写出。",
    )
    .await?;

    Ok(Json(AiSummaryResponse { summary }))
}
