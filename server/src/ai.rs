use crate::ai_client::{
    complete_with_retry, record_ai_failure, record_ai_success, HttpAiAdapter,
};
use crate::db::{Database, ReviewDraft};
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use serde_json::Value;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
use std::collections::BTreeSet;

type MonthlyReviewSource = (String, Vec<String>, Vec<String>);

// ── Helpers ─────────────────────────────────────────

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(default)
}

pub(crate) async fn call_ai(
    prompt: String,
    system: &str,
) -> Result<(String, String), (StatusCode, String)> {
    let retries = env_u64("DAILY_SUMMARY_AI_RETRIES", 2);
    let result = async {
        let adapter =
            HttpAiAdapter::from_env().map_err(|failure| (failure.status, failure.message))?;
        let response = complete_with_retry(&adapter, &prompt, system, retries, true)
            .await
            .map_err(|failure| (failure.status, failure.message))?;
        Ok((response.content, response.model))
    }
    .await;
    if result.is_ok() {
        record_ai_success();
    } else {
        record_ai_failure();
    }
    result
}
pub(crate) async fn list_reviews(
    State(db): State<AppState>,
    Query(q): Query<ReviewListQuery>,
) -> Result<Json<Vec<Review>>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let period = if let (Some(kind), Some(period_start), Some(period_end)) = (
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
        Some((period_start, period_end))
    } else if q.period_start.is_none() && q.period_end.is_none() {
        if let Some(kind) = q.kind.as_deref() {
            if !valid_review_kind(kind) {
                return Err((StatusCode::BAD_REQUEST, "Invalid review kind".into()));
            }
        }
        None
    } else {
        return Err((
            StatusCode::BAD_REQUEST,
            "period_start and period_end must be provided together".into(),
        ));
    };
    db.reviews()
        .list(q.kind.as_deref(), period)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
pub(crate) async fn get_review(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Review>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.reviews()
        .find(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Review not found".into()))
}
pub(crate) fn load_weekly_review_source(
    db: &mut Database,
    from: &str,
    to: &str,
) -> Result<(String, Vec<String>), (StatusCode, String)> {
    let rows = db
        .articles()
        .full_between(from, to)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut ids = Vec::new();
    let mut parts = Vec::new();
    for article in rows {
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
    db: &mut Database,
    from: &str,
    to: &str,
) -> Result<MonthlyReviewSource, (StatusCode, String)> {
    let rows = db
        .reviews()
        .confirmed_weekly_overlapping(from, to)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut ids = Vec::new();
    let mut parts = Vec::new();
    let mut seen_periods = BTreeSet::new();
    let mut covered_dates = BTreeSet::new();
    for review in rows {
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
            if d >= month_start && d <= month_end {
                days_in_month += 1;
            }
            d += chrono::Duration::days(1);
        }
        let is_cross_month = days_in_month < days_total;

        let mut date = start.max(month_start);
        while date <= end.min(month_end) {
            covered_dates.insert(format_date(date));
            date += chrono::Duration::days(1);
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
    let article_rows = db
        .articles()
        .full_between(from, to)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut uncovered_articles = Vec::new();
    for article in article_rows {
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
            if article.tags.is_empty() {
                "[]".to_string()
            } else {
                article.tags.join("、")
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

    let (source, source_article_ids, source_review_ids) = {
        let mut db = db
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if kind == "weekly" {
            let (source, ids) = load_weekly_review_source(&mut db, &from, &to)?;
            (source, ids, Vec::new())
        } else {
            let (source, article_ids, review_ids) =
                load_monthly_review_source(&mut db, &from, &to)?;
            (source, article_ids, review_ids)
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
只写至少 2 条以上材料共同支持的主题或模式。只出现一次的内容，不得放入主题；只能放在"时间线与关键事实"或"概念、方法与工具"里。每个主题与模式应在表述中体现至少两个支撑来源，例如日期、模块、事件或重复出现的问题，避免把单日内容拔高为本周主题。
### 可复用沉淀
允许基于原文进行归纳、压缩和结构化，但不得引入原文没有依据的新结论。每项必须具体到方法、规则、判断依据、适用场景或边界，不能只是把当天事实换个说法。尽量整理成第一人称也能直接复习的白话结论，表达要精炼、可理解。
### 复习要点
写成复习时可直接看的要点，不要写成提问，不要写未来计划。

写作视角使用第一人称整理事实、方法和判断，不要用“作者”。不写心理推断、情绪拔高或自我评价，除非原文明确出现。
禁止输出“今后问题”“还没解决的问题”“建议”“下一步计划”、心理推断或鸡汤，除非原文明确把这些内容写成文档材料。
不得为了满足条目数量而拆分、重复或泛化原文信息。在材料足够且不重复的前提下，每个列表通常输出 4-10 项；材料不足时少写或写"材料不足，暂不沉淀"。
涉及代码、函数、类、命令、配置项、文件名时，优先保留原文中的关键名称，避免只写泛泛描述。
同一方法或判断不要在同一章节内重复表达；复习要点只写最终压缩后的版本。

输出前自行检查但不要展示检查过程：
1. 是否出现原文没有的事实、计划、建议或心理推断；
2. 是否把只出现一次的内容放进了主题；
3. 是否重复总结了同一日期、同一任务或同一方法；
4. 是否保留了关键函数名、类名、模块名或命令名；
5. 是否每条可复用沉淀都具体到方法、规则、判断依据、适用场景或边界。

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

去重规则（硬约束）：同一日期、同一主题、同一任务只总结一次。周复盘已准确归纳的事项，月复盘优先沿用其归纳表达；每日记录只用于补充周复盘未覆盖的日期、未提到的具体事实或更精确的技术细节。不得重复提取同一事项，也不得因为周复盘已有总结而忽略每日记录中未被覆盖的关键技术点。
当周复盘与每日记录出现不一致或粒度冲突时，以日期更明确、事实更具体的每日记录为准；周复盘主要用于主题结构和归纳表达。
低频且只出现一次的细节只放入时间线或概念工具，不进入反复主题和可复用沉淀。
每个反复出现的主题应在表述中体现至少两个支撑来源，例如日期、周次、模块或事件。
涉及代码、函数、类、命令、配置项、文件名时，优先保留原文中的关键名称，避免只写泛泛描述。

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
不得为了满足条目数量而拆分、重复或泛化原文信息。在材料足够且不重复的前提下，每个列表通常输出 5-12 项；材料不足时少写或写"材料不足，暂不沉淀"。
同一方法或判断不要在同一章节内重复表达；复习要点只写最终压缩后的版本。

输出前自行检查但不要展示检查过程：
1. 是否出现原文没有的事实、计划、建议或心理推断；
2. 是否把只出现一次的内容放进了主题；
3. 是否重复总结了同一日期、同一任务或同一方法；
4. 是否保留了关键函数名、类名、模块名或命令名；
5. 是否每条可复用沉淀都具体到方法、规则、判断依据、适用场景或边界。

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

    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.reviews()
        .save(ReviewDraft {
            kind: kind.into(),
            period_start: from,
            period_end: to,
            title,
            content,
            source_article_ids,
            source_review_ids,
            model,
        })
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
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

    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let existing = db
        .reviews()
        .find(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Review not found".into()))?;
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
    db.reviews()
        .update(&id, &title, &content, &status)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Review not found".into()))
}
pub(crate) async fn delete_review(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let deleted = db
        .reviews()
        .delete(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !deleted {
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

    let prompt = r#"基于以下记录整理一份简洁的当日复盘，只提炼原文已有信息，不做推断。

要求：
1. 使用 Markdown。
2. 输出要短，避免长篇总结。
3. 只基于原文明确提到的事实、概念、方法、判断依据、函数名、类名、模块名或问题，不补充、不推测。
4. 不写未来计划、建议、心理评价或空泛总结，除非原文明确写出。
5. "简要说明"控制在 1 段，尽量 3-6 句话，保留当天最关键的项目、模块、问题、方法或学习对象。
6. "自测问题"用于检查我是否能回答上当天学到或做过的关键点。
7. 自测问题数量不要过多：材料充足时输出 3-6 个；材料较少时输出 1-3 个；材料不足时写"材料不足，暂不生成自测问题"。
8. 自测问题必须能从原文中找到依据，不问原文没有答案的问题，不制造延伸题。
9. 问题应具体，优先围绕函数名、类名、模块名、流程、概念区别、判断依据、调试方法或易错点。
10. "参考答案"必须与自测问题一一对应，答案要简短、准确，只基于原文，不扩展新知识。
11. 每个参考答案尽量 1-3 句话；如果原文只支持很短答案，就直接简短回答。
12. 参考答案只用于核对，不重新展开成长篇解释；能一句话说清就不要写多句。
13. 不要为了凑数量拆分、重复或泛化内容。
14. 如果自测问题写了"材料不足，暂不生成自测问题"，则参考答案也写"材料不足，暂不生成参考答案"，不要编造答案。

结构：
## 当日复盘
### 简要说明
用一段话概括当天真实内容。
### 自测问题
1. 问题 1
2. 问题 2
3. 问题 3
### 参考答案
1. 答案 1
2. 答案 2
3. 答案 3

原文：
{content}"#
        .replace("{content}", &payload.content);

    let (summary, _) = call_ai(
        prompt,
        "你是一个严谨、克制的中文复盘文档整理助手。只基于给定原文整理，不编造、不推断。不要输出未来计划、建议或心理评价，除非原文明确写出。你的目标是生成一份短小、可复习、可自测、答案有依据的当日复盘。",
    )
    .await?;

    Ok(Json(AiSummaryResponse { summary }))
}
