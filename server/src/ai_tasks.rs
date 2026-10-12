//! Bounded, process-local AI tasks. Source text is never written to browser storage.
use crate::{ai, db::Database, knowledge, models::*};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::task::AbortHandle;
type Db = Arc<Mutex<Database>>;
type Error = (StatusCode, String);
#[derive(Clone)]
pub(crate) struct Context {
    config: AiConfig,
    review_source: Option<(String, Vec<String>, Vec<String>)>,
    usage: Arc<Mutex<Vec<Option<AiUsage>>>>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}
tokio::task_local! { static CONTEXT: Context; }
pub(crate) fn current_config() -> Option<AiConfig> {
    CONTEXT.try_with(|c| c.config.clone()).ok()
}
pub(crate) fn current_cancelled() -> bool {
    CONTEXT
        .try_with(|c| c.cancelled.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false)
}
pub(crate) fn current_review_source() -> Option<(String, Vec<String>, Vec<String>)> {
    CONTEXT.try_with(|c| c.review_source.clone()).ok().flatten()
}
pub(crate) fn record_usage(usage: Option<AiUsage>) {
    let _ = CONTEXT.try_with(|c| {
        if let Ok(mut values) = c.usage.lock() {
            values.push(usage);
        }
    });
}
pub(crate) fn spawn_with_context<F>(future: F) -> tokio::task::JoinHandle<F::Output>
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    match CONTEXT.try_with(Clone::clone) {
        Ok(ctx) => tokio::spawn(CONTEXT.scope(ctx, future)),
        Err(_) => tokio::spawn(future),
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct TaskRequest {
    pub task: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub source_name: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub max_cards: Option<usize>,
    #[serde(default)]
    pub force: bool,
}
#[derive(Debug, Clone, Serialize)]
pub(crate) struct TaskView {
    pub id: String,
    pub task: String,
    pub source_name: String,
    pub date: String,
    pub created_at_unix: u64,
    pub status: String,
    pub progress_percent: u8,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub analysis_job_id: Option<String>,
    pub usage: Option<AiUsage>,
    pub usage_complete: bool,
    pub estimated_cost_cny: Option<f64>,
}
struct Task {
    view: TaskView,
    request: TaskRequest,
    key: u64,
    created: Instant,
    context: Context,
    input_price: Option<f64>,
    output_price: Option<f64>,
    abort: Option<AbortHandle>,
}
static TASKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<Task>>>>> = OnceLock::new();
fn store() -> &'static Mutex<HashMap<String, Arc<Mutex<Task>>>> {
    TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn error() -> Error {
    (StatusCode::INTERNAL_SERVER_ERROR, "AI 任务读取失败".into())
}
fn snapshot(task: &Task) -> TaskView {
    let mut view = task.view.clone();
    if let Ok(values) = task.context.usage.lock() {
        let complete = !values.is_empty() && values.iter().all(Option::is_some);
        let mut usage = AiUsage {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };
        for v in values.iter().flatten() {
            usage.prompt_tokens = usage.prompt_tokens.saturating_add(v.prompt_tokens);
            usage.completion_tokens = usage.completion_tokens.saturating_add(v.completion_tokens);
            usage.total_tokens = usage.total_tokens.saturating_add(v.total_tokens);
        }
        view.usage =
            (!values.is_empty() && values.iter().any(Option::is_some)).then_some(usage.clone());
        view.usage_complete = complete;
        view.estimated_cost_cny = if complete {
            task.input_price.zip(task.output_price).map(|(i, o)| {
                (usage.prompt_tokens as f64 * i + usage.completion_tokens as f64 * o) / 1_000_000.0
            })
        } else {
            None
        };
    }
    view
}
fn find(id: &str) -> Result<Arc<Mutex<Task>>, Error> {
    let mut tasks = store().lock().map_err(|_| error())?;
    tasks.retain(|_, t| {
        t.lock()
            .map(|t| t.created.elapsed() < Duration::from_secs(3600) || t.view.status == "running")
            .unwrap_or(false)
    });
    tasks.get(id).cloned().ok_or((
        StatusCode::NOT_FOUND,
        "任务已过期或服务已重启，请重新生成。".into(),
    ))
}
fn kind(name: &str) -> Option<AiTask> {
    match name {
        "daily_summary" => Some(AiTask::DailySummary),
        "knowledge_extract" => Some(AiTask::KnowledgeExtract),
        "weekly_review" => Some(AiTask::WeeklyReview),
        "monthly_review" => Some(AiTask::MonthlyReview),
        _ => None,
    }
}
pub(crate) async fn create(
    State(db): State<Db>,
    Json(p): Json<TaskRequest>,
) -> Result<Json<TaskView>, Error> {
    let task_kind = kind(&p.task).ok_or((StatusCode::BAD_REQUEST, "任务类型无效".into()))?;
    if p.content.chars().count() > 1_000_000 || p.source_name.chars().count() > 120 {
        return Err((StatusCode::BAD_REQUEST, "输入过长".into()));
    }
    if matches!(task_kind, AiTask::DailySummary | AiTask::KnowledgeExtract)
        && p.content.trim().is_empty()
    {
        return Err((StatusCode::BAD_REQUEST, "请先填写正文".into()));
    }
    let (config, profile, source, review_source) = {
        let mut db = db.lock().map_err(|_| error())?;
        let (config, id) = db.ai_config_for_task(task_kind).map_err(|_| error())?;
        let profile = db
            .ai_routing()
            .map_err(|_| error())?
            .profiles
            .into_iter()
            .find(|p| p.id == id);
        let review_source = if matches!(task_kind, AiTask::WeeklyReview | AiTask::MonthlyReview) {
            let day = crate::helpers::parse_date(&p.date)?;
            let (from, to) = crate::helpers::review_period(
                if p.task == "weekly_review" {
                    "weekly"
                } else {
                    "monthly"
                },
                day,
            )?;
            if p.task == "weekly_review" {
                let (source, ids) =
                    ai::load_weekly_review_source(&mut db, &from.to_string(), &to.to_string())?;
                Some((source, ids, Vec::new()))
            } else {
                Some(ai::load_monthly_review_source(
                    &mut db,
                    &from.to_string(),
                    &to.to_string(),
                )?)
            }
        } else {
            None
        };
        let source = if let Some(snapshot) = &review_source {
            serde_json::to_string(snapshot).map_err(|_| error())?
        } else {
            p.content.clone()
        };
        (config, profile, source, review_source)
    };
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (
        &p.task,
        &p.date,
        &p.source_name,
        p.max_cards,
        &source,
        &config.model,
        &config.base_url,
        &config.api_key,
        config.temperature.to_bits(),
        config.max_tokens,
        config.timeout_secs,
        (config.retries, config.min_interval_ms),
    )
        .hash(&mut hasher);
    let key = hasher.finish();
    let ctx = Context {
        config,
        review_source,
        usage: Arc::new(Mutex::new(Vec::new())),
        cancelled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
    };
    let handle = {
        let mut tasks = store().lock().map_err(|_| error())?;
        tasks.retain(|_, t| {
            t.lock()
                .map(|t| {
                    t.created.elapsed() < Duration::from_secs(3600) || t.view.status == "running"
                })
                .unwrap_or(false)
        });
        if !p.force {
            for t in tasks.values() {
                let t = t.lock().map_err(|_| error())?;
                if t.key == key
                    && matches!(
                        t.view.status.as_str(),
                        "running" | "completed" | "completed_with_errors"
                    )
                {
                    return Ok(Json(snapshot(&t)));
                }
            }
        }
        if tasks
            .values()
            .filter_map(|t| t.lock().ok())
            .map(|t| {
                t.request.content.len() + t.context.review_source.as_ref().map_or(0, |s| s.0.len())
            })
            .sum::<usize>()
            .saturating_add(source.len())
            > 64 * 1024 * 1024
            || tasks.len() >= 32
            || tasks
                .values()
                .filter(|t| t.lock().map(|t| t.view.status == "running").unwrap_or(true))
                .count()
                >= 8
        {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                "任务较多，请等待或稍后再试".into(),
            ));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let created_at_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let handle = Arc::new(Mutex::new(Task {
            view: TaskView {
                id: id.clone(),
                task: p.task.clone(),
                source_name: p.source_name.clone(),
                date: p.date.clone(),
                created_at_unix,
                status: "running".into(),
                progress_percent: 0,
                result: None,
                error: None,
                analysis_job_id: None,
                usage: None,
                usage_complete: false,
                estimated_cost_cny: None,
            },
            request: p,
            key,
            created: Instant::now(),
            context: ctx,
            input_price: profile.as_ref().and_then(|p| p.input_price_cny),
            output_price: profile.and_then(|p| p.output_price_cny),
            abort: None,
        }));
        tasks.insert(id, handle.clone());
        handle
    };
    launch(db, handle.clone());
    let view = {
        let task = handle.lock().map_err(|_| error())?;
        snapshot(&task)
    };
    Ok(Json(view))
}
fn launch(db: Db, handle: Arc<Mutex<Task>>) {
    let ctx = handle.lock().expect("task lock").context.clone();
    let task_handle = handle.clone();
    let join = tokio::spawn(CONTEXT.scope(ctx, async move {
        let (p, existing) = {
            let t = task_handle.lock().expect("task lock");
            (t.request.clone(), t.view.analysis_job_id.clone())
        };
        let result: Result<Value, Error> = async {
            match p.task.as_str() {
                "daily_summary" => ai::ai_summary(
                    State(db.clone()),
                    Json(AiSummaryPayload { content: p.content }),
                )
                .await
                .and_then(|Json(v)| serde_json::to_value(v).map_err(|_| error())),
                "knowledge_extract" => {
                    let id = if let Some(id) = existing {
                        let _ = knowledge::retry_analyze_job(State(db.clone()), Path(id.clone()))
                            .await?;
                        id
                    } else {
                        let Json(v) = knowledge::create_analyze_job(
                            State(db.clone()),
                            Json(AnalyzeKnowledgeCardsPayload {
                                content: p.content,
                                source_name: p.source_name,
                                max_cards: p.max_cards,
                                preserve_duplicates: true,
                            }),
                        )
                        .await?;
                        v.job_id
                    };
                    task_handle
                        .lock()
                        .map_err(|_| error())?
                        .view
                        .analysis_job_id = Some(id.clone());
                    loop {
                        let Json(v) = knowledge::get_analyze_job(Path(id.clone())).await?;
                        {
                            let mut t = task_handle.lock().map_err(|_| error())?;
                            t.view.progress_percent = v.progress_percent;
                            t.view.result = Some(serde_json::to_value(&v).map_err(|_| error())?);
                        }
                        if !matches!(v.status.as_str(), "queued" | "running") {
                            if v.status == "failed" {
                                return Err((
                                    StatusCode::BAD_GATEWAY,
                                    v.error.unwrap_or_else(|| "知识提取失败".into()),
                                ));
                            }
                            return serde_json::to_value(v).map_err(|_| error());
                        }
                        tokio::time::sleep(Duration::from_millis(800)).await;
                    }
                }
                _ => ai::generate_review(
                    State(db),
                    Json(GenerateReviewPayload {
                        kind: if p.task == "weekly_review" {
                            "weekly".into()
                        } else {
                            "monthly".into()
                        },
                        date: p.date,
                    }),
                )
                .await
                .and_then(|Json(v)| serde_json::to_value(v).map_err(|_| error())),
            }
        }
        .await;
        if let Ok(mut t) = task_handle.lock() {
            if t.view.status != "cancelled" {
                t.created = Instant::now();
                match result {
                    Ok(v) => {
                        t.view.status = v
                            .get("status")
                            .and_then(Value::as_str)
                            .filter(|s| matches!(*s, "completed_with_errors" | "cancelled"))
                            .unwrap_or("completed")
                            .into();
                        t.view.result = Some(v);
                        t.view.progress_percent = 100;
                    }
                    Err((_, message)) => {
                        t.view.status = "failed".into();
                        t.view.error = Some(message);
                    }
                }
            }
        }
    }));
    if let Ok(mut t) = handle.lock() {
        t.abort = Some(join.abort_handle());
    }
}
pub(crate) async fn list() -> Result<Json<Vec<TaskView>>, Error> {
    let tasks = store().lock().map_err(|_| error())?;
    let mut ordered = tasks
        .values()
        .filter_map(|h| h.lock().ok())
        .filter(|t| t.created.elapsed() < Duration::from_secs(3600) || t.view.status == "running")
        .collect::<Vec<_>>();
    ordered.sort_by_key(|t| t.created);
    Ok(Json(
        ordered
            .into_iter()
            .rev()
            .map(|t| {
                let mut view = snapshot(&t);
                view.result = None;
                view
            })
            .collect(),
    ))
}
#[derive(Deserialize)]
pub(crate) struct ReadQuery {
    #[serde(default)]
    summary: bool,
}
pub(crate) async fn read(
    Path(id): Path<String>,
    Query(q): Query<ReadQuery>,
) -> Result<Json<TaskView>, Error> {
    let Json(mut task) = get(Path(id)).await?;
    if q.summary {
        task.result = None;
    }
    Ok(Json(task))
}
pub(crate) async fn get(Path(id): Path<String>) -> Result<Json<TaskView>, Error> {
    let h = find(&id)?;
    let t = h.lock().map_err(|_| error())?;
    Ok(Json(snapshot(&t)))
}
pub(crate) async fn retry(
    State(db): State<Db>,
    Path(id): Path<String>,
) -> Result<Json<TaskView>, Error> {
    let h = find(&id)?;
    {
        let tasks = store().lock().map_err(|_| error())?;
        if tasks
            .values()
            .filter(|t| t.lock().map(|t| t.view.status == "running").unwrap_or(true))
            .count()
            >= 8
        {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                "运行任务较多，请等待后重试".into(),
            ));
        }
        let mut t = h.lock().map_err(|_| error())?;
        if !matches!(
            t.view.status.as_str(),
            "failed" | "completed_with_errors" | "cancelled"
        ) {
            return Err((StatusCode::CONFLICT, "当前任务无需重试".into()));
        }
        t.context.cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        t.view.status = "running".into();
        t.view.created_at_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        t.created = Instant::now();
        t.view.error = None;
    }
    launch(db, h);
    get(Path(id)).await
}
pub(crate) async fn cancel(Path(id): Path<String>) -> Result<Json<TaskView>, Error> {
    let h = find(&id)?;
    let child = {
        let mut t = h.lock().map_err(|_| error())?;
        if t.view.status != "running" {
            return Ok(Json(snapshot(&t)));
        }
        t.context
            .cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        // Aborting an in-flight upstream request cannot prove it was unbilled.
        if let Ok(mut usage) = t.context.usage.lock() {
            usage.push(None);
        }
        t.view.status = "cancelled".into();
        t.created = Instant::now();
        if let Some(a) = &t.abort {
            a.abort();
        }
        t.view.analysis_job_id.clone()
    };
    if let Some(child) = child {
        let Json(result) = knowledge::cancel_analyze_job(Path(child)).await?;
        if let Ok(mut task) = h.lock() {
            task.view.result = serde_json::to_value(result).ok();
        }
    }
    get(Path(id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Router};
    use std::sync::atomic::{AtomicUsize, Ordering};
    async fn mock(State(count): State<Arc<AtomicUsize>>, Json(body): Json<Value>) -> Json<Value> {
        let n = count.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(60)).await;
        let prompt = body["messages"][1]["content"].as_str().unwrap_or("");
        static FAIL_ONCE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if prompt.contains("失败分块资料") && !FAIL_ONCE.swap(true, Ordering::SeqCst) {
            return Json(serde_json::json!({"error":"synthetic failure"}));
        }
        let content = if let Some(doc) = prompt.split("<document>\n").nth(1) {
            let doc = doc.split("\n</document>").next().unwrap_or(doc);
            json_for_candidate(doc, n)
        } else {
            "本次回顾基于原始记录。".into()
        };
        Json(
            serde_json::json!({"choices":[{"message":{"role":"assistant","content":content}}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}),
        )
    }
    fn json_for_candidate(source: &str, n: usize) -> String {
        serde_json::json!({"cards":[{"card_type":"concept","title":format!("知识 {n}"),"content":"可复用的知识正文与方法说明。","source_excerpt":source.chars().take(20).collect::<String>(),"tags":[],"projects":[]}]}).to_string()
    }
    async fn wait(id: &str) -> TaskView {
        for _ in 0..200 {
            let Json(v) = get(Path(id.to_string())).await.unwrap();
            if v.status != "running" {
                return v;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("mock task timed out")
    }
    #[tokio::test]
    async fn mock_tasks_reuse_results_freeze_prices_cancel_and_expire_without_external_ai() {
        let count = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/chat/completions", post(mock))
            .with_state(count.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let mut database = Database::new_in_memory().unwrap();
        let config = AiConfig {
            api_key: "synthetic-test-key".into(),
            base_url: format!("http://{addr}"),
            model: "mock".into(),
            temperature: 0.2,
            max_tokens: 1000,
            timeout_secs: 3,
            retries: 0,
            min_interval_ms: 0,
        };
        database.update_ai_config(&config, true).unwrap();
        let mut routing = database.ai_routing().unwrap();
        for profile in &mut routing.profiles {
            profile.retries = 0;
            profile.min_interval_ms = 0;
            profile.input_price_cny = Some(2.0);
            profile.output_price_cny = Some(4.0);
        }
        database.update_ai_routing(&routing).unwrap();
        let db = Arc::new(Mutex::new(database));
        let p = TaskRequest {
            task: "daily_summary".into(),
            content: format!("记录 {}", uuid::Uuid::new_v4()),
            source_name: "".into(),
            date: "".into(),
            max_cards: None,
            force: false,
        };
        let Json(first) = create(State(db.clone()), Json(p.clone())).await.unwrap();
        let Json(duplicate) = create(State(db.clone()), Json(p.clone())).await.unwrap();
        assert_eq!(first.id, duplicate.id);
        {
            let mut d = db.lock().unwrap();
            let mut r = d.ai_routing().unwrap();
            for profile in &mut r.profiles {
                profile.input_price_cny = Some(100.0);
            }
            d.update_ai_routing(&r).unwrap();
        }
        let finished = wait(&first.id).await;
        assert_eq!(finished.status, "completed", "{:?}", finished.error);
        assert_eq!(finished.usage.as_ref().unwrap().total_tokens, 30);
        assert!(finished.usage_complete);
        assert!((finished.estimated_cost_cny.unwrap() - 0.0001).abs() < 1e-10);
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let mut fresh = p.clone();
        fresh.force = true;
        let Json(new) = create(State(db.clone()), Json(fresh)).await.unwrap();
        assert_ne!(new.id, first.id);
        let Json(cancelled) = cancel(Path(new.id.clone())).await.unwrap();
        assert_eq!(cancelled.status, "cancelled");
        let mut extract = p.clone();
        extract.task = "knowledge_extract".into();
        extract.content = "第一段原文依据，可用于整理知识。".repeat(1600);
        extract.max_cards = Some(20);
        let Json(job) = create(State(db.clone()), Json(extract)).await.unwrap();
        let finished = wait(&job.id).await;
        assert_eq!(finished.status, "completed", "{:?}", finished.error);
        assert!(finished.result.unwrap()["cards"].as_array().unwrap().len() >= 2);
        assert!(finished.analysis_job_id.is_some());
        let mut partial = p.clone();
        partial.task = "knowledge_extract".into();
        partial.max_cards = Some(100);
        partial.content = "第一段资料。".repeat(2500) + &"失败分块资料。".repeat(2500);
        let Json(partial) = create(State(db.clone()), Json(partial)).await.unwrap();
        let first_partial = wait(&partial.id).await;
        assert_eq!(first_partial.status, "completed_with_errors");
        assert!(!first_partial.result.as_ref().unwrap()["cards"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(!first_partial.usage_complete);
        assert!(first_partial.estimated_cost_cny.is_none());
        let before = count.load(Ordering::SeqCst);
        let _ = retry(State(db.clone()), Path(partial.id.clone()))
            .await
            .unwrap();
        let retried = wait(&partial.id).await;
        assert_eq!(retried.status, "completed");
        assert_eq!(
            count.load(Ordering::SeqCst) - before,
            1,
            "only the failed chunk is retried"
        );

        {
            let handle = find(&first.id).unwrap();
            handle.lock().unwrap().created = Instant::now() - Duration::from_secs(3601);
        }
        assert_eq!(
            get(Path(first.id)).await.unwrap_err().0,
            StatusCode::NOT_FOUND
        );
        let mut cancel_knowledge = p.clone();
        cancel_knowledge.task = "knowledge_extract".into();
        cancel_knowledge.content = "原文取消测试依据。".repeat(2500);
        cancel_knowledge.max_cards = Some(100);
        let before = count.load(Ordering::SeqCst);
        let Json(cancelling) = create(State(db.clone()), Json(cancel_knowledge))
            .await
            .unwrap();
        for _ in 0..100 {
            if count.load(Ordering::SeqCst) > before {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let _ = cancel(Path(cancelling.id.clone())).await.unwrap();
        tokio::time::sleep(Duration::from_millis(120)).await;
        assert!(
            count.load(Ordering::SeqCst) - before <= 1,
            "cancellation must not start later chunks"
        );
        assert_eq!(
            get(Path(cancelling.id)).await.unwrap().0.status,
            "cancelled"
        );
        // Removing this task simulates loss of the process-local registry on restart.
        store().lock().unwrap().remove(&new.id);
        assert_eq!(
            get(Path(new.id)).await.unwrap_err().0,
            StatusCode::NOT_FOUND
        );
        server.abort();
    }
    #[tokio::test]
    async fn cancellation_is_inherited_by_detached_children_without_network() {
        let config = AiConfig {
            api_key: String::new(),
            base_url: String::new(),
            model: String::new(),
            temperature: 0.0,
            max_tokens: 0,
            timeout_secs: 1,
            retries: 0,
            min_interval_ms: 0,
        };
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let context = Context {
            config,
            review_source: None,
            usage: Arc::new(Mutex::new(Vec::new())),
            cancelled: cancelled.clone(),
        };
        let child_observed_cancellation = CONTEXT
            .scope(context, async {
                let update_flag = cancelled.clone();
                let (ready_sender, ready_receiver) = tokio::sync::oneshot::channel::<()>();
                let canceller = tokio::spawn(async move {
                    let _ = ready_receiver.await;
                    update_flag.store(true, Ordering::SeqCst);
                });
                let child = spawn_with_context(async move {
                    let _ = ready_sender.send(());
                    tokio::task::yield_now().await;
                    current_cancelled()
                })
                .await
                .unwrap();
                canceller.await.unwrap();
                child
            })
            .await;
        assert!(child_observed_cancellation);
        assert!(
            !current_cancelled(),
            "context must not leak to unrelated requests"
        );
    }
    #[test]
    fn missing_upstream_usage_never_becomes_zero_or_an_exact_cost() {
        let config = AiConfig {
            api_key: String::new(),
            base_url: String::new(),
            model: String::new(),
            temperature: 0.0,
            max_tokens: 0,
            timeout_secs: 1,
            retries: 0,
            min_interval_ms: 0,
        };
        let task = Task {
            view: TaskView {
                id: "".into(),
                task: "daily_summary".into(),
                source_name: String::new(),
                date: String::new(),
                created_at_unix: 0,
                status: "completed".into(),
                progress_percent: 100,
                result: None,
                error: None,
                analysis_job_id: None,
                usage: None,
                usage_complete: false,
                estimated_cost_cny: None,
            },
            request: TaskRequest {
                task: "daily_summary".into(),
                content: "".into(),
                source_name: "".into(),
                date: "".into(),
                max_cards: None,
                force: false,
            },
            key: 0,
            created: Instant::now(),
            context: Context {
                config,
                review_source: None,
                usage: Arc::new(Mutex::new(vec![None])),
                cancelled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            },
            input_price: Some(2.0),
            output_price: Some(4.0),
            abort: None,
        };
        let view = snapshot(&task);
        assert!(view.usage.is_none());
        assert!(!view.usage_complete);
        assert!(view.estimated_cost_cny.is_none());
    }
}
