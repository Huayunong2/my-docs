use crate::db::Database;
use crate::helpers::*;
use crate::models::*;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;
use chrono::{Datelike, Duration, Local, NaiveDate};
use std::collections::{BTreeMap, BTreeSet};

// ── Helpers ─────────────────────────────────────────

pub(crate) async fn get_stats_overview(
    State(db): State<AppState>,
    Query(q): Query<StatsRangeQuery>,
) -> Result<Json<StatsOverview>, (StatusCode, String)> {
    let from = parse_date(&q.from)?;
    let to = parse_date(&q.to)?;
    if from > to {
        return Err((
            StatusCode::BAD_REQUEST,
            "`from` must be before or equal to `to`".into(),
        ));
    }

    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let articles = db
        .articles()
        .full_between(&q.from, &q.to)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut dates = BTreeSet::new();
    let mut total_words = 0;
    let mut mood_counts = BTreeMap::new();
    for article in articles {
        dates.insert(article.date);
        total_words += article.word_count;
        if !article.mood.trim().is_empty() {
            *mood_counts.entry(article.mood).or_insert(0) += 1;
        }
    }
    let mut exemptions = db
        .exemptions()
        .list(&q.from, &q.to)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for date in &dates {
        exemptions.remove(date);
    }

    let today = Local::now().date_naive();
    let mut cursor = if today < to { today } else { to };
    let mut current_streak = 0;
    let mut streak_exempted_days = 0;
    while cursor >= from {
        let key = cursor.format("%Y-%m-%d").to_string();
        if dates.contains(&key) {
            current_streak += 1;
        } else if exemptions.contains_key(&key) {
            current_streak += 1;
            streak_exempted_days += 1;
        } else {
            break;
        }
        cursor -= Duration::days(1);
    }

    let days_written = dates.len() as i64;
    let exempted_days = exemptions.len() as i64;
    let total_days = (to - from).num_days() + 1;
    let missing_days = (total_days - days_written - exempted_days).max(0);
    let avg_words = if days_written > 0 {
        total_words as f64 / days_written as f64
    } else {
        0.0
    };

    Ok(Json(StatsOverview {
        days_written,
        current_streak,
        streak_exempted_days,
        exempted_days,
        missing_days,
        total_words,
        avg_words,
        mood_counts,
    }))
}
pub(crate) async fn get_month_stats(
    State(db): State<AppState>,
    Query(q): Query<StatsMonthQuery>,
) -> Result<Json<Vec<MonthDayStats>>, (StatusCode, String)> {
    let first = NaiveDate::from_ymd_opt(q.year, q.month, 1)
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "Invalid year or month".to_string()))?;
    let next_month = if q.month == 12 {
        NaiveDate::from_ymd_opt(q.year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(q.year, q.month + 1, 1)
    }
    .ok_or_else(|| (StatusCode::BAD_REQUEST, "Invalid year or month".to_string()))?;

    let from = first.format("%Y-%m-%d").to_string();
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let last = (next_month - Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    let rows = db
        .articles()
        .full_between(&from, &last)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut articles = BTreeMap::new();
    for article in rows {
        articles.insert(
            article.date,
            (article.id, article.title, article.mood, article.word_count),
        );
    }
    let exemptions = db
        .exemptions()
        .list(&from, &last)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut days = Vec::new();
    let mut cursor = first;
    while cursor < next_month {
        let date = cursor.format("%Y-%m-%d").to_string();
        if let Some((id, title, mood, word_count)) = articles.get(&date) {
            days.push(MonthDayStats {
                date,
                has_article: true,
                word_count: *word_count,
                mood: mood.clone(),
                title: title.clone(),
                id: Some(id.clone()),
                exemption: None,
            });
        } else {
            days.push(MonthDayStats {
                date: date.clone(),
                has_article: false,
                word_count: 0,
                mood: String::new(),
                title: String::new(),
                id: None,
                exemption: exemptions.get(&date).cloned(),
            });
        }
        cursor += Duration::days(1);
    }

    Ok(Json(days))
}
pub(crate) async fn get_week_review(
    State(db): State<AppState>,
    Query(q): Query<WeekQuery>,
) -> Result<Json<WeekReview>, (StatusCode, String)> {
    let anchor = parse_date(&q.date)?;
    let week_start = anchor - Duration::days(anchor.weekday().num_days_from_monday() as i64);
    let week_end = week_start + Duration::days(6);
    let from = week_start.format("%Y-%m-%d").to_string();
    let to = week_end.format("%Y-%m-%d").to_string();

    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows = db
        .articles()
        .full_between(&from, &to)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut articles = Vec::new();
    let mut written_dates = BTreeSet::new();
    let mut total_words = 0;
    let mut term_counts = BTreeMap::new();
    for article in rows {
        let summary = ArticleSummary {
            id: article.id,
            date: article.date,
            title: article.title,
            mood: article.mood,
            tags: article.tags,
            word_count: article.word_count,
            preview: preview(&article.content, 120),
        };
        written_dates.insert(summary.date.clone());
        total_words += summary.word_count;
        collect_terms(&summary.title, &mut term_counts);
        collect_terms(&article.content, &mut term_counts);
        articles.push(summary);
    }
    let mut exemptions = db
        .exemptions()
        .list(&from, &to)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for date in &written_dates {
        exemptions.remove(date);
    }
    let mut missing_days = Vec::new();
    let mut cursor = week_start;
    while cursor <= week_end {
        let key = cursor.format("%Y-%m-%d").to_string();
        if !written_dates.contains(&key) && !exemptions.contains_key(&key) {
            missing_days.push(key);
        }
        cursor += Duration::days(1);
    }
    let longest_article = articles.iter().max_by_key(|a| a.word_count).cloned();
    let days_written = articles.len() as i64;
    let avg_words = if days_written > 0 {
        total_words as f64 / days_written as f64
    } else {
        0.0
    };
    let mut top_terms = term_counts
        .into_iter()
        .map(|(term, count)| TermCount { term, count })
        .collect::<Vec<_>>();
    top_terms.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.term.cmp(&b.term)));
    top_terms.truncate(12);

    Ok(Json(WeekReview {
        from,
        to,
        days_written,
        exempted_days: exemptions.len() as i64,
        missing_days,
        longest_article,
        total_words,
        avg_words,
        top_terms,
    }))
}
