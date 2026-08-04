use crate::db::Database;
use crate::helpers::format_date;
use crate::models::{
    DueQuery, DueReviewResponse, GradeCardPayload, HeatmapQuery, KnowledgeCard, ReviewHistoryEntry,
    ReviewStatsResponse,
};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use chrono::{Duration, Local, NaiveDate};
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;

pub(crate) fn valid_grade(value: &str) -> bool {
    matches!(value, "again" | "hard" | "good" | "easy")
}

/// SM-2 简化版评分结果：新的间隔天数、新的难度系数、下次复习日期。
#[derive(Debug, PartialEq)]
pub(crate) struct GradeOutcome {
    pub(crate) interval_days: f64,
    pub(crate) ease: f64,
    pub(crate) next_review_at: String,
}

/// 评分规则唯一实现（前端不重复实现）：
/// - again：当天重来，ease 降 0.2（下限 1.3），interval 归 0；
/// - hard：interval = max(1, round(interval*1.2))，ease 降 0.15（下限 1.3）；
/// - good：interval = max(1, round(interval*ease))，ease 不变；
/// - easy：interval = max(1, round(interval*ease*1.3))，ease 升 0.15（上限 3.0）；
/// - 首次复习（review_count=0）按 hard=1 / good=3 / easy=7 起算，again=今天。
pub(crate) fn apply_grade_rule(
    interval_days: f64,
    ease: f64,
    review_count: i64,
    grade: &str,
    today: NaiveDate,
) -> GradeOutcome {
    let first_review = review_count == 0;
    let (new_interval, new_ease) = match grade {
        "again" => (0.0, (ease - 0.2).max(1.3)),
        "hard" => {
            let interval = if first_review {
                1.0
            } else {
                (interval_days * 1.2).round().max(1.0)
            };
            (interval, (ease - 0.15).max(1.3))
        }
        "good" => {
            let interval = if first_review {
                3.0
            } else {
                (interval_days * ease).round().max(1.0)
            };
            (interval, ease)
        }
        "easy" => {
            let interval = if first_review {
                7.0
            } else {
                (interval_days * ease * 1.3).round().max(1.0)
            };
            (interval, (ease + 0.15).min(3.0))
        }
        _ => unreachable!("grade validated before use"),
    };
    let next_review_at = if grade == "again" {
        format_date(today)
    } else {
        format_date(today + Duration::days(new_interval as i64))
    };
    GradeOutcome {
        interval_days: new_interval,
        ease: new_ease,
        next_review_at,
    }
}

pub(crate) async fn due_cards(
    State(db): State<AppState>,
    Query(query): Query<DueQuery>,
) -> Result<Json<DueReviewResponse>, (StatusCode, String)> {
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let cards = db
        .knowledge()
        .due(limit, &today)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let stats = db
        .knowledge()
        .stats(&today)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(DueReviewResponse { cards, stats }))
}

pub(crate) async fn grade_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<GradeCardPayload>,
) -> Result<Json<KnowledgeCard>, (StatusCode, String)> {
    let grade = payload.grade.trim().to_string();
    if !valid_grade(&grade) {
        return Err((StatusCode::BAD_REQUEST, "Invalid grade".into()));
    }
    let today = Local::now().format("%Y-%m-%d").to_string();
    let today_date = NaiveDate::parse_from_str(&today, "%Y-%m-%d")
        .expect("server local date always parses as YYYY-MM-DD");
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let card = db
        .knowledge()
        .find(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Knowledge card not found".into()))?;
    if card.status != "confirmed" {
        return Err((
            StatusCode::BAD_REQUEST,
            "Knowledge card is not in the review queue".into(),
        ));
    }
    let outcome = apply_grade_rule(
        card.review_interval_days,
        card.review_ease,
        card.review_count,
        &grade,
        today_date,
    );
    db.knowledge()
        .apply_grade(
            &id,
            &grade,
            outcome.interval_days,
            outcome.ease,
            &outcome.next_review_at,
            &today,
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Knowledge card not found".into()))
}

pub(crate) async fn review_stats(
    State(db): State<AppState>,
) -> Result<Json<ReviewStatsResponse>, (StatusCode, String)> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .review_stats(&today)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn review_history(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<ReviewHistoryEntry>>, (StatusCode, String)> {
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .review_history(&id)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn review_heatmap(
    State(db): State<AppState>,
    Query(query): Query<HeatmapQuery>,
) -> Result<Json<Vec<crate::models::DailyReviewCount>>, (StatusCode, String)> {
    let days = query.days.unwrap_or(365).clamp(7, 730);
    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .review_heatmap(days, &today)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn touch_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<KnowledgeCard>, (StatusCode, String)> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.knowledge()
        .touch(&id, &today)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Knowledge card not found".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 16).expect("fixed test date")
    }

    #[test]
    fn first_good_schedules_three_days_keeping_ease() {
        let outcome = apply_grade_rule(0.0, 2.5, 0, "good", today());
        assert_eq!(outcome.interval_days, 3.0);
        assert_eq!(outcome.ease, 2.5);
        assert_eq!(outcome.next_review_at, "2026-07-19");
    }

    #[test]
    fn first_easy_schedules_seven_days_and_raises_ease_capped_at_three() {
        let outcome = apply_grade_rule(0.0, 2.5, 0, "easy", today());
        assert_eq!(outcome.interval_days, 7.0);
        assert_eq!(outcome.ease, 2.65);
        assert_eq!(outcome.next_review_at, "2026-07-23");

        let capped = apply_grade_rule(0.0, 3.0, 0, "easy", today());
        assert_eq!(capped.ease, 3.0);
    }

    #[test]
    fn again_reschedules_today_and_lowers_ease_floor_at_one_point_three() {
        let outcome = apply_grade_rule(0.0, 2.5, 0, "again", today());
        assert_eq!(outcome.interval_days, 0.0);
        assert_eq!(outcome.ease, 2.3);
        assert_eq!(outcome.next_review_at, "2026-07-16");

        let floored = apply_grade_rule(3.0, 1.3, 5, "again", today());
        assert_eq!(floored.ease, 1.3);
    }

    #[test]
    fn subsequent_good_grows_interval_by_ease() {
        // 首次 good → interval 3，再次 good → round(3*2.5)=8（round(7.5)=8）
        let first = apply_grade_rule(0.0, 2.5, 0, "good", today());
        let second = apply_grade_rule(first.interval_days, first.ease, 1, "good", today());
        assert_eq!(second.interval_days, 8.0);
        assert_eq!(second.next_review_at, "2026-07-24");
    }

    #[test]
    fn hard_interval_never_drops_below_one() {
        let outcome = apply_grade_rule(0.5, 2.0, 3, "hard", today());
        assert_eq!(outcome.interval_days, 1.0);
        assert_eq!(outcome.ease, 1.85);
    }
}
