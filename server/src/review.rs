use crate::db::{Database, GradeUpdate};
use crate::helpers::format_date;
use crate::models::{
    DueQuery, DueReviewResponse, GradeCardPayload, HeatmapQuery, KnowledgeCard, ReviewGradePreview,
    ReviewHistoryEntry, ReviewSettings, ReviewStatsResponse, UpdateReviewSettingsPayload,
};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use chrono::{Duration, Local, NaiveDate};
use fsrs::{MemoryState, FSRS};
use std::sync::{Arc, Mutex};

type AppState = Arc<Mutex<Database>>;

pub(crate) fn valid_grade(value: &str) -> bool {
    matches!(value, "again" | "hard" | "good" | "easy")
}

/// FSRS 评分结果：新的稳定性、新的难度、实际间隔天数、下次复习日期。
///
/// 字段语义（与数据库字段复用）：
/// - `stability` → 存 `review_items.review_interval_days`（FSRS 稳定性）
/// - `difficulty` → 存 `review_items.review_ease`（FSRS 难度 1~10）
/// - `interval_days` → 存 `review_log.interval_days`（实际间隔，供历史趋势图）
#[derive(Debug, PartialEq)]
pub(crate) struct GradeOutcome {
    pub(crate) stability: f64,
    pub(crate) difficulty: f64,
    pub(crate) interval_days: f64,
    pub(crate) next_review_at: String,
}

const DESIRED_RETENTION: f64 = 0.9;

/// 用 FSRS 计算评分结果。旧的 SM-2 数据（ease 1.3~3.0）通过 `memory_state_from_sm2` 懒迁移。
pub(crate) fn apply_grade_rule(
    interval_days: f64,
    ease: f64,
    review_count: i64,
    grade: &str,
    today: NaiveDate,
) -> GradeOutcome {
    let fsrs = FSRS::default();

    // 重建 MemoryState：
    // - 新卡（从未复习）→ None（FSRS 按全新卡调度）
    // - 旧 SM-2 数据（ease ≤ 3.0 且已复习过）→ 用 memory_state_from_sm2 懒迁移
    // - 新 FSRS 数据 → 直接用 stability + difficulty
    let memory_state = if review_count == 0 {
        None
    } else if ease <= 3.0 {
        fsrs.memory_state_from_sm2(ease as f32, interval_days as f32, DESIRED_RETENTION as f32)
            .ok()
    } else {
        Some(MemoryState {
            stability: interval_days as f32,
            difficulty: ease as f32,
        })
    };

    let next_states = fsrs
        .next_states(memory_state, DESIRED_RETENTION as f32, 0)
        .expect("FSRS next_states should not fail");

    let next = match grade {
        "again" => &next_states.again,
        "hard" => &next_states.hard,
        "good" => &next_states.good,
        "easy" => &next_states.easy,
        _ => unreachable!("grade validated before use"),
    };

    let new_interval = if grade == "again" {
        0.0
    } else {
        (next.interval as f64).round().max(1.0)
    };
    let next_review_at = if grade == "again" {
        format_date(today)
    } else {
        format_date(today + Duration::days(new_interval as i64))
    };

    GradeOutcome {
        stability: next.memory.stability as f64,
        difficulty: next.memory.difficulty as f64,
        interval_days: new_interval,
        next_review_at,
    }
}

pub(crate) async fn due_cards(
    State(db): State<AppState>,
    Query(query): Query<DueQuery>,
) -> Result<Json<DueReviewResponse>, (StatusCode, String)> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let settings = db
        .review_settings()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // 客户端可以临时请求更小批次，但不能绕过用户设置的服务端上限。
    let requested_limit = query.limit.unwrap_or(settings.session_limit).clamp(1, 100);
    let limit = requested_limit.min(settings.session_limit);
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

pub(crate) async fn review_settings(
    State(db): State<AppState>,
) -> Result<Json<ReviewSettings>, (StatusCode, String)> {
    let db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.review_settings()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub(crate) async fn update_review_settings(
    State(db): State<AppState>,
    Json(payload): Json<UpdateReviewSettingsPayload>,
) -> Result<Json<ReviewSettings>, (StatusCode, String)> {
    if !(0..=100).contains(&payload.new_cards_per_day) {
        return Err((
            StatusCode::BAD_REQUEST,
            "new_cards_per_day must be between 0 and 100".into(),
        ));
    }
    if !(1..=100).contains(&payload.session_limit) {
        return Err((
            StatusCode::BAD_REQUEST,
            "session_limit must be between 1 and 100".into(),
        ));
    }
    let settings = ReviewSettings {
        new_cards_per_day: payload.new_cards_per_day,
        session_limit: payload.session_limit,
    };
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    db.update_review_settings(&settings)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// 只读返回当前卡片在四种评分下的下一次复习安排，不写入卡片或复习日志。
pub(crate) async fn preview_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<ReviewGradePreview>>, (StatusCode, String)> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let today_date = NaiveDate::parse_from_str(&today, "%Y-%m-%d")
        .expect("server local date always parses as YYYY-MM-DD");
    let mut db = db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let item = db
        .knowledge()
        .find_review_item_for_review(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Review item not found".into()))?;
    if item.status != "active" {
        return Err((
            StatusCode::BAD_REQUEST,
            "Review item is not active in the review queue".into(),
        ));
    }
    let previews = ["again", "hard", "good", "easy"]
        .into_iter()
        .map(|grade| {
            let outcome = apply_grade_rule(
                item.review_interval_days,
                item.review_ease,
                item.review_count,
                grade,
                today_date,
            );
            ReviewGradePreview {
                grade: grade.to_string(),
                interval_days: outcome.interval_days,
                next_review_at: outcome.next_review_at,
            }
        })
        .collect();
    Ok(Json(previews))
}

pub(crate) async fn grade_card(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<GradeCardPayload>,
) -> Result<Json<crate::models::ReviewCard>, (StatusCode, String)> {
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
    let item = db
        .knowledge()
        .find_review_item_for_review(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Review item not found".into()))?;
    if item.status != "active" {
        return Err((
            StatusCode::BAD_REQUEST,
            "Review item is not active in the review queue".into(),
        ));
    }
    let outcome = apply_grade_rule(
        item.review_interval_days,
        item.review_ease,
        item.review_count,
        &grade,
        today_date,
    );
    db.knowledge()
        .apply_grade(GradeUpdate {
            id: &id,
            grade: &grade,
            stability: outcome.stability,
            difficulty: outcome.difficulty,
            interval_days: outcome.interval_days,
            next_review_at: &outcome.next_review_at,
            today: &today,
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Review item not found".into()))
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
    fn again_reschedules_today() {
        let outcome = apply_grade_rule(5.0, 5.0, 3, "again", today());
        assert_eq!(outcome.interval_days, 0.0);
        assert_eq!(outcome.next_review_at, "2026-07-16");
    }

    #[test]
    fn new_card_good_schedules_positive_interval() {
        let outcome = apply_grade_rule(0.0, 2.5, 0, "good", today());
        assert!(outcome.interval_days >= 1.0);
        assert!(outcome.difficulty > 0.0);
        assert!(outcome.next_review_at.as_str() > "2026-07-16");
    }

    #[test]
    fn ratings_are_ordered_by_interval() {
        let again = apply_grade_rule(5.0, 5.0, 3, "again", today());
        let hard = apply_grade_rule(5.0, 5.0, 3, "hard", today());
        let good = apply_grade_rule(5.0, 5.0, 3, "good", today());
        let easy = apply_grade_rule(5.0, 5.0, 3, "easy", today());
        assert!(again.interval_days < easy.interval_days);
        assert!(hard.interval_days <= good.interval_days);
        assert!(good.interval_days <= easy.interval_days);
    }

    #[test]
    fn legacy_sm2_data_migrates_to_fsrs_difficulty() {
        // 旧 SM-2：ease=2.5（≤3.0），interval=10，已复习过
        let outcome = apply_grade_rule(10.0, 2.5, 5, "good", today());
        assert!(outcome.interval_days >= 1.0);
        assert!(outcome.difficulty > 3.0);
    }

    #[test]
    fn again_increases_difficulty() {
        let good = apply_grade_rule(5.0, 5.0, 3, "good", today());
        let again = apply_grade_rule(good.stability, good.difficulty, 4, "again", today());
        assert!(again.difficulty > good.difficulty);
    }
}
