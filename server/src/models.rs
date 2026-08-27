use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct Article {
    pub(crate) id: String,
    pub(crate) date: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    pub(crate) tags: Vec<String>,
    pub(crate) word_count: i64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ArticleSummary {
    pub(crate) id: String,
    pub(crate) date: String,
    pub(crate) title: String,
    pub(crate) mood: String,
    pub(crate) tags: Vec<String>,
    pub(crate) word_count: i64,
    pub(crate) preview: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ArchiveMonth {
    pub(crate) year: i32,
    pub(crate) month: u32,
}

#[derive(Debug, Serialize)]
pub(crate) struct StatsOverview {
    pub(crate) days_written: i64,
    pub(crate) current_streak: i64,
    pub(crate) streak_exempted_days: i64,
    pub(crate) exempted_days: i64,
    pub(crate) missing_days: i64,
    pub(crate) total_words: i64,
    pub(crate) avg_words: f64,
    pub(crate) mood_counts: BTreeMap<String, i64>,
}

#[derive(Debug, Serialize)]
pub(crate) struct MonthDayStats {
    pub(crate) date: String,
    pub(crate) has_article: bool,
    pub(crate) word_count: i64,
    pub(crate) mood: String,
    pub(crate) title: String,
    pub(crate) id: Option<String>,
    pub(crate) exemption: Option<DayExemption>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct DayExemption {
    pub(crate) date: String,
    pub(crate) reason: String,
    pub(crate) note: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpsertDayExemptionPayload {
    pub(crate) reason: String,
    pub(crate) note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct DateRangeQuery {
    pub(crate) from: String,
    pub(crate) to: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WeekQuery {
    pub(crate) date: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct TermCount {
    pub(crate) term: String,
    pub(crate) count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct WeekReview {
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) days_written: i64,
    pub(crate) exempted_days: i64,
    pub(crate) missing_days: Vec<String>,
    pub(crate) longest_article: Option<ArticleSummary>,
    pub(crate) total_words: i64,
    pub(crate) avg_words: f64,
    pub(crate) top_terms: Vec<TermCount>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct Review {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) period_start: String,
    pub(crate) period_end: String,
    pub(crate) version: i64,
    pub(crate) status: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) source_article_ids: Vec<String>,
    pub(crate) source_review_ids: Vec<String>,
    pub(crate) model: String,
    pub(crate) generated_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct KnowledgeCard {
    pub(crate) id: String,
    pub(crate) card_type: String,
    pub(crate) status: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) tags: Vec<String>,
    pub(crate) source_article_id: String,
    pub(crate) source_review_id: String,
    pub(crate) source_date: String,
    pub(crate) source_excerpt: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) review_state: String,
    #[serde(default)]
    pub(crate) review_interval_days: f64,
    #[serde(default = "default_review_ease")]
    pub(crate) review_ease: f64,
    #[serde(default)]
    pub(crate) review_count: i64,
    #[serde(default)]
    pub(crate) last_reviewed_at: String,
    #[serde(default)]
    pub(crate) next_review_at: String,
    #[serde(default)]
    pub(crate) usage_count: i64,
    #[serde(default)]
    pub(crate) last_used_at: String,
    #[serde(default)]
    pub(crate) related_ids: Vec<String>,
    /// 主动声明边（存储原始值）；related_ids 是含反向合成的展示值。
    /// 编辑表单只应基于声明边，避免把反向合成边物化回存储。
    #[serde(default)]
    pub(crate) declared_related_ids: Vec<String>,
    #[serde(default)]
    pub(crate) first_reviewed_at: String,
    #[serde(default)]
    pub(crate) projects: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct KnowledgeCardsPage {
    pub(crate) cards: Vec<KnowledgeCard>,
    pub(crate) total: i64,
    pub(crate) page: i64,
    pub(crate) page_size: i64,
    pub(crate) has_more: bool,
}

#[derive(Debug, Serialize, Default)]
pub(crate) struct KnowledgeSummary {
    pub(crate) total: i64,
    pub(crate) draft: i64,
    pub(crate) confirmed: i64,
    pub(crate) outdated: i64,
    pub(crate) missing_source: i64,
    pub(crate) missing_project: i64,
    pub(crate) missing_tags: i64,
    pub(crate) short_content: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct KnowledgeSavedView {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) filters: Value,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

fn default_review_ease() -> f64 {
    2.5
}

#[derive(Debug, Serialize)]
pub(crate) struct KnowledgeTagCount {
    pub(crate) tag: String,
    pub(crate) count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct KnowledgeProject {
    pub(crate) name: String,
    pub(crate) count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReviewStats {
    pub(crate) due: i64,
    pub(crate) due_reviews: i64,
    pub(crate) new_cards: i64,
    pub(crate) reviewed_today: i64,
    pub(crate) total_confirmed: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct DueReviewResponse {
    pub(crate) cards: Vec<KnowledgeCard>,
    pub(crate) stats: ReviewStats,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub(crate) struct ReviewSettings {
    pub(crate) new_cards_per_day: i64,
    pub(crate) session_limit: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateReviewSettingsPayload {
    pub(crate) new_cards_per_day: i64,
    pub(crate) session_limit: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReviewGradePreview {
    pub(crate) grade: String,
    pub(crate) interval_days: f64,
    pub(crate) next_review_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct DailyReviewCount {
    pub(crate) date: String,
    pub(crate) count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReviewStatsResponse {
    pub(crate) total_reviews: i64,
    pub(crate) streak_days: i64,
    pub(crate) reviewed_today: i64,
    pub(crate) due: i64,
    pub(crate) total_confirmed: i64,
    pub(crate) learning: i64,
    pub(crate) mature: i64,
    pub(crate) new_cards: i64,
    pub(crate) upcoming: Vec<DailyReviewCount>,
    pub(crate) daily: Vec<DailyReviewCount>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReviewHistoryEntry {
    pub(crate) grade: String,
    pub(crate) interval_days: f64,
    pub(crate) ease: f64,
    pub(crate) next_review_at: String,
    pub(crate) reviewed_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct BackupMeta {
    pub(crate) name: String,
    pub(crate) size_bytes: u64,
    pub(crate) created_at: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateArticlePayload {
    pub(crate) date: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    #[serde(default, deserialize_with = "deserialize_optional_tags")]
    pub(crate) tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateArticlePayload {
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    #[serde(default, deserialize_with = "deserialize_optional_tags")]
    pub(crate) tags: Option<Vec<String>>,
}

fn deserialize_optional_tags<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum TagsInput {
        List(Vec<String>),
        Json(String),
    }

    match Option::<TagsInput>::deserialize(deserializer)? {
        None => Ok(None),
        Some(TagsInput::List(tags)) => Ok(Some(tags)),
        Some(TagsInput::Json(tags)) => serde_json::from_str::<Vec<String>>(&tags)
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}

#[cfg(test)]
mod tests {
    use super::{CreateArticlePayload, UpdateArticlePayload};

    #[test]
    fn update_article_payload_accepts_legacy_json_encoded_tags() {
        let payload: UpdateArticlePayload = serde_json::from_value(serde_json::json!({
            "title": "标题",
            "content": "编辑后的正文",
            "mood": "",
            "tags": "[]"
        }))
        .expect("legacy clients encode tags as a JSON string");

        assert_eq!(payload.tags, Some(Vec::new()));
    }

    #[test]
    fn article_payloads_keep_accepting_tag_arrays() {
        let create: CreateArticlePayload = serde_json::from_value(serde_json::json!({
            "date": "2026-07-16",
            "title": "标题",
            "content": "正文",
            "mood": "",
            "tags": ["工作", "Rust"]
        }))
        .expect("current clients send tags as an array");
        let update: UpdateArticlePayload = serde_json::from_value(serde_json::json!({
            "title": "标题",
            "content": "正文",
            "mood": ""
        }))
        .expect("tags remain optional");

        assert_eq!(create.tags, Some(vec!["工作".into(), "Rust".into()]));
        assert_eq!(update.tags, None);
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct ExportPayload {
    pub(crate) ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ListQuery {
    pub(crate) page: Option<i64>,
    pub(crate) page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SearchQuery {
    pub(crate) q: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TodayQuery {
    pub(crate) date: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct StatsRangeQuery {
    pub(crate) from: String,
    pub(crate) to: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct StatsMonthQuery {
    pub(crate) year: i32,
    pub(crate) month: u32,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReviewListQuery {
    pub(crate) kind: Option<String>,
    pub(crate) period_start: Option<String>,
    pub(crate) period_end: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct KnowledgeListQuery {
    pub(crate) card_type: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) q: Option<String>,
    pub(crate) usage: Option<String>,
    pub(crate) tag: Option<String>,
    pub(crate) project: Option<String>,
    pub(crate) quality: Option<String>,
    pub(crate) sort: Option<String>,
    pub(crate) page: Option<i64>,
    pub(crate) page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateKnowledgeProjectPayload {
    pub(crate) name: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SaveKnowledgeViewPayload {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) filters: Value,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateKnowledgeViewPayload {
    pub(crate) name: Option<String>,
    pub(crate) filters: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct DueQuery {
    pub(crate) limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct HeatmapQuery {
    pub(crate) days: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GradeCardPayload {
    pub(crate) grade: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateKnowledgeCardPayload {
    pub(crate) card_type: String,
    pub(crate) status: Option<String>,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) tags: Option<Vec<String>>,
    pub(crate) source_article_id: Option<String>,
    pub(crate) source_review_id: Option<String>,
    pub(crate) source_date: Option<String>,
    pub(crate) source_excerpt: Option<String>,
    pub(crate) related_ids: Option<Vec<String>>,
    pub(crate) projects: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateKnowledgeCardPayload {
    pub(crate) card_type: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) content: Option<String>,
    pub(crate) tags: Option<Vec<String>>,
    pub(crate) source_article_id: Option<String>,
    pub(crate) source_review_id: Option<String>,
    pub(crate) source_date: Option<String>,
    pub(crate) source_excerpt: Option<String>,
    pub(crate) related_ids: Option<Vec<String>>,
    pub(crate) projects: Option<Vec<String>>,
}

/// 批量操作：对一组卡片执行状态更新、标签/项目更新或删除。
#[derive(Debug, Deserialize)]
pub(crate) struct BatchKnowledgeCardsPayload {
    pub(crate) ids: Vec<String>,
    pub(crate) action: String,
    #[serde(default)]
    pub(crate) values: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ExtractKnowledgeCardsPayload {
    pub(crate) content: String,
    pub(crate) source_article_id: Option<String>,
    pub(crate) source_review_id: Option<String>,
    pub(crate) source_date: Option<String>,
    pub(crate) max_cards: Option<usize>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ExtractCardsResponse {
    pub(crate) cards: Vec<KnowledgeCard>,
    pub(crate) skipped: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GenerateReviewPayload {
    pub(crate) kind: String,
    pub(crate) date: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateReviewPayload {
    pub(crate) title: Option<String>,
    pub(crate) content: Option<String>,
    pub(crate) status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AiSummaryPayload {
    pub(crate) content: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AiSummaryResponse {
    pub(crate) summary: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChatCompletionResponse {
    pub(crate) choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChatChoice {
    pub(crate) message: ChatMessage,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ChatMessage {
    pub(crate) role: String,
    pub(crate) content: String,
}
