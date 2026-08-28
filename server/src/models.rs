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
    /// 记录可以属于多个主题/项目空间；旧客户端缺少该字段时按空列表处理。
    #[serde(default)]
    pub(crate) spaces: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ArticleSummary {
    pub(crate) id: String,
    pub(crate) date: String,
    pub(crate) title: String,
    pub(crate) mood: String,
    pub(crate) tags: Vec<String>,
    /// 摘要列表也携带空间，历史/归档页面无需再为展示标签额外请求全文。
    #[serde(default)]
    pub(crate) spaces: Vec<String>,
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
    /// 知识正文版本；复习题记录它所依据的版本，用于识别过期答案。
    #[serde(default = "default_content_version")]
    pub(crate) content_version: i64,
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

/// 知识条目下可独立调度的主动回忆单元。
///
/// 复习题与 KnowledgeCard 分离：条目正文可以很长，复习题只保存一个短提示和答案。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ReviewItem {
    pub(crate) id: String,
    pub(crate) knowledge_card_id: String,
    pub(crate) item_type: String,
    pub(crate) status: String,
    pub(crate) prompt: String,
    pub(crate) answer: String,
    pub(crate) hint: String,
    pub(crate) source_version: i64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) review_state: String,
    pub(crate) review_interval_days: f64,
    pub(crate) review_ease: f64,
    pub(crate) review_count: i64,
    pub(crate) last_reviewed_at: String,
    pub(crate) next_review_at: String,
    pub(crate) first_reviewed_at: String,
}

/// 复习队列的轻量投影：只包含主动回忆所需内容和回溯来源，不返回知识条目全文。
#[derive(Debug, Serialize, Clone)]
pub(crate) struct ReviewCard {
    pub(crate) id: String,
    pub(crate) knowledge_card_id: String,
    pub(crate) item_type: String,
    pub(crate) item_status: String,
    pub(crate) prompt: String,
    pub(crate) answer: String,
    pub(crate) hint: String,
    pub(crate) title: String,
    pub(crate) card_type: String,
    pub(crate) card_status: String,
    pub(crate) tags: Vec<String>,
    pub(crate) source_article_id: String,
    pub(crate) source_review_id: String,
    pub(crate) source_date: String,
    pub(crate) source_excerpt: String,
    pub(crate) related_ids: Vec<String>,
    pub(crate) projects: Vec<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) review_state: String,
    pub(crate) review_interval_days: f64,
    pub(crate) review_ease: f64,
    pub(crate) review_count: i64,
    pub(crate) last_reviewed_at: String,
    pub(crate) next_review_at: String,
    pub(crate) first_reviewed_at: String,
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

fn default_content_version() -> i64 {
    1
}

#[derive(Debug, Serialize)]
pub(crate) struct KnowledgeTagCount {
    pub(crate) tag: String,
    pub(crate) count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct KnowledgeProject {
    pub(crate) name: String,
    /// 兼容旧 API：知识卡片数量；每日记录另行统计，避免旧的卡片筛选计数失真。
    pub(crate) count: i64,
    pub(crate) article_count: i64,
    pub(crate) total_count: i64,
    /// `topic` 表示长期领域，`project` 表示有生命周期的目标空间。
    pub(crate) kind: String,
    pub(crate) description: String,
    pub(crate) status: String,
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
    pub(crate) cards: Vec<ReviewCard>,
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

/// 服务端实际使用的 AI 配置。API Key 只在服务端内存和持久化层流转，不能直接序列化返回。
#[derive(Clone)]
pub(crate) struct AiConfig {
    pub(crate) api_key: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) temperature: f32,
    pub(crate) max_tokens: u64,
    pub(crate) timeout_secs: u64,
    pub(crate) retries: u64,
    pub(crate) min_interval_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AiTask {
    DailySummary,
    KnowledgeExtract,
    WeeklyReview,
    MonthlyReview,
}

impl AiTask {
    pub(crate) const ALL: [Self; 4] = [
        Self::DailySummary,
        Self::KnowledgeExtract,
        Self::WeeklyReview,
        Self::MonthlyReview,
    ];

    pub(crate) const fn key(self) -> &'static str {
        match self {
            Self::DailySummary => "daily_summary",
            Self::KnowledgeExtract => "knowledge_extract",
            Self::WeeklyReview => "weekly_review",
            Self::MonthlyReview => "monthly_review",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AiModelProfile {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) model: String,
    pub(crate) temperature: f32,
    pub(crate) max_tokens: u64,
    pub(crate) timeout_secs: u64,
    pub(crate) retries: u64,
    pub(crate) min_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AiRoutingConfig {
    pub(crate) profiles: Vec<AiModelProfile>,
    pub(crate) routes: BTreeMap<String, String>,
    pub(crate) fallback_profile: String,
}

impl AiRoutingConfig {
    pub(crate) fn from_global(config: &AiConfig) -> Self {
        let profile = |id: &str, name: &str| AiModelProfile {
            id: id.into(),
            name: name.into(),
            model: config.model.clone(),
            temperature: config.temperature,
            max_tokens: config.max_tokens,
            timeout_secs: config.timeout_secs,
            retries: config.retries,
            min_interval_ms: config.min_interval_ms,
        };
        let mut routes = BTreeMap::new();
        routes.insert(AiTask::DailySummary.key().into(), "fast".into());
        routes.insert(AiTask::KnowledgeExtract.key().into(), "fast".into());
        routes.insert(AiTask::WeeklyReview.key().into(), "pro".into());
        routes.insert(AiTask::MonthlyReview.key().into(), "pro".into());
        Self {
            profiles: vec![profile("fast", "快速模型"), profile("pro", "高质量模型")],
            routes,
            fallback_profile: "fast".into(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAiConfigPayload {
    /// 只接受新 Key；读取接口永远不会返回该字段。留空时应省略，保持当前 Key 不变。
    pub(crate) api_key: Option<String>,
    #[serde(default)]
    pub(crate) clear_api_key: bool,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) temperature: f32,
    pub(crate) max_tokens: u64,
    pub(crate) timeout_secs: u64,
    pub(crate) retries: u64,
    pub(crate) min_interval_ms: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct AiConfigResponse {
    pub(crate) configured: bool,
    pub(crate) api_key_configured: bool,
    pub(crate) api_key_source: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) temperature: f32,
    pub(crate) max_tokens: u64,
    pub(crate) timeout_secs: u64,
    pub(crate) retries: u64,
    pub(crate) min_interval_ms: u64,
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
    /// 评分时的复习题快照，防止题目编辑后历史记录失去上下文。
    pub(crate) prompt_snapshot: String,
    pub(crate) answer_snapshot: String,
    pub(crate) review_item_source_version: i64,
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
    #[serde(default, deserialize_with = "deserialize_optional_tags")]
    pub(crate) spaces: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateArticlePayload {
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) mood: String,
    #[serde(default, deserialize_with = "deserialize_optional_tags")]
    pub(crate) tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_tags")]
    pub(crate) spaces: Option<Vec<String>>,
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
pub(crate) struct CreateKnowledgeProjectPayload {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) kind: Option<String>,
    #[serde(default)]
    pub(crate) description: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct SpaceListQuery {
    #[serde(default)]
    pub(crate) include_archived: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateKnowledgeSpacePayload {
    pub(crate) name: String,
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) description: String,
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
pub(crate) struct CreateReviewItemPayload {
    pub(crate) item_type: Option<String>,
    pub(crate) prompt: String,
    pub(crate) answer: String,
    pub(crate) hint: Option<String>,
    pub(crate) status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateReviewItemPayload {
    pub(crate) item_type: Option<String>,
    pub(crate) prompt: Option<String>,
    pub(crate) answer: Option<String>,
    pub(crate) hint: Option<String>,
    pub(crate) status: Option<String>,
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

#[derive(Debug, Deserialize)]
pub(crate) struct AnalyzeKnowledgeCardsPayload {
    pub(crate) content: String,
    #[serde(default)]
    pub(crate) source_name: String,
    pub(crate) max_cards: Option<usize>,
}

/// 长文档 AI 导入任务的创建结果；分析在服务端后台继续执行，避免请求超时。
#[derive(Debug, Serialize)]
pub(crate) struct AnalyzeCardsJobCreatedResponse {
    pub(crate) job_id: String,
    pub(crate) status: String,
    pub(crate) total_chars: usize,
    pub(crate) total_chunks: usize,
    pub(crate) max_cards: usize,
}

/// 一个后台分析分块的可观测状态；正文不会随轮询接口返回，避免重复传输原文。
#[derive(Debug, Serialize, Clone)]
pub(crate) struct AnalyzeCardsJobChunkResponse {
    pub(crate) index: usize,
    pub(crate) start_char: usize,
    pub(crate) end_char: usize,
    pub(crate) status: String,
    pub(crate) attempts: usize,
    pub(crate) card_count: usize,
    pub(crate) error: Option<String>,
}

/// 已完成的一批候选卡片；前端可以在任务仍运行时逐批显示预览。
#[derive(Debug, Serialize, Clone)]
pub(crate) struct AnalyzeCardsJobBatchResponse {
    pub(crate) index: usize,
    pub(crate) start_char: usize,
    pub(crate) end_char: usize,
    pub(crate) cards: Vec<KnowledgeCardCandidate>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AnalyzeCardsJobResponse {
    pub(crate) job_id: String,
    pub(crate) status: String,
    pub(crate) source_name: String,
    pub(crate) total_chars: usize,
    pub(crate) total_chunks: usize,
    pub(crate) finished_chunks: usize,
    pub(crate) completed_chunks: usize,
    pub(crate) failed_chunks: usize,
    pub(crate) skipped_chunks: usize,
    pub(crate) active_chunk: Option<usize>,
    pub(crate) progress_percent: u8,
    pub(crate) max_cards: usize,
    pub(crate) cards: Vec<KnowledgeCardCandidate>,
    pub(crate) batches: Vec<AnalyzeCardsJobBatchResponse>,
    pub(crate) skipped_cards: usize,
    pub(crate) model: String,
    pub(crate) error: Option<String>,
    pub(crate) chunks: Vec<AnalyzeCardsJobChunkResponse>,
}

/// 从外部 AI/剪贴板批量导入的卡片仍复用单卡字段；服务端会忽略 status，统一以草稿入库。
#[derive(Debug, Deserialize)]
pub(crate) struct ImportKnowledgeCardsPayload {
    #[serde(default)]
    pub(crate) cards: Vec<CreateKnowledgeCardPayload>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ExtractCardsResponse {
    pub(crate) cards: Vec<KnowledgeCard>,
    pub(crate) skipped: usize,
}

/// AI 导入的候选卡片只用于预览，不带数据库 ID，也不会在分析阶段写入数据库。
#[derive(Debug, Serialize, Clone)]
pub(crate) struct KnowledgeCardCandidate {
    pub(crate) card_type: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) tags: Vec<String>,
    pub(crate) projects: Vec<String>,
    pub(crate) source_excerpt: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AnalyzeCardsResponse {
    pub(crate) cards: Vec<KnowledgeCardCandidate>,
    pub(crate) skipped: usize,
    pub(crate) model: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ImportCardsResponse {
    pub(crate) cards: Vec<KnowledgeCard>,
    pub(crate) imported: usize,
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
