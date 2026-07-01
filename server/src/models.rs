use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct Article {
    pub(crate) id: String,
    pub(crate) date: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    pub(crate) tags: String,
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
    pub(crate) tags: String,
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
    pub(crate) source_article_ids: String,
    pub(crate) source_review_ids: String,
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
    pub(crate) tags: String,
    pub(crate) source_article_id: String,
    pub(crate) source_review_id: String,
    pub(crate) source_date: String,
    pub(crate) source_excerpt: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
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
    pub(crate) tags: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateArticlePayload {
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    pub(crate) tags: Option<String>,
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
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateKnowledgeCardPayload {
    pub(crate) card_type: String,
    pub(crate) status: Option<String>,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) tags: Option<String>,
    pub(crate) source_article_id: Option<String>,
    pub(crate) source_review_id: Option<String>,
    pub(crate) source_date: Option<String>,
    pub(crate) source_excerpt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateKnowledgeCardPayload {
    pub(crate) card_type: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) content: Option<String>,
    pub(crate) tags: Option<String>,
    pub(crate) source_article_id: Option<String>,
    pub(crate) source_review_id: Option<String>,
    pub(crate) source_date: Option<String>,
    pub(crate) source_excerpt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ExtractKnowledgeCardsPayload {
    pub(crate) content: String,
    pub(crate) source_article_id: Option<String>,
    pub(crate) source_review_id: Option<String>,
    pub(crate) source_date: Option<String>,
    pub(crate) max_cards: Option<usize>,
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
